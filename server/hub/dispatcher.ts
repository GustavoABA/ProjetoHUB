import type { CodexQueueRunner } from '../messages/codex';
import type { HubStore, HubTask } from './store';

/** One delivery attempt. `sent` means Codex accepted the queue request, not that work finished. */
function due(task: HubTask, now: number): boolean { return !task.nextAttemptAt || Date.parse(task.nextAttemptAt) <= now; }
function transientLocal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /offline|unavailable|indisponível|timeout|timed out|connection|ECONNREFUSED|fetch failed|Todos os modelos disponíveis falharam|Nenhum modelo disponível/i.test(message);
}

export async function dispatchNext(store: HubStore, runner: CodexQueueRunner, now = Date.now()): Promise<HubTask | undefined> {
  const task = store.listTasks().find((t) => t.status === 'queued' && due(t, now) && store.agent(t.agentId)?.status !== 'paused' && store.agent(t.agentId)?.status !== 'ended');
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

/** Local text fallback is separate from Codex delivery and never reports external actions as complete. */
export async function dispatchWithLocalFallback(store: HubStore, runner: CodexQueueRunner | undefined,
  local: (instruction: string, objective: string) => Promise<{ text: string; model: string }>, now = Date.now()): Promise<HubTask | undefined> {
  const task = store.listTasks().find((t) => (t.status === 'queued' || t.status === 'unassigned') &&
    due(t, now) && !['paused', 'ended'].includes(store.agent(t.agentId)?.status ?? 'active'));
  if (!task) return undefined;
  const agent = store.agent(task.agentId);
  if (!agent) return store.setTaskStatus(task.id, 'failed', 'Agente não encontrado');
  if (runner && agent.codexThread && agent.codexHome) {
    store.setTaskStatus(task.id, 'dispatching');
    try {
      const delivery = await runner({ thread: agent.codexThread, codexHome: agent.codexHome, text: task.instruction });
      if (delivery.ok) return store.setTaskStatus(task.id, 'sent');
      if (!/offline|unavailable|not found|not running|connection|closed|timeout|não encontrado|indisponível/i.test(delivery.error ?? ''))
        return store.setTaskStatus(task.id, 'failed', delivery.error);
    } catch (error) {
      if (!/offline|unavailable|not found|not running|connection|closed|timeout|não encontrado|indisponível/i.test(error instanceof Error ? error.message : ''))
        return store.setTaskStatus(task.id, 'failed', error instanceof Error ? error.message : 'Falha no Codex');
    }
  } else store.setTaskStatus(task.id, 'dispatching');
  try {
    const answer = await local(task.instruction, agent.objective);
    return store.recordLocalResult(task.id, answer.text, answer.model);
  } catch (error) {
    if (transientLocal(error)) return store.scheduleLocalRetry(task.id, error instanceof Error ? error.message : 'falha de comunicação', now);
    return store.setTaskStatus(task.id, 'failed', `Ollama: ${error instanceof Error ? error.message : 'falha de execução local'}`);
  }
}
