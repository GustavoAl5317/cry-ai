import type { LiveTranscriber, TranscriberOptions } from "./types";

type RealtimeEvent = {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
};

/**
 * Streams one audio source to an OpenAI Realtime transcription session over
 * WebRTC. Server VAD splits speech into turns; each turn streams deltas and
 * then a completed transcript.
 */
export async function startOpenAI(
  token: string,
  { stream, onEvent, onError }: TranscriberOptions,
): Promise<LiveTranscriber> {
  const pc = new RTCPeerConnection();
  for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
  const dc = pc.createDataChannel("oai-events");
  // Deltas from different turns can interleave, so key them by item.
  const partial = new Map<string, string>();
  let stopped = false;

  dc.onmessage = (msg) => {
    const event = JSON.parse(msg.data as string) as RealtimeEvent;
    switch (event.type) {
      case "conversation.item.input_audio_transcription.delta": {
        const id = event.item_id ?? "";
        const text = (partial.get(id) ?? "") + (event.delta ?? "");
        partial.set(id, text);
        onEvent({ kind: "interim", text: text.trim() });
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        partial.delete(event.item_id ?? "");
        const text = event.transcript?.trim() ?? "";
        onEvent(text ? { kind: "final", text, speechFinal: true } : { kind: "utterance-end" });
        break;
      }
      case "error":
        onError(`OpenAI: ${event.error?.message ?? "erro desconhecido"}`);
        break;
    }
  };

  pc.onconnectionstatechange = () => {
    if (!stopped && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) {
      onError("Conexao com a OpenAI Realtime caiu");
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    body: offer.sdp,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
  });
  if (!res.ok) {
    pc.close();
    throw new Error(`OpenAI Realtime recusou a conexao (${res.status}): ${await res.text()}`);
  }
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });

  return {
    stop() {
      stopped = true;
      dc.close();
      pc.close();
    },
  };
}
