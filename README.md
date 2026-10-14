# Copiloto de Reuniao

Escuta a reuniao (Teams, Google Meet ou Zoom), transcreve ao vivo e mostra na sua tela respostas curtas para perguntas e termos que o cliente menciona. So voce ve as respostas.

## Como funciona

1. O navegador captura o audio da reuniao via compartilhamento de tela (com audio) e, opcionalmente, o seu microfone.
2. Cada fonte e transcrita ao vivo, usando um token temporario gerado em `/api/stt-token`. A fala da reuniao aparece como **Cliente** e a sua como **Voce**.
3. Quando o cliente termina uma fala, `/api/answer` manda a transcricao recente para o modelo. Se houver pergunta ou termo que valha resposta, ela aparece em streaming no painel; se nao, o modelo responde `SKIP` e nada aparece.
4. Botao **Responder agora** ou o campo de texto pedem uma resposta na hora.

## Provedores

O app escolhe pelos valores em `.env.local`:

| Funcao | Com so `OPENAI_API_KEY` | Opcional |
| --- | --- | --- |
| Transcricao | OpenAI Realtime (`gpt-4o-transcribe`, WebRTC) | Deepgram `nova-3` (`DEEPGRAM_API_KEY`) |
| Respostas | OpenAI (`gpt-5.5`) | Claude `claude-opus-5-5` (`ANTHROPIC_API_KEY`) |

Se houver mais de uma chave, Deepgram e Claude tem prioridade. Use `STT_PROVIDER` e `LLM_PROVIDER` para forcar.

## Configuracao

1. Crie a chave da OpenAI: https://platform.openai.com/api-keys
2. Copie `.env.example` para `.env.local` e preencha `OPENAI_API_KEY`.
3. Rode:

```bash
npm install
npm run dev
```

4. Abra http://localhost:3000 no **Chrome ou Edge**.

## App desktop (invisivel ao compartilhar tela)

```bash
npm run desktop
```

Abre o copiloto numa janela pequena, sempre por cima, que **nao aparece quando voce compartilha a tela** no Teams, Zoom, Meet ou Webex (usa `setContentProtection` do Electron, que no Windows 10 2004+ exclui a janela de qualquer captura). Voce continua vendo a janela normalmente.

- Usa o servidor que ja estiver rodando em `localhost:3000`; se nao houver, sobe `npm run dev` sozinho.
- **Iniciar escuta** nao abre seletor: captura todo o audio do sistema (onde chega a voz do cliente) e o microfone.
- `Ctrl+Alt+Espaco`: responde a ultima fala do cliente sem tirar o foco da reuniao.
- `Ctrl+Alt+H`: esconde ou mostra a janela.

No navegador, a "Janela flutuante" **aparece** se voce compartilhar a tela inteira. Use o app desktop nesse caso.

## Uso na reuniao (navegador)

- **Teams ou Zoom (app desktop):** clique em **Iniciar escuta**, escolha **Tela inteira** e marque **Compartilhar audio do sistema**.
- **Google Meet (navegador):** escolha a **guia** do Meet e marque **Compartilhar audio da guia**.
- Clique em **Janela flutuante** para deixar as respostas sempre visiveis por cima da reuniao.
- Use fone de ouvido: sem fone, o microfone tambem capta a voz do cliente.

## Ajustes

- `OPENAI_MODEL` ou `ANTHROPIC_MODEL` em `.env.local` trocam o modelo de respostas.
- O prompt fica em `src/app/api/answer/route.ts`.
- Idioma da transcricao no seletor do topo (use **Multilingue** se o cliente mistura idiomas).

## Custo aproximado

- Transcricao (OpenAI ou Deepgram): cobrada por minuto de audio, por fonte (reuniao + microfone = 2 fontes).
- Respostas: uma chamada curta a cada fala do cliente com 4+ palavras.

Avise os participantes, conforme a lei e a politica da sua empresa, que a reuniao esta sendo transcrita.
