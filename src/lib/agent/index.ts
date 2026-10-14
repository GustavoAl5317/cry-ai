import "server-only";
import { getVectorStoreId } from "../docs";
import { llmProvider } from "../providers";
import { getDoc, getSettings } from "../store";
import type { AgentEvent, AnswerMode, McpServer, Meeting } from "../types";
import { runClaude } from "./claude";
import { runOpenAI } from "./openai";
import { buildInstructions } from "./prompts";

export type AgentKind = "answer" | "briefing" | "summary";

export type AgentPlan = {
  effort: "low" | "medium" | "high";
  maxTokens: number;
  instructions: string;
  input: string;
  /** Vector store and doc ids to search, when the meeting has documents. */
  docs?: { vectorStoreId: string; docIds: string[] };
  web: boolean;
  mcp: McpServer[];
};

function settingsFor(kind: AgentKind, mode: AnswerMode) {
  if (kind === "summary") return { effort: "low" as const, maxTokens: 6000, tools: false };
  if (kind === "briefing") return { effort: "medium" as const, maxTokens: 16000, tools: true };
  if (mode === "deep") return { effort: "medium" as const, maxTokens: 16000, tools: true };
  return { effort: "low" as const, maxTokens: 3000, tools: false };
}

async function readyDocIds(meeting: Meeting): Promise<string[]> {
  const docs = await Promise.all(meeting.docIds.map(getDoc));
  return docs.filter((d) => d?.status === "ready").map((d) => d!.id);
}

/** Decides model effort and tools for a request, then streams the provider's events. */
export async function* runAgent(
  kind: AgentKind,
  mode: AnswerMode,
  meeting: Meeting | null,
  input: string,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const provider = llmProvider();
  if (!provider) {
    yield { t: "error", text: "Configure OPENAI_API_KEY ou ANTHROPIC_API_KEY em .env.local" };
    return;
  }

  const { effort, maxTokens, tools } = settingsFor(kind, mode);

  // Documents and MCP run through OpenAI's hosted tools.
  let docs: AgentPlan["docs"];
  let mcp: McpServer[] = [];
  if (provider === "openai" && meeting && kind !== "summary") {
    const vectorStoreId = await getVectorStoreId();
    const docIds = await readyDocIds(meeting);
    if (vectorStoreId && docIds.length) docs = { vectorStoreId, docIds };
    if (tools) {
      const { mcpServers } = await getSettings();
      mcp = mcpServers.filter((s) => s.enabled && meeting.mcpServerIds.includes(s.id));
    }
  }

  const plan: AgentPlan = {
    effort,
    maxTokens,
    input,
    docs,
    web: tools,
    mcp,
    instructions: buildInstructions(meeting, {
      docs: Boolean(docs),
      web: tools,
      mcp: mcp.map((s) => s.label),
    }),
  };

  yield* provider === "openai" ? runOpenAI(plan, signal) : runClaude(plan, signal);
}

/** Wraps agent events as an NDJSON response; `onDone` gets the full text. */
export function ndjson(
  events: AsyncGenerator<AgentEvent>,
  abort: AbortController,
  onDone?: (text: string) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      let text = "";
      try {
        for await (const event of events) {
          if (event.t === "delta") text += event.text;
          send(event);
        }
        if (onDone && text.trim()) await onDone(text);
        send({ t: "done" });
      } catch (err) {
        if (!abort.signal.aborted) send({ t: "error", text: err instanceof Error ? err.message : String(err) });
      }
      controller.close();
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
