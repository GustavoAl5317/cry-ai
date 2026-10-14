"use client";

import {
  Brain,
  Check,
  Copy,
  EyeOff,
  Mic,
  MicOff,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Send,
  Sparkles,
  Square,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { api, streamAgent } from "@/lib/client";
import { startTranscriber, type LiveTranscriber, type TranscriptEvent } from "@/lib/stt";
import type { AnswerMode, AnswerRecord, Meeting, Speaker, TranscriptLine } from "@/lib/types";
import { Markdown } from "./Markdown";
import { Badge, Button, EmptyState, Spinner } from "./ui";

type Segment = { id: number; speaker: Speaker; text: string };
type Answer = AnswerRecord & { done: boolean; status?: string; hidden?: boolean };

type DocumentPictureInPicture = {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
};

const SKIP = "SKIP";
const DEEP = "DEEP";
const MIN_WORDS_FOR_AUTO = 4;

const LANGUAGES = [
  { value: "pt-BR", label: "PT-BR" },
  { value: "multi", label: "Multi" },
  { value: "en", label: "EN" },
  { value: "es", label: "ES" },
];

const noopSubscribe = () => () => {};
const isDesktopApp = () => navigator.userAgent.includes("Electron");
const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const clock = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function copyStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.createElement("style");
      style.textContent = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
      target.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.head.appendChild(link);
      }
    }
  }
}

/** Could the streamed text still turn out to be one of the control words? */
const mayBeControl = (text: string) => {
  const t = text.trim();
  return SKIP.startsWith(t) || DEEP.startsWith(t);
};

