import { ndjson, runAgent } from "@/lib/agent";
import { answerPrompt } from "@/lib/agent/prompts";
import { getMeeting } from "@/lib/store";
import type { AnswerMode, TranscriptLine } from "@/lib/types";

type AnswerRequest = {
  meetingId?: string;
  mode: AnswerMode;
  question?: string;
  transcript: Pick<TranscriptLine, "speaker" | "text">[];
};

// Streams one copilot answer as NDJSON events (status, delta, done/error).
export async function POST(request: Request) {
  const body = (await request.json()) as AnswerRequest;
  const meeting = body.meetingId ? await getMeeting(body.meetingId) : null;
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  // A typed question always gets the full toolset.
  const mode: AnswerMode = body.question?.trim() ? "deep" : body.mode;
  const input = answerPrompt(mode, body.transcript ?? [], body.question);
  return ndjson(runAgent("answer", mode, meeting, input, abort.signal), abort);
}
