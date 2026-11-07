import http from 'node:http';
import { Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HubStore } from './store';
import { handleHubRoute } from './http';
import { JobStore, searchRemotive } from './jobs';
import { BrowserManager } from './browser';
import { ApplicationStore } from './applications';
import { ProfileStore } from './profile';
import { ModelRouter } from './router';
import { WhatsAppStore } from './whatsapp';
import { BackupManager } from './backup';
import { WindowsStartupManager } from './windows-startup';
import { EvolutionSettings } from './evolution-settings';
import { WebhookListener } from './webhook-listener';
import { ProviderCredentials } from './provider-credentials';
import { TaskRuntime } from './task-runtime';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

it('configures the concurrent task limit through the local HUD API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-execution-')); dirs.push(dir);
  const runtime = new TaskRuntime(join(dir, 'execution.json'), async () => {});
  const store = new HubStore(join(dir, 'state.json'));
  const server = http.createServer((req, res) => {
    const args: Parameters<typeof handleHubRoute> = [req, res, new URL(req.url!, 'http://localhost'), store];
    args[20] = runtime;
    handleHubRoute(...args);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const url = `http://127.0.0.1:${address.port}/api/hub/execution`;
    expect((await (await fetch(url)).json()).maxConcurrent).toBe(1);
    const changed = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"maxConcurrent":3}' });
    expect(changed.status).toBe(200); expect((await changed.json()).maxConcurrent).toBe(3);
    const rejected = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"maxConcurrent":9}' });
    expect(rejected.status).toBe(400);
    expect(new TaskRuntime(join(dir, 'execution.json'), async () => {}).status().maxConcurrent).toBe(3);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('assigns a configured model to an agent and rejects unknown model IDs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-agent-model-')); dirs.push(dir);
  const store = new HubStore(join(dir, 'state.json'));
  const router = new ModelRouter(join(dir, 'router.json'));
  const model = router.add({ provider: 'ollama', model: 'qwen2.5:1.5b', priority: 10 });
  const server = http.createServer((req, res) => handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), store,
    undefined, fetch, undefined, router));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}/api/hub/agents`;
    const create = (body: unknown) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const created = await create({ name: 'Agente local', objective: 'Analisar vagas', modelId: model.id });
    expect(created.status).toBe(201);
    const agent = await created.json(); expect(agent.modelId).toBe(model.id);
    const rejected = await create({ name: 'Inválido', objective: 'Analisar vagas', modelId: '00000000-0000-4000-8000-000000000000' });
    expect(rejected.status).toBe(400);
    const cleared = await fetch(`${base}/${agent.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"modelId":null}' });
    expect(cleared.status).toBe(200); expect((await cleared.json()).modelId).toBeUndefined();
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('creates and changes priority through the local task API before dispatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-priority-')); dirs.push(dir);
  const store = new HubStore(join(dir, 'state.json'));
  const agent = store.createAgent({ name: 'Pesquisa', objective: 'Vagas' });
  const server = http.createServer((req, res) => handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), store));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}/api/hub/tasks`;
    const created = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: agent.id, instruction: 'Pesquisar', priority: 5 }) });
    expect(created.status).toBe(201);
    const task = await created.json(); expect(task.priority).toBe(5);
    const changed = await fetch(`${base}/${task.id}/priority`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"priority":2}' });
    expect(changed.status).toBe(200); expect((await changed.json()).priority).toBe(2);
    const rejected = await fetch(`${base}/${task.id}/priority`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"priority":8}' });
    expect(rejected.status).toBe(400);
    expect(new HubStore(join(dir, 'state.json')).listTasks().find((item) => item.id === task.id)?.priority).toBe(2);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('creates and schedules a verified backup through the local panel API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  const store = new HubStore(join(dir, 'state.json'));
  const backups = new BackupManager(dir);
  const server = http.createServer((req, res) => {
    handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), store,
      undefined, fetch, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, backups);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}`;
    const created = await fetch(base + '/api/hub/backups', { method: 'POST' });
    expect(created.status).toBe(201);
    const backup = await created.json();
    expect(backup.id).toBeTruthy(); expect(backup.file).toBeUndefined();
    const listed = await (await fetch(base + '/api/hub/backups')).json();
    expect(listed.backups).toHaveLength(1);
    const restore = await fetch(base + '/api/hub/backups/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: backup.id }) });
    expect(restore.status).toBe(202);
    expect((await restore.json()).pendingRestore).toBe(backup.id);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('toggles the owned Windows startup shortcut through the local panel API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  let installed = false;
  const startup = new WindowsStartupManager(async (action) => {
    if (action === 'Install') installed = true;
    if (action === 'Remove') installed = false;
    return JSON.stringify({ installed, owned: installed, shortcut: 'C:/Startup/ProjetoHUB.lnk' });
  }, 'win32');
  const server = http.createServer((req, res) => {
    handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), new HubStore(join(dir, 'state.json')),
      undefined, fetch, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, startup);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}/api/hub/windows/startup`;
    expect((await (await fetch(base)).json()).enabled).toBe(false);
    const enabled = await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"enabled":true}' });
    expect((await enabled.json()).enabled).toBe(true);
    expect((await (await fetch(base)).json()).enabled).toBe(true);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('configures Evolution through the local API without returning its key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  const settings = new EvolutionSettings(join(dir, 'evolution-settings.json'), {}, 'win32', {
    protect: async (value) => `encrypted:${value}`, unprotect: async (value) => value.slice(10),
  });
  const urls: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(JSON.stringify(urls.length === 1 ? { version: '2.3.7' } : []), { status: 200 });
  }) as typeof fetch;
  const hub = new HubStore(join(dir, 'state.json'));
  const whatsapp = new WhatsAppStore(join(dir, 'whatsapp.json'));
  const server = http.createServer((req, res) => {
    handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), hub,
      undefined, fetcher, undefined, undefined, undefined, undefined, whatsapp,
      undefined, undefined, undefined, undefined, undefined, undefined, settings);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}/api/hub/whatsapp`;
    const changed = await fetch(base + '/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'https://evolution.example.test/api', apiKey: 'dummy-secret' }) });
    expect(changed.status).toBe(200);
    expect(JSON.stringify(await changed.json())).not.toContain('dummy-secret');
    expect((await (await fetch(base)).json()).apiKeyConfigured).toBe(true);
    await fetch(base + '/diagnostics');
    expect(urls).toEqual(['https://evolution.example.test/api/', 'https://evolution.example.test/api/instance/fetchInstances']);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('saves a provider credential through the local API without returning the key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  const credentials = new ProviderCredentials(join(dir, 'provider-credentials.json'), {}, 'win32', {
    protect: async (value) => `encrypted:${value.split('').reverse().join('')}`,
    unprotect: async (value) => value.slice(10).split('').reverse().join(''),
  });
  const hub = new HubStore(join(dir, 'state.json'));
  const server = http.createServer((req, res) => handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), hub,
    undefined, fetch, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, credentials));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}/api/hub/router/credentials`;
    const saved = await fetch(`${base}/openai`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"key":"sk-private-test-key"}' });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ configured: true, source: 'windows' });
    const listed = await (await fetch(base)).text();
    expect(listed).not.toContain('sk-private-test-key');
    expect(JSON.parse(listed).openai).toEqual({ configured: true, source: 'windows' });
    expect((await fetch(`${base}/openai`, { method: 'DELETE' })).status).toBe(200);
    expect(credentials.status().openai.configured).toBe(false);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('requires configured numbers and preserves an existing Evolution instance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  const hub = new HubStore(join(dir, 'state.json'));
  const whatsapp = new WhatsAppStore(join(dir, 'whatsapp.json'));
  const evolution = new EvolutionSettings(join(dir, 'evolution-settings.json'), { EVOLUTION_API_KEY: 'test-key' });
  const calls: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify([{ name: 'procura-de-emprego', connectionStatus: 'open' }]), { status: 200 });
  }) as typeof fetch;
  const server = http.createServer((req, res) => {
    handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), hub,
      undefined, fetcher, undefined, undefined, undefined, undefined, whatsapp,
      undefined, undefined, undefined, undefined, undefined, undefined, evolution);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const url = `http://127.0.0.1:${address.port}/api/hub/whatsapp/instance`;
    const post = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect((await post()).status).toBe(409);
    expect(calls).toHaveLength(0);
    whatsapp.configure({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' });
    expect(await (await post()).json()).toMatchObject({ instance: 'procura-de-emprego', created: false, status: 'open' });
    expect(calls).toEqual(['http://127.0.0.1:8080/instance/fetchInstances']);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('configures the dedicated Evolution webhook only after listener and numbers are ready', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  const whatsapp = new WhatsAppStore(join(dir, 'whatsapp.json'));
  const evolution = new EvolutionSettings(join(dir, 'evolution-settings.json'), { EVOLUTION_API_KEY: 'test-key' });
  const requests: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    requests.push(String(url));
    return new Response('{}', { status: 201 });
  }) as typeof fetch;
  const hub = new HubStore(join(dir, 'state.json'));
  const listener = new WebhookListener(join(dir, 'listener.json'), whatsapp, hub, {});
  const server = http.createServer((req, res) => handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), hub,
    undefined, fetcher, undefined, undefined, undefined, undefined, whatsapp,
    undefined, undefined, undefined, undefined, undefined, undefined, evolution, listener));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const url = `http://127.0.0.1:${address.port}/api/hub/whatsapp/webhook`;
    const listenerPort = address.port + 1;
    const body = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: `http://host.docker.internal:${listenerPort}/webhook/evolution` }) };
    expect((await fetch(url, body)).status).toBe(409);
    whatsapp.configure({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' });
    expect((await fetch(url, body)).status).toBe(409);
    const enabled = await fetch(`http://127.0.0.1:${address.port}/api/hub/whatsapp/listener`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, port: listenerPort, exposeLan: false }) });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({ enabled: true, running: true, port: listenerPort });
    const configured = await fetch(url, body);
    expect(configured.status).toBe(200);
    expect(await configured.json()).toEqual({ instance: 'procura-de-emprego', configured: true });
    expect(requests).toEqual(['http://127.0.0.1:8080/event/webhook/set/procura-de-emprego']);
  } finally {
    await listener.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

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
    store.setTaskStatus(store.listTasks()[0].id, 'failed', 'Ollama offline');
    expect((await post(`/api/hub/tasks/${store.listTasks()[0].id}/retry`, {})).status).toBe(200);
    expect(store.listTasks()[0].status).toBe('unassigned');
    expect((await post('/api/hub/tasks', { agentId: 'missing', instruction: 'Buscar' })).status).toBe(400);
    const updated = await fetch(base + `/api/hub/agents/${agent.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objective: 'Avaliar vagas' }) });
    expect((await updated.json()).objective).toBe('Avaliar vagas');
    expect((await post(`/api/hub/agents/${agent.id}/status`, { status: 'paused' })).status).toBe(200);
    expect((await post(`/api/hub/agents/${agent.id}/status`, { status: 'active' })).status).toBe(200);
    expect((await post(`/api/hub/agents/${agent.id}/status`, { status: 'ended' })).status).toBe(200);
    expect((await (await fetch(base + '/api/hub/tasks')).json())[0].status).toBe('cancelled');
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

it('prepares one application from a sourced vacancy and requires explicit approval', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  const agents = new HubStore(join(dir, 'state.json'));
  const jobs = new JobStore(join(dir, 'jobs.json'));
  const applications = new ApplicationStore(join(dir, 'applications.json'));
  await searchRemotive(jobs, 'assistant', async () => new Response(JSON.stringify({ jobs: [{ id: 72, url: 'https://remotive.com/remote-jobs/support/assistant-72', title: 'Assistant', company_name: 'Acme', description: 'Support' }] }), { status: 200 }));
  const server = http.createServer((req, res) => { handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), agents, jobs, fetch, undefined, undefined, applications); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}`;
    const request = (path: string, method: string, body: unknown = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const jobId = jobs.list()[0].id;
    expect((await request('/api/hub/applications', 'POST', { jobId: 'missing' })).status).toBe(404);
    const created = await request('/api/hub/applications', 'POST', { jobId });
    expect(created.status).toBe(201); const app = await created.json();
    expect((await request('/api/hub/applications', 'POST', { jobId })).status).toBe(400);
    expect((await request(`/api/hub/applications/${app.id}/request-approval`, 'POST')).status).toBe(400);
    expect((await request(`/api/hub/applications/${app.id}/answers`, 'PUT', { answers: { Experiência: 'Sem experiência formal' } })).status).toBe(200);
    expect((await request(`/api/hub/applications/${app.id}/request-approval`, 'POST')).status).toBe(200);
    expect((await request(`/api/hub/applications/${app.id}/approve`, 'POST')).status).toBe(200);
    expect((await (await fetch(base + '/api/hub/applications')).json())[0].status).toBe('approved');
    expect((await (await fetch(base + '/api/hub/jobs')).json())[0].applicationStatus).toBe('approved');
    expect(new ApplicationStore(join(dir, 'applications.json')).list()[0].status).toBe('approved');
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('analyzes a sourced vacancy and hides a stale score after profile changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  const agents = new HubStore(join(dir, 'state.json')); const jobs = new JobStore(join(dir, 'jobs.json'));
  const profile = new ProfileStore(join(dir, 'profile.json'));
  const router = new ModelRouter(join(dir, 'router.json'), async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"requirements":["Conhecimento em Excel."]}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }));
  router.add({ provider: 'ollama', model: 'local-test', priority: 1 });
  await searchRemotive(jobs, 'assistant', async () => new Response(JSON.stringify({ jobs: [{ id: 73, url: 'https://remotive.com/remote-jobs/support/assistant-73', title: 'Assistant', company_name: 'Acme', description: 'Conhecimento em Excel.' }] }), { status: 200 }));
  const server = http.createServer((req, res) => { handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), agents, jobs, fetch, undefined, router, undefined, profile); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}`;
    const request = (path: string, method: string, body: unknown = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await request('/api/hub/profile', 'PUT', { skills: ['Excel'], experience: [], education: [] })).status).toBe(200);
    expect((await request('/api/hub/profile/confirm', 'POST')).status).toBe(200);
    const jobId = jobs.list()[0].id;
    expect((await request(`/api/hub/jobs/${jobId}/analyze`, 'POST')).status).toBe(200);
    expect((await (await fetch(base + '/api/hub/jobs')).json())[0].compatibility).toBe(100);
    await request('/api/hub/profile', 'PUT', { skills: ['Power BI'], experience: [], education: [] });
    const stale = (await (await fetch(base + '/api/hub/jobs')).json())[0];
    expect(stale.compatibility).toBeNull();
    expect(stale.justification).toContain('desatualizada');
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

it('configures logical WhatsApp numbers and shows a webhook token only once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-http-')); dirs.push(dir);
  const agents = new HubStore(join(dir, 'state.json'));
  const whatsapp = new WhatsAppStore(join(dir, 'whatsapp.json'));
  const server = http.createServer((req, res) => { handleHubRoute(req, res, new URL(req.url!, 'http://localhost'), agents, undefined, fetch, undefined, undefined, undefined, undefined, whatsapp); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}`;
    const put = await fetch(base + '/api/hub/whatsapp', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' }) });
    expect(put.status).toBe(200);
    const tokenResponse = await fetch(base + '/api/hub/whatsapp/webhook-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const { token } = await tokenResponse.json();
    expect(whatsapp.authenticateWebhook(token)).toBe(true);
    const status = await (await fetch(base + '/api/hub/whatsapp')).json();
    expect(status).toMatchObject({ instance: 'procura-de-emprego', mainNumber: '5511999999999', webhookTokenConfigured: true });
    expect(JSON.stringify(status)).not.toContain(token);
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
