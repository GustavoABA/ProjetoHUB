import http from 'node:http';
import { Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HubStore } from './store';
import { handleHubRoute } from './http';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

it('refuses management access from a non-loopback socket', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  const req = new http.IncomingMessage(new Socket());
  Object.defineProperty(req.socket, 'remoteAddress', { value: '192.0.2.1' });
  req.method = 'GET'; req.url = '/api/hub/agents';
  const res = new http.ServerResponse(req);
  expect(handleHubRoute(req, res, new URL(req.url, 'http://localhost'), new HubStore(join(dir, 'state.json')))).toBe(true);
  expect(res.statusCode).toBe(403);
});

it('creates and lists agents and tasks over local HTTP', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  const store = new HubStore(join(dir, 'state.json'));
  const server = http.createServer((req, res) => {
    if (!handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), store)) { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const created = await post('/api/hub/agents', { name: 'Pesquisa', objective: 'Vagas reais' });
    expect(created.status).toBe(201);
    const agent = await created.json();
    const task = await post('/api/hub/tasks', { agentId: agent.id, instruction: 'Buscar' });
    expect(task.status).toBe(201);
    expect((await task.json()).status).toBe('unassigned');
    expect((await (await fetch(base + '/api/hub/agents')).json())).toHaveLength(1);
    expect((await (await fetch(base + '/api/hub/tasks')).json())).toHaveLength(1);
    expect((await post('/api/hub/tasks', { agentId: 'missing', instruction: 'Buscar' })).status).toBe(400);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
