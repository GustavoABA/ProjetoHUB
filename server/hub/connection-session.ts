import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type SessionPolicy = 'renew' | 'notify' | 'close';
type State = { version: 1; installationId: string; startedAt: string; expiresAt: string; policy: SessionPolicy; handledAt?: string };

/** Administrative window only; job tasks are managed by the independent HubStore. */
export class ConnectionSession {
  private state: State;
  constructor(private readonly file: string, now: Date = new Date()) {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as State;
      if (parsed.version !== 1 || !/^[0-9a-f-]{36}$/i.test(parsed.installationId) || !Number.isFinite(Date.parse(parsed.startedAt)) ||
          !Number.isFinite(Date.parse(parsed.expiresAt)) || !['renew', 'notify', 'close'].includes(parsed.policy)) throw new Error('Sessão administrativa incompatível');
      this.state = parsed;
    } else {
      this.state = { version: 1, installationId: randomUUID(), startedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 12 * 60 * 60_000).toISOString(), policy: 'notify' };
      this.save();
    }
  }
  status(now: Date = new Date()) {
    const remainingSeconds = Math.max(0, Math.ceil((Date.parse(this.state.expiresAt) - now.getTime()) / 1000));
    return { installationId: this.state.installationId, startedAt: this.state.startedAt, expiresAt: this.state.expiresAt,
      policy: this.state.policy, remainingSeconds, expired: remainingSeconds === 0, handledAt: this.state.handledAt };
  }
  setPolicy(policy: SessionPolicy): ReturnType<ConnectionSession['status']> {
    if (!['renew', 'notify', 'close'].includes(policy)) throw new Error('Política de sessão inválida');
    this.state.policy = policy; delete this.state.handledAt; this.save(); return this.status();
  }
  renew(now: Date = new Date()): ReturnType<ConnectionSession['status']> {
    this.state.startedAt = now.toISOString();
    this.state.expiresAt = new Date(now.getTime() + 12 * 60 * 60_000).toISOString();
    delete this.state.handledAt; this.save(); return this.status(now);
  }
  tick(now: Date = new Date()): SessionPolicy | undefined {
    if (now.getTime() < Date.parse(this.state.expiresAt) || this.state.handledAt) return;
    if (this.state.policy === 'renew') { this.renew(now); return 'renew'; }
    this.state.handledAt = now.toISOString(); this.save();
    return this.state.policy;
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}
