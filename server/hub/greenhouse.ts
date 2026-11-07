import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname } from 'node:path';
import { plainJobDescription, type JobListing, type JobStore } from './jobs';
import { evaluateJobPreferences } from './job-preferences';

export interface GreenhouseBoard { token: string; company: string; createdAt: string; lastSearchedAt?: string; lastError?: string }
type State = { version: 1; boards: GreenhouseBoard[] };
const API = 'https://boards-api.greenhouse.io/v1/boards';
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;

function boardToken(input: string): string {
  if (typeof input !== 'string') throw new Error('Endereço Greenhouse inválido');
  const raw = input.trim();
  if (TOKEN.test(raw)) return raw;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Endereço Greenhouse inválido'); }
  if (url.protocol !== 'https:' || !['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash) throw new Error('Use o endereço público do quadro Greenhouse');
  const path = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
  if (path.length !== 1 || !TOKEN.test(path[0])) throw new Error('Endereço Greenhouse inválido');
  return path[0];
}
function cleaned(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function publicHttpsLink(value: unknown): string | undefined {
  let url: URL;
  try { url = new URL(String(value)); } catch { return undefined; }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') ||
    url.hostname === 'localhost' || url.hostname === 'host.docker.internal' || isIP(url.hostname.replace(/^\[|\]$/g, ''))) return undefined;
  return url.href;
}
function parseJob(raw: unknown, board: GreenhouseBoard, now: Date): JobListing | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const job = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(job.id) || Number(job.id) <= 0 || job.internal_job_id === null) return undefined;
  const title = cleaned(job.title, 300), originalUrl = publicHttpsLink(job.absolute_url);
  if (!title || !originalUrl) return undefined;
  const location = cleaned((job.location as { name?: unknown } | undefined)?.name, 300) || 'Não informada';
  const description = plainJobDescription(plainJobDescription(job.content));
  const mode = /\bhybrid\b|\bhíbrido\b/i.test(location) ? 'hybrid'
    : /\bremote\b|\bremoto\b/i.test(location) ? 'remote'
      : /\bonsite\b|\bon-site\b|\bpresencial\b/i.test(location) ? 'onsite' : 'unspecified';
  return { id: randomUUID(), source: 'Greenhouse', sourceId: `${board.token}:${job.id}`, company: board.company,
    title, location, mode, description, requirements: [], originalUrl, discoveredAt: now.toISOString(),
    compatibility: null, justification: 'Avaliação pendente: currículo e requisitos ainda não analisados.',
    applicationStatus: 'not_started' };
}

export class GreenhouseBoardStore {
  private state: State;
  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed as State).version !== 1 || !Array.isArray((parsed as State).boards)) throw new Error('Quadros Greenhouse incompatíveis ou corrompidos');
      this.state = parsed as State;
    } else this.state = { version: 1, boards: [] };
  }
  list(): GreenhouseBoard[] { return structuredClone(this.state.boards); }
  addVerified(token: string, company: string): GreenhouseBoard {
    if (!TOKEN.test(token) || !company.trim() || company.length > 300) throw new Error('Quadro Greenhouse inválido');
    if (this.state.boards.some((item) => item.token.toLowerCase() === token.toLowerCase())) throw new Error('Quadro Greenhouse já cadastrado');
    const board = { token, company: company.trim(), createdAt: new Date().toISOString() };
    this.state.boards.push(board); this.save(); return structuredClone(board);
  }
  remove(token: string): boolean {
    const before = this.state.boards.length;
    this.state.boards = this.state.boards.filter((item) => item.token !== token);
    if (before !== this.state.boards.length) this.save();
    return before !== this.state.boards.length;
  }
  recordSearch(token: string, error?: string): void {
    const board = this.state.boards.find((item) => item.token === token);
    if (!board) return;
    board.lastSearchedAt = new Date().toISOString();
    if (error) board.lastError = error.slice(0, 300);
    else delete board.lastError;
    this.save();
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.file);
  }
}

/** Registration verifies the company's own public board before saving a token. */
export async function registerGreenhouseBoard(store: GreenhouseBoardStore, input: string, fetcher: typeof fetch = fetch): Promise<GreenhouseBoard> {
  const token = boardToken(input);
  if (store.list().some((item) => item.token.toLowerCase() === token.toLowerCase())) throw new Error('Quadro Greenhouse já cadastrado');
  const response = await fetcher(`${API}/${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Greenhouse respondeu HTTP ${response.status}`);
  const raw: unknown = await response.json();
  const company = cleaned((raw as { name?: unknown } | null)?.name, 300);
  if (!company) throw new Error('Quadro Greenhouse sem nome de empresa verificável');
  return store.addVerified(token, company);
}

/** Search only boards selected by the user; one failed board does not hide another's real jobs. */
export async function searchGreenhouseBoards(store: GreenhouseBoardStore, jobs: JobStore, query: string,
  fetcher: typeof fetch = fetch, now: Date = new Date()): Promise<{ added: number; jobs: JobListing[]; errors: { token: string; error: string }[] }> {
  const search = query?.trim();
  if (!search || search.length > 100) throw new Error('Pesquisa deve conter de 1 a 100 caracteres');
  const boards = store.list();
  if (!boards.length) throw new Error('Cadastre ao menos uma página Greenhouse');
  const normalized = search.toLocaleLowerCase('pt-BR');
  const found: JobListing[] = [], errors: { token: string; error: string }[] = [];
  let added = 0, succeeded = 0;
  for (const board of boards) {
    try {
      const response = await fetcher(`${API}/${encodeURIComponent(board.token)}/jobs?content=true`,
        { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', 'User-Agent': 'ProjetoHUB/0.1 (+https://github.com/GustavoABA/ProjetoHUB)' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw: unknown = await response.json();
      const items = (raw as { jobs?: unknown } | null)?.jobs;
      if (!Array.isArray(items) || items.length > 5000) throw new Error('Resposta de vagas inválida ou excessiva');
      const matching = items.map((item) => parseJob(item, board, now)).filter((item): item is JobListing => Boolean(item))
        .filter((item) => `${item.title} ${item.location} ${item.description}`.toLocaleLowerCase('pt-BR').includes(normalized))
        .filter((item) => evaluateJobPreferences(item, jobs.preferences()).eligible);
      added += jobs.addListings(matching); found.push(...matching); succeeded++;
      store.recordSearch(board.token);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao consultar quadro';
      errors.push({ token: board.token, error: message }); store.recordSearch(board.token, message);
    }
  }
  if (!succeeded) throw new Error(`Nenhuma página Greenhouse respondeu: ${errors.map((item) => `${item.token}: ${item.error}`).join('; ')}`);
  return { added, jobs: found, errors };
}
