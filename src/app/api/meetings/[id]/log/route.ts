import { now, updateMeeting } from "@/lib/store";
import type { AnswerRecord, TranscriptLine } from "@/lib/types";

type LogRequest = {
  lines?: TranscriptLine[];
  answer?: AnswerRecord;
  event?: "start" | "end";
};

// The live view appends transcript lines and answers here as they happen,
// so the meeting history survives a crash or a closed window.
export async function POST(request: Request, ctx: RouteContext<"/api/meetings/[id]/log">) {
  const { id } = await ctx.params;
  const body = (await request.json()) as LogRequest;
  const meeting = await updateMeeting(id, (m) => {
    if (body.lines?.length) m.transcript.push(...body.lines);
    if (body.answer) {
      const i = m.answers.findIndex((a) => a.id === body.answer!.id);
      if (i >= 0) m.answers[i] = body.answer;
      else m.answers.push(body.answer);
    }
    if (body.event === "start") {
      m.startedAt ??= now();
      m.endedAt = undefined;
    }
    if (body.event === "end") m.endedAt = now();
  });
  if (!meeting) return Response.json({ error: "Reuniao nao encontrada" }, { status: 404 });
  return new Response(null, { status: 204 });
}
