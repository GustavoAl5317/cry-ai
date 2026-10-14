# Copiloto de Reuniao

Agente para reunioes com clientes (Teams, Zoom, Meet, Webex). Antes da reuniao voce alimenta o copiloto com documentos, links e sistemas (MCP) e ele monta um briefing. Durante a chamada ele escuta, transcreve e mostra respostas, pesquisas e codigo so na sua tela. Depois, guarda o historico e escreve o resumo com proximos passos.

## Fluxo

1. **Dashboard** (`/`): crie uma reuniao (titulo e cliente). O historico de todas fica listado.
2. **Preparar**: objetivo e anotacoes, documentos (PDF, Word, PowerPoint, Excel, CSV, texto, codigo), links de sites e sistemas MCP. **Gerar briefing** pesquisa o cliente na web, le os documentos e sistemas e entrega perguntas provaveis com respostas, objecoes e glossario.
3. **Ao vivo**: **Iniciar escuta** e o agente responde sozinho.
   - **Auto**: a cada fala do cliente decide se ignora, responde rapido ou escala para profundo (codigo, pesquisa, dados de sistemas).
   - **Rapido** / **Profundo**: pede uma resposta para a ultima fala. Profundo usa busca na web, seus documentos, MCP e gera codigo completo com botao de copiar.
   - Campo de texto: pergunte qualquer coisa ou peca codigo durante a reuniao.
4. **Resumo**: ao encerrar, o resumo (decisoes, proximos passos, perguntas em aberto, e-mail de follow-up) e gerado e fica salvo com a transcricao e as respostas.

Tudo fica salvo em `data/` neste computador (fora do git). Documentos sao indexados num vector store da sua conta OpenAI para a busca.

## Configuracao

1. Crie a chave da OpenAI: https://platform.openai.com/api-keys
2. Copie `.env.example` para `.env.local` e preencha `OPENAI_API_KEY`.
3. Rode:

```bash
npm install
npm run desktop
```

`npm run desktop` abre o app numa janela que nao aparece quando voce compartilha a tela. Para usar no navegador, rode `npm run dev` e abra http://localhost:3000 no Chrome ou Edge.

## App desktop (invisivel ao compartilhar tela)

- Janela sempre por cima, excluida de qualquer captura de tela (`setContentProtection` do Electron; Windows 10 2004+).
- **Iniciar escuta** nao pede para compartilhar nada: captura o audio do sistema (onde chega a voz do cliente) e o microfone.
- `Ctrl+Alt+Espaco`: resposta rapida para a ultima fala do cliente, sem tirar o foco da reuniao.
- `Ctrl+Alt+H`: esconde ou mostra a janela.
- Usa o servidor em `localhost:3000` se ja estiver rodando; senao sobe `npm run dev` sozinho.

No navegador, o Chrome so libera o audio da reuniao via "compartilhar tela/guia" com audio. Esse compartilhamento vai so para o copiloto, nao para o cliente. A janela flutuante do navegador aparece se voce compartilhar a tela inteira na reuniao; use o app desktop nesse caso.

## Conexoes MCP

Em **Conexoes MCP** (`/config`) adicione os sistemas e, em cada reuniao, escolha quais usar:

| Sistema | Como |
| --- | --- |
| GitHub | `https://api.githubcopilot.com/mcp/` + personal access token |
| Notion | `https://mcp.notion.com/mcp` + access token OAuth |
| Google Drive | conector `connector_googledrive` da OpenAI + access token OAuth do Google |
| HubSpot, Salesforce, Jira e outros | URL do servidor MCP remoto da plataforma + token |

Tokens ficam so em `data/settings.json`. MCP e documentos funcionam com a OpenAI; com Claude (`ANTHROPIC_API_KEY`) o agente usa contexto e busca na web.

## Provedores

| Funcao | Padrao (so `OPENAI_API_KEY`) | Opcional |
| --- | --- | --- |
| Transcricao | OpenAI Realtime (`gpt-4o-transcribe`, WebRTC) | Deepgram `nova-3` (`DEEPGRAM_API_KEY`) |
| Respostas, briefing, resumo | OpenAI (`gpt-5.5`, `OPENAI_MODEL`) | Claude `claude-opus-5-5` (`ANTHROPIC_API_KEY`) |

Com mais de uma chave, Deepgram e Claude tem prioridade; `STT_PROVIDER` e `LLM_PROVIDER` forcam a escolha. Prompts em `src/lib/agent/prompts.ts`.

## Custo aproximado

- Transcricao: por minuto de audio, por fonte (reuniao + microfone = 2).
- Respostas auto/rapidas: chamada curta com raciocinio baixo. Profundo e briefing: raciocinio medio, busca na web e ferramentas, mais caros e mais lentos.
- Documentos: armazenamento do vector store na OpenAI.

Avise os participantes, conforme a lei e a politica da sua empresa, que a reuniao esta sendo transcrita.
