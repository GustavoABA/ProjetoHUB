import type { CodexQueueRunner } from '../messages/codex';
import type { HubStore, HubTask } from './store';

/** One delivery attempt. `sent` means Codex accepted the queue request, not that work finished. */
export async function dispatchNext(store: HubStore, runner: CodexQueueRunner): Promise<HubTask | undefined> {
  const task = store.listTasks().find((t) => t.status === 'queued' && store.agent(t.agentId)?.status !== 'paused' && store.agent(t.agentId)?.status !== 'ended');
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
