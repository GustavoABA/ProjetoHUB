# ProjetoHUB MCP

O serviço MCP é iniciado junto ao escritório em `http://127.0.0.1:4748/mcp` por padrão. A porta pode ser alterada com `PROJECTHUB_MCP_PORT`. Ele usa Streamable HTTP e ferramentas em português. O listener aceita conexões somente do próprio computador; a porta principal do escritório não é publicada por esse serviço.

## Configuração local

1. Abra **Agentes e tarefas > Controle remoto MCP** no escritório.
2. Acione **Gerar ou revogar chave administrativa**. Copie a chave exibida; ela aparece uma vez. Repetir a operação revoga a anterior.
3. Acione **Copiar configuração de conexão** enquanto a chave ainda está visível. Um cliente MCP que aceite `Authorization: Bearer <chave>` pode usar a URL `/mcp` copiada.
4. Confirme que `GET http://127.0.0.1:4748/health` responde `ok: true`. Essa rota não expõe dados do escritório. Sem chave, chamadas a `/mcp` retornam HTTP 401.

A chave é aleatória e somente seu hash é persistido em `<dataDir>/projecthub/mcp-admin.json`. Ela não é recuperável pela interface. O arquivo não deve ser colocado no GitHub. O nome de host do endpoint também é validado; `PROJECTHUB_MCP_PUBLIC_HOST` adiciona um host explicitamente permitido quando houver proxy externo. Isso **não** inicia o proxy ou o ngrok.

## Ferramentas disponíveis

`listar_agentes`, `criar_agente`, `atualizar_agente`, `encerrar_agente`, `criar_tarefa`, `consultar_tarefas`, `pausar_tarefa`, `retomar_tarefa`, `listar_vagas`, `consultar_candidaturas`, `solicitar_relatorio`, `consultar_roteador` e `consultar_notificacoes_pendentes`.

O estado `sent` indica que o Codex aceitou uma instrução na fila; não comprova a conclusão do trabalho. `result_ready` indica uma resposta textual do Ollama aguardando revisão; não comprova ações externas. Candidaturas `approved` ainda não foram enviadas.

## ChatGPT

A [documentação oficial de autenticação](https://developers.openai.com/plugins/build/auth) informa que o ChatGPT não apresenta chaves de API personalizadas como credencial para um servidor MCP. O servidor atual usa uma chave Bearer fixa e **ainda não oferece OAuth 2.1**, portanto não está pronto para ser cadastrado como plugin autenticado diretamente no ChatGPT. O [cadastro de MCP personalizado](https://developers.openai.com/api/docs/guides/custom-mcp-server) depende também das permissões do workspace. A opção [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) pode transportar um servidor privado, mas não elimina a necessidade de autenticação compatível da aplicação. Não use a modalidade sem autenticação para expor as ferramentas de controle.

O ngrok, o registro `connection/current.json` no GitHub, a sessão administrativa de 12 horas e o teste de uma chamada vinda do ChatGPT ainda estão pendentes. Use somente um cliente MCP que permita o cabeçalho Bearer até que a autenticação OAuth seja implementada e verificada.
