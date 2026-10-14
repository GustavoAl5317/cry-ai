import OpenAI from "openai";
import { sttProvider } from "@/lib/providers";

type TokenRequest = { language: string; source: "meeting" | "mic" };

// Mints a short-lived speech-to-text token so the browser can stream audio
// without ever seeing a long-lived API key.
export async function POST(request: Request) {
  const { language, source } = (await request.json()) as TokenRequest;
  const provider = sttProvider();

  if (provider === "deepgram") {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        "Content-Type": "application/json",
      },
      // The token only has to be valid when the socket opens.
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return Response.json(
        { error: `Deepgram recusou o token (${res.status}): ${detail}` },
        { status: 502 },
      );
    }
    const { access_token } = (await res.json()) as { access_token: string };
    return Response.json({ provider, token: access_token });
  }

  if (provider === "openai") {
    // OpenAI takes ISO-639-1 codes; "multi" means let the model detect it.
    const lang = language === "multi" ? undefined : language.split("-")[0];
    try {
      const secret = await new OpenAI().realtime.clientSecrets.create({
        expires_after: { anchor: "created_at", seconds: 60 },
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: "gpt-4o-transcribe", ...(lang && { language: lang }) },
              turn_detection: {
                type: "server_vad",
                silence_duration_ms: 700,
                prefix_padding_ms: 300,
              },
              ...(source === "mic" && { noise_reduction: { type: "near_field" as const } }),
            },
          },
        },
      });
      return Response.json({ provider, token: secret.value });
    } catch (err) {
      const message = err instanceof OpenAI.APIError ? `${err.status}: ${err.message}` : String(err);
      return Response.json({ error: `OpenAI recusou o token (${message})` }, { status: 502 });
    }
  }

  return Response.json(
    { error: "Configure DEEPGRAM_API_KEY ou OPENAI_API_KEY em .env.local" },
    { status: 500 },
  );
}
