import "server-only";
import OpenAI from "openai";
import { updateSettings } from "./store";
import type { McpServer } from "./types";

/** People often paste "Bearer xyz"; OpenAI adds the scheme itself, so keep only the token. */
export function cleanToken(token: string | undefined): string | undefined {
  const t = token?.trim().replace(/^bearer\s+/i, "").trim();
  return t || undefined;
}

export const serverLabel = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "mcp";

// The agent answers on its own while the client talks, so by default it only
// gets tools that read. Few servers annotate readOnlyHint, so go by name:
// any write verb excludes a tool, otherwise a read verb includes it.
const READ = new Set(
  "get search list find read fetch count describe query lookup show view retrieve export download check stats info".split(" "),
);
const WRITE = new Set(
  "create update delete remove add set clear detach attach move rename send revoke invite resend reply forward bulk assign complete start stop close approve reject archive upload edit patch post put cancel mark merge convert import sync transfer execute run write save publish disable enable change replace restore unlink link".split(
    " ",
  ),
);

export function isReadOnlyTool(name: string): boolean {
  const tokens = name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_\-.\s]+/);
  if (tokens.some((t) => WRITE.has(t))) return false;
  return tokens.some((t) => READ.has(t));
}

export function readOnlyTools(server: McpServer): string[] {
  return (server.toolNames ?? []).filter(isReadOnlyTool);
}

export function mcpTool(server: McpServer): OpenAI.Responses.Tool {
  const token = cleanToken(server.token);
  return {
    type: "mcp",
    server_label: serverLabel(server.label),
    server_description: server.description,
    ...(server.connectorId
      ? { connector_id: server.connectorId as "connector_googledrive" }
      : { server_url: server.url }),
    ...(token && { authorization: token }),
    ...(!server.allowWrites && { allowed_tools: readOnlyTools(server) }),
    require_approval: "never",
  };
}

/** Explains the 424 OpenAI returns when it cannot list a server's tools. */
export function mcpErrorText(err: unknown, servers: McpServer[]): string | null {
  if (!(err instanceof OpenAI.APIError) || err.status !== 424) return null;
  const match = /MCP server: '([^']+)'/.exec(err.message);
  const name = servers.find((s) => serverLabel(s.label) === match?.[1])?.label ?? match?.[1] ?? "MCP";
  return `Nao consegui conectar ao ${name}. Confira URL e token em Conexoes MCP (use o botao Testar).`;
}

export type McpTestResult = { ok: true; tools: string[]; readOnly: string[] } | { ok: false; error: string };

/** Lists a server's tools through OpenAI (the path the agent uses) and remembers their names. */
export async function testMcpServer(server: McpServer): Promise<McpTestResult> {
  try {
    const res = await new OpenAI().responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5.5",
      reasoning: { effort: "low" },
      max_output_tokens: 16,
      // List every tool; read-only filtering happens when the agent uses them.
      tools: [mcpTool({ ...server, allowWrites: true })],
      input: "ok",
    });
    const list = res.output.find((item) => item.type === "mcp_list_tools");
    if (!list) return { ok: false, error: "O servidor nao respondeu com ferramentas" };
    if (list.error) return { ok: false, error: list.error };
    const tools = list.tools.map((t) => t.name);
    await updateSettings((s) => {
      const saved = s.mcpServers.find((x) => x.id === server.id);
      if (saved) saved.toolNames = tools;
    });
    return { ok: true, tools, readOnly: tools.filter(isReadOnlyTool) };
  } catch (err) {
    const message = mcpErrorText(err, [server]) ?? (err instanceof Error ? err.message : String(err));
    return { ok: false, error: message };
  }
}

/** Read-only mode needs the tool names; list them once for servers never tested. */
export async function withToolNames(servers: McpServer[]): Promise<McpServer[]> {
  return Promise.all(
    servers.map(async (s) => {
      if (s.allowWrites || s.toolNames) return s;
      const result = await testMcpServer(s);
      return result.ok ? { ...s, toolNames: result.tools } : s;
    }),
  );
}
