import { describeClaudeError, streamClaude } from "@/lib/llm/claude";
import { describeOpenAIError, streamOpenAI } from "@/lib/llm/openai";
import { llmProvider } from "@/lib/providers";

type Segment = { speaker: "cliente" | "voce"; text: string };
type AnswerRequest = {
  mode: "auto" | "manual";
  transcript: Segment[];
  question?: string;
};

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
  return (
    describeClaudeError(err) ??
    describeOpenAIError(err) ??
    (err instanceof Error ? err.message : String(err))
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as AnswerRequest;
  const provider = llmProvider();
  if (!provider) {
    return new Response("**Erro:** configure ANTHROPIC_API_KEY ou OPENAI_API_KEY em .env.local", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const generate = provider === "anthropic" ? streamClaude : streamOpenAI;
  const chunks = generate(SYSTEM_PROMPT, buildUserMessage(body), abort.signal);

  const output = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const text of chunks) {
          controller.enqueue(encoder.encode(text));
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          controller.enqueue(encoder.encode(`\n\n**Erro:** ${describeError(err)}`));
        }
      }
      controller.close();
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(output, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
