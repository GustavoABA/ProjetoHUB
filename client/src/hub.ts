import { mountAgentOffice } from './hub-office';
import { mountHubNavigation } from './hub-navigation';
import { tr } from '../../shared/i18n';

type Agent = { id: string; name: string; objective: string; parentId?: string; codexThread?: string; codexHome?: string; modelId?: string; fallbackModelIds?: string[];
  monthlyAiRequestLimit?: number; monthlyAiCostLimitUsd?: number; systemKey?: string; status?: 'active' | 'paused' | 'ended' };
type Task = { id: string; agentId: string; instruction: string; priority?: number; status: string; updatedAt?: string; error?: string; result?: string; executionProvider?: string; executionModel?: string; localRetryCount?: number; nextAttemptAt?: string };
type ExecutionStatus = { maxConcurrent: number; active: number };
type Session = { name: string; sessionId: string; account: string; provider: string };
type Source = { label: string; path: string; provider: string };
type Job = { id: string; title: string; company: string; location: string; source: string; originalUrl: string; discoveredAt: string; salary?: string; compatibility: number | null; justification: string; requirements: string[]; analysisModel?: string; analyzedAt?: string; applicationStatus: string;
  searchFit?: { eligible: boolean; conflicts: string[]; unknown: string[]; preferredCompany: boolean } };
type JobSearchPreferences = { title: string; location: string; modes: string[]; seniority: string; desiredSalary: string; area: string;
  requiredTerms: string[]; preferredCompanies: string[]; keywords: string[] };
type GreenhouseBoard = { token: string; company: string; lastSearchedAt?: string; lastError?: string };
type LeverBoard = { site: string; region: 'global' | 'eu'; company: string; lastSearchedAt?: string; lastError?: string };
type Profile = { revision: string; skills: string[]; experience: string[]; education: string[]; confirmedAt?: string };
type WhatsAppStatus = { instance: string; mainNumber?: string; secondaryNumber?: string; webhookTokenConfigured: boolean; apiKeyConfigured: boolean; webhookPort?: string | null; outbound: { questionId: string; state: string; error?: string }[]; notifications: { id: string; type: string; text: string; state: string; error?: string; createdAt: string }[]; summary: { enabled: boolean; hour: number; lastDate?: string } };
type EvolutionStatus = { baseUrl: string; apiKeyConfigured: boolean; apiKeySource: 'windows' | 'environment' | null };
type WebhookListenerStatus = { enabled: boolean; port: number; exposeLan: boolean; bind: string; running: boolean; error?: string };
type EvolutionInstanceResult = { instance: string; created?: boolean; status?: string; qrCode?: string; pairingCode?: string };
type Schedule = { query?: string; intervalHours?: number; enabled: boolean; nextRunAt?: string; lastError?: string };
type BrowserStatus = { running: boolean; headless: boolean; manual: boolean; pages: { id: string; url: string }[] };
type RouterStatus = { models: { id: string; provider: string; model: string; priority: number; enabled: boolean; available: boolean;
  monthlyRequestLimit?: number; monthlyCostLimitUsd?: number; inputUsdPerMillion?: number; outputUsdPerMillion?: number;
  monthlyUsage: { month: string; requests: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; unpricedRequests: number } }[];
  agentUsage: Record<string, { month: string; requests: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; unpricedRequests: number }>;
  usage: { inputTokens: number; outputTokens: number; requests: number; estimatedCostUsd?: number; unpricedRequests?: number }; lastError?: string };
type ProviderCredentialStatus = Record<string, { configured: boolean; source: 'windows' | 'environment' | null }>;
type McpStatus = { configured: boolean; port: number; ngrok: { installed: boolean; running: boolean; mcpUrl?: string; error?: string }; github: { configured: boolean; lastPublishAt?: string; lastError?: string } };
type AdminSession = { installationId: string; startedAt: string; expiresAt: string; policy: 'renew' | 'notify' | 'close'; remainingSeconds: number; expired: boolean };
type BackupStatus = { backups: { id: string; createdAt: string; size: number }[]; pendingRestore?: string };
type WindowsStartupStatus = { supported: boolean; enabled: boolean; shortcut?: string };
type Question = { id: string; taskId: string; applicationId?: string; fieldName?: string; text: string; state: 'pending' | 'answered' | 'cancelled'; answer?: string; appliedAt?: string; applicationSyncError?: string; createdAt: string; deadline?: string };
type Application = { id: string; jobId: string; title: string; company: string; originalUrl: string; status: 'draft' | 'awaiting_approval' | 'approved' | 'submitting' | 'submission_uncertain' | 'submitted'; answers: Record<string, string>; approvedAt?: string;
  submission?: { pageUrl: string; confirmationText?: string; confirmedAt?: string; error?: string } };
const statusLabel: Record<string, string> = { unassigned: 'aguardando execução', queued: 'na fila', dispatching: 'em processamento', sent: 'instrução aceita pelo Codex', waiting_input: 'aguardando resposta', paused: 'pausada', done: 'concluída', result_ready: 'resposta local pronta para revisão', failed: 'erro na execução', interrupted: 'execução interrompida; requer revisão', cancelled: 'cancelada' };
const preferenceLabel: Record<string, string> = { title: 'cargo', mode: 'modalidade', location: 'localidade', seniority: 'experiência',
  area: 'área profissional', requiredTerms: 'requisitos obrigatórios', keywords: 'palavras-chave', salary: 'salário' };

const css = `
#projecthub-open{position:fixed;right:16px;top:72px;z-index:80;background:#3e326d;color:#fff;border:2px solid #a697e2;padding:9px 14px;font:600 16px 'Pixelify Sans',sans-serif;cursor:pointer}
#projecthub-panel{position:fixed;inset:5vh 5vw;z-index:100;background:#171a27;color:#f5f3ff;border:3px solid #a697e2;box-shadow:0 15px 60px #000b;padding:20px;overflow:hidden;display:flex;flex-direction:column;font:16px system-ui,sans-serif}
#projecthub-panel[hidden]{display:none}#projecthub-panel h2{font:600 25px 'Pixelify Sans',sans-serif;margin:0 0 14px}
#projecthub-panel form{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0 22px;align-items:end}#projecthub-panel label{display:grid;gap:4px;min-width:170px;flex:1}
#projecthub-panel input,#projecthub-panel select,#projecthub-panel textarea{background:#282d40;color:white;border:1px solid #717899;padding:9px;font:inherit}
#projecthub-panel button{background:#6655ad;color:white;border:1px solid #a697e2;padding:9px 12px;cursor:pointer;font:inherit}
#hub-job-preferences{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));align-items:start!important}
#hub-job-preferences label{min-width:0}#hub-job-preferences select[multiple]{min-height:100px}
#hub-job-preferences textarea{min-height:82px}#hub-job-preferences button{align-self:end}
#projecthub-panel ul{padding-left:22px}#projecthub-panel li{margin:7px 0}#projecthub-panel small{color:#b9c2d9}
#projecthub-panel .hub-head{display:flex;justify-content:space-between;align-items:center}#projecthub-message{min-height:1.4em;color:#ffe4a0}
#hub-nav{display:flex;gap:8px;align-items:center;overflow-x:auto;flex:none;border-bottom:1px solid #717899;padding:8px 0;white-space:nowrap}
#hub-nav [role=tablist]{display:flex;gap:6px}#projecthub-panel #hub-nav button{font:600 15px 'Pixelify Sans',sans-serif;white-space:nowrap}
#projecthub-panel #hub-nav [aria-selected=true]{background:#ad9de8;color:#161425;border-color:#e4dcff}
#projecthub-panel .hub-view{overflow:auto;min-height:0;flex:1;padding:0 3px 12px}#projecthub-panel .hub-view[hidden]{display:none}
@media(max-width:680px){#projecthub-panel{inset:1vh 1vw;padding:10px}#projecthub-panel h2{font-size:20px}#projecthub-panel .hub-view{padding:0 2px 8px}}
`;

async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result as T;
}

