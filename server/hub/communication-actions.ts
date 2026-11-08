import type { HubAgent, HubStore, HubTask } from './store';
import type { WhatsAppStore } from './whatsapp';

export interface CommunicationDeps {
  hub: HubStore;
  whatsapp: WhatsAppStore;
  apiKey(): Promise<string>;
  fetcher?: typeof fetch;
  baseUrl?: string;
}

/** Queue one send per pending question only after the administrator has configured the channel. */
export function reconcileQuestionTasks(hub: HubStore, whatsapp: WhatsAppStore, ready: boolean): number {
  if (!ready) return 0;
  const communicator = hub.listAgents().find((agent) => agent.systemKey === 'job-search/whatsapp' && agent.status !== 'ended');
  if (!communicator) return 0;
  const assigned = new Set(hub.listTasks().filter((task) => task.agentId === communicator.id).map((task) => task.instruction));
  const outbound = new Set(whatsapp.status().outbound.map((message) => message.questionId));
  let created = 0;
  for (const question of hub.listQuestions()) {
    if (question.state !== 'pending' || assigned.has(question.id) || outbound.has(question.id)) continue;
    hub.createTask({ agentId: communicator.id, instruction: question.id, priority: 4 });
    assigned.add(question.id); created++;
  }
  const notifications = whatsapp.status().notifications;
  for (const notification of notifications) {
    const instruction = `notification:${notification.id}`;
    if (notification.state !== 'pending' || assigned.has(instruction)) continue;
    hub.createTask({ agentId: communicator.id, instruction, priority: ['approval_needed', 'task_error'].includes(notification.type) ? 4 : 2 });
    assigned.add(instruction); created++;
  }
  return created;
}

/** Accepted by Evolution is recorded as delivery to the API, never as phone delivery. */
export async function runCommunicationAction(task: HubTask, agent: HubAgent, deps: CommunicationDeps): Promise<string | undefined> {
  if (agent.systemKey !== 'job-search/whatsapp') return undefined;
  if (task.instruction.startsWith('notification:')) {
    const notification = deps.whatsapp.status().notifications.find((item) => `notification:${item.id}` === task.instruction);
    if (!notification) throw new Error('Aviso WhatsApp não encontrado');
    if (notification.state === 'superseded') return 'Resumo substituído por um dia mais recente; nenhum envio iniciado.';
    if (notification.state === 'accepted') return 'Aviso já aceito pela Evolution; entrega ao telefone não confirmada.';
    if (notification.state === 'uncertain' || notification.state === 'sending') throw new Error('Resultado do envio WhatsApp incerto; confira a Evolution antes de outra tentativa');
    if (notification.state === 'failed') throw new Error(`Envio WhatsApp falhou: ${notification.error ?? 'verifique a Evolution'}`);
    const sent = await deps.whatsapp.sendNotification(notification.id, await deps.apiKey(), deps.fetcher, deps.baseUrl);
    if (sent.state === 'accepted') return 'Aviso aceito pela Evolution; entrega ao telefone não confirmada.';
    if (sent.state === 'uncertain' || sent.state === 'sending') throw new Error('Resultado do envio WhatsApp incerto; confira a Evolution antes de outra tentativa');
    throw new Error(`Envio WhatsApp falhou: ${sent.error ?? 'verifique a Evolution'}`);
  }
  const question = deps.hub.listQuestions().find((item) => item.id === task.instruction);
  if (!question) throw new Error('Pergunta não encontrada para comunicação');
  if (question.state !== 'pending') return 'Pergunta já respondida ou cancelada; nenhum envio foi iniciado.';
  const existing = deps.whatsapp.status().outbound.find((message) => message.questionId === question.id);
  if (existing?.state === 'uncertain' || existing?.state === 'sending') throw new Error('Resultado do envio WhatsApp incerto; confira a Evolution antes de outra tentativa');
  if (existing?.state === 'failed') throw new Error(`Envio WhatsApp falhou: ${existing.error ?? 'verifique a Evolution'}`);
  if (existing?.state === 'accepted') return `Pergunta #${question.id.slice(0, 8)} já aceita pela Evolution; entrega ao telefone não confirmada.`;
  const key = await deps.apiKey();
  const sent = await deps.whatsapp.sendQuestion(question.id, deps.hub, key, deps.fetcher, deps.baseUrl);
  if (sent.state === 'accepted') return `Pergunta #${question.id.slice(0, 8)} aceita pela Evolution; entrega ao telefone não confirmada.`;
  if (sent.state === 'uncertain' || sent.state === 'sending') throw new Error('Resultado do envio WhatsApp incerto; confira a Evolution antes de outra tentativa');
  throw new Error(`Envio WhatsApp falhou: ${sent.error ?? 'verifique a Evolution'}`);
}
