import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HubStore } from './store';
import { JobStore, searchRemotive } from './jobs';
import { ProfileStore } from './profile';
import { ApplicationStore } from './applications';
import { reconcileAnalysisTasks, reconcileCompatibilityTasks, runJobAction } from './job-actions';
import { dispatchWithLocalFallback } from './dispatcher';
import type { ModelRouter } from './router';
import { GreenhouseBoardStore } from './greenhouse';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-job-actions-')); dirs.push(dir);
  const hub = new HubStore(join(dir, 'state.json')); hub.ensureJobSearchTeam();
  return { dir, hub, jobs: new JobStore(join(dir, 'jobs.json')), profile: new ProfileStore(join(dir, 'profile.json')) };
}
const response = async () => new Response(JSON.stringify({ jobs: [{ id: 88, url: 'https://remotive.com/remote-jobs/support/assistant-88',
  title: 'Assistente remoto', company_name: 'Empresa', description: '<p>Conhecimento em Excel.</p>' }] }), { status: 200 });

it('continues research with a registered career board when Remotive is unavailable', async () => {
  const { dir, hub, jobs, profile } = fixture();
  const boards = new GreenhouseBoardStore(join(dir, 'greenhouse-boards.json'));
  boards.addVerified('empresa', 'Empresa verificada');
  const researcher = hub.listAgents().find((agent) => agent.systemKey === 'job-search/researcher')!;
  const task = hub.createTask({ agentId: researcher.id, instruction: 'assistente' });
  const fetcher = async (url: URL | RequestInfo) => String(url).includes('greenhouse.io')
    ? new Response(JSON.stringify({ jobs: [{ id: 42, internal_job_id: 9, title: 'Assistente',
      location: { name: 'São Paulo' }, content: '<p>Atendimento</p>',
      absolute_url: 'https://job-boards.greenhouse.io/empresa/jobs/42' }] }), { status: 200 })
    : new Response('indisponível', { status: 503 });
  const result = await runJobAction(task, researcher, { hub, jobs, profile, router: { complete: async () => { throw new Error('unused'); } },
    greenhouseBoards: boards, fetcher: fetcher as typeof fetch });
  expect(result).toContain('Greenhouse: 1 vaga(s) nova(s)');
  expect(result).toContain('Remotive:');
  expect(jobs.list()).toMatchObject([{ source: 'Greenhouse', sourceId: 'empresa:42' }]);
  expect(hub.listTasks().some((item) => item.agentId !== researcher.id && item.instruction === jobs.list()[0].id)).toBe(true);
});

it('delegates each unanalysed source-backed vacancy once, including after restart', async () => {
  const { dir, hub, jobs } = fixture();
  await searchRemotive(jobs, 'assistant', response);
  expect(reconcileAnalysisTasks(hub, jobs)).toBe(1);
  expect(reconcileAnalysisTasks(hub, jobs)).toBe(0);
  const task = hub.listTasks()[0];
  expect(task.instruction).toBe(jobs.list()[0].id);
  expect(hub.agent(task.agentId)?.systemKey).toBe('job-search/requirements');
  expect(reconcileAnalysisTasks(new HubStore(join(dir, 'state.json')), new JobStore(join(dir, 'jobs.json')))).toBe(0);
});

it('delegates immediately after the researcher saves a new vacancy', async () => {
  const { hub, jobs, profile } = fixture();
  const researcher = hub.listAgents().find((agent) => agent.systemKey === 'job-search/researcher')!;
  const task = hub.createTask({ agentId: researcher.id, instruction: 'assistant' });
  const router = { complete: async () => { throw new Error('Modelo não deveria ser chamado'); } };
  const result = await dispatchWithLocalFallback(hub, undefined, async () => { throw new Error('Modelo genérico não deveria ser chamado'); },
    Date.now(), () => true, (selected, agent) => runJobAction(selected, agent, { hub, jobs, profile, router, fetcher: response }));
  expect(result).toMatchObject({ id: task.id, status: 'done' });
  const delegated = hub.listTasks().find((item) => item.id !== task.id);
  expect(delegated?.instruction).toBe(jobs.list()[0].id);
  expect(hub.agent(delegated!.agentId)?.systemKey).toBe('job-search/requirements');
});

