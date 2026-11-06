import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type ApplicationStatus = 'draft' | 'awaiting_approval' | 'approved';
export interface Application {
  id: string;
  jobId: string;
  source: string;
  sourceId: string;
  originalUrl: string;
  title: string;
  company: string;
  status: ApplicationStatus;
  /** Values entered or confirmed by the user. No generated professional claims. */
  answers: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  history: { at: string; action: 'created' | 'answers_changed' | 'approval_requested' | 'approved' | 'denied' }[];
}
interface State { version: 1; applications: Application[] }
function clean(value: string, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} deve conter de 1 a ${max} caracteres`);
  return value.trim();
}

export class ApplicationStore {
  private state: State;
  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed as State).version !== 1 || !Array.isArray((parsed as State).applications)) throw new Error('Candidaturas incompatíveis ou corrompidas');
      this.state = parsed as State;
    } else this.state = { version: 1, applications: [] };
  }
  list(): Application[] { return structuredClone(this.state.applications); }
  get(id: string): Application | undefined { const app = this.state.applications.find((a) => a.id === id); return app && structuredClone(app); }
  private find(id: string): Application {
    const app = this.state.applications.find((a) => a.id === id);
    if (!app) throw new Error('Candidatura não encontrada');
    return app;
  }
  create(input: { jobId: string; source: string; sourceId: string; originalUrl: string; title: string; company: string }): Application {
    const jobId = clean(input.jobId, 'ID da vaga', 100);
    const source = clean(input.source, 'fonte', 100);
    const sourceId = clean(input.sourceId, 'ID na fonte', 100);
    const title = clean(input.title, 'cargo', 300);
    const company = clean(input.company, 'empresa', 300);
    let link: URL;
    try { link = new URL(input.originalUrl); } catch { throw new Error('URL original inválida'); }
    if (link.protocol !== 'https:' || link.username || link.password || (source === 'Remotive' && link.hostname !== 'remotive.com')) throw new Error('URL original inválida');
    if (this.state.applications.some((a) => a.source === source && a.sourceId === sourceId)) throw new Error('Já existe candidatura para esta vaga');
    const now = new Date().toISOString();
    const app: Application = { id: randomUUID(), jobId, source, sourceId, originalUrl: link.href, title, company,
      status: 'draft', answers: {}, createdAt: now, updatedAt: now, history: [{ at: now, action: 'created' }] };
    this.state.applications.push(app); this.save(); return structuredClone(app);
  }
  setAnswers(id: string, input: Record<string, string>): Application {
    const app = this.find(id);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 50) throw new Error('Respostas inválidas');
    const answers: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!/^[\p{L}\p{N}_ .-]{1,100}$/u.test(key) || /\b(senha|password|token|secret|chave de api)\b/i.test(key)) throw new Error('Nome de campo inválido ou credencial não permitida');
      answers[key] = clean(value, 'resposta', 5000);
    }
    app.answers = answers; app.status = 'draft'; delete app.approvedAt;
    app.updatedAt = new Date().toISOString(); app.history.push({ at: app.updatedAt, action: 'answers_changed' });
    this.save(); return structuredClone(app);
  }
  requestApproval(id: string): Application {
    const app = this.find(id);
    if (app.status !== 'draft') throw new Error('Candidatura não está em rascunho');
    if (!Object.keys(app.answers).length) throw new Error('É necessária ao menos uma resposta confirmada pelo usuário');
    app.status = 'awaiting_approval'; app.updatedAt = new Date().toISOString(); app.history.push({ at: app.updatedAt, action: 'approval_requested' });
    this.save(); return structuredClone(app);
  }
  approve(id: string): Application {
    const app = this.find(id);
    if (app.status !== 'awaiting_approval') throw new Error('Candidatura não está aguardando aprovação');
    app.status = 'approved'; app.approvedAt = app.updatedAt = new Date().toISOString(); app.history.push({ at: app.updatedAt, action: 'approved' });
    this.save(); return structuredClone(app);
  }
  deny(id: string): Application {
    const app = this.find(id);
    if (app.status !== 'awaiting_approval') throw new Error('Candidatura não está aguardando aprovação');
    app.status = 'draft'; app.updatedAt = new Date().toISOString(); app.history.push({ at: app.updatedAt, action: 'denied' });
    this.save(); return structuredClone(app);
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.file);
  }
}
