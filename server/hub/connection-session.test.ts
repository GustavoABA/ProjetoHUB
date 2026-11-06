import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { ConnectionSession } from './connection-session';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test('persiste janela administrativa, notifica ao expirar e não renova sem política', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-session-')); dirs.push(dir);
  const file = join(dir, 'session.json');
  const start = new Date('2026-11-06T10:00:00Z');
  const first = new ConnectionSession(file, start);
  expect(first.status(start).remainingSeconds).toBe(43_200);
  expect(first.tick(new Date('2026-11-06T22:00:01Z'))).toBe('notify');
  expect(first.tick(new Date('2026-11-06T22:01:00Z'))).toBeUndefined();
  const restored = new ConnectionSession(file, new Date('2026-11-07T00:00:00Z'));
  expect(restored.status(new Date('2026-11-07T00:00:00Z')).expired).toBe(true);
  restored.renew(new Date('2026-11-07T00:00:00Z'));
  expect(new ConnectionSession(file).status(new Date('2026-11-07T00:00:00Z')).remainingSeconds).toBe(43_200);
});

test('política renovar abre nova janela; encerrar termina só a sessão remota', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-session-')); dirs.push(dir);
  const first = new ConnectionSession(join(dir, 'session.json'), new Date('2026-11-06T10:00:00Z'));
  first.setPolicy('renew');
  expect(first.tick(new Date('2026-11-06T22:00:00Z'))).toBe('renew');
  expect(first.status(new Date('2026-11-06T22:00:00Z')).expired).toBe(false);
  first.setPolicy('close');
  expect(first.tick(new Date('2026-11-07T10:00:00Z'))).toBe('close');
});
