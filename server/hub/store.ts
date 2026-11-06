import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type TaskStatus = 'unassigned' | 'queued' | 'dispatching' | 'sent' | 'waiting_input' | 'paused' | 'done' | 'failed' | 'interrupted';
export interface HubAgent {
  id: string;
  name: string;
  objective: string;
  parentId?: string;
  codexThread?: string;
  codexHome?: string;
  createdAt: string;
}
export interface HubTask {
  id: string;
  agentId: string;
  instruction: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
}
interface State { version: 1; agents: HubAgent[]; tasks: HubTask[] }
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function required(value: string, label: string, max: number): string {
  const clean = value?.trim();
  if (!clean || clean.length > max) throw new Error(`${label} deve conter de 1 a ${max} caracteres`);
  return clean;
}

/** Local state for ProjectHUB; never merges fabricated agents into Habblaud World. */
export class HubStore {
  private state: State;
  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed as State).version !== 1 || !Array.isArray((parsed as State).agents) || !Array.isArray((parsed as State).tasks)) {
        throw new Error('Estado do ProjetoHUB incompatível ou corrompido');
      }
      this.state = parsed as State;
    } else this.state = { version: 1, agents: [], tasks: [] };
    let changed = false;
    for (const task of this.state.tasks) {
      if (task.status === 'dispatching') { task.status = 'interrupted'; task.updatedAt = new Date().toISOString(); changed = true; }
    }
    if (changed) this.save();
  }

  listAgents(): HubAgent[] { return structuredClone(this.state.agents); }
  listTasks(): HubTask[] { return structuredClone(this.state.tasks); }
  agent(id: string): HubAgent | undefined { const a = this.state.agents.find((v) => v.id === id); return a && structuredClone(a); }

  createAgent(input: { name: string; objective: string; parentId?: string; codexThread?: string; codexHome?: string }): HubAgent {
    const name = required(input.name, 'nome', 100);
    const objective = required(input.objective, 'objetivo', 2000);
    if (input.parentId && !this.agent(input.parentId)) throw new Error('Agente principal não encontrado');
    if (!!input.codexThread !== !!input.codexHome) throw new Error('Sessão e pasta Codex devem ser informadas juntas');
    if (input.codexThread && !THREAD_ID.test(input.codexThread)) throw new Error('ID da sessão Codex inválido');
    const agent: HubAgent = { id: randomUUID(), name, objective, createdAt: new Date().toISOString(),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.codexThread ? { codexThread: input.codexThread, codexHome: input.codexHome } : {}) };
    this.state.agents.push(agent);
    this.save();
    return structuredClone(agent);
  }

  createTask(input: { agentId: string; instruction: string }): HubTask {
    const agent = this.agent(input.agentId);
    if (!agent) throw new Error('Agente não encontrado');
    const instruction = required(input.instruction, 'instrução', 10000);
    const now = new Date().toISOString();
    const task: HubTask = { id: randomUUID(), agentId: agent.id, instruction,
      status: agent.codexThread ? 'queued' : 'unassigned', createdAt: now, updatedAt: now };
    this.state.tasks.push(task);
    this.save();
    return structuredClone(task);
  }

  setTaskStatus(id: string, status: TaskStatus, error?: string): HubTask {
    const task = this.state.tasks.find((v) => v.id === id);
    if (!task) throw new Error('Tarefa não encontrada');
    task.status = status;
    task.updatedAt = new Date().toISOString();
    if (error) task.error = error;
    else delete task.error;
    this.save();
    return structuredClone(task);
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.file);
  }
}
