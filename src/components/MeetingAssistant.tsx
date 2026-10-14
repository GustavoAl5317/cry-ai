"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { startTranscriber, type LiveTranscriber, type TranscriptEvent } from "@/lib/stt";
import { Markdown } from "./Markdown";

type Speaker = "cliente" | "voce";
type Segment = { id: number; speaker: Speaker; text: string };
type Answer = {
  id: number;
  source: "auto" | "manual" | "pergunta";
  text: string;
  done: boolean;
  time: string;
};

type DocumentPictureInPicture = {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
};

const SKIP = "SKIP";
const MIN_WORDS_FOR_AUTO = 4;

const LANGUAGES = [
  { value: "pt-BR", label: "Portugues (BR)" },
  { value: "multi", label: "Multilingue (PT/EN/ES...)" },
  { value: "en", label: "Ingles" },
  { value: "es", label: "Espanhol" },
];

const noopSubscribe = () => () => {};
const isDesktopApp = () => navigator.userAgent.includes("Electron");

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

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

export function MeetingAssistant() {
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [language, setLanguage] = useState("pt-BR");
  const [useMic, setUseMic] = useState(true);
  const [autoMode, setAutoMode] = useState(true);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [interim, setInterim] = useState<Record<Speaker, string>>({ cliente: "", voce: "" });
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [thinking, setThinking] = useState(false);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const desktop = useSyncExternalStore(noopSubscribe, isDesktopApp, () => false);

  const segmentsRef = useRef<Segment[]>([]);
  const openSegment = useRef<Record<Speaker, number | null>>({ cliente: null, voce: null });
  const pendingClientText = useRef("");
  const transcribers = useRef<LiveTranscriber[]>([]);
  const streams = useRef<MediaStream[]>([]);
  const inFlight = useRef<{ controller: AbortController; mode: Answer["source"] } | null>(null);
  const autoQueued = useRef(false);
  const autoModeRef = useRef(autoMode);
  const nextId = useRef(1);
  const transcriptEnd = useRef<HTMLDivElement>(null);

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

  const requestAnswer = useCallback(
    async (mode: Answer["source"], typedQuestion?: string) => {
      if (inFlight.current) {
        // Manual requests win over a running automatic one.
        if (mode === "auto") {
          autoQueued.current = true;
          return;
        }
        inFlight.current.controller.abort();
      }

      const controller = new AbortController();
      inFlight.current = { controller, mode };
      pendingClientText.current = "";
      setThinking(true);

      const id = nextId.current++;
      const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      let text = "";

      const show = (done: boolean) => {
        const card: Answer = { id, source: mode, text, done, time };
        // Insert on first chunk, then update the same card in place.
        setAnswers((prev) =>
          prev.some((a) => a.id === id)
            ? prev.map((a) => (a.id === id ? card : a))
            : [card, ...prev],
        );
      };

      try {
        const res = await fetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            mode: mode === "auto" ? "auto" : "manual",
            question: typedQuestion,
            transcript: segmentsRef.current.map(({ speaker, text }) => ({ speaker, text })),
          }),
        });
        if (!res.ok || !res.body) throw new Error(`Falha ao gerar resposta (${res.status})`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          // In auto mode the model answers "SKIP" when nothing needs help;
          // hold the card back until the text can no longer be that.
          const trimmed = text.trim();
          if (mode === "auto" && SKIP.startsWith(trimmed)) continue;
          show(false);
        }
        if (mode !== "auto" || text.trim() !== SKIP) show(true);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (inFlight.current?.controller === controller) {
          inFlight.current = null;
          setThinking(false);
          if (autoQueued.current) {
            autoQueued.current = false;
            if (autoModeRef.current && countWords(pendingClientText.current) >= MIN_WORDS_FOR_AUTO) {
              void requestAnswer("auto");
            }
          }
        }
      }
    },
    [],
  );

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
        // Deepgram finalizes long utterances in pieces; glue them together
        // while the same person keeps talking.
        if (openId !== null && last?.id === openId) {
          updateSegments(
            current.map((s) => (s.id === openId ? { ...s, text: `${s.text} ${event.text}` } : s)),
          );
        } else {
          const id = nextId.current++;
          openSegment.current[speaker] = id;
          updateSegments([...current, { id, speaker, text: event.text }]);
        }
        setInterim((prev) => ({ ...prev, [speaker]: "" }));
        if (speaker === "cliente") {
          pendingClientText.current = `${pendingClientText.current} ${event.text}`;
        }
        if (!event.speechFinal) return;
      }

      // End of an utterance (speech_final or UtteranceEnd).
      openSegment.current[speaker] = null;
      if (
        speaker === "cliente" &&
        autoModeRef.current &&
        countWords(pendingClientText.current) >= MIN_WORDS_FOR_AUTO
      ) {
        void requestAnswer("auto");
      }
    },
    [requestAnswer, updateSegments],
  );

  const stop = useCallback(() => {
    transcribers.current.forEach((t) => t.stop());
    transcribers.current = [];
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    openSegment.current = { cliente: null, voce: null };
    setInterim({ cliente: "", voce: "" });
    setRunning(false);
  }, []);

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
          'Nenhum audio foi compartilhado. Ao escolher a tela, marque "Compartilhar audio do sistema" (tela inteira) ou "Compartilhar audio da guia" (Google Meet no navegador).',
        );
      }
      // Sharing ends from the browser bar: stop everything.
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
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
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
    } catch (err) {
      stop();
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError("Permissao de captura negada.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setStarting(false);
    }
  }, [handleEvent, language, stop, useMic]);

  useEffect(() => stop, [stop]);

  // The desktop app fires this from a global shortcut.
  useEffect(() => {
    const onAnswerNow = () => void requestAnswer("manual");
    window.addEventListener("copilot:answer-now", onAnswerNow);
    return () => window.removeEventListener("copilot:answer-now", onAnswerNow);
  }, [requestAnswer]);

  const openFloating = useCallback(async () => {
    const pip = (window as Window & { documentPictureInPicture?: DocumentPictureInPicture })
      .documentPictureInPicture;
    if (!pip) {
      setError("Janela flutuante exige Chrome ou Edge atualizado.");
      return;
    }
    const win = await pip.requestWindow({ width: 440, height: 640 });
    copyStyles(win.document);
    win.document.documentElement.className = document.documentElement.className;
    win.document.body.className = document.body.className;
    win.document.title = "Copiloto";
    win.addEventListener("pagehide", () => setPipWindow(null));
    setPipWindow(win);
  }, []);

  const submitQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    void requestAnswer(q ? "pergunta" : "manual", q || undefined);
    setQuestion("");
  };

  const answersPanel = (
    <AnswersPanel
      answers={answers}
      thinking={thinking}
      onAnswerNow={() => void requestAnswer("manual")}
    />
  );

  return (
    <div className="flex h-dvh flex-col bg-neutral-950 text-neutral-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-3">
        <div className="mr-auto flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${running ? "animate-pulse bg-red-500" : "bg-neutral-600"}`}
          />
          <h1 className="text-sm font-semibold tracking-wide">Copiloto de Reuniao</h1>
        </div>

        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          disabled={running}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm disabled:opacity-50"
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={useMic}
            disabled={running}
            onChange={(e) => setUseMic(e.target.checked)}
          />
          Meu microfone
        </label>

        <label className="flex items-center gap-1.5 text-sm text-neutral-300">
          <input type="checkbox" checked={autoMode} onChange={(e) => setAutoMode(e.target.checked)} />
          Responder automatico
        </label>

        {/* The desktop window already floats and is hidden from screen
            capture; a browser pop-out would not be. */}
        {!desktop && (
          <button
            onClick={openFloating}
            disabled={pipWindow !== null}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-50"
          >
            Janela flutuante
          </button>
        )}

        {running ? (
          <button
            onClick={stop}
            className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium hover:bg-red-500"
          >
            Parar
          </button>
        ) : (
          <button
            onClick={start}
            disabled={starting}
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
          >
            {starting ? "Conectando..." : "Iniciar escuta"}
          </button>
        )}
      </header>

      {error && (
        <div className="flex items-start justify-between gap-4 border-b border-red-900 bg-red-950/60 px-4 py-2 text-sm text-red-200">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-300 hover:text-white">
            fechar
          </button>
        </div>
      )}

      {desktop && (
        <p className="border-b border-neutral-800 px-4 py-1.5 text-[11px] text-neutral-500">
          Invisivel ao compartilhar tela. Ctrl+Alt+Espaco responde agora, Ctrl+Alt+H esconde/mostra.
        </p>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[3fr_2fr] lg:grid-cols-[1.3fr_1fr] lg:grid-rows-1">
        <section className="flex min-h-0 flex-col border-neutral-800 lg:border-r">
          {pipWindow ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-neutral-400">
              As respostas estao na janela flutuante. Feche-a para voltar a ve-las aqui.
            </div>
          ) : (
            answersPanel
          )}
        </section>

        <section className="flex min-h-0 flex-col">
          <h2 className="border-b border-neutral-800 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Transcricao ao vivo
          </h2>
          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm">
            {segments.length === 0 && !interim.cliente && !interim.voce && (
              <p className="text-neutral-500">
                {running
                  ? "Ouvindo..."
                  : 'Clique em "Iniciar escuta" e compartilhe a janela ou a tela da reuniao com audio.'}
              </p>
            )}
            {segments.map((s) => (
              <SegmentLine key={s.id} speaker={s.speaker} text={s.text} />
            ))}
            {(["cliente", "voce"] as const).map(
              (sp) => interim[sp] && <SegmentLine key={sp} speaker={sp} text={interim[sp]} interim />,
            )}
            <div ref={transcriptEnd} />
          </div>

          <form onSubmit={submitQuestion} className="flex gap-2 border-t border-neutral-800 p-3">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Pergunte algo ou deixe vazio para responder a ultima fala"
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-emerald-600"
            />
            <button className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-white">
              Enviar
            </button>
          </form>
        </section>
      </main>

      {pipWindow && createPortal(<div className="h-dvh bg-neutral-950 text-neutral-100">{answersPanel}</div>, pipWindow.document.body)}
    </div>
  );
}

