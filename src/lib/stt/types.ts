export type TranscriptEvent =
  | { kind: "interim"; text: string }
  | { kind: "final"; text: string; speechFinal: boolean }
  | { kind: "utterance-end" };

export type LiveTranscriber = { stop: () => void };

export type TranscriberOptions = {
  stream: MediaStream;
  language: string;
  source: "meeting" | "mic";
  onEvent: (event: TranscriptEvent) => void;
  onError: (message: string) => void;
};