it('executes the analyst task with source-checked requirements and an explicit model choice', async () => {
  const { hub, jobs, profile } = fixture();
  await searchRemotive(jobs, 'assistant', response);
  reconcileAnalysisTasks(hub, jobs);
  const analyst = hub.listAgents().find((agent) => agent.systemKey === 'job-search/requirements')!;
  const modelId = '12345678-1234-1234-1234-123456789012';
  const backupId = '12345678-1234-1234-1234-123456789013';
  hub.updateAgent(analyst.id, { modelId, fallbackModelIds: [backupId] });
  const calls: Array<Parameters<ModelRouter['complete']>> = [];
  const router = { complete: async (...args: Parameters<ModelRouter['complete']>) => {
    calls.push(args);
    return { text: '{"requirements":["Conhecimento em Excel."]}', provider: 'ollama' as const,
      model: 'qwen2.5:1.5b', inputTokens: 1, outputTokens: 1 };
  } };
  const result = await dispatchWithLocalFallback(hub, undefined, async () => { throw new Error('generic model path'); },
    Date.now(), () => true, (task, agent) => runJobAction(task, agent, { hub, jobs, profile, router, fetcher: response }));
  expect(result).toMatchObject({ status: 'done' });
  expect(result?.result).toContain('1 requisito');
  expect(jobs.list()[0]).toMatchObject({ requirements: ['Conhecimento em Excel.'], analysisModel: 'ollama/qwen2.5:1.5b' });
  expect(calls[0]?.slice(1)).toEqual([undefined, modelId, [backupId]]);
});

it('uses only Ollama for automatically delegated analysis by default', async () => {
  const { hub, jobs, profile } = fixture();
  await searchRemotive(jobs, 'assistant', response);
  reconcileAnalysisTasks(hub, jobs);
  const task = hub.listTasks()[0]; const analyst = hub.agent(task.agentId)!;
  const calls: Array<Parameters<ModelRouter['complete']>> = [];
  const router = { complete: async (...args: Parameters<ModelRouter['complete']>) => {
    calls.push(args);
    return { text: '{"requirements":["Conhecimento em Excel."]}', provider: 'ollama' as const,
      model: 'local', inputTokens: 1, outputTokens: 1 };
  } };
  await runJobAction(task, analyst, { hub, jobs, profile, router });
  expect(calls[0]?.slice(1)).toEqual(['ollama', undefined, undefined]);
});

it('delegates source analysis then confirmed-profile scoring to separate agents', async () => {
  const { dir, hub, jobs, profile } = fixture();
  await searchRemotive(jobs, 'assistant', response);
  profile.update({ skills: ['Excel'], experience: [], education: [] }); profile.confirm();
  reconcileAnalysisTasks(hub, jobs);
  const analyst = hub.listAgents().find((agent) => agent.systemKey === 'job-search/requirements')!;
  const router = { complete: async () => ({ text: '{"requirements":["Conhecimento em Excel."]}', provider: 'ollama' as const,
    model: 'local', inputTokens: 1, outputTokens: 1 }) };
  const analystTask = hub.listTasks().find((task) => task.agentId === analyst.id)!;
  await runJobAction(analystTask, analyst, { hub, jobs, profile, router });
  expect(jobs.list()[0].compatibility).toBeNull();
  expect(jobs.list()[0].profileRevision).toBeUndefined();
  const evaluator = hub.listAgents().find((agent) => agent.systemKey === 'job-search/compatibility')!;
  const evaluation = hub.listTasks().find((task) => task.agentId === evaluator.id)!;
  expect(evaluation.instruction).toBe(`${jobs.list()[0].id}@${profile.get().revision}`);
  expect(reconcileCompatibilityTasks(hub, jobs, profile)).toBe(0);
  hub.setTaskStatus(analystTask.id, 'done');
  const evaluated = await dispatchWithLocalFallback(hub, undefined,
    async () => { throw new Error('Modelo não deve avaliar compatibilidade'); }, Date.now(), () => true,
    (task, agent) => runJobAction(task, agent, { hub, jobs, profile, router }));
  expect(evaluated).toMatchObject({ id: evaluation.id, status: 'done' });
  expect(jobs.list()[0]).toMatchObject({ compatibility: 100, profileRevision: profile.get().revision });
  expect(new JobStore(join(dir, 'jobs.json')).list()[0].compatibility).toBe(100);
});

it('re-evaluates after a confirmed profile revision without re-extracting requirements', async () => {
  const { hub, jobs, profile } = fixture();
  await searchRemotive(jobs, 'assistant', response);
  const initial = profile.update({ skills: ['Excel'], experience: [], education: [] }); profile.confirm();
  const router = { complete: async () => { throw new Error('A avaliação não deve chamar modelo'); } };
  const jobId = jobs.list()[0].id;
  jobs.analyzed(jobId, { requirements: ['Conhecimento em Excel.'], compatibility: null,
    justification: 'Aguardando avaliação.', analysisModel: 'ollama/local' });
  expect(reconcileCompatibilityTasks(hub, jobs, profile)).toBe(1);
  const evaluator = hub.listAgents().find((agent) => agent.systemKey === 'job-search/compatibility')!;
  const oldTask = hub.listTasks().find((task) => task.agentId === evaluator.id)!;
  profile.update({ skills: ['Atendimento'], experience: [], education: [] }); profile.confirm();
  expect(reconcileCompatibilityTasks(hub, jobs, profile)).toBe(1);
  expect(reconcileCompatibilityTasks(hub, jobs, profile)).toBe(0);
  expect(await runJobAction(oldTask, evaluator, { hub, jobs, profile, router })).toContain('desatualizada');
  expect(jobs.list()[0].profileRevision).toBeUndefined();
  const latest = hub.listTasks().filter((task) => task.agentId === evaluator.id).at(-1)!;
  await runJobAction(latest, evaluator, { hub, jobs, profile, router });
  expect(jobs.list()[0]).toMatchObject({ compatibility: 0, profileRevision: profile.get().revision });
  expect(jobs.list()[0].profileRevision).not.toBe(initial.revision);
  expect(reconcileAnalysisTasks(hub, jobs)).toBe(0);
});

