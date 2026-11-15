import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { HubStore } from './store';
import { JobStore } from './jobs';
import { ApplicationStore } from './applications';
import { ModelRouter } from './router';
import { AdminKeyStore, createMcpRequestHandler } from './mcp';
import { WhatsAppStore } from './whatsapp';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test('MCP exige chave, rejeita Origin desconhecida e executa ferramentas autenticadas', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-mcp-')); dirs.push(dir);
  const hub = new HubStore(join(dir, 'hub.json'));
  const keys = new AdminKeyStore(join(dir, 'admin.json'));
  const key = keys.rotate();
  expect(key).toMatch(/^phub_[a-f0-9]{64}$/);
  expect(JSON.stringify(keys)).not.toContain(key);
  const allowedHosts = ['127.0.0.1'];
  const router = new ModelRouter(join(dir, 'router.json'));
  const primary = router.add({ provider: 'ollama', model: 'primary', priority: 1 });
  const backup = router.add({ provider: 'ollama', model: 'backup', priority: 2 });
  const applications = new ApplicationStore(join(dir, 'applications.json'));
  const whatsapp = new WhatsAppStore(join(dir, 'whatsapp.json'));
  whatsapp.reconcileEvents([], []);
  const application = applications.create({ jobId: 'job-1', source: 'Remotive', sourceId: '1',
    originalUrl: 'https://remotive.com/remote-jobs/test', title: 'Auxiliar', company: 'Empresa' });
  whatsapp.reconcileEvents([], applications.list());
  const handler = createMcpRequestHandler({ hub, jobs: new JobStore(join(dir, 'jobs.json')),
    applications, whatsapp, router, keys, allowedHosts });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('Sem porta');
  const url = `http://127.0.0.1:${addr.port}/mcp`;
  const post = (method: string, params?: object, token?: string, origin?: string) => fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? {} }),
  });
  try {
    expect((await post('tools/list')).status).toBe(401);
    expect((await post('tools/list', {}, key, 'https://evil.example')).status).toBe(403);
    const listed = await post('tools/list', {}, key);
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain('criar_agente');
    const pending = await post('tools/call', { name: 'consultar_notificacoes_pendentes', arguments: {} }, key);
    expect(pending.status).toBe(200);
    expect(await pending.text()).toContain(application.id);
    const hosted = () => new Promise<number>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: addr.port, path: '/mcp', method: 'POST', headers: { host: 'office.ngrok.app', authorization: `Bearer ${key}`,
        'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' } }, (response) => {
        response.resume(); response.on('end', () => resolve(response.statusCode ?? 0));
      });
      req.on('error', reject); req.end(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    });
    expect(await hosted()).toBe(403);
    allowedHosts.push('office.ngrok.app');
    expect(await hosted()).toBe(200);
    allowedHosts.pop();
    expect(await hosted()).toBe(403);
    const created = await post('tools/call', { name: 'criar_agente', arguments: { nome: 'Pesquisa', objetivo: 'Encontrar vagas' } }, key);
    expect(created.status).toBe(200);
    expect(hub.listAgents()).toMatchObject([{ name: 'Pesquisa' }]);
    const agentId = hub.listAgents()[0].id;
    const thread = '12345678-1234-1234-1234-123456789012';
    const linked = await post('tools/call', { name: 'atualizar_agente', arguments: { id: agentId, sessaoCodex: thread, pastaCodex: 'C:/Codex' } }, key);
    expect(linked.status).toBe(200);
    expect(hub.agent(agentId)?.codexThread).toBe(thread);
    const unlinked = await post('tools/call', { name: 'atualizar_agente', arguments: { id: agentId, sessaoCodex: null, pastaCodex: null } }, key);
    expect(unlinked.status).toBe(200);
    expect(hub.agent(agentId)?.codexThread).toBeUndefined();
    const routed = await post('tools/call', { name: 'atualizar_agente', arguments: { id: agentId,
      modeloId: primary.id, modelosReservaIds: [backup.id], limiteMensalChamadasIA: 5, limiteMensalCustoEstimadoUSD: 2 } }, key);
    expect(routed.status).toBe(200);
    expect(hub.agent(agentId)).toMatchObject({ modelId: primary.id, fallbackModelIds: [backup.id], monthlyAiRequestLimit: 5,
      monthlyAiCostLimitUsd: 2 });
    const old = key; const replacement = keys.rotate();
    expect((await post('tools/list', {}, old)).status).toBe(401);
    expect((await post('tools/list', {}, replacement)).status).toBe(200);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
