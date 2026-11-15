# PROJETOHUB — ESPECIFICAÇÃO MESTRE PARA CODEX
**Versão:** 1.0  
**Data:** 06/11/2026  
**Nome:** ProjetoHUB — Escritório Virtual de Agentes Autônomos Multi-IA  
**Sistema principal:** Windows  
**Idioma:** Português brasileiro

---

# 1. MISSÃO PRINCIPAL

Você é o agente de desenvolvimento responsável por construir o **ProjetoHUB**, um sistema de gerenciamento e execução de agentes autônomos de inteligência artificial.

O ProjetoHUB será um aplicativo visual, extensível, com agentes e subagentes, capaz de trabalhar continuamente, controlar navegadores, comunicar-se com seu proprietário pelo WhatsApp e receber instruções localmente ou pelo ChatGPT.

O primeiro objetivo operacional é construir um sistema de **procura automática de emprego**, capaz de pesquisar vagas, analisar requisitos, preencher formulários e preparar candidaturas, mantendo o usuário informado e solicitando aprovação ou informações quando necessário.

O projeto deve ser implementado de verdade, não apenas planejado.

## 1.1 Repositório oficial de destino

**URL:** https://github.com/GustavoABA/ProjetoHUB

**Clone:** `https://github.com/GustavoABA/ProjetoHUB.git`

Este será o único repositório oficial de desenvolvimento e armazenamento do ProjetoHUB.

Toda implementação, documentação, atualização, automação, configuração de exemplo e código-fonte deverá ser versionado nele.

O repositório já possui uma branch `main` e um arquivo `LICENSE`.

Não substitua indiscriminadamente esse arquivo.

## 1.2 Repositório-base obrigatório

https://github.com/marmottajr/habblaud

O Habblaud será a base visual e parte da base funcional.

Sua interface de escritório pixel-art, personagens, salas, animações, acompanhamento de agentes, histórico, tarefas e integração com Codex devem ser estudados e reaproveitados.

Não recrie do zero aquilo que o projeto original já resolve adequadamente.

O código do Habblaud deverá ser incorporado e adaptado ao repositório `GustavoABA/ProjetoHUB`, respeitando sua licença MIT, seus avisos de autoria e eventuais licenças adicionais de recursos incluídos.

Não faça commits nem alterações no repositório `marmottajr/habblaud`.

## 1.3 Branches

A estrutura desejada terá somente duas branches permanentes:

- `main`: versão oficial, estável e funcional.
- `AI-Working`: desenvolvimento, testes e integração.

Crie `AI-Working` a partir de `main`.

Faça o desenvolvimento nela, com commits organizados.

Integre alterações à `main` após testes e validação, preferencialmente por Pull Request.

Não crie branches permanentes adicionais sem necessidade.

Não reescreva o histórico da `main` nem elimine código ou arquivos existentes sem analisar o impacto.

---

# 2. ARQUITETURA GERAL

O sistema deverá ser modular, com separação entre interface, agentes, provedores de IA, navegador, integração WhatsApp e controle remoto.

Arquitetura desejada:

**Camada 1 — Interface:** Habblaud adaptado.

**Camada 2 — Orquestração:** gerenciador de agentes, subagentes e tarefas persistentes.

**Camada 3 — Inteligência:** Codex e roteador multi-IA.

**Camada 4 — Execução:** Playwright, navegador e ferramentas dos agentes.

**Camada 5 — Comunicação:** Evolution API, WebSocket e notificações.

**Camada 6 — Controle remoto:** MCP e ngrok ou túnel seguro equivalente.

**Camada 7 — Persistência:** banco de dados, histórico, configurações e recuperação após falhas.

As camadas devem se comunicar por interfaces definidas, evitando dependências circulares.

O funcionamento do escritório não deve depender de uma sessão de terminal ou conversa do ChatGPT permanentemente aberta.

---

# 3. ESCRITÓRIO VIRTUAL — HABBLAUD

## 3.1 Aproveitamento do projeto

Analise especialmente:

- Interface e sistema de renderização do escritório.
- Personagens, animações e movimentação.
- Salas por projeto.
- Subagentes e atividade em tempo real.
- Gerenciamento de sessões.
- Integração existente com Codex.
- Hooks, permissões e mensagens.
- Configurações.
- Servidor, cliente e sistema de eventos.
- Internacionalização.

Preserve as funcionalidades úteis do Habblaud.

Adicione as novas funcionalidades sem comprometer as animações, a responsividade ou a integração com sessões existentes.

