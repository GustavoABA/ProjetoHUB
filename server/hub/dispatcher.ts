import type { CodexQueueRunner } from '../messages/codex';
import type { HubStore, HubTask, HubAgent } from './store';
import type { Provider } from './router';

/** One delivery attempt. `sent` means Codex accepted the queue request, not that work finished. */
function due(task: HubTask, now: number): boolean { return !task.nextAttemptAt || Date.parse(task.nextAttemptAt) <= now; }
function prioritized(store: HubStore): HubTask[] { return store.listTasks().sort((a, b) => (b.priority ?? 3) - (a.priority ?? 3)); }
function transientLocal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /offline|unavailable|indisponível|timeout|timed out|connection|ECONNREFUSED|fetch failed|Todos os modelos disponíveis falharam/i.test(message);
}
function codexUnavailable(error: string): boolean {
  // Queue timeouts are ambiguous: Codex may have accepted the instruction already.
  if (/timeout|timed out|não respondeu|pode ter entrado na fila/i.test(error)) return false;
  return /offline|unavailable|not found|no rollout found|not running|connection|closed|não encontrado|indisponível|não consegui rodar o Codex|código (ENOENT|EACCES)/i.test(error);
}

export async function dispatchNext(store: HubStore, runner: CodexQueueRunner, now = Date.now()): Promise<HubTask | undefined> {
  const task = prioritized(store).find((t) => t.status === 'queued' && due(t, now) && store.agent(t.agentId)?.status !== 'paused' && store.agent(t.agentId)?.status !== 'ended');
  if (!task) return undefined;
  const agent = store.agent(task.agentId);
  if (!agent?.codexThread || !agent.codexHome) return store.setTaskStatus(task.id, 'failed', 'Sessão Codex não configurada');
  store.setTaskStatus(task.id, 'dispatching');
  try {
    const result = await runner({ thread: agent.codexThread, codexHome: agent.codexHome, text: task.instruction });
    return result.ok ? store.setTaskStatus(task.id, 'sent') : store.setTaskStatus(task.id, 'failed', result.error);
  } catch (error) {
    return store.setTaskStatus(task.id, 'failed', error instanceof Error ? error.message : 'Falha de envio');
  }
}

/** Codex delivery, a verified orchestrator action, or a text-only model result. */
export async function dispatchWithLocalFallback(store: HubStore, runner: CodexQueueRunner | undefined,
  local: (instruction: string, objective: string, modelId?: string) => Promise<{ text: string; model: string; provider?: Provider }>,
  now = Date.now(), eligible: (agent: HubAgent) => boolean = () => true,
  action?: (task: HubTask, agent: HubAgent) => Promise<string | undefined>): Promise<HubTask | undefined> {
  const task = prioritized(store).find((t) => (t.status === 'queued' || t.status === 'unassigned') &&
    due(t, now) && !['paused', 'ended'].includes(store.agent(t.agentId)?.status ?? 'active') &&
    Boolean(store.agent(t.agentId) && eligible(store.agent(t.agentId)!)));
  if (!task) return undefined;
  const agent = store.agent(task.agentId);
  if (!agent) return store.setTaskStatus(task.id, 'failed', 'Agente não encontrado');
  if (runner && agent.codexThread && agent.codexHome) {
    store.setTaskStatus(task.id, 'dispatching');
    try {
      const delivery = await runner({ thread: agent.codexThread, codexHome: agent.codexHome, text: task.instruction });
      if (delivery.ok) return store.setTaskStatus(task.id, 'sent');
      if (!codexUnavailable(delivery.error ?? ''))
        return store.setTaskStatus(task.id, 'failed', delivery.error);
    } catch (error) {
      if (!codexUnavailable(error instanceof Error ? error.message : ''))
        return store.setTaskStatus(task.id, 'failed', error instanceof Error ? error.message : 'Falha no Codex');
    }
  } else store.setTaskStatus(task.id, 'dispatching');
  if (action) {
    try {
      const result = await action(task, agent);
      if (result !== undefined) return store.recordActionResult(task.id, result);
    } catch (error) {
      if (transientLocal(error)) return store.scheduleLocalRetry(task.id, error instanceof Error ? error.message : 'falha de comunicação', now, 'Ação');
      return store.setTaskStatus(task.id, 'failed', `Ação: ${error instanceof Error ? error.message : 'falha de execução'}`);
    }
  }
  try {
    const answer = await local(task.instruction, agent.objective, agent.codexThread ? undefined : agent.modelId);
    return store.recordLocalResult(task.id, answer.text, answer.model, answer.provider ?? 'ollama');
  } catch (error) {
    if (transientLocal(error)) return store.scheduleLocalRetry(task.id, error instanceof Error ? error.message : 'falha de comunicação', now);
    return store.setTaskStatus(task.id, 'failed', `Modelo: ${error instanceof Error ? error.message : 'falha de execução'}`);
  }
}
