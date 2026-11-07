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

`atualizar_agente` aceita `id` e, opcionalmente, `nome` e `objetivo`. Para vincular um agente existente ao Codex, envie juntos `sessaoCodex` (UUID de uma sessão real) e `pastaCodex` (pasta Codex correspondente). Envie `null` nos dois campos para desvincular. O serviço rejeita troca durante um despacho em andamento. O MCP aceita identificadores informados pelo administrador autenticado; o HUD oferece apenas sessões detectadas localmente. Ao desvincular, tarefas pendentes voltam à execução local pelo Ollama quando não há modelo escolhido.

`criar_agente` e `atualizar_agente` também aceitam `modeloId` e `modelosReservaIds` (lista ordenada de até três modelos cadastrados) para agentes sem Codex. Em `atualizar_agente`, envie `modeloId: null` e `modelosReservaIds: []` para voltar ao Ollama automático. As reservas só são tentadas após falhas recuperáveis, com o contexto da tarefa, e podem usar outro provedor configurado.

As duas ferramentas de agente aceitam `limiteMensalChamadasIA` (inteiro de 1 a 1.000.000) e `limiteMensalCustoEstimadoUSD` (valor positivo). São limites das chamadas feitas pelo roteador local, somando modelo principal e reservas, não das cotas oficiais do Codex. Em `atualizar_agente`, use `null` para remover um limite. `listar_agentes` mostra a configuração; `consultar_roteador` mostra a contagem mensal em `agentUsage`, indexada pelo ID do agente. O custo é uma estimativa baseada em preços por modelo informados no HUD.

O estado `sent` indica que o Codex aceitou uma instrução na fila; não comprova a conclusão do trabalho. `result_ready` indica uma resposta textual do Ollama aguardando revisão; não comprova ações externas. Candidaturas `approved` ainda não foram enviadas.

## ChatGPT

A [documentação oficial de autenticação](https://developers.openai.com/plugins/build/auth) informa que o ChatGPT não apresenta chaves de API personalizadas como credencial para um servidor MCP. O servidor atual usa uma chave Bearer fixa e **ainda não oferece OAuth 2.1**, portanto não está pronto para ser cadastrado como plugin autenticado diretamente no ChatGPT. O [cadastro de MCP personalizado](https://developers.openai.com/api/docs/guides/custom-mcp-server) depende também das permissões do workspace. A opção [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) pode transportar um servidor privado, mas não elimina a necessidade de autenticação compatível da aplicação. Não use a modalidade sem autenticação para expor as ferramentas de controle.

## ngrok, sessão e GitHub

Com chave administrativa já gerada, o serviço procura o executável `ngrok` no PATH ou em `PROJECTHUB_NGROK_BIN` e inicia `ngrok http <porta MCP>`. O agente ngrok deve estar previamente configurado em sua instalação oficial. O ProjetoHUB lê a API local do agente em `127.0.0.1:4040`, seleciona somente o endpoint HTTPS encaminhado para sua porta MCP e confirma `/health` pelo endereço público. O painel só mostra a URL pública após essa confirmação. O processo verifica a conexão a cada 30 segundos e tenta iniciar novamente o agente que encerrou. O túnel é separado da porta principal do escritório.

A sessão administrativa de 12 horas fica em `<dataDir>/projecthub/connection-session.json`. O painel mostra o tempo restante e permite renovar ou escolher entre avisar, renovar automaticamente ou fechar o túnel quando o prazo terminar. Fechar o túnel não encerra as tarefas de emprego. Ao reiniciar o escritório, a sessão mantém o prazo anterior; ela não ganha 12 horas extras automaticamente.

`connection/current.json` existe nas branches `main` e `AI-Working` com estado inicial `offline`; o arquivo da `main` foi criado e relido no GitHub para conferir o conteúdo. Com `PROJECTHUB_GITHUB_TOKEN` configurado no ambiente do processo, o serviço usa a API de conteúdo do GitHub para publicar **somente** identificador da instalação, URL HTTPS do MCP verificada, horários, versão e estado na branch `main` do repositório `GustavoABA/ProjetoHUB`. Ele atualiza na inicialização, na mudança do endereço, na mudança de política por vencimento e a cada cinco horas. O token não é serializado no arquivo nem mostrado no painel. Sem token, o painel indica que a publicação não está configurada; o arquivo versionado continua no último estado e não prova disponibilidade atual. O repositório é público, portanto qualquer pessoa pode ver o endereço, mas a chave administrativa continua exigida para operações MCP.

Neste Windows, o ngrok 3.3.1 foi instalado, mas `ngrok config check` informou que a configuração da conta ainda não existe. O painel/API confirmou que o executável foi encontrado e exibiu esse diagnóstico, sem abrir túnel. Um token específico de publicação GitHub não estava disponível. A inspeção de URL de túnel e a API GitHub foram cobertas por testes simulados, mas **nenhuma URL ngrok real foi aberta e nenhuma atualização automática de `connection/current.json` foi comprovada**. Ainda faltam configuração de segredos pela interface, OAuth para ChatGPT e uma chamada real vinda do ChatGPT. Use somente um cliente MCP que permita o cabeçalho Bearer até que a autenticação OAuth seja implementada e verificada.
