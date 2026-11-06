import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface JobListing {
  id: string;
  source: 'Remotive';
  sourceId: string;
  company: string;
  title: string;
  location: string;
  mode: 'remote';
  salary?: string;
  description: string;
  requirements: string[];
  originalUrl: string;
  publishedAt?: string;
  discoveredAt: string;
  compatibility: number | null;
  justification: string;
  applicationStatus: 'not_started';
}
interface Attempt { at: string; ok: boolean }
interface State { version: 1; jobs: JobListing[]; attempts: Attempt[] }

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function plain(html: unknown): string {
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
    description: plain(job.description), requirements: [], originalUrl: url.href,
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
  searchesToday(now: Date): number { return this.state.attempts.filter((a) => a.ok && a.at.slice(0, 10) === now.toISOString().slice(0, 10)).length; }
  attemptsToday(now: Date): number { return this.state.attempts.filter((a) => a.at.slice(0, 10) === now.toISOString().slice(0, 10)).length; }
  begin(now: Date): number {
    if (this.attemptsToday(now) >= 4) throw new Error('Limite diário de quatro consultas à Remotive atingido');
    this.state.attempts.push({ at: now.toISOString(), ok: false });
    this.save();
    return this.state.attempts.length - 1;
  }
  finish(index: number, jobs: JobListing[]): number {
    let added = 0;
    for (const job of jobs) {
      if (this.state.jobs.some((old) => old.source === job.source && old.sourceId === job.sourceId)) continue;
      this.state.jobs.push(job); added++;
    }
    this.state.attempts[index].ok = true;
    this.save();
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
  const jobs = (body as { jobs: unknown[] }).jobs.map((v) => parseJob(v, now)).filter((v): v is JobListing => !!v);
  const added = store.finish(index, jobs);
  return { added, jobs };
}
