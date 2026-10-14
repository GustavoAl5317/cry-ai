import type { AgentEvent } from "./types";

export async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Falha (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

type StreamHandlers = {
  onStatus?: (text: string) => void;
  onText?: (fullText: string) => void;
  signal?: AbortSignal;
};

/** Posts to an agent route and replays its NDJSON events; resolves with the final text. */
export async function streamAgent(url: string, body: unknown, handlers: StreamHandlers = {}): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: handlers.signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Falha (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let error: string | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as AgentEvent;
      if (event.t === "delta") {
        text += event.text;
        handlers.onText?.(text);
      } else if (event.t === "status") {
        handlers.onStatus?.(event.text);
      } else if (event.t === "error") {
        error = event.text;
      }
    }
  }
  if (error && !text) throw new Error(error);
  if (error) {
    text += `\n\n> Erro: ${error}`;
    handlers.onText?.(text);
  }
  return text;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(fromIso: string, toIso?: string) {
  const ms = (toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime();
  const min = Math.max(0, Math.round(ms / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}
