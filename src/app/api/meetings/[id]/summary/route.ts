import { ndjson, runAgent } from "@/lib/agent";
import { summaryPrompt } from "@/lib/agent/prompts";
import { getMeeting, updateMeeting } from "@/lib/store";

// Writes the post-meeting summary from the saved transcript and answers.
export async function POST(request: Request, ctx: RouteContext<"/api/meetings/[id]/summary">) {
  const { id } = await ctx.params;
  const meeting = await getMeeting(id);
  if (!meeting) return Response.json({ error: "Reuniao nao encontrada" }, { status: 404 });
  if (meeting.transcript.length === 0) {
    return Response.json({ error: "A reuniao ainda nao tem transcricao" }, { status: 400 });
  }

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const events = runAgent("summary", "quick", meeting, summaryPrompt(meeting), abort.signal);
  return ndjson(events, abort, async (text) => {
    await updateMeeting(id, (m) => {
      m.summary = text;
    });
  });
}
