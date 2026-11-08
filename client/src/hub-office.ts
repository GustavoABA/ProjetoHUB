import { appearanceFromSeed, characterSprite, hash32, poseFrameCount, poseFrameDuration, type Pose } from './art';
import { tr } from '../../shared/i18n';

export type OfficeAgent = { id: string; name: string; objective: string; status?: 'active' | 'paused' | 'ended'; systemKey?: string };
export type OfficeTask = { id: string; agentId: string; instruction: string; status: string; updatedAt?: string };
export type OfficeApplication = { id: string; status: string };
type Activity = { label: string; pose: Pose; tone: string };

/** The strip reads only persisted ProjectHUB state; it does not alter Habblaud World telemetry. */
export function agentActivity(agent: OfficeAgent, tasks: OfficeTask[], applications: OfficeApplication[] = []): Activity {
  if (agent.status === 'ended') return { label: 'Encerrado', pose: 'stand', tone: 'muted' };
  if (agent.status === 'paused') return { label: 'Pausado', pose: 'wait', tone: 'muted' };
  const own = tasks.filter((task) => task.agentId === agent.id);
  const active = own.filter((task) => ['dispatching', 'sent', 'waiting_input', 'queued', 'unassigned', 'paused'].includes(task.status));
  const rank: Record<string, number> = { dispatching: 5, sent: 4, waiting_input: 3, queued: 2, unassigned: 2, paused: 1 };
  const selected = (active.length ? active : own).sort((a, b) =>
    (rank[b.status] ?? 0) - (rank[a.status] ?? 0) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
  if (agent.systemKey === 'job-search/applications' &&
    applications.some((application) => application.status === 'awaiting_approval') &&
    !['dispatching', 'sent', 'waiting_input'].includes(selected?.status ?? ''))
    return { label: 'Aguardando permissão', pose: 'raise_hand', tone: 'waiting' };
  if (!selected) return { label: 'Ocioso', pose: 'stand', tone: 'idle' };
  switch (selected.status) {
    case 'dispatching': return agent.systemKey === 'job-search/researcher'
      ? { label: 'Pesquisando', pose: 'read', tone: 'busy' }
      : { label: 'Trabalhando', pose: 'type', tone: 'busy' };
    case 'sent': return { label: 'Aguardando Codex', pose: 'wait', tone: 'waiting' };
    case 'waiting_input': return { label: 'Aguardando resposta', pose: 'raise_hand', tone: 'waiting' };
    case 'queued': case 'unassigned': return { label: 'Na fila', pose: 'stand', tone: 'waiting' };
    case 'paused': return { label: 'Tarefa pausada', pose: 'wait', tone: 'muted' };
    case 'done': return { label: 'Finalizado', pose: 'cheer', tone: 'done' };
    case 'result_ready': return { label: 'Resultado pronto', pose: 'raise_hand', tone: 'done' };
    case 'failed': case 'interrupted': return { label: 'Erro', pose: 'sulk', tone: 'error' };
    default: return { label: 'Ocioso', pose: 'stand', tone: 'idle' };
  }
}

const css = `
#hub-office{position:fixed;left:12px;bottom:12px;z-index:35;max-width:min(720px,calc(100vw - 24px));background:#171a27e8;border:2px solid #a697e2;box-shadow:0 5px 22px #0008;color:#fff;padding:6px;font:13px 'Pixelify Sans',sans-serif}
#hub-office[hidden]{display:none}#hub-office-header{font-weight:700;margin:2px 4px 5px}#hub-office-crew{display:flex;gap:5px;overflow-x:auto;max-height:112px}
body:has(#hub-office:not([hidden])) .ui-empty{display:none}
.hub-office-agent{display:flex;flex:0 0 103px;align-items:center;flex-direction:column;background:#262a3a;border:1px solid #626d8d;color:#fff;cursor:pointer;padding:3px;min-height:91px;font:12px 'Pixelify Sans',sans-serif}
.hub-office-agent canvas{width:36px;height:51px;image-rendering:pixelated}.hub-office-agent strong,.hub-office-agent small{display:block;max-width:98px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.hub-office-agent[data-tone=busy]{border-color:#70d8b1}.hub-office-agent[data-tone=waiting]{border-color:#f1cf75}.hub-office-agent[data-tone=done]{border-color:#88c6ff}.hub-office-agent[data-tone=error]{border-color:#ee8d9c}.hub-office-agent[data-tone=muted]{opacity:.65}
@media(max-width:600px){#hub-office{left:5px;bottom:5px;max-width:calc(100vw - 10px)}.hub-office-agent{flex-basis:85px}.hub-office-agent strong,.hub-office-agent small{max-width:82px}}
`;

export function mountAgentOffice(worldCanvas: HTMLCanvasElement, panel: HTMLElement,
  openPanel: (view: 'agents' | 'applications') => void): {
  update: (agents: OfficeAgent[], tasks: OfficeTask[], applications?: OfficeApplication[]) => void;
  poll: () => Promise<void>;
} {
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  const root = document.createElement('section'); root.id = 'hub-office'; root.setAttribute('aria-label', tr('Agentes do ProjetoHUB'));
  const heading = document.createElement('div'); heading.id = 'hub-office-header'; heading.textContent = tr('Equipe ProjetoHUB');
  const crew = document.createElement('div'); crew.id = 'hub-office-crew'; root.append(heading, crew); document.body.append(root);
  let current: { agent: OfficeAgent; activity: Activity; canvas: HTMLCanvasElement }[] = [];
  let frame = 0;
  let loading = false;
  const visible = () => !worldCanvas.hidden && panel.hidden;
  const animate = () => {
    root.hidden = !visible() || current.length === 0;
    if (root.hidden) return;
    frame++;
    for (const item of current) {
      const ctx = item.canvas.getContext('2d');
      if (!ctx) continue;
      const pose = item.activity.pose;
      const index = Math.floor(frame * 300 / poseFrameDuration(pose)) % poseFrameCount(pose);
      const sprite = characterSprite({ appearance: appearanceFromSeed(hash32(item.agent.id)), dir: pose === 'type' ? 'up' : 'down', pose, frame: index });
      ctx.clearRect(0, 0, item.canvas.width, item.canvas.height);
      ctx.drawImage(sprite.canvas, 0, 0);
    }
  };
  window.setInterval(animate, 300);
  const update = (agents: OfficeAgent[], tasks: OfficeTask[], applications: OfficeApplication[] = []) => {
    current = [];
    crew.replaceChildren();
    for (const agent of agents) {
      const activity = agentActivity(agent, tasks, applications);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'hub-office-agent'; button.dataset.tone = activity.tone;
      const approval = activity.label === 'Aguardando permissão';
      button.title = `${agent.name} — ${activity.label}. ${tr(approval ? 'Abrir candidaturas' : 'Abrir agentes e tarefas')}`;
      button.setAttribute('aria-label', button.title);
      const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 34;
      const name = document.createElement('strong'); name.textContent = agent.name;
      const status = document.createElement('small'); status.textContent = tr(activity.label);
      button.append(canvas, name, status); button.onclick = () => openPanel(approval ? 'applications' : 'agents'); crew.append(button);
      current.push({ agent, activity, canvas });
    }
    animate();
  };
  const poll = async () => {
    if (loading || !visible()) return;
    loading = true;
    try {
      const responses = await Promise.all([fetch('/api/hub/agents'), fetch('/api/hub/tasks'), fetch('/api/hub/applications')]);
      if (responses.some((response) => !response.ok)) throw new Error('Estado indisponível');
      const [agents, tasks, applications] = await Promise.all([responses[0].json() as Promise<OfficeAgent[]>,
        responses[1].json() as Promise<OfficeTask[]>, responses[2].json() as Promise<OfficeApplication[]>]);
      update(agents, tasks, applications);
    } catch {
      current = []; crew.replaceChildren(); root.hidden = true;
    } finally { loading = false; }
  };
  void poll();
  return { update, poll };
}
