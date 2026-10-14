import type { AnswerMode, Meeting, TranscriptLine } from "../types";

export const SKIP = "SKIP";
export const DEEP = "DEEP";

const BASE = `Voce e o copiloto do usuario durante reunioes com clientes. So o usuario le o que voce escreve; o cliente nunca ve. Pense como um especialista senior que sabe de tudo: tecnologia, programacao, negocios, vendas, financas, juridico, produto.

Formato (markdown):
- Primeira linha em **negrito**: a resposta em uma frase que o usuario pode falar em voz alta.
- Depois, bullets curtos. Use tabela para comparar opcoes e blocos de codigo com a linguagem indicada (\`\`\`python) para qualquer codigo.
- Quando pedirem codigo: entregue o codigo completo e funcional, pronto para copiar, e diga em uma linha como rodar. Nada de pseudo-codigo ou trechos com "...".
- Sem introducao, sem despedida, sem repetir a pergunta.
- Responda em portugues do Brasil, exceto codigo ou se o pedido vier em outro idioma.
- Se nao tiver certeza de um fato especifico (preco, data, numero, dado da empresa), diga isso em poucas palavras e sugira como confirmar. Nunca invente dados internos do usuario ou do cliente: use os documentos e sistemas conectados para isso.

A transcricao e automatica e pode ter erros de reconhecimento; interprete pelo contexto. [Cliente] e o audio da reuniao (clientes e outros participantes). [Voce] e o proprio usuario.`;

function meetingContext(meeting?: Meeting | null): string {
  if (!meeting) return "";
  const parts = [`\n\n# Reuniao atual\nTitulo: ${meeting.title}`];
  if (meeting.client) parts.push(`Cliente/empresa: ${meeting.client}`);
  if (meeting.goal.trim()) parts.push(`Objetivo e anotacoes do usuario:\n${meeting.goal.trim()}`);
  if (meeting.briefing?.trim()) parts.push(`Briefing preparado antes da reuniao:\n${meeting.briefing.trim()}`);
  return parts.join("\n");
}

function toolGuide(tools: { docs: boolean; web: boolean; mcp: string[] }): string {
  const lines: string[] = [];
  if (tools.docs) lines.push("- Documentos do usuario (file_search): use para perguntas sobre proposta, produto, precos, contratos e dados da empresa.");
  if (tools.web) lines.push("- Busca na web: use para fatos atuais, empresas, noticias, documentacao tecnica e numeros que mudam.");
  if (tools.mcp.length) lines.push(`- Sistemas conectados via MCP (${tools.mcp.join(", ")}): use para dados de clientes, tarefas, codigo e documentos internos.`);
  return lines.length ? `\n\n# Ferramentas\n${lines.join("\n")}\nUse ferramentas so quando ajudarem; responda direto quando ja souber.` : "";
}

/** Stable per meeting, so providers can cache it between calls. */
export function buildInstructions(
  meeting: Meeting | null | undefined,
  tools: { docs: boolean; web: boolean; mcp: string[] },
): string {
  return BASE + meetingContext(meeting) + toolGuide(tools);
}

export function formatTranscript(lines: Pick<TranscriptLine, "speaker" | "text">[], maxChars = 8000): string {
  const out: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = `[${lines[i].speaker === "cliente" ? "Cliente" : "Voce"}]: ${lines[i].text}`;
    total += line.length;
    if (total > maxChars) break;
    out.unshift(line);
  }
  return out.join("\n") || "(sem transcricao ainda)";
}

const MODE_INSTRUCTION: Record<AnswerMode, string> = {
  auto: `Olhe a fala mais recente do [Cliente] no fim da transcricao e decida:
- Conversa trivial (cumprimento, "ok", logistica), algo que o usuario ja respondeu bem, ou nada util a acrescentar: responda exatamente ${SKIP}.
- Pedido de codigo, pesquisa na web, dado atual, calculo complexo ou consulta a sistemas da empresa: responda exatamente ${DEEP}.
- Caso contrario: responda no formato definido em ate 80 palavras.`,
  quick: `Responda a pergunta ou assunto mais recente do [Cliente] no formato definido, em ate 120 palavras. Nunca responda ${SKIP}.`,
  deep: `Responda de forma completa e precisa ao pedido mais recente do [Cliente]. Use as ferramentas quando ajudarem. Se for codigo, entregue o codigo completo. Nunca responda ${SKIP}.`,
};

export function answerPrompt(
  mode: AnswerMode,
  transcript: Pick<TranscriptLine, "speaker" | "text">[],
  question?: string,
): string {
  const context = `<transcricao>\n${formatTranscript(transcript)}\n</transcricao>`;
  if (question?.trim()) {
    return `${context}\n\nO usuario pediu (use a transcricao como contexto): ${question.trim()}\n\nResponda no formato definido. Nunca responda ${SKIP}.`;
  }
  return `${context}\n\n${MODE_INSTRUCTION[mode]}`;
}

export const BRIEFING_PROMPT = `Prepare um briefing para o usuario ler nos minutos antes desta reuniao. Use a busca na web para pesquisar o cliente e o mercado dele, e consulte os documentos e sistemas conectados.

Estrutura (markdown, titulos com ##):
## Sobre o cliente
Quem sao, o que fazem, tamanho, noticias recentes relevantes.
## Objetivo e pontos-chave
O que o usuario precisa conseguir e os pontos que deve levar.
## Perguntas provaveis
5 a 8 perguntas que o cliente deve fazer, cada uma com a resposta sugerida.
## Objecoes e riscos
Objecoes provaveis e como responder.
## Glossario rapido
Termos tecnicos ou siglas que podem aparecer, com explicacao de uma linha.

Seja objetivo. Se faltar informacao, diga o que o usuario deveria confirmar.`;

export function summaryPrompt(meeting: Meeting): string {
  const answers = meeting.answers
    .slice(-15)
    .map((a) => `- ${a.text.split("\n")[0].replace(/\*\*/g, "")}`)
    .join("\n");
  return `<transcricao>\n${formatTranscript(meeting.transcript, 60000)}\n</transcricao>\n\n<respostas_do_copiloto>\n${answers || "(nenhuma)"}\n</respostas_do_copiloto>

Escreva o resumo desta reuniao (markdown, titulos com ##):
## Resumo
3 a 5 linhas.
## Decisoes
## Proximos passos
Com responsavel e prazo quando citados.
## Perguntas em aberto
O que ficou sem resposta ou precisa de confirmacao.
## E-mail de follow-up
Um rascunho curto e profissional para o cliente.`;
}
