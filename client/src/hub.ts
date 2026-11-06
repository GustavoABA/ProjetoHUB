type Agent = { id: string; name: string; objective: string; parentId?: string; codexThread?: string };
type Task = { id: string; agentId: string; instruction: string; status: string; error?: string };
type Session = { name: string; sessionId: string; account: string; provider: string };
type Source = { label: string; path: string; provider: string };
type Job = { id: string; title: string; company: string; location: string; source: string; originalUrl: string; salary?: string; compatibility: number | null; applicationStatus: string };
type Schedule = { query?: string; intervalHours?: number; enabled: boolean; nextRunAt?: string; lastError?: string };
type BrowserStatus = { running: boolean; headless: boolean; manual: boolean; pages: { id: string; url: string }[] };
type RouterStatus = { models: { id: string; provider: string; model: string; priority: number; enabled: boolean; available: boolean }[]; usage: { inputTokens: number; outputTokens: number; requests: number }; lastError?: string };
const statusLabel: Record<string, string> = { unassigned: 'aguardando vínculo', queued: 'na fila', dispatching: 'enviando ao Codex', sent: 'instrução aceita pelo Codex', waiting_input: 'aguardando resposta', paused: 'pausada', done: 'concluída', failed: 'erro no envio', interrupted: 'envio interrompido; requer revisão' };

