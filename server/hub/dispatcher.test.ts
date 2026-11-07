import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HubStore } from './store';
import { dispatchNext, dispatchWithLocalFallback } from './dispatcher';
import { ModelRouter } from './router';

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

it('dispatches higher priority first while retaining creation order for ties', async () => {
  const { store, agent } = fixture();
  const normal = store.createTask({ agentId: agent.id, instruction: 'Normal', priority: 3 });
  const urgent = store.createTask({ agentId: agent.id, instruction: 'Urgente', priority: 5 });
  const nextUrgent = store.createTask({ agentId: agent.id, instruction: 'Outra urgente', priority: 5 });
  const sent: string[] = [];
  const runner = async (job: { text: string }) => { sent.push(job.text); return { ok: true as const }; };
  await dispatchWithLocalFallback(store, runner, async () => ({ text: 'local', model: 'local' }));
  await dispatchWithLocalFallback(store, runner, async () => ({ text: 'local', model: 'local' }));
  await dispatchWithLocalFallback(store, runner, async () => ({ text: 'local', model: 'local' }));
  expect(sent).toEqual(['Urgente', 'Outra urgente', 'Normal']);
  expect(store.listTasks().find((task) => task.id === normal.id)?.status).toBe('sent');
  expect(store.listTasks().find((task) => task.id === urgent.id)?.status).toBe('sent');
  expect(store.listTasks().find((task) => task.id === nextUrgent.id)?.status).toBe('sent');
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

it('passes an agent model selection to execution and records the provider that actually answered', async () => {
  const { store } = fixture();
  const modelId = '12345678-1234-1234-1234-123456789013';
  const agent = store.createAgent({ name: 'Analista', objective: 'Analisar vaga', modelId });
  const task = store.createTask({ agentId: agent.id, instruction: 'Resuma' });
  const selected: string[] = [];
  await dispatchWithLocalFallback(store, undefined, async (_instruction, _objective, requestedModelId) => {
    selected.push(requestedModelId ?? '');
    return { text: 'Resposta externa para revisão', model: 'chosen-model', provider: 'deepseek' };
  });
  expect(selected).toEqual([modelId]);
  expect(store.listTasks().find((item) => item.id === task.id)).toMatchObject({ status: 'result_ready', executionProvider: 'deepseek', executionModel: 'chosen-model' });
});

it('falls back only for a recognized Codex availability error', async () => {
  const { store, agent } = fixture();
  const task = store.createTask({ agentId: agent.id, instruction: 'Analise' });
  await dispatchWithLocalFallback(store, async () => ({ ok: false, error: 'Codex offline' }), async () => ({ text: 'Análise local', model: 'qwen2.5:1.5b' }));
  expect(store.listTasks().find((item) => item.id === task.id)).toMatchObject({ status: 'result_ready', executionProvider: 'ollama' });
});

it('keeps Codex as the primary executor when its queue accepts the instruction', async () => {
  const { store, agent } = fixture();
  const task = store.createTask({ agentId: agent.id, instruction: 'Analise' });
  let localCalls = 0;
  await dispatchWithLocalFallback(store, async () => ({ ok: true }), async () => {
    localCalls++;
    return { text: 'Resposta local', model: 'local' };
  });
  expect(localCalls).toBe(0);
  expect(store.listTasks().find((item) => item.id === task.id)?.status).toBe('sent');
});

it.each(['no rollout found for thread id', 'não consegui rodar o Codex (codex.exe)', 'o codex queue falhou (código ENOENT)'])(
  'uses local Ollama when the Codex session cannot be opened: %s', async (error) => {
    const { store, agent } = fixture();
    const task = store.createTask({ agentId: agent.id, instruction: 'Analise' });
    await dispatchWithLocalFallback(store, async () => ({ ok: false, error }), async () => ({ text: 'Resposta local', model: 'local' }));
    expect(store.listTasks().find((item) => item.id === task.id)).toMatchObject({ status: 'result_ready', executionProvider: 'ollama' });
  },
);

it('does not duplicate work after an ambiguous Codex queue timeout', async () => {
  const { store, agent } = fixture();
  const task = store.createTask({ agentId: agent.id, instruction: 'Analise' });
  let localCalls = 0;
  await dispatchWithLocalFallback(store, async () => ({ ok: false, error: 'o codex queue não respondeu em 20 s (a mensagem pode ter entrado na fila mesmo assim)' }), async () => {
    localCalls++;
    return { text: 'Resposta local', model: 'local' };
  });
  expect(localCalls).toBe(0);
  expect(store.listTasks().find((item) => item.id === task.id)?.status).toBe('failed');
});

it('backs off after a temporary Ollama outage and keeps other tasks moving', async () => {
  const { store, agent } = fixture();
  const first = store.createTask({ agentId: agent.id, instruction: 'Primeira' });
  const second = store.createTask({ agentId: agent.id, instruction: 'Segunda' });
  const now = Date.parse('2026-11-07T00:00:00Z');
  await dispatchWithLocalFallback(store, undefined, async () => { throw new Error('Ollama offline'); }, now);
  expect(store.listTasks().find((item) => item.id === first.id)).toMatchObject({ status: 'queued', localRetryCount: 1 });
  expect(new HubStore(join(dirs[0], 'state.json')).listTasks().find((item) => item.id === first.id)?.nextAttemptAt).toBeDefined();
  await dispatchWithLocalFallback(store, undefined, async () => ({ text: 'Outra resposta', model: 'local' }), now + 1_000);
  expect(store.listTasks().find((item) => item.id === second.id)?.status).toBe('result_ready');
  await dispatchWithLocalFallback(store, undefined, async () => ({ text: 'Recuperado', model: 'local' }), now + 16_000);
  expect(store.listTasks().find((item) => item.id === first.id)).toMatchObject({ status: 'result_ready', result: 'Recuperado' });
});

it('keeps a task for an unavailable selected model queued while another agent runs', async () => {
  const { store } = fixture();
  const unavailable = store.createAgent({ name: 'Modelo externo', objective: 'Pesquisa', modelId: '00000000-0000-4000-8000-000000000001' });
  const available = store.createAgent({ name: 'Local', objective: 'Pesquisa' });
  const waiting = store.createTask({ agentId: unavailable.id, instruction: 'Primeira' });
  const running = store.createTask({ agentId: available.id, instruction: 'Segunda' });
  let calls = 0;
  await dispatchWithLocalFallback(store, undefined, async () => { calls++; return { text: 'OK', model: 'local' }; }, Date.now(),
    (agent) => agent.id === available.id);
  expect(calls).toBe(1);
  expect(store.listTasks().find((task) => task.id === waiting.id)?.status).toBe('unassigned');
  expect(store.listTasks().find((task) => task.id === running.id)?.status).toBe('result_ready');
});

it('does not retry a nonavailability Ollama error automatically', async () => {
  const { store, agent } = fixture();
  const task = store.createTask({ agentId: agent.id, instruction: 'Primeira' });
  await dispatchWithLocalFallback(store, undefined, async () => { throw new Error('Resposta inválida'); });
  expect(store.listTasks().find((item) => item.id === task.id)?.status).toBe('failed');
});

it('retries the actual router result after an Ollama HTTP 503', async () => {
  const { store, agent } = fixture();
  const task = store.createTask({ agentId: agent.id, instruction: 'Analise' });
  const router = new ModelRouter(join(dirs[0], 'router.json'), async () => new Response('', { status: 503 }));
  router.add({ provider: 'ollama', model: 'local-test', priority: 1 });
  await dispatchWithLocalFallback(store, undefined, async (instruction) => {
    const result = await router.complete([{ role: 'user', content: instruction }], 'ollama');
    return { text: result.text, model: result.model };
  });
  expect(store.listTasks().find((item) => item.id === task.id)).toMatchObject({ status: 'queued', localRetryCount: 1 });
});
