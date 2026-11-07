import type { HubAgent, HubTask, HubStore } from './store';
import { searchRemotive, type JobStore } from './jobs';
import type { ProfileStore } from './profile';
import type { ModelRouter } from './router';
import { analyzeJob } from './analysis';

export interface JobActionDeps {
  hub: HubStore;
  jobs: JobStore;
  profile: ProfileStore;
  router: Pick<ModelRouter, 'complete'>;
  fetcher?: typeof fetch;
}

/** Assign each saved, unanalysed listing once. Existing and cancelled tasks remain authoritative. */
export function reconcileAnalysisTasks(hub: HubStore, jobs: JobStore): number {
  const analyst = hub.listAgents().find((agent) => agent.systemKey === 'job-search/requirements' && agent.status !== 'ended');
  if (!analyst) return 0;
  const assigned = new Set(hub.listTasks().filter((task) => task.agentId === analyst.id).map((task) => task.instruction));
  let created = 0;
  for (const job of jobs.list()) {
    if (job.analyzedAt || !job.description.trim() || assigned.has(job.id)) continue;
    hub.createTask({ agentId: analyst.id, instruction: job.id, priority: 2 });
    assigned.add(job.id); created++;
  }
  return created;
}

/** Built-in job roles perform source-backed actions; all other agents use their configured model. */
export async function runJobAction(task: HubTask, agent: HubAgent, deps: JobActionDeps): Promise<string | undefined> {
  if (agent.systemKey === 'job-search/researcher') {
    const found = await searchRemotive(deps.jobs, task.instruction, deps.fetcher ?? fetch);
    reconcileAnalysisTasks(deps.hub, deps.jobs);
    return `Pesquisa Remotive: ${found.added} vaga(s) nova(s) entre ${found.jobs.length} anúncio(s) válidos. Consulte Vagas encontradas para ver a origem e o link de cada uma.`;
  }
  if (agent.systemKey === 'job-search/requirements') {
    const job = await analyzeJob(deps.jobs, deps.profile, deps.router, task.instruction,
      agent.modelId ? undefined : 'ollama', agent.modelId);
    return `Análise de ${job.title} em ${job.company}: ${job.requirements.length} ${job.requirements.length === 1 ? 'requisito extraído' : 'requisitos extraídos'} do anúncio. ${job.justification}`;
  }
  return undefined;
}
