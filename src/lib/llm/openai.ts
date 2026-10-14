import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.5";
// Created on first use: the constructor throws when OPENAI_API_KEY is unset,
// which would break the build and Claude-only setups.
let client: OpenAI | undefined;

export async function* streamOpenAI(
  system: string,
  user: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
  client ??= new OpenAI();
  const stream = await client.responses.create(
    {
      model: MODEL,
      instructions: system,
      input: user,
      // Low effort keeps latency down; these answers are short lookups.
      reasoning: { effort: "low" },
      max_output_tokens: 4000,
      stream: true,
    },
    { signal },
  );

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      yield event.delta;
    } else if (event.type === "response.failed") {
      throw new Error(event.response.error?.message ?? "Resposta da OpenAI falhou");
    } else if (event.type === "error") {
      throw new Error(event.message);
    }
  }
}

export function describeOpenAIError(err: unknown): string | null {
  if (err instanceof OpenAI.AuthenticationError) {
    return "OPENAI_API_KEY invalida ou ausente.";
  }
  if (err instanceof OpenAI.RateLimitError) {
    return "Limite de requisicoes ou credito da OpenAI atingido.";
  }
  if (err instanceof OpenAI.APIError) {
    return `Erro da API OpenAI (${err.status}): ${err.message}`;
  }
  return null;
}
