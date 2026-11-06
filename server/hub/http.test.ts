import http from 'node:http';
import { Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HubStore } from './store';
import { handleHubRoute } from './http';
import { JobStore } from './jobs';
import { BrowserManager } from './browser';

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

it('searches a public source and lists only traceable vacancies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  const agents = new HubStore(join(dir, 'state.json'));
  const jobs = new JobStore(join(dir, 'jobs.json'));
  const fetcher = async () => new Response(JSON.stringify({ jobs: [{ id: 51, url: 'https://remotive.com/remote-jobs/operations/assistant-51', title: 'Assistant', company_name: 'Acme', candidate_required_location: 'Brazil', description: 'Support' }] }), { status: 200 });
  const server = http.createServer((req, res) => { handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), agents, jobs, fetcher); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(base + '/api/hub/jobs/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'assistant' }) });
    expect(response.status).toBe(200);
    expect((await response.json()).added).toBe(1);
    const listing = await (await fetch(base + '/api/hub/jobs')).json();
    expect(listing[0]).toMatchObject({ source: 'Remotive', originalUrl: 'https://remotive.com/remote-jobs/operations/assistant-51' });
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('saves a periodic search configuration through the local API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  const agents = new HubStore(join(dir, 'state.json')); const jobs = new JobStore(join(dir, 'jobs.json'));
  const server = http.createServer((req, res) => { handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), agents, jobs); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(base + '/api/hub/jobs/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'suporte', intervalHours: 12, enabled: true }) });
    expect(response.status).toBe(200);
    expect((await (await fetch(base + '/api/hub/jobs/schedule')).json())).toMatchObject({ query: 'suporte', intervalHours: 12, enabled: true });
    expect(new JobStore(join(dir, 'jobs.json')).schedule()?.query).toBe('suporte');
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('controls a persistent browser through local routes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  let current = 'about:blank';
  const page = { url: () => current, goto: async (url: string) => { current = url; }, screenshot: async () => Buffer.from('png'), locator: () => ({ fill: async () => {} }), isClosed: () => false, close: async () => {} };
  const browser = new BrowserManager({ profileDir: join(dir, 'profile'), logFile: join(dir, 'navigation.jsonl'), launch: async () => ({ pages: () => [], newPage: async () => page, close: async () => {} }) });
  const agents = new HubStore(join(dir, 'state.json'));
  const server = http.createServer((req, res) => { handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), agents, undefined, fetch, browser); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/api/hub/browser/start', { headless: false })).status).toBe(200);
    const opened = await post('/api/hub/browser/pages', { url: 'https://example.com' });
    expect(opened.status).toBe(201);
    const tab = await opened.json();
    expect((await (await fetch(base + '/api/hub/browser')).json()).pages[0].id).toBe(tab.id);
    expect((await (await fetch(base + `/api/hub/browser/pages/${tab.id}/screenshot`)).arrayBuffer()).byteLength).toBe(3);
    await post('/api/hub/browser/manual', { manual: true });
    expect((await post(`/api/hub/browser/pages/${tab.id}/navigate`, { url: 'https://example.com/next' })).status).toBe(409);
  } finally { await browser.stop(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
