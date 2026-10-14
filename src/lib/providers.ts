// Picks providers from the keys in .env.local. STT_PROVIDER / LLM_PROVIDER
// force a choice when more than one key is configured.

export type SttProvider = "deepgram" | "openai";
export type LlmProvider = "anthropic" | "openai";

export function sttProvider(): SttProvider | null {
  const forced = process.env.STT_PROVIDER;
  if (forced === "deepgram" || forced === "openai") return forced;
  if (process.env.DEEPGRAM_API_KEY) return "deepgram";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

export function llmProvider(): LlmProvider | null {
  const forced = process.env.LLM_PROVIDER;
  if (forced === "anthropic" || forced === "openai") return forced;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}
