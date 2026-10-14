"use client";

import { Calendar, ChevronRight, FileText, MessageSquare, Plug, Plus, Radio, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, formatDate, formatDuration } from "@/lib/client";
import type { Meeting, MeetingListItem } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Field, inputClass, Logo, Spinner } from "./ui";

function status(m: MeetingListItem) {
  if (m.endedAt) return <Badge>Encerrada</Badge>;
  if (m.startedAt) return <Badge tone="emerald">Em andamento</Badge>;
  return <Badge tone="violet">Preparando</Badge>;
}

export function Dashboard() {
  const router = useRouter();
  const [meetings, setMeetings] = useState<MeetingListItem[] | null>(null);
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MeetingListItem[]>("/api/meetings")
      .then(setMeetings)
      .catch((e: Error) => setError(e.message));
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const meeting = await api<Meeting>("/api/meetings", "POST", { title, client });
      router.push(`/reuniao/${meeting.id}`);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Apagar esta reuniao e o historico dela?")) return;
    await api(`/api/meetings/${id}`, "DELETE");
    setMeetings((prev) => prev?.filter((m) => m.id !== id) ?? null);
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-ink-700/70 bg-ink-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          <Logo />
          <Link href="/config">
            <Button variant="ghost" size="sm">
              <Plug size={14} /> Conexoes MCP
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-5 py-8">
        <section className="relative overflow-hidden rounded-3xl border border-ink-700 bg-gradient-to-br from-violet-500/10 via-ink-900 to-emerald-500/5 p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Prepare, escute, responda.</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">
            Alimente o copiloto com documentos, links e sistemas antes da reuniao. Durante a chamada ele escuta o cliente e
            entrega respostas, pesquisas e codigo so na sua tela.
          </p>
          <form onSubmit={create} className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Reuniao">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Demo da plataforma"
                className={inputClass}
              />
            </Field>
            <Field label="Cliente / empresa">
              <input
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder="Ex.: Acme S.A."
                className={inputClass}
              />
            </Field>
            <Button variant="primary" disabled={creating}>
              {creating ? <Spinner /> : <Plus size={16} />} Nova reuniao
            </Button>
          </form>
        </section>

        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Historico</h2>
          {meetings === null ? (
            <div className="flex justify-center py-10 text-zinc-500">
              <Spinner size={18} />
            </div>
          ) : meetings.length === 0 ? (
            <Card>
              <EmptyState icon={<Calendar size={18} />} title="Nenhuma reuniao ainda">
                Crie a primeira acima. Tudo fica salvo neste computador, na pasta data/.
              </EmptyState>
            </Card>
          ) : (
            <div className="grid gap-2.5">
              {meetings.map((m) => (
                <Card key={m.id} className="group flex items-center gap-4 p-4 transition hover:border-zinc-600">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-800 text-zinc-400">
                    {m.startedAt && !m.endedAt ? <Radio size={18} className="text-emerald-400" /> : <Calendar size={18} />}
                  </div>
                  <Link href={`/reuniao/${m.id}`} className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{m.title}</span>
                      {status(m)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                      {m.client && <span>{m.client}</span>}
                      <span>{formatDate(m.startedAt ?? m.createdAt)}</span>
                      {m.startedAt && m.endedAt && <span>{formatDuration(m.startedAt, m.endedAt)}</span>}
                      <span className="flex items-center gap-1">
                        <MessageSquare size={11} /> {m.answers}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileText size={11} /> {m.docs}
                      </span>
                    </div>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(m.id)}
                    className="opacity-0 group-hover:opacity-100"
                    aria-label="Apagar reuniao"
                  >
                    <Trash2 size={14} />
                  </Button>
                  <ChevronRight size={16} className="text-zinc-600" />
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
