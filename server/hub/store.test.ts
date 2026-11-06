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
