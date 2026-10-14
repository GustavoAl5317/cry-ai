import { deleteMeeting, getDoc, getMeeting, updateMeeting } from "@/lib/store";
import type { Doc, Meeting } from "@/lib/types";

type Ctx = RouteContext<"/api/meetings/[id]">;

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const meeting = await getMeeting(id);
  if (!meeting) return Response.json({ error: "Reuniao nao encontrada" }, { status: 404 });
  const docs = (await Promise.all(meeting.docIds.map(getDoc))).filter((d): d is Doc => d !== null);
  return Response.json({ meeting, docs });
}

const EDITABLE = ["title", "client", "goal", "docIds", "mcpServerIds", "briefing"] as const;

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const patch = (await request.json()) as Partial<Meeting>;
  const meeting = await updateMeeting(id, (m) => {
    for (const key of EDITABLE) {
      if (patch[key] !== undefined) Object.assign(m, { [key]: patch[key] });
    }
  });
  if (!meeting) return Response.json({ error: "Reuniao nao encontrada" }, { status: 404 });
  return Response.json(meeting);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await deleteMeeting(id);
  return new Response(null, { status: 204 });
}
