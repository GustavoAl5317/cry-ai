import { newId, getSettings, updateSettings } from "@/lib/store";
import type { McpServer, PublicMcpServer } from "@/lib/types";

const toPublic = ({ token, ...rest }: McpServer): PublicMcpServer => ({ ...rest, hasToken: Boolean(token) });

export async function GET() {
  const settings = await getSettings();
  return Response.json(settings.mcpServers.map(toPublic));
}

export async function POST(request: Request) {
  const input = (await request.json()) as Partial<McpServer>;
  if (!input.label?.trim() || (!input.url?.trim() && !input.connectorId)) {
    return Response.json({ error: "Informe nome e URL (ou conector)" }, { status: 400 });
  }
  const server: McpServer = {
    id: newId(),
    label: input.label.trim(),
    description: input.description?.trim() || undefined,
    url: input.url?.trim() || undefined,
    connectorId: input.connectorId || undefined,
    token: input.token?.trim() || undefined,
    enabled: true,
  };
  await updateSettings((s) => {
    s.mcpServers.push(server);
  });
  return Response.json(toPublic(server), { status: 201 });
}

export async function PATCH(request: Request) {
  const input = (await request.json()) as Partial<McpServer> & { id: string };
  let updated: McpServer | undefined;
  await updateSettings((s) => {
    const server = s.mcpServers.find((x) => x.id === input.id);
    if (!server) return;
    if (input.label !== undefined) server.label = input.label.trim();
    if (input.description !== undefined) server.description = input.description.trim() || undefined;
    if (input.url !== undefined) server.url = input.url.trim() || undefined;
    // An empty token field means "keep the current one".
    if (input.token) server.token = input.token.trim();
    if (input.enabled !== undefined) server.enabled = input.enabled;
    updated = server;
  });
  if (!updated) return Response.json({ error: "Servidor nao encontrado" }, { status: 404 });
  return Response.json(toPublic(updated));
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  await updateSettings((s) => {
    s.mcpServers = s.mcpServers.filter((x) => x.id !== id);
  });
  return new Response(null, { status: 204 });
}
