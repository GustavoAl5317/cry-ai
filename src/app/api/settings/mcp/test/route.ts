import { testMcpServer } from "@/lib/mcp";
import { getSettings } from "@/lib/store";

// Connects to a saved MCP server and returns its tool names or the error.
export async function POST(request: Request) {
  const { id } = (await request.json()) as { id: string };
  const server = (await getSettings()).mcpServers.find((s) => s.id === id);
  if (!server) return Response.json({ ok: false, error: "Servidor nao encontrado" }, { status: 404 });
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ ok: false, error: "MCP usa a OpenAI: configure OPENAI_API_KEY" });
  }
  return Response.json(await testMcpServer(server));
}
