import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from '../http/app';
import type { HubStore } from './store';
import { searchRemotive, type JobStore } from './jobs';
import type { BrowserManager } from './browser';
import type { ModelRouter, Provider, Message } from './router';
import type { ApplicationStore } from './applications';
import type { ProfileStore } from './profile';
import { analyzeJob } from './analysis';
import type { WhatsAppStore } from './whatsapp';

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
export function handleHubRoute(req: IncomingMessage, res: ServerResponse, url: URL, store: HubStore, jobs?: JobStore, fetcher: typeof fetch = fetch, browser?: BrowserManager, router?: ModelRouter, applications?: ApplicationStore, profile?: ProfileStore, whatsapp?: WhatsAppStore): boolean {
  const path = url.pathname;
  if (!path.startsWith('/api/hub/')) return false;
  const remote = req.socket.remoteAddress?.replace(/^::ffff:/i, '');
  if (remote !== '::1' && !/^127\./.test(remote ?? '')) {
    sendJson(res, 403, { error: 'Acesso permitido apenas neste computador' });
    return true;
  }
  if (path === '/api/hub/whatsapp') {
    if (!whatsapp) sendJson(res, 503, { error: 'WhatsApp indisponível' });
    else if (req.method === 'GET') sendJson(res, 200, { ...whatsapp.status(), apiKeyConfigured: Boolean(process.env.EVOLUTION_API_KEY), webhookPort: process.env.PROJECTHUB_WHATSAPP_WEBHOOK_PORT || null });
    else if (req.method === 'PUT') void readJson(req).then((raw) => {
      const body = record(raw);
      sendJson(res, 200, whatsapp.configure({ mainNumber: string(body.mainNumber, 'número principal'), secondaryNumber: string(body.secondaryNumber, 'número secundário') }));
    }).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/whatsapp/webhook-token') {
    if (!whatsapp) sendJson(res, 503, { error: 'WhatsApp indisponível' });
    else if (req.method === 'POST') { req.resume(); sendJson(res, 200, { token: whatsapp.rotateWebhookToken() }); }
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/whatsapp/diagnostics') {
    if (!whatsapp) sendJson(res, 503, { error: 'WhatsApp indisponível' });
    else if (req.method === 'GET') void whatsapp.diagnose(process.env.EVOLUTION_API_KEY ?? '', fetcher).then((result) => sendJson(res, 200, result)).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  const sendQuestionAction = /^\/api\/hub\/whatsapp\/questions\/([0-9a-f-]+)\/send$/.exec(path);
  if (sendQuestionAction) {
    if (!whatsapp) sendJson(res, 503, { error: 'WhatsApp indisponível' });
    else if (req.method === 'POST') { req.resume(); void whatsapp.sendQuestion(sendQuestionAction[1], store, process.env.EVOLUTION_API_KEY ?? '', fetcher).then((result) => sendJson(res, result.state === 'accepted' ? 200 : 502, result)).catch((error) => fail(res, error)); }
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/router') {
    if (req.method !== 'GET') sendJson(res, 405, { error: 'Método não permitido' });
    else sendJson(res, 200, router?.status() ?? { models: [], usage: { inputTokens: 0, outputTokens: 0, requests: 0 } });
    return true;
  }
  if (path.startsWith('/api/hub/router/')) {
    if (!router) { sendJson(res, 503, { error: 'Roteador indisponível' }); return true; }
    const action = path.slice('/api/hub/router/'.length);
    if (action === 'models' && req.method === 'POST') void readJson(req).then((raw) => {
      const body = record(raw);
      sendJson(res, 201, router.add({ provider: string(body.provider, 'provedor') as Provider, model: string(body.model, 'modelo'), priority: Number(body.priority) }));
    }).catch((error) => fail(res, error));
    else if (action.startsWith('models/') && req.method === 'DELETE') sendJson(res, router.remove(action.slice(7)) ? 200 : 404, { ok: true });
    else if (action.startsWith('models/') && req.method === 'PATCH') void readJson(req).then((raw) => {
      const body = record(raw);
      sendJson(res, 200, router.update(action.slice(7), { ...(body.priority !== undefined ? { priority: Number(body.priority) } : {}), ...(body.enabled !== undefined ? { enabled: body.enabled as boolean } : {}) }));
    }).catch((error) => fail(res, error));
    else if (action === 'complete' && req.method === 'POST') void readJson(req).then((raw) => {
      const body = record(raw);
      return router.complete(body.messages as Message[]);
    }).then((result) => sendJson(res, 200, result)).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/questions') {
    if (req.method === 'GET') sendJson(res, 200, store.listQuestions());
    else if (req.method === 'POST') void readJson(req).then((raw) => {
      const body = record(raw);
      if (body.applicationId !== undefined && !applications?.get(string(body.applicationId, 'candidatura'))) throw new Error('Candidatura não encontrada');
      sendJson(res, 201, store.askQuestion({ taskId: string(body.taskId, 'tarefa'), text: string(body.text, 'pergunta'),
        ...(body.applicationId === undefined ? {} : { applicationId: string(body.applicationId, 'candidatura') }),
        ...(body.deadline === undefined ? {} : { deadline: string(body.deadline, 'prazo') }) }));
    }).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/profile') {
    if (!profile) sendJson(res, 503, { error: 'Perfil indisponível' });
    else if (req.method === 'GET') sendJson(res, 200, profile.get());
    else if (req.method === 'PUT') void readJson(req).then((raw) => {
      const body = record(raw);
      sendJson(res, 200, profile.update({ skills: body.skills as string[], experience: body.experience as string[], education: body.education as string[] }));
    }).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/profile/confirm') {
    if (!profile) sendJson(res, 503, { error: 'Perfil indisponível' });
    else if (req.method === 'POST') { req.resume(); try { sendJson(res, 200, profile.confirm()); } catch (error) { fail(res, error); } }
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  const questionAction = /^\/api\/hub\/questions\/([0-9a-f-]+)\/answer$/.exec(path);
  if (questionAction) {
    if (req.method !== 'POST') sendJson(res, 405, { error: 'Método não permitido' });
    else void readJson(req).then((raw) => sendJson(res, 200, store.answerQuestion(questionAction[1], string(record(raw).answer, 'resposta')))).catch((error) => fail(res, error));
    return true;
  }
  if (path === '/api/hub/applications') {
    if (!applications || !jobs) sendJson(res, 503, { error: 'Candidaturas indisponíveis' });
    else if (req.method === 'GET') sendJson(res, 200, applications.list());
    else if (req.method === 'POST') void readJson(req).then((raw) => {
      const jobId = string(record(raw).jobId, 'vaga');
      const job = jobs.list().find((v) => v.id === jobId);
      if (!job) { sendJson(res, 404, { error: 'Vaga não encontrada' }); return; }
      sendJson(res, 201, applications.create({ jobId: job.id, source: job.source, sourceId: job.sourceId, originalUrl: job.originalUrl, title: job.title, company: job.company }));
    }).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  const applicationAction = /^\/api\/hub\/applications\/([0-9a-f-]+)\/(answers|request-approval|approve|deny)$/.exec(path);
  if (applicationAction) {
    if (!applications) sendJson(res, 503, { error: 'Candidaturas indisponíveis' });
    else if (applicationAction[2] === 'answers' && req.method === 'PUT') void readJson(req).then((raw) => {
      sendJson(res, 200, applications.setAnswers(applicationAction[1], record(record(raw).answers) as Record<string, string>));
    }).catch((error) => fail(res, error));
    else if (req.method === 'POST' && applicationAction[2] !== 'answers') {
      req.resume();
      try {
        const app = applicationAction[2] === 'request-approval' ? applications.requestApproval(applicationAction[1])
          : applicationAction[2] === 'approve' ? applications.approve(applicationAction[1]) : applications.deny(applicationAction[1]);
        sendJson(res, 200, app);
      } catch (error) { fail(res, error); }
    } else sendJson(res, 405, { error: 'Método não permitido' });
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
    else {
      const byJob = new Map(applications?.list().map((app) => [app.jobId, app.status]) ?? []);
      const revision = profile?.get();
      sendJson(res, 200, jobs?.list().map((job) => ({ ...job, compatibility: job.profileRevision && revision?.confirmedAt && job.profileRevision === revision.revision ? job.compatibility : null,
        justification: job.profileRevision && (!revision?.confirmedAt || job.profileRevision !== revision.revision) ? 'Perfil alterado: a compatibilidade anterior está desatualizada. Reanalise a vaga.' : job.justification,
        applicationStatus: byJob.get(job.id) ?? job.applicationStatus })) ?? []);
    }
    return true;
  }
  const jobAction = /^\/api\/hub\/jobs\/([0-9a-f-]+)\/analyze$/.exec(path);
  if (jobAction) {
    if (!jobs || !profile || !router) sendJson(res, 503, { error: 'Análise de vagas indisponível' });
    else if (req.method === 'POST') { req.resume(); void analyzeJob(jobs, profile, router, jobAction[1]).then((result) => sendJson(res, 200, result)).catch((error) => fail(res, error)); }
    else sendJson(res, 405, { error: 'Método não permitido' });
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
  const agentAction = /^\/api\/hub\/agents\/([0-9a-f-]+)(?:\/(status))?$/.exec(path);
  if (agentAction) {
    if (agentAction[2] === 'status' && req.method === 'POST') void readJson(req).then((raw) => {
      const status = string(record(raw).status, 'estado');
      if (status !== 'active' && status !== 'paused' && status !== 'ended') throw new Error('Estado de agente inválido');
      sendJson(res, 200, store.setAgentStatus(agentAction[1], status));
    }).catch((error) => fail(res, error));
    else if (!agentAction[2] && req.method === 'PATCH') void readJson(req).then((raw) => {
      const body = record(raw);
      sendJson(res, 200, store.updateAgent(agentAction[1], { ...(body.name !== undefined ? { name: string(body.name, 'nome') } : {}),
        ...(body.objective !== undefined ? { objective: string(body.objective, 'objetivo') } : {}) }));
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
