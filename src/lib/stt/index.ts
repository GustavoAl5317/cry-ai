import { startDeepgram } from "./deepgram";
import { startOpenAI } from "./openai";
import type { LiveTranscriber, TranscriberOptions } from "./types";

export type { LiveTranscriber, TranscriptEvent } from "./types";

/** Gets a short-lived token from the server and starts the matching provider. */
export async function startTranscriber(options: TranscriberOptions): Promise<LiveTranscriber> {
  const res = await fetch("/api/stt-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: options.language, source: options.source }),
  });
  const data = (await res.json()) as { provider?: string; token?: string; error?: string };
  if (!res.ok || !data.token) {
    throw new Error(data.error ?? "Falha ao obter token de transcricao");
  }
  return data.provider === "openai"
    ? startOpenAI(data.token, options)
    : startDeepgram(data.token, options);
}
