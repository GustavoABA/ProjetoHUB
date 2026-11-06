import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { JobStore, searchRemotive } from './jobs';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function file() { const dir = mkdtempSync(join(tmpdir(), 'projecthub-jobs-')); dirs.push(dir); return join(dir, 'jobs.json'); }
const payload = { jobs: [{ id: 101, url: 'https://remotive.com/remote-jobs/customer-support/assistant-101', title: 'Assistente remoto', company_name: 'Empresa Real', candidate_required_location: 'Brazil', salary: '', description: '<p>Atendimento &amp; organização</p>', publication_date: '2026-11-06T10:00:00' }] };

it('records source-linked vacancies once and persists them', async () => {
  const path = file(); const store = new JobStore(path);
  const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  const first = await searchRemotive(store, 'assistente', fetcher);
  expect(first.added).toBe(1);
  expect(first.jobs[0]).toMatchObject({ company: 'Empresa Real', title: 'Assistente remoto', location: 'Brazil', mode: 'remote', source: 'Remotive', compatibility: null, applicationStatus: 'not_started' });
  expect(first.jobs[0].originalUrl).toBe(payload.jobs[0].url);
  expect(first.jobs[0].description).toBe('Atendimento & organização');
  const again = await searchRemotive(store, 'assistente', fetcher);
  expect(again.added).toBe(0);
  expect(new JobStore(path).list()).toHaveLength(1);
});

it('enforces source rate and refuses malformed job links', async () => {
  const store = new JobStore(file());
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ jobs: [payload.jobs[0], { ...payload.jobs[0], id: 102, url: 'http://example.com/evil' }] }), { status: 200 }));
  for (let i = 0; i < 4; i++) await searchRemotive(store, 'junior', fetcher, new Date('2026-11-06T12:00:00Z'));
  await expect(searchRemotive(store, 'junior', fetcher, new Date('2026-11-06T12:00:00Z'))).rejects.toThrow('Limite diário');
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(store.list()).toHaveLength(1);
});

it('does not record a successful search when the source fails', async () => {
  const store = new JobStore(file());
  await expect(searchRemotive(store, 'junior', async () => new Response('unavailable', { status: 503 }))).rejects.toThrow('503');
  expect(store.list()).toHaveLength(0);
  expect(store.searchesToday(new Date())).toBe(0);
});