it('does not delegate compatibility work without a confirmed profile', async () => {
  const { hub, jobs, profile } = fixture();
  await searchRemotive(jobs, 'assistant', response);
  jobs.analyzed(jobs.list()[0].id, { requirements: ['Conhecimento em Excel.'], compatibility: null,
    justification: 'Aguardando avaliação.', analysisModel: 'ollama/local' });
  expect(reconcileCompatibilityTasks(hub, jobs, profile)).toBe(0);
});

it('recovers a queued evaluation after restart without duplicating it', async () => {
  const { dir, hub, jobs, profile } = fixture();
  await searchRemotive(jobs, 'assistant', response);
  profile.update({ skills: ['Excel'], experience: [], education: [] }); profile.confirm();
  jobs.analyzed(jobs.list()[0].id, { requirements: ['Conhecimento em Excel.'], compatibility: null,
    justification: 'Aguardando avaliação.', analysisModel: 'ollama/local' });
  expect(reconcileCompatibilityTasks(hub, jobs, profile)).toBe(1);
  const restarted = new HubStore(join(dir, 'state.json'));
  const savedJobs = new JobStore(join(dir, 'jobs.json'));
  const savedProfile = new ProfileStore(join(dir, 'profile.json'));
  expect(reconcileCompatibilityTasks(restarted, savedJobs, savedProfile)).toBe(0);
  const result = await dispatchWithLocalFallback(restarted, undefined,
    async () => { throw new Error('Modelo não deve ser chamado'); }, Date.now(), () => true,
    (task, agent) => runJobAction(task, agent, { hub: restarted, jobs: savedJobs, profile: savedProfile,
      router: { complete: async () => { throw new Error('Modelo não deve ser chamado'); } } }));
  expect(result?.status).toBe('done');
  expect(savedJobs.list()[0].compatibility).toBe(100);
});

it('application specialist creates one persistent draft and never requests or records submission', async () => {
  const { dir, hub, jobs, profile } = fixture();
  await searchRemotive(jobs, 'assistant', response);
  const applications = new ApplicationStore(join(dir, 'applications.json'));
  const specialist = hub.listAgents().find((agent) => agent.systemKey === 'job-search/applications')!;
  const job = jobs.list()[0];
  const task = hub.createTask({ agentId: specialist.id, instruction: job.id });
  const router = { complete: async () => { throw new Error('Modelo não deve ser chamado'); } };
  const action = (selected: typeof task, agent: typeof specialist) => runJobAction(selected, agent,
    { hub, jobs, profile, applications, router });
  const result = await dispatchWithLocalFallback(hub, undefined, async () => { throw new Error('Modelo genérico não deve ser chamado'); },
    Date.now(), () => true, action);
  expect(result).toMatchObject({ id: task.id, status: 'done' });
  expect(applications.list()).toMatchObject([{ jobId: job.id, status: 'draft', answers: {}, history: [{ action: 'created' }] }]);
  const again = hub.createTask({ agentId: specialist.id, instruction: job.id });
  expect(await action(again, specialist)).toContain('Já existe');
  expect(new ApplicationStore(join(dir, 'applications.json')).list()).toHaveLength(1);
});

it('application specialist refuses a job ID that was not saved from a source', async () => {
  const { dir, hub, jobs, profile } = fixture();
  const applications = new ApplicationStore(join(dir, 'applications.json'));
  const specialist = hub.listAgents().find((agent) => agent.systemKey === 'job-search/applications')!;
  const task = hub.createTask({ agentId: specialist.id, instruction: '12345678-1234-1234-1234-123456789012' });
  const result = await dispatchWithLocalFallback(hub, undefined, async () => { throw new Error('Modelo não deve ser chamado'); },
    Date.now(), () => true, (selected, agent) => runJobAction(selected, agent, { hub, jobs, profile, applications,
      router: { complete: async () => { throw new Error('Modelo não deve ser chamado'); } } }));
  expect(result).toMatchObject({ id: task.id, status: 'failed' });
  expect(applications.list()).toEqual([]);
});
