# Modelos de IA no ProjetoHUB

Abra **Agentes e tarefas → Modelos de IA**. No Windows, escolha OpenAI, Anthropic, Google Gemini, DeepSeek ou OpenRouter, informe a chave e clique em **Salvar chave**. Ela é protegida para a conta atual do Windows antes de ser gravada. O campo é limpo depois e a API devolve somente o estado, não o valor. **Remover chave local** apaga a cópia protegida.

Se o servidor tiver uma variável `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY` ou `OPENROUTER_API_KEY`, ela tem prioridade. O painel mostra **chave do ambiente** e não a substitui. Em Linux ou Docker, forneça as chaves por essas variáveis; o painel não as grava localmente. As chaves não entram nos backups do ProjetoHUB. A autenticação do Codex não é usada para acessar APIs de modelos.

Cadastre o nome exato do modelo e sua prioridade no formulário seguinte. Números menores são tentados primeiro. Em falha de rede, HTTP 429 ou HTTP 5xx, o roteador tenta o próximo modelo disponível com o mesmo contexto. Erros HTTP 400, 401, 403, 404 e 422 interrompem a consulta para que uma chave incorreta ou requisição inválida não fique escondida. A indicação **credencial detectada** não comprova que o modelo pode responder. Use **Testar modelo** para fazer uma chamada real; ela pode gerar cobrança.

O Ollama usa `http://127.0.0.1:11434` e não precisa de chave. Se ainda não houver modelo local escolhido, o serviço consulta os modelos instalados e cadastra automaticamente o menor. Quando o Codex estiver comprovadamente indisponível, ele pode assumir tarefas de resposta textual. Um timeout ambíguo da fila Codex exige revisão para evitar trabalho duplicado. O Ollama local não executa navegação, envio de candidatura ou outras ferramentas do Codex.

O painel mostra contagem de tokens, mas ainda não calcula custos monetários nem impõe limites por provedor ou agente. O uso e a cobrança dependem da conta de cada provedor.
