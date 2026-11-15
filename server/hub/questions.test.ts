import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HubStore } from './store';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-questions-')); dirs.push(dir);
  const file = join(dir, 'state.json'); const store = new HubStore(file);
  const agent = store.createAgent({ name: 'Analista', objective: 'Avaliar vagas' });
  return { file, store, agent };
}

it('persists a question and pauses only its related task', () => {
  const { file, store, agent } = setup();
  const first = store.createTask({ agentId: agent.id, instruction: 'Analisar vaga A' });
  const second = store.createTask({ agentId: agent.id, instruction: 'Analisar vaga B' });
  const question = store.askQuestion({ taskId: first.id, text: 'Qual é sua experiência?', applicationId: 'candidatura-1' });
  expect(question).toMatchObject({ taskId: first.id, applicationId: 'candidatura-1', state: 'pending' });
  expect(store.listTasks().find((t) => t.id === first.id)?.status).toBe('waiting_input');
  expect(store.listTasks().find((t) => t.id === second.id)?.status).toBe('unassigned');
  expect(new HubStore(file).listQuestions()).toMatchObject([{ id: question.id, state: 'pending' }]);
});

it('records the answer once and resumes only the related task', () => {
  const { file, store, agent } = setup();
  const task = store.createTask({ agentId: agent.id, instruction: 'Verificar dados' });
  const question = store.askQuestion({ taskId: task.id, text: 'Autoriza?' });
  const answered = store.answerQuestion(question.id, 'Sim');
  expect(answered).toMatchObject({ state: 'answered', answer: 'Sim' });
  expect(answered.answeredAt).toBeTruthy();
  expect(store.listTasks()[0].status).toBe('unassigned');
  expect(new HubStore(file).listQuestions()[0].answer).toBe('Sim');
  expect(() => store.answerQuestion(question.id, 'Não')).toThrow('já respondida');
});

it('refuses a second pending question for the same task and invalid deadlines', () => {
  const { store, agent } = setup(); const task = store.createTask({ agentId: agent.id, instruction: 'Verificar' });
  expect(() => store.askQuestion({ taskId: task.id, text: 'Prazo?', deadline: 'ontem' })).toThrow('Prazo');
  store.askQuestion({ taskId: task.id, text: 'Primeira' });
  expect(() => store.askQuestion({ taskId: task.id, text: 'Segunda' })).toThrow('pendente');
});
