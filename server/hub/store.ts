import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Provider } from './router';

export type TaskStatus = 'unassigned' | 'queued' | 'dispatching' | 'sent' | 'waiting_input' | 'paused' | 'done' | 'result_ready' | 'failed' | 'interrupted' | 'cancelled';
export interface HubAgent {
  id: string;
  name: string;
  objective: string;
  parentId?: string;
  codexThread?: string;
  codexHome?: string;
  modelId?: string;
  createdAt: string;
  status?: 'active' | 'paused' | 'ended';
  systemKey?: string;
}
export interface HubTask {
  id: string;
  agentId: string;
  instruction: string;
  priority?: number;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  result?: string;
  executionProvider?: Provider;
  executionModel?: string;
  localRetryCount?: number;
  nextAttemptAt?: string;
}
export interface HubQuestion {
  id: string;
  taskId: string;
  applicationId?: string;
  text: string;
  createdAt: string;
  state: 'pending' | 'answered' | 'cancelled';
  deadline?: string;
  answer?: string;
  answeredAt?: string;
  sourceMessageId?: string;
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

  createAgent(input: { name: string; objective: string; parentId?: string; codexThread?: string; codexHome?: string; modelId?: string }): HubAgent {
    const name = required(input.name, 'nome', 100);
    const objective = required(input.objective, 'objetivo', 2000);
    if (input.parentId && (!this.agent(input.parentId) || this.agent(input.parentId)?.status === 'ended')) throw new Error('Agente principal não encontrado ou encerrado');
    if (!!input.codexThread !== !!input.codexHome) throw new Error('Sessão e pasta Codex devem ser informadas juntas');
    if (input.codexThread && !THREAD_ID.test(input.codexThread)) throw new Error('ID da sessão Codex inválido');
    if (input.modelId !== undefined && !THREAD_ID.test(input.modelId)) throw new Error('ID do modelo inválido');
    if (input.modelId && input.codexThread) throw new Error('Agente com sessão Codex usa Ollama como fallback; escolha um modelo apenas para agente sem Codex');
    const agent: HubAgent = { id: randomUUID(), name, objective, createdAt: new Date().toISOString(),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.codexThread ? { codexThread: input.codexThread, codexHome: input.codexHome } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}) };
    this.state.agents.push(agent);
    this.save();
    return structuredClone(agent);
  }

  createTask(input: { agentId: string; instruction: string; priority?: number }): HubTask {
    const agent = this.agent(input.agentId);
    if (!agent) throw new Error('Agente não encontrado');
    if (agent.status === 'ended') throw new Error('Agente encerrado não aceita novas tarefas');
    const instruction = required(input.instruction, 'instrução', 10000);
    const priority = input.priority ?? 3;
    if (!Number.isSafeInteger(priority) || priority < 1 || priority > 5) throw new Error('Prioridade deve ser um número inteiro de 1 a 5');
    const now = new Date().toISOString();
    const task: HubTask = { id: randomUUID(), agentId: agent.id, instruction, priority,
      status: agent.codexThread ? 'queued' : 'unassigned', createdAt: now, updatedAt: now };
    this.state.tasks.push(task);
    this.save();
    return structuredClone(task);
  }

  setTaskPriority(id: string, priority: number): HubTask {
    const task = this.state.tasks.find((item) => item.id === id);
    if (!task) throw new Error('Tarefa não encontrada');
    if (!['queued', 'unassigned', 'paused'].includes(task.status)) throw new Error('Prioridade só pode ser alterada antes do envio');
    if (!Number.isSafeInteger(priority) || priority < 1 || priority > 5) throw new Error('Prioridade deve ser um número inteiro de 1 a 5');
    task.priority = priority;
    task.updatedAt = new Date().toISOString();
    this.save(); return structuredClone(task);
  }

  setTaskStatus(id: string, status: TaskStatus, error?: string): HubTask {
    const task = this.state.tasks.find((v) => v.id === id);
    if (!task) throw new Error('Tarefa não encontrada');
    task.status = status;
    task.updatedAt = new Date().toISOString();
    delete task.nextAttemptAt;
    if (error) task.error = error;
    else delete task.error;
    this.save();
    return structuredClone(task);
  }

  scheduleLocalRetry(id: string, error: string, now = Date.now()): HubTask {
    const task = this.state.tasks.find((item) => item.id === id);
    if (!task || task.status !== 'dispatching') throw new Error('Tarefa não está em execução local');
    const attempt = (task.localRetryCount ?? 0) + 1;
    task.localRetryCount = attempt;
    task.updatedAt = new Date(now).toISOString();
    task.error = `Ollama: ${error}`.slice(0, 500);
    if (attempt >= 5) { task.status = 'failed'; delete task.nextAttemptAt; }
    else {
      task.status = this.agent(task.agentId)?.codexThread ? 'queued' : 'unassigned';
      task.nextAttemptAt = new Date(now + 15_000 * 2 ** (attempt - 1)).toISOString();
    }
    this.save();
    return structuredClone(task);
  }

  retryTask(id: string): HubTask {
    const task = this.state.tasks.find((item) => item.id === id);
    if (!task || !['failed', 'interrupted'].includes(task.status)) throw new Error('Tarefa não pode ser repetida neste estado');
    const agent = this.agent(task.agentId);
    if (!agent || agent.status === 'ended') throw new Error('Agente encerrado não aceita retomada');
    task.status = agent.codexThread ? 'queued' : 'unassigned';
    task.updatedAt = new Date().toISOString();
    delete task.error; delete task.nextAttemptAt; delete task.localRetryCount;
    this.save();
    return structuredClone(task);
  }

  recordLocalResult(id: string, text: string, model: string, provider: Provider = 'ollama'): HubTask {
    const task = this.state.tasks.find((v) => v.id === id);
    if (!task || task.status !== 'dispatching') throw new Error('Tarefa não está em execução local');
    if (!text.trim() || text.length > 50_000 || !model.trim() || model.length > 150) throw new Error('Resultado local inválido');
    if (!['openai', 'anthropic', 'gemini', 'deepseek', 'openrouter', 'ollama'].includes(provider)) throw new Error('Provedor de resultado inválido');
    task.result = text;
    task.executionProvider = provider;
    task.executionModel = model;
    task.status = 'result_ready';
    task.updatedAt = new Date().toISOString();
    delete task.error; delete task.nextAttemptAt;
    this.save();
    return structuredClone(task);
  }

  recordActionResult(id: string, text: string): HubTask {
    const task = this.state.tasks.find((item) => item.id === id);
    if (!task || task.status !== 'dispatching') throw new Error('Tarefa não está em execução');
    if (typeof text !== 'string' || !text.trim() || text.length > 5_000) throw new Error('Resultado da ação inválido');
    task.result = text;
    delete task.executionProvider; delete task.executionModel;
    task.status = 'done';
    task.updatedAt = new Date().toISOString();
    delete task.error; delete task.nextAttemptAt;
    this.save(); return structuredClone(task);
  }

  updateAgent(id: string, changes: { name?: string; objective?: string; modelId?: string | null }): HubAgent {
    const agent = this.state.agents.find((a) => a.id === id);
    if (!agent) throw new Error('Agente não encontrado');
    if (agent.status === 'ended') throw new Error('Agente encerrado não pode ser editado');
    const name = changes.name === undefined ? undefined : required(changes.name, 'nome', 100);
    const objective = changes.objective === undefined ? undefined : required(changes.objective, 'objetivo', 2000);
    if (changes.modelId !== undefined && changes.modelId !== null) {
      if (!THREAD_ID.test(changes.modelId)) throw new Error('ID do modelo inválido');
      if (agent.codexThread) throw new Error('Agente com sessão Codex usa Ollama como fallback');
    }
    if (name !== undefined) agent.name = name;
    if (objective !== undefined) agent.objective = objective;
    if (changes.modelId !== undefined) {
      if (changes.modelId === null) delete agent.modelId;
      else agent.modelId = changes.modelId;
    }
    this.save(); return structuredClone(agent);
  }

  setAgentStatus(id: string, status: 'active' | 'paused' | 'ended'): HubAgent {
    const agent = this.state.agents.find((a) => a.id === id);
    if (!agent) throw new Error('Agente não encontrado');
    if (agent.status === 'ended') throw new Error('Agente já encerrado');
    if (!['active', 'paused', 'ended'].includes(status)) throw new Error('Estado de agente inválido');
    agent.status = status;
    if (status === 'ended') {
      const now = new Date().toISOString();
      for (const task of this.state.tasks) {
        if (task.agentId !== id || !['queued', 'unassigned', 'waiting_input', 'paused'].includes(task.status)) continue;
        task.status = 'cancelled'; task.updatedAt = now;
        for (const question of this.state.questions ?? []) if (question.taskId === task.id && question.state === 'pending') question.state = 'cancelled';
      }
    }
    this.save(); return structuredClone(agent);
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

  answerQuestion(id: string, answerInput: string, sourceMessageId?: string): HubQuestion {
    const question = this.state.questions!.find((q) => q.id === id);
    if (!question) throw new Error('Pergunta não encontrada');
    if (question.state === 'answered' && sourceMessageId && question.sourceMessageId === sourceMessageId) return structuredClone(question);
    if (question.state !== 'pending') throw new Error('Pergunta já respondida');
    const answer = required(answerInput, 'resposta', 5000);
    const task = this.state.tasks.find((t) => t.id === question.taskId);
    if (!task || task.status !== 'waiting_input') throw new Error('Tarefa relacionada não está aguardando resposta');
    question.state = 'answered'; question.answer = answer; question.answeredAt = new Date().toISOString();
    if (sourceMessageId) question.sourceMessageId = sourceMessageId;
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
