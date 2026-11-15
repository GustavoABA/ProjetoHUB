import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { evaluateJobPreferences, validateJobPreferences, type JobSearchPreferences } from './job-preferences';

export interface JobListing {
  id: string;
  source: 'Remotive' | 'Greenhouse' | 'Lever';
  sourceId: string;
  company: string;
  title: string;
  location: string;
  mode: 'remote' | 'hybrid' | 'onsite' | 'unspecified';
  salary?: string;
  description: string;
  requirements: string[];
  originalUrl: string;
  publishedAt?: string;
  discoveredAt: string;
  compatibility: number | null;
  justification: string;
  analysisModel?: string;
  analyzedAt?: string;
  profileRevision?: string;
  applicationStatus: 'not_started';
}
interface Attempt { at: string; ok: boolean }
export interface JobSchedule { query: string; intervalHours: 6 | 12 | 24; enabled: boolean; nextRunAt: string; lastRunAt?: string; lastError?: string }
interface State { version: 1; jobs: JobListing[]; attempts: Attempt[]; schedule?: JobSchedule; preferences?: Required<JobSearchPreferences> }

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function plainJobDescription(html: unknown): string {
  return text(html, 50_000)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(\d+);|&#x([0-9a-f]+);/gi, (entity, decimal: string, hex: string) => {
      const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const code = Number.parseInt(decimal || hex, decimal ? 10 : 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    })
    .replace(/\s+/g, ' ').trim().slice(0, 20_000);
}

function parseJob(raw: unknown, now: Date): JobListing | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const job = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(job.id) || Number(job.id) <= 0) return undefined;
  const title = text(job.title, 300), company = text(job.company_name, 300);
  if (!title || !company) return undefined;
  let url: URL;
  try { url = new URL(String(job.url)); } catch { return undefined; }
  if (url.protocol !== 'https:' || url.hostname !== 'remotive.com' || !url.pathname.startsWith('/remote-jobs/')) return undefined;
  const published = text(job.publication_date, 50);
  return {
    id: randomUUID(), source: 'Remotive', sourceId: String(job.id), title, company,
    location: text(job.candidate_required_location, 300) || 'Não informada', mode: 'remote',
    ...(text(job.salary, 200) ? { salary: text(job.salary, 200) } : {}),
    description: plainJobDescription(job.description), requirements: [], originalUrl: url.href,
    ...(published && Number.isFinite(Date.parse(published)) ? { publishedAt: new Date(published).toISOString() } : {}),
    discoveredAt: now.toISOString(), compatibility: null,
    justification: 'Avaliação pendente: currículo e requisitos ainda não analisados.', applicationStatus: 'not_started',
  };
}