function SegmentLine({ speaker, text, interim }: { speaker: Speaker; text: string; interim?: boolean }) {
  return (
    <p className={interim ? "text-neutral-500 italic" : "text-neutral-200"}>
      <span className={`mr-2 font-semibold ${speaker === "cliente" ? "text-sky-400" : "text-amber-400"}`}>
        {speaker === "cliente" ? "Cliente" : "Voce"}
      </span>
      {text}
    </p>
  );
}

function AnswersPanel({
  answers,
  thinking,
  onAnswerNow,
}: {
  answers: Answer[];
  thinking: boolean;
  onAnswerNow: () => void;
}) {
  const sourceLabel: Record<Answer["source"], string> = {
    auto: "automatica",
    manual: "pedida",
    pergunta: "sua pergunta",
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Respostas {thinking && <span className="ml-2 normal-case text-emerald-400">pensando...</span>}
        </h2>
        <button
          onClick={onAnswerNow}
          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
        >
          Responder agora
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {answers.length === 0 && (
          <p className="text-sm text-neutral-500">
            Quando o cliente perguntar algo ou citar um termo que voce talvez nao conheca, a resposta aparece aqui.
          </p>
        )}
        {answers.map((a, i) => (
          <article
            key={a.id}
            className={`rounded-lg border p-4 text-[15px] leading-relaxed ${
              i === 0 ? "border-emerald-700 bg-emerald-950/40" : "border-neutral-800 bg-neutral-900/60 opacity-80"
            }`}
          >
            <div className="mb-2 flex justify-between text-[11px] uppercase tracking-wider text-neutral-500">
              <span>{sourceLabel[a.source]}</span>
              <span>
                {a.time}
                {!a.done && " ..."}
              </span>
            </div>
            <Markdown text={a.text} />
          </article>
        ))}
      </div>
    </div>
  );
}
