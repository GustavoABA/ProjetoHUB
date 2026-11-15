import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface Settings { version: 1; maxConcurrent: number }

/** Bounds simultaneous dispatch attempts; each task is claimed by the HubStore before awaiting I/O. */
export class TaskRuntime {
  private settings: Settings;
  private active = 0;
  constructor(private readonly file: string, private readonly dispatch: () => Promise<unknown>) {
    if (existsSync(file)) {
      const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!value || typeof value !== 'object' || (value as Settings).version !== 1 || !TaskRuntime.valid((value as Settings).maxConcurrent))
        throw new Error('Configuração de concorrência incompatível ou corrompida');
      this.settings = value as Settings;
    } else this.settings = { version: 1, maxConcurrent: 1 };
  }
  private static valid(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 4; }
  status(): { maxConcurrent: number; active: number } { return { maxConcurrent: this.settings.maxConcurrent, active: this.active }; }
  configure(maxConcurrent: number): { maxConcurrent: number; active: number } {
    if (!TaskRuntime.valid(maxConcurrent)) throw new Error('Concorrência deve ser um número inteiro de 1 a 4');
    const next: Settings = { version: 1, maxConcurrent };
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    renameSync(temp, this.file);
    this.settings = next;
    return this.status();
  }
  async tick(): Promise<void> {
    if (this.active >= this.settings.maxConcurrent) return;
    this.active++;
    try { await this.dispatch(); }
    finally { this.active--; }
  }
}