export function LivePanel({
  meeting,
  onStart,
  onEnd,
}: {
  meeting: Meeting;
  onStart: () => void;
  onEnd: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [language, setLanguage] = useState("pt-BR");
  const [useMic, setUseMic] = useState(true);
  const [autoMode, setAutoMode] = useState(true);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [interim, setInterim] = useState<Record<Speaker, string>>({ cliente: "", voce: "" });
  const [answers, setAnswers] = useState<Answer[]>(() =>
    [...meeting.answers].reverse().map((a) => ({ ...a, done: true })),
  );
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const desktop = useSyncExternalStore(noopSubscribe, isDesktopApp, () => false);

  const segmentsRef = useRef<Segment[]>([]);
  const openSegment = useRef<Record<Speaker, number | null>>({ cliente: null, voce: null });
  const pendingClientText = useRef("");
  const transcribers = useRef<LiveTranscriber[]>([]);
  const streams = useRef<MediaStream[]>([]);
  const inFlight = useRef<AbortController | null>(null);
  const autoQueued = useRef(false);
  const autoModeRef = useRef(autoMode);
  const nextId = useRef(1);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  // Lets a finished answer trigger the next one (escalation, queued auto answers).
  const requestAnswerRef = useRef<(mode: AnswerMode, question?: string) => Promise<void>>(async () => {});
  const meetingId = meeting.id;

  useEffect(() => {
    autoModeRef.current = autoMode;
  }, [autoMode]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "end" });
  }, [segments, interim]);

  const updateSegments = useCallback((next: Segment[]) => {
    segmentsRef.current = next;
    setSegments(next);
  }, []);

  const log = useCallback(
    (body: { lines?: TranscriptLine[]; answer?: AnswerRecord; event?: "start" | "end" }) => {
      void api(`/api/meetings/${meetingId}/log`, "POST", body).catch(() => {});
    },
    [meetingId],
  );

  /** Saves a finished utterance to the meeting history. */
  const closeSegment = useCallback(
    (speaker: Speaker) => {
      const id = openSegment.current[speaker];
      openSegment.current[speaker] = null;
      const seg = segmentsRef.current.find((s) => s.id === id);
      if (seg) log({ lines: [{ speaker, text: seg.text, at: new Date().toISOString() }] });
    },
    [log],
  );

  const setAnswer = useCallback((answer: Answer) => {
    setAnswers((prev) =>
      prev.some((a) => a.id === answer.id) ? prev.map((a) => (a.id === answer.id ? answer : a)) : [answer, ...prev],
    );
  }, []);

  const requestAnswer = useCallback(
    async (mode: AnswerMode, typedQuestion?: string) => {
      if (inFlight.current) {
        if (mode === "auto") {
          autoQueued.current = true;
          return;
        }
        inFlight.current.abort();
      }
      const controller = new AbortController();
      inFlight.current = controller;
      pendingClientText.current = "";
      setBusy(true);

      let answer: Answer = {
        id: `${Date.now()}`,
        mode,
        question: typedQuestion,
        text: "",
        at: new Date().toISOString(),
        done: false,
        hidden: mode === "auto",
        status: "Pensando",
      };
      if (!answer.hidden) setAnswer(answer);
      let escalate = false;

      try {
        const text = await streamAgent(
          "/api/answer",
          {
            meetingId,
            mode,
            question: typedQuestion,
            transcript: segmentsRef.current.map(({ speaker, text }) => ({ speaker, text })),
          },
          {
            signal: controller.signal,
            onStatus: (status) => {
              answer = { ...answer, status };
              if (!answer.hidden) setAnswer(answer);
            },
            onText: (full) => {
              // Auto answers stay hidden until they cannot be SKIP or DEEP.
              const hidden = mode !== "deep" && mayBeControl(full);
              answer = { ...answer, text: full, hidden, status: undefined };
              if (!hidden) setAnswer(answer);
            },
          },
        );
        const t = text.trim();
        if ((mode === "auto" && t === SKIP) || (mode !== "deep" && t === DEEP)) {
          escalate = t === DEEP;
          // A quick answer showed a placeholder card; the deep answer replaces it.
          setAnswers((prev) => prev.filter((a) => a.id !== answer.id));
        } else {
          answer = { ...answer, text, done: true, hidden: false, status: undefined };
          setAnswer(answer);
          log({ answer: { id: answer.id, mode, question: typedQuestion, text, at: answer.at } });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          answer = { ...answer, done: true, hidden: false, status: undefined, text: `> Erro: ${(err as Error).message}` };
          setAnswer(answer);
        } else if (answer.text) {
          setAnswer({ ...answer, done: true, status: undefined });
        }
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          setBusy(false);
        }
      }

      if (inFlight.current) return;
      if (escalate) {
        void requestAnswerRef.current("deep");
      } else if (autoQueued.current) {
        autoQueued.current = false;
        if (autoModeRef.current && countWords(pendingClientText.current) >= MIN_WORDS_FOR_AUTO) {
          void requestAnswerRef.current("auto");
        }
      }
    },
    [log, meetingId, setAnswer],
  );
  useEffect(() => {
    requestAnswerRef.current = requestAnswer;
  }, [requestAnswer]);

  const handleEvent = useCallback(
    (speaker: Speaker, event: TranscriptEvent) => {
      if (event.kind === "interim") {
        setInterim((prev) => ({ ...prev, [speaker]: event.text }));
        return;
      }
      if (event.kind === "final") {
        const openId = openSegment.current[speaker];
        const current = segmentsRef.current;
        const last = current[current.length - 1];
        // Providers finalize long utterances in pieces; glue them while the same person talks.
        if (openId !== null && last?.id === openId) {
          updateSegments(current.map((s) => (s.id === openId ? { ...s, text: `${s.text} ${event.text}` } : s)));
        } else {
          if (openId !== null) closeSegment(speaker);
          const id = nextId.current++;
          openSegment.current[speaker] = id;
          updateSegments([...current, { id, speaker, text: event.text }]);
        }
        setInterim((prev) => ({ ...prev, [speaker]: "" }));
        if (speaker === "cliente") pendingClientText.current = `${pendingClientText.current} ${event.text}`;
        if (!event.speechFinal) return;
      }
      closeSegment(speaker);
      if (speaker === "cliente" && autoModeRef.current && countWords(pendingClientText.current) >= MIN_WORDS_FOR_AUTO) {
        void requestAnswer("auto");
      }
    },
    [closeSegment, requestAnswer, updateSegments],
  );

  const stop = useCallback(() => {
    const wasRunning = transcribers.current.length > 0;
    transcribers.current.forEach((t) => t.stop());
    transcribers.current = [];
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    closeSegment("cliente");
    closeSegment("voce");
    setInterim({ cliente: "", voce: "" });
    setRunning(false);
    if (wasRunning) {
      log({ event: "end" });
      onEnd();
    }
  }, [closeSegment, log, onEnd]);

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      const options: DisplayMediaStreamOptions & { systemAudio?: "include" | "exclude" } = {
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: "include",
      };
      const display = await navigator.mediaDevices.getDisplayMedia(options);
      streams.current.push(display);
      const [meetingTrack] = display.getAudioTracks();
      if (!meetingTrack) {
        throw new Error(
          'Nenhum audio foi compartilhado. Marque "Compartilhar audio do sistema" (tela inteira) ou "Compartilhar audio da guia" (Meet no navegador). No app desktop isso e automatico.',
        );
      }
      meetingTrack.addEventListener("ended", stop);
      const onError = (message: string) => setError(message);
      transcribers.current.push(
        await startTranscriber({
          stream: display,
          language,
          source: "meeting",
          onEvent: (e) => handleEvent("cliente", e),
          onError,
        }),
      );
      if (useMic) {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        streams.current.push(mic);
        transcribers.current.push(
          await startTranscriber({
            stream: mic,
            language,
            source: "mic",
            onEvent: (e) => handleEvent("voce", e),
            onError,
          }),
        );
      }
      setRunning(true);
      log({ event: "start" });
      onStart();
    } catch (err) {
      stop();
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Permissao de captura negada."
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setStarting(false);
    }
  }, [handleEvent, language, log, onStart, stop, useMic]);

  // Stop capture if the workspace unmounts mid-meeting.
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);
  useEffect(() => () => stopRef.current(), []);

  // Global shortcut from the desktop app.
  useEffect(() => {
    const onAnswerNow = () => void requestAnswer("quick");
    window.addEventListener("copilot:answer-now", onAnswerNow);
    return () => window.removeEventListener("copilot:answer-now", onAnswerNow);
  }, [requestAnswer]);

  const openFloating = useCallback(async () => {
    const pip = (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture;
    if (!pip) {
      setError("Janela flutuante exige Chrome ou Edge atualizado.");
      return;
    }
    const win = await pip.requestWindow({ width: 440, height: 680 });
    copyStyles(win.document);
    win.document.documentElement.className = document.documentElement.className;
    win.document.body.className = document.body.className;
    win.document.title = "Copiloto";
    win.addEventListener("pagehide", () => setPipWindow(null));
    setPipWindow(win);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    void requestAnswer("deep", q);
    setQuestion("");
  };

  const visible = answers.filter((a) => !a.hidden);
  const feed = (
    <AnswerFeed
      answers={visible}
      busy={busy}
      running={running}
      onDeepen={(a) => void requestAnswer("deep", a.question ?? `Aprofunde: ${a.text.split("\n")[0].replace(/\*\*/g, "")}`)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-700/70 px-4 py-2.5">
        {running ? (
          <Button variant="danger" size="sm" onClick={stop}>
            <Square size={12} fill="currentColor" /> Encerrar
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={start} disabled={starting}>
            {starting ? <Spinner size={12} /> : <Play size={12} fill="currentColor" />}
            {meeting.startedAt ? "Retomar escuta" : "Iniciar escuta"}
          </Button>
        )}
        {running && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-300">
            <span className="live-dot h-2 w-2 rounded-full bg-emerald-400" /> Ouvindo
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Toggle on={useMic} disabled={running} onClick={() => setUseMic(!useMic)} title="Transcrever meu microfone">
            {useMic ? <Mic size={13} /> : <MicOff size={13} />}
          </Toggle>
          <Toggle on={autoMode} onClick={() => setAutoMode(!autoMode)} title="Responder automaticamente">
            <Zap size={13} /> Auto
          </Toggle>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={running}
            className="h-7 rounded-md border border-ink-700 bg-ink-850 px-1.5 text-xs text-zinc-300 disabled:opacity-50"
            title="Idioma da transcricao"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          {!desktop && (
            <Toggle on={pipWindow !== null} onClick={openFloating} title="Janela flutuante">
              <Sparkles size={13} />
            </Toggle>
          )}
          <Toggle on={showTranscript} onClick={() => setShowTranscript(!showTranscript)} title="Mostrar transcricao">
            {showTranscript ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
          </Toggle>
        </div>
      </div>

      {desktop && (
        <p className="flex items-center gap-1.5 border-b border-ink-700/70 bg-ink-900 px-4 py-1 text-[11px] text-zinc-500">
          <EyeOff size={11} /> Invisivel no compartilhamento de tela. Ctrl+Alt+Espaco responde, Ctrl+Alt+H esconde.
        </p>
      )}

      {error && (
        <div className="flex items-start justify-between gap-3 border-b border-rose-500/20 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">
            fechar
          </button>
        </div>
      )}

      <div
        className={`grid min-h-0 flex-1 ${
          showTranscript ? "grid-rows-[1fr_auto] lg:grid-cols-[1fr_340px] lg:grid-rows-1" : "grid-rows-1"
        }`}
      >
        <section className="min-h-0 overflow-y-auto">
          {pipWindow ? (
            <EmptyState icon={<Sparkles size={18} />} title="Respostas na janela flutuante">
              Feche a janela flutuante para voltar a ve-las aqui.
            </EmptyState>
          ) : (
            feed
          )}
        </section>

        {showTranscript && (
          <aside className="flex max-h-48 min-h-0 flex-col border-t border-ink-700/70 bg-ink-900/50 lg:max-h-none lg:border-l lg:border-t-0">
            <h3 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Transcricao</h3>
            <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-3 text-[13px] leading-relaxed">
              {segments.length === 0 && !interim.cliente && !interim.voce && (
                <p className="text-zinc-600">{running ? "Ouvindo..." : "A transcricao aparece aqui."}</p>
              )}
              {segments.map((s) => (
                <Line key={s.id} speaker={s.speaker} text={s.text} />
              ))}
              {(["cliente", "voce"] as const).map(
                (sp) => interim[sp] && <Line key={sp} speaker={sp} text={interim[sp]} interim />,
              )}
              <div ref={transcriptEnd} />
            </div>
          </aside>
        )}
      </div>

      {/* Composer */}
      <form onSubmit={submit} className="border-t border-ink-700/70 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-ink-700 bg-ink-900 p-1.5 focus-within:border-violet-500/50">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) submit(e);
            }}
            rows={1}
            placeholder="Pergunte, peca codigo, pesquise..."
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-zinc-600"
          />
          <Button type="button" size="sm" variant="ghost" onClick={() => void requestAnswer("quick")} title="Resposta rapida para a ultima fala">
            <Zap size={13} /> Rapido
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void requestAnswer("deep")} title="Pesquisa, documentos e codigo para a ultima fala">
            <Brain size={13} /> Profundo
          </Button>
          <Button size="sm" variant="ai" disabled={!question.trim()} aria-label="Enviar">
            <Send size={13} />
          </Button>
        </div>
      </form>

      {pipWindow &&
        createPortal(
          <div className="h-dvh overflow-y-auto bg-ink-950 text-zinc-100">{feed}</div>,
          pipWindow.document.body,
        )}
    </div>
  );
}

