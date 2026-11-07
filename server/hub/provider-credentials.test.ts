import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ProviderCredentials } from './provider-credentials';
import { ModelRouter } from './router';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(env: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-provider-')); dirs.push(dir);
  const cipher = { protect: async (value: string) => `encrypted:${value.split('').reverse().join('')}`,
    unprotect: async (value: string) => value.slice(10).split('').reverse().join('') };
  return { dir, credentials: new ProviderCredentials(join(dir, 'credentials.json'), env, 'win32', cipher), cipher };
}

it('keeps a provider key protected on disk and never returns it in status', async () => {
  const { dir, credentials, cipher } = fixture();
  await credentials.set('openai', 'sk-private-test-key');
  const disk = readFileSync(join(dir, 'credentials.json'), 'utf8');
  expect(disk).not.toContain('sk-private-test-key');
  expect(JSON.stringify(credentials.status())).not.toContain('sk-private-test-key');
  expect(credentials.status().openai).toEqual({ configured: true, source: 'windows' });
  expect(await new ProviderCredentials(join(dir, 'credentials.json'), {}, 'win32', cipher).get('openai')).toBe('sk-private-test-key');
  credentials.clear('openai');
  expect(credentials.status().openai.configured).toBe(false);
});

it('respects environment precedence and rejects local editing of an active environment key', async () => {
  const { credentials } = fixture({ ANTHROPIC_API_KEY: 'environment-secret' });
  expect(credentials.status().anthropic).toEqual({ configured: true, source: 'environment' });
  expect(await credentials.get('anthropic')).toBe('environment-secret');
  await expect(credentials.set('anthropic', 'other')).rejects.toThrow('ambiente');
  expect(() => credentials.clear('anthropic')).toThrow('ambiente');
});

it('does not accept Ollama as an API credential or persist a key outside Windows', async () => {
  const { dir, cipher } = fixture();
  const linux = new ProviderCredentials(join(dir, 'linux.json'), {}, 'linux', cipher);
  await expect(linux.set('openai', 'secret')).rejects.toThrow('Windows');
  await expect(linux.set('ollama' as never, 'secret')).rejects.toThrow('Provedor');
});

it('lets the router use a saved provider key without exposing it in its model state', async () => {
  const { dir, credentials } = fixture();
  await credentials.set('openai', 'sk-private-test-key');
  let authorization = '';
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    authorization = String((init?.headers as Record<string, string>)?.Authorization);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Resposta' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }), { status: 200 });
  }) as typeof fetch;
  const router = new ModelRouter(join(dir, 'router.json'), fetcher, {}, credentials);
  router.add({ provider: 'openai', model: 'test-model', priority: 1 });
  expect(router.status().models[0].available).toBe(true);
  expect(await router.complete([{ role: 'user', content: 'Oi' }])).toMatchObject({ provider: 'openai', text: 'Resposta' });
  expect(authorization).toBe('Bearer sk-private-test-key');
  expect(readFileSync(join(dir, 'router.json'), 'utf8')).not.toContain('sk-private-test-key');
});
