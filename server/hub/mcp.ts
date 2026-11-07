import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';
import type { HubStore } from './store';
import type { JobStore } from './jobs';
import type { ApplicationStore } from './applications';
import type { ModelRouter } from './router';

export class AdminKeyStore {
  private hash: string | undefined;
  private readonly rotationListeners = new Set<() => void>();
  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { version?: number; hash?: string };
      if (raw.version !== 1 || !/^[0-9a-f]{64}$/.test(raw.hash ?? '')) throw new Error('Credencial MCP local inválida');
      this.hash = raw.hash;
    }
  }
  configured(): boolean { return Boolean(this.hash); }
  rotate(): string {
    const key = `phub_${randomBytes(32).toString('hex')}`;
    const hash = createHash('sha256').update(key).digest('hex');
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, hash }, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
    this.hash = hash;
    for (const listener of this.rotationListeners) listener();
    return key;
  }
  onRotate(listener: () => void): () => void { this.rotationListeners.add(listener); return () => this.rotationListeners.delete(listener); }
  verify(key: string): boolean {
    if (!this.hash || !/^phub_[0-9a-f]{64}$/.test(key)) return false;
    return timingSafeEqual(Buffer.from(this.hash, 'hex'), createHash('sha256').update(key).digest());
  }
}

export interface McpDependencies { hub: HubStore; jobs: JobStore; applications: ApplicationStore; router: ModelRouter; keys: AdminKeyStore; allowedHosts: string[] }
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

export function createMcpRequestHandler(deps: McpDependencies): (req: IncomingMessage, res: ServerResponse) => void {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'projecthub-office', version: '0.1.0' });
    const tool = <T extends z.ZodObject<z.ZodRawShape>>(name: string, description: string, schema: T, run: (args: z.infer<T>) => unknown) => {
      const register = server.registerTool.bind(server) as unknown as (name: string, config: { description: string; inputSchema: T }, cb: (args: z.infer<T>) => Promise<ReturnType<typeof result>>) => void;
      register(name, { description, inputSchema: schema }, async (args) => result(run(args)));
    };
    tool('listar_agentes', 'Lista agentes configurados e seus estados reais.', z.object({}), () => deps.hub.listAgents());
    tool('criar_agente', 'Cria um agente ou subagente.', z.object({ nome: z.string(), objetivo: z.string(), agentePaiId: z.string().optional() }),
      ({ nome, objetivo, agentePaiId }) => deps.hub.createAgent({ name: nome, objective: objetivo, parentId: agentePaiId }));
    tool('atualizar_agente', 'Altera nome, objetivo ou vínculo Codex do agente. Sessão e pasta devem ser enviadas juntas; null em ambas desvincula.',
      z.object({ id: z.string(), nome: z.string().optional(), objetivo: z.string().optional(),
        sessaoCodex: z.string().nullable().optional(), pastaCodex: z.string().nullable().optional() }),
      ({ id, nome, objetivo, sessaoCodex, pastaCodex }) => deps.hub.updateAgent(id, { name: nome, objective: objetivo,
        codexThread: sessaoCodex, codexHome: pastaCodex }));
    tool('encerrar_agente', 'Encerra o agente e cancela tarefas ainda não entregues.', z.object({ id: z.string() }),
      ({ id }) => deps.hub.setAgentStatus(id, 'ended'));
    tool('criar_tarefa', 'Cria uma tarefa para um agente, com prioridade opcional de 1 a 5. A entrega ao Codex depende de sessão vinculada.', z.object({ agenteId: z.string(), instrucao: z.string(), prioridade: z.number().int().min(1).max(5).optional() }),
      ({ agenteId, instrucao, prioridade }) => deps.hub.createTask({ agentId: agenteId, instruction: instrucao, priority: prioridade }));
    tool('consultar_tarefas', 'Lista tarefas e estados persistidos.', z.object({}), () => deps.hub.listTasks());
    tool('pausar_tarefa', 'Pausa uma tarefa ainda não entregue ao Codex.', z.object({ id: z.string() }), ({ id }) => {
      const task = deps.hub.listTasks().find((t) => t.id === id);
      if (!task || !['queued', 'unassigned'].includes(task.status)) throw new Error('Tarefa não pode ser pausada neste estado');
      return deps.hub.setTaskStatus(id, 'paused');
    });
    tool('retomar_tarefa', 'Retoma uma tarefa pausada.', z.object({ id: z.string() }), ({ id }) => {
      const task = deps.hub.listTasks().find((t) => t.id === id);
      if (!task || task.status !== 'paused') throw new Error('Tarefa não está pausada');
      return deps.hub.setTaskStatus(id, deps.hub.agent(task.agentId)?.codexThread ? 'queued' : 'unassigned');
    });
    tool('listar_vagas', 'Lista vagas com URL e fonte originais.', z.object({}), () => deps.jobs.list());
    tool('consultar_candidaturas', 'Lista rascunhos e aprovações; aprovação não significa envio.', z.object({}), () => deps.applications.list());
    tool('solicitar_relatorio', 'Resumo dos registros reais do escritório.', z.object({}), () => {
      const agents = deps.hub.listAgents(), tasks = deps.hub.listTasks(), questions = deps.hub.listQuestions();
      return { agents: agents.length, tasks: tasks.length, tasksByStatus: Object.fromEntries([...new Set(tasks.map((t) => t.status))].map((status) => [status, tasks.filter((t) => t.status === status).length])),
        jobs: deps.jobs.list().length, applications: deps.applications.list().length, pendingQuestions: questions.filter((q) => q.state === 'pending').length };
    });
    tool('consultar_roteador', 'Mostra modelos, disponibilidade de credenciais e uso registrado, sem segredos.', z.object({}), () => deps.router.status());
    tool('consultar_notificacoes_pendentes', 'Mostra perguntas pendentes que exigem intervenção.', z.object({}),
      () => deps.hub.listQuestions().filter((q) => q.state === 'pending'));
    return server;
  }, { legacy: 'stateless' });
  const node = toNodeHandler(handler);
  return (req, res) => {
    const path = req.url?.split('?')[0];
    if (path === '/health' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"service":"projecthub-mcp","ok":true}'); return; }
    if (path !== '/mcp') { res.writeHead(404); res.end(); return; }
    const host = req.headers.host?.split(':')[0]?.toLowerCase();
    const allowed = new Set(deps.allowedHosts.map((h) => h.toLowerCase()));
    let originHost: string | undefined;
    if (req.headers.origin) { try { originHost = new URL(req.headers.origin).hostname.toLowerCase(); } catch { res.writeHead(403); res.end(); return; } }
    if (!host || !allowed.has(host) || (originHost && !allowed.has(originHost))) { res.writeHead(403); res.end(); return; }
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ') || !deps.keys.verify(auth.slice(7))) {
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="projecthub-mcp"' });
      res.end('{"error":"autenticação necessária"}'); return;
    }
    void node(req, res).catch(() => { if (!res.headersSent) { res.writeHead(500); res.end(); } else res.destroy(); });
  };
}

export function startMcpServer(deps: McpDependencies, port: number): Server {
  const server = createServer(createMcpRequestHandler(deps));
  server.listen(port, '127.0.0.1');
  return server;
}
