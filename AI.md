# ProjetoHUB — estado técnico

Atualizado em 06/11/2026. Branch de desenvolvimento: `AI-Working`. Base importada: `marmottajr/habblaud` no commit `faa1a01` (versão 1.0.3). O repositório de destino tinha somente `LICENSE` no commit `3a8ed78`; esse arquivo foi preservado. A licença original do Habblaud está em `LICENSE-Habblaud`. A especificação fornecida está em `docs/projecthub/ESPECIFICACAO-MESTRE.md`.

## Auditoria de compatibilidade

| Requisito | Encontrado na base | Estado no ProjetoHUB |
| --- | --- | --- |
| Escritório pixel-art, personagens, salas, animações | `client/`, `shared/`, servidor SSE | Importado sem alterar a renderização |
| Estados, histórico e tarefas observadas | Parsers de sessões em `server/sources/`, tipos em `shared/types.ts` | Leitura de sessões existentes; não é uma fila persistente de tarefas próprias |
| Codex | `server/sources/codex/`, `server/messages/codex.ts`, `scripts/codex-install.ts`, hooks | Sessão real detectada no Windows; envio e hooks ainda não validados nesta instalação |
| Português brasileiro | Texto base em português e `shared/locales/` | Importado |
| Windows 10 | Node e build em Windows atual; README original prioriza macOS/Linux | Inicializador Windows incluído; Windows 10 ainda sem validação específica |
| Criação de agentes | Fluxo existente condicionado a `HABBLAUD_PTY=1` e CLI | Cadastro persistente de nome/objetivo e subagentes no painel local; execução própria ainda parcial |
| Roteador multi-IA | Não encontrado | Pendente |
| Navegador Playwright para agentes | `playwright-core` é dependência de desenvolvimento, usado em recursos existentes | Automação de vagas e perfil persistente pendentes |
| Vagas e candidaturas | Não encontrado | Busca manual Remotive, persistência e deduplicação de vagas; avaliação e candidaturas pendentes |
| Evolution API / WhatsApp | Não encontrado | Pendente |
| MCP remoto, ngrok e registro de conexão | Há recursos remotos próprios do Habblaud, mas não o MCP solicitado | Pendente; nenhuma URL ou credencial publicada |
| Persistência operacional | Configurações e histórico do Habblaud | Estado local de agentes e tarefas com gravação atômica; execução, perguntas e backups ainda parciais ou pendentes |

`shared/world/` e `server/world/` não foram modificados. O Habblaud World transmite apenas dados verdadeiros quando configurado, conforme `AGENTS.md` e `shared/world/README.md`. As futuras entidades do ProjetoHUB só deverão aparecer no escritório como atividade real e não devem alimentar o Habblaud World de forma artificial.

## Verificações executadas neste Windows

- Node `v22.23.2`, npm `10.9.8`, Docker e `codex.exe` encontrados.
- `npm ci`: concluído; 50 pacotes instalados, sem vulnerabilidades informadas pelo npm.
- `npm run typecheck`: passou.
- `npm run build`: passou; cliente e servidor gerados. Vite informou aviso de tamanho de bundle.
- `npm test -- --run`: **1852 testes passaram, 19 falharam, 13 ignorados** em 158 arquivos. As falhas concentram-se em expectativas POSIX (permissões `0600`, caminhos `/Users/...`, shell e certificados) e dois testes de integração do Habblaud World. A suíte completa **não está verde no Windows**; nenhuma falha foi ocultada.
- `npm start`: servidor iniciou em `127.0.0.1:4747`. `GET /api/health` retornou `ok: true`, uma fonte Codex válida e uma sessão. `GET /api/snapshot` retornou uma sala e um agente Codex com `demo: false`. Isso comprova leitura local de uma sessão real, não funcionamento de hooks, envio de instruções ou subagentes.
- `scripts/start-windows.ps1 -Window`: passou com servidor já ativo e após encerrá-lo; no segundo caso iniciou um novo processo e a verificação de saúde retornou `true`. A inspeção visual da janela e a compatibilidade com Windows 10 continuam pendentes.
- Fase 2 parcial: sete testes novos de persistência, entrega e API passaram; `npm run typecheck` e `npm run build` passaram. Em servidor isolado na porta 4757, `POST /api/hub/agents` e `POST /api/hub/tasks` criaram um agente e uma tarefa; após reinício, ambos foram lidos do disco. O teste usou dados locais de verificação, sem enviar instruções ao Codex.
- A instalação local informa `codex-cli 0.166.0-alpha.5.1`; `codex queue --help` confirma `--thread` e `--message`. Ainda não foi enviado comando real nesta fase, portanto a entrega e a conclusão de um trabalho Codex permanecem sem validação de ponta a ponta.
- Pesquisa de vagas: 15 testes do módulo `server/hub/` passaram, além de checagem de tipos e build. Uma consulta real `assistant` à Remotive retornou 12 anúncios com URLs de origem. Após reiniciar o servidor isolado, `GET /api/hub/jobs` retornou os mesmos 12 registros. Os resultados são anúncios encontrados, **não** vagas recomendadas nem candidaturas iniciadas; a busca da fonte também examina descrições e pode trazer cargos fora do termo pesquisado.

