import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { HubStore } from './store';
import { JobStore, searchRemotive } from './jobs';
import { ProfileStore } from './profile';
import { ModelRouter } from './router';
import { reconcileAnalysisTasks, runJobAction } from './job-actions';
import { dispatchWithLocalFallback } from './dispatcher';

it.skipIf(process.env.PROJECTHUB_ANALYST_E2E !== '1')('extracts source-checked requirements with the installed Ollama model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-analyst-e2e-'));
  try {
    const hub = new HubStore(join(dir, 'state.json')); hub.ensureJobSearchTeam();
    const jobs = new JobStore(join(dir, 'jobs.json'));
    const profile = new ProfileStore(join(dir, 'profile.json'));
    const router = new ModelRouter(join(dir, 'router.json'));
    if (!await router.discoverLocalModel()) throw new Error('Ollama local sem modelo instalado');
    await searchRemotive(jobs, 'assistente', async () => new Response(JSON.stringify({ jobs: [{
      id: 901, url: 'https://remotive.com/remote-jobs/support/assistant-901', title: 'Assistente', company_name: 'Empresa de teste',
      description: '<p>Requisito: conhecimento em Excel.</p>',
    }] }), { status: 200 }));
    reconcileAnalysisTasks(hub, jobs);
    let modelText = '';
    const observedRouter = { complete: async (...args: Parameters<ModelRouter['complete']>) => {
      const answer = await router.complete(...args);
      modelText = answer.text;
      return answer;
    } };
    const result = await dispatchWithLocalFallback(hub, undefined, async () => { throw new Error('Modelo genérico não deve ser chamado'); },
      Date.now(), () => true, (task, agent) => runJobAction(task, agent, { hub, jobs, profile, router: observedRouter }));
    expect(result?.status, `${result?.error ?? ''} · resposta do modelo: ${modelText}`).toBe('done');
    expect(jobs.list()[0].analysisModel).toMatch(/^ollama\//);
    expect(jobs.list()[0].requirements.every((requirement) => jobs.list()[0].description.includes(requirement))).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 200_000);
