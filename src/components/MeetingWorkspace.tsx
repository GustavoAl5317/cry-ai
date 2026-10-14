"use client";

import { ArrowLeft, ListChecks, Radio, WandSparkles } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Doc, Meeting } from "@/lib/types";
import { LivePanel } from "./LivePanel";
import { PrepPanel } from "./PrepPanel";
import { SummaryPanel } from "./SummaryPanel";
import { Button, Spinner } from "./ui";

type Tab = "prep" | "live" | "summary";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "prep", label: "Preparar", icon: <WandSparkles size={13} /> },
  { id: "live", label: "Ao vivo", icon: <Radio size={13} /> },
  { id: "summary", label: "Resumo", icon: <ListChecks size={13} /> },
];

export function MeetingWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [tab, setTab] = useState<Tab>("prep");
  const [live, setLive] = useState(false);
  const [justEnded, setJustEnded] = useState(false);
  const [summaryKey, setSummaryKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ meeting: Meeting; docs: Doc[] }>(`/api/meetings/${id}`);
    setMeeting(data.meeting);
    setDocs(data.docs);
    return data.meeting;
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    api<{ meeting: Meeting; docs: Doc[] }>(`/api/meetings/${id}`)
      .then(({ meeting: m, docs: d }) => {
        if (cancelled) return;
        setMeeting(m);
        setDocs(d);
        setTab(m.endedAt ? "summary" : m.startedAt ? "live" : "prep");
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const patch = useCallback(
    async (change: Partial<Meeting>) => {
      setMeeting((m) => (m ? { ...m, ...change } : m));
      try {
        await api(`/api/meetings/${id}`, "PATCH", change);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [id],
  );

  const openSummary = useCallback(async () => {
    await load();
    setSummaryKey((k) => k + 1);
    setTab("summary");
  }, [load]);

  const onStart = useCallback(() => {
    setLive(true);
    setJustEnded(false);
  }, []);

  const onEnd = useCallback(() => {
    setLive(false);
    setJustEnded(true);
    void openSummary();
  }, [openSummary]);

  const onSummary = useCallback((summary: string) => {
    setMeeting((m) => (m ? { ...m, summary } : m));
  }, []);

  if (error && !meeting) {
    return (
      <div className="grid h-dvh place-items-center p-6 text-center">
        <div className="space-y-3">
          <p className="text-sm text-rose-300">{error}</p>
          <Link href="/" className="text-sm text-violet-300">
            Voltar
          </Link>
        </div>
      </div>
    );
  }
  if (!meeting) {
    return (
      <div className="grid h-dvh place-items-center text-zinc-500">
        <Spinner size={20} />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-700/70 bg-ink-950/90 px-3 py-2 backdrop-blur sm:px-4">
        <Link href="/">
          <Button variant="ghost" size="sm" aria-label="Voltar">
            <ArrowLeft size={14} />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{meeting.title}</p>
          {meeting.client && <p className="truncate text-[11px] text-zinc-500">{meeting.client}</p>}
        </div>
        <nav className="flex rounded-lg border border-ink-700 bg-ink-900 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => (t.id === "summary" ? void openSummary() : setTab(t.id))}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition ${
                tab === t.id ? "bg-ink-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.id === "live" && live ? <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" /> : t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {error && (
        <p className="border-b border-rose-500/20 bg-rose-500/10 px-4 py-1.5 text-xs text-rose-200" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1">
        <div className={tab === "prep" ? "h-full overflow-y-auto" : "hidden"}>
          <PrepPanel meeting={meeting} docs={docs} onPatch={patch} onDocs={setDocs} onStartLive={() => setTab("live")} />
        </div>
        {/* Kept mounted so listening continues while you look at other tabs. */}
        <div className={tab === "live" ? "h-full" : "hidden"}>
          <LivePanel meeting={meeting} onStart={onStart} onEnd={onEnd} />
        </div>
        {tab === "summary" && (
          <div className="h-full overflow-y-auto">
            <SummaryPanel key={summaryKey} meeting={meeting} autoGenerate={justEnded} onSummary={onSummary} />
          </div>
        )}
      </div>
    </div>
  );
}
