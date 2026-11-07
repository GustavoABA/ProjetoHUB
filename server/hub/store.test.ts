import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HubStore } from './store';

const dirs: string[] = [];
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-'));
  dirs.push(dir);
  return join(dir, 'state.json');
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

it('persists agents and tasks across restart, without inventing execution', () => {
  const file = fixture();
  const first = new HubStore(file);
  const agent = first.createAgent({ name: 'Pesquisa', objective: 'Encontrar vagas' });
  const task = first.createTask({ agentId: agent.id, instruction: 'Buscar vagas remotas' });
  expect(task.status).toBe('unassigned');
  const second = new HubStore(file);
  expect(second.listAgents()).toEqual([agent]);
  expect(second.listTasks()).toEqual([task]);
  expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);
});

it('persists a selected model for an agent without a Codex session and allows clearing it', () => {
  const file = fixture();
  const store = new HubStore(file);
  const modelId = '12345678-1234-1234-1234-123456789012';
  const agent = store.createAgent({ name: 'Analista', objective: 'Ler vagas', modelId });
  expect(new HubStore(file).agent(agent.id)?.modelId).toBe(modelId);
  expect(store.updateAgent(agent.id, { modelId: null }).modelId).toBeUndefined();
  expect(() => store.createAgent({ name: 'Inválido', objective: 'Teste', modelId: 'desconhecido' })).toThrow();
  expect(() => store.createAgent({ name: 'Inválido', objective: 'Teste', modelId,
    codexThread: '12345678-1234-1234-1234-123456789012', codexHome: 'C:/codex' })).toThrow('Codex');
});

it('does not resend a task whose dispatch may have happened before a crash', () => {
  const file = fixture();
  const store = new HubStore(file);
  const agent = store.createAgent({ name: 'Codex', objective: 'Analisar', codexThread: '12345678-1234-1234-1234-123456789012', codexHome: 'C:/codex' });
  const task = store.createTask({ agentId: agent.id, instruction: 'Analisar requisitos' });
  expect(task.status).toBe('queued');
  store.setTaskStatus(task.id, 'dispatching');
  const recovered = new HubStore(file);
  expect(recovered.listTasks()[0].status).toBe('interrupted');
});

it('keeps separate tasks independent and rejects invalid relationships', () => {
  const store = new HubStore(fixture());
  const parent = store.createAgent({ name: 'Principal', objective: 'Procurar emprego' });
  const sub = store.createAgent({ name: 'Pesquisador', objective: 'Vagas', parentId: parent.id });
  expect(sub.parentId).toBe(parent.id);
  expect(() => store.createAgent({ name: 'Órfão', objective: 'Vagas', parentId: 'missing' })).toThrow();
  expect(() => store.createTask({ agentId: 'missing', instruction: 'Buscar' })).toThrow();
  const one = store.createTask({ agentId: parent.id, instruction: 'Primeira' });
  const two = store.createTask({ agentId: sub.id, instruction: 'Segunda' });
  store.setTaskStatus(one.id, 'waiting_input');
  expect(store.listTasks().find((t) => t.id === two.id)?.status).toBe('unassigned');
});

it('installs the job-search team once as inactive configurations', () => {
  const path = fixture();
  const store = new HubStore(path);
  store.ensureJobSearchTeam();
  store.ensureJobSearchTeam();
  const agents = new HubStore(path).listAgents();
  expect(agents).toHaveLength(7);
  const main = agents.find((a) => a.name === 'Procura de Emprego');
  expect(main).toBeDefined();
  expect(agents.filter((a) => a.parentId === main!.id)).toHaveLength(6);
  expect(agents.every((a) => !a.codexThread)).toBe(true);
});

it('limits local availability retries and allows an explicit restart', () => {
  const file = fixture();
  const store = new HubStore(file);
  const agent = store.createAgent({ name: 'Local', objective: 'Analisar' });
  const task = store.createTask({ agentId: agent.id, instruction: 'Analisar vaga' });
  const now = Date.parse('2026-11-07T00:00:00Z');
  for (let attempt = 1; attempt <= 5; attempt++) {
    store.setTaskStatus(task.id, 'dispatching');
    const result = store.scheduleLocalRetry(task.id, 'offline', now);
    expect(result.localRetryCount).toBe(attempt);
    expect(result.status).toBe(attempt === 5 ? 'failed' : 'unassigned');
  }
  expect(new HubStore(file).listTasks()[0].status).toBe('failed');
  expect(store.retryTask(task.id)).toMatchObject({ status: 'unassigned' });
  expect(store.listTasks()[0].localRetryCount).toBeUndefined();
  expect(() => store.retryTask(task.id)).toThrow();
});
