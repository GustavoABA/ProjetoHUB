import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HubStore } from './store';
import { ApplicationStore } from './applications';
import { WhatsAppStore } from './whatsapp';
import { reconcileApplicationAnswers } from './application-answers';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-app-answers-')); dirs.push(dir);
  const hub = new HubStore(join(dir, 'hub.json'));
  const agent = hub.createAgent({ name: 'Candidaturas', objective: 'Preparar' });
  const first = hub.createTask({ agentId: agent.id, instruction: 'Preparar primeira' });
  const other = hub.createTask({ agentId: agent.id, instruction: 'Outra tarefa' });
  const applications = new ApplicationStore(join(dir, 'applications.json'));
  const app = applications.create({ jobId: 'job-1', source: 'Remotive', sourceId: '101',
    originalUrl: 'https://remotive.com/remote-jobs/support/assistant-101', title: 'Assistente', company: 'Empresa' });
  return { dir, hub, applications, app, first, other };
}

it('applies one answered question to its application field exactly once across restarts', () => {
  const { dir, hub, applications, app, first, other } = fixture();
  const question = hub.askQuestion({ taskId: first.id, applicationId: app.id, fieldName: 'Disponibilidade', text: 'Quando pode começar?' });
  hub.answerQuestion(question.id, 'Após as 14h');
  expect(reconcileApplicationAnswers(hub, applications)).toBe(1);
  expect(applications.get(app.id)?.answers).toEqual({ Disponibilidade: 'Após as 14h' });
  expect(hub.listQuestions()[0].appliedAt).toBeTruthy();
  expect(hub.listTasks().find((task) => task.id === other.id)?.status).toBe('unassigned');
  const restartedHub = new HubStore(join(dir, 'hub.json'));
  const restartedApps = new ApplicationStore(join(dir, 'applications.json'));
  expect(reconcileApplicationAnswers(restartedHub, restartedApps)).toBe(0);
  expect(restartedApps.get(app.id)?.history.filter((event) => event.action === 'answers_changed')).toHaveLength(1);
});

it('treats a WhatsApp answer as a new draft requiring approval again', () => {
  const { dir, hub, applications, app, first } = fixture();
  applications.setAnswers(app.id, { Experiência: 'Sem experiência formal' });
  applications.requestApproval(app.id); applications.approve(app.id);
  const question = hub.askQuestion({ taskId: first.id, applicationId: app.id, fieldName: 'Disponibilidade', text: 'Quando pode começar?' });
  const whatsapp = new WhatsAppStore(join(dir, 'whatsapp.json'));
  whatsapp.configure({ mainNumber: '5511999999999', secondaryNumber: '5511888888888' });
  const token = whatsapp.rotateWebhookToken();
  const event = { event: 'messages.upsert', instance: 'procura-de-emprego', data: { key: { id: 'IN-001',
    remoteJid: '5511999999999@s.whatsapp.net', fromMe: false }, message: { conversation: `#${question.id.slice(0, 8)} Imediata` } } };
  expect(whatsapp.ingest(token, event, hub)).toBe('answered');
  expect(reconcileApplicationAnswers(hub, applications)).toBe(1);
  expect(applications.get(app.id)).toMatchObject({ status: 'draft', answers: { Experiência: 'Sem experiência formal', Disponibilidade: 'Imediata' } });
  expect(applications.get(app.id)?.approvedAt).toBeUndefined();
  expect(whatsapp.ingest(token, event, hub)).toBe('duplicate');
  expect(reconcileApplicationAnswers(hub, applications)).toBe(0);
});

it('recovers a crash after saving the application but before marking the question applied', () => {
  const { dir, hub, applications, app, first } = fixture();
  const question = hub.askQuestion({ taskId: first.id, applicationId: app.id, fieldName: 'Disponibilidade', text: 'Quando pode começar?' });
  hub.answerQuestion(question.id, 'Imediata');
  applications.setAnswers(app.id, { Disponibilidade: 'Imediata' });
  const restartedHub = new HubStore(join(dir, 'hub.json'));
  const restartedApps = new ApplicationStore(join(dir, 'applications.json'));
  expect(reconcileApplicationAnswers(restartedHub, restartedApps)).toBe(1);
  expect(restartedHub.listQuestions()[0].appliedAt).toBeTruthy();
  expect(restartedApps.get(app.id)?.history.filter((event) => event.action === 'answers_changed')).toHaveLength(1);
});

it('rejects unsafe field names and records an error when a submitted application cannot be edited', () => {
  const { hub, applications, app, first } = fixture();
  expect(() => hub.askQuestion({ taskId: first.id, applicationId: app.id, fieldName: 'senha', text: 'Senha?' })).toThrow();
  const question = hub.askQuestion({ taskId: first.id, applicationId: app.id, fieldName: 'Disponibilidade', text: 'Quando pode começar?' });
  hub.answerQuestion(question.id, 'Amanhã');
  applications.setAnswers(app.id, { Experiência: 'Confirmada' });
  applications.requestApproval(app.id); applications.approve(app.id);
  applications.startSubmission(app.id, 'https://remotive.com/remote-jobs/support/assistant-101');
  expect(reconcileApplicationAnswers(hub, applications)).toBe(0);
  expect(hub.listQuestions()[0].applicationSyncError).toContain('envio');
  expect(applications.get(app.id)?.answers).toEqual({ Experiência: 'Confirmada' });
});
