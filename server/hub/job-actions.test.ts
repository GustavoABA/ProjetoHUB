import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HubStore } from './store';
import { JobStore, searchRemotive } from './jobs';
import { ProfileStore } from './profile';
import { reconcileAnalysisTasks, runJobAction } from './job-actions';
import { dispatchWithLocalFallback } from './dispatcher';
import type { ModelRouter } from './router';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-job-actions-')); dirs.push(dir);
  const hub = new HubStore(join(dir, 'state.json')); hub.ensureJobSearchTeam();
  return { dir, hub, jobs: new JobStore(join(dir, 'jobs.json')), profile: new ProfileStore(join(dir, 'profile.json')) };
}
const response = async () => new Response(JSON.stringify({ jobs: [{ id: 88, url: 'https://remotive.com/remote-jobs/support/assistant-88',
  title: 'Assistente remoto', company_name: 'Empresa', description: '<p>Conhecimento em Excel.</p>' }] }), { status: 200 });

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
  hub.updateAgent(analyst.id, { modelId });
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
  expect(calls[0]?.slice(1)).toEqual([undefined, modelId]);
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
  expect(calls[0]?.slice(1)).toEqual(['ollama', undefined]);
});
