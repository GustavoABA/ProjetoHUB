import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { evaluateJobPreferences } from './job-preferences';
import { plainJobDescription, type JobListing, type JobStore } from './jobs';

export type LeverRegion = 'global' | 'eu';
export interface LeverBoard { site: string; region: LeverRegion; company: string; createdAt: string; lastSearchedAt?: string; lastError?: string }
type State = { version: 1; boards: LeverBoard[] };
const SITE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;
const LIMIT = 100;
const MAX_PAGES = 20;

function boardAddress(input: string): { site: string; region: LeverRegion } {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Endereço Lever inválido'); }
  const region = url.hostname === 'jobs.lever.co' ? 'global' : url.hostname === 'jobs.eu.lever.co' ? 'eu' : undefined;
  const path = url.pathname.split('/').filter(Boolean);
  if (!region || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    path.length !== 1 || !SITE.test(path[0])) throw new Error('Use o endereço público da página Lever');
  return { site: path[0], region };
}
function apiUrl(board: Pick<LeverBoard, 'site' | 'region'>, limit: number, skip?: number): string {
  const host = board.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
  return `https://${host}/v0/postings/${encodeURIComponent(board.site)}?mode=json&limit=${limit}${skip === undefined ? '' : `&skip=${skip}`}`;
}
function clean(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function postingUrl(value: unknown, board: LeverBoard): string | undefined {
  let url: URL;
  try { url = new URL(String(value)); } catch { return undefined; }
  const host = board.region === 'eu' ? 'jobs.eu.lever.co' : 'jobs.lever.co';
  const path = url.pathname.split('/').filter(Boolean);
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password ||
    path.length !== 2 || path[0].toLowerCase() !== board.site.toLowerCase() || !SITE.test(path[1])) return undefined;
  url.search = ''; url.hash = '';
  return url.href;
}
function parseJob(raw: unknown, board: LeverBoard, now: Date): JobListing | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  const id = clean(item.id, 100), title = clean(item.text, 300), originalUrl = postingUrl(item.hostedUrl, board);
  if (!id || !SITE.test(id) || !title || !originalUrl) return undefined;
  const categories = item.categories && typeof item.categories === 'object' ? item.categories as Record<string, unknown> : {};
  const location = clean(categories.location, 300) || 'Não informada';
  const workplaceType = clean(item.workplaceType, 30);
  const mode = workplaceType === 'remote' ? 'remote' : workplaceType === 'hybrid' ? 'hybrid'
    : workplaceType === 'on-site' ? 'onsite' : 'unspecified';
  const lists = Array.isArray(item.lists) ? item.lists.slice(0, 30).map((value) => {
    const list = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return `${clean(list.text, 200)} ${clean(list.content, 20_000)}`;
  }).join(' ') : '';
  const description = plainJobDescription(`${clean(item.descriptionPlain, 40_000)} ${lists} ${clean(item.additionalPlain, 10_000)}`);
  const salary = plainJobDescription(item.salaryDescriptionPlain).slice(0, 200);
  return { id: randomUUID(), source: 'Lever', sourceId: `${board.region}:${board.site}:${id}`, company: board.company,
    title, location, mode, ...(salary ? { salary } : {}), description, requirements: [], originalUrl,
    discoveredAt: now.toISOString(), compatibility: null,
    justification: 'Avaliação pendente: currículo e requisitos ainda não analisados.', applicationStatus: 'not_started' };
}

export class LeverBoardStore {
  private state: State;
  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed as State).version !== 1 || !Array.isArray((parsed as State).boards))
        throw new Error('Páginas Lever incompatíveis ou corrompidas');
      this.state = parsed as State;
    } else this.state = { version: 1, boards: [] };
  }
  list(): LeverBoard[] { return structuredClone(this.state.boards); }
  addVerified(site: string, region: LeverRegion, company: string): LeverBoard {
    if (!SITE.test(site) || !['global', 'eu'].includes(region) || !company?.trim() || company.trim().length > 300)
      throw new Error('Página Lever inválida');
    if (this.state.boards.some((board) => board.site.toLowerCase() === site.toLowerCase() && board.region === region))
      throw new Error('Página Lever já cadastrada');
    const board = { site, region, company: company.trim(), createdAt: new Date().toISOString() };
    this.state.boards.push(board); this.save(); return structuredClone(board);
  }
  remove(site: string, region: LeverRegion): boolean {
    const before = this.state.boards.length;
    this.state.boards = this.state.boards.filter((board) => !(board.site === site && board.region === region));
    if (before !== this.state.boards.length) this.save();
    return before !== this.state.boards.length;
  }
  recordSearch(site: string, region: LeverRegion, error?: string): void {
    const board = this.state.boards.find((item) => item.site === site && item.region === region);
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

/** Registration verifies the public Postings API. The company label comes from the administrator. */
export async function registerLeverBoard(store: LeverBoardStore, input: string, company: string,
  fetcher: typeof fetch = fetch): Promise<LeverBoard> {
  const board = boardAddress(input);
  if (store.list().some((item) => item.site.toLowerCase() === board.site.toLowerCase() && item.region === board.region))
    throw new Error('Página Lever já cadastrada');
  const response = await fetcher(apiUrl(board, 1), { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Lever respondeu HTTP ${response.status}`);
  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) throw new Error('Resposta da página Lever inválida');
  return store.addVerified(board.site, board.region, company);
}

/** Only configured sites are searched; a failed page never writes a partial result. */
export async function searchLeverBoards(store: LeverBoardStore, jobs: JobStore, query: string,
  fetcher: typeof fetch = fetch, now: Date = new Date()): Promise<{ added: number; jobs: JobListing[]; errors: { site: string; region: LeverRegion; error: string }[] }> {
  const search = query?.trim();
  if (!search || search.length > 100) throw new Error('Pesquisa deve conter de 1 a 100 caracteres');
  const boards = store.list();
  if (!boards.length) throw new Error('Cadastre ao menos uma página Lever');
  const normalized = search.toLocaleLowerCase('pt-BR');
  const found: JobListing[] = [], errors: { site: string; region: LeverRegion; error: string }[] = [];
  let added = 0, succeeded = 0;
  for (const board of boards) {
    try {
      const items: unknown[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await fetcher(apiUrl(board, LIMIT, page * LIMIT),
          { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', 'User-Agent': 'ProjetoHUB/0.1 (+https://github.com/GustavoABA/ProjetoHUB)' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw: unknown = await response.json();
        if (!Array.isArray(raw) || raw.length > LIMIT) throw new Error('Resposta de vagas Lever inválida ou excessiva');
        items.push(...raw);
        if (raw.length < LIMIT) break;
        if (page === MAX_PAGES - 1) throw new Error('Página Lever excede o limite de 2000 vagas por consulta');
      }
      const matching = items.map((item) => parseJob(item, board, now)).filter((item): item is JobListing => Boolean(item))
        .filter((item) => `${item.title} ${item.location} ${item.description}`.toLocaleLowerCase('pt-BR').includes(normalized))
        .filter((item) => evaluateJobPreferences(item, jobs.preferences()).eligible);
      added += jobs.addListings(matching); found.push(...matching); succeeded++;
      store.recordSearch(board.site, board.region);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao consultar página';
      errors.push({ site: board.site, region: board.region, error: message });
      store.recordSearch(board.site, board.region, message);
    }
  }
  if (!succeeded) throw new Error(`Nenhuma página Lever respondeu: ${errors.map((item) => `${item.site}: ${item.error}`).join('; ')}`);
  return { added, jobs: found, errors };
}
