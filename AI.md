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
| Criação de agentes | Fluxo existente condicionado a `HABBLAUD_PTY=1` e CLI | Ainda não é o cadastro persistente simplificado da especificação |
| Roteador multi-IA | Não encontrado | Pendente |
| Navegador Playwright para agentes | `playwright-core` é dependência de desenvolvimento, usado em recursos existentes | Automação de vagas e perfil persistente pendentes |
| Vagas e candidaturas | Não encontrado | Pendente |
| Evolution API / WhatsApp | Não encontrado | Pendente |
| MCP remoto, ngrok e registro de conexão | Há recursos remotos próprios do Habblaud, mas não o MCP solicitado | Pendente; nenhuma URL ou credencial publicada |
| Persistência operacional | Configurações e histórico do Habblaud | Orquestrador, fila, perguntas e backups pendentes |

`shared/world/` e `server/world/` não foram modificados. O Habblaud World transmite apenas dados verdadeiros quando configurado, conforme `AGENTS.md` e `shared/world/README.md`. As futuras entidades do ProjetoHUB só deverão aparecer no escritório como atividade real e não devem alimentar o Habblaud World de forma artificial.

## Verificações executadas neste Windows

- Node `v22.23.2`, npm `10.9.8`, Docker e `codex.exe` encontrados.
- `npm ci`: concluído; 50 pacotes instalados, sem vulnerabilidades informadas pelo npm.
- `npm run typecheck`: passou.
- `npm run build`: passou; cliente e servidor gerados. Vite informou aviso de tamanho de bundle.
- `npm test -- --run`: **1852 testes passaram, 19 falharam, 13 ignorados** em 158 arquivos. As falhas concentram-se em expectativas POSIX (permissões `0600`, caminhos `/Users/...`, shell e certificados) e dois testes de integração do Habblaud World. A suíte completa **não está verde no Windows**; nenhuma falha foi ocultada.
- `npm start`: servidor iniciou em `127.0.0.1:4747`. `GET /api/health` retornou `ok: true`, uma fonte Codex válida e uma sessão. `GET /api/snapshot` retornou uma sala e um agente Codex com `demo: false`. Isso comprova leitura local de uma sessão real, não funcionamento de hooks, envio de instruções ou subagentes.
- `scripts/start-windows.ps1 -Window`: passou com servidor já ativo e após encerrá-lo; no segundo caso iniciou um novo processo e a verificação de saúde retornou `true`. A inspeção visual da janela e a compatibilidade com Windows 10 continuam pendentes.

## Execução local

No PowerShell, dentro do repositório, execute `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-windows.ps1`. O script verifica Node 22.12+, instala dependências apenas quando ausentes, compila apenas quando faltam os artefatos, inicia o servidor em segundo plano, verifica a saúde e abre o Microsoft Edge maximizado em modo aplicativo. Use `-Window` para abrir em modo janela. Logs do processo iniciado ficam em `%LOCALAPPDATA%\ProjetoHUB\logs`. O script não configura inicialização automática com Windows.

O endereço local é `http://127.0.0.1:4747`. Não exponha a porta original diretamente à internet: as rotas locais existentes foram projetadas para acesso local. O MCP remoto exigirá serviço e autenticação próprios.

## Próximas entregas e limites

1. Resolver ou classificar os 19 testes que falham no Windows, sem reduzir proteções de arquivos em plataformas POSIX.
2. Validar o fluxo de hooks e mensagens Codex com as APIs oficialmente disponíveis nesta versão; a detecção de sessão já foi validada.
3. Criar orquestrador persistente com tarefas, agentes, estados e recuperação. Integrar ao escritório somente após eventos reais.
4. Adicionar roteador de provedores e Playwright, depois vagas, candidaturas, WhatsApp e MCP autenticado. Cada integração externa requer configuração legítima e teste real antes de ser marcada funcional.

Nenhuma candidatura, mensagem WhatsApp, túnel ngrok ou comando MCP foi executado nesta fase. Nenhuma credencial foi lida para integrar provedores externos.

