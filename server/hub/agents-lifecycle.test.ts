import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { HubStore } from './store';
import { dispatchNext } from './dispatcher';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-agent-life-')); dirs.push(dir);
  const file = join(dir, 'state.json'); const store = new HubStore(file);
  const agent = store.createAgent({ name: 'Agente', objective: 'Pesquisar', codexThread: '12345678-1234-1234-1234-123456789012', codexHome: 'C:/codex' });
  return { file, store, agent };
}

it('pauses and resumes an agent without delivering queued work while paused', async () => {
  const { file, store, agent } = setup(); const task = store.createTask({ agentId: agent.id, instruction: 'Buscar' });
  const runner = vi.fn(async () => ({ ok: true as const }));
  store.setAgentStatus(agent.id, 'paused');
  expect(await dispatchNext(store, runner)).toBeUndefined();
  expect(runner).not.toHaveBeenCalled();
  expect(store.listTasks()[0].status).toBe('queued');
  expect(new HubStore(file).agent(agent.id)?.status).toBe('paused');
  store.setAgentStatus(agent.id, 'active');
  await dispatchNext(store, runner);
  expect(runner).toHaveBeenCalledOnce();
  expect(store.listTasks()[0].id).toBe(task.id);
});

it('ends an agent and cancels only work not accepted by Codex', () => {
  const { store, agent } = setup();
  const pending = store.createTask({ agentId: agent.id, instruction: 'Pendente' });
  const accepted = store.createTask({ agentId: agent.id, instruction: 'Aceita' });
  store.setTaskStatus(accepted.id, 'sent');
  store.setAgentStatus(agent.id, 'ended');
  expect(store.listTasks().find((t) => t.id === pending.id)?.status).toBe('cancelled');
  expect(store.listTasks().find((t) => t.id === accepted.id)?.status).toBe('sent');
  expect(() => store.createTask({ agentId: agent.id, instruction: 'Nova' })).toThrow('encerrado');
  expect(() => store.setAgentStatus(agent.id, 'active')).toThrow('encerrado');
});

it('edits agent description while retaining its identity', () => {
  const { store, agent } = setup();
  expect(store.updateAgent(agent.id, { name: 'Agente novo', objective: 'Avaliar' })).toMatchObject({ id: agent.id, name: 'Agente novo', objective: 'Avaliar' });
});
