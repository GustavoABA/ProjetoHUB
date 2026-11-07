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

it('persists editable monthly AI limits for an agent and rejects invalid values', () => {
  const file = fixture(); const store = new HubStore(file);
  const agent = store.createAgent({ name: 'Triagem', objective: 'Analisar', monthlyAiRequestLimit: 12,
    monthlyAiCostLimitUsd: 3.5 });
  expect(new HubStore(file).agent(agent.id)).toMatchObject({ monthlyAiRequestLimit: 12, monthlyAiCostLimitUsd: 3.5 });
  expect(store.updateAgent(agent.id, { monthlyAiRequestLimit: 6, monthlyAiCostLimitUsd: null })).toMatchObject({ monthlyAiRequestLimit: 6 });
  expect(store.agent(agent.id)?.monthlyAiCostLimitUsd).toBeUndefined();
  expect(() => store.updateAgent(agent.id, { monthlyAiRequestLimit: 0 })).toThrow('Limite');
  expect(() => store.createAgent({ name: 'Inválido', objective: 'Analisar', monthlyAiCostLimitUsd: -1 })).toThrow('Limite');
  expect(new HubStore(file).agent(agent.id)?.monthlyAiRequestLimit).toBe(6);
});

it('persists task priority and rejects values outside the supported range', () => {
  const path = fixture(); const store = new HubStore(path);
  const agent = store.createAgent({ name: 'Pesquisa', objective: 'Vagas' });
  const urgent = store.createTask({ agentId: agent.id, instruction: 'Urgente', priority: 5 });
  expect(new HubStore(path).listTasks().find((task) => task.id === urgent.id)?.priority).toBe(5);
  expect(() => store.createTask({ agentId: agent.id, instruction: 'Inválida', priority: 0 })).toThrow('Prioridade');
  expect(() => store.createTask({ agentId: agent.id, instruction: 'Inválida', priority: 1.5 })).toThrow('Prioridade');
  expect(store.createTask({ agentId: agent.id, instruction: 'Padrão' }).priority).toBe(3);
  expect(store.setTaskPriority(urgent.id, 2).priority).toBe(2);
  expect(new HubStore(path).listTasks().find((task) => task.id === urgent.id)?.priority).toBe(2);
  expect(() => store.setTaskPriority(urgent.id, 6)).toThrow('Prioridade');
  store.setTaskStatus(urgent.id, 'dispatching');
  expect(() => store.setTaskPriority(urgent.id, 5)).toThrow('Prioridade');
});

it('records a verified external action separately from a model text result', () => {
  const path = fixture(); const store = new HubStore(path);
  const agent = store.createAgent({ name: 'Pesquisa', objective: 'Vagas' });
  const task = store.createTask({ agentId: agent.id, instruction: 'assistente' });
  store.setTaskStatus(task.id, 'dispatching');
  expect(store.recordActionResult(task.id, 'Remotive: 1 vaga nova.')).toMatchObject({ status: 'done', result: 'Remotive: 1 vaga nova.' });
  expect(new HubStore(path).listTasks().find((item) => item.id === task.id)).not.toHaveProperty('executionProvider');
  expect(() => store.recordActionResult(task.id, 'duplicado')).toThrow();
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

it('persists an ordered fallback chain and rejects conflicting or duplicate models', () => {
  const file = fixture(); const store = new HubStore(file);
  const primary = '12345678-1234-1234-1234-123456789011';
  const backup = '12345678-1234-1234-1234-123456789012';
  const second = '12345678-1234-1234-1234-123456789013';
  const agent = store.createAgent({ name: 'Triagem', objective: 'Analisar', modelId: primary,
    fallbackModelIds: [backup, second] });
  expect(new HubStore(file).agent(agent.id)?.fallbackModelIds).toEqual([backup, second]);
  expect(() => store.updateAgent(agent.id, { fallbackModelIds: [primary] })).toThrow();
  expect(() => store.updateAgent(agent.id, { fallbackModelIds: [backup, backup] })).toThrow();
  expect(store.agent(agent.id)?.fallbackModelIds).toEqual([backup, second]);
  expect(store.updateAgent(agent.id, { fallbackModelIds: [second] }).fallbackModelIds).toEqual([second]);
  expect(store.updateAgent(agent.id, { modelId: null, fallbackModelIds: [] }).fallbackModelIds).toBeUndefined();
  expect(() => store.createAgent({ name: 'Inválido', objective: 'Analisar', fallbackModelIds: [backup] })).toThrow();
});

it('links and unlinks an existing agent to Codex while preserving dispatch history', () => {
  const path = fixture(); const store = new HubStore(path);
  const agent = store.createAgent({ name: 'Pesquisador', objective: 'Vagas' });
  const pending = store.createTask({ agentId: agent.id, instruction: 'Pesquisar' });
  const thread = '12345678-1234-1234-1234-123456789012';
  expect(store.updateAgent(agent.id, { codexThread: thread, codexHome: 'C:/codex' }).codexThread).toBe(thread);
  expect(store.listTasks().find((task) => task.id === pending.id)?.status).toBe('queued');
  store.beginCodexDispatch(pending.id, thread);
  expect(() => store.updateAgent(agent.id, { codexThread: null, codexHome: null })).toThrow('andamento');
  store.setTaskStatus(pending.id, 'sent');
  expect(store.updateAgent(agent.id, { codexThread: null, codexHome: null }).codexThread).toBeUndefined();
  const recovered = new HubStore(path);
  expect(recovered.listTasks().find((task) => task.id === pending.id)).toMatchObject({ status: 'sent', codexAttemptThread: thread });
  expect(recovered.agent(agent.id)?.codexThread).toBeUndefined();
});

it('rejects incomplete Codex links and concurrent external model selections atomically', () => {
  const store = new HubStore(fixture());
  const modelId = '12345678-1234-1234-1234-123456789013';
  const agent = store.createAgent({ name: 'Analista', objective: 'Vagas', modelId });
  const thread = '12345678-1234-1234-1234-123456789012';
  expect(() => store.updateAgent(agent.id, { codexThread: thread })).toThrow();
  expect(() => store.updateAgent(agent.id, { codexThread: thread, codexHome: 'C:/codex' })).toThrow('modelo');
  expect(store.agent(agent.id)?.modelId).toBe(modelId);
  expect(store.agent(agent.id)?.codexThread).toBeUndefined();
  expect(store.updateAgent(agent.id, { modelId: null, codexThread: thread, codexHome: 'C:/codex' })).toMatchObject({ codexThread: thread, codexHome: 'C:/codex' });
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
