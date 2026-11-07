import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { HubStore } from './store';
import { WhatsAppStore } from './whatsapp';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-wa-')); dirs.push(dir);
  const hub = new HubStore(join(dir, 'state.json'));
  const agent = hub.createAgent({ name: 'Atendente', objective: 'Perguntar' });
  const first = hub.createTask({ agentId: agent.id, instruction: 'Tarefa um' });
  const second = hub.createTask({ agentId: agent.id, instruction: 'Tarefa dois' });
  const question = hub.askQuestion({ taskId: first.id, text: 'Qual horário?' });
  const file = join(dir, 'whatsapp.json'); const whatsapp = new WhatsAppStore(file);
  whatsapp.configure({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' });
  const token = whatsapp.rotateWebhookToken();
  return { hub, whatsapp, file, first, second, question, token };
}
function event(code: string, id = 'MSG-001', jid = '5511999999999@s.whatsapp.net') {
  return { event: 'messages.upsert', instance: 'procura-de-emprego', data: { key: { id, remoteJid: jid, fromMe: false }, message: { conversation: `#${code} Disponível após as 14h` } } };
}

it('accepts only authenticated replies from the configured user and resumes one task', () => {
  const { hub, whatsapp, first, second, question, token } = setup();
  const payload = event(question.id.slice(0, 8));
  expect(() => whatsapp.ingest('wrong', payload, hub)).toThrow('Autenticação');
  expect(whatsapp.ingest(token, event(question.id.slice(0, 8), 'MSG-002', '5511777777777@s.whatsapp.net'), hub)).toBe('ignored');
  expect(whatsapp.ingest(token, payload, hub)).toBe('answered');
  expect(whatsapp.ingest(token, payload, hub)).toBe('duplicate');
  expect(hub.listTasks().find((t) => t.id === first.id)?.status).toBe('unassigned');
  expect(hub.listTasks().find((t) => t.id === second.id)?.status).toBe('unassigned');
  expect(hub.listQuestions()[0]).toMatchObject({ answer: 'Disponível após as 14h', sourceMessageId: 'MSG-001' });
});

it('persists deduplication and rejects messages sent by the bot', () => {
  const { hub, whatsapp, file, question, token } = setup();
  const payload = event(question.id.slice(0, 8));
  expect(whatsapp.ingest(token, { ...payload, data: { ...payload.data, key: { ...payload.data.key, fromMe: true } } }, hub)).toBe('ignored');
  expect(whatsapp.ingest(token, payload, hub)).toBe('answered');
  expect(new WhatsAppStore(file).ingest(token, payload, new HubStore(join(file, '..', 'state.json')))).toBe('duplicate');
  expect(JSON.stringify(whatsapp.status())).not.toContain(token);
});

it('sends a pending question to the fixed instance only after configuration', async () => {
  const { hub, whatsapp, question } = setup();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ key: { id: 'OUT-001' } }), { status: 200 }));
  const result = await whatsapp.sendQuestion(question.id, hub, 'local-api-key', fetcher);
  expect(result).toMatchObject({ state: 'accepted', providerMessageId: 'OUT-001' });
  expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:8080/message/sendText/procura-de-emprego');
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ number: '5511999999999' });
  expect((fetcher.mock.calls[0][1]?.headers as Record<string, string>).apikey).toBe('local-api-key');
  expect(JSON.stringify(whatsapp.status())).not.toContain('local-api-key');
  expect(await whatsapp.sendQuestion(question.id, hub, 'local-api-key', fetcher)).toEqual(result);
  expect(fetcher).toHaveBeenCalledOnce();
});

it('retains uncertain sends for review instead of resending after a timeout', async () => {
  const { hub, whatsapp, question } = setup();
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout'));
  const result = await whatsapp.sendQuestion(question.id, hub, 'local-api-key', fetcher);
  expect(result.state).toBe('uncertain');
  expect(await whatsapp.sendQuestion(question.id, hub, 'local-api-key', fetcher)).toEqual(result);
  expect(fetcher).toHaveBeenCalledOnce();
});

it('reports only the requested logical instance in diagnostics', async () => {
  const { whatsapp } = setup();
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ version: '2.3.7' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([{ name: 'orume', connectionStatus: 'open' }, { name: 'procura-de-emprego', connectionStatus: 'close' }]), { status: 200 }));
  expect(await whatsapp.diagnose('secret', fetcher)).toMatchObject({ reachable: true, version: '2.3.7', instanceExists: true, connectionStatus: 'close' });
  expect(JSON.stringify(await whatsapp.diagnose('', async () => new Response(JSON.stringify({ version: '2.3.7' }), { status: 200 })))).not.toContain('secret');
});

it('uses the configured Evolution base URL for diagnostics and sending', async () => {
  const { hub, whatsapp, question } = setup();
  const urls: string[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify(urls.length === 1 ? { version: '2.3.7' } : urls.length === 2 ? [] : { key: { id: 'OUT-002' } }), { status: 200 });
  });
  const base = 'https://evolution.example.test/api';
  await whatsapp.diagnose('secret', fetcher, base);
  await whatsapp.sendQuestion(question.id, hub, 'secret', fetcher, base);
  expect(urls).toEqual([`${base}/`, `${base}/instance/fetchInstances`, `${base}/message/sendText/procura-de-emprego`]);
});
