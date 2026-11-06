import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelRouter } from './router';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function router(fetcher: typeof fetch, env: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-router-')); dirs.push(dir);
  return new ModelRouter(join(dir, 'router.json'), fetcher, env);
}

it('preserves context during recoverable fallback and persists token totals', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'Resposta' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } }), { status: 200 }));
  const r = router(fetcher, { OPENAI_API_KEY: 'secret-a', DEEPSEEK_API_KEY: 'secret-b' });
  r.add({ provider: 'openai', model: 'gpt-test', priority: 1 });
  r.add({ provider: 'deepseek', model: 'deepseek-test', priority: 2 });
  const messages = [{ role: 'system' as const, content: 'Contexto' }, { role: 'user' as const, content: 'Pergunta' }];
  const result = await r.complete(messages);
  expect(result).toMatchObject({ text: 'Resposta', provider: 'deepseek', inputTokens: 4, outputTokens: 2 });
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).messages).toEqual(messages);
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).messages).toEqual(messages);
  expect(JSON.stringify(r.status())).not.toContain('secret-');
  expect(new ModelRouter(r.file, fetcher, { DEEPSEEK_API_KEY: 'secret-b' }).status().usage).toMatchObject({ inputTokens: 4, outputTokens: 2 });
});

it('skips missing credentials and reports when no model is available', async () => {
  const fetcher = vi.fn<typeof fetch>(); const r = router(fetcher);
  r.add({ provider: 'openai', model: 'gpt-test', priority: 1 });
  expect(r.status().models[0].available).toBe(false);
  await expect(r.complete([{ role: 'user', content: 'Oi' }])).rejects.toThrow('Nenhum modelo disponível');
  expect(fetcher).not.toHaveBeenCalled();
});

it('uses Anthropic native Messages format and does not leak error body', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Olá' }], usage: { input_tokens: 3, output_tokens: 1 } }), { status: 200 }));
  const r = router(fetcher, { ANTHROPIC_API_KEY: 'secret-c' });
  r.add({ provider: 'anthropic', model: 'claude-test', priority: 1 });
  expect(await r.complete([{ role: 'system', content: 'Instrução' }, { role: 'user', content: 'Oi' }])).toMatchObject({ text: 'Olá', inputTokens: 3, outputTokens: 1 });
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ system: 'Instrução', messages: [{ role: 'user', content: 'Oi' }] });
  expect((fetcher.mock.calls[0][1]?.headers as Record<string, string>)['x-api-key']).toBe('secret-c');
});

it('refuses malformed model names and stops on unrecoverable request errors', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive upstream body', { status: 400 }));
  const r = router(fetcher, { OPENAI_API_KEY: 'secret' });
  expect(() => r.add({ provider: 'openai', model: 'bad\nmodel', priority: 1 })).toThrow();
  r.add({ provider: 'openai', model: 'gpt-test', priority: 1 });
  await expect(r.complete([{ role: 'user', content: 'Oi' }])).rejects.toThrow('HTTP 400');
  expect(r.status().lastError).not.toContain('sensitive');
});