export function mountHubPanel(): void {
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  const open = document.createElement('button'); open.id = 'projecthub-open'; open.textContent = 'Agentes e tarefas';
  const panel = document.createElement('section'); panel.id = 'projecthub-panel'; panel.hidden = true;
  panel.innerHTML = `<div class="hub-head"><h2>ProjetoHUB · Agentes e tarefas</h2><button type="button" data-close>Fechar</button></div>
    <p>O escritório mostra sessões reais do Codex. Agentes sem sessão vinculada executam tarefas textuais pelo modelo escolhido ou pelo Ollama local automático.</p>
    <h3 data-hub-view="agents">Criar agente</h3><form id="hub-agent-form"><label>Nome<input name="name" maxlength="100" required></label><label>Objetivo<input name="objective" maxlength="2000" required></label><label>Sessão Codex existente (opcional)<select name="session"><option value="">Sem vínculo</option></select></label><label>Modelo para agente sem Codex<select name="modelId"><option value="">Ollama local automático</option></select></label><label>Reserva 1<select name="backup1"><option value="">Nenhuma</option></select></label><label>Reserva 2<select name="backup2"><option value="">Nenhuma</option></select></label><label>Reserva 3<select name="backup3"><option value="">Nenhuma</option></select></label><label>Subagente de (opcional)<select name="parent"><option value="">Agente principal</option></select></label><label>Chamadas de IA por mês (opcional)<input name="monthlyAiRequestLimit" type="number" min="1" max="1000000" step="1"></label><label>Custo estimado de IA por mês em USD (opcional)<input name="monthlyAiCostLimitUsd" type="number" min="0.01" step="any"></label><button>Criar agente</button></form><small>Reservas são tentadas na ordem escolhida após falha recuperável do modelo principal. Configure apenas provedores que autoriza a receber o conteúdo das tarefas. Os limites por agente valem para chamadas pelo roteador de IA; a sessão Codex segue as cotas oficiais.</small>
    <h3 data-hub-view="tasks">Nova tarefa</h3><form id="hub-task-form"><label>Agente<select name="agent" required></select></label><label>Instrução ou termo de busca<input name="instruction" maxlength="10000" required></label><label id="hub-task-job-label" hidden>Vaga para analisar<select name="jobId"></select></label><label>Prioridade<select name="priority"><option value="1">1 · Baixa</option><option value="2">2</option><option value="3" selected>3 · Normal</option><option value="4">4</option><option value="5">5 · Alta</option></select></label><button>Criar tarefa</button></form><p id="hub-task-hint"></p>
    <form id="hub-execution-form"><label>Execuções simultâneas<select name="maxConcurrent"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label><button>Salvar limite</button></form><p id="hub-execution-status"></p>
    <h3 data-hub-view="tasks">Perguntas pendentes</h3><p>Para preencher um campo do rascunho com a resposta, escolha a candidatura e informe o nome do campo. A resposta não autoriza o envio; revise o rascunho e aprove novamente.</p><form id="hub-question-form"><label>Tarefa<select name="task" required></select></label><label>Pergunta<input name="text" maxlength="2000" required></label><label>Candidatura (opcional)<select name="applicationId"><option value="">Sem candidatura</option></select></label><label id="hub-question-field-label" hidden>Campo da candidatura<input name="fieldName" maxlength="100" placeholder="Ex.: Disponibilidade"></label><button>Registrar pergunta</button></form><ul id="hub-questions"></ul>
    <h3 data-hub-view="settings">WhatsApp · Evolution API</h3><p>A instância lógica é procura-de-emprego. Configure os números com DDI e DDD. Com a chave, token e recebimento ativos, perguntas pendentes são enviadas automaticamente; confira o destino antes de salvar.</p>
    <form id="hub-evolution-form"><label>URL da Evolution API<input name="baseUrl" type="url" required placeholder="http://127.0.0.1:8080"></label><label>Chave da Evolution API<input name="apiKey" type="password" autocomplete="new-password" placeholder="Deixe vazio para manter a chave atual"></label><button>Salvar conexão</button></form><button type="button" data-evolution-clear>Remover chave salva neste Windows</button><p id="hub-evolution-status"></p>
    <form id="hub-whatsapp-form"><label>Número principal (destino)<input name="mainNumber" inputmode="numeric" pattern="[0-9]{10,15}" required></label><label>Número secundário (instância)<input name="secondaryNumber" inputmode="numeric" pattern="[0-9]{10,15}" required></label><button>Salvar números</button></form>
    <form id="hub-whatsapp-summary"><label><span>Enviar resumo diário</span><input name="enabled" type="checkbox"></label><label>Horário no fuso deste computador<select name="hour"></select></label><button>Salvar horário</button></form><p id="hub-whatsapp-summary-status"></p>
    <div><button type="button" data-instance-create>Criar somente procura-de-emprego</button> <button type="button" data-instance-connect>Mostrar QR para parear</button></div><p id="hub-instance-status"></p><img id="hub-instance-qr" alt="QR de pareamento da instância procura-de-emprego" hidden style="max-width:260px;image-rendering:pixelated">
    <form id="hub-listener-form"><label>Porta para receber respostas<input name="port" type="number" min="1" max="65535" required></label><label><span>Ativar recebimento</span><input name="enabled" type="checkbox"></label><label><span>Permitir acesso pela rede local (Evolution em Docker)</span><input name="exposeLan" type="checkbox"></label><button>Salvar recebimento</button></form><p id="hub-listener-status"></p>
    <p id="hub-whatsapp-status"></p><h4>Avisos de vagas e candidaturas</h4><ul id="hub-whatsapp-notifications"></ul><button type="button" data-whatsapp-diagnostics>Verificar Evolution API</button> <button type="button" data-whatsapp-token>Gerar token para configuração manual (invalida o anterior)</button><p id="hub-whatsapp-diagnostics"></p><p id="hub-whatsapp-token"></p>
    <form id="hub-webhook-form"><label>URL do webhook acessível à Evolution<input name="url" type="url" required placeholder="http://host.docker.internal:4770/webhook/evolution"></label><button>Configurar webhook desta instância</button></form><p id="hub-webhook-result"></p>
    <p>Depois de salvar os números e a chave, crie ou consulte somente <strong>procura-de-emprego</strong> pelo botão acima. Leia o QR com o número secundário. Também é possível usar o <a id="hub-evolution-manager" href="http://127.0.0.1:8080/manager" target="_blank" rel="noopener noreferrer" style="color:#c9bdff">Evolution Manager</a>. O webhook automático configura MESSAGES_UPSERT e uma chave de recebimento somente nesta instância. Ative a porta do listener antes de usar este botão. O listener precisa estar acessível à Evolution API.</p>
    <h3 data-hub-view="settings">Controle remoto MCP</h3><p id="hub-mcp-status"></p><p id="hub-github-status"></p><p id="hub-admin-session"></p><label>Ao completar 12 horas<select id="hub-admin-policy"><option value="notify">Avisar e manter túnel</option><option value="renew">Renovar automaticamente</option><option value="close">Fechar túnel</option></select></label><button type="button" data-session-policy>Salvar política</button> <button type="button" data-session-renew>Renovar sessão agora</button><p><button type="button" data-mcp-key>Gerar ou revogar chave administrativa</button> <button type="button" data-mcp-copy>Copiar configuração de conexão</button></p><p id="hub-mcp-key"></p><small>A chave aparece uma vez. Gerar novamente revoga a anterior. O endereço local só funciona neste computador; acesso externo requer túnel e cliente MCP compatível com autenticação Bearer.</small>
    <h3 data-hub-view="settings">Backups locais</h3><p>O escritório cria uma cópia do estado a cada 24 horas. Restaurar uma cópia substitui os dados do ProjetoHUB na próxima abertura do serviço; uma cópia de segurança do estado atual é criada antes.</p><button type="button" data-backup-create>Criar backup agora</button><p id="hub-backup-status"></p><ul id="hub-backups"></ul><small>O perfil do navegador, as chaves externas e a chave administrativa MCP não entram no backup. Guarde as cópias locais em um disco protegido.</small>
    <h3 data-hub-view="settings">Inicialização do Windows</h3><p id="hub-windows-startup-status"></p><button type="button" data-windows-startup>Alterar inicialização automática</button>
    <h3 data-hub-view="settings">Perfil profissional</h3><p>Informe apenas dados verdadeiros. Cada linha é uma competência, experiência ou formação. Após editar, confirme novamente o perfil para permitir a pontuação das vagas.</p>
    <form id="hub-profile-form"><label>Competências<textarea name="skills" rows="4" placeholder="Excel&#10;Atendimento"></textarea></label><label>Experiência<textarea name="experience" rows="4"></textarea></label><label>Formação<textarea name="education" rows="4"></textarea></label><button>Salvar perfil</button></form>
    <button type="button" data-confirm-profile>Confirmo que estes dados são meus e estão corretos</button><p id="hub-profile-status"></p>
    <h3 data-hub-view="jobs">Vagas</h3><p>Defina as preferências usadas na pesquisa. Modalidade e localidade desconhecidas ficam para sua revisão; salário é uma referência, sem filtro automático entre moedas ou períodos.</p>
    <form id="hub-job-preferences"><label>Cargo<input name="title" maxlength="100" placeholder="Ex.: Assistente"></label><label>Localidade<input name="location" maxlength="100" placeholder="Ex.: São Paulo"></label><label>Modalidade<select name="modes" multiple size="3"><option value="remote">Remoto</option><option value="hybrid">Híbrido</option><option value="onsite">Presencial</option></select></label><label>Experiência<select name="seniority"><option value="any">Qualquer ou não informada</option><option value="junior">Júnior</option><option value="mid">Pleno</option><option value="senior">Sênior</option></select></label><label>Salário desejado<input name="desiredSalary" maxlength="100" placeholder="Ex.: R$ 2.000/mês"></label><label>Área profissional<input name="area" maxlength="100" placeholder="Ex.: Administrativo"></label><label>Requisitos obrigatórios (um por linha)<textarea name="requiredTerms" rows="3"></textarea></label><label>Empresas preferenciais (uma por linha)<textarea name="preferredCompanies" rows="3"></textarea></label><label>Palavras-chave (uma por linha)<textarea name="keywords" rows="3"></textarea></label><button>Salvar preferências</button></form><p id="hub-job-preferences-status"></p>
    <form id="hub-job-form"><label>Pesquisar na Remotive<input name="query" maxlength="100" required placeholder="Ex.: assistente, suporte, júnior"></label><button>Buscar vagas</button></form>
    <h3 data-hub-view="jobs">Páginas de carreira Greenhouse</h3><form id="hub-greenhouse-form"><label>Endereço público do quadro<input name="url" type="url" required placeholder="https://job-boards.greenhouse.io/empresa"></label><button>Cadastrar página</button></form><ul id="hub-greenhouse-boards"></ul><form id="hub-greenhouse-search"><label>Pesquisar nas páginas cadastradas<input name="query" maxlength="100" required placeholder="Ex.: assistente"></label><button>Buscar nas páginas</button></form>
    <h3 data-hub-view="jobs">${tr('Páginas de carreira Lever')}</h3><p>${tr('Cadastre somente páginas públicas escolhidas por você. O nome da empresa é informado por você; a Lever confirma a página e os anúncios, mas não fornece esse nome na API pública.')}</p><form id="hub-lever-form"><label>${tr('Endereço da página Lever')}<input name="url" type="url" required placeholder="https://jobs.lever.co/empresa"></label><label>${tr('Nome da empresa')}<input name="company" maxlength="300" required></label><button>${tr('Cadastrar página Lever')}</button></form><ul id="hub-lever-boards"></ul><form id="hub-lever-search"><label>${tr('Pesquisar nas páginas Lever')}<input name="query" maxlength="100" required placeholder="Ex.: assistente"></label><button>${tr('Buscar na Lever')}</button></form>
    <form id="hub-schedule-form"><label>Pesquisa automática<input name="query" maxlength="100" required placeholder="Termo de pesquisa"></label><label>Intervalo<select name="interval"><option value="6">6 horas</option><option value="12">12 horas</option><option value="24">24 horas</option></select></label><label><span>Ativar</span><input name="enabled" type="checkbox"></label><button>Salvar agenda</button></form><p id="hub-schedule-status"></p>
    <p>${tr('Fontes: Remotive e páginas Greenhouse ou Lever cadastradas por você. A Remotive tem limite de quatro tentativas por dia; as vagas exibidas levam ao anúncio original.')}</p>
    <h3 data-hub-view="applications">Candidaturas</h3><p>Respostas inseridas aqui devem ser confirmadas por você. Abra a página da vaga no navegador abaixo, faça login e acesse o formulário. O preparo tenta preencher campos com os mesmos rótulos das respostas. Revise tudo antes de autorizar e enviar. O sistema só marca como enviada quando a confirmação aparece na página.</p>
    <form id="hub-application-form"><label>Vaga<select name="job" required></select></label><button>Preparar candidatura</button></form><p>Na candidatura, escolha a aba do formulário e use “Inspecionar campos” para pedir dados obrigatórios ainda não confirmados. Perguntas podem seguir pelo WhatsApp quando o canal estiver configurado. Confira campos de arquivo, seleção e senha manualmente.</p><ul id="hub-applications"></ul>
    <h3 data-hub-view="browser">Navegador</h3><div><button type="button" data-browser-visible>Abrir visível</button> <button type="button" data-browser-headless>Abrir em segundo plano</button> <button type="button" data-browser-manual>Assumir controle</button> <button type="button" data-browser-stop>Fechar</button></div>
    <form id="hub-browser-form"><label>Endereço<input name="url" type="url" required placeholder="https://..."></label><button>Abrir página</button></form><p id="hub-browser-status"></p><ul id="hub-browser-pages"></ul>
    <h3 data-hub-view="settings">Modelos de IA</h3><p>No Windows, salve as chaves de API nesta conta pelo painel. O campo será apagado após salvar. Se o serviço já tiver uma chave no ambiente, ela tem prioridade. A autenticação do Codex não é usada como chave de API.</p>
    <form id="hub-credential-form"><label>Provedor<select name="provider"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Google Gemini</option><option value="deepseek">DeepSeek</option><option value="openrouter">OpenRouter</option></select></label><label>Chave de API<input name="key" type="password" autocomplete="new-password" maxlength="4096" required></label><button data-provider-save>Salvar chave</button><button type="button" data-provider-clear>Remover chave local</button></form><p id="hub-credential-status"></p>
    <form id="hub-model-form"><label>Provedor<select name="provider"><option value="openai">OpenAI · OPENAI_API_KEY</option><option value="anthropic">Anthropic · ANTHROPIC_API_KEY</option><option value="gemini">Gemini · GEMINI_API_KEY</option><option value="deepseek">DeepSeek · DEEPSEEK_API_KEY</option><option value="openrouter">OpenRouter · OPENROUTER_API_KEY</option><option value="ollama">Ollama local</option></select></label><label>Modelo<input name="model" required placeholder="Nome exato do modelo"></label><label>Prioridade<input name="priority" type="number" min="1" max="1000" value="1" required></label><label>Chamadas por mês (opcional)<input name="monthlyRequestLimit" type="number" min="1" max="1000000" step="1"></label><label>USD por 1 milhão de tokens de entrada<input name="inputUsdPerMillion" type="number" min="0" step="any"></label><label>USD por 1 milhão de tokens de saída<input name="outputUsdPerMillion" type="number" min="0" step="any"></label><label>Teto mensal estimado em USD<input name="monthlyCostLimitUsd" type="number" min="0.01" step="any"></label><button>Cadastrar modelo</button></form><small>Preços são informados por você. Confira a tabela do provedor; o custo exibido é estimado a partir dos tokens informados por ele. Para usar teto em USD, preencha ambos os preços.</small>
    <p id="hub-router-status"></p><ul id="hub-models"></ul>
    <form id="hub-model-test"><label>Teste do roteador<input name="prompt" maxlength="2000" required placeholder="Escreva uma pergunta"></label><button>Testar modelo</button></form><p id="hub-model-result"></p>
    <p id="projecthub-message" role="status"></p><h3 data-hub-view="agents">Agentes</h3><ul id="hub-agents"></ul><h3 data-hub-view="tasks">Tarefas</h3><ul id="hub-tasks"></ul><h3 data-hub-view="jobs">Vagas encontradas</h3><ul id="hub-jobs"></ul>`;
  document.body.append(open, panel);
  mountHubNavigation(panel, () => (panel.querySelector('[data-close]') as HTMLButtonElement).click());
  const office = mountAgentOffice(document.getElementById('world') as HTMLCanvasElement, panel, () => open.click());
  const message = panel.querySelector('#projecthub-message') as HTMLElement;
  const agentForm = panel.querySelector('#hub-agent-form') as HTMLFormElement;
  const taskForm = panel.querySelector('#hub-task-form') as HTMLFormElement;
  const executionForm = panel.querySelector('#hub-execution-form') as HTMLFormElement;
  const questionForm = panel.querySelector('#hub-question-form') as HTMLFormElement;
  const whatsappForm = panel.querySelector('#hub-whatsapp-form') as HTMLFormElement;
  const summaryForm = panel.querySelector('#hub-whatsapp-summary') as HTMLFormElement;
  const summaryHour = summaryForm.elements.namedItem('hour') as HTMLSelectElement;
  const evolutionForm = panel.querySelector('#hub-evolution-form') as HTMLFormElement;
  const listenerForm = panel.querySelector('#hub-listener-form') as HTMLFormElement;
  const webhookForm = panel.querySelector('#hub-webhook-form') as HTMLFormElement;
  const profileForm = panel.querySelector('#hub-profile-form') as HTMLFormElement;
  const applicationForm = panel.querySelector('#hub-application-form') as HTMLFormElement;
  const jobForm = panel.querySelector('#hub-job-form') as HTMLFormElement;
  const jobPreferencesForm = panel.querySelector('#hub-job-preferences') as HTMLFormElement;
  const greenhouseForm = panel.querySelector('#hub-greenhouse-form') as HTMLFormElement;
  const greenhouseSearch = panel.querySelector('#hub-greenhouse-search') as HTMLFormElement;
  const leverForm = panel.querySelector('#hub-lever-form') as HTMLFormElement;
  const leverSearch = panel.querySelector('#hub-lever-search') as HTMLFormElement;
  const scheduleForm = panel.querySelector('#hub-schedule-form') as HTMLFormElement;
  const browserForm = panel.querySelector('#hub-browser-form') as HTMLFormElement;
  const modelForm = panel.querySelector('#hub-model-form') as HTMLFormElement;
  const credentialForm = panel.querySelector('#hub-credential-form') as HTMLFormElement;
  const modelTest = panel.querySelector('#hub-model-test') as HTMLFormElement;
  const sessions = agentForm.elements.namedItem('session') as HTMLSelectElement;
  const agentModel = agentForm.elements.namedItem('modelId') as HTMLSelectElement;
  const agentBackups = [1, 2, 3].map((index) => agentForm.elements.namedItem(`backup${index}`) as HTMLSelectElement);
  const syncAgentModels = () => {
    agentModel.disabled = Boolean(sessions.value);
    if (agentModel.disabled) agentModel.value = '';
    for (const backup of agentBackups) {
      backup.disabled = agentModel.disabled || !agentModel.value;
      if (backup.disabled || backup.value === agentModel.value) backup.value = '';
    }
  };
  const parents = agentForm.elements.namedItem('parent') as HTMLSelectElement;
  const agentsSelect = taskForm.elements.namedItem('agent') as HTMLSelectElement;
  const taskInstruction = taskForm.elements.namedItem('instruction') as HTMLInputElement;
  const taskJobLabel = panel.querySelector('#hub-task-job-label') as HTMLLabelElement;
  const taskJobSelect = taskForm.elements.namedItem('jobId') as HTMLSelectElement;
  const questionTasks = questionForm.elements.namedItem('task') as HTMLSelectElement;
  const questionApplications = questionForm.elements.namedItem('applicationId') as HTMLSelectElement;
  const questionFieldLabel = panel.querySelector('#hub-question-field-label') as HTMLLabelElement;
  const questionField = questionForm.elements.namedItem('fieldName') as HTMLInputElement;
  const updateQuestionField = () => { questionFieldLabel.hidden = !questionApplications.value; questionField.required = Boolean(questionApplications.value); };
  const applicationJobs = applicationForm.elements.namedItem('job') as HTMLSelectElement;
  let choices: { thread: string; home: string }[] = [];
  let currentMcpKey: string | undefined;
  let currentMcpUrl = 'http://127.0.0.1:4748/mcp';
  let suggestedWebhookUrl = '';
  let providerStatuses: ProviderCredentialStatus = {};
  let confirmedProfileRevision: string | undefined;
  const option = (select: HTMLSelectElement, value: string, label: string) => { const o = document.createElement('option'); o.value = value; o.textContent = label; select.append(o); };
  for (let hour = 0; hour < 24; hour++) option(summaryHour, String(hour), `${String(hour).padStart(2, '0')}:00`);
  const updateTaskFields = () => {
    const role = agentsSelect.selectedOptions[0]?.dataset.systemKey;
    const researcher = role === 'job-search/researcher';
    const analyst = role === 'job-search/requirements';
    const evaluator = role === 'job-search/compatibility';
    const specialist = role === 'job-search/applications';
    taskInstruction.parentElement!.hidden = analyst || evaluator || specialist;
    taskInstruction.required = !analyst && !evaluator && !specialist;
    taskInstruction.disabled = analyst || evaluator || specialist;
    taskInstruction.placeholder = researcher ? 'Termo de busca nas fontes cadastradas, até 100 caracteres' : 'Descreva a tarefa';
    taskInstruction.maxLength = researcher ? 100 : 10_000;
    taskJobLabel.hidden = !analyst && !evaluator && !specialist;
    taskJobSelect.required = analyst || evaluator || specialist;
    for (const item of taskJobSelect.options) item.disabled = evaluator && item.dataset.analyzed !== 'true';
    if (taskJobSelect.selectedOptions[0]?.disabled) taskJobSelect.value = [...taskJobSelect.options].find((item) => !item.disabled)?.value ?? '';
    (panel.querySelector('#hub-task-hint') as HTMLElement).textContent = researcher
      ? tr('Pesquisador de vagas: informe apenas o termo de busca. A consulta usa a Remotive e as páginas Greenhouse e Lever cadastradas, registrando somente anúncios retornados pelas fontes.')
      : analyst ? 'Analista de requisitos: escolha uma vaga salva. A extração usa o modelo escolhido no agente ou Ollama local e confere cada requisito no anúncio.'
        : evaluator ? 'Avaliador: escolha uma vaga já analisada e confirme seu perfil profissional. A comparação usa apenas dados confirmados e não chama modelo.'
          : specialist ? 'Especialista em candidaturas: escolha uma vaga salva. A tarefa cria somente um rascunho; respostas e envio exigem sua revisão e aprovação.' : '';
  };

  async function refresh(): Promise<void> {
    const [agents, tasks, execution, questions, whatsapp, evolution, listener, profile, jobs, applications, schedule, browser, router, credentials, mcp, adminSession, backups, windowsStartup, snapshot, health, greenhouseBoards, leverBoards, jobPreferences] = await Promise.all([
      api<Agent[]>('/api/hub/agents'), api<Task[]>('/api/hub/tasks'), api<ExecutionStatus>('/api/hub/execution'),
      api<Question[]>('/api/hub/questions'),
      api<WhatsAppStatus>('/api/hub/whatsapp'),
      api<EvolutionStatus>('/api/hub/whatsapp/settings'),
      api<WebhookListenerStatus>('/api/hub/whatsapp/listener'),
      api<Profile>('/api/hub/profile'),
      api<Job[]>('/api/hub/jobs'),
      api<Application[]>('/api/hub/applications'),
      api<Schedule>('/api/hub/jobs/schedule'),
      api<BrowserStatus>('/api/hub/browser'),
      api<RouterStatus>('/api/hub/router'),
      api<ProviderCredentialStatus>('/api/hub/router/credentials'),
      api<McpStatus>('/api/hub/mcp'),
      api<AdminSession>('/api/hub/mcp/session'),
      api<BackupStatus>('/api/hub/backups'),
      api<WindowsStartupStatus>('/api/hub/windows/startup'),
      api<{ agents: Session[] }>('/api/snapshot'), api<{ sources: Source[] }>('/api/health'),
      api<GreenhouseBoard[]>('/api/hub/jobs/greenhouse/boards'),
      api<LeverBoard[]>('/api/hub/jobs/lever/boards'),
      api<JobSearchPreferences>('/api/hub/jobs/preferences'),
    ]);
    office.update(agents, tasks);
    if (!jobPreferencesForm.contains(document.activeElement)) {
      for (const name of ['title', 'location', 'desiredSalary', 'area', 'seniority'] as const)
        (jobPreferencesForm.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value = jobPreferences[name];
      for (const name of ['requiredTerms', 'preferredCompanies', 'keywords'] as const)
        (jobPreferencesForm.elements.namedItem(name) as HTMLTextAreaElement).value = jobPreferences[name].join('\n');
      for (const option of (jobPreferencesForm.elements.namedItem('modes') as HTMLSelectElement).options)
        option.selected = jobPreferences.modes.includes(option.value);
    }
    (panel.querySelector('#hub-job-preferences-status') as HTMLElement).textContent = jobPreferences.title || jobPreferences.location || jobPreferences.modes.length || jobPreferences.requiredTerms.length || jobPreferences.keywords.length || jobPreferences.area || jobPreferences.seniority !== 'any' || jobPreferences.desiredSalary || jobPreferences.preferredCompanies.length
      ? 'Preferências ativas. Vagas com conflito explícito são excluídas das próximas pesquisas; anúncios já salvos continuam visíveis com sua avaliação atual.'
      : 'Sem filtros de pesquisa ativos.';
    const boardList = panel.querySelector('#hub-greenhouse-boards')!; boardList.replaceChildren();
    for (const board of greenhouseBoards) {
      const item = document.createElement('li');
      item.textContent = `${board.company} · ${board.token}${board.lastError ? ` · erro: ${board.lastError}` : board.lastSearchedAt ? ` · consultada em ${new Date(board.lastSearchedAt).toLocaleString('pt-BR')}` : ' · ainda não consultada'} `;
      const remove = document.createElement('button'); remove.textContent = 'Remover';
      remove.onclick = () => void api(`/api/hub/jobs/greenhouse/boards/${encodeURIComponent(board.token)}`, undefined, 'DELETE').then(refresh).catch(showError);
      item.append(remove); boardList.append(item);
    }
    const leverList = panel.querySelector('#hub-lever-boards')!; leverList.replaceChildren();
    for (const board of leverBoards) {
      const item = document.createElement('li');
      item.textContent = `${board.company} · ${board.region}/${board.site}${board.lastError ? ` · ${tr('erro')}: ${board.lastError}` : board.lastSearchedAt ? ` · ${tr('consultada em')} ${new Date(board.lastSearchedAt).toLocaleString('pt-BR')}` : ` · ${tr('ainda não consultada')}`} `;
      const remove = document.createElement('button'); remove.textContent = tr('Remover');
      remove.onclick = () => void api(`/api/hub/jobs/lever/boards/${board.region}/${encodeURIComponent(board.site)}`, undefined, 'DELETE').then(refresh).catch(showError);
      item.append(remove); leverList.append(item);
    }
    if (!executionForm.contains(document.activeElement)) (executionForm.elements.namedItem('maxConcurrent') as HTMLSelectElement).value = String(execution.maxConcurrent);
    (panel.querySelector('#hub-execution-status') as HTMLElement).textContent = `${execution.active} de ${execution.maxConcurrent} execução(ões) em andamento`;
    (panel.querySelector('#hub-windows-startup-status') as HTMLElement).textContent = windowsStartup.supported
      ? windowsStartup.enabled ? 'O escritório abrirá ao entrar no Windows.' : 'Inicialização automática desligada.'
      : 'Esta opção está disponível no Windows.';
    const startupButton = panel.querySelector('[data-windows-startup]') as HTMLButtonElement;
    startupButton.disabled = !windowsStartup.supported;
    startupButton.textContent = windowsStartup.enabled ? 'Desligar inicialização automática' : 'Iniciar com o Windows';
    (panel.querySelector('#hub-backup-status') as HTMLElement).textContent = backups.pendingRestore
      ? 'Restauração agendada. Feche e abra novamente o serviço para aplicar a cópia.' : `${backups.backups.length} cópia(s) local(is).`;
    const backupList = panel.querySelector('#hub-backups')!; backupList.replaceChildren();
    for (const backup of backups.backups.slice(0, 20)) {
      const li = document.createElement('li');
      li.textContent = `${new Date(backup.createdAt).toLocaleString('pt-BR')} · ${(backup.size / 1024).toFixed(0)} KB `;
      const restore = document.createElement('button'); restore.textContent = 'Restaurar na próxima abertura';
      restore.onclick = () => {
        if (!window.confirm('Restaurar esta cópia na próxima abertura do serviço? O estado atual será guardado em outra cópia.')) return;
        void api('/api/hub/backups/restore', { id: backup.id }).then(refresh).catch(showError);
      };
      li.append(restore); backupList.append(li);
    }
    currentMcpUrl = mcp.ngrok?.running && mcp.ngrok.mcpUrl ? mcp.ngrok.mcpUrl : `http://127.0.0.1:${mcp.port}/mcp`;
    (panel.querySelector('#hub-mcp-status') as HTMLElement).textContent = `MCP ${mcp.configured ? 'com chave configurada' : 'aguardando chave'} · ${currentMcpUrl} · ngrok ${mcp.ngrok?.running ? 'conectado e verificado' : mcp.ngrok?.installed ? mcp.ngrok.error ?? 'aguardando conexão' : 'não instalado'}`;
    (panel.querySelector('#hub-github-status') as HTMLElement).textContent = `GitHub: ${mcp.github?.configured ? mcp.github.lastError ? `falha na publicação (${mcp.github.lastError})` : mcp.github.lastPublishAt ? `última publicação ${new Date(mcp.github.lastPublishAt).toLocaleString('pt-BR')}` : 'publicação ainda não confirmada' : 'publicação automática não configurada'}.`;
    const hours = Math.floor(adminSession.remainingSeconds / 3600), minutes = Math.floor(adminSession.remainingSeconds % 3600 / 60), seconds = adminSession.remainingSeconds % 60;
    (panel.querySelector('#hub-admin-session') as HTMLElement).textContent = `Sessão administrativa ${adminSession.expired ? 'expirada' : `restante ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`} · instalação ${adminSession.installationId.slice(0, 8)}.`;
    const policySelect = panel.querySelector('#hub-admin-policy') as HTMLSelectElement;
    if (document.activeElement !== policySelect) policySelect.value = adminSession.policy;
    if (!whatsappForm.contains(document.activeElement)) {
      (whatsappForm.elements.namedItem('mainNumber') as HTMLInputElement).value = whatsapp.mainNumber ?? '';
      (whatsappForm.elements.namedItem('secondaryNumber') as HTMLInputElement).value = whatsapp.secondaryNumber ?? '';
    }
    if (!summaryForm.contains(document.activeElement)) {
      (summaryForm.elements.namedItem('enabled') as HTMLInputElement).checked = whatsapp.summary.enabled;
      summaryHour.value = String(whatsapp.summary.hour);
    }
    (panel.querySelector('#hub-whatsapp-summary-status') as HTMLElement).textContent = whatsapp.summary.enabled
      ? `Resumo diário ativo às ${String(whatsapp.summary.hour).padStart(2, '0')}:00 no horário deste computador${whatsapp.summary.lastDate ? ` · último dia preparado: ${whatsapp.summary.lastDate}` : ''}.`
      : 'Resumo diário desligado. Configure os dois números antes de ativar.';
    if (!evolutionForm.contains(document.activeElement)) (evolutionForm.elements.namedItem('baseUrl') as HTMLInputElement).value = evolution.baseUrl;
    if (!listenerForm.contains(document.activeElement)) {
      (listenerForm.elements.namedItem('port') as HTMLInputElement).value = String(listener.port);
      (listenerForm.elements.namedItem('enabled') as HTMLInputElement).checked = listener.enabled;
      (listenerForm.elements.namedItem('exposeLan') as HTMLInputElement).checked = listener.exposeLan;
    }
    (panel.querySelector('#hub-listener-status') as HTMLElement).textContent = listener.running
      ? `Recebimento ativo na porta ${listener.port}${listener.exposeLan ? ' para a rede local' : ' somente neste computador'}.`
      : listener.enabled ? `Recebimento indisponível: ${listener.error ?? 'aguardando nova tentativa'}.` : 'Recebimento desligado.';
    providerStatuses = credentials;
    const chosenProvider = (credentialForm.elements.namedItem('provider') as HTMLSelectElement).value;
    const chosenCredential = credentials[chosenProvider];
    (credentialForm.elements.namedItem('key') as HTMLInputElement).disabled = chosenCredential?.source === 'environment';
    (credentialForm.querySelector('[data-provider-save]') as HTMLButtonElement).disabled = chosenCredential?.source === 'environment';
    (credentialForm.querySelector('[data-provider-clear]') as HTMLButtonElement).disabled = chosenCredential?.source !== 'windows';
    (panel.querySelector('#hub-credential-status') as HTMLElement).textContent = Object.entries(credentials).map(([name, state]) => `${name}: ${state.source === 'windows' ? 'chave protegida no Windows' : state.source === 'environment' ? 'chave do ambiente' : 'chave pendente'}`).join(' · ');
    (panel.querySelector('#hub-evolution-manager') as HTMLAnchorElement).href = `${evolution.baseUrl}/manager`;
    (panel.querySelector('#hub-evolution-status') as HTMLElement).textContent = `${evolution.baseUrl} · ${evolution.apiKeySource === 'windows' ? 'chave protegida para este usuário do Windows' : evolution.apiKeySource === 'environment' ? 'chave fornecida pelo ambiente do serviço' : 'chave pendente'}.`;
    const evolutionKeyInput = evolutionForm.elements.namedItem('apiKey') as HTMLInputElement;
    evolutionKeyInput.disabled = evolution.apiKeySource === 'environment';
    evolutionKeyInput.placeholder = evolution.apiKeySource === 'environment' ? 'Remova EVOLUTION_API_KEY do ambiente para usar o painel' : 'Deixe vazio para manter a chave atual';
    (panel.querySelector('[data-evolution-clear]') as HTMLButtonElement).disabled = evolution.apiKeySource !== 'windows';
    (panel.querySelector('#hub-whatsapp-status') as HTMLElement).textContent = `${whatsapp.instance} · ${whatsapp.mainNumber && whatsapp.secondaryNumber ? 'números configurados' : 'números pendentes'} · ${whatsapp.apiKeyConfigured ? 'chave Evolution detectada' : 'chave Evolution não configurada'} · ${whatsapp.webhookTokenConfigured ? 'token do webhook gerado' : 'token do webhook pendente'} · ${whatsapp.webhookPort ? `porta do webhook ${whatsapp.webhookPort}` : 'listener do webhook desligado'}.`;
    const notificationList = panel.querySelector('#hub-whatsapp-notifications') as HTMLUListElement;
    notificationList.replaceChildren();
    const notificationLabels: Record<string, string> = { job_found: 'Nova vaga', application_started: 'Rascunho criado',
      approval_needed: 'Aprovação necessária', submission_started: 'Envio iniciado',
      application_submitted: 'Envio confirmado', submission_uncertain: 'Envio incerto', task_error: 'Erro em tarefa', daily_summary: 'Resumo diário' };
    const notificationStates: Record<string, string> = { pending: 'aguardando canal', sending: 'enviando', failed: 'falhou', superseded: 'substituído por resumo mais recente' };
    for (const notification of (whatsapp.notifications ?? []).slice(-20).reverse()) {
      const item = document.createElement('li');
      item.textContent = `${notification.createdAt.slice(0, 16)} · ${notificationLabels[notification.type] ?? notification.type} · ${notification.state === 'accepted' ? 'aceito pela Evolution; entrega não confirmada' : notification.state === 'uncertain' ? 'resultado incerto; conferir na Evolution' : notificationStates[notification.state] ?? notification.state}${notification.error ? ` · ${notification.error}` : ''}\n${notification.text}`;
      notificationList.append(item);
    }
    if (!notificationList.childElementCount) { const item = document.createElement('li'); item.textContent = 'Nenhum aviso novo desde a ativação deste recurso.'; notificationList.append(item); }
    const canPair = Boolean(whatsapp.mainNumber && whatsapp.secondaryNumber && evolution.apiKeyConfigured);
    (webhookForm.querySelector('button') as HTMLButtonElement).disabled = !canPair || !whatsapp.webhookPort;
    const webhookUrl = webhookForm.elements.namedItem('url') as HTMLInputElement;
    const nextSuggestedUrl = `http://host.docker.internal:${listener.port}/webhook/evolution`;
    if (!webhookUrl.value || webhookUrl.value === suggestedWebhookUrl) webhookUrl.value = nextSuggestedUrl;
    suggestedWebhookUrl = nextSuggestedUrl;
    (panel.querySelector('[data-instance-create]') as HTMLButtonElement).disabled = !canPair;
    (panel.querySelector('[data-instance-connect]') as HTMLButtonElement).disabled = !canPair;
    if (!profileForm.contains(document.activeElement)) {
      for (const key of ['skills', 'experience', 'education'] as const) (profileForm.elements.namedItem(key) as HTMLTextAreaElement).value = profile[key].join('\n');
    }
    (panel.querySelector('#hub-profile-status') as HTMLElement).textContent = profile.confirmedAt
      ? `Perfil confirmado em ${new Date(profile.confirmedAt).toLocaleString('pt-BR')}. A pontuação compara apenas termos explícitos do anúncio.`
      : 'Perfil ainda não confirmado. Nenhuma compatibilidade será pontuada.';
    (panel.querySelector('#hub-router-status') as HTMLElement).textContent = `${router.usage.requests} resposta(s) · ${router.usage.inputTokens} tokens de entrada · ${router.usage.outputTokens} tokens de saída · custo estimado USD ${(router.usage.estimatedCostUsd ?? 0).toFixed(4)}${router.usage.unpricedRequests ? ` · ${router.usage.unpricedRequests} resposta(s) sem preço ou contagem completa` : ''}${router.lastError ? ` · Última falha: ${router.lastError}` : ''}`;
    const modelList = panel.querySelector('#hub-models')!; modelList.replaceChildren();
    for (const model of router.models) {
      const li = document.createElement('li');
      const limited = (model.monthlyRequestLimit !== undefined && model.monthlyUsage.requests >= model.monthlyRequestLimit) ||
        (model.monthlyCostLimitUsd !== undefined && (model.monthlyUsage.unpricedRequests > 0 || model.monthlyUsage.estimatedCostUsd >= model.monthlyCostLimitUsd));
      li.textContent = `${model.provider} / ${model.model} · prioridade ${model.priority} · ${!model.enabled ? 'desativado' : limited ? 'limite mensal atingido ou custo incerto' : model.provider === 'ollama' ? 'serviço local não verificado' : model.available ? 'credencial detectada; acesso não verificado' : 'credencial ausente'} · ${model.monthlyUsage.requests}${model.monthlyRequestLimit ? `/${model.monthlyRequestLimit}` : ''} chamada(s) em ${model.monthlyUsage.month} · ${model.monthlyUsage.inputTokens} entrada / ${model.monthlyUsage.outputTokens} saída · USD ${model.monthlyUsage.estimatedCostUsd.toFixed(4)} estimados `;
      const priority = document.createElement('input'); priority.type = 'number'; priority.min = '1'; priority.max = '1000'; priority.value = String(model.priority); priority.style.width = '5em'; priority.setAttribute('aria-label', `Prioridade de ${model.provider} / ${model.model}`);
      priority.onchange = () => void api(`/api/hub/router/models/${model.id}`, { priority: Number(priority.value) }, 'PATCH').then(refresh).catch(showError);
      const toggle = document.createElement('button'); toggle.textContent = model.enabled ? 'Desativar' : 'Ativar';
      toggle.onclick = () => void api(`/api/hub/router/models/${model.id}`, { enabled: !model.enabled }, 'PATCH').then(refresh).catch(showError);
      const remove = document.createElement('button'); remove.textContent = 'Remover';
      remove.onclick = () => void api(`/api/hub/router/models/${model.id}`, {}, 'DELETE').then(refresh).catch(showError);
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = 'Preços e limites'; details.append(summary);
      const policyForm = document.createElement('form');
      const fields = [
        ['monthlyRequestLimit', 'Chamadas por mês', 1], ['inputUsdPerMillion', 'USD por 1 milhão de tokens de entrada', 0],
        ['outputUsdPerMillion', 'USD por 1 milhão de tokens de saída', 0], ['monthlyCostLimitUsd', 'Teto mensal estimado em USD', 0.01],
      ] as const;
      for (const [name, label, min] of fields) {
        const wrap = document.createElement('label'); wrap.textContent = label;
        const input = document.createElement('input'); input.name = name; input.type = 'number'; input.min = String(min);
        input.step = name === 'monthlyRequestLimit' ? '1' : 'any'; input.value = model[name] === undefined ? '' : String(model[name]);
        wrap.append(input); policyForm.append(wrap);
      }
      const save = document.createElement('button'); save.textContent = 'Salvar limites'; policyForm.append(save);
      policyForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(policyForm);
        const values = Object.fromEntries(fields.map(([name]) => [name, data.get(name) === '' ? null : Number(data.get(name))]));
        void api(`/api/hub/router/models/${model.id}`, values, 'PATCH').then(refresh).catch(showError); };
      details.append(policyForm);
      li.append(priority, toggle, remove, details); modelList.append(li);
    }
    (panel.querySelector('#hub-browser-status') as HTMLElement).textContent = browser.running
      ? `Navegador ${browser.headless ? 'em segundo plano' : 'visível'} · ${browser.manual ? 'controle manual ativo; automação suspensa' : 'automação disponível'}`
      : 'Navegador fechado. O perfil permanece salvo neste computador.';
    (panel.querySelector('[data-browser-manual]') as HTMLButtonElement).textContent = browser.manual ? 'Retomar automação' : 'Assumir controle';
    const pageList = panel.querySelector('#hub-browser-pages')!; pageList.replaceChildren();
    for (const page of browser.pages) {
      const li = document.createElement('li'); li.textContent = `${page.url} `;
      const shot = document.createElement('a'); shot.href = `/api/hub/browser/pages/${page.id}/screenshot`; shot.target = '_blank'; shot.rel = 'noopener noreferrer'; shot.textContent = 'Captura de tela'; shot.style.color = '#c9bdff';
      li.append(shot); pageList.append(li);
    }
    if (!scheduleForm.contains(document.activeElement)) {
      (scheduleForm.elements.namedItem('query') as HTMLInputElement).value = schedule.query ?? '';
      (scheduleForm.elements.namedItem('interval') as HTMLSelectElement).value = String(schedule.intervalHours ?? 6);
      (scheduleForm.elements.namedItem('enabled') as HTMLInputElement).checked = schedule.enabled;
    }
    (panel.querySelector('#hub-schedule-status') as HTMLElement).textContent = schedule.enabled
      ? `Próxima consulta: ${schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString('pt-BR') : 'pendente'}${schedule.lastError ? ` · Último erro: ${schedule.lastError}` : ''}`
      : 'Pesquisa automática desligada.';
    const selectedAgentModel = agentModel.value;
    const selectedAgentBackups = agentBackups.map((select) => select.value);
    const selectedSession = sessions.value;
    const selectedTaskAgent = agentsSelect.value;
    const selectedTaskJob = taskJobSelect.value;
    sessions.length = 1; agentModel.length = 1; for (const select of agentBackups) select.length = 1;
    parents.length = 1; agentsSelect.length = 0; taskJobSelect.length = 0; questionTasks.length = 0; questionApplications.length = 1; choices = [];
    updateQuestionField();
    confirmedProfileRevision = profile.confirmedAt ? profile.revision : undefined;
    for (const job of jobs) { option(taskJobSelect, job.id, `${job.title} — ${job.company}`); taskJobSelect.options[taskJobSelect.length - 1].dataset.analyzed = String(Boolean(job.analyzedAt)); }
    if (selectedTaskJob && [...taskJobSelect.options].some((item) => item.value === selectedTaskJob)) taskJobSelect.value = selectedTaskJob;
    for (const model of router.models) {
      const label = `${model.provider} / ${model.model}${model.available ? '' : ' · indisponível'}`;
      option(agentModel, model.id, label);
      for (const select of agentBackups) option(select, model.id, label);
    }
    for (const app of applications.filter((item) => ['draft', 'awaiting_approval', 'approved'].includes(item.status)))
      option(questionApplications, app.id, `${app.title} — ${app.company}`);
    for (const session of snapshot.agents.filter((a) => a.provider === 'codex')) {
      const home = health.sources.find((s) => s.provider === 'codex' && s.label === session.account)?.path;
      if (!home || !session.sessionId) continue;
      const index = choices.push({ thread: session.sessionId, home }) - 1;
      option(sessions, String(index), `${session.name} · ${session.sessionId.slice(0, 8)}`);
    }
    sessions.value = selectedSession;
    agentModel.value = selectedAgentModel;
    for (const [index, select] of agentBackups.entries()) select.value = selectedAgentBackups[index];
    syncAgentModels();
    const agentList = panel.querySelector('#hub-agents')!; agentList.replaceChildren();
    for (const agent of agents) {
      if (agent.status !== 'ended') { option(parents, agent.id, agent.name); option(agentsSelect, agent.id, agent.name); agentsSelect.options[agentsSelect.length - 1].dataset.systemKey = agent.systemKey ?? ''; }
      const li = document.createElement('li'); li.textContent = `${agent.name} — ${agent.objective}`;
      const selectedModel = router.models.find((model) => model.id === agent.modelId);
      const detail = document.createElement('small'); detail.textContent = ` · ${agent.status === 'ended' ? 'encerrado' : agent.status === 'paused' ? 'pausado' : 'ativo'} · ${agent.codexThread ? 'Codex → Ollama quando indisponível' : agent.modelId ? selectedModel ? `${selectedModel.provider} / ${selectedModel.model}${selectedModel.available ? '' : ' · indisponível'}` : 'modelo removido · aguardando seleção' : 'Ollama local automático'}`; li.append(detail);
      if (agent.fallbackModelIds?.length) detail.textContent += ` · reservas: ${agent.fallbackModelIds.map((id) => { const model = router.models.find((item) => item.id === id); return model ? `${model.provider}/${model.model}` : 'modelo removido'; }).join(' → ')}`;
      const agentUsage = router.agentUsage?.[agent.id];
      if (agentUsage || agent.monthlyAiRequestLimit || agent.monthlyAiCostLimitUsd) detail.textContent += ` · IA roteada no mês: ${agentUsage?.requests ?? 0}${agent.monthlyAiRequestLimit ? `/${agent.monthlyAiRequestLimit}` : ''} chamada(s), USD ${(agentUsage?.estimatedCostUsd ?? 0).toFixed(4)} estimados${agent.monthlyAiCostLimitUsd ? `/${agent.monthlyAiCostLimitUsd}` : ''}${agentUsage?.unpricedRequests ? `, ${agentUsage.unpricedRequests} sem preço` : ''}`;
      if (agent.status !== 'ended') {
        const edit = document.createElement('form');
        const name = document.createElement('input'); name.value = agent.name; name.maxLength = 100; name.required = true; name.setAttribute('aria-label', 'Nome do agente');
        const objective = document.createElement('input'); objective.value = agent.objective; objective.maxLength = 2000; objective.required = true; objective.setAttribute('aria-label', 'Objetivo do agente');
        const sessionSelect = document.createElement('select'); sessionSelect.setAttribute('aria-label', 'Sessão Codex do agente');
        option(sessionSelect, '', 'Sem vínculo Codex');
        for (const [index, choice] of choices.entries()) option(sessionSelect, String(index), `Codex · ${choice.thread.slice(0, 8)}`);
        const linkedIndex = choices.findIndex((choice) => choice.thread === agent.codexThread && choice.home === agent.codexHome);
        if (agent.codexThread && linkedIndex < 0) option(sessionSelect, 'current', `Sessão vinculada indisponível · ${agent.codexThread.slice(0, 8)}`);
        sessionSelect.value = agent.codexThread ? linkedIndex < 0 ? 'current' : String(linkedIndex) : '';
        const modelSelect = document.createElement('select'); modelSelect.setAttribute('aria-label', 'Modelo do agente');
        option(modelSelect, '', 'Ollama local automático');
        for (const model of router.models) option(modelSelect, model.id, `${model.provider} / ${model.model}${model.available ? '' : ' · indisponível'}`);
        modelSelect.value = agent.modelId ?? '';
        const requestLimit = document.createElement('input'); requestLimit.type = 'number'; requestLimit.min = '1'; requestLimit.max = '1000000'; requestLimit.step = '1';
        requestLimit.value = agent.monthlyAiRequestLimit === undefined ? '' : String(agent.monthlyAiRequestLimit);
        const requestLabel = document.createElement('label'); requestLabel.textContent = 'Chamadas de IA por mês'; requestLabel.append(requestLimit);
        const costLimit = document.createElement('input'); costLimit.type = 'number'; costLimit.min = '0.01'; costLimit.step = 'any';
        costLimit.value = agent.monthlyAiCostLimitUsd === undefined ? '' : String(agent.monthlyAiCostLimitUsd);
        const costLabel = document.createElement('label'); costLabel.textContent = 'Custo estimado de IA por mês em USD'; costLabel.append(costLimit);
        const backups = [0, 1, 2].map((index) => {
          const label = document.createElement('label'); label.textContent = `Reserva ${index + 1}`;
          const select = document.createElement('select'); select.setAttribute('aria-label', `Reserva ${index + 1} do agente`);
          option(select, '', 'Nenhuma');
          for (const model of router.models) option(select, model.id, `${model.provider} / ${model.model}`);
          select.value = agent.fallbackModelIds?.[index] ?? '';
          label.append(select); edit.append(label); return select;
        });
        const syncModel = () => {
          modelSelect.disabled = Boolean(sessionSelect.value);
          if (modelSelect.disabled) modelSelect.value = '';
          for (const backup of backups) {
            backup.disabled = modelSelect.disabled || !modelSelect.value;
            if (backup.disabled || backup.value === modelSelect.value) backup.value = '';
          }
        };
        modelSelect.onchange = syncModel;
        sessionSelect.onchange = syncModel; syncModel();
        const save = document.createElement('button'); save.textContent = 'Salvar'; edit.prepend(name, objective, sessionSelect, modelSelect, requestLabel, costLabel); edit.append(save);
        edit.onsubmit = (event) => {
          event.preventDefault();
          const selection = sessionSelect.value;
          const selected = selection && selection !== 'current' ? choices[Number(selection)] : undefined;
          const link = selection === 'current' ? {} : selected
            ? { codexThread: selected.thread, codexHome: selected.home, modelId: null, fallbackModelIds: [] }
            : { codexThread: null, codexHome: null, modelId: modelSelect.value || null,
              fallbackModelIds: backups.map((item) => item.value).filter(Boolean) };
          void api(`/api/hub/agents/${agent.id}`, { name: name.value, objective: objective.value, ...link,
            monthlyAiRequestLimit: requestLimit.value === '' ? null : Number(requestLimit.value),
            monthlyAiCostLimitUsd: costLimit.value === '' ? null : Number(costLimit.value) }, 'PATCH').then(refresh).catch(showError);
        };
        const toggle = document.createElement('button'); toggle.textContent = agent.status === 'paused' ? 'Retomar agente' : 'Pausar agente';
        toggle.onclick = () => void api(`/api/hub/agents/${agent.id}/status`, { status: agent.status === 'paused' ? 'active' : 'paused' }).then(refresh).catch(showError);
        const end = document.createElement('button'); end.textContent = 'Encerrar agente';
        end.onclick = () => void api(`/api/hub/agents/${agent.id}/status`, { status: 'ended' }).then(() => { message.textContent = 'Agente encerrado. Instruções já aceitas pelo Codex não foram interrompidas.'; return refresh(); }).catch(showError);
        li.append(edit, toggle, end);
      }
      agentList.append(li);
    }
    if (selectedTaskAgent && [...agentsSelect.options].some((item) => item.value === selectedTaskAgent)) agentsSelect.value = selectedTaskAgent;
    updateTaskFields();
    const taskList = panel.querySelector('#hub-tasks')!; taskList.replaceChildren();
    for (const task of tasks.slice().reverse()) {
      if (['queued', 'unassigned', 'paused'].includes(task.status)) option(questionTasks, task.id, `${task.instruction.slice(0, 70)} · ${task.id.slice(0, 8)}`);
      const li = document.createElement('li'); li.textContent = `${agents.find((a) => a.id === task.agentId)?.name ?? 'Agente removido'}: ${task.instruction} — prioridade ${task.priority ?? 3} · ${statusLabel[task.status] ?? task.status}${task.nextAttemptAt ? ` · nova tentativa após ${new Date(task.nextAttemptAt).toLocaleString('pt-BR')}` : ''}${task.error ? ` (${task.error})` : ''} `;
      if (task.status === 'queued' || task.status === 'unassigned' || task.status === 'paused') {
        const priority = document.createElement('select'); priority.setAttribute('aria-label', 'Prioridade da tarefa');
        for (let value = 1; value <= 5; value++) option(priority, String(value), `Prioridade ${value}`);
        priority.value = String(task.priority ?? 3);
        priority.onchange = () => void api(`/api/hub/tasks/${task.id}/priority`, { priority: Number(priority.value) }, 'PATCH').then(refresh).catch(showError);
        const button = document.createElement('button'); button.textContent = task.status === 'paused' ? 'Retomar' : 'Pausar';
        button.onclick = () => void api(`/api/hub/tasks/${task.id}/${task.status === 'paused' ? 'resume' : 'pause'}`, {}).then(refresh).catch(showError);
        li.append(priority, button);
      }
      if (task.status === 'failed' || task.status === 'interrupted') {
        const retry = document.createElement('button'); retry.textContent = 'Repetir tarefa';
        retry.onclick = () => {
          const agent = agents.find((item) => item.id === task.agentId);
          if ((agent?.codexThread || task.status === 'interrupted') && !window.confirm('Repetir esta tarefa pode reenviar a instrução ao Codex. Confira antes se ela já foi executada. Continuar?')) return;
          void api(`/api/hub/tasks/${task.id}/retry`, {}).then(refresh).catch(showError);
        };
        li.append(retry);
      }
      if (task.result) { const detail = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = task.executionProvider ? `Resposta do ${task.executionProvider} (${task.executionModel ?? 'modelo não informado'})` : 'Resultado da ação'; const output = document.createElement('pre'); output.textContent = task.result; output.style.whiteSpace = 'pre-wrap'; detail.append(summary, output); li.append(detail); }
      taskList.append(li);
    }
    const questionList = panel.querySelector('#hub-questions')!; questionList.replaceChildren();
    for (const question of questions.slice().reverse().slice(0, 100)) {
      const li = document.createElement('li'); li.textContent = `${question.text} · tarefa ${question.taskId.slice(0, 8)} · ${question.state === 'pending' ? 'aguardando resposta' : question.state === 'cancelled' ? 'cancelada' : 'respondida'}${question.fieldName ? ` · campo ${question.fieldName}: ${question.appliedAt ? 'registrado no rascunho' : question.applicationSyncError ? `erro: ${question.applicationSyncError}` : 'aguardando registro'}` : ''} `;
      if (question.state === 'pending') {
        const form = document.createElement('form');
        const input = document.createElement('input'); input.required = true; input.maxLength = 5000; input.placeholder = 'Resposta confirmada pelo usuário'; input.setAttribute('aria-label', 'Resposta');
        const button = document.createElement('button'); button.textContent = 'Responder'; form.append(input, button);
        form.onsubmit = (event) => { event.preventDefault(); void api(`/api/hub/questions/${question.id}/answer`, { answer: input.value }).then(refresh).catch(showError); };
        li.append(form);
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancelar pergunta';
        cancel.onclick = () => void api(`/api/hub/questions/${question.id}/cancel`, {}).then(refresh).catch(showError);
        li.append(cancel);
        const outbound = whatsapp.outbound.find((item) => item.questionId === question.id);
        if (outbound) { const status = document.createElement('small'); status.textContent = ` · WhatsApp: ${outbound.state === 'accepted' ? 'aceito pela Evolution; entrega não confirmada' : outbound.state === 'uncertain' ? 'resultado incerto; revisar antes de reenviar' : outbound.state}`; li.append(status); }
        else if (whatsapp.mainNumber && whatsapp.secondaryNumber && whatsapp.apiKeyConfigured) {
          const send = document.createElement('button'); send.textContent = 'Enviar pergunta pelo WhatsApp';
          send.onclick = () => void api(`/api/hub/whatsapp/questions/${question.id}/send`, {}).then(() => { message.textContent = 'Mensagem aceita pela Evolution API; entrega no WhatsApp ainda não confirmada.'; return refresh(); }).catch(showError);
          li.append(send);
        }
      }
      questionList.append(li);
    }
    const jobList = panel.querySelector('#hub-jobs')!; jobList.replaceChildren();
    applicationJobs.length = 0;
    for (const job of jobs.slice().sort((a, b) => Number(Boolean(b.searchFit?.preferredCompany)) - Number(Boolean(a.searchFit?.preferredCompany)) || b.discoveredAt.localeCompare(a.discoveredAt)).slice(0, 100)) {
      if (!applications.some((app) => app.jobId === job.id)) option(applicationJobs, job.id, `${job.title} — ${job.company}`);
      const li = document.createElement('li');
      const link = document.createElement('a'); link.href = job.originalUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = `${job.title} — ${job.company}`; link.style.color = '#c9bdff'; li.append(link);
      const app = applications.find((candidate) => candidate.jobId === job.id);
      const detail = document.createElement('small'); detail.textContent = ` · ${job.location} · ${job.salary || 'salário não informado'} · fonte: ${job.source} · ${job.searchFit?.eligible === false ? `fora das preferências atuais (${job.searchFit.conflicts.map((code) => preferenceLabel[code] ?? code).join(', ')})` : 'dentro dos filtros explícitos'}${job.searchFit?.preferredCompany ? ' · empresa preferencial' : ''}${job.searchFit?.unknown?.length ? ` · dados não avaliados: ${job.searchFit.unknown.map((code) => preferenceLabel[code] ?? code).join(', ')}` : ''} · ${job.compatibility === null ? 'compatibilidade indeterminada' : `correspondência textual ${job.compatibility}%`} · ${app ? `candidatura ${app.status}` : 'sem candidatura'}`;
      const analyze = document.createElement('button'); analyze.textContent = 'Analisar anúncio';
      analyze.onclick = () => { message.textContent = 'Analisando anúncio com o modelo configurado...'; void api(`/api/hub/jobs/${job.id}/analyze`, {}).then(refresh).catch(showError); };
      li.append(detail, analyze);
      if (job.analyzedAt) {
        const evidence = document.createElement('small'); evidence.textContent = ` ${job.justification} Requisitos encontrados: ${job.requirements.length ? job.requirements.join(' | ') : 'nenhum requisito explícito'}. Modelo: ${job.analysisModel ?? 'não informado'}.`;
        li.append(evidence);
      }
      jobList.append(li);
    }
    const applicationList = panel.querySelector('#hub-applications')!; applicationList.replaceChildren();
    for (const app of applications.slice().reverse().slice(0, 100)) {
      const statusText: Record<Application['status'], string> = { draft: 'rascunho', awaiting_approval: 'aguardando aprovação', approved: 'envio autorizado; ainda não executado', submitting: 'envio em andamento', submission_uncertain: 'envio incerto; verificar no portal', submitted: 'envio confirmado na página' };
      const pendingFields = questions.filter((question) => question.applicationId === app.id && question.state === 'pending');
      const li = document.createElement('li'); li.textContent = `${app.title} — ${app.company} · ${statusText[app.status]}${pendingFields.length ? ` · ${pendingFields.length} informação(ões) pendente(s); envio bloqueado` : ''} `;
      const source = document.createElement('a'); source.href = app.originalUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 'Vaga original'; source.style.color = '#c9bdff'; li.append(source);
      if (app.status !== 'submitted') {
        const openInBrowser = document.createElement('button'); openInBrowser.textContent = 'Abrir vaga no navegador do escritório';
        openInBrowser.onclick = () => void (async () => {
          const started = await api<BrowserStatus>('/api/hub/browser/start', { headless: false });
          if (started.headless) throw new Error('Feche o navegador em segundo plano e abra no modo visível para login manual.');
          await api('/api/hub/browser/pages', { url: app.originalUrl });
          message.textContent = 'Vaga aberta no navegador do escritório. Acesse o formulário e escolha a aba na candidatura.';
          await refresh();
        })().catch(showError);
        li.append(openInBrowser);
      }
      const answers = document.createElement('small'); answers.textContent = ` · ${Object.keys(app.answers).length} resposta(s) confirmada(s)`; li.append(answers);
      if (app.submission?.confirmationText) { const proof = document.createElement('small'); proof.textContent = ` · Confirmação: ${app.submission.confirmationText} · ${app.submission.pageUrl}`; li.append(proof); }
      if (app.status === 'submitted') { const screenshot = document.createElement('a'); screenshot.href = `/api/hub/applications/${app.id}/evidence`; screenshot.target = '_blank'; screenshot.rel = 'noopener noreferrer'; screenshot.textContent = 'Ver captura da confirmação'; screenshot.style.color = '#c9bdff'; li.append(screenshot); }
      const form = document.createElement('form');
      const field = document.createElement('input'); field.placeholder = 'Campo do formulário'; field.maxLength = 100; field.required = true; field.setAttribute('aria-label', 'Campo do formulário');
      const value = document.createElement('input'); value.placeholder = 'Resposta confirmada por você'; value.maxLength = 5000; value.required = true; value.setAttribute('aria-label', 'Resposta confirmada');
      const save = document.createElement('button'); save.textContent = 'Salvar resposta'; form.append(field, value, save);
      form.onsubmit = (event) => { event.preventDefault(); void api(`/api/hub/applications/${app.id}/answers`, { answers: { ...app.answers, [field.value]: value.value } }, 'PUT').then(refresh).catch(showError); };
      if (!['submitting', 'submission_uncertain', 'submitted'].includes(app.status)) li.append(form);
      if (['draft', 'awaiting_approval', 'approved', 'submission_uncertain'].includes(app.status)) {
        const execution = document.createElement('form');
        const pageSelect = document.createElement('select'); pageSelect.required = true; pageSelect.setAttribute('aria-label', 'Aba do formulário');
        option(pageSelect, '', 'Escolha a aba do formulário');
        for (const page of browser.pages) option(pageSelect, page.id, page.url.slice(0, 100));
        execution.append(pageSelect);
        if (app.status !== 'submission_uncertain') {
          const inspect = document.createElement('button'); inspect.type = 'button'; inspect.textContent = 'Inspecionar campos e solicitar dados';
          inspect.onclick = () => void api<{ requested: { id: string }[]; alreadyKnown: string[]; alreadyRequested: string[]; needsManual: string[] }>(
            `/api/hub/applications/${app.id}/inspect`, { pageId: pageSelect.value }).then((outcome) => {
            message.textContent = `${outcome.requested.length} pergunta(s) criada(s); ${outcome.alreadyKnown.length} campo(s) com resposta; ${outcome.alreadyRequested.length} pergunta(s) já existente(s). Revisão manual: ${outcome.needsManual.join(', ') || 'nenhuma'}.`;
            return refresh();
          }).catch(showError);
          execution.append(inspect);
          const prepare = document.createElement('button'); prepare.type = 'button'; prepare.textContent = 'Preencher respostas na aba';
          prepare.onclick = () => void api<{ filled: string[]; missing: string[] }>(`/api/hub/applications/${app.id}/prepare`, { pageId: pageSelect.value }).then((outcome) => {
            message.textContent = `${outcome.filled.length} campo(s) preenchido(s); ${outcome.missing.length} não encontrado(s): ${outcome.missing.join(', ') || 'nenhum'}. Revise o formulário.`;
          }).catch(showError);
          execution.append(prepare);
        }
        if (app.status === 'approved' || app.status === 'submission_uncertain') {
          const confirmation = document.createElement('input'); confirmation.required = true; confirmation.maxLength = 200; confirmation.placeholder = 'Texto exato da confirmação esperada'; confirmation.setAttribute('aria-label', 'Texto de confirmação'); execution.append(confirmation);
          if (app.status === 'approved') {
            const buttonText = document.createElement('input'); buttonText.required = true; buttonText.maxLength = 200; buttonText.placeholder = 'Texto exato do botão final'; buttonText.setAttribute('aria-label', 'Texto do botão final'); execution.append(buttonText);
            const submit = document.createElement('button'); submit.textContent = 'Enviar candidatura autorizada'; submit.disabled = pendingFields.length > 0; execution.append(submit);
            execution.onsubmit = (event) => { event.preventDefault(); const pageUrl = browser.pages.find((page) => page.id === pageSelect.value)?.url;
              if (!pageUrl || !window.confirm(`Enviar agora a candidatura para ${app.company} na página ${pageUrl}? Verifique o formulário antes de confirmar.`)) return;
              void api<Application>(`/api/hub/applications/${app.id}/submit`, { pageId: pageSelect.value, buttonText: buttonText.value, confirmationText: confirmation.value }).then((outcome) => {
                message.textContent = outcome.status === 'submitted' ? 'Envio confirmado na página; evidência salva.' : 'Envio incerto. Verifique o portal; não repita a candidatura.'; return refresh();
              }).catch(showError); };
          } else {
            const verify = document.createElement('button'); verify.textContent = 'Verificar confirmação na aba'; execution.append(verify);
            execution.onsubmit = (event) => { event.preventDefault(); void api<Application>(`/api/hub/applications/${app.id}/verify-submission`, { pageId: pageSelect.value, confirmationText: confirmation.value }).then(() => {
              message.textContent = 'Confirmação encontrada na página; evidência salva.'; return refresh();
            }).catch(showError); };
          }
        }
        li.append(execution);
      }
      if (app.status === 'draft' && Object.keys(app.answers).length) {
        const request = document.createElement('button'); request.textContent = 'Solicitar aprovação';
        request.onclick = () => void api(`/api/hub/applications/${app.id}/request-approval`, {}).then(refresh).catch(showError); li.append(request);
      } else if (app.status === 'awaiting_approval') {
        const approve = document.createElement('button'); approve.textContent = 'Autorizar envio final';
        approve.onclick = () => void api(`/api/hub/applications/${app.id}/approve`, {}).then(refresh).catch(showError);
        const deny = document.createElement('button'); deny.textContent = 'Recusar';
        deny.onclick = () => void api(`/api/hub/applications/${app.id}/deny`, {}).then(refresh).catch(showError); li.append(approve, deny);
      }
      applicationList.append(li);
    }
  }
  function showError(error: unknown) { message.textContent = error instanceof Error ? error.message : String(error); }
  open.onclick = () => { panel.hidden = false; void refresh().catch(showError); };
  (panel.querySelector('[data-close]') as HTMLButtonElement).onclick = () => { panel.hidden = true; };
  window.setInterval(() => {
    if (panel.hidden) { void office.poll(); return; }
    if (panel.hidden || agentForm.contains(document.activeElement) || panel.querySelector('#hub-agents')?.contains(document.activeElement) || taskForm.contains(document.activeElement) || panel.querySelector('#hub-tasks')?.contains(document.activeElement) || executionForm.contains(document.activeElement) || questionForm.contains(document.activeElement) || panel.querySelector('#hub-questions')?.contains(document.activeElement) || whatsappForm.contains(document.activeElement) || summaryForm.contains(document.activeElement) || evolutionForm.contains(document.activeElement) || listenerForm.contains(document.activeElement) || webhookForm.contains(document.activeElement) || profileForm.contains(document.activeElement) || applicationForm.contains(document.activeElement) || applicationListContainsActive() || jobForm.contains(document.activeElement) || jobPreferencesForm.contains(document.activeElement) || greenhouseForm.contains(document.activeElement) || greenhouseSearch.contains(document.activeElement) || leverForm.contains(document.activeElement) || leverSearch.contains(document.activeElement) || scheduleForm.contains(document.activeElement) || browserForm.contains(document.activeElement) || modelForm.contains(document.activeElement) || panel.querySelector('#hub-models')?.contains(document.activeElement) || credentialForm.contains(document.activeElement) || modelTest.contains(document.activeElement)) return;
    void refresh().catch(showError);
  }, 5_000);
  agentForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(agentForm); const selected = choices[Number(data.get('session'))];
    const limits = Object.fromEntries(['monthlyAiRequestLimit', 'monthlyAiCostLimitUsd']
      .filter((name) => data.get(name) !== '').map((name) => [name, Number(data.get(name))]));
    void api('/api/hub/agents', { name: data.get('name'), objective: data.get('objective'), ...(selected && data.get('session') !== '' ? { codexThread: selected.thread, codexHome: selected.home } : {}),
      ...(data.get('modelId') && data.get('session') === '' ? { modelId: data.get('modelId'), fallbackModelIds: agentBackups.map((item) => item.value).filter(Boolean) } : {}),
      ...(data.get('parent') ? { parentId: data.get('parent') } : {}), ...limits })
      .then(() => { agentForm.reset(); syncAgentModels(); message.textContent = 'Agente criado.'; return refresh(); }).catch(showError); };
  sessions.onchange = syncAgentModels;
  agentModel.onchange = syncAgentModels;
  taskForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(taskForm);
    const evaluator = agentsSelect.selectedOptions[0]?.dataset.systemKey === 'job-search/compatibility';
    if (evaluator && !confirmedProfileRevision) { message.textContent = 'Confirme o perfil profissional antes de avaliar compatibilidade.'; return; }
    const instruction = taskJobLabel.hidden ? data.get('instruction') : evaluator ? `${data.get('jobId')}@${confirmedProfileRevision}` : data.get('jobId');
    void api('/api/hub/tasks', { agentId: data.get('agent'), instruction, priority: Number(data.get('priority')) })
      .then(() => { taskForm.reset(); message.textContent = 'Tarefa registrada.'; return refresh(); }).catch(showError); };
  agentsSelect.onchange = updateTaskFields;
  executionForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(executionForm);
    void api('/api/hub/execution', { maxConcurrent: Number(data.get('maxConcurrent')) }, 'PUT')
      .then(() => { message.textContent = 'Limite de execução salvo.'; return refresh(); }).catch(showError); };
  questionForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(questionForm);
    void api('/api/hub/questions', { taskId: data.get('task'), text: data.get('text'), ...(data.get('applicationId') ? { applicationId: data.get('applicationId'), fieldName: data.get('fieldName') } : {}) })
      .then(() => { questionForm.reset(); updateQuestionField(); message.textContent = 'Pergunta pendente registrada.'; return refresh(); }).catch(showError); };
  questionApplications.onchange = updateQuestionField;
  whatsappForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(whatsappForm);
    void api('/api/hub/whatsapp', { mainNumber: data.get('mainNumber'), secondaryNumber: data.get('secondaryNumber') }, 'PUT')
      .then(() => { message.textContent = 'Números do WhatsApp salvos neste computador.'; return refresh(); }).catch(showError); };
  summaryForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(summaryForm);
    void api('/api/hub/whatsapp/summary', { enabled: data.has('enabled'), hour: Number(data.get('hour')) }, 'PUT')
      .then(() => { message.textContent = 'Horário do resumo salvo.'; return refresh(); }).catch(showError); };
  (panel.querySelector('[data-whatsapp-token]') as HTMLButtonElement).onclick = () => void api<{ token: string }>('/api/hub/whatsapp/webhook-token', {}).then(({ token }) => {
    const target = panel.querySelector('#hub-whatsapp-token') as HTMLElement; target.textContent = `Token exibido uma vez: ${token}`;
    return refresh();
  }).catch(showError);
  (panel.querySelector('[data-whatsapp-diagnostics]') as HTMLButtonElement).onclick = () => void api<{ reachable: boolean; version?: string; instanceExists: boolean | null; connectionStatus?: string; error?: string }>('/api/hub/whatsapp/diagnostics').then((result) => {
    (panel.querySelector('#hub-whatsapp-diagnostics') as HTMLElement).textContent = result.reachable
      ? `Evolution ${result.version ?? 'versão desconhecida'} · instância ${result.instanceExists === null ? 'não verificada' : result.instanceExists ? `encontrada (${result.connectionStatus ?? 'estado desconhecido'})` : 'ainda não criada'}${result.error ? ` · ${result.error}` : ''}`
      : result.error ?? 'Evolution indisponível';
  }).catch(showError);
  (panel.querySelector('[data-mcp-key]') as HTMLButtonElement).onclick = () => void api<{ key: string }>('/api/hub/mcp/key', {}).then(({ key }) => {
    currentMcpKey = key;
    (panel.querySelector('#hub-mcp-key') as HTMLElement).textContent = `Chave exibida uma vez: ${key}`;
    return refresh();
  }).catch(showError);
  (panel.querySelector('[data-session-policy]') as HTMLButtonElement).onclick = () => void api('/api/hub/mcp/session', { policy: (panel.querySelector('#hub-admin-policy') as HTMLSelectElement).value }, 'PUT').then(refresh).catch(showError);
  (panel.querySelector('[data-session-renew]') as HTMLButtonElement).onclick = () => void api('/api/hub/mcp/session', {}).then(refresh).catch(showError);
  (panel.querySelector('[data-backup-create]') as HTMLButtonElement).onclick = () => void api('/api/hub/backups', {}).then(refresh).catch(showError);
  (panel.querySelector('[data-windows-startup]') as HTMLButtonElement).onclick = () => void api<WindowsStartupStatus>('/api/hub/windows/startup').then((status) =>
    api('/api/hub/windows/startup', { enabled: !status.enabled }, 'PUT')).then(refresh).catch(showError);
  (panel.querySelector('[data-mcp-copy]') as HTMLButtonElement).onclick = () => {
    if (!currentMcpKey) { message.textContent = 'Gere uma nova chave para copiar a configuração completa; a chave anterior não pode ser recuperada.'; return; }
    void navigator.clipboard.writeText(`URL: ${currentMcpUrl}\nAutorização: Bearer ${currentMcpKey}`).then(() => {
    message.textContent = 'Configuração de conexão copiada. Mantenha a chave em local privado.';
    }).catch(showError);
  };
  evolutionForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(evolutionForm);
    const key = String(data.get('apiKey') ?? '');
    void api('/api/hub/whatsapp/settings', { baseUrl: data.get('baseUrl'), ...(key ? { apiKey: key } : {}) }, 'PUT')
      .then(() => { (evolutionForm.elements.namedItem('apiKey') as HTMLInputElement).value = ''; message.textContent = 'Conexão Evolution salva neste computador.'; return refresh(); }).catch(showError);
  };
  (panel.querySelector('[data-evolution-clear]') as HTMLButtonElement).onclick = () => void api('/api/hub/whatsapp/settings/key', {}, 'DELETE').then(refresh).catch(showError);
  listenerForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(listenerForm);
    void api<WebhookListenerStatus>('/api/hub/whatsapp/listener', { port: Number(data.get('port')), enabled: data.has('enabled'), exposeLan: data.has('exposeLan') }, 'PUT')
      .then((status) => { message.textContent = status.running ? 'Recebimento do WhatsApp ativo.' : status.enabled ? `Recebimento indisponível: ${status.error ?? 'verifique a porta'}.` : 'Recebimento do WhatsApp desligado.'; return refresh(); }).catch(showError);
  };
  (credentialForm.elements.namedItem('provider') as HTMLSelectElement).onchange = () => {
    (credentialForm.elements.namedItem('key') as HTMLInputElement).value = '';
    void refresh().catch(showError);
  };
  credentialForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(credentialForm);
    const provider = String(data.get('provider'));
    void api(`/api/hub/router/credentials/${provider}`, { key: data.get('key') }, 'PUT').then(() => {
      (credentialForm.elements.namedItem('key') as HTMLInputElement).value = '';
      message.textContent = 'Chave protegida para esta conta do Windows.'; return refresh();
    }).catch(showError);
  };
  (credentialForm.querySelector('[data-provider-clear]') as HTMLButtonElement).onclick = () => {
    const provider = (credentialForm.elements.namedItem('provider') as HTMLSelectElement).value;
    if (providerStatuses[provider]?.source !== 'windows') return;
    void api(`/api/hub/router/credentials/${provider}`, {}, 'DELETE').then(() => {
      message.textContent = 'Chave local removida.'; return refresh();
    }).catch(showError);
  };
  webhookForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(webhookForm);
    void api('/api/hub/whatsapp/webhook', { url: data.get('url') }).then(() => {
      (panel.querySelector('#hub-webhook-result') as HTMLElement).textContent = 'Configuração aceita pela Evolution para procura-de-emprego. O recebimento de mensagens ainda precisa ser testado.';
      return refresh();
    }).catch(showError);
  };
  const showInstance = (result: EvolutionInstanceResult) => {
    (panel.querySelector('#hub-instance-status') as HTMLElement).textContent = `${result.created ? 'Instância criada' : 'Instância existente ou conexão solicitada'}: ${result.instance}${result.status ? ` · estado ${result.status}` : ''}${result.pairingCode ? ` · código ${result.pairingCode}` : ''}. ${result.qrCode ? 'Leia o QR com o número secundário.' : 'Se não houver QR, confira o estado e tente solicitar a conexão.'}`;
    const qr = panel.querySelector('#hub-instance-qr') as HTMLImageElement;
    if (result.qrCode) { qr.src = result.qrCode; qr.hidden = false; }
    else { qr.removeAttribute('src'); qr.hidden = true; }
    void refresh().catch(showError);
  };
  (panel.querySelector('[data-instance-create]') as HTMLButtonElement).onclick = () => void api<EvolutionInstanceResult>('/api/hub/whatsapp/instance', {}).then(showInstance).catch(showError);
  (panel.querySelector('[data-instance-connect]') as HTMLButtonElement).onclick = () => void api<EvolutionInstanceResult>('/api/hub/whatsapp/instance/connect', {}).then(showInstance).catch(showError);
  const originalClose = (panel.querySelector('[data-close]') as HTMLButtonElement).onclick;
  (panel.querySelector('[data-close]') as HTMLButtonElement).onclick = (event) => { (panel.querySelector('#hub-whatsapp-token') as HTMLElement).textContent = ''; (panel.querySelector('#hub-mcp-key') as HTMLElement).textContent = ''; (panel.querySelector('#hub-instance-status') as HTMLElement).textContent = ''; const qr = panel.querySelector('#hub-instance-qr') as HTMLImageElement; qr.removeAttribute('src'); qr.hidden = true; currentMcpKey = undefined; originalClose?.call(panel.querySelector('[data-close]') as HTMLButtonElement, event); };
  profileForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(profileForm);
    const lines = (key: string) => String(data.get(key) ?? '').split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    void api('/api/hub/profile', { skills: lines('skills'), experience: lines('experience'), education: lines('education') }, 'PUT')
      .then(() => { message.textContent = 'Perfil salvo. Confirme os dados antes da análise de compatibilidade.'; return refresh(); }).catch(showError); };
  (panel.querySelector('[data-confirm-profile]') as HTMLButtonElement).onclick = () => void api('/api/hub/profile/confirm', {}).then(() => { message.textContent = 'Perfil confirmado.'; return refresh(); }).catch(showError);
  function applicationListContainsActive(): boolean { return Boolean(panel.querySelector('#hub-applications')?.contains(document.activeElement)); }
  applicationForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(applicationForm);
    void api('/api/hub/applications', { jobId: data.get('job') })
      .then(() => { message.textContent = 'Rascunho criado. Nenhuma candidatura foi enviada.'; return refresh(); }).catch(showError); };
  jobForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(jobForm); message.textContent = 'Consultando vagas...';
    void api<{ added: number }>('/api/hub/jobs/search', { query: data.get('query') })
      .then((result) => { message.textContent = `${result.added} vaga(s) nova(s) registrada(s).`; return refresh(); }).catch(showError); };
  jobPreferencesForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(jobPreferencesForm);
    const lines = (name: string) => String(data.get(name) ?? '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    void api('/api/hub/jobs/preferences', { title: data.get('title'), location: data.get('location'), modes: data.getAll('modes'),
      seniority: data.get('seniority'), desiredSalary: data.get('desiredSalary'), area: data.get('area'),
      requiredTerms: lines('requiredTerms'), preferredCompanies: lines('preferredCompanies'), keywords: lines('keywords') }, 'PUT')
      .then(() => { message.textContent = 'Preferências de vagas salvas.'; return refresh(); }).catch(showError); };
  greenhouseForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(greenhouseForm);
    void api('/api/hub/jobs/greenhouse/boards', { url: data.get('url') }).then(() => { greenhouseForm.reset(); message.textContent = 'Página de carreira cadastrada.'; return refresh(); }).catch(showError); };
  greenhouseSearch.onsubmit = (event) => { event.preventDefault(); const data = new FormData(greenhouseSearch); message.textContent = 'Consultando páginas de carreira...';
    void api<{ added: number; errors: { token: string; error: string }[] }>('/api/hub/jobs/greenhouse/search', { query: data.get('query') })
      .then((result) => { message.textContent = `${result.added} vaga(s) nova(s) registrada(s).${result.errors.length ? ` ${result.errors.length} página(s) com erro.` : ''}`; return refresh(); }).catch(showError); };
  leverForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(leverForm);
    void api('/api/hub/jobs/lever/boards', { url: data.get('url'), company: data.get('company') })
      .then(() => { leverForm.reset(); message.textContent = tr('Página Lever cadastrada.'); return refresh(); }).catch(showError); };
  leverSearch.onsubmit = (event) => { event.preventDefault(); const data = new FormData(leverSearch); message.textContent = tr('Consultando páginas Lever...');
    void api<{ added: number; errors: { site: string; error: string }[] }>('/api/hub/jobs/lever/search', { query: data.get('query') })
      .then((result) => { message.textContent = tr('{0} vaga(s) nova(s) registrada(s). {1} página(s) com erro.', [result.added, result.errors.length]); return refresh(); }).catch(showError); };
  scheduleForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(scheduleForm);
    void api('/api/hub/jobs/schedule', { query: data.get('query'), intervalHours: Number(data.get('interval')), enabled: data.has('enabled') }, 'PUT')
      .then(() => { message.textContent = 'Agenda salva.'; return refresh(); }).catch(showError); };
  (panel.querySelector('[data-browser-visible]') as HTMLButtonElement).onclick = () => void api('/api/hub/browser/start', { headless: false }).then(refresh).catch(showError);
  (panel.querySelector('[data-browser-headless]') as HTMLButtonElement).onclick = () => void api('/api/hub/browser/start', { headless: true }).then(refresh).catch(showError);
  (panel.querySelector('[data-browser-stop]') as HTMLButtonElement).onclick = () => void api('/api/hub/browser/stop', {}).then(refresh).catch(showError);
  (panel.querySelector('[data-browser-manual]') as HTMLButtonElement).onclick = () => void api<BrowserStatus>('/api/hub/browser').then((status) => api('/api/hub/browser/manual', { manual: !status.manual })).then(refresh).catch(showError);
  browserForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(browserForm);
    void api('/api/hub/browser/pages', { url: data.get('url') }).then(refresh).catch(showError); };
  modelForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(modelForm);
    const limits = Object.fromEntries(['monthlyRequestLimit', 'inputUsdPerMillion', 'outputUsdPerMillion', 'monthlyCostLimitUsd']
      .filter((name) => data.get(name) !== '').map((name) => [name, Number(data.get(name))]));
    void api('/api/hub/router/models', { provider: data.get('provider'), model: data.get('model'), priority: Number(data.get('priority')), ...limits })
      .then(() => { modelForm.reset(); message.textContent = 'Modelo cadastrado.'; return refresh(); }).catch(showError); };
  modelTest.onsubmit = (event) => { event.preventDefault(); const data = new FormData(modelTest);
    (panel.querySelector('#hub-model-result') as HTMLElement).textContent = 'Consultando modelo...';
    void api<{ text: string; provider: string; model: string }>('/api/hub/router/complete', { messages: [{ role: 'user', content: data.get('prompt') }] })
      .then((result) => { (panel.querySelector('#hub-model-result') as HTMLElement).textContent = `${result.provider} / ${result.model}: ${result.text}`; return refresh(); }).catch(showError); };
}
