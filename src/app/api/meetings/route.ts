import { createMeeting, listMeetings } from "@/lib/store";
import type { Meeting } from "@/lib/types";

export async function GET() {
  return Response.json(await listMeetings());
}

export async function POST(request: Request) {
  const input = (await request.json()) as Partial<Meeting>;
  return Response.json(await createMeeting(input), { status: 201 });
}
