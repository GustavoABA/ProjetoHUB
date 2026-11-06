import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HubStore } from './store';
import { WhatsAppStore } from './whatsapp';
import { handleWhatsAppWebhook } from './whatsapp-http';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('accepts only a signed, bounded JSON webhook for the configured instance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-wa-http-')); dirs.push(dir);
  const hub = new HubStore(join(dir, 'state.json'));
  const agent = hub.createAgent({ name: 'Atendente', objective: 'Responder' });
  const task = hub.createTask({ agentId: agent.id, instruction: 'Perguntar' });
  const question = hub.askQuestion({ taskId: task.id, text: 'Qual horário?' });
  const whatsapp = new WhatsAppStore(join(dir, 'whatsapp.json'));
  whatsapp.configure({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' });
  const token = whatsapp.rotateWebhookToken();
  const server = http.createServer((req, res) => { handleWhatsAppWebhook(req, res, whatsapp, hub); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}/webhook/evolution`;
    const payload = { event: 'messages.upsert', instance: 'procura-de-emprego', data: { key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'MSG-HTTP-1' }, message: { conversation: `#${question.id.slice(0, 8)} Sim, às 14h` } } };
    const post = (secret: string) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ProjectHUB-Token': secret }, body: JSON.stringify(payload) });
    expect((await post('wrong')).status).toBe(401);
    expect(hub.listQuestions()[0].state).toBe('pending');
    expect((await post(token)).status).toBe(202);
    expect((await post(token)).status).toBe(200);
    expect(hub.listQuestions()[0].answer).toBe('Sim, às 14h');
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