## Fase 2 em andamento

`server/hub/` mantém agentes e tarefas em `<dataDir>/projecthub/state.json`. O painel "Agentes e tarefas" no escritório cria agentes com nome e objetivo, permite vincular uma sessão Codex detectada e criar subagentes. Tarefas sem vínculo ficam `unassigned`; tarefas vinculadas entram na fila local e o processo tenta entregá-las pelo `codex queue` existente. `sent` significa **apenas que a instrução foi aceita pela fila**, nunca que a execução terminou. Se o processo cair durante uma entrega, a tarefa volta como `interrupted` para revisão, evitando reenviar automaticamente uma instrução possivelmente entregue. As rotas `/api/hub/*` aceitam apenas conexão do próprio computador.

Ainda faltam edição e encerramento de agentes, confirmação de resultado do Codex, concorrência configurável, retentativas seguras, perguntas pendentes e integração plena dos estados ao personagem pixel-art. O painel novo não anuncia atividade de agentes configurados como se fossem sessões reais.

## Pesquisa inicial de vagas

O servidor cria uma configuração inativa "Procura de Emprego" com seis subagentes. São registros para administração; sem sessão ou modelo configurado, eles não aparecem como trabalhadores ativos no escritório. O painel oferece busca manual por termo na [API pública da Remotive](https://github.com/remotive-com/remote-jobs-api/blob/main/README.md), guarda anúncios com identificador e link originais e evita duplicatas por ID da fonte. Limita a quatro tentativas por dia UTC, incluindo falhas, conforme a recomendação de uso da fonte. A interface cita a Remotive e abre o anúncio original. Não extrai dados pessoais nem envia candidaturas.

O painel permite ativar uma pesquisa periódica a cada 6, 12 ou 24 horas. O servidor guarda a próxima execução antes da chamada externa, evitando repetição imediata após queda; erros ficam visíveis na configuração. A agenda não foi ligada no ambiente de teste real e seu disparo automático foi verificado com fonte simulada. A busca manual real e a persistência foram verificadas separadamente.

Cada vaga possui empresa, cargo, localidade, modalidade remota, salário quando publicado, descrição em texto, data de descoberta, URL, estado de candidatura e campos de avaliação. Requisitos e compatibilidade permanecem vazios/indeterminados até análise real e currículo confirmado. Filtros completos, mais fontes, análise, controle de candidatura e confirmação humana seguem pendentes.

## Execução local

No PowerShell, dentro do repositório, execute `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-windows.ps1`. O script verifica Node 22.12+, instala dependências apenas quando ausentes, compila apenas quando faltam os artefatos, inicia o servidor em segundo plano, verifica a saúde e abre o Microsoft Edge maximizado em modo aplicativo. Use `-Window` para abrir em modo janela. Logs do processo iniciado ficam em `%LOCALAPPDATA%\ProjetoHUB\logs`. O script não configura inicialização automática com Windows.

O endereço local é `http://127.0.0.1:4747`. Não exponha a porta original diretamente à internet: as rotas locais existentes foram projetadas para acesso local. O MCP remoto exigirá serviço e autenticação próprios.

## Próximas entregas e limites

1. Resolver ou classificar os 19 testes que falham no Windows, sem reduzir proteções de arquivos em plataformas POSIX.
2. Validar o fluxo de hooks e mensagens Codex com as APIs oficialmente disponíveis nesta versão; a detecção de sessão já foi validada.
3. Completar o orquestrador persistente: reconciliar resultados reais do Codex, edição de agentes, retentativas seguras, prioridades, perguntas e recuperação.
4. Adicionar roteador de provedores e Playwright, depois vagas, candidaturas, WhatsApp e MCP autenticado. Cada integração externa requer configuração legítima e teste real antes de ser marcada funcional.

Nenhuma candidatura, mensagem WhatsApp, túnel ngrok ou comando MCP foi executado nesta fase. Nenhuma credencial foi lida para integrar provedores externos.

