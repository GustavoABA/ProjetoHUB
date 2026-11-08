import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { BackupManager } from './backup';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-backup-')); dirs.push(dir);
  return { dir, manager: new BackupManager(dir) };
}

it('backs up allowlisted state and evidence, verifies integrity, and restores on next startup', () => {
  const { dir, manager } = fixture();
  writeFileSync(join(dir, 'state.json'), '{"version":1,"agents":[],"tasks":[]}');
  writeFileSync(join(dir, 'whatsapp.json'), '{"messages":[]}');
  writeFileSync(join(dir, 'webhook-listener.json'), '{"version":1,"enabled":true,"port":4770,"exposeLan":false}');
  writeFileSync(join(dir, 'greenhouse-boards.json'), '{"version":1,"boards":[]}');
  writeFileSync(join(dir, 'lever-boards.json'), '{"version":1,"boards":[{"site":"empresa"}]}');
  writeFileSync(join(dir, 'mcp-admin.json'), 'hash excluded');
  mkdirSync(join(dir, 'application-evidence'));
  writeFileSync(join(dir, 'application-evidence', 'abc.png'), 'png evidence');
  const backup = manager.create();
  expect(manager.verify(backup.id).files).toContain('state.json');
  expect(manager.verify(backup.id).files).toContain('webhook-listener.json');
  expect(manager.verify(backup.id).files).toContain('greenhouse-boards.json');
  expect(manager.verify(backup.id).files).toContain('lever-boards.json');
  writeFileSync(join(dir, 'state.json'), '{"version":1,"agents":["changed"],"tasks":[]}');
  writeFileSync(join(dir, 'webhook-listener.json'), '{"version":1,"enabled":false,"port":4771,"exposeLan":false}');
  writeFileSync(join(dir, 'jobs.json'), '{"version":1}');
  manager.stageRestore(backup.id);
  expect(manager.status().pendingRestore).toBe(backup.id);
  expect(new BackupManager(dir).applyPendingRestore()).toBe(true);
  expect(readFileSync(join(dir, 'state.json'), 'utf8')).toContain('"agents":[]');
  expect(readFileSync(join(dir, 'webhook-listener.json'), 'utf8')).toContain('"port":4770');
  expect(readFileSync(join(dir, 'lever-boards.json'), 'utf8')).toContain('"site":"empresa"');
  expect(readFileSync(join(dir, 'mcp-admin.json'), 'utf8')).toBe('hash excluded');
  expect(() => readFileSync(join(dir, 'jobs.json'))).toThrow();
  expect(manager.status().pendingRestore).toBeUndefined();
  expect(manager.list()).toHaveLength(2); // includes safety backup of state before restoration
});

it('rejects tampered backup and does not stage it', () => {
  const { manager } = fixture();
  const backup = manager.create();
  writeFileSync(backup.file, 'tampered');
  expect(() => manager.stageRestore(backup.id)).toThrow();
  expect(manager.status().pendingRestore).toBeUndefined();
});

it('rejects unknown backup identifiers', () => {
  const { manager } = fixture();
  expect(() => manager.stageRestore('../state.json')).toThrow();
});
