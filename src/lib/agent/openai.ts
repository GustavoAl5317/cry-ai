import "server-only";
import OpenAI from "openai";
import type { AgentEvent } from "../types";
import type { AgentPlan } from "./index";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.5";

// Created on first use: the constructor throws when OPENAI_API_KEY is unset.
let client: OpenAI | undefined;

const label = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "mcp";

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
  for (const server of plan.mcp) {
    tools.push({
      type: "mcp",
      server_label: label(server.label),
      server_description: server.description,
      ...(server.connectorId
        ? { connector_id: server.connectorId as "connector_googledrive" }
        : { server_url: server.url }),
      ...(server.token && { authorization: server.token }),
      require_approval: "never",
    });
  }
  return tools;
}

function describe(errorMessage: unknown): string {
  if (errorMessage instanceof OpenAI.AuthenticationError) return "OPENAI_API_KEY invalida ou ausente.";
  if (errorMessage instanceof OpenAI.RateLimitError) return "Limite ou credito da OpenAI atingido.";
  if (errorMessage instanceof OpenAI.APIError) return `OpenAI ${errorMessage.status}: ${errorMessage.message}`;
  return errorMessage instanceof Error ? errorMessage.message : String(errorMessage);
}

export async function* runOpenAI(plan: AgentPlan, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  client ??= new OpenAI();
  const mcpNames = new Map(plan.mcp.map((s) => [label(s.label), s.label]));

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
    yield { t: "error", text: describe(err) };
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
        case "error":
          yield { t: "error", text: event.message };
          break;
      }
    }
  } catch (err) {
    if (!signal.aborted) yield { t: "error", text: describe(err) };
  }
}
