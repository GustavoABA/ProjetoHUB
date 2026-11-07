import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from '../http/app';
import type { HubStore } from './store';
import { searchRemotive, type JobStore } from './jobs';
import type { BrowserManager } from './browser';
import type { ModelRouter, Provider, Message } from './router';
import type { ApplicationStore } from './applications';
import type { ProfileStore } from './profile';
import { analyzeJob } from './analysis';
import { reconcileApplicationAnswers } from './application-answers';
import type { WhatsAppStore } from './whatsapp';
import type { AdminKeyStore } from './mcp';
import type { NgrokManager } from './ngrok';
import type { ConnectionSession, SessionPolicy } from './connection-session';
import type { ConnectionPublisher } from './connection-publisher';
import type { BackupManager } from './backup';
import type { WindowsStartupManager } from './windows-startup';
import type { EvolutionSettings } from './evolution-settings';
import type { WebhookListener } from './webhook-listener';
import type { ProviderCredentials } from './provider-credentials';
import type { TaskRuntime } from './task-runtime';
import { configureJobWebhook, connectJobInstance, ensureJobInstance } from './evolution-instance';
import { registerGreenhouseBoard, searchGreenhouseBoards, type GreenhouseBoardStore } from './greenhouse';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Corpo JSON inválido');
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} deve ser texto`);
  return value;
}
function optionalPolicyNumber(value: unknown, label: string): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} deve ser número`);
  return value;
}
function fallbackIds(value: unknown, router?: ModelRouter): string[] {
  if (!Array.isArray(value) || value.length > 3 || value.some((item) => typeof item !== 'string')) throw new Error('Modelos de reserva inválidos');
  const known = new Set(router?.status().models.map((model) => model.id) ?? []);
  if (value.some((id) => !known.has(id))) throw new Error('Modelo de reserva não encontrado');
  return value as string[];
}
function fail(res: ServerResponse, error: unknown): void {
  if (!res.headersSent) sendJson(res, 400, { error: error instanceof Error ? error.message : 'Requisição inválida' });
}

