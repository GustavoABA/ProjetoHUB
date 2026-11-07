import type { HubAgent, HubTask, HubStore } from './store';
import { searchRemotive, type JobStore } from './jobs';
import type { ProfileStore } from './profile';
import type { ModelRouter } from './router';
import type { ApplicationStore } from './applications';
import { analyzeJob, scoreJob } from './analysis';
import { searchGreenhouseBoards, type GreenhouseBoardStore } from './greenhouse';

export interface JobActionDeps {
  hub: HubStore;
  jobs: JobStore;
  profile: ProfileStore;
  router: Pick<ModelRouter, 'complete'>;
  applications?: ApplicationStore;
  fetcher?: typeof fetch;
  greenhouseBoards?: GreenhouseBoardStore;
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

/** One evaluation per vacancy and confirmed profile revision, including after a restart. */
export function reconcileCompatibilityTasks(hub: HubStore, jobs: JobStore, profile: ProfileStore): number {
  const candidate = profile.get();
  if (!candidate.confirmedAt) return 0;
  const evaluator = hub.listAgents().find((agent) => agent.systemKey === 'job-search/compatibility' && agent.status !== 'ended');
  if (!evaluator) return 0;
  const assigned = new Set(hub.listTasks().filter((task) => task.agentId === evaluator.id).map((task) => task.instruction));
  let created = 0;
  for (const job of jobs.list()) {
    if (!job.analyzedAt || job.profileRevision === candidate.revision) continue;
    const instruction = `${job.id}@${candidate.revision}`;
    if (assigned.has(instruction)) continue;
    hub.createTask({ agentId: evaluator.id, instruction, priority: 2 });
    assigned.add(instruction); created++;
  }
  return created;
}

/** Built-in job roles perform source-backed actions; all other agents use their configured model. */
export async function runJobAction(task: HubTask, agent: HubAgent, deps: JobActionDeps): Promise<string | undefined> {
  if (agent.systemKey === 'job-search/researcher') {
    const results: string[] = [];
    const errors: string[] = [];
    try {
      const found = await searchRemotive(deps.jobs, task.instruction, deps.fetcher ?? fetch);
      results.push(`Remotive: ${found.added} vaga(s) nova(s)`);
    } catch (error) { errors.push(`Remotive: ${error instanceof Error ? error.message : 'falha de consulta'}`); }
    if (deps.greenhouseBoards?.list().length) {
      try {
        const found = await searchGreenhouseBoards(deps.greenhouseBoards, deps.jobs, task.instruction, deps.fetcher ?? fetch);
        results.push(`Greenhouse: ${found.added} vaga(s) nova(s)`);
        errors.push(...found.errors.map(({ token, error }) => `Greenhouse ${token}: ${error}`));
      } catch (error) { errors.push(`Greenhouse: ${error instanceof Error ? error.message : 'falha de consulta'}`); }
    }
    if (!results.length) throw new Error(errors.join('; '));
    reconcileAnalysisTasks(deps.hub, deps.jobs);
    return `Pesquisa: ${results.join('; ')}. Consulte Vagas encontradas para ver a origem e o link de cada uma.${errors.length ? ` Falhas parciais: ${errors.join('; ')}.` : ''}`;
  }
  if (agent.systemKey === 'job-search/requirements') {
    const job = await analyzeJob(deps.jobs, deps.profile, deps.router, task.instruction,
      agent.modelId ? undefined : 'ollama', agent.modelId, true, agent.fallbackModelIds);
    reconcileCompatibilityTasks(deps.hub, deps.jobs, deps.profile);
    return `Análise de ${job.title} em ${job.company}: ${job.requirements.length} ${job.requirements.length === 1 ? 'requisito extraído' : 'requisitos extraídos'} do anúncio. ${job.justification}`;
  }
  if (agent.systemKey === 'job-search/compatibility') {
    const match = /^([0-9a-f-]{36})@([0-9a-f-]{36})$/i.exec(task.instruction);
    if (!match) throw new Error('Identificador de avaliação inválido');
    const candidate = deps.profile.get();
    if (!candidate.confirmedAt || candidate.revision !== match[2]) return 'Avaliação desatualizada: o perfil foi alterado ou perdeu a confirmação.';
    const job = scoreJob(deps.jobs, candidate, match[1]);
    return `Compatibilidade de ${job.title} em ${job.company}: ${job.compatibility === null ? 'indeterminada' : `${job.compatibility}%`}. ${job.justification}`;
  }
  if (agent.systemKey === 'job-search/applications') {
    if (!deps.applications) throw new Error('Candidaturas indisponíveis');
    const job = deps.jobs.list().find((entry) => entry.id === task.instruction);
    if (!job) throw new Error('Vaga não encontrada entre os anúncios salvos');
    const existing = deps.applications.list().find((app) => app.source === job.source && app.sourceId === job.sourceId);
    if (existing) return `Já existe candidatura ${existing.status} para ${job.title} em ${job.company}. Nenhum novo rascunho ou envio foi iniciado.`;
    deps.applications.create({ jobId: job.id, source: job.source, sourceId: job.sourceId,
      originalUrl: job.originalUrl, title: job.title, company: job.company });
    return `Rascunho criado para ${job.title} em ${job.company}. Revise e confirme respostas no painel antes de solicitar aprovação. Nenhum envio foi iniciado.`;
  }
  return undefined;
}