## 3.2 Aplicativo em tela cheia

O ProjetoHUB deverá iniciar com uma interface visual completa.

Requisitos:

1. Abrir automaticamente o escritório em tela cheia ou maximizado.
2. Funcionar em Windows 10.
3. Suportar diferentes resoluções.
4. Permitir modo janela.
5. Permitir minimizar e restaurar.
6. Ter opção de iniciar com o Windows.
7. Continuar executando tarefas com a interface minimizada.
8. Exibir conectividade e estado dos serviços.
9. Oferecer interface integralmente em português brasileiro.
10. Preservar preferências após reinicialização.

A implementação poderá utilizar uma janela desktop leve, PWA ou navegador em modo aplicativo. Avalie a solução mais estável, sem introduzir uma engine gráfica pesada desnecessariamente.

## 3.3 Áreas da interface

Criar áreas integradas para:

**Escritório:** visualização de salas e agentes.

**Agentes:** criação, edição, configurações e monitoramento.

**Tarefas:** filas, prioridades, resultados e pendências.

**Empregos:** busca, vagas encontradas, candidaturas e histórico.

**Navegador:** acompanhamento das sessões Playwright.

**Inteligências artificiais:** provedores, modelos, roteamento e consumo.

**Comunicações:** WhatsApp, perguntas e respostas.

**Conexões:** MCP, ngrok e integração com GitHub.

**Configurações:** serviços, recursos, inicialização e manutenção.

**Logs:** eventos, falhas, diagnósticos e auditoria.

## 3.4 Interface simplificada

O usuário não deve precisar programar para criar um agente.

Implementar um botão:

**+ Criar agente**

Campos principais:

- Nome.
- Objetivo.
- Descrição opcional.
- Modelo de IA.
- Ferramentas permitidas.
- Periodicidade.
- Prioridade.
- Quantidade máxima de subagentes.

Valores padrão devem permitir criar um agente apenas informando nome e objetivo.

Permitir editar todas as configurações posteriormente.

## 3.5 Estados dos agentes

Representar visualmente:

- Disponível.
- Trabalhando.
- Pesquisando.
- Navegando.
- Executando ferramenta.
- Aguardando resposta.
- Aguardando autorização.
- Pausado.
- Concluído.
- Erro.
- Desconectado.

Os personagens devem refletir eventos verdadeiros do sistema, nunca estados artificiais.

---

# 4. CODEX COMO MECANISMO PRINCIPAL

O Codex será a principal ferramenta de programação, supervisão e execução de comandos do ProjetoHUB.

Utilize as integrações oficialmente disponíveis no ambiente.

Reaproveite os mecanismos Codex do Habblaud sempre que forem compatíveis.

O sistema deverá reconhecer sessões Codex existentes, exibir atividades, enviar instruções quando suportado e monitorar resultados.

## 4.1 Requisitos

- Detectar instalação e versão do Codex.
- Detectar sessões abertas.
- Integrar eventos e hooks documentados.
- Exibir progresso.
- Permitir envio de instruções.
- Exibir solicitações de aprovação.
- Registrar erros.
- Administrar múltiplas sessões.
- Associar sessões a agentes e tarefas.
- Permitir retomada de trabalhos persistidos pelo orquestrador.

Não suponha que o Codex ofereça APIs ou mecanismos de execução inexistentes.

## 4.2 Separação fundamental

O Codex não poderá ser o único motor de todas as tarefas.

O ProjetoHUB terá um **orquestrador próprio**, responsável por gerenciar processos contínuos.

O Codex poderá supervisionar esse sistema e realizar operações compatíveis com suas ferramentas.

Outros modelos poderão executar tarefas independentes por meio do roteador de IA.

Isso permitirá que a procura de emprego continue mesmo sem uma sessão interativa do Codex aberta.

---

# 5. ROTEADOR MULTI-IA

## 5.1 Projeto de referência

https://github.com/BerriAI/litellm

Investigue e utilize o LiteLLM como gateway de modelos, quando tecnicamente adequado.

Provedores desejados:

- OpenAI.
- Anthropic.
- Google Gemini.
- DeepSeek.
- OpenRouter.
- Ollama.
- Outros endpoints compatíveis.

Os provedores devem ser opcionais e configuráveis.

## 5.2 Interface de configuração

Criar um painel para:

- Adicionar provedores.
- Adicionar modelos.
- Configurar credenciais.
- Testar conectividade.
- Selecionar modelo principal.
- Selecionar modelos de fallback.
- Definir prioridade.
- Definir orçamento.
- Visualizar consumo.
- Consultar erros.
- Desativar modelos temporariamente.
- Definir modelo por agente.

