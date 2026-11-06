type Agent = { id: string; name: string; objective: string; parentId?: string; codexThread?: string };
type Task = { id: string; agentId: string; instruction: string; status: string; error?: string };
type Session = { name: string; sessionId: string; account: string; provider: string };
type Source = { label: string; path: string; provider: string };
type Job = { id: string; title: string; company: string; location: string; source: string; originalUrl: string; salary?: string; compatibility: number | null; applicationStatus: string };
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

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
    <p>Fonte: Remotive. A consulta pública tem limite de quatro tentativas por dia; as vagas exibidas levam ao anúncio original.</p>
    <p id="projecthub-message" role="status"></p><h3>Agentes</h3><ul id="hub-agents"></ul><h3>Tarefas</h3><ul id="hub-tasks"></ul><h3>Vagas encontradas</h3><ul id="hub-jobs"></ul>`;
  document.body.append(open, panel);
  const message = panel.querySelector('#projecthub-message') as HTMLElement;
  const agentForm = panel.querySelector('#hub-agent-form') as HTMLFormElement;
  const taskForm = panel.querySelector('#hub-task-form') as HTMLFormElement;
  const jobForm = panel.querySelector('#hub-job-form') as HTMLFormElement;
  const sessions = agentForm.elements.namedItem('session') as HTMLSelectElement;
  const parents = agentForm.elements.namedItem('parent') as HTMLSelectElement;
  const agentsSelect = taskForm.elements.namedItem('agent') as HTMLSelectElement;
  let choices: { thread: string; home: string }[] = [];
  const option = (select: HTMLSelectElement, value: string, label: string) => { const o = document.createElement('option'); o.value = value; o.textContent = label; select.append(o); };

  async function refresh(): Promise<void> {
    const [agents, tasks, jobs, snapshot, health] = await Promise.all([
      api<Agent[]>('/api/hub/agents'), api<Task[]>('/api/hub/tasks'),
      api<Job[]>('/api/hub/jobs'),
      api<{ agents: Session[] }>('/api/snapshot'), api<{ sources: Source[] }>('/api/health'),
    ]);
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
    if (panel.hidden || agentForm.contains(document.activeElement) || taskForm.contains(document.activeElement) || jobForm.contains(document.activeElement)) return;
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
}
