import "server-only";
import OpenAI from "openai";
import { mcpErrorText, mcpTool, serverLabel } from "../mcp";
import type { AgentEvent } from "../types";
import type { AgentPlan } from "./index";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.5";

// Created on first use: the constructor throws when OPENAI_API_KEY is unset.
let client: OpenAI | undefined;

function buildTools(plan: AgentPlan): OpenAI.Responses.Tool[] {
  const tools: OpenAI.Responses.Tool[] = [];
  if (plan.docs) {
    tools.push({
      type: "file_search",
      vector_store_ids: [plan.docs.vectorStoreId],
      filters: { type: "in", key: "doc_id", value: plan.docs.docIds },
      max_num_results: 8,
    });
  }
  if (plan.web) tools.push({ type: "web_search" });
  tools.push(...plan.mcp.map(mcpTool));
  return tools;
}

function describe(err: unknown, plan: AgentPlan): string {
  const mcp = mcpErrorText(err, plan.mcp);
  if (mcp) return mcp;
  if (err instanceof OpenAI.AuthenticationError) return "OPENAI_API_KEY invalida ou ausente.";
  if (err instanceof OpenAI.RateLimitError) return "Limite ou credito da OpenAI atingido.";
  if (err instanceof OpenAI.APIError) return `OpenAI ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export async function* runOpenAI(plan: AgentPlan, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  client ??= new OpenAI();
  const mcpNames = new Map(plan.mcp.map((s) => [serverLabel(s.label), s.label]));

  let stream;
  try {
    stream = await client.responses.create(
      {
        model: MODEL,
        instructions: plan.instructions,
        input: plan.input,
        reasoning: { effort: plan.effort },
        max_output_tokens: plan.maxTokens,
        tools: buildTools(plan),
        stream: true,
      },
      { signal },
    );
  } catch (err) {
    yield { t: "error", text: describe(err, plan) };
    return;
  }

  try {
    for await (const event of stream) {
      switch (event.type) {
        case "response.output_text.delta":
          yield { t: "delta", text: event.delta };
          break;
        case "response.output_item.added": {
          const item = event.item;
          if (item.type === "web_search_call") yield { t: "status", text: "Pesquisando na web" };
          else if (item.type === "file_search_call") yield { t: "status", text: "Lendo seus documentos" };
          else if (item.type === "mcp_list_tools")
            yield { t: "status", text: `Conectando a ${mcpNames.get(item.server_label) ?? item.server_label}` };
          else if (item.type === "mcp_call")
            yield { t: "status", text: `${mcpNames.get(item.server_label) ?? item.server_label}: ${item.name}` };
          else if (item.type === "reasoning") yield { t: "status", text: "Pensando" };
          break;
        }
        case "response.failed":
          yield { t: "error", text: event.response.error?.message ?? "A OpenAI nao conseguiu responder" };
          break;
        case "response.mcp_call.failed":
          yield { t: "status", text: "Uma consulta ao sistema conectado falhou" };
          break;
        case "error":
          yield { t: "error", text: event.message };
          break;
      }
    }
  } catch (err) {
    if (!signal.aborted) yield { t: "error", text: describe(err, plan) };
  }
}