## 5.3 Estratégias de roteamento

Implementar:

**Roteamento por prioridade:** escolher o provedor preferencial.

**Fallback automático:** utilizar outro provedor após falhas recuperáveis.

**Roteamento por custo:** selecionar opções econômicas para tarefas simples.

**Roteamento por capacidade:** usar modelos mais adequados a cada tarefa.

**Roteamento por disponibilidade:** evitar modelos temporariamente indisponíveis.

**Roteamento local:** utilizar Ollama quando configurado.

Implementar cooldown, retries limitados, timeouts, limites de concorrência e métricas.

## 5.4 Gestão de tokens e custos

Exibir:

- Modelo utilizado.
- Provedor.
- Tokens de entrada.
- Tokens de saída.
- Custo estimado ou informado.
- Tempo de resposta.
- Falhas.
- Limite conhecido.
- Orçamento restante quando disponível.

Nunca declarar consumo ilimitado.

O sistema não deve confundir uma assinatura interativa do Codex com créditos de API de outros fornecedores.

Credenciais e modelos de fallback deverão ser configurados legitimamente pelo usuário.

---

# 6. AGENTES E SUBAGENTES

Implementar uma arquitetura de agentes baseada em tarefas.

Cada agente deve possuir:

- ID único.
- Nome.
- Objetivo.
- Instruções.
- Modelo configurado.
- Ferramentas.
- Permissões.
- Estado.
- Prioridade.
- Histórico.
- Métricas.
- Memória operacional.
- Tarefas atribuídas.
- Subagentes associados.

## 6.1 Delegação

Um agente principal poderá delegar tarefas menores para subagentes.

Exemplo:

O agente Procura de Emprego delega a pesquisa para um agente, a avaliação das vagas para outro e a comunicação ao WhatsApp para outro.

A execução deverá respeitar limites configurados de paralelismo.

## 6.2 Gerenciamento

Implementar ações para:

- Criar.
- Editar.
- Duplicar.
- Pausar.
- Retomar.
- Cancelar.
- Arquivar.
- Consultar.
- Delegar.

O usuário deverá poder criar agentes destinados a outros projetos, não apenas empregos.

## 6.3 Sistema de memória

Persistir informações relevantes das tarefas e resultados.

Não depender exclusivamente do histórico de contexto de um modelo.

Registrar decisões, estados, checkpoints e informações confirmadas pelo usuário.

Os agentes deverão conseguir consultar a memória autorizada sem repetir perguntas já respondidas.

---

# 7. SISTEMA DE TAREFAS PERSISTENTES

Desenvolver um agendador e uma fila de execução independentes da interface.

Estados obrigatórios:

- `created`
- `queued`
- `running`
- `waiting_user`
- `waiting_external`
- `paused`
- `retrying`
- `completed`
- `failed`
- `cancelled`

Cada tarefa deverá possuir identificador, responsável, prioridade, parâmetros, estado, histórico e timestamps.

## 7.1 Execução assíncrona

Quando uma tarefa depender de uma resposta humana:

1. Registrar a pendência.
2. Salvar o estado da execução.
3. Enviar a pergunta ao WhatsApp.
4. Liberar capacidade para outras tarefas.
5. Continuar os trabalhos independentes.
6. Receber a resposta.
7. Validá-la.
8. Retomar a tarefa original.

Não manter um processo bloqueado indefinidamente esperando uma resposta.

## 7.2 Recuperação

O sistema deverá recuperar trabalhos após:

- Reinicialização do aplicativo.
- Reinicialização do Windows.
- Desconexão da internet.
- Falha de navegador.
- Indisponibilidade de um provedor.
- Queda da Evolution API.
- Interrupção de um worker.

A recuperação deverá evitar duplicação de ações externas, especialmente o envio de candidaturas.

Utilize operações idempotentes, checkpoints e confirmação de resultados quando possível.

---

# 8. NAVEGADOR AUTOMATIZADO

## 8.1 Tecnologia

O Playwright será obrigatório como mecanismo de automação.

Avalie também:

https://github.com/browser-use/browser-use

https://github.com/browserbase/stagehand

O navegador deverá ser controlável pelos agentes e possuir sessões persistentes.

## 8.2 Funcionamento

Implementar:

