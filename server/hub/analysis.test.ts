import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { JobStore, searchRemotive } from './jobs';
import { ProfileStore } from './profile';
import { analyzeJob } from './analysis';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-analysis-')); dirs.push(dir);
  const jobs = new JobStore(join(dir, 'jobs.json')); const profile = new ProfileStore(join(dir, 'profile.json'));
  await searchRemotive(jobs, 'assistant', async () => new Response(JSON.stringify({ jobs: [{ id: 42, url: 'https://remotive.com/remote-jobs/support/assistant-42', title: 'Assistente', company_name: 'Empresa', description: '<p>É necessário conhecimento em Excel. Atendimento ao cliente é desejável.</p>' }] }), { status: 200 }));
  return { jobs, profile, id: jobs.list()[0].id, file: join(dir, 'jobs.json') };
}
const completion = (text: string) => ({ text, provider: 'ollama' as const, model: 'test', inputTokens: 1, outputTokens: 1 });

it('accepts only verbatim sourced requirements and scores confirmed profile terms', async () => {
  const { jobs, profile, id, file } = await setup();
  profile.update({ skills: ['Excel'], experience: [], education: [] }); profile.confirm();
  const model = { complete: vi.fn(async () => completion(JSON.stringify({ requirements: ['É necessário conhecimento em Excel.', 'Atendimento ao cliente é desejável.'] }))) };
  const result = await analyzeJob(jobs, profile, model, id);
  expect(result).toMatchObject({ requirements: ['É necessário conhecimento em Excel.', 'Atendimento ao cliente é desejável.'], compatibility: 50, analysisModel: 'ollama/test' });
  expect(new JobStore(file).list()[0].compatibility).toBe(50);
  expect(result.profileRevision).toBe(profile.get().revision);
});

it('does not assign a score without a confirmed profile', async () => {
  const { jobs, profile, id } = await setup();
  const model = { complete: async () => completion('{"requirements":["É necessário conhecimento em Excel."]}') };
  expect((await analyzeJob(jobs, profile, model, id)).compatibility).toBeNull();
});

it('accepts a JSON string array from a local model only when excerpts are in the announcement', async () => {
  const { jobs, profile, id } = await setup();
  const model = { complete: async () => completion('["Conhecimento em Excel."]') };
  expect((await analyzeJob(jobs, profile, model, id)).requirements).toEqual(['Conhecimento em Excel.']);
  const invented = { complete: async () => completion('["Graduação em medicina."]') };
  await expect(analyzeJob(jobs, profile, invented, id)).rejects.toThrow('não localizado');
});

it('rejects invented requirements without changing persisted vacancy', async () => {
  const { jobs, profile, id } = await setup();
  const model = { complete: async () => completion('{"requirements":["Graduação em medicina."]}') };
  await expect(analyzeJob(jobs, profile, model, id)).rejects.toThrow('não localizado');
  expect(jobs.list()[0].requirements).toEqual([]);
});
