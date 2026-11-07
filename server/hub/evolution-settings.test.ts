import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { EvolutionSettings } from './evolution-settings';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(env: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-evolution-')); dirs.push(dir);
  const cipher = { protect: vi.fn(async (text: string) => `encrypted:${Buffer.from(text).toString('base64')}`),
    unprotect: vi.fn(async (text: string) => Buffer.from(text.slice(10), 'base64').toString()) };
  return { file: join(dir, 'evolution-settings.json'), cipher, env };
}

it('persists a Windows-protected API key and URL without exposing the key', async () => {
  const { file, cipher, env } = fixture();
  const settings = new EvolutionSettings(file, env, 'win32', cipher);
  await settings.configure({ baseUrl: 'http://127.0.0.1:8080/', apiKey: 'private-key-123' });
  expect(settings.status()).toMatchObject({ baseUrl: 'http://127.0.0.1:8080', apiKeyConfigured: true });
  expect(JSON.stringify(settings.status())).not.toContain('private-key');
  expect(readFileSync(file, 'utf8')).not.toContain('private-key');
  expect(await new EvolutionSettings(file, env, 'win32', cipher).apiKey()).toBe('private-key-123');
  await settings.clearKey();
  expect(settings.status().apiKeyConfigured).toBe(false);
});

it('allows a non-Windows service to set URL but requires a legitimate environment key', async () => {
  const { file, cipher } = fixture({ EVOLUTION_API_KEY: 'from-env' });
  const settings = new EvolutionSettings(file, { EVOLUTION_API_KEY: 'from-env' }, 'linux', cipher);
  await settings.configure({ baseUrl: 'https://example.com/evolution' });
  expect(await settings.apiKey()).toBe('from-env');
  await expect(settings.configure({ apiKey: 'secret' })).rejects.toThrow('Windows');
  expect(settings.status().baseUrl).toBe('https://example.com/evolution');
});

it('rejects unsafe URLs and keys', async () => {
  const { file, cipher, env } = fixture();
  const settings = new EvolutionSettings(file, env, 'win32', cipher);
  await expect(settings.configure({ baseUrl: 'http://example.com/' })).rejects.toThrow();
  await expect(settings.configure({ baseUrl: 'https://user:pass@example.com/' })).rejects.toThrow();
  await expect(settings.configure({ apiKey: 'bad\nkey' })).rejects.toThrow();
  expect(cipher.protect).not.toHaveBeenCalled();
});