- Chromium ou outro navegador suportado.
- Interface visível.
- Execução em segundo plano.
- Perfil dedicado à automação.
- Persistência de cookies e sessões.
- Múltiplas páginas.
- Controle manual pelo usuário.
- Capturas de tela.
- Registro das ações.
- Monitoramento de carregamento.
- Tratamento de erros.
- Controle de downloads.
- Upload de documentos.
- Limites de sessões simultâneas.

Não utilizar o perfil padrão pessoal do Chrome para a automação. Criar um perfil separado e persistente.

## 8.3 Interação com páginas

O agente deverá:

1. Abrir sites.
2. Pesquisar informações.
3. Identificar elementos.
4. Extrair dados.
5. Preencher campos.
6. Navegar entre páginas.
7. Aguardar carregamentos.
8. Interpretar formulários.
9. Fazer upload de currículo.
10. Preparar ações finais para confirmação.

Priorizar seletores determinísticos e automação convencional.

Usar IA para interpretação quando necessário.

Não prometer invisibilidade ou indetectabilidade. Não implementar bypass de CAPTCHA, falsificação de identidade ou evasão de bloqueios. Quando um site exigir verificação humana, solicitar intervenção.

---

# 9. AGENTE PRINCIPAL — PROCURA DE EMPREGO

Criar automaticamente um projeto denominado:

**Procura de Emprego**

Sua sala deverá aparecer no escritório Habblaud.

## 9.1 Subagentes iniciais

**Pesquisador:** encontra vagas.

**Analista:** interpreta requisitos.

**Compatibilidade:** compara vagas com o currículo.

**Candidaturas:** prepara e acompanha inscrições.

**Comunicador:** envia solicitações e notificações.

**Histórico:** registra vagas, elimina duplicatas e acompanha status.

## 9.2 Fontes de pesquisa

Permitir integração com:

- LinkedIn.
- Indeed.
- Glassdoor.
- Sites oficiais das empresas.
- Páginas de carreiras.
- Outras fontes configuráveis.

Usar APIs oficiais, feeds ou páginas públicas quando disponíveis e autorizados.

Respeitar requisitos de autenticação e restrições de cada plataforma.

## 9.3 Filtros

Permitir configurar:

- Cargos.
- Palavras-chave.
- Experiência.
- Localidade.
- Distância.
- Remoto.
- Híbrido.
- Presencial.
- Faixa salarial.
- Empresas desejadas.
- Empresas excluídas.
- Escolaridade.
- Tipo de contrato.
- Frequência de pesquisa.
- Quantidade máxima de resultados.

Configuração inicial sugerida:

Vagas júnior, estágio quando aplicável, administrativas, atendimento, suporte, tecnologia inicial e oportunidades remotas.

Localidades deverão ser configuráveis pelo usuário, incluindo Santa Cruz da Conceição, Leme, Sumaré e outras cidades desejadas, sem restringir a busca apenas a elas.

## 9.4 Ranking

Cada vaga deverá conter:

- ID.
- Empresa.
- Cargo.
- Localização.
- Modalidade.
- Salário, quando informado.
- Requisitos.
- Fonte.
- Link original.
- Data da descoberta.
- Compatibilidade estimada.
- Justificativa.
- Pendências.
- Status.

O ranking deverá considerar requisitos obrigatórios, competências comprovadas, disponibilidade e preferências.

Não inventar informações ausentes.

## 9.5 Candidaturas

O sistema poderá preparar currículos e formulários usando os dados autorizados do usuário.

Não inventar experiência, escolaridade ou qualificações.

No funcionamento inicial, exigir confirmação antes do envio definitivo de uma candidatura.

Registrar somente como enviada quando houver evidência suficiente de conclusão.

Evitar candidaturas duplicadas e registrar erros de envio.

---

# 10. EVOLUTION API E WHATSAPP

## 10.1 Integração existente

O usuário já possui Evolution API e n8n em seu ambiente.

Priorizar integração direta com a Evolution API, evitando dependência obrigatória do n8n.

Não modificar ou remover outras instâncias existentes.

## 10.2 Nova instância

Nome desejado:

`procura-de-emprego`

Permitir configurar:

- URL da Evolution API.
- Credencial.
- Nome da instância.
- Número remetente.
- Número destinatário.
- Eventos recebidos.
- Estado da conexão.

A interface deverá permitir criar ou selecionar uma instância e configurar o pareamento com o WhatsApp quando necessário.

## 10.3 Comunicação

O sistema deve enviar e receber mensagens.

Preferir eventos WebSocket suportados pela versão instalada da Evolution API.

Se não estiverem disponíveis, implementar recebimento por webhook e distribuição interna por WebSocket.

