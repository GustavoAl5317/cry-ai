import { after } from "next/server";
import { ingestFile, ingestLink, newDoc } from "@/lib/docs";
import { listDocs, newId, saveDoc, updateMeeting } from "@/lib/store";

const MAX_BYTES = 50 * 1024 * 1024;

export async function GET() {
  return Response.json(await listDocs());
}

/**
 * Adds a document (multipart `file`) or a web page (JSON `url`) and attaches
 * it to `meetingId`. Indexing runs after the response; the UI polls status.
 */
export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "Documentos usam a busca da OpenAI: configure OPENAI_API_KEY" },
      { status: 400 },
    );
  }

  const type = request.headers.get("content-type") ?? "";
  let meetingId: string | null;
  let doc;

  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    meetingId = form.get("meetingId") as string | null;
    if (!(file instanceof File)) return Response.json({ error: "Arquivo ausente" }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "Arquivo maior que 50 MB" }, { status: 400 });
    doc = newDoc({ id: newId(), name: file.name, kind: "file", size: file.size });
    const buffer = Buffer.from(await file.arrayBuffer());
    await saveDoc(doc);
    const pending = doc;
    after(() => ingestFile(pending, buffer));
  } else {
    const body = (await request.json()) as { url?: string; meetingId?: string };
    meetingId = body.meetingId ?? null;
    let url: URL;
    try {
      url = new URL(body.url ?? "");
      if (!/^https?:$/.test(url.protocol)) throw new Error();
    } catch {
      return Response.json({ error: "Link invalido" }, { status: 400 });
    }
    doc = newDoc({ id: newId(), name: url.hostname + url.pathname.replace(/\/$/, ""), kind: "link", url: url.href });
    await saveDoc(doc);
    const pending = doc;
    after(() => ingestLink(pending));
  }

  if (meetingId) {
    const id = doc.id;
    await updateMeeting(meetingId, (m) => {
      if (!m.docIds.includes(id)) m.docIds.push(id);
    });
  }
  return Response.json(doc, { status: 201 });
}
