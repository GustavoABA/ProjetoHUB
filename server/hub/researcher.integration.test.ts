import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { HubStore } from './store';
import { JobStore, searchRemotive } from './jobs';
import { dispatchWithLocalFallback } from './dispatcher';

it.skipIf(process.env.PROJECTHUB_REMOTIVE_E2E !== '1')('records only listings received from the live Remotive API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-remotive-e2e-'));
  try {
    const hub = new HubStore(join(dir, 'state.json')); hub.ensureJobSearchTeam();
    const researcher = hub.listAgents().find((agent) => agent.systemKey === 'job-search/researcher')!;
    const task = hub.createTask({ agentId: researcher.id, instruction: 'assistant' });
    const jobs = new JobStore(join(dir, 'jobs.json'));
    const result = await dispatchWithLocalFallback(hub, undefined, async () => { throw new Error('Modelo não deveria ser chamado'); },
      Date.now(), () => true, async (selected) => {
        const found = await searchRemotive(jobs, selected.instruction);
        return `Pesquisa Remotive: ${found.added} vaga(s) nova(s) entre ${found.jobs.length} anúncio(s) válidos.`;
      });
    expect(result).toMatchObject({ id: task.id, status: 'done' });
    expect(result?.result).toMatch(/^Pesquisa Remotive: \d+ vaga\(s\) nova\(s\) entre \d+ anúncio\(s\) válidos\.$/);
    expect(new JobStore(join(dir, 'jobs.json')).list().length).toBeGreaterThan(0);
    expect(new JobStore(join(dir, 'jobs.json')).list().every((job) => job.source === 'Remotive' &&
      job.originalUrl.startsWith('https://remotive.com/remote-jobs/'))).toBe(true);
    expect(new HubStore(join(dir, 'state.json')).listTasks().find((item) => item.id === task.id)?.status).toBe('done');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 35_000);