O protocolo específico deverá ser verificado na instalação real.

## 10.4 Perguntas ao usuário

Quando faltar informação:

- Criar pergunta.
- Associar à tarefa.
- Enviar pelo WhatsApp.
- Aguardar assincronamente.
- Receber resposta.
- Identificar pergunta correspondente.
- Validar resposta.
- Atualizar memória.
- Retomar trabalho.

Cada pergunta terá um identificador único.

Suportar múltiplas perguntas pendentes sem misturar respostas.

Quando a resposta não puder ser associada com segurança, solicitar esclarecimento.

## 10.5 Notificações

Enviar mensagens sobre:

- Vagas relevantes.
- Candidaturas preparadas.
- Candidaturas enviadas.
- Erros.
- Necessidade de login.
- Pedidos de aprovação.
- Resultados de tarefas.
- Resumo diário.

Evitar mensagens excessivas, repetidas ou desnecessárias.

## 10.6 n8n opcional

Oferecer compatibilidade com um fluxo chamado:

`Procura de Emprego`

Esse fluxo poderá funcionar como ponte de comunicação.

Porém, o ProjetoHUB deverá conseguir operar diretamente com a Evolution API sem precisar passar pelo n8n.

---

# 11. MCP — CONTROLE DIRETO PELO CHATGPT

Desenvolver um servidor MCP denominado:

**ProjetoHUB MCP**

O objetivo é permitir que o usuário controle seu escritório pelo ChatGPT ou por outros clientes MCP compatíveis.

## 11.1 Transporte

Utilizar o SDK oficial do Model Context Protocol e um transporte remoto compatível com os clientes atuais, preferencialmente Streamable HTTP.

Separar operações de consulta das operações que alteram o sistema.

## 11.2 Ferramentas desejadas

Implementar ferramentas com nomes e contratos documentados para:

- `hub_status`
- `hub_list_agents`
- `hub_create_agent`
- `hub_update_agent`
- `hub_pause_agent`
- `hub_resume_agent`
- `hub_list_tasks`
- `hub_create_task`
- `hub_pause_task`
- `hub_resume_task`
- `hub_list_jobs`
- `hub_get_application`
- `hub_start_job_search`
- `hub_get_pending_questions`
- `hub_answer_question`
- `hub_router_status`
- `hub_connections_status`
- `hub_get_logs`

Esses são nomes propostos para ferramentas que o ProjetoHUB deverá implementar, não APIs existentes que possam ser presumidas.

## 11.3 Exemplo operacional

O usuário diz ao ChatGPT:

"Procure novas vagas de atendimento remoto para mim."

O ChatGPT deverá, quando a integração estiver instalada e autorizada, poder iniciar uma tarefa no ProjetoHUB.

O ProjetoHUB executará a pesquisa independentemente da conversa e armazenará os resultados.

Posteriormente, o usuário poderá perguntar:

"Quantas vagas foram encontradas?"

O servidor MCP deverá disponibilizar as informações registradas.

## 11.4 Compatibilidade

Verifique a documentação atual do ChatGPT e dos clientes MCP.

O sistema deve disponibilizar uma integração tecnicamente correta, mas não deve presumir que qualquer plano, cliente ou ambiente tenha permissão para usar todas as ferramentas.

Quando ações de escrita não estiverem disponíveis no ChatGPT, fornecer alternativas pelo painel e pela comunicação WhatsApp.

---

# 12. NGROK E CONTROLE REMOTO

## 12.1 Inicialização

O ProjetoHUB deverá gerenciar automaticamente um túnel ngrok.

Ao iniciar:

1. Verificar o executável do ngrok.
2. Validar sua configuração local.
3. Iniciar o serviço MCP.
4. Iniciar o túnel.
5. Identificar o endpoint.
6. Testar conectividade.
7. Registrar o endereço.
8. Mostrar o status no escritório.
9. Atualizar metadados de conexão no GitHub.

## 12.2 Sessão administrativa de 12 horas

Implementar um contador visual configurado inicialmente para 12 horas.

Esse contador representa uma sessão administrativa de operação remota.

O túnel deve continuar ativo conforme sua configuração e disponibilidade.

Ao completar o período, oferecer renovação ou executar a política escolhida pelo usuário.

Não interromper automaticamente tarefas de emprego em andamento.

## 12.3 Atualização a cada cinco horas

Executar uma rotina de atualização dos metadados do túnel:

- Na inicialização.
- A cada cinco horas enquanto estiver ativo.
- Imediatamente quando o endpoint mudar.
- Após uma reconexão relevante.

