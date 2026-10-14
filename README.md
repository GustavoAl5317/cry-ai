# Copiloto de Reuniao

Escuta a reuniao (Teams, Google Meet ou Zoom), transcreve ao vivo e mostra na sua tela respostas curtas para perguntas e termos que o cliente menciona. So voce ve as respostas.

## Como funciona

1. O navegador captura o audio da reuniao via compartilhamento de tela (com audio) e, opcionalmente, o seu microfone.
2. Cada fonte vai para o Deepgram (`nova-3`) por WebSocket, usando um token temporario gerado em `/api/deepgram-token`. A fala da reuniao aparece como **Cliente** e a sua como **Voce**.
3. Quando o cliente termina uma fala, `/api/answer` manda a transcricao recente para o Claude. Se houver pergunta ou termo que valha resposta, ela aparece em streaming no painel; se nao, o modelo responde `SKIP` e nada aparece.
4. Botao **Responder agora** ou o campo de texto pedem uma resposta na hora.

## Configuracao

1. Crie as chaves:
   - Anthropic: https://platform.claude.com
   - Deepgram (permissao Member ou superior): https://console.deepgram.com
2. Copie `.env.example` para `.env.local` e preencha `ANTHROPIC_API_KEY` e `DEEPGRAM_API_KEY`.
3. Rode:

```bash
npm install
npm run dev
```

4. Abra http://localhost:3000 no **Chrome ou Edge**.

## Uso na reuniao

- **Teams ou Zoom (app desktop):** clique em **Iniciar escuta**, escolha **Tela inteira** e marque **Compartilhar audio do sistema**.
- **Google Meet (navegador):** escolha a **guia** do Meet e marque **Compartilhar audio da guia**.
- Clique em **Janela flutuante** para deixar as respostas sempre visiveis por cima da reuniao.
- Use fone de ouvido: sem fone, o microfone tambem capta a voz do cliente.

## Ajustes

- `ANTHROPIC_MODEL` em `.env.local` troca o modelo (padrao `claude-opus-5-5`).
- O prompt fica em `src/app/api/answer/route.ts`.
- Idioma da transcricao no seletor do topo (use **Multilingue** se o cliente mistura idiomas).

## Custo aproximado

- Deepgram streaming: cobrado por minuto de audio, por fonte (reuniao + microfone = 2 fontes).
- Claude: uma chamada curta a cada fala do cliente com 4+ palavras.

Avise os participantes, conforme a lei e a politica da sua empresa, que a reuniao esta sendo transcrita.
