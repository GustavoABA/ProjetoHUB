import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { HubStore } from './store';
import { WhatsAppStore } from './whatsapp';
import { dispatchWithLocalFallback } from './dispatcher';
import { reconcileQuestionTasks, runCommunicationAction } from './communication-actions';
import { JobStore } from './jobs';
import { ApplicationStore } from './applications';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-communication-')); dirs.push(dir);
  const hub = new HubStore(join(dir, 'state.json')); hub.ensureJobSearchTeam();
  const whatsapp = new WhatsAppStore(join(dir, 'whatsapp.json'));
  const owner = hub.listAgents().find((agent) => agent.systemKey === 'job-search/applications')!;
  const first = hub.createTask({ agentId: owner.id, instruction: 'Primeira candidatura' });
  const second = hub.createTask({ agentId: owner.id, instruction: 'Outra candidatura' });
  const question = hub.askQuestion({ taskId: first.id, text: 'Qual o horário disponível?' });
  const communicator = hub.listAgents().find((agent) => agent.systemKey === 'job-search/whatsapp')!;
  return { dir, hub, whatsapp, first, second, question, communicator };
}

it('delegates only configured pending questions and records accepted delivery once', async () => {
  const { dir, hub, whatsapp, first, second, question, communicator } = fixture();
  expect(reconcileQuestionTasks(hub, whatsapp, false)).toBe(0);
  whatsapp.configure({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' });
  const token = whatsapp.rotateWebhookToken();
  expect(reconcileQuestionTasks(hub, whatsapp, true)).toBe(1);
  expect(reconcileQuestionTasks(hub, whatsapp, true)).toBe(0);
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ key: { id: 'WA-001' } }), { status: 200 }));
  const task = hub.listTasks().find((item) => item.agentId === communicator.id)!;
  expect(task.instruction).toBe(question.id);
  const result = await dispatchWithLocalFallback(hub, undefined,
    async () => { throw new Error('Modelo não deve enviar WhatsApp'); }, Date.now(),
    (agent) => agent.systemKey === 'job-search/whatsapp',
    (selected, agent) => runCommunicationAction(selected, agent, { hub, whatsapp, apiKey: async () => 'test-key', fetcher: send }));
  expect(result).toMatchObject({ id: task.id, status: 'done' });
  expect(result?.result).toContain('aceita pela Evolution');
  expect(whatsapp.status().outbound).toMatchObject([{ questionId: question.id, state: 'accepted', providerMessageId: 'WA-001' }]);
  expect(hub.listTasks().find((item) => item.id === first.id)?.status).toBe('waiting_input');
  expect(hub.listTasks().find((item) => item.id === second.id)?.status).toBe('unassigned');
  expect(reconcileQuestionTasks(new HubStore(join(dir, 'state.json')), new WhatsAppStore(join(dir, 'whatsapp.json')), true)).toBe(0);
  expect(send).toHaveBeenCalledOnce();
  const reply = { event: 'messages.upsert', instance: 'procura-de-emprego', data: { key: { id: 'IN-001',
    remoteJid: '5511999999999@s.whatsapp.net', fromMe: false }, message: { conversation: `#${question.id.slice(0, 8)} Após as 14h` } } };
  expect(whatsapp.ingest(token, reply, hub)).toBe('answered');
  expect(hub.listTasks().find((item) => item.id === first.id)?.status).toBe('unassigned');
  expect(hub.listTasks().find((item) => item.id === second.id)?.status).toBe('unassigned');
  expect(hub.listQuestions().find((item) => item.id === question.id)?.answer).toBe('Após as 14h');
});

