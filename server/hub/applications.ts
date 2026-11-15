import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type ApplicationStatus = 'draft' | 'awaiting_approval' | 'approved' | 'submitting' | 'submission_uncertain' | 'submitted';
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
  submission?: { attemptId: string; pageUrl: string; startedAt: string; confirmationText?: string; confirmedAt?: string; screenshotSha256?: string; evidenceFile?: string; error?: string };
  history: { at: string; action: 'created' | 'answers_changed' | 'approval_requested' | 'approved' | 'denied' | 'submission_started' | 'submission_uncertain' | 'submitted' }[];
}
interface State { version: 1; applications: Application[] }
function clean(value: string, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} deve conter de 1 a ${max} caracteres`);
  return value.trim();
}
function pageUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('URL da página inválida'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password) throw new Error('URL da página inválida');
  url.search = ''; url.hash = '';
  return url.href;
}

export class ApplicationStore {
  private state: State;
  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed as State).version !== 1 || !Array.isArray((parsed as State).applications)) throw new Error('Candidaturas incompatíveis ou corrompidas');
      this.state = parsed as State;
    } else this.state = { version: 1, applications: [] };
    let recovered = false;
    for (const app of this.state.applications) if (app.status === 'submitting') {
      app.status = 'submission_uncertain'; app.updatedAt = new Date().toISOString();
      app.history.push({ at: app.updatedAt, action: 'submission_uncertain' }); recovered = true;
    }
    if (recovered) this.save();
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
    if (['submitting', 'submission_uncertain', 'submitted'].includes(app.status)) throw new Error('Candidatura com envio iniciado não pode ser editada');
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
  startSubmission(id: string, currentPageUrl: string): Application {
    const app = this.find(id);
    if (app.status !== 'approved') throw new Error('Envio exige aprovação explícita e ausência de tentativa anterior');
    const now = new Date().toISOString();
    app.status = 'submitting'; app.updatedAt = now;
    app.submission = { attemptId: randomUUID(), pageUrl: pageUrl(currentPageUrl), startedAt: now };
    app.history.push({ at: now, action: 'submission_started' }); this.save(); return structuredClone(app);
  }
  markSubmissionUncertain(id: string, reason: string): Application {
    const app = this.find(id);
    if (app.status !== 'submitting' || !app.submission) throw new Error('Não há envio em andamento');
    app.status = 'submission_uncertain'; app.updatedAt = new Date().toISOString();
    app.submission.error = clean(reason, 'motivo', 500);
    app.history.push({ at: app.updatedAt, action: 'submission_uncertain' }); this.save(); return structuredClone(app);
  }
  confirmSubmission(id: string, evidence: { url: string; confirmationText: string; screenshot: Buffer }): Application {
    const app = this.find(id);
    if (!['submitting', 'submission_uncertain'].includes(app.status) || !app.submission) throw new Error('Não há tentativa de envio para confirmar');
    const url = pageUrl(evidence.url);
    const confirmationText = clean(evidence.confirmationText, 'confirmação', 500);
    if (!Buffer.isBuffer(evidence.screenshot) || evidence.screenshot.length < 8 || evidence.screenshot.length > 10_000_000 ||
        !evidence.screenshot.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Captura PNG de evidência inválida');
    const evidenceDir = join(dirname(this.file), 'application-evidence');
    mkdirSync(evidenceDir, { recursive: true });
    const filename = `${app.id}-${app.submission.attemptId}.png`;
    writeFileSync(join(evidenceDir, filename), evidence.screenshot, { mode: 0o600 });
    app.status = 'submitted'; app.updatedAt = new Date().toISOString();
    app.submission.pageUrl = url; app.submission.confirmationText = confirmationText; app.submission.confirmedAt = app.updatedAt;
    app.submission.screenshotSha256 = createHash('sha256').update(evidence.screenshot).digest('hex');
    app.submission.evidenceFile = filename; delete app.submission.error;
    app.history.push({ at: app.updatedAt, action: 'submitted' }); this.save(); return structuredClone(app);
  }
  evidence(id: string): Buffer {
    const app = this.find(id);
    const name = app.submission?.evidenceFile;
    if (app.status !== 'submitted' || !name || !/^[0-9a-f-]{36}-[0-9a-f-]{36}\.png$/i.test(name) || !name.startsWith(`${app.id}-`)) throw new Error('Evidência de envio não encontrada');
    const png = readFileSync(join(dirname(this.file), 'application-evidence', name));
    if (createHash('sha256').update(png).digest('hex') !== app.submission?.screenshotSha256) throw new Error('Evidência de envio corrompida');
    return png;
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.file);
  }
}