function Toggle({
  on,
  children,
  ...props
}: React.ComponentProps<"button"> & { on: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition disabled:opacity-50 ${
        on
          ? "border-violet-500/40 bg-violet-500/10 text-violet-200"
          : "border-ink-700 bg-ink-850 text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

function Line({ speaker, text, interim }: { speaker: Speaker; text: string; interim?: boolean }) {
  return (
    <p className={interim ? "italic text-zinc-500" : "text-zinc-300"}>
      <span className={`mr-1.5 text-[11px] font-semibold uppercase ${speaker === "cliente" ? "text-sky-400" : "text-amber-400"}`}>
        {speaker === "cliente" ? "Cliente" : "Voce"}
      </span>
      {text}
    </p>
  );
}

const MODE_BADGE: Record<AnswerMode, { tone: "emerald" | "sky" | "violet"; label: string; icon: React.ReactNode }> = {
  auto: { tone: "emerald", label: "Auto", icon: <Zap size={10} /> },
  quick: { tone: "sky", label: "Rapido", icon: <Zap size={10} /> },
  deep: { tone: "violet", label: "Profundo", icon: <Brain size={10} /> },
};

function AnswerFeed({
  answers,
  busy,
  running,
  onDeepen,
}: {
  answers: Answer[];
  busy: boolean;
  running: boolean;
  onDeepen: (a: Answer) => void;
}) {
  if (answers.length === 0) {
    return busy ? (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
        <Spinner /> Analisando a conversa...
      </div>
    ) : (
      <EmptyState icon={<Sparkles size={18} />} title={running ? "Ouvindo o cliente" : "Pronto para a reuniao"}>
        Quando o cliente perguntar algo, citar um termo ou pedir codigo, a resposta aparece aqui. Use Profundo para
        pesquisar na web, nos seus documentos e sistemas.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-3 p-4">
      {answers.map((a, i) => (
        <AnswerCard key={a.id} answer={a} latest={i === 0} onDeepen={() => onDeepen(a)} />
      ))}
    </div>
  );
}

function AnswerCard({ answer, latest, onDeepen }: { answer: Answer; latest: boolean; onDeepen: () => void }) {
  const [copied, setCopied] = useState(false);
  const badge = MODE_BADGE[answer.mode];
  const time = new Date(answer.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <article
      className={`rounded-2xl border p-4 transition ${
        latest
          ? answer.mode === "deep"
            ? "border-violet-500/40 bg-gradient-to-b from-violet-500/[0.07] to-ink-900 shadow-lg shadow-violet-950/20"
            : "border-emerald-500/30 bg-gradient-to-b from-emerald-500/[0.06] to-ink-900 shadow-lg shadow-emerald-950/20"
          : "border-ink-700 bg-ink-900/60"
      }`}
    >
      <header className="mb-2.5 flex items-center gap-2">
        <Badge tone={badge.tone}>
          {badge.icon} {answer.question ? "Sua pergunta" : badge.label}
        </Badge>
        {answer.status && (
          <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Spinner size={11} /> {answer.status}
          </span>
        )}
        <span className="ml-auto text-[11px] text-zinc-600">{time || clock()}</span>
      </header>
      {answer.question && <p className="mb-2 text-xs text-zinc-500">&ldquo;{answer.question}&rdquo;</p>}
      {answer.text ? <Markdown text={answer.text} /> : !answer.status && <Spinner />}
      {answer.done && answer.text && (
        <footer className="mt-3 flex gap-1 border-t border-ink-700/60 pt-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await navigator.clipboard.writeText(answer.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copiado" : "Copiar"}
          </Button>
          {answer.mode !== "deep" && (
            <Button size="sm" variant="ghost" onClick={onDeepen}>
              <Brain size={12} /> Aprofundar
            </Button>
          )}
        </footer>
      )}
    </article>
  );
}
