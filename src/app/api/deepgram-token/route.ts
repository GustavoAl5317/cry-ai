// Mints a short-lived Deepgram token so the browser can open the live
// transcription WebSocket without ever seeing the long-lived API key.
export async function POST() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "DEEPGRAM_API_KEY nao configurada em .env.local" },
      { status: 500 },
    );
  }

  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
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
  return Response.json({ token: access_token });
}