Não reiniciar o túnel apenas para atualizar os metadados.

## 12.4 Publicação no repositório

Criar:

`connection/current.json`

Registrar:

- Identificador da instalação.
- Endereço HTTPS do MCP.
- Data e hora da atualização.
- Status.
- Versão.
- Horário de início da sessão.
- Horário previsto de encerramento da sessão administrativa.

Permitir que o arquivo seja publicado no repositório oficial do ProjetoHUB.

Não publicar credenciais, tokens de administração, chaves da Evolution API ou segredos do ngrok.

O arquivo servirá para descoberta do endpoint, não como autorização para controlar a máquina.

## 12.5 Autenticação

Implementar uma autenticação simples para operações administrativas.

Requisitos:

- Credencial gerada durante a configuração.
- Armazenamento local protegido.
- Rotação de credenciais.
- Revogação.
- Controle de permissões.
- HTTPS.
- Registro de operações administrativas.

Se o cliente MCP exigir OAuth ou outro mecanismo compatível, implemente a autenticação adequada.

O acesso público ao endpoint nunca deverá conceder execução irrestrita de comandos do Windows.

## 12.6 Alternativa

Investigue também a possibilidade de utilizar Secure MCP Tunnel em clientes compatíveis.

Manter ngrok como opção principal desejada pelo usuário, mas permitir outro transporte seguro quando tecnicamente necessário.

---

# 13. GITHUB E VERSIONAMENTO

O GitHub será o repositório de código-fonte, documentação e metadados de conexão.

Repositório:

https://github.com/GustavoABA/ProjetoHUB

Não utilizar o GitHub como substituto do banco de dados operacional.

## 13.1 Arquivos de documentação

Criar:

- `README.md`
- `AI.md`
- `AGENTS.md`
- `ARCHITECTURE.md`
- `CHANGELOG.md`
- `docs/INSTALL.md`
- `docs/MCP.md`
- `docs/EVOLUTION.md`
- `docs/AGENTS.md`
- `docs/TROUBLESHOOTING.md`
- `.env.example`
- `.gitignore`

Preservar também documentação e avisos de licença exigidos pelas dependências incorporadas.

## 13.2 AI.md

O `AI.md` deverá registrar:

- Objetivo do projeto.
- Arquitetura.
- Fases.
- Tarefas pendentes.
- Tarefas concluídas.
- Bugs conhecidos.
- Testes executados.
- Integrações.
- Histórico das decisões.
- Data de atualização.
- Próximos passos.

Atualizar o arquivo sempre que uma alteração relevante for concluída.

## 13.3 Commits

Fazer commits pequenos e descritivos.

Executar testes antes de integrar alterações na `main`.

Não declarar uma implementação pronta somente porque os arquivos foram criados.

---

# 14. BANCO DE DADOS

Implementar persistência estruturada.

Avaliar SQLite para a instalação local inicial, com abstração que permita migração para PostgreSQL se necessário.

Entidades principais:

- Users.
- Agents.
- Subagents.
- Tasks.
- TaskEvents.
- TaskCheckpoints.
- Providers.
- Models.
- ProviderUsage.
- Jobs.
- JobSources.
- Applications.
- Questions.
- Answers.
- Messages.
- BrowserSessions.
- ConnectionEvents.
- AuditLogs.
- Settings.

Dados sensíveis não devem ser armazenados sem proteção adequada.

Criar migrações versionadas e rotinas de backup.

---

# 15. INICIALIZAÇÃO NO WINDOWS

Criar um inicializador denominado:

`INICIAR-PROJETOHUB.cmd`

Criar scripts PowerShell de suporte quando necessário.

O inicializador deve:

1. Localizar a instalação.
2. Verificar Node.js.
3. Verificar Codex.
4. Verificar Docker quando necessário.
5. Verificar Playwright e o navegador instalado.
6. Verificar serviços já ativos.
7. Iniciar o banco e os serviços.
8. Iniciar o gateway de IA.
9. Iniciar o orquestrador.
10. Iniciar o MCP.
11. Iniciar o ngrok.
12. Abrir o escritório.
13. Exibir estado e diagnósticos.

Evitar abrir várias janelas de console desnecessariamente.

Evitar criar processos duplicados quando o programa já estiver aberto.

Permitir iniciar, parar e reiniciar os serviços pelo escritório.

Implementar encerramento controlado que preserve as tarefas pendentes.

---

# 16. DESEMPENHO E CONFIABILIDADE

