import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { JobStore } from './jobs';
import { GreenhouseBoardStore, registerGreenhouseBoard, searchGreenhouseBoards } from './greenhouse';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-greenhouse-')); dirs.push(dir);
  return { dir, boards: new GreenhouseBoardStore(join(dir, 'boards.json')), jobs: new JobStore(join(dir, 'jobs.json')) };
}
const boardReply = () => new Response(JSON.stringify({ name: 'Empresa Oficial' }), { status: 200 });
const jobsReply = () => new Response(JSON.stringify({ jobs: [
  { id: 101, internal_job_id: 201, title: 'Assistente administrativo', location: { name: 'Remote - Brazil' },
    content: '&lt;p&gt;Conhecimento em Excel.&lt;/p&gt;', absolute_url: 'https://job-boards.greenhouse.io/empresa/jobs/101' },
  { id: 102, internal_job_id: null, title: 'Candidatura espontânea', location: { name: 'Brazil' },
    content: 'Cadastre-se', absolute_url: 'https://job-boards.greenhouse.io/empresa/jobs/102' },
  { id: 103, internal_job_id: 203, title: 'Engenheiro', location: { name: 'São Paulo' },
    content: 'Software', absolute_url: 'https://job-boards.greenhouse.io/empresa/jobs/103' },
] }), { status: 200 });

it('registers a verified public company board and persists only sourced matching jobs', async () => {
  const { dir, boards, jobs } = fixture();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(boardReply()).mockResolvedValueOnce(jobsReply()).mockResolvedValueOnce(jobsReply());
  const board = await registerGreenhouseBoard(boards, 'https://job-boards.greenhouse.io/empresa', fetcher);
  expect(board).toMatchObject({ token: 'empresa', company: 'Empresa Oficial' });
  expect(fetcher.mock.calls[0][0]).toBe('https://boards-api.greenhouse.io/v1/boards/empresa');
  const result = await searchGreenhouseBoards(boards, jobs, 'assistente', fetcher);
  expect(fetcher.mock.calls[1][0]).toBe('https://boards-api.greenhouse.io/v1/boards/empresa/jobs?content=true');
  expect(result).toMatchObject({ added: 1, errors: [] });
  expect(result.jobs).toMatchObject([{ source: 'Greenhouse', sourceId: 'empresa:101', company: 'Empresa Oficial',
    title: 'Assistente administrativo', mode: 'remote', description: 'Conhecimento em Excel.',
    originalUrl: 'https://job-boards.greenhouse.io/empresa/jobs/101' }]);
  expect((await searchGreenhouseBoards(boards, jobs, 'assistente', fetcher)).added).toBe(0);
  expect(new JobStore(join(dir, 'jobs.json')).list()).toHaveLength(1);
  expect(new GreenhouseBoardStore(join(dir, 'boards.json')).list()[0].company).toBe('Empresa Oficial');
});

it('rejects arbitrary board URLs and unverified boards without storing them', async () => {
  const { boards } = fixture();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
  await expect(registerGreenhouseBoard(boards, 'https://evil.example/empresa', fetcher)).rejects.toThrow();
  await expect(registerGreenhouseBoard(boards, 'https://job-boards.greenhouse.io/empresa', fetcher)).rejects.toThrow('404');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(boards.list()).toEqual([]);
});

it('skips malformed links and keeps another registered board working after one fails', async () => {
  const { boards, jobs } = fixture();
  boards.addVerified('broken', 'Empresa A'); boards.addVerified('working', 'Empresa B');
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).includes('/broken/')
    ? new Response('', { status: 503 })
    : new Response(JSON.stringify({ jobs: [
      { id: 12, internal_job_id: 20, title: 'Suporte', location: { name: 'São Paulo' }, content: 'Atendimento', absolute_url: 'http://127.0.0.1/private' },
      { id: 13, internal_job_id: 21, title: 'Suporte', location: { name: 'São Paulo' }, content: '<p>Atendimento</p>', absolute_url: 'https://job-boards.greenhouse.io/working/jobs/13' },
    ] }), { status: 200 }));
  const result = await searchGreenhouseBoards(boards, jobs, 'suporte', fetcher);
  expect(result).toMatchObject({ added: 1, errors: [{ token: 'broken' }] });
  expect(jobs.list()).toMatchObject([{ sourceId: 'working:13', mode: 'unspecified' }]);
});
