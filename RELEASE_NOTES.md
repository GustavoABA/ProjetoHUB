# ProjetoHUB 1.1.0 preview 2

Primeira versão portátil para Windows do escritório pixel-art de agentes.

- HUD em português com agentes, tarefas persistentes, vagas, candidaturas, navegador, configurações e APIs.
- Integração com sessões Codex existentes, fila de instruções e fallback para Ollama local quando o Codex estiver indisponível antes do aceite.
- Roteador de modelos com OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, NVIDIA, Moonshot, Ollama e gateway LiteLLM opcional.
- Pesquisa de vagas em Remotive e páginas Greenhouse/Lever cadastradas, análise de requisitos e candidaturas com aprovação humana.
- Integrações configuráveis de Evolution API, WhatsApp, MCP e ngrok.
- Resposta final do Codex registrada automaticamente quando o rollout confirma o turno vinculado à tarefa.

## Como abrir

Baixe o ZIP para Windows x64, extraia toda a pasta e execute `ProjetoHUB.exe`. O pacote contém Node.js e as dependências do aplicativo. Edge, Codex, Ollama, Docker, ngrok e a Evolution API são recursos externos opcionais, configurados separadamente. As chaves e números de WhatsApp são cadastrados no HUD.

## Limites desta prévia

- Não há candidatura real nem mensagem WhatsApp real verificada nesta release. Candidaturas exigem aprovação explícita.
- Uma mensagem aceita pela fila Codex não prova execução concluída. Se o rollout não trouxer uma resposta final vinculada ao turno, a tarefa continua aguardando conferência manual.
- LiteLLM é um gateway separado; o pacote oferece conexão por URL, chave virtual e modelo.
- O aplicativo foi compilado e empacotado no Windows. A compatibilidade com todas as versões de Windows 10 e todos os portais de emprego ainda não foi verificada.

Créditos: ProjetoHUB é baseado no Habblaud de marmottajr, sob licença MIT.
