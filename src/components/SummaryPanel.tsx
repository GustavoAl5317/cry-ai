"use client";

import { ListChecks, MessageSquare, RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate, formatDuration, streamAgent } from "@/lib/client";
import type { Meeting } from "@/lib/types";
import { Markdown } from "./Markdown";
import { Badge, Button, Card, EmptyState, Spinner } from "./ui";

export function SummaryPanel({
  meeting,
  autoGenerate,
  onSummary,
}: {
  meeting: Meeting;
  autoGenerate: boolean;
  onSummary: (text: string) => void;
}) {
  const [summary, setSummary] = useState(meeting.summary ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const generate = useCallback(async () => {
    setError(null);
    setStatus("Escrevendo resumo");
    setSummary("");
    try {
      const text = await streamAgent(`/api/meetings/${meeting.id}/summary`, {}, {
        onText: setSummary,
      });
      setSummary(text);
      onSummary(text);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStatus(null);
    }
  }, [meeting.id, onSummary]);

  // Right after a meeting ends, write the summary without waiting for a click.
  useEffect(() => {
    if (!autoGenerate || started.current || meeting.summary || meeting.transcript.length === 0) return;
    started.current = true;
    const timer = setTimeout(() => void generate(), 0);
    return () => clearTimeout(timer);
  }, [autoGenerate, generate, meeting.summary, meeting.transcript.length]);

  return (
    <div className="mx-auto grid max-w-6xl gap-5 p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card className="flex min-h-[420px] flex-col">
        <div className="flex items-center gap-2 border-b border-ink-700/70 px-5 py-3.5">
          <ListChecks size={15} className="text-emerald-300" />
          <h2 className="text-sm font-semibold">Resumo e proximos passos</h2>
          {status && (
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Spinner size={11} /> {status}
            </span>
          )}
          <Button
            size="sm"
            className="ml-auto"
            variant={summary ? "secondary" : "primary"}
            onClick={generate}
            disabled={status !== null || meeting.transcript.length === 0}
          >
            <RefreshCw size={12} /> {summary ? "Refazer" : "Gerar resumo"}
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {error && <p className="mb-3 text-sm text-rose-300">{error}</p>}
          {summary ? (
            <Markdown text={summary} />
          ) : (
            <EmptyState icon={<ListChecks size={18} />} title={meeting.transcript.length ? "Sem resumo ainda" : "Reuniao sem transcricao"}>
              {meeting.transcript.length
                ? "Gere o resumo com decisoes, proximos passos e um e-mail de follow-up."
                : "Inicie a escuta na aba Ao vivo para registrar a conversa."}
            </EmptyState>
          )}
        </div>
      </Card>

      <div className="space-y-5">
        <Card className="grid grid-cols-3 divide-x divide-ink-700/70 text-center">
          <Stat label="Duracao" value={meeting.startedAt ? formatDuration(meeting.startedAt, meeting.endedAt) : "-"} />
          <Stat label="Falas" value={String(meeting.transcript.length)} />
          <Stat label="Respostas" value={String(meeting.answers.length)} />
        </Card>

        <Card className="flex max-h-[420px] flex-col">
          <h3 className="flex items-center gap-2 border-b border-ink-700/70 px-5 py-3 text-sm font-semibold">
            <Users size={14} className="text-zinc-500" /> Transcricao
            {meeting.startedAt && <span className="ml-auto text-[11px] font-normal text-zinc-500">{formatDate(meeting.startedAt)}</span>}
          </h3>
          <div className="space-y-2 overflow-y-auto px-5 py-3 text-[13px] leading-relaxed">
            {meeting.transcript.length === 0 && <p className="text-zinc-600">Nada registrado.</p>}
            {meeting.transcript.map((l, i) => (
              <p key={i} className="text-zinc-300">
                <span className={`mr-1.5 text-[11px] font-semibold uppercase ${l.speaker === "cliente" ? "text-sky-400" : "text-amber-400"}`}>
                  {l.speaker === "cliente" ? "Cliente" : "Voce"}
                </span>
                {l.text}
              </p>
            ))}
          </div>
        </Card>

        <Card className="flex max-h-[420px] flex-col">
          <h3 className="flex items-center gap-2 border-b border-ink-700/70 px-5 py-3 text-sm font-semibold">
            <MessageSquare size={14} className="text-zinc-500" /> Respostas do copiloto
          </h3>
          <div className="space-y-2 overflow-y-auto p-3">
            {meeting.answers.length === 0 && <p className="px-2 text-[13px] text-zinc-600">Nenhuma resposta.</p>}
            {[...meeting.answers].reverse().map((a) => (
              <details key={a.id} className="rounded-lg border border-ink-700/70 bg-ink-950/40 px-3 py-2">
                <summary className="flex cursor-pointer items-center gap-2 text-[13px] text-zinc-300">
                  <Badge tone={a.mode === "deep" ? "violet" : "emerald"}>{a.mode === "deep" ? "Profundo" : "Rapido"}</Badge>
                  <span className="truncate">{a.question ?? a.text.split("\n")[0].replace(/\*\*/g, "")}</span>
                </summary>
                <div className="mt-2">
                  <Markdown text={a.text} />
                </div>
              </details>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-4">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
    </div>
  );
}
