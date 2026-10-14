"use client";

import { CircleAlert, FileText, FolderOpen, Globe, Link as LinkIcon, Play, Plug, RefreshCw, Upload, WandSparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, streamAgent } from "@/lib/client";
import type { Doc, Meeting, PublicMcpServer } from "@/lib/types";
import { Markdown } from "./Markdown";
import { Badge, Button, Card, EmptyState, Field, inputClass, Spinner } from "./ui";

const ACCEPT = ".pdf,.doc,.docx,.pptx,.txt,.md,.csv,.xlsx,.json,.html,.py,.js,.ts,.java,.go,.cs,.cpp,.c,.php,.rb,.sh,.tex,.css";

function SectionTitle({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-zinc-500">{icon}</span>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

export function PrepPanel({
  meeting,
  docs,
  onPatch,
  onDocs,
  onStartLive,
}: {
  meeting: Meeting;
  docs: Doc[];
  onPatch: (patch: Partial<Meeting>) => Promise<void>;
  onDocs: (docs: Doc[]) => void;
  onStartLive: () => void;
}) {
  const [form, setForm] = useState({ title: meeting.title, client: meeting.client, goal: meeting.goal });
  const [link, setLink] = useState("");
  const [uploading, setUploading] = useState(0);
  const [library, setLibrary] = useState<Doc[]>([]);
  const [servers, setServers] = useState<PublicMcpServer[]>([]);
  const [briefing, setBriefing] = useState(meeting.briefing ?? "");
  const [briefingStatus, setBriefingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const docsRef = useRef(docs);

  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);

  useEffect(() => {
    api<PublicMcpServer[]>("/api/settings/mcp").then(setServers).catch(() => {});
    api<Doc[]>("/api/docs").then(setLibrary).catch(() => {});
  }, []);

  // Poll while documents are still being indexed.
  const processing = docs.some((d) => d.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(async () => {
      const fresh = await Promise.all(
        docsRef.current.map((d) => (d.status === "processing" ? api<Doc>(`/api/docs/${d.id}`).catch(() => d) : d)),
      );
      onDocs(fresh);
    }, 2500);
    return () => clearInterval(timer);
  }, [processing, onDocs]);

  const saveField = (key: "title" | "client" | "goal") => {
    if (form[key] !== meeting[key]) void onPatch({ [key]: form[key] });
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const added: Doc[] = [];
    setUploading(files.length);
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.append("file", file);
      body.append("meetingId", meeting.id);
      try {
        const res = await fetch("/api/docs", { method: "POST", body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        added.push(data as Doc);
      } catch (err) {
        setError(`${file.name}: ${(err as Error).message}`);
      }
      setUploading((n) => n - 1);
    }
    onDocs([...docsRef.current, ...added]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const addLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const doc = await api<Doc>("/api/docs", "POST", { url: link.trim(), meetingId: meeting.id });
      onDocs([...docsRef.current, doc]);
      setLink("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const detach = (doc: Doc) => {
    const next = docs.filter((d) => d.id !== doc.id);
    onDocs(next);
    void onPatch({ docIds: next.map((d) => d.id) });
  };

  const attach = (doc: Doc) => {
    const next = [...docs, doc];
    onDocs(next);
    void onPatch({ docIds: next.map((d) => d.id) });
  };

  const toggleServer = (id: string) => {
    const ids = meeting.mcpServerIds.includes(id)
      ? meeting.mcpServerIds.filter((x) => x !== id)
      : [...meeting.mcpServerIds, id];
    void onPatch({ mcpServerIds: ids });
  };

  const generateBriefing = async () => {
    setError(null);
    setBriefingStatus("Pensando");
    setBriefing("");
    try {
      const text = await streamAgent(`/api/meetings/${meeting.id}/briefing`, {}, {
        onStatus: setBriefingStatus,
        onText: (t) => {
          setBriefing(t);
          setBriefingStatus(null);
        },
      });
      setBriefing(text);
      await onPatch({ briefing: text });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBriefingStatus(null);
    }
  };

  const attachable = library.filter((d) => d.status === "ready" && !docs.some((x) => x.id === d.id));
  const enabledServers = servers.filter((s) => s.enabled);

  return (
    <div className="mx-auto grid max-w-6xl gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="space-y-5">
        <Card className="space-y-4 p-5">
          <SectionTitle icon={<FileText size={15} />} title="Sobre a reuniao" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Titulo">
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                onBlur={() => saveField("title")}
                className={inputClass}
              />
            </Field>
            <Field label="Cliente / empresa">
              <input
                value={form.client}
                onChange={(e) => setForm({ ...form, client: e.target.value })}
                onBlur={() => saveField("client")}
                placeholder="Usado para pesquisar o cliente"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Objetivo, contexto e anotacoes" hint="O agente le isto em toda resposta. Ex.: produto, precos, quem participa, o que voce quer fechar.">
            <textarea
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              onBlur={() => saveField("goal")}
              rows={6}
              placeholder="Ex.: Apresentar o plano Enterprise. Participantes: Ana (CTO) e Bruno (compras). Desconto maximo 15%."
              className={`${inputClass} resize-y`}
            />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <SectionTitle icon={<FolderOpen size={15} />} title="Base de conhecimento">
            {processing && (
              <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                <Spinner size={11} /> Indexando
              </span>
            )}
          </SectionTitle>

          <button
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void uploadFiles(e.dataTransfer.files);
            }}
            className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-ink-700 bg-ink-950/60 px-4 py-6 text-center transition hover:border-violet-500/50 hover:bg-violet-500/[0.03]"
          >
            {uploading ? <Spinner size={18} className="text-violet-300" /> : <Upload size={18} className="text-zinc-400" />}
            <span className="text-sm text-zinc-300">{uploading ? `Enviando ${uploading}...` : "Solte arquivos ou clique para enviar"}</span>
            <span className="text-[11px] text-zinc-500">PDF, Word, PowerPoint, Excel, CSV, texto e codigo ate 50 MB</span>
          </button>
          <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => void uploadFiles(e.target.files)} />

          <form onSubmit={addLink} className="flex gap-2">
            <div className="relative flex-1">
              <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                type="url"
                placeholder="https://site-do-cliente.com"
                className={`${inputClass} pl-9`}
              />
            </div>
            <Button disabled={!link.trim()}>
              <LinkIcon size={14} /> Adicionar
            </Button>
          </form>

          {docs.length > 0 && (
            <ul className="divide-y divide-ink-700/70 rounded-xl border border-ink-700">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                  {d.kind === "link" ? <Globe size={14} className="text-sky-400" /> : <FileText size={14} className="text-zinc-400" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{d.name}</p>
                    {d.error && <p className="truncate text-[11px] text-rose-300">{d.error}</p>}
                  </div>
                  {d.status === "processing" && <Badge tone="amber"><Spinner size={10} /> Indexando</Badge>}
                  {d.status === "ready" && <Badge tone="emerald">Pronto</Badge>}
                  {d.status === "error" && <Badge tone="rose"><CircleAlert size={10} /> Erro</Badge>}
                  <button onClick={() => detach(d)} className="text-zinc-600 hover:text-zinc-300" aria-label="Remover da reuniao">
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {attachable.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                Usar documentos de outras reunioes ({attachable.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {attachable.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate text-zinc-400">{d.name}</span>
                    <Button size="sm" variant="ghost" onClick={() => attach(d)}>
                      Adicionar
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        <Card className="space-y-3 p-5">
          <SectionTitle icon={<Plug size={15} />} title="Sistemas conectados (MCP)">
            <Link href="/config" className="text-xs text-violet-300 hover:text-violet-200">
              Gerenciar
            </Link>
          </SectionTitle>
          {enabledServers.length === 0 ? (
            <p className="text-xs text-zinc-500">
              Nenhuma conexao ativa. Conecte GitHub, Notion, Google Drive, CRM e outros em{" "}
              <Link href="/config" className="text-violet-300">
                Conexoes
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {enabledServers.map((s) => {
                const on = meeting.mcpServerIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleServer(s.id)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${
                      on ? "border-violet-500/50 bg-violet-500/10 text-violet-200" : "border-ink-700 text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    <Plug size={12} /> {s.label}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
      </div>

      <Card className="flex min-h-[420px] flex-col">
        <div className="flex items-center gap-2 border-b border-ink-700/70 px-5 py-3.5">
          <WandSparkles size={15} className="text-violet-300" />
          <h2 className="text-sm font-semibold">Briefing</h2>
          {briefingStatus && (
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Spinner size={11} /> {briefingStatus}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant={briefing ? "secondary" : "ai"} onClick={generateBriefing} disabled={briefingStatus !== null}>
              {briefing ? <RefreshCw size={12} /> : <WandSparkles size={12} />} {briefing ? "Refazer" : "Gerar briefing"}
            </Button>
            <Button size="sm" variant="primary" onClick={onStartLive}>
              <Play size={12} fill="currentColor" /> Ir para ao vivo
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {briefing ? (
            <Markdown text={briefing} />
          ) : briefingStatus ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
              <Spinner /> Pesquisando o cliente, seus documentos e sistemas...
            </div>
          ) : (
            <EmptyState icon={<WandSparkles size={18} />} title="Chegue preparado">
              O agente pesquisa o cliente na web, le seus documentos e sistemas conectados e monta: perguntas provaveis com
              respostas, objecoes e um glossario. Tudo isso tambem vira contexto para as respostas ao vivo.
            </EmptyState>
          )}
        </div>
      </Card>
    </div>
  );
}
