import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { TaskRuntime } from './task-runtime';
import { HubStore } from './store';
import { dispatchWithLocalFallback } from './dispatcher';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function file(): string { const dir = mkdtempSync(join(tmpdir(), 'projecthub-runtime-')); dirs.push(dir); return join(dir, 'execution.json'); }

it('limits simultaneous dispatches and persists the configured limit', async () => {
  const path = file();
  const gates: Array<() => void> = [];
  const runtime = new TaskRuntime(path, async () => new Promise<void>((resolve) => { gates.push(resolve); }));
  expect(runtime.status()).toMatchObject({ maxConcurrent: 1, active: 0 });
  expect(runtime.configure(2)).toMatchObject({ maxConcurrent: 2, active: 0 });
  const first = runtime.tick(); const second = runtime.tick(); const third = runtime.tick();
  expect(runtime.status().active).toBe(2);
  expect(gates).toHaveLength(2);
  await third;
  gates[0](); await first;
  expect(runtime.status().active).toBe(1);
  const fourth = runtime.tick(); expect(gates).toHaveLength(3);
  gates[1](); gates[2](); await Promise.all([second, fourth]);
  expect(runtime.status().active).toBe(0);
  expect(new TaskRuntime(path, async () => {}).status().maxConcurrent).toBe(2);
  expect(() => runtime.configure(0)).toThrow();
  expect(() => runtime.configure(5)).toThrow();
});

it('claims separate tasks before awaiting I/O so concurrent ticks cannot send one twice', async () => {
  const path = file(); const store = new HubStore(join(path, '..', 'state.json'));
  const agent = store.createAgent({ name: 'Codex', objective: 'Analisar', codexThread: '12345678-1234-1234-1234-123456789012', codexHome: 'C:/codex' });
  store.createTask({ agentId: agent.id, instruction: 'Primeira' });
  store.createTask({ agentId: agent.id, instruction: 'Segunda' });
  const sent: string[] = []; const gates: Array<() => void> = [];
  const runtime = new TaskRuntime(path, () => dispatchWithLocalFallback(store, async (job) => {
    sent.push(job.text);
    return new Promise<{ ok: true }>((resolve) => { gates.push(() => resolve({ ok: true })); });
  }, async () => ({ text: 'local', model: 'local' })));
  runtime.configure(2);
  const first = runtime.tick(); const second = runtime.tick(); const third = runtime.tick();
  expect(sent).toEqual(['Primeira', 'Segunda']);
  expect(runtime.status().active).toBe(2);
  await third;
  gates.forEach((resolve) => resolve()); await Promise.all([first, second]);
  expect(store.listTasks().map((task) => task.status)).toEqual(['sent', 'sent']);
  expect(runtime.status().active).toBe(0);
});