/** Routes are mounted only on the local server, after the normal Host/Origin guard. */
export function handleHubRoute(req: IncomingMessage, res: ServerResponse, url: URL, store: HubStore, jobs?: JobStore, fetcher: typeof fetch = fetch, browser?: BrowserManager, router?: ModelRouter, applications?: ApplicationStore, profile?: ProfileStore, whatsapp?: WhatsAppStore, mcpKeys?: AdminKeyStore, ngrok?: NgrokManager, session?: ConnectionSession, publisher?: ConnectionPublisher, backups?: BackupManager, windowsStartup?: WindowsStartupManager, evolution?: EvolutionSettings, webhookListener?: WebhookListener, providerCredentials?: ProviderCredentials, taskRuntime?: TaskRuntime, greenhouseBoards?: GreenhouseBoardStore): boolean {
  const path = url.pathname;
  if (!path.startsWith('/api/hub/')) return false;
  const remote = req.socket.remoteAddress?.replace(/^::ffff:/i, '');
  if (remote !== '::1' && !/^127\./.test(remote ?? '')) {
    sendJson(res, 403, { error: 'Acesso permitido apenas neste computador' });
    return true;
  }
  if (path === '/api/hub/execution') {
    if (!taskRuntime) sendJson(res, 503, { error: 'Gerenciador de execução indisponível' });
    else if (req.method === 'GET') sendJson(res, 200, taskRuntime.status());
    else if (req.method === 'PUT') void readJson(req).then((raw) => sendJson(res, 200,
      taskRuntime.configure(record(raw).maxConcurrent as number))).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/windows/startup') {
    if (!windowsStartup) sendJson(res, 503, { error: 'Inicialização automática indisponível' });
    else if (req.method === 'GET') void windowsStartup.status().then((result) => sendJson(res, 200, result)).catch((error) => fail(res, error));
    else if (req.method === 'PUT') void readJson(req).then((raw) => windowsStartup.setEnabled(record(raw).enabled as boolean))
      .then((result) => sendJson(res, 200, result)).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/backups') {
    if (!backups) sendJson(res, 503, { error: 'Backups indisponíveis' });
    else if (req.method === 'GET') {
      const status = backups.status();
      sendJson(res, 200, { ...status, backups: status.backups.map(({ file: _file, ...info }) => info) });
    } else if (req.method === 'POST') {
      try { const { file: _file, ...info } = backups.create(); sendJson(res, 201, info); } catch (error) { fail(res, error); }
    } else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/backups/restore') {
    if (!backups) sendJson(res, 503, { error: 'Backups indisponíveis' });
    else if (req.method !== 'POST') sendJson(res, 405, { error: 'Método não permitido' });
    else void readJson(req).then((body) => {
      backups.stageRestore(string(record(body).id, 'backup'));
      sendJson(res, 202, { pendingRestore: backups.status().pendingRestore });
    }).catch((error) => fail(res, error));
    return true;
  }
  if (path === '/api/hub/mcp') {
    if (req.method === 'GET') sendJson(res, 200, { configured: mcpKeys?.configured() ?? false, port: Number(process.env.PROJECTHUB_MCP_PORT ?? 4748), ngrok: ngrok?.status() ?? { installed: false, running: false }, github: publisher?.status() ?? { configured: false } });
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/mcp/key') {
    if (!mcpKeys) sendJson(res, 503, { error: 'MCP indisponível' });
    else if (req.method === 'POST') { req.resume(); sendJson(res, 200, { key: mcpKeys.rotate() }); }
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/mcp/session') {
    if (!session) sendJson(res, 503, { error: 'Sessão administrativa indisponível' });
    else if (req.method === 'GET') sendJson(res, 200, session.status());
    else if (req.method === 'POST') { req.resume(); const renewed = session.renew(); if (mcpKeys?.configured()) ngrok?.start(); sendJson(res, 200, renewed); }
    else if (req.method === 'PUT') void readJson(req).then((raw) => {
      const body = record(raw);
      sendJson(res, 200, session.setPolicy(string(body.policy, 'política') as SessionPolicy));
    }).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/whatsapp') {
    if (!whatsapp) sendJson(res, 503, { error: 'WhatsApp indisponível' });
    else if (req.method === 'GET') sendJson(res, 200, { ...whatsapp.status(), apiKeyConfigured: evolution?.status().apiKeyConfigured ?? Boolean(process.env.EVOLUTION_API_KEY), webhookPort: webhookListener?.status().running ? String(webhookListener.status().port) : null });
    else if (req.method === 'PUT') void readJson(req).then((raw) => {
      const body = record(raw);
      sendJson(res, 200, whatsapp.configure({ mainNumber: string(body.mainNumber, 'número principal'), secondaryNumber: string(body.secondaryNumber, 'número secundário') }));
    }).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/whatsapp/settings') {
    if (!evolution) sendJson(res, 503, { error: 'Configuração Evolution indisponível' });
    else if (req.method === 'GET') sendJson(res, 200, evolution.status());
    else if (req.method === 'PUT') void readJson(req).then((raw) => {
      const body = record(raw);
      return evolution.configure({ ...(body.baseUrl !== undefined ? { baseUrl: string(body.baseUrl, 'URL') } : {}),
        ...(body.apiKey !== undefined ? { apiKey: string(body.apiKey, 'chave') } : {}) });
    }).then((result) => sendJson(res, 200, result)).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/whatsapp/listener') {
    if (!webhookListener) sendJson(res, 503, { error: 'Listener WhatsApp indisponível' });
    else if (req.method === 'GET') sendJson(res, 200, webhookListener.status());
    else if (req.method === 'PUT') void readJson(req).then((raw) => {
      const body = record(raw);
      return webhookListener.configure({ enabled: body.enabled as boolean, port: body.port as number, exposeLan: body.exposeLan as boolean });
    }).then((result) => sendJson(res, 200, result)).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/whatsapp/settings/key') {
    if (!evolution) sendJson(res, 503, { error: 'Configuração Evolution indisponível' });
    else if (req.method === 'DELETE') { req.resume(); sendJson(res, 200, evolution.clearKey()); }
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/whatsapp/instance' || path === '/api/hub/whatsapp/instance/connect') {
    if (!whatsapp || !evolution) sendJson(res, 503, { error: 'Configuração WhatsApp indisponível' });
    else if (req.method !== 'POST') sendJson(res, 405, { error: 'Método não permitido' });
    else {
      req.resume();
      if (!whatsapp.status().mainNumber || !whatsapp.status().secondaryNumber) sendJson(res, 409, { error: 'Configure primeiro os números principal e secundário' });
      else void evolution.apiKey().then((apiKey) => {
        const options = { baseUrl: evolution.status().baseUrl, apiKey, fetcher };
        return path.endsWith('/connect') ? connectJobInstance(options) : ensureJobInstance(options);
      }).then((result) => {
        res.setHeader('Cache-Control', 'no-store');
        sendJson(res, result.created ? 201 : 200, result);
      }).catch((error) => fail(res, error));
    }
    return true;
  }
  if (path === '/api/hub/whatsapp/webhook-token') {
    if (!whatsapp) sendJson(res, 503, { error: 'WhatsApp indisponível' });
    else if (req.method === 'POST') { req.resume(); sendJson(res, 200, { token: whatsapp.rotateWebhookToken() }); }
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/whatsapp/webhook') {
    if (!whatsapp || !evolution) sendJson(res, 503, { error: 'Configuração WhatsApp indisponível' });
    else if (req.method !== 'POST') sendJson(res, 405, { error: 'Método não permitido' });
    else if (!whatsapp.status().mainNumber || !whatsapp.status().secondaryNumber) {
      req.resume(); sendJson(res, 409, { error: 'Configure primeiro os números principal e secundário' });
    } else if (!webhookListener?.status().running) {
      req.resume(); sendJson(res, 409, { error: 'Ative o listener do webhook no painel antes de configurar a Evolution' });
    } else void readJson(req).then(async (raw) => {
      const destination = string(record(raw).url, 'URL do webhook');
      const apiKey = await evolution.apiKey();
      return configureJobWebhook({ baseUrl: evolution.status().baseUrl, apiKey, fetcher }, whatsapp, destination);
    }).then((result) => sendJson(res, 200, result)).catch((error) => fail(res, error));
    return true;
  }
  if (path === '/api/hub/whatsapp/diagnostics') {
    if (!whatsapp) sendJson(res, 503, { error: 'WhatsApp indisponível' });
    else if (req.method === 'GET') void (evolution?.apiKey() ?? Promise.resolve(process.env.EVOLUTION_API_KEY ?? ''))
      .then((key) => whatsapp.diagnose(key, fetcher, evolution?.status().baseUrl)).then((result) => sendJson(res, 200, result)).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  const sendQuestionAction = /^\/api\/hub\/whatsapp\/questions\/([0-9a-f-]+)\/send$/.exec(path);
  if (sendQuestionAction) {
    if (!whatsapp) sendJson(res, 503, { error: 'WhatsApp indisponível' });
    else if (req.method === 'POST') { req.resume(); void (evolution?.apiKey() ?? Promise.resolve(process.env.EVOLUTION_API_KEY ?? ''))
      .then((key) => whatsapp.sendQuestion(sendQuestionAction[1], store, key, fetcher, evolution?.status().baseUrl))
      .then((result) => sendJson(res, result.state === 'accepted' ? 200 : 502, result)).catch((error) => fail(res, error)); }
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/router') {
    if (req.method !== 'GET') sendJson(res, 405, { error: 'Método não permitido' });
    else sendJson(res, 200, router?.status() ?? { models: [], usage: { inputTokens: 0, outputTokens: 0, requests: 0 } });
    return true;
  }
  if (path === '/api/hub/router/credentials') {
    if (!providerCredentials) sendJson(res, 503, { error: 'Credenciais de modelos indisponíveis' });
    else if (req.method === 'GET') sendJson(res, 200, providerCredentials.status());
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  const credentialAction = /^\/api\/hub\/router\/credentials\/([a-z]+)$/.exec(path);
  if (credentialAction) {
    if (!providerCredentials) sendJson(res, 503, { error: 'Credenciais de modelos indisponíveis' });
    else if (req.method === 'PUT') void readJson(req).then(async (raw) => {
      await providerCredentials.set(credentialAction[1] as Provider, string(record(raw).key, 'credencial'));
      return providerCredentials.status()[credentialAction[1] as Exclude<Provider, 'ollama'>];
    }).then((result) => sendJson(res, 200, result)).catch((error) => fail(res, error));
    else if (req.method === 'DELETE') {
      req.resume();
      try { providerCredentials.clear(credentialAction[1] as Provider);
        sendJson(res, 200, providerCredentials.status()[credentialAction[1] as Exclude<Provider, 'ollama'>]); }
      catch (error) { fail(res, error); }
    } else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path.startsWith('/api/hub/router/')) {
    if (!router) { sendJson(res, 503, { error: 'Roteador indisponível' }); return true; }
    const action = path.slice('/api/hub/router/'.length);
    if (action === 'models' && req.method === 'POST') void readJson(req).then((raw) => {
      const body = record(raw);
      sendJson(res, 201, router.add({ provider: string(body.provider, 'provedor') as Provider, model: string(body.model, 'modelo'), priority: Number(body.priority),
        ...(body.monthlyRequestLimit === undefined ? {} : { monthlyRequestLimit: optionalPolicyNumber(body.monthlyRequestLimit, 'limite de chamadas') as number }),
        ...(body.monthlyCostLimitUsd === undefined ? {} : { monthlyCostLimitUsd: optionalPolicyNumber(body.monthlyCostLimitUsd, 'limite de custo') as number }),
        ...(body.inputUsdPerMillion === undefined ? {} : { inputUsdPerMillion: optionalPolicyNumber(body.inputUsdPerMillion, 'preço de entrada') as number }),
        ...(body.outputUsdPerMillion === undefined ? {} : { outputUsdPerMillion: optionalPolicyNumber(body.outputUsdPerMillion, 'preço de saída') as number }) }));
    }).catch((error) => fail(res, error));
    else if (action.startsWith('models/') && req.method === 'DELETE') sendJson(res, router.remove(action.slice(7)) ? 200 : 404, { ok: true });
    else if (action.startsWith('models/') && req.method === 'PATCH') void readJson(req).then((raw) => {
      const body = record(raw);
      sendJson(res, 200, router.update(action.slice(7), { ...(body.priority !== undefined ? { priority: Number(body.priority) } : {}), ...(body.enabled !== undefined ? { enabled: body.enabled as boolean } : {}),
        ...(body.monthlyRequestLimit === undefined ? {} : { monthlyRequestLimit: optionalPolicyNumber(body.monthlyRequestLimit, 'limite de chamadas') }),
        ...(body.monthlyCostLimitUsd === undefined ? {} : { monthlyCostLimitUsd: optionalPolicyNumber(body.monthlyCostLimitUsd, 'limite de custo') }),
        ...(body.inputUsdPerMillion === undefined ? {} : { inputUsdPerMillion: optionalPolicyNumber(body.inputUsdPerMillion, 'preço de entrada') }),
        ...(body.outputUsdPerMillion === undefined ? {} : { outputUsdPerMillion: optionalPolicyNumber(body.outputUsdPerMillion, 'preço de saída') }) }));
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
      const linkedApp = body.applicationId === undefined ? undefined : applications?.get(string(body.applicationId, 'candidatura'));
      if (body.applicationId !== undefined && !linkedApp) throw new Error('Candidatura não encontrada');
      if (linkedApp && !['draft', 'awaiting_approval', 'approved'].includes(linkedApp.status)) throw new Error('Candidatura com envio iniciado não pode receber novas perguntas');
      sendJson(res, 201, store.askQuestion({ taskId: string(body.taskId, 'tarefa'), text: string(body.text, 'pergunta'),
        ...(body.applicationId === undefined ? {} : { applicationId: string(body.applicationId, 'candidatura') }),
        ...(body.fieldName === undefined ? {} : { fieldName: string(body.fieldName, 'campo da candidatura') }),
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
    else void readJson(req).then((raw) => {
      store.answerQuestion(questionAction[1], string(record(raw).answer, 'resposta'));
      if (applications) reconcileApplicationAnswers(store, applications);
      sendJson(res, 200, store.listQuestions().find((question) => question.id === questionAction[1]));
    }).catch((error) => fail(res, error));
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
  const applicationEvidence = /^\/api\/hub\/applications\/([0-9a-f-]+)\/evidence$/.exec(path);
  if (applicationEvidence) {
    if (!applications) sendJson(res, 503, { error: 'Candidaturas indisponíveis' });
    else if (req.method !== 'GET') sendJson(res, 405, { error: 'Método não permitido' });
    else try {
      const png = applications.evidence(applicationEvidence[1]);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'no-store' }); res.end(png);
    } catch (error) { fail(res, error); }
    return true;
  }
  const submissionAction = /^\/api\/hub\/applications\/([0-9a-f-]+)\/(prepare|submit|verify-submission)$/.exec(path);
  if (submissionAction) {
    if (!applications || !browser) { sendJson(res, 503, { error: 'Envio de candidaturas indisponível' }); return true; }
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'Método não permitido' }); return true; }
    void readJson(req).then(async (raw) => {
      const body = record(raw), app = applications.get(submissionAction[1]);
      if (!app) { sendJson(res, 404, { error: 'Candidatura não encontrada' }); return; }
      const pageId = string(body.pageId, 'página');
      const page = browser.status().pages.find((candidate) => candidate.id === pageId);
      if (!page) { sendJson(res, 404, { error: 'Página do navegador não encontrada' }); return; }
      if (submissionAction[2] === 'prepare') {
        if (!['draft', 'awaiting_approval', 'approved'].includes(app.status)) throw new Error('Candidatura já possui tentativa de envio');
        sendJson(res, 200, await browser.fillAnswersByLabel(pageId, app.answers));
        return;
      }
      const confirmationText = string(body.confirmationText, 'texto de confirmação');
      if (submissionAction[2] === 'verify-submission') {
        if (app.status !== 'submission_uncertain') throw new Error('A candidatura não está com envio incerto');
        const evidence = await browser.verifyConfirmationText(pageId, confirmationText);
        sendJson(res, 200, applications.confirmSubmission(app.id, evidence));
        return;
      }
      if (app.status !== 'approved') throw new Error('A candidatura precisa estar aprovada antes do envio final');
      const buttonText = string(body.buttonText, 'texto do botão final');
      await browser.submissionReadyByText(pageId, buttonText, confirmationText);
      applications.startSubmission(app.id, page.url);
      try {
        const evidence = await browser.submitByTextAndConfirm(pageId, buttonText, confirmationText);
        sendJson(res, 200, applications.confirmSubmission(app.id, evidence));
      } catch {
        sendJson(res, 202, { ...applications.markSubmissionUncertain(app.id, 'Confirmação não verificada após tentativa de envio'), warning: 'Envio incerto. Confira o portal antes de qualquer nova ação.' });
      }
    }).catch((error) => fail(res, error));
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
  if (path === '/api/hub/jobs/greenhouse/boards') {
    if (!greenhouseBoards) sendJson(res, 503, { error: 'Páginas de carreira indisponíveis' });
    else if (req.method === 'GET') sendJson(res, 200, greenhouseBoards.list());
    else if (req.method === 'POST') void readJson(req).then((raw) => registerGreenhouseBoard(greenhouseBoards,
      string(record(raw).url, 'endereço'), fetcher)).then((board) => sendJson(res, 201, board)).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  const greenhouseBoard = /^\/api\/hub\/jobs\/greenhouse\/boards\/([A-Za-z0-9_-]+)$/.exec(path);
  if (greenhouseBoard) {
    if (!greenhouseBoards) sendJson(res, 503, { error: 'Páginas de carreira indisponíveis' });
    else if (req.method !== 'DELETE') sendJson(res, 405, { error: 'Método não permitido' });
    else { req.resume(); sendJson(res, greenhouseBoards.remove(greenhouseBoard[1]) ? 200 : 404, { removed: greenhouseBoard[1] }); }
    return true;
  }
  if (path === '/api/hub/jobs/greenhouse/search') {
    if (!greenhouseBoards || !jobs) sendJson(res, 503, { error: 'Pesquisa Greenhouse indisponível' });
    else if (req.method !== 'POST') sendJson(res, 405, { error: 'Método não permitido' });
    else void readJson(req).then((raw) => searchGreenhouseBoards(greenhouseBoards, jobs,
      string(record(raw).query, 'pesquisa'), fetcher)).then((result) => sendJson(res, 200, result)).catch((error) => fail(res, error));
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
      if (body.modelId !== undefined && (!router || !router.status().models.some((model) => model.id === body.modelId))) throw new Error('Modelo selecionado não encontrado');
      const agent = store.createAgent({ name: string(body.name, 'nome'), objective: string(body.objective, 'objetivo'),
        ...(body.parentId === undefined ? {} : { parentId: string(body.parentId, 'agente principal') }),
        ...(body.codexThread === undefined ? {} : { codexThread: string(body.codexThread, 'sessão Codex') }),
        ...(body.codexHome === undefined ? {} : { codexHome: string(body.codexHome, 'pasta Codex') }),
        ...(body.modelId === undefined ? {} : { modelId: string(body.modelId, 'modelo') }),
        ...(body.fallbackModelIds === undefined ? {} : { fallbackModelIds: fallbackIds(body.fallbackModelIds, router) }),
        ...(body.monthlyAiRequestLimit === undefined ? {} : { monthlyAiRequestLimit: optionalPolicyNumber(body.monthlyAiRequestLimit, 'limite de chamadas do agente') as number }),
        ...(body.monthlyAiCostLimitUsd === undefined ? {} : { monthlyAiCostLimitUsd: optionalPolicyNumber(body.monthlyAiCostLimitUsd, 'limite de custo do agente') as number }) });
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
      if (body.modelId !== undefined && body.modelId !== null && (!router || !router.status().models.some((model) => model.id === body.modelId))) throw new Error('Modelo selecionado não encontrado');
      sendJson(res, 200, store.updateAgent(agentAction[1], { ...(body.name !== undefined ? { name: string(body.name, 'nome') } : {}),
        ...(body.objective !== undefined ? { objective: string(body.objective, 'objetivo') } : {}),
        ...(body.modelId === undefined ? {} : { modelId: body.modelId === null ? null : string(body.modelId, 'modelo') }),
        ...(body.fallbackModelIds === undefined ? {} : { fallbackModelIds: body.fallbackModelIds === null ? null : fallbackIds(body.fallbackModelIds, router) }),
        ...(body.codexThread === undefined ? {} : { codexThread: body.codexThread === null ? null : string(body.codexThread, 'sessão Codex') }),
        ...(body.codexHome === undefined ? {} : { codexHome: body.codexHome === null ? null : string(body.codexHome, 'pasta Codex') }),
        ...(body.monthlyAiRequestLimit === undefined ? {} : { monthlyAiRequestLimit: optionalPolicyNumber(body.monthlyAiRequestLimit, 'limite de chamadas do agente') }),
        ...(body.monthlyAiCostLimitUsd === undefined ? {} : { monthlyAiCostLimitUsd: optionalPolicyNumber(body.monthlyAiCostLimitUsd, 'limite de custo do agente') }) }));
    }).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  if (path === '/api/hub/tasks') {
    if (req.method === 'GET') sendJson(res, 200, store.listTasks());
    else if (req.method === 'POST') void readJson(req).then((raw) => {
      const body = record(raw);
      sendJson(res, 201, store.createTask({ agentId: string(body.agentId, 'agente'), instruction: string(body.instruction, 'instrução'),
        ...(body.priority === undefined ? {} : { priority: body.priority as number }) }));
    }).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  const taskPriorityAction = /^\/api\/hub\/tasks\/([0-9a-f-]+)\/priority$/.exec(path);
  if (taskPriorityAction) {
    if (req.method === 'PATCH') void readJson(req).then((raw) => sendJson(res, 200,
      store.setTaskPriority(taskPriorityAction[1], record(raw).priority as number))).catch((error) => fail(res, error));
    else sendJson(res, 405, { error: 'Método não permitido' });
    return true;
  }
  const action = /^\/api\/hub\/tasks\/([0-9a-f-]+)\/(pause|resume|retry)$/.exec(path);
  if (action) {
    if (req.method !== 'POST') sendJson(res, 405, { error: 'Método não permitido' });
    else {
      req.resume();
      try {
        const task = store.listTasks().find((t) => t.id === action[1]);
        if (!task) sendJson(res, 404, { error: 'Tarefa não encontrada' });
        else if (action[2] === 'pause' && ['queued', 'unassigned'].includes(task.status)) sendJson(res, 200, store.setTaskStatus(task.id, 'paused'));
        else if (action[2] === 'resume' && task.status === 'paused') sendJson(res, 200, store.setTaskStatus(task.id, store.agent(task.agentId)?.codexThread ? 'queued' : 'unassigned'));
        else if (action[2] === 'retry' && ['failed', 'interrupted'].includes(task.status)) sendJson(res, 200, store.retryTask(task.id));
        else sendJson(res, 409, { error: 'Ação incompatível com o estado da tarefa' });
      } catch (error) { fail(res, error); }
    }
    return true;
  }
  sendJson(res, 404, { error: 'Rota desconhecida' });
  return true;
}
