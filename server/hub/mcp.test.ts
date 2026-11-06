import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { HubStore } from './store';
import { JobStore } from './jobs';
import { ApplicationStore } from './applications';
import { ModelRouter } from './router';
import { AdminKeyStore, createMcpRequestHandler } from './mcp';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test('MCP exige chave, rejeita Origin desconhecida e executa ferramentas autenticadas', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-mcp-')); dirs.push(dir);
  const hub = new HubStore(join(dir, 'hub.json'));
  const keys = new AdminKeyStore(join(dir, 'admin.json'));
  const key = keys.rotate();
  expect(key).toMatch(/^phub_[a-f0-9]{64}$/);
  expect(JSON.stringify(keys)).not.toContain(key);
  const handler = createMcpRequestHandler({ hub, jobs: new JobStore(join(dir, 'jobs.json')),
    applications: new ApplicationStore(join(dir, 'applications.json')),
    router: new ModelRouter(join(dir, 'router.json')), keys, allowedHosts: ['127.0.0.1'] });
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
    const created = await post('tools/call', { name: 'criar_agente', arguments: { nome: 'Pesquisa', objetivo: 'Encontrar vagas' } }, key);
    expect(created.status).toBe(200);
    expect(hub.listAgents()).toMatchObject([{ name: 'Pesquisa' }]);
    const old = key; const replacement = keys.rotate();
    expect((await post('tools/list', {}, old)).status).toBe(401);
    expect((await post('tools/list', {}, replacement)).status).toBe(200);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
