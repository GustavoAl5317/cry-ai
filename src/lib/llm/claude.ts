import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
const client = new Anthropic();

export async function* streamClaude(
  system: string,
  user: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 8000,
      // Low effort keeps latency down; these answers are short lookups.
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: user }],
    },
    { signal },
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    yield "\n\n_(O modelo recusou responder.)_";
  }
}

export function describeClaudeError(err: unknown): string | null {
  if (err instanceof Anthropic.AuthenticationError) {
    return "ANTHROPIC_API_KEY invalida ou ausente.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Limite de requisicoes da Anthropic atingido. Tente de novo em instantes.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Erro da API Anthropic (${err.status}): ${err.message}`;
  }
  return null;
}