O ProjetoHUB deve ser econômico em recursos.

Prioridades:

- Pouco consumo de memória em repouso.
- Limites de navegadores simultâneos.
- Limites de agentes ativos.
- Reutilização de sessões.
- Minimização de chamadas desnecessárias às IAs.
- Operações determinísticas sempre que possível.
- Retentativas com limites.
- Backups.
- Logs rotativos.
- Diagnósticos.
- Recuperação após falhas.
- Inicialização idempotente.

Não utilizar uma IA para toda operação simples do navegador.

O sistema deve funcionar parcialmente mesmo quando uma integração opcional estiver indisponível.

---

# 17. SEGURANÇA OPERACIONAL MÍNIMA

A prioridade é a funcionalidade, mas o sistema deverá manter proteções essenciais para não expor o computador ou os dados do usuário.

Implementar:

- Autenticação administrativa.
- Segredos fora do GitHub.
- Separação entre acesso local e remoto.
- Permissões por ferramenta.
- Confirmação para ações sensíveis.
- Validação de mensagens recebidas.
- Proteção contra execução de instruções maliciosas encontradas em páginas web.
- Registro de alterações importantes.
- Possibilidade de revogar acesso remoto.

Conteúdo encontrado na internet deve ser tratado como dado não confiável, nunca como instrução administrativa ao agente.

Não permitir que uma descrição de vaga execute comandos no computador.

---

# 18. ESTRUTURA SUGERIDA

Adapte a organização às pastas existentes do Habblaud, preservando sua estrutura quando fizer sentido.

Organização lógica desejada:

    ProjetoHUB/
    ├── client/
    ├── server/
    ├── shared/
    ├── services/
    │   ├── orchestrator/
    │   ├── ai-router/
    │   ├── browser/
    │   ├── employment/
    │   ├── whatsapp/
    │   ├── mcp/
    │   └── tunnel/
    ├── storage/
    ├── scripts/
    ├── tests/
    ├── docs/
    ├── connection/
    │   └── current.json
    ├── INICIAR-PROJETOHUB.cmd
    ├── README.md
    ├── AI.md
    ├── AGENTS.md
    ├── ARCHITECTURE.md
    ├── CHANGELOG.md
    └── .env.example

A estrutura é uma proposta. Não faça uma reorganização desnecessária do Habblaud apenas para reproduzi-la.

---

# 19. PLANO DE DESENVOLVIMENTO

## Fase 1 — Importação e funcionamento do Habblaud

- Analisar o repositório original.
- Verificar licença e dependências.
- Incorporar os arquivos ao ProjetoHUB.
- Preservar arquivos já existentes no destino.
- Configurar branches.
- Adaptar inicialização para Windows.
- Garantir que a interface original funcione.
- Validar a integração Codex.
- Documentar o estado inicial.

**Aceitação:** escritório abre e exibe sessões reais quando disponíveis.

## Fase 2 — Gerenciamento de agentes

- Criar gerenciamento visual de agentes.
- Implementar criação e edição.
- Implementar tarefas persistentes.
- Implementar subagentes.
- Integrar eventos ao escritório.
- Criar fila e estados de execução.

**Aceitação:** agentes reais podem receber e executar tarefas pela interface.

## Fase 3 — Roteador multi-IA

- Instalar e configurar gateway.
- Criar painel de provedores.
- Implementar seleção de modelos.
- Implementar fallback.
- Monitorar consumo.
- Testar falhas e recuperação.

**Aceitação:** o sistema utiliza provedores configurados e troca de modelo quando necessário e permitido.

## Fase 4 — Playwright

- Implementar gerenciamento de navegador.
- Criar perfil persistente.
- Permitir navegação e interação.
- Integrar com agentes.
- Permitir intervenção manual.
- Criar testes de navegação.

**Aceitação:** um agente pode executar uma tarefa de navegador e registrar o resultado.

## Fase 5 — Procura de emprego

- Implementar pesquisas.
- Implementar extração.
- Criar filtros.
- Criar classificação.
- Criar banco de vagas.
- Implementar preparação de candidaturas.
- Implementar histórico.

**Aceitação:** o agente encontra e registra vagas verificáveis com links originais.

## Fase 6 — WhatsApp

- Configurar integração Evolution.
- Enviar mensagens.
- Receber respostas.
- Criar perguntas persistentes.
- Retomar tarefas.
- Testar execução concorrente.

**Aceitação:** uma pergunta é respondida pelo WhatsApp e somente a tarefa correspondente é retomada.

