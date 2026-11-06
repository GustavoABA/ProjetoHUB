import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HubStore } from './store';
import { dispatchNext, dispatchWithLocalFallback } from './dispatcher';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-dispatch-')); dirs.push(dir);
  const store = new HubStore(join(dir, 'state.json'));
  const agent = store.createAgent({ name: 'Codex', objective: 'Analisar', codexThread: '12345678-1234-1234-1234-123456789012', codexHome: 'C:/codex' });
  return { store, agent };
}

it('queues one real Codex instruction and records only delivery', async () => {
  const { store, agent } = fixture();
  const first = store.createTask({ agentId: agent.id, instruction: 'Primeira' });
  const second = store.createTask({ agentId: agent.id, instruction: 'Segunda' });
  const sent: string[] = [];
  await dispatchNext(store, async (job) => { sent.push(job.text); return { ok: true }; });
  expect(sent).toEqual(['Primeira']);
  expect(store.listTasks().find((t) => t.id === first.id)?.status).toBe('sent');
  expect(store.listTasks().find((t) => t.id === second.id)?.status).toBe('queued');
});

it('records failed delivery without claiming completion', async () => {
  const { store, agent } = fixture();
  const task = store.createTask({ agentId: agent.id, instruction: 'Falha' });
  await dispatchNext(store, async () => ({ ok: false, error: 'offline' }));
  expect(store.listTasks().find((t) => t.id === task.id)).toMatchObject({ status: 'failed', error: 'offline' });
});

it('uses Ollama when Codex is offline and persists a reviewable text result', async () => {
  const { store, agent } = fixture();
  const task = store.createTask({ agentId: agent.id, instruction: 'Resuma esta vaga' });
  const calls: string[] = [];
  await dispatchWithLocalFallback(store, undefined, async (instruction, objective) => {
    calls.push(`${objective}: ${instruction}`);
    return { text: 'Resumo local', model: 'qwen2.5:1.5b' };
  });
  expect(calls).toEqual(['Analisar: Resuma esta vaga']);
  expect(new HubStore(join(dirs[0], 'state.json')).listTasks().find((item) => item.id === task.id)).toMatchObject({
    status: 'result_ready', result: 'Resumo local', executionProvider: 'ollama', executionModel: 'qwen2.5:1.5b',
  });
});

it('falls back only for a recognized Codex availability error', async () => {
  const { store, agent } = fixture();
  const task = store.createTask({ agentId: agent.id, instruction: 'Analise' });
  await dispatchWithLocalFallback(store, async () => ({ ok: false, error: 'Codex offline' }), async () => ({ text: 'Análise local', model: 'qwen2.5:1.5b' }));
  expect(store.listTasks().find((item) => item.id === task.id)).toMatchObject({ status: 'result_ready', executionProvider: 'ollama' });
});
