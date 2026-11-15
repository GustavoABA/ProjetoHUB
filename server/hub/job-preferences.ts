import type { JobListing } from './jobs';

export type WorkMode = 'remote' | 'hybrid' | 'onsite';
export type Seniority = 'any' | 'junior' | 'mid' | 'senior';
export interface JobSearchPreferences {
  title?: string;
  location?: string;
  modes?: WorkMode[];
  seniority?: Seniority;
  desiredSalary?: string;
  area?: string;
  requiredTerms?: string[];
  preferredCompanies?: string[];
  keywords?: string[];
}
export interface JobPreferenceEvaluation {
  eligible: boolean;
  conflicts: string[];
  unknown: string[];
  preferredCompany: boolean;
}

function normalized(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim(); }
function field(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 100) throw new Error(`${label} inválido`);
  return value.trim();
}
function list(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error(`${label} inválido`);
  const items = value.map((item) => field(item, label));
  if (items.some((item) => !item)) throw new Error(`${label} inválido`);
  return [...new Set(items)];
}

export function validateJobPreferences(input: JobSearchPreferences): Required<JobSearchPreferences> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Preferências de vagas inválidas');
  const modes = input.modes === undefined ? [] : input.modes;
  if (!Array.isArray(modes) || modes.length > 3 || modes.some((mode) => !['remote', 'hybrid', 'onsite'].includes(mode)) || new Set(modes).size !== modes.length)
    throw new Error('modalidade inválida');
  const seniority = input.seniority ?? 'any';
  if (!['any', 'junior', 'mid', 'senior'].includes(seniority)) throw new Error('Experiência inválida');
  return {
    title: field(input.title ?? '', 'Cargo'), location: field(input.location ?? '', 'Localidade'), modes: [...modes], seniority,
    desiredSalary: field(input.desiredSalary ?? '', 'Salário desejado'), area: field(input.area ?? '', 'Área profissional'),
    requiredTerms: list(input.requiredTerms ?? [], 'Requisitos obrigatórios'),
    preferredCompanies: list(input.preferredCompanies ?? [], 'Empresas preferenciais'),
    keywords: list(input.keywords ?? [], 'Palavras-chave'),
  };
}

/** Strict filters use only explicit advertisement text; unknown values stay visible for review. */
export function evaluateJobPreferences(job: JobListing, raw: JobSearchPreferences): JobPreferenceEvaluation {
  const preferences = validateJobPreferences(raw);
  const conflicts: string[] = [], unknown: string[] = [];
  const title = normalized(job.title), location = normalized(job.location), content = normalized(`${job.title} ${job.description}`);
  if (preferences.title && !title.includes(normalized(preferences.title))) conflicts.push('title');
  if (preferences.modes.length) {
    if (job.mode === 'unspecified') unknown.push('mode');
    else if (!preferences.modes.includes(job.mode)) conflicts.push('mode');
  }
  if (preferences.location) {
    if (job.mode === 'remote' || job.mode === 'unspecified' || location === normalized('Não informada')) unknown.push('location');
    else if (!location.includes(normalized(preferences.location))) conflicts.push('location');
  }
  if (preferences.seniority !== 'any') {
    const junior = /\b(junior|jr|entry.level|estagio|estagiario)\b/.test(title);
    const senior = /\b(senior|sr|lead|principal)\b/.test(title);
    const mid = /\b(pleno|mid.level)\b/.test(title);
    if ((junior && preferences.seniority !== 'junior') || (mid && preferences.seniority !== 'mid') || (senior && preferences.seniority !== 'senior')) conflicts.push('seniority');
    else if (!junior && !mid && !senior) unknown.push('seniority');
  }
  if (preferences.area && !content.includes(normalized(preferences.area))) conflicts.push('area');
  if (preferences.requiredTerms.some((term) => !content.includes(normalized(term)))) conflicts.push('requiredTerms');
  if (preferences.keywords.length && !preferences.keywords.some((word) => content.includes(normalized(word)))) conflicts.push('keywords');
  if (preferences.desiredSalary) unknown.push('salary');
  return { eligible: conflicts.length === 0, conflicts, unknown,
    preferredCompany: preferences.preferredCompanies.some((company) => normalized(job.company).includes(normalized(company))) };
}