## Fase 7 — MCP e túnel

- Criar servidor MCP.
- Implementar ferramentas.
- Implementar autenticação.
- Integrar ngrok.
- Publicar metadados.
- Testar comandos locais e remotos.
- Documentar compatibilidade com ChatGPT.

**Aceitação:** um cliente MCP autorizado consegue consultar e executar ações permitidas.

## Fase 8 — Finalização

- Criar inicializador Windows.
- Implementar backups.
- Implementar monitoramento.
- Implementar testes de recuperação.
- Revisar segurança.
- Corrigir erros.
- Atualizar documentação.
- Preparar primeira versão estável.

**Aceitação:** o sistema funciona em um teste integrado sem depender de funcionalidades simuladas.

---

# 20. TESTES OBRIGATÓRIOS

Implemente testes automatizados e manuais documentados.

Cenários essenciais:

1. Inicialização no Windows.
2. Exibição do escritório.
3. Integração real com Codex.
4. Criação de agente.
5. Criação de subagente.
6. Execução de tarefa.
7. Persistência.
8. Reinicialização e recuperação.
9. Alternância de modelos.
10. Tratamento de limite de provedor.
11. Abertura do navegador.
12. Persistência de sessão.
13. Pesquisa de vagas.
14. Eliminação de duplicatas.
15. Preparação de candidatura.
16. Pergunta pelo WhatsApp.
17. Resposta pelo WhatsApp.
18. Retomada de tarefa pendente.
19. Execução paralela.
20. MCP autenticado.
21. Conexão ngrok.
22. Atualização dos metadados no GitHub.
23. Rejeição de comando remoto não autorizado.
24. Recuperação após falha de serviço.
25. Encerramento controlado.

Utilize mocks para testes automatizados, mas também execute testes reais das integrações quando as credenciais e serviços necessários estiverem disponíveis.

Nunca confunda sucesso de teste simulado com integração real validada.

---

# 21. CRITÉRIOS DE ENTREGA

O ProjetoHUB será considerado pronto para sua primeira versão operacional quando:

- O Habblaud estiver integrado.
- O escritório funcionar no Windows.
- Os agentes puderem ser criados e administrados visualmente.
- Existir um orquestrador persistente.
- O roteador multi-IA estiver funcional.
- O navegador Playwright estiver operacional.
- O agente de procura de emprego encontrar vagas reais.
- As candidaturas forem registradas corretamente.
- A comunicação WhatsApp funcionar nos dois sentidos.
- Tarefas pendentes puderem ser retomadas.
- O MCP estiver disponível com ferramentas de controle.
- O túnel estiver documentado e testado.
- O inicializador Windows estiver funcional.
- O repositório estiver atualizado.
- O `AI.md` refletir o estado real do projeto.

---

# 22. INSTRUÇÕES DE EXECUÇÃO PARA O CODEX

**IMPORTANTE: você está autorizado a desenvolver o projeto, não apenas produzir um planejamento.**

Execute as seguintes ações:

1. Inspecione `GustavoABA/ProjetoHUB`.
2. Inspecione `marmottajr/habblaud`.
3. Leia os arquivos de orientação e licenciamento existentes.
4. Determine o método adequado de incorporação do código-base.
5. Preserve o histórico e os arquivos importantes do destino.
6. Configure a branch de desenvolvimento.
7. Implemente a Fase 1.
8. Execute os testes possíveis.
9. Faça commits.
10. Atualize `AI.md`.
11. Continue as próximas fases conforme as dependências e o ambiente permitirem.

Não pare após criar um README.

Não declare que recursos funcionam sem testes.

Não substitua implementações existentes por interfaces falsas.

Não utilize resultados inventados para demonstrar integração.

Caso uma dependência externa não esteja configurada, implemente o código de integração e o assistente de configuração, registrando claramente que a validação real continua pendente.

Caso não tenha acesso ao Windows do usuário, não declare que testou nesse sistema. Prepare os testes e a instalação para execução posterior.

Mantenha a `main` estável.

Documente todas as mudanças importantes e registre os comandos de instalação e execução.

**PRIORIDADE ABSOLUTA:** entregar o ProjetoHUB como um programa real, progressivamente funcional, no repositório:

https://github.com/GustavoABA/ProjetoHUB

Comece pela análise técnica e pela incorporação do Habblaud. Em seguida, avance para o escritório funcional, os agentes e as integrações, sem perder o objetivo principal: um sistema autônomo de procura de emprego que possa ser controlado de forma simples, inclusive remotamente.