const css = `
#projecthub-open{position:fixed;right:16px;top:72px;z-index:80;background:#3e326d;color:#fff;border:2px solid #a697e2;padding:9px 14px;font:600 16px 'Pixelify Sans',sans-serif;cursor:pointer}
#projecthub-panel{position:fixed;inset:5vh 5vw;z-index:100;background:#171a27;color:#f5f3ff;border:3px solid #a697e2;box-shadow:0 15px 60px #000b;padding:20px;overflow:auto;font:16px system-ui,sans-serif}
#projecthub-panel[hidden]{display:none}#projecthub-panel h2{font:600 25px 'Pixelify Sans',sans-serif;margin:0 0 14px}
#projecthub-panel form{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0 22px;align-items:end}#projecthub-panel label{display:grid;gap:4px;min-width:170px;flex:1}
#projecthub-panel input,#projecthub-panel select{background:#282d40;color:white;border:1px solid #717899;padding:9px;font:inherit}
#projecthub-panel button{background:#6655ad;color:white;border:1px solid #a697e2;padding:9px 12px;cursor:pointer;font:inherit}
#projecthub-panel ul{padding-left:22px}#projecthub-panel li{margin:7px 0}#projecthub-panel small{color:#b9c2d9}
#projecthub-panel .hub-head{display:flex;justify-content:space-between;align-items:center}#projecthub-message{min-height:1.4em;color:#ffe4a0}
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
    <p>Agentes configurados aparecem aqui. O escritório mostra sessões reais do Codex; tarefas sem sessão vinculada aguardam configuração.</p>
    <h3>Criar agente</h3><form id="hub-agent-form"><label>Nome<input name="name" maxlength="100" required></label><label>Objetivo<input name="objective" maxlength="2000" required></label><label>Sessão Codex existente (opcional)<select name="session"><option value="">Sem vínculo</option></select></label><label>Subagente de (opcional)<select name="parent"><option value="">Agente principal</option></select></label><button>Criar agente</button></form>
    <h3>Nova tarefa</h3><form id="hub-task-form"><label>Agente<select name="agent" required></select></label><label>Instrução<input name="instruction" maxlength="10000" required></label><button>Criar tarefa</button></form>
    <h3>Vagas remotas</h3><form id="hub-job-form"><label>Pesquisar na Remotive<input name="query" maxlength="100" required placeholder="Ex.: assistente, suporte, júnior"></label><button>Buscar vagas</button></form>
    <form id="hub-schedule-form"><label>Pesquisa automática<input name="query" maxlength="100" required placeholder="Termo de pesquisa"></label><label>Intervalo<select name="interval"><option value="6">6 horas</option><option value="12">12 horas</option><option value="24">24 horas</option></select></label><label><span>Ativar</span><input name="enabled" type="checkbox"></label><button>Salvar agenda</button></form><p id="hub-schedule-status"></p>
    <p>Fonte: Remotive. A consulta pública tem limite de quatro tentativas por dia; as vagas exibidas levam ao anúncio original.</p>
    <h3>Navegador</h3><div><button type="button" data-browser-visible>Abrir visível</button> <button type="button" data-browser-headless>Abrir em segundo plano</button> <button type="button" data-browser-manual>Assumir controle</button> <button type="button" data-browser-stop>Fechar</button></div>
    <form id="hub-browser-form"><label>Endereço<input name="url" type="url" required placeholder="https://..."></label><button>Abrir página</button></form><p id="hub-browser-status"></p><ul id="hub-browser-pages"></ul>
    <h3>Modelos de IA</h3><p>Configure a chave do provedor no ambiente do serviço antes de iniciá-lo. A autenticação do Codex não é usada como chave de API.</p>
    <form id="hub-model-form"><label>Provedor<select name="provider"><option value="openai">OpenAI · OPENAI_API_KEY</option><option value="anthropic">Anthropic · ANTHROPIC_API_KEY</option><option value="gemini">Gemini · GEMINI_API_KEY</option><option value="deepseek">DeepSeek · DEEPSEEK_API_KEY</option><option value="openrouter">OpenRouter · OPENROUTER_API_KEY</option><option value="ollama">Ollama local</option></select></label><label>Modelo<input name="model" required placeholder="Nome exato do modelo"></label><label>Prioridade<input name="priority" type="number" min="1" max="1000" value="1" required></label><button>Cadastrar modelo</button></form>
    <p id="hub-router-status"></p><ul id="hub-models"></ul>
    <form id="hub-model-test"><label>Teste do roteador<input name="prompt" maxlength="2000" required placeholder="Escreva uma pergunta"></label><button>Testar modelo</button></form><p id="hub-model-result"></p>
    <p id="projecthub-message" role="status"></p><h3>Agentes</h3><ul id="hub-agents"></ul><h3>Tarefas</h3><ul id="hub-tasks"></ul><h3>Vagas encontradas</h3><ul id="hub-jobs"></ul>`;
  document.body.append(open, panel);
  const message = panel.querySelector('#projecthub-message') as HTMLElement;
  const agentForm = panel.querySelector('#hub-agent-form') as HTMLFormElement;
  const taskForm = panel.querySelector('#hub-task-form') as HTMLFormElement;
  const jobForm = panel.querySelector('#hub-job-form') as HTMLFormElement;
  const scheduleForm = panel.querySelector('#hub-schedule-form') as HTMLFormElement;
  const browserForm = panel.querySelector('#hub-browser-form') as HTMLFormElement;
  const modelForm = panel.querySelector('#hub-model-form') as HTMLFormElement;
  const modelTest = panel.querySelector('#hub-model-test') as HTMLFormElement;
  const sessions = agentForm.elements.namedItem('session') as HTMLSelectElement;
  const parents = agentForm.elements.namedItem('parent') as HTMLSelectElement;
  const agentsSelect = taskForm.elements.namedItem('agent') as HTMLSelectElement;
  let choices: { thread: string; home: string }[] = [];
  const option = (select: HTMLSelectElement, value: string, label: string) => { const o = document.createElement('option'); o.value = value; o.textContent = label; select.append(o); };

  async function refresh(): Promise<void> {
    const [agents, tasks, jobs, schedule, browser, router, snapshot, health] = await Promise.all([
      api<Agent[]>('/api/hub/agents'), api<Task[]>('/api/hub/tasks'),
      api<Job[]>('/api/hub/jobs'),
      api<Schedule>('/api/hub/jobs/schedule'),
      api<BrowserStatus>('/api/hub/browser'),
      api<RouterStatus>('/api/hub/router'),
      api<{ agents: Session[] }>('/api/snapshot'), api<{ sources: Source[] }>('/api/health'),
    ]);
    (panel.querySelector('#hub-router-status') as HTMLElement).textContent = `${router.usage.requests} resposta(s) · ${router.usage.inputTokens} tokens de entrada · ${router.usage.outputTokens} tokens de saída · custo não calculado${router.lastError ? ` · Última falha: ${router.lastError}` : ''}`;
    const modelList = panel.querySelector('#hub-models')!; modelList.replaceChildren();
    for (const model of router.models) {
      const li = document.createElement('li'); li.textContent = `${model.provider} / ${model.model} · prioridade ${model.priority} · ${!model.enabled ? 'desativado' : model.provider === 'ollama' ? 'serviço local não verificado' : model.available ? 'credencial detectada; acesso não verificado' : 'credencial ausente'} `;
      const toggle = document.createElement('button'); toggle.textContent = model.enabled ? 'Desativar' : 'Ativar';
      toggle.onclick = () => void api(`/api/hub/router/models/${model.id}`, { enabled: !model.enabled }, 'PATCH').then(refresh).catch(showError);
      const remove = document.createElement('button'); remove.textContent = 'Remover';
      remove.onclick = () => void api(`/api/hub/router/models/${model.id}`, {}, 'DELETE').then(refresh).catch(showError);
      li.append(toggle, remove); modelList.append(li);
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
    sessions.length = 1; parents.length = 1; agentsSelect.length = 0; choices = [];
    for (const session of snapshot.agents.filter((a) => a.provider === 'codex')) {
      const home = health.sources.find((s) => s.provider === 'codex' && s.label === session.account)?.path;
      if (!home || !session.sessionId) continue;
      const index = choices.push({ thread: session.sessionId, home }) - 1;
      option(sessions, String(index), `${session.name} · ${session.sessionId.slice(0, 8)}`);
    }
    const agentList = panel.querySelector('#hub-agents')!; agentList.replaceChildren();
    for (const agent of agents) {
      option(parents, agent.id, agent.name); option(agentsSelect, agent.id, agent.name);
      const li = document.createElement('li'); li.textContent = `${agent.name} — ${agent.objective}`;
      const detail = document.createElement('small'); detail.textContent = agent.codexThread ? ' · Sessão Codex vinculada' : ' · Sem sessão vinculada'; li.append(detail); agentList.append(li);
    }
    const taskList = panel.querySelector('#hub-tasks')!; taskList.replaceChildren();
    for (const task of tasks.slice().reverse()) {
      const li = document.createElement('li'); li.textContent = `${agents.find((a) => a.id === task.agentId)?.name ?? 'Agente removido'}: ${task.instruction} — ${statusLabel[task.status] ?? task.status}${task.error ? ` (${task.error})` : ''} `;
      if (task.status === 'queued' || task.status === 'unassigned' || task.status === 'paused') {
        const button = document.createElement('button'); button.textContent = task.status === 'paused' ? 'Retomar' : 'Pausar';
        button.onclick = () => void api(`/api/hub/tasks/${task.id}/${task.status === 'paused' ? 'resume' : 'pause'}`, {}).then(refresh).catch(showError);
        li.append(button);
      }
      taskList.append(li);
    }
    const jobList = panel.querySelector('#hub-jobs')!; jobList.replaceChildren();
    for (const job of jobs.slice().reverse().slice(0, 100)) {
      const li = document.createElement('li');
      const link = document.createElement('a'); link.href = job.originalUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = `${job.title} — ${job.company}`; link.style.color = '#c9bdff'; li.append(link);
      const detail = document.createElement('small'); detail.textContent = ` · ${job.location} · ${job.salary || 'salário não informado'} · fonte: ${job.source} · compatibilidade não avaliada`;
      li.append(detail); jobList.append(li);
    }
  }
  function showError(error: unknown) { message.textContent = error instanceof Error ? error.message : String(error); }
  open.onclick = () => { panel.hidden = false; void refresh().catch(showError); };
  (panel.querySelector('[data-close]') as HTMLButtonElement).onclick = () => { panel.hidden = true; };
  window.setInterval(() => {
    if (panel.hidden || agentForm.contains(document.activeElement) || taskForm.contains(document.activeElement) || jobForm.contains(document.activeElement) || scheduleForm.contains(document.activeElement) || browserForm.contains(document.activeElement) || modelForm.contains(document.activeElement) || modelTest.contains(document.activeElement)) return;
    void refresh().catch(showError);
  }, 5_000);
  agentForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(agentForm); const selected = choices[Number(data.get('session'))];
    void api('/api/hub/agents', { name: data.get('name'), objective: data.get('objective'), ...(selected && data.get('session') !== '' ? { codexThread: selected.thread, codexHome: selected.home } : {}), ...(data.get('parent') ? { parentId: data.get('parent') } : {}) })
      .then(() => { agentForm.reset(); message.textContent = 'Agente criado.'; return refresh(); }).catch(showError); };
  taskForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(taskForm);
    void api('/api/hub/tasks', { agentId: data.get('agent'), instruction: data.get('instruction') })
      .then(() => { taskForm.reset(); message.textContent = 'Tarefa registrada.'; return refresh(); }).catch(showError); };
  jobForm.onsubmit = (event) => { event.preventDefault(); const data = new FormData(jobForm); message.textContent = 'Consultando vagas...';
    void api<{ added: number }>('/api/hub/jobs/search', { query: data.get('query') })
      .then((result) => { message.textContent = `${result.added} vaga(s) nova(s) registrada(s).`; return refresh(); }).catch(showError); };
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
    void api('/api/hub/router/models', { provider: data.get('provider'), model: data.get('model'), priority: Number(data.get('priority')) })
      .then(() => { modelForm.reset(); message.textContent = 'Modelo cadastrado.'; return refresh(); }).catch(showError); };
  modelTest.onsubmit = (event) => { event.preventDefault(); const data = new FormData(modelTest);
    (panel.querySelector('#hub-model-result') as HTMLElement).textContent = 'Consultando modelo...';
    void api<{ text: string; provider: string; model: string }>('/api/hub/router/complete', { messages: [{ role: 'user', content: data.get('prompt') }] })
      .then((result) => { (panel.querySelector('#hub-model-result') as HTMLElement).textContent = `${result.provider} / ${result.model}: ${result.text}`; return refresh(); }).catch(showError); };
}