export class JobStore {
  private state: State;
  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed as State).version !== 1 || !Array.isArray((parsed as State).jobs) || !Array.isArray((parsed as State).attempts)) throw new Error('Banco de vagas incompatível ou corrompido');
      this.state = parsed as State;
    } else this.state = { version: 1, jobs: [], attempts: [] };
  }
  list(): JobListing[] { return structuredClone(this.state.jobs); }
  preferences(): Required<JobSearchPreferences> { return structuredClone(this.state.preferences ?? validateJobPreferences({})); }
  configurePreferences(input: JobSearchPreferences): Required<JobSearchPreferences> {
    const preferences = validateJobPreferences(input);
    this.state.preferences = preferences;
    this.save();
    return structuredClone(preferences);
  }
  analyzed(id: string, result: { requirements: string[]; compatibility: number | null; justification: string; analysisModel: string; profileRevision?: string }): JobListing {
    const job = this.state.jobs.find((entry) => entry.id === id);
    if (!job) throw new Error('Vaga não encontrada');
    job.requirements = result.requirements;
    job.compatibility = result.compatibility;
    job.justification = result.justification;
    job.analysisModel = result.analysisModel;
    job.analyzedAt = new Date().toISOString();
    if (result.profileRevision) job.profileRevision = result.profileRevision;
    else delete job.profileRevision;
    this.save(); return structuredClone(job);
  }
  scored(id: string, result: { compatibility: number | null; justification: string; profileRevision: string }): JobListing {
    const job = this.state.jobs.find((entry) => entry.id === id);
    if (!job?.analyzedAt) throw new Error('Vaga ainda não analisada');
    if (result.compatibility !== null && (!Number.isInteger(result.compatibility) || result.compatibility < 0 || result.compatibility > 100)) throw new Error('Compatibilidade inválida');
    if (!result.profileRevision || !result.justification.trim()) throw new Error('Avaliação incompleta');
    job.compatibility = result.compatibility;
    job.justification = result.justification;
    job.profileRevision = result.profileRevision;
    this.save(); return structuredClone(job);
  }
  schedule(): JobSchedule | undefined { return this.state.schedule && structuredClone(this.state.schedule); }
  configure(input: { query: string; intervalHours: number; enabled: boolean }, now: Date = new Date()): JobSchedule {
    const query = input.query?.trim();
    if (!query || query.length > 100) throw new Error('Pesquisa deve conter de 1 a 100 caracteres');
    if (input.intervalHours !== 6 && input.intervalHours !== 12 && input.intervalHours !== 24) throw new Error('Intervalo deve ser 6, 12 ou 24 horas');
    if (typeof input.enabled !== 'boolean') throw new Error('Ativação inválida');
    this.state.schedule = { query, intervalHours: input.intervalHours, enabled: input.enabled, nextRunAt: now.toISOString() };
    this.save();
    return this.schedule()!;
  }
  claimScheduled(now: Date): JobSchedule | undefined {
    const schedule = this.state.schedule;
    if (!schedule?.enabled || Date.parse(schedule.nextRunAt) > now.getTime()) return undefined;
    schedule.nextRunAt = new Date(now.getTime() + schedule.intervalHours * 3_600_000).toISOString();
    schedule.lastRunAt = now.toISOString();
    delete schedule.lastError;
    this.save();
    return structuredClone(schedule);
  }
  scheduledError(message: string): void {
    if (!this.state.schedule) return;
    this.state.schedule.lastError = message.slice(0, 500);
    this.save();
  }
  searchesToday(now: Date): number { return this.state.attempts.filter((a) => a.ok && a.at.slice(0, 10) === now.toISOString().slice(0, 10)).length; }
  attemptsToday(now: Date): number { return this.state.attempts.filter((a) => a.at.slice(0, 10) === now.toISOString().slice(0, 10)).length; }
  begin(now: Date): number {
    if (this.attemptsToday(now) >= 4) throw new Error('Limite diário de quatro consultas à Remotive atingido');
    this.state.attempts.push({ at: now.toISOString(), ok: false });
    this.save();
    return this.state.attempts.length - 1;
  }
  finish(index: number, jobs: JobListing[]): number {
    const added = this.insert(jobs);
    this.state.attempts[index].ok = true;
    this.save();
    return added;
  }
  addListings(jobs: JobListing[]): number {
    const added = this.insert(jobs);
    if (added) this.save();
    return added;
  }
  private insert(jobs: JobListing[]): number {
    let added = 0;
    for (const job of jobs) {
      if (this.state.jobs.some((old) => old.source === job.source && old.sourceId === job.sourceId)) continue;
      this.state.jobs.push(job); added++;
    }
    return added;
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.file);
  }
}

export async function searchRemotive(store: JobStore, query: string, fetcher: typeof fetch = fetch, now: Date = new Date()): Promise<{ added: number; jobs: JobListing[] }> {
  const search = query.trim();
  if (!search || search.length > 100) throw new Error('Pesquisa deve conter de 1 a 100 caracteres');
  const index = store.begin(now);
  const url = new URL('https://remotive.com/api/remote-jobs');
  url.searchParams.set('search', search);
  url.searchParams.set('limit', '100');
  const response = await fetcher(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', 'User-Agent': 'ProjetoHUB/0.1 (+https://github.com/GustavoABA/ProjetoHUB)' } });
  if (!response.ok) throw new Error(`Remotive respondeu HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !Array.isArray((body as { jobs?: unknown }).jobs)) throw new Error('Resposta de vagas inválida');
  const preferences = store.preferences();
  const jobs = (body as { jobs: unknown[] }).jobs.map((v) => parseJob(v, now)).filter((v): v is JobListing => !!v)
    .filter((job) => evaluateJobPreferences(job, preferences).eligible);
  const added = store.finish(index, jobs);
  return { added, jobs };
}

/** Claims next run before I/O so a restart or overlapping timer never floods the source. */
export async function runScheduledSearch(store: JobStore, fetcher: typeof fetch = fetch, now: Date = new Date()): Promise<boolean> {
  const schedule = store.claimScheduled(now);
  if (!schedule) return false;
  try { await searchRemotive(store, schedule.query, fetcher, now); }
  catch (error) { store.scheduledError(error instanceof Error ? error.message : 'Falha na pesquisa agendada'); }
  return true;
}
