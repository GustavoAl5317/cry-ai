import Anthropic from "@anthropic-ai/sdk";

type Segment = { speaker: "cliente" | "voce"; text: string };
type AnswerRequest = {
  mode: "auto" | "manual";
  transcript: Segment[];
  question?: string;
};

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
const SKIP = "SKIP";

const SYSTEM_PROMPT = `Voce e um copiloto silencioso que ajuda o usuario durante reunioes ao vivo com clientes. So o usuario le o que voce escreve; o cliente nunca ve.

Voce recebe a transcricao recente da reuniao. As falas marcadas [Cliente] vem do audio da reuniao (clientes e outros participantes). As falas marcadas [Voce] sao do proprio usuario. A transcricao e automatica e pode ter erros de reconhecimento; interprete pelo contexto.

Seu trabalho: quando o cliente fizer uma pergunta, citar um termo tecnico, sigla, produto, empresa, norma, conceito ou numero que o usuario talvez nao conheca, entregue ao usuario uma resposta pronta para ele usar na hora.

Formato da resposta (markdown simples, em portugues do Brasil):
- Primeira linha: "**Pergunta:** " seguido do que o cliente quer saber, em uma frase curta.
- Depois, de 2 a 4 bullets curtos com a resposta, escritos de forma que o usuario possa falar em voz alta.
- Se for um termo ou sigla, explique o que significa em uma linha antes dos bullets.
- Maximo de 90 palavras no total. Nada de introducao, conclusao ou ressalvas longas.
- Se nao tiver certeza de um fato especifico (preco, data, dado da empresa do cliente), diga isso em poucas palavras e sugira como o usuario pode contornar ("posso confirmar e te retorno").

Nunca invente dados internos da empresa do usuario.`;

const AUTO_INSTRUCTION = `Olhe a fala mais recente do [Cliente] no final da transcricao. Se ela contem uma pergunta, termo, sigla ou assunto que valha uma resposta de apoio e que ainda nao foi respondido acima, responda no formato definido. Se for conversa trivial (cumprimentos, confirmacoes, logistica, "ok", "entendi"), se o proprio usuario ja respondeu bem, ou se nao houver nada util a acrescentar, responda exatamente ${SKIP} e nada mais.`;

const MANUAL_INSTRUCTION = `O usuario pediu ajuda agora. Identifique a pergunta ou assunto mais recente do [Cliente] que precisa de resposta e responda no formato definido. Nunca responda ${SKIP}.`;

const client = new Anthropic();

function formatTranscript(transcript: Segment[]): string {
  // Keep the prompt short: the last ~6000 characters are plenty for context.
  const lines = transcript.map(
    (s) => `[${s.speaker === "cliente" ? "Cliente" : "Voce"}]: ${s.text}`,
  );
  let total = 0;
  const kept: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    total += lines[i].length;
    if (total > 6000) break;
    kept.unshift(lines[i]);
  }
  return kept.join("\n");
}

function buildUserMessage(body: AnswerRequest): string {
  const transcript = formatTranscript(body.transcript) || "(sem transcricao ainda)";
  if (body.question?.trim()) {
    return `<transcricao>\n${transcript}\n</transcricao>\n\nO usuario digitou esta pergunta e precisa da resposta agora (use a transcricao como contexto): ${body.question.trim()}\n\nResponda no formato definido. Nunca responda ${SKIP}.`;
  }
  const instruction = body.mode === "auto" ? AUTO_INSTRUCTION : MANUAL_INSTRUCTION;
  return `<transcricao>\n${transcript}\n</transcricao>\n\n${instruction}`;
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "ANTHROPIC_API_KEY invalida ou ausente.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Limite de requisicoes da Anthropic atingido. Tente de novo em instantes.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Erro da API Anthropic (${err.status}): ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: Request) {
  const body = (await request.json()) as AnswerRequest;
  const encoder = new TextEncoder();

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    // Low effort keeps latency down; these answers are short lookups.
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(body) }],
  });

  request.signal.addEventListener("abort", () => stream.abort());

  const output = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(encoder.encode("\n\n_(O modelo recusou responder.)_"));
        }
      } catch (err) {
        if (!request.signal.aborted) {
          controller.enqueue(encoder.encode(`\n\n**Erro:** ${describeError(err)}`));
        }
      }
      controller.close();
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(output, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