it('keeps an uncertain WhatsApp outcome visible and never sends it twice', async () => {
  const { hub, whatsapp, question, communicator } = fixture();
  whatsapp.configure({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' });
  reconcileQuestionTasks(hub, whatsapp, true);
  const send = vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout'));
  const action = (selected: Parameters<typeof runCommunicationAction>[0], agent: Parameters<typeof runCommunicationAction>[1]) =>
    runCommunicationAction(selected, agent, { hub, whatsapp, apiKey: async () => 'test-key', fetcher: send });
  const failed = await dispatchWithLocalFallback(hub, undefined, async () => { throw new Error('Modelo não deve ser chamado'); },
    Date.now(), (agent) => agent.systemKey === 'job-search/whatsapp', action);
  expect(failed?.status).toBe('failed');
  expect(whatsapp.status().outbound).toMatchObject([{ questionId: question.id, state: 'uncertain' }]);
  expect(reconcileQuestionTasks(hub, whatsapp, true)).toBe(0);
  await expect(action(hub.listTasks().find((task) => task.agentId === communicator.id)!, communicator)).rejects.toThrow('incerto');
  expect(send).toHaveBeenCalledOnce();
});

it('does not send a question answered before the communicator task executes', async () => {
  const { hub, whatsapp, question, communicator } = fixture();
  whatsapp.configure({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' });
  reconcileQuestionTasks(hub, whatsapp, true);
  hub.answerQuestion(question.id, 'Após as 14h');
  const send = vi.fn<typeof fetch>();
  const task = hub.listTasks().find((item) => item.agentId === communicator.id)!;
  expect(await runCommunicationAction(task, communicator, { hub, whatsapp, apiKey: async () => 'test-key', fetcher: send })).toContain('já respondida');
  expect(send).not.toHaveBeenCalled();
});

it('does not send a question cancelled before the communicator task executes', async () => {
  const { hub, whatsapp, question, communicator } = fixture();
  whatsapp.configure({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' });
  reconcileQuestionTasks(hub, whatsapp, true);
  hub.cancelQuestion(question.id);
  const send = vi.fn<typeof fetch>();
  const task = hub.listTasks().find((item) => item.agentId === communicator.id)!;
  expect(await runCommunicationAction(task, communicator, { hub, whatsapp, apiKey: async () => 'test-key', fetcher: send })).toContain('cancelada');
  expect(send).not.toHaveBeenCalled();
});

it('persists new vacancy and application events, delegates each once, and does not replay history', async () => {
  const { dir, hub, whatsapp, communicator } = fixture();
  const jobs = new JobStore(join(dir, 'jobs.json'));
  const applications = new ApplicationStore(join(dir, 'applications.json'));
  whatsapp.reconcileEvents(jobs.list(), applications.list());
  expect(whatsapp.status().notifications).toEqual([]);
  jobs.addListings([{ id: 'job-1', source: 'Remotive', sourceId: '1', company: 'Acme', title: 'Assistente', location: 'Remoto', mode: 'remote',
    description: 'Vaga real da fonte', requirements: [], originalUrl: 'https://remotive.com/remote-jobs/test', discoveredAt: new Date().toISOString(),
    compatibility: null, justification: 'Pendente', applicationStatus: 'not_started' }]);
  const application = applications.create({ jobId: 'job-1', source: 'Remotive', sourceId: '1',
    originalUrl: 'https://remotive.com/remote-jobs/test', title: 'Assistente', company: 'Acme' });
  whatsapp.reconcileEvents(jobs.list(), applications.list());
  expect(whatsapp.status().notifications.map((item) => item.type)).toEqual(['job_found', 'application_started']);
  expect(reconcileQuestionTasks(hub, whatsapp, true)).toBe(3);
  expect(reconcileQuestionTasks(hub, whatsapp, true)).toBe(0);
  const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ key: { id: 'WA-002' } }), { status: 200 }));
  whatsapp.configure({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' });
  for (const task of hub.listTasks().filter((item) => item.agentId === communicator.id && item.instruction.startsWith('notification:')))
    await runCommunicationAction(task, communicator, { hub, whatsapp, apiKey: async () => 'test-key', fetcher: send });
  expect(send).toHaveBeenCalledTimes(2);
  expect(whatsapp.status().notifications.every((item) => item.state === 'accepted')).toBe(true);
  expect(whatsapp.status().notifications[0].text).toContain('https://remotive.com/remote-jobs/test');
  const restored = new WhatsAppStore(join(dir, 'whatsapp.json'));
  restored.reconcileEvents(jobs.list(), applications.list());
  expect(restored.status().notifications).toHaveLength(2);
  expect(restored.status().notifications[1].text).toContain(application.id);
});

it('keeps an uncertain event send after restart without retrying it', async () => {
  const { dir, hub, whatsapp, communicator } = fixture();
  const jobs = new JobStore(join(dir, 'jobs.json'));
  const applications = new ApplicationStore(join(dir, 'applications.json'));
  whatsapp.reconcileEvents([], []);
  const application = applications.create({ jobId: 'job-2', source: 'Remotive', sourceId: '2',
    originalUrl: 'https://remotive.com/remote-jobs/test2', title: 'Auxiliar', company: 'Exemplo' });
  whatsapp.reconcileEvents(jobs.list(), applications.list());
  whatsapp.configure({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' });
  reconcileQuestionTasks(hub, whatsapp, true);
  const task = hub.listTasks().find((item) => item.agentId === communicator.id && item.instruction.startsWith('notification:'))!;
  const send = vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout'));
  await expect(runCommunicationAction(task, communicator, { hub, whatsapp, apiKey: async () => 'test-key', fetcher: send })).rejects.toThrow('incerto');
  const restored = new WhatsAppStore(join(dir, 'whatsapp.json'));
  expect(restored.status().notifications[0]).toMatchObject({ type: 'application_started', state: 'uncertain' });
  await expect(runCommunicationAction(task, communicator, { hub, whatsapp: restored, apiKey: async () => 'test-key', fetcher: send })).rejects.toThrow('incerto');
  expect(send).toHaveBeenCalledOnce();
  expect(application.status).toBe('draft');
});

it('notifies approval and submission only after the persisted application transition', () => {
  const { dir, whatsapp } = fixture();
  const applications = new ApplicationStore(join(dir, 'applications.json'));
  whatsapp.reconcileEvents([], []);
  const app = applications.create({ jobId: 'job-3', source: 'Remotive', sourceId: '3',
    originalUrl: 'https://remotive.com/remote-jobs/test3', title: 'Analista', company: 'Empresa' });
  whatsapp.reconcileEvents([], applications.list());
  expect(whatsapp.status().notifications.map((item) => item.type)).toEqual(['application_started']);
  applications.setAnswers(app.id, { Disponibilidade: 'Imediata' });
  applications.requestApproval(app.id);
  whatsapp.reconcileEvents([], applications.list());
  expect(whatsapp.status().notifications.map((item) => item.type)).toEqual(['application_started', 'approval_needed']);
  applications.approve(app.id);
  applications.startSubmission(app.id, 'https://remotive.com/remote-jobs/test3');
  whatsapp.reconcileEvents([], applications.list());
  expect(whatsapp.status().notifications.at(-1)?.type).toBe('submission_started');
  expect(whatsapp.status().notifications.some((item) => item.type === 'application_submitted')).toBe(false);
  applications.confirmSubmission(app.id, { url: 'https://remotive.com/remote-jobs/test3', confirmationText: 'Recebido',
    screenshot: Buffer.from('89504e470d0a1a0a', 'hex') });
  whatsapp.reconcileEvents([], applications.list());
  expect(whatsapp.status().notifications.at(-1)?.type).toBe('application_submitted');
});

it('queues one durable error notice for a failed task without replaying historical failures', () => {
  const { dir, hub, whatsapp } = fixture();
  const old = hub.createTask({ agentId: hub.listAgents()[0].id, instruction: 'Tarefa antiga' });
  hub.setTaskStatus(old.id, 'failed', 'Falha antiga');
  whatsapp.reconcileEvents([], [], hub.listTasks());
  expect(whatsapp.status().notifications).toEqual([]);
  const recent = hub.createTask({ agentId: hub.listAgents()[0].id, instruction: 'Tarefa nova' });
  hub.setTaskStatus(recent.id, 'failed', 'Falha recente');
  whatsapp.reconcileEvents([], [], hub.listTasks());
  expect(whatsapp.status().notifications).toMatchObject([{ type: 'task_error', state: 'pending' }]);
  expect(whatsapp.status().notifications[0].text).toContain(recent.id);
  expect(whatsapp.status().notifications[0].text).not.toContain('Tarefa nova');
  const restored = new WhatsAppStore(join(dir, 'whatsapp.json'));
  restored.reconcileEvents([], [], hub.listTasks());
  expect(restored.status().notifications).toHaveLength(1);
  const communicator = hub.listAgents().find((agent) => agent.systemKey === 'job-search/whatsapp')!;
  const alertTask = hub.createTask({ agentId: communicator.id, instruction: `notification:${restored.status().notifications[0].id}` });
  hub.setTaskStatus(alertTask.id, 'failed', 'Evolution offline');
  restored.reconcileEvents([], [], hub.listTasks());
  expect(restored.status().notifications).toHaveLength(1);
});

it('queues one daily summary at the configured local hour using only persisted outcomes', async () => {
  const { dir, hub, whatsapp } = fixture();
  const jobs = new JobStore(join(dir, 'jobs.json'));
  const applications = new ApplicationStore(join(dir, 'applications.json'));
  const now = new Date(); now.setHours(18, 0, 0, 0);
  jobs.addListings([{ id: 'summary-job', source: 'Remotive', sourceId: 'summary-1', company: 'Empresa', title: 'Auxiliar',
    location: 'Remota', mode: 'remote', description: 'Descrição', requirements: [], originalUrl: 'https://remotive.com/remote-jobs/example',
    discoveredAt: now.toISOString(), compatibility: null, justification: 'Pendente', applicationStatus: 'not_started' }]);
  applications.create({ jobId: 'summary-job', source: 'Remotive', sourceId: 'summary-1',
    originalUrl: 'https://remotive.com/remote-jobs/example', title: 'Auxiliar', company: 'Empresa' });
  expect(whatsapp.reconcileDailySummary(now, jobs.list(), applications.list(), hub.listTasks())).toBe(0);
  whatsapp.configure({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' });
  whatsapp.configureSummary({ enabled: true, hour: 18 });
  const before = new Date(now); before.setHours(17);
  expect(whatsapp.reconcileDailySummary(before, jobs.list(), applications.list(), hub.listTasks())).toBe(0);
  expect(whatsapp.reconcileDailySummary(now, jobs.list(), applications.list(), hub.listTasks())).toBe(1);
  expect(whatsapp.status().notifications[0]).toMatchObject({ type: 'daily_summary', state: 'pending' });
  expect(whatsapp.status().notifications[0].text).toContain('Vagas novas: 1');
  expect(whatsapp.status().notifications[0].text).toContain('Candidaturas confirmadas: 0');
  const restored = new WhatsAppStore(join(dir, 'whatsapp.json'));
  expect(restored.reconcileDailySummary(now, jobs.list(), applications.list(), hub.listTasks())).toBe(0);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  expect(restored.reconcileDailySummary(tomorrow, jobs.list(), applications.list(), hub.listTasks())).toBe(1);
  expect(restored.status().notifications[0].state).toBe('superseded');
  expect(restored.status().notifications[1].text).toContain('Vagas novas: 0');
  const communicator = hub.listAgents().find((agent) => agent.systemKey === 'job-search/whatsapp')!;
  const oldTask = hub.createTask({ agentId: communicator.id, instruction: `notification:${restored.status().notifications[0].id}` });
  const send = vi.fn<typeof fetch>();
  expect(await runCommunicationAction(oldTask, communicator, { hub, whatsapp: restored, apiKey: async () => 'test-key', fetcher: send })).toContain('substituído');
  expect(send).not.toHaveBeenCalled();
});
