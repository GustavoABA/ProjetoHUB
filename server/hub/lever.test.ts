import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { JobStore } from './jobs';
import { LeverBoardStore, registerLeverBoard, searchLeverBoards } from './lever';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-lever-')); dirs.push(dir);
  return { dir, boards: new LeverBoardStore(join(dir, 'boards.json')), jobs: new JobStore(join(dir, 'jobs.json')) };
}
const posting = (id: string, title = 'Assistente administrativo') => ({ id, text: title, hostedUrl: `https://jobs.lever.co/empresa/${id}`,
  categories: { location: 'São Paulo, Brasil' }, workplaceType: 'hybrid',
  descriptionPlain: 'Atendimento ao cliente.', lists: [{ text: 'Requisitos', content: '<li>Excel</li>' }],
  salaryDescriptionPlain: 'R$ 2.500 mensais' });

it('registers only a verified public Lever site and persists the administrator supplied company name', async () => {
  const { dir, boards } = fixture();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([posting('abc')]), { status: 200 }));
  expect(await registerLeverBoard(boards, 'https://jobs.lever.co/empresa', 'Empresa informada', fetcher)).toMatchObject({
    site: 'empresa', region: 'global', company: 'Empresa informada',
  });
  expect(fetcher.mock.calls[0][0]).toBe('https://api.lever.co/v0/postings/empresa?mode=json&limit=1');
  expect(new LeverBoardStore(join(dir, 'boards.json')).list()).toHaveLength(1);
  await expect(registerLeverBoard(boards, 'https://jobs.lever.co/empresa', 'Empresa informada', fetcher)).rejects.toThrow('já cadastrada');
});

it('rejects other hosts, embedded credentials and unverified sites', async () => {
  const { boards } = fixture();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('not found', { status: 404 }));
  await expect(registerLeverBoard(boards, 'https://evil.example/empresa', 'Empresa', fetcher)).rejects.toThrow();
  await expect(registerLeverBoard(boards, 'https://user:pass@jobs.lever.co/empresa', 'Empresa', fetcher)).rejects.toThrow();
  await expect(registerLeverBoard(boards, 'https://jobs.lever.co/empresa', 'Empresa', fetcher)).rejects.toThrow('404');
  expect(boards.list()).toEqual([]);
  expect(fetcher).toHaveBeenCalledOnce();
});

it('searches sourced listings, preserves explicit mode and salary, and deduplicates after restart', async () => {
  const { dir, boards, jobs } = fixture();
  boards.addVerified('empresa', 'global', 'Empresa informada');
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify([
    posting('abc'), { ...posting('def', 'Engenheiro'), hostedUrl: 'http://127.0.0.1/private' },
  ]), { status: 200 }));
  const result = await searchLeverBoards(boards, jobs, 'assistente', fetcher);
  expect(result).toMatchObject({ added: 1, errors: [] });
  expect(jobs.list()).toMatchObject([{ source: 'Lever', sourceId: 'global:empresa:abc', company: 'Empresa informada',
    title: 'Assistente administrativo', mode: 'hybrid', salary: 'R$ 2.500 mensais',
    originalUrl: 'https://jobs.lever.co/empresa/abc', description: 'Atendimento ao cliente. Requisitos Excel' }]);
  expect((await searchLeverBoards(boards, jobs, 'assistente', fetcher)).added).toBe(0);
  expect(new JobStore(join(dir, 'jobs.json')).list()).toHaveLength(1);
});

it('uses the EU endpoint and continues when a separate site fails', async () => {
  const { boards, jobs } = fixture();
  boards.addVerified('broken', 'global', 'Empresa A'); boards.addVerified('europe', 'eu', 'Empresa B');
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).includes('/broken?')
    ? new Response('', { status: 503 })
    : new Response(JSON.stringify([{ ...posting('eu1'), hostedUrl: 'https://jobs.eu.lever.co/europe/eu1' }]), { status: 200 }));
  const result = await searchLeverBoards(boards, jobs, 'assistente', fetcher);
  expect(result).toMatchObject({ added: 1, errors: [{ site: 'broken' }] });
  expect(fetcher.mock.calls[1][0]).toBe('https://api.eu.lever.co/v0/postings/europe?mode=json&limit=100&skip=0');
  expect(jobs.list()).toMatchObject([{ sourceId: 'eu:europe:eu1' }]);
});

it('applies saved preferences and does not keep a partial site after pagination fails', async () => {
  const { boards, jobs } = fixture();
  boards.addVerified('empresa', 'global', 'Empresa');
  jobs.configurePreferences({ title: 'Assistente', location: 'São Paulo', modes: ['hybrid'] });
  const firstPage = Array.from({ length: 100 }, (_, index) => posting(String(index)));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(firstPage), { status: 200 }))
    .mockResolvedValueOnce(new Response('', { status: 503 }));
  await expect(searchLeverBoards(boards, jobs, 'assistente', fetcher)).rejects.toThrow('Nenhuma página Lever respondeu');
  expect(jobs.list()).toEqual([]);
  expect(boards.list()[0].lastError).toContain('503');
});
