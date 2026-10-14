import { ndjson, runAgent } from "@/lib/agent";
import { BRIEFING_PROMPT } from "@/lib/agent/prompts";
import { getMeeting, updateMeeting } from "@/lib/store";

// Researches the client, documents and connected systems before the meeting.
export async function POST(request: Request, ctx: RouteContext<"/api/meetings/[id]/briefing">) {
  const { id } = await ctx.params;
  const meeting = await getMeeting(id);
  if (!meeting) return Response.json({ error: "Reuniao nao encontrada" }, { status: 404 });

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  // Generate from scratch: the old briefing must not feed the new one.
  const events = runAgent("briefing", "deep", { ...meeting, briefing: undefined }, BRIEFING_PROMPT, abort.signal);
  return ndjson(events, abort, async (text) => {
    await updateMeeting(id, (m) => {
      m.briefing = text;
    });
  });
}
