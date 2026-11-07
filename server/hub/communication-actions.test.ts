import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { HubStore } from './store';
import { WhatsAppStore } from './whatsapp';
import { dispatchWithLocalFallback } from './dispatcher';
import { reconcileQuestionTasks, runCommunicationAction } from './communication-actions';

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
