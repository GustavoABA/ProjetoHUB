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
  systemKey?: string;
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
export interface HubQuestion {
  id: string;
  taskId: string;
  applicationId?: string;
  text: string;
  createdAt: string;
  state: 'pending' | 'answered';
  deadline?: string;
  answer?: string;
  answeredAt?: string;
  previousTaskStatus: TaskStatus;
}
interface State { version: 1; agents: HubAgent[]; tasks: HubTask[]; questions?: HubQuestion[] }
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
    this.state.questions ??= [];
    let changed = false;
    for (const task of this.state.tasks) {
      if (task.status === 'dispatching') { task.status = 'interrupted'; task.updatedAt = new Date().toISOString(); changed = true; }
    }
    if (changed) this.save();
  }

  listAgents(): HubAgent[] { return structuredClone(this.state.agents); }
  listTasks(): HubTask[] { return structuredClone(this.state.tasks); }
  listQuestions(): HubQuestion[] { return structuredClone(this.state.questions ?? []); }
  agent(id: string): HubAgent | undefined { const a = this.state.agents.find((v) => v.id === id); return a && structuredClone(a); }

  /** Default job team is configuration only; no session or activity is invented. */
  ensureJobSearchTeam(): void {
    const roles = [
      ['researcher', 'Pesquisador de vagas', 'Encontrar vagas em fontes autorizadas e registrar a origem.'],
      ['requirements', 'Analista de requisitos', 'Extrair requisitos sem inventar informações.'],
      ['compatibility', 'Avaliador de compatibilidade com currículo', 'Comparar requisitos com informações confirmadas do currículo.'],
      ['applications', 'Especialista em candidaturas', 'Preparar candidaturas e aguardar aprovação antes do envio.'],
      ['whatsapp', 'Comunicador WhatsApp', 'Comunicar pendências e resultados por canal configurado.'],
      ['history', 'Gerenciador de histórico e duplicatas', 'Evitar vagas e candidaturas duplicadas.'],
    ] as const;
    let changed = false;
    let main = this.state.agents.find((a) => a.systemKey === 'job-search');
    if (!main) {
      main = { id: randomUUID(), name: 'Procura de Emprego', objective: 'Pesquisar vagas, avaliar compatibilidade e preparar candidaturas autorizadas.', createdAt: new Date().toISOString(), systemKey: 'job-search' };
      this.state.agents.push(main);
      changed = true;
    }
    for (const [key, name, objective] of roles) {
      const systemKey = `job-search/${key}`;
      if (this.state.agents.some((a) => a.systemKey === systemKey)) continue;
      this.state.agents.push({ id: randomUUID(), name, objective, parentId: main.id, systemKey, createdAt: new Date().toISOString() });
      changed = true;
    }
    if (changed) this.save();
  }

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

  askQuestion(input: { taskId: string; text: string; applicationId?: string; deadline?: string }): HubQuestion {
    const task = this.state.tasks.find((t) => t.id === input.taskId);
    if (!task) throw new Error('Tarefa não encontrada');
    if (this.state.questions!.some((q) => q.taskId === task.id && q.state === 'pending')) throw new Error('Já existe pergunta pendente para esta tarefa');
    if (!['unassigned', 'queued', 'paused'].includes(task.status)) throw new Error('Tarefa não pode aguardar resposta neste estado');
    const text = required(input.text, 'pergunta', 2000);
    const applicationId = input.applicationId === undefined ? undefined : required(input.applicationId, 'candidatura', 100);
    let deadline: string | undefined;
    if (input.deadline !== undefined) {
      const parsed = Date.parse(input.deadline);
      if (!Number.isFinite(parsed) || parsed <= Date.now()) throw new Error('Prazo deve ser uma data futura');
      deadline = new Date(parsed).toISOString();
    }
    const question: HubQuestion = { id: randomUUID(), taskId: task.id, text, createdAt: new Date().toISOString(), state: 'pending', previousTaskStatus: task.status,
      ...(applicationId ? { applicationId } : {}), ...(deadline ? { deadline } : {}) };
    this.state.questions!.push(question);
    task.status = 'waiting_input'; task.updatedAt = question.createdAt;
    this.save(); return structuredClone(question);
  }

  answerQuestion(id: string, answerInput: string): HubQuestion {
    const question = this.state.questions!.find((q) => q.id === id);
    if (!question) throw new Error('Pergunta não encontrada');
    if (question.state !== 'pending') throw new Error('Pergunta já respondida');
    const answer = required(answerInput, 'resposta', 5000);
    const task = this.state.tasks.find((t) => t.id === question.taskId);
    if (!task || task.status !== 'waiting_input') throw new Error('Tarefa relacionada não está aguardando resposta');
    question.state = 'answered'; question.answer = answer; question.answeredAt = new Date().toISOString();
    task.status = question.previousTaskStatus; task.updatedAt = question.answeredAt;
    this.save(); return structuredClone(question);
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.file);
  }
}
