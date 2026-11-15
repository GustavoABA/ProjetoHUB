import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface CandidateProfile {
  version: 1;
  revision: string;
  skills: string[];
  experience: string[];
  education: string[];
  updatedAt?: string;
  confirmedAt?: string;
}
function entries(input: unknown, label: string): string[] {
  if (!Array.isArray(input) || input.length > 100 || input.some((v) => typeof v !== 'string' || !v.trim() || v.length > 300)) throw new Error(`${label}: itens inválidos`);
  const cleaned = input.map((v: string) => v.trim());
  if (new Set(cleaned.map((v: string) => v.toLocaleLowerCase('pt-BR'))).size !== cleaned.length) throw new Error(`${label}: itens duplicados`);
  return cleaned;
}

export class ProfileStore {
  private profile: CandidateProfile;
  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed as CandidateProfile).version !== 1 || !Array.isArray((parsed as CandidateProfile).skills) || !Array.isArray((parsed as CandidateProfile).experience) || !Array.isArray((parsed as CandidateProfile).education)) throw new Error('Perfil profissional incompatível ou corrompido');
      this.profile = parsed as CandidateProfile;
    } else this.profile = { version: 1, revision: randomUUID(), skills: [], experience: [], education: [] };
  }
  get(): CandidateProfile { return structuredClone(this.profile); }
  update(input: { skills: string[]; experience: string[]; education: string[] }): CandidateProfile {
    const skills = entries(input.skills, 'Competências');
    const experience = entries(input.experience, 'Experiência');
    const education = entries(input.education, 'Formação');
    this.profile = { version: 1, revision: randomUUID(), skills, experience, education, updatedAt: new Date().toISOString() };
    this.save(); return this.get();
  }
  confirm(): CandidateProfile {
    if (!this.profile.skills.length && !this.profile.experience.length && !this.profile.education.length) throw new Error('Informe ao menos uma competência, experiência ou formação');
    this.profile.confirmedAt = new Date().toISOString();
    this.save(); return this.get();
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.profile, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.file);
  }
}
