import "server-only";
import ExcelJS from "exceljs";
import OpenAI, { toFile } from "openai";
import { getSettings, now, saveDoc, updateSettings } from "./store";
import type { Doc } from "./types";

// File types OpenAI file search indexes as-is.
const NATIVE = new Set([
  "c", "cpp", "cs", "css", "doc", "docx", "go", "html", "java", "js", "json", "md",
  "pdf", "php", "pptx", "py", "rb", "sh", "tex", "ts", "txt",
]);
const MAX_ROWS_PER_SHEET = 2000;

let client: OpenAI | undefined;
const openai = () => (client ??= new OpenAI());

/** One vector store holds every document; meetings filter it by doc_id. */
async function vectorStoreId(): Promise<string> {
  const settings = await getSettings();
  if (settings.vectorStoreId) return settings.vectorStoreId;
  const store = await openai().vectorStores.create({ name: "Copiloto de Reuniao" });
  await updateSettings((s) => {
    s.vectorStoreId ??= store.id;
  });
  return (await getSettings()).vectorStoreId!;
}

export async function getVectorStoreId(): Promise<string | undefined> {
  return (await getSettings()).vectorStoreId;
}

const extension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

function cell(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return String(value.result ?? "");
    if ("text" in value) return String(value.text);
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    return "";
  }
  return String(value).replace(/\|/g, "/").replace(/\n/g, " ");
}

async function spreadsheetToMarkdown(buffer: Buffer, ext: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  if (ext === "csv") {
    const { Readable } = await import("node:stream");
    await workbook.csv.read(Readable.from(buffer));
  } else {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  }
  const parts: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow((row, n) => {
      if (n > MAX_ROWS_PER_SHEET) return;
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cell);
      rows.push(`| ${values.join(" | ")} |`);
      if (n === 1) rows.push(`|${values.map(() => " --- ").join("|")}|`);
    });
    parts.push(`## ${sheet.name}\n\n${rows.join("\n")}`);
  });
  return parts.join("\n\n");
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** Converts what file search cannot read into Markdown it can. */
async function prepare(name: string, buffer: Buffer): Promise<{ name: string; data: Buffer }> {
  const ext = extension(name);
  if (NATIVE.has(ext)) return { name, data: buffer };
  if (ext === "csv" || ext === "xlsx") {
    const md = await spreadsheetToMarkdown(buffer, ext);
    return { name: `${name}.md`, data: Buffer.from(`# ${name}\n\n${md}`, "utf8") };
  }
  // Unknown extension: accept it when it decodes as text.
  const text = buffer.toString("utf8");
  if (!text.includes("�")) return { name: `${name}.txt`, data: buffer };
  throw new Error(`Formato .${ext} nao suportado`);
}

async function upload(doc: Doc, name: string, buffer: Buffer): Promise<Doc> {
  const file = await prepare(name, buffer);
  const uploaded = await openai().files.create({
    file: await toFile(file.data, file.name),
    purpose: "assistants",
  });
  const indexed = await openai().vectorStores.files.createAndPoll(await vectorStoreId(), {
    file_id: uploaded.id,
    attributes: { doc_id: doc.id },
  });
  if (indexed.status !== "completed") {
    throw new Error(indexed.last_error?.message ?? `Indexacao terminou como ${indexed.status}`);
  }
  return { ...doc, openaiFileId: uploaded.id, status: "ready" };
}

export async function ingestFile(doc: Doc, buffer: Buffer): Promise<void> {
  try {
    await saveDoc(await upload(doc, doc.name, buffer));
  } catch (err) {
    await saveDoc({ ...doc, status: "error", error: errorText(err) });
  }
}

export async function ingestLink(doc: Doc): Promise<void> {
  try {
    const res = await fetch(doc.url!, {
      headers: { "User-Agent": "Mozilla/5.0 (CopilotoDeReuniao)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Site respondeu ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await res.arrayBuffer());
    const host = new URL(doc.url!).hostname;
    let ready: Doc;
    if (type.includes("pdf")) {
      ready = await upload(doc, `${host}.pdf`, buffer);
    } else {
      const text = type.includes("html") ? htmlToText(buffer.toString("utf8")) : buffer.toString("utf8");
      if (text.length < 50) throw new Error("Pagina sem texto legivel");
      ready = await upload(doc, `${host}.md`, Buffer.from(`# ${doc.url}\n\n${text}`, "utf8"));
    }
    await saveDoc(ready);
  } catch (err) {
    await saveDoc({ ...doc, status: "error", error: errorText(err) });
  }
}

export async function removeFromOpenAI(doc: Doc): Promise<void> {
  if (!doc.openaiFileId) return;
  const vs = await getVectorStoreId();
  try {
    if (vs) await openai().vectorStores.files.delete(doc.openaiFileId, { vector_store_id: vs });
    await openai().files.delete(doc.openaiFileId);
  } catch {
    // Already gone on OpenAI's side; nothing else to clean up.
  }
}

export function newDoc(fields: Pick<Doc, "id" | "name" | "kind"> & Partial<Doc>): Doc {
  return { status: "processing", createdAt: now(), ...fields };
}

function errorText(err: unknown): string {
  if (err instanceof OpenAI.APIError) return `OpenAI ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
