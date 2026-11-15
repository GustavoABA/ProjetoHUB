import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { JobStore, type JobListing } from './jobs';
import { evaluateJobPreferences } from './job-preferences';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function store(): { jobs: JobStore; path: string } { const dir = mkdtempSync(join(tmpdir(), 'projecthub-preferences-')); dirs.push(dir);
  const path = join(dir, 'jobs.json'); return { jobs: new JobStore(path), path }; }
const job: JobListing = { id: '12345678-1234-4234-8234-123456789001', source: 'Greenhouse', sourceId: 'company:1',
  company: 'Empresa A', title: 'Assistente administrativo júnior', location: 'São Paulo, Brasil', mode: 'onsite',
  description: 'Atendimento ao cliente. Conhecimento em Excel.', requirements: [],
  originalUrl: 'https://job-boards.greenhouse.io/company/jobs/1', discoveredAt: '2026-11-07T12:00:00.000Z',
  compatibility: null, justification: 'Pendente', applicationStatus: 'not_started' };

it('persists search preferences and rejects invalid configuration without changing it', () => {
  const { jobs, path } = store();
  const preferences = jobs.configurePreferences({ title: 'Assistente', location: 'São Paulo', modes: ['onsite'],
    seniority: 'junior', desiredSalary: 'R$ 2.000/mês', area: 'Administrativo',
    requiredTerms: ['Excel'], preferredCompanies: ['Empresa A'], keywords: ['atendimento'] });
  expect(preferences).toMatchObject({ title: 'Assistente', modes: ['onsite'], requiredTerms: ['Excel'] });
  expect(new JobStore(path).preferences()).toEqual(preferences);
  expect(() => jobs.configurePreferences({ ...preferences, modes: ['invalid' as 'remote'] })).toThrow('modalidade');
  expect(jobs.preferences()).toEqual(preferences);
});

it('filters explicit mismatches and reports unknown fields without inventing data', () => {
  const preferences = { title: 'Assistente', location: 'São Paulo', modes: ['onsite' as const], seniority: 'junior' as const,
    desiredSalary: 'R$ 2.000/mês', area: 'Administrativo', requiredTerms: ['Excel'], preferredCompanies: ['Empresa A'], keywords: ['atendimento'] };
  expect(evaluateJobPreferences(job, preferences)).toMatchObject({ eligible: true, preferredCompany: true,
    unknown: ['salary'] });
  expect(evaluateJobPreferences({ ...job, mode: 'remote' }, preferences)).toMatchObject({ eligible: false });
  expect(evaluateJobPreferences({ ...job, title: 'Assistente administrativo sênior' }, preferences)).toMatchObject({ eligible: false });
  expect(evaluateJobPreferences({ ...job, location: 'Recife' }, preferences)).toMatchObject({ eligible: false });
  expect(evaluateJobPreferences({ ...job, mode: 'unspecified', location: 'Não informada' }, preferences)).toMatchObject({ eligible: true });
});
