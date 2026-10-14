import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent } from "../types";
import type { AgentPlan } from "./index";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
const MAX_CONTINUATIONS = 3;

let client: Anthropic | undefined;

function describe(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "ANTHROPIC_API_KEY invalida ou ausente.";
  if (err instanceof Anthropic.RateLimitError) return "Limite de requisicoes da Anthropic atingido.";
  if (err instanceof Anthropic.APIError) return `Anthropic ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/** Claude path: same prompts, with web search in deep mode. Documents and MCP are OpenAI-only here. */
export async function* runClaude(plan: AgentPlan, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  client ??= new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: plan.input }];

  try {
    // Server tools can pause a long turn; resend to let it continue.
    for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: plan.maxTokens,
          output_config: { effort: plan.effort },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: plan.instructions,
          messages,
          ...(plan.web && { tools: [{ type: "web_search_20260209", name: "web_search" }] }),
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
          yield { t: "status", text: "Pesquisando na web" };
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { t: "delta", text: event.delta.text };
        }
      }

      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        yield { t: "delta", text: "\n\n_(O modelo recusou responder.)_" };
        return;
      }
      if (final.stop_reason !== "pause_turn") return;
      messages.push({ role: "assistant", content: final.content });
    }
  } catch (err) {
    if (!signal.aborted) yield { t: "error", text: describe(err) };
  }
}
