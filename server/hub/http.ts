import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from '../http/app';
import type { HubStore } from './store';
import { searchRemotive, type JobStore } from './jobs';
import type { BrowserManager } from './browser';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Corpo JSON inválido');
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} deve ser texto`);
  return value;
}
function fail(res: ServerResponse, error: unknown): void {
  if (!res.headersSent) sendJson(res, 400, { error: error instanceof Error ? error.message : 'Requisição inválida' });
}

/** Routes are mounted only on the local server, after the normal Host/Origin guard. */
export function handleHubRoute(req: IncomingMessage, res: ServerResponse, url: URL, store: HubStore, jobs?: JobStore, fetcher: typeof fetch = fetch, browser?: BrowserManager): boolean {
  const path = url.pathname;
  if (!path.startsWith('/api/hub/')) return false;
  const remote = req.socket.remoteAddress?.replace(/^::ffff:/i, '');
  if (remote !== '::1' && !/^127\./.test(remote ?? '')) {
    sendJson(res, 403, { error: 'Acesso permitido apenas neste computador' });
    return true;
  }
  if (path === '/api/hub/browser') {
    if (req.method !== 'GET') sendJson(res, 405, { error: 'Método não permitido' });
    else sendJson(res, 200, browser?.status() ?? { running: false, headless: false, manual: false, pages: [] });
    return true;
  }
  if (path.startsWith('/api/hub/browser/')) {
    if (!browser) { sendJson(res, 503, { error: 'Navegador indisponível' }); return true; }
    const action = path.slice('/api/hub/browser/'.length);
    const respond = (work: Promise<unknown>, status = 200) => { void work.then((result) => sendJson(res, status, result ?? { ok: true })).catch((error) => {
      if (res.headersSent) return;
      const message = error instanceof Error ? error.message : 'Falha no navegador';
      sendJson(res, message.includes('manual') ? 409 : message.includes('não encontrada') ? 404 : 400, { error: message });
    }); };
    if (action === 'start' && req.method === 'POST') respond(readJson(req).then((raw) => {
      const body = record(raw);
      if (typeof body.headless !== 'boolean') throw new Error('headless deve ser booleano');
      return browser.start({ headless: body.headless });
    }));
    else if (action === 'stop' && req.method === 'POST') { req.resume(); respond(browser.stop()); }
    else if (action === 'manual' && req.method === 'POST') respond(readJson(req).then((raw) => {
      const body = record(raw);
      if (typeof body.manual !== 'boolean') throw new Error('manual deve ser booleano');
      browser.setManual(body.manual);
      return browser.status();
    }));
    else if (action === 'pages' && req.method === 'POST') respond(readJson(req).then((raw) => browser.open(string(record(raw).url, 'URL'))), 201);
    else {
      const pageAction = /^pages\/([0-9a-f-]+)\/(navigate|fill|screenshot)$/.exec(action);
      if (!pageAction) sendJson(res, 404, { error: 'Rota desconhecida' });
      else if (pageAction[2] === 'screenshot' && req.method === 'GET') {
        void browser.screenshot(pageAction[1]).then((png) => {
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'no-store' }); res.end(png);
        }).catch((error) => fail(res, error));
      } else if (req.method === 'POST' && pageAction[2] === 'navigate') respond(readJson(req).then((raw) => browser.navigate(pageAction[1], string(record(raw).url, 'URL'))));
      else if (req.method === 'POST' && pageAction[2] === 'fill') respond(readJson(req).then((raw) => {
        const body = record(raw);
        return browser.fill(pageAction[1], string(body.selector, 'seletor'), string(body.value, 'valor'));
      }));
      else sendJson(res, 405, { error: 'Método não permitido' });
    }
    return true;
  }
  if (path === '/api/hub/jobs') {
    if (req.method !== 'GET') sendJson(res, 405, { error: 'Método não permitido' });
    else sendJson(res, 200, jobs?.list() ?? []);
    return true;
  }
  if (path === '/api/hub/jobs/schedule') {
    if (!jobs) sendJson(res, 503, { error: 'Agenda de vagas indisponível' });
    else if (req.method === 'GET') sendJson(res, 200, jobs.schedule() ?? { enabled: false });
    else if (req.method === 'PUT') void readJson(req).then((raw) => {
      const body = record(raw);
      sendJson(res, 200, jobs.configure({ query: string(body.query, 'pesquisa'), intervalHours: Number(body.intervalHours), enabled: body.enabled as boolean }));
    }).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/jobs/search') {
    if (req.method !== 'POST') sendJson(res, 405, { error: 'Método não permitido' });
    else if (!jobs) sendJson(res, 503, { error: 'Pesquisa de vagas indisponível' });
    else void readJson(req).then((raw) => {
      const body = record(raw);
      return searchRemotive(jobs, string(body.query, 'pesquisa'), fetcher);
    }).then((result) => sendJson(res, 200, result)).catch((error) => {
      if (res.headersSent) return;
      const message = error instanceof Error ? error.message : 'Falha de pesquisa';
      sendJson(res, message.startsWith('Limite diário') ? 429 : message.startsWith('Remotive respondeu') ? 502 : 400, { error: message });
    });
    return true;
  }
  if (path === '/api/hub/agents') {
    if (req.method === 'GET') sendJson(res, 200, store.listAgents());
    else if (req.method === 'POST') void readJson(req).then((raw) => {
      const body = record(raw);
      const agent = store.createAgent({ name: string(body.name, 'nome'), objective: string(body.objective, 'objetivo'),
        ...(body.parentId === undefined ? {} : { parentId: string(body.parentId, 'agente principal') }),
        ...(body.codexThread === undefined ? {} : { codexThread: string(body.codexThread, 'sessão Codex') }),
        ...(body.codexHome === undefined ? {} : { codexHome: string(body.codexHome, 'pasta Codex') }) });
      sendJson(res, 201, agent);
    }).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/tasks') {
    if (req.method === 'GET') sendJson(res, 200, store.listTasks());
    else if (req.method === 'POST') void readJson(req).then((raw) => {
      const body = record(raw);
      sendJson(res, 201, store.createTask({ agentId: string(body.agentId, 'agente'), instruction: string(body.instruction, 'instrução') }));
    }).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  const action = /^\/api\/hub\/tasks\/([0-9a-f-]+)\/(pause|resume)$/.exec(path);
  if (action) {
    if (req.method !== 'POST') sendJson(res, 405, { error: 'Método não permitido' });
    else {
      req.resume();
      try {
        const task = store.listTasks().find((t) => t.id === action[1]);
        if (!task) sendJson(res, 404, { error: 'Tarefa não encontrada' });
        else if (action[2] === 'pause' && ['queued', 'unassigned'].includes(task.status)) sendJson(res, 200, store.setTaskStatus(task.id, 'paused'));
        else if (action[2] === 'resume' && task.status === 'paused') sendJson(res, 200, store.setTaskStatus(task.id, store.agent(task.agentId)?.codexThread ? 'queued' : 'unassigned'));
        else sendJson(res, 409, { error: 'Ação incompatível com o estado da tarefa' });
      } catch (error) { fail(res, error); }
    }
    return true;
  }
  sendJson(res, 404, { error: 'Rota desconhecida' });
  return true;
}
