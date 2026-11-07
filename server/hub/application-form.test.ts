import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { HubStore } from './store';
import { ApplicationStore } from './applications';
import { requestMissingApplicationFields } from './application-form';
import { reconcileApplicationAnswers } from './application-answers';
import { runJobAction } from './job-actions';
import { JobStore } from './jobs';
import { ProfileStore } from './profile';
import { dispatchWithLocalFallback } from './dispatcher';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('asks only unanswered, uniquely labelled required text fields and resumes their own tasks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-form-')); dirs.push(dir);
  const hub = new HubStore(join(dir, 'hub.json')); hub.ensureJobSearchTeam();
  const specialistId = hub.listAgents().find((agent) => agent.systemKey === 'job-search/applications')!.id;
  hub.updateAgent(specialistId, { codexThread: '12345678-1234-1234-1234-123456789012', codexHome: 'C:/Codex' });
  const applications = new ApplicationStore(join(dir, 'applications.json'));
  const app = applications.create({ jobId: 'job-1', source: 'Remotive', sourceId: '1',
    originalUrl: 'https://remotive.com/remote-jobs/example', title: 'Auxiliar', company: 'Empresa' });
  applications.setAnswers(app.id, { Nome: 'Pessoa confirmada' });
  const fields = [
    { label: 'Nome', kind: 'text' as const, required: true, fillable: true },
    { label: 'Disponibilidade', kind: 'text' as const, required: true, fillable: true },
    { label: 'Pretensão salarial', kind: 'text' as const, required: true, fillable: true },
    { label: 'Senha', kind: 'text' as const, required: true, fillable: true },
    { label: 'Currículo', kind: 'file' as const, required: true, fillable: false },
    { label: 'Aceito os termos', kind: 'checkbox' as const, required: true, fillable: false },
    { label: 'Cargo não obrigatório', kind: 'text' as const, required: false, fillable: true },
  ];
  const browser = { inspectFormFields: async (_pageId: string) => fields };
  const result = await requestMissingApplicationFields(hub, applications, browser, app.id, 'page-1');
  expect(result.requested.map((item) => item.fieldName)).toEqual(['Disponibilidade', 'Pretensão salarial']);
  expect(result.alreadyKnown).toEqual(['Nome']);
  expect(result.needsManual).toEqual(['Senha', 'Currículo', 'Aceito os termos']);
  expect(hub.listQuestions().filter((item) => item.state === 'pending')).toHaveLength(2);
  expect((await requestMissingApplicationFields(hub, applications, browser, app.id, 'page-1')).requested).toEqual([]);
  const first = result.requested[0];
  hub.answerQuestion(first.id, 'Imediata');
  reconcileApplicationAnswers(hub, applications);
  expect(applications.get(app.id)?.answers).toMatchObject({ Nome: 'Pessoa confirmada', Disponibilidade: 'Imediata' });
  expect(hub.listQuestions().find((item) => item.id === result.requested[1].id)?.state).toBe('pending');
  const runner = vi.fn(async () => ({ ok: true as const }));
  const local = vi.fn(async () => ({ text: 'não esperado', model: 'local' }));
  const completed = await dispatchWithLocalFallback(hub, runner, local, Date.now(), () => true,
    (task, agent) => runJobAction(task, agent, { hub, applications, jobs: new JobStore(join(dir, 'jobs.json')),
      profile: new ProfileStore(join(dir, 'profile.json')), router: { complete: async () => { throw new Error('Modelo não deve ser usado'); } } }));
  expect(completed).toMatchObject({ id: first.taskId, status: 'done' });
  expect(completed?.result).toContain('Disponibilidade');
  expect(runner).not.toHaveBeenCalled();
  expect(local).not.toHaveBeenCalled();
});
