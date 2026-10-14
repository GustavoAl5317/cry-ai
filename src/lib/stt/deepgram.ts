import type { LiveTranscriber, TranscriberOptions } from "./types";

type DeepgramMessage = {
  type: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: { transcript?: string }[] };
};

function pickMimeType(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Streams one audio source to Deepgram and reports transcript events.
 * Deepgram detects the WebM/Opus container itself, so MediaRecorder chunks
 * are sent as-is.
 */
export function startDeepgram(
  token: string,
  { stream, language, onEvent, onError }: TranscriberOptions,
): LiveTranscriber {
  const params = new URLSearchParams({
    model: "nova-3",
    language,
    smart_format: "true",
    punctuate: "true",
    interim_results: "true",
    endpointing: "300",
    utterance_end_ms: "1200",
    vad_events: "true",
  });

  const socket = new WebSocket(
    `wss://api.deepgram.com/v1/listen?${params}`,
    ["bearer", token],
  );

  const audioOnly = new MediaStream(stream.getAudioTracks());
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(audioOnly, mimeType ? { mimeType } : undefined);
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0 && socket.readyState === WebSocket.OPEN) {
      socket.send(e.data);
    }
  };

  socket.onopen = () => {
    recorder.start(250);
    keepAlive = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, 8000);
  };

  socket.onmessage = (msg) => {
    const data = JSON.parse(msg.data as string) as DeepgramMessage;
    if (data.type === "UtteranceEnd") {
      onEvent({ kind: "utterance-end" });
      return;
    }
    if (data.type !== "Results") return;
    const text = data.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
    if (!text) {
      if (data.speech_final) onEvent({ kind: "utterance-end" });
      return;
    }
    if (data.is_final) {
      onEvent({ kind: "final", text, speechFinal: Boolean(data.speech_final) });
    } else {
      onEvent({ kind: "interim", text });
    }
  };

  socket.onerror = () => {
    if (!stopped) onError("Erro na conexao com o Deepgram");
  };

  socket.onclose = (e) => {
    if (!stopped && e.code !== 1000) {
      onError(`Deepgram fechou a conexao (${e.code}${e.reason ? `: ${e.reason}` : ""})`);
    }
  };

  return {
    stop() {
      stopped = true;
      clearInterval(keepAlive);
      if (recorder.state !== "inactive") recorder.stop();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "CloseStream" }));
        socket.close(1000);
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
  };
}
