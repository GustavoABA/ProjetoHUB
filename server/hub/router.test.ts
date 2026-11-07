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

it('enforces a persisted monthly request limit and falls back to another authorized model', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }));
  const r = router(fetcher, { OPENAI_API_KEY: 'first', DEEPSEEK_API_KEY: 'second' });
  const first = r.add({ provider: 'openai', model: 'first', priority: 1, monthlyRequestLimit: 1 });
  const second = r.add({ provider: 'deepseek', model: 'second', priority: 2 });
  const prompt = [{ role: 'user' as const, content: 'Olá' }];
  await r.complete(prompt, undefined, first.id, [second.id]);
  expect(r.status().models.find((model) => model.id === first.id)).toMatchObject({ available: false, monthlyRequestLimit: 1, monthlyUsage: { requests: 1, inputTokens: 10, outputTokens: 5 } });
  expect(await r.complete(prompt, undefined, first.id, [second.id])).toMatchObject({ model: 'second' });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(new ModelRouter(r.file, fetcher, { OPENAI_API_KEY: 'first' }).status().models.find((model) => model.id === first.id)?.monthlyUsage.requests).toBe(1);
});

it('reserves the last monthly call before network I/O so concurrent tasks cannot both use it', async () => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  const fetcher = vi.fn<typeof fetch>()
    .mockImplementationOnce(async () => pending)
    .mockImplementationOnce(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Reserva' } }] }), { status: 200 }));
  const r = router(fetcher, { OPENAI_API_KEY: 'first', DEEPSEEK_API_KEY: 'second' });
  const first = r.add({ provider: 'openai', model: 'first', priority: 1, monthlyRequestLimit: 1 });
  const second = r.add({ provider: 'deepseek', model: 'second', priority: 2 });
  const messages = [{ role: 'user' as const, content: 'Olá' }];
  const firstCall = r.complete(messages, undefined, first.id, [second.id]);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(await r.complete(messages, undefined, first.id, [second.id])).toMatchObject({ model: 'second' });
  release(new Response(JSON.stringify({ choices: [{ message: { content: 'Principal' } }] }), { status: 200 }));
  expect(await firstCall).toMatchObject({ model: 'first' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('blocks further paid calls at an estimated monthly cost threshold', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }],
    usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } }), { status: 200 }));
  const r = router(fetcher, { OPENAI_API_KEY: 'secret' });
  const model = r.add({ provider: 'openai', model: 'priced', priority: 1,
    inputUsdPerMillion: 2, outputUsdPerMillion: 4, monthlyCostLimitUsd: 2 });
  await r.complete([{ role: 'user', content: 'Olá' }]);
  expect(r.status().models.find((item) => item.id === model.id)?.monthlyUsage).toMatchObject({ estimatedCostUsd: 2, unpricedRequests: 0 });
  await expect(r.complete([{ role: 'user', content: 'Olá' }])).rejects.toThrow('Nenhum modelo disponível');
  expect(fetcher).toHaveBeenCalledOnce();
});

it('does not claim a cost estimate when token counts are missing', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }));
  const r = router(fetcher, { OPENAI_API_KEY: 'secret' });
  const model = r.add({ provider: 'openai', model: 'priced', priority: 1,
    inputUsdPerMillion: 2, outputUsdPerMillion: 4, monthlyCostLimitUsd: 3 });
  await r.complete([{ role: 'user', content: 'Olá' }]);
  expect(r.status().models.find((item) => item.id === model.id)?.monthlyUsage).toMatchObject({ estimatedCostUsd: 0, unpricedRequests: 1 });
  await expect(r.complete([{ role: 'user', content: 'Olá' }])).rejects.toThrow('Nenhum modelo disponível');
});

it('validates usage policies without changing an existing model on invalid edits', () => {
  const r = router(vi.fn<typeof fetch>());
  expect(() => r.add({ provider: 'openai', model: 'bad', priority: 1, monthlyRequestLimit: 0 })).toThrow();
  const model = r.add({ provider: 'openai', model: 'good', priority: 1 });
  expect(() => r.update(model.id, { monthlyCostLimitUsd: 2 })).toThrow();
  expect(r.status().models.find((item) => item.id === model.id)?.monthlyCostLimitUsd).toBeUndefined();
  expect(r.update(model.id, { inputUsdPerMillion: 1, outputUsdPerMillion: 2, monthlyCostLimitUsd: 3 })).toMatchObject({ monthlyCostLimitUsd: 3 });
});

it('skips missing credentials and reports when no model is available', async () => {
  const fetcher = vi.fn<typeof fetch>(); const r = router(fetcher);
  r.add({ provider: 'openai', model: 'gpt-test', priority: 1 });
  expect(r.status().models[0].available).toBe(false);
  await expect(r.complete([{ role: 'user', content: 'Oi' }])).rejects.toThrow('Nenhum modelo disponível');
  expect(fetcher).not.toHaveBeenCalled();
});

it('routes local fallback only to Ollama', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Local' } }] }), { status: 200 }));
  const r = router(fetcher, { OPENAI_API_KEY: 'secret' });
  r.add({ provider: 'openai', model: 'gpt-test', priority: 1 });
  r.add({ provider: 'ollama', model: 'local-test', priority: 2 });
  expect(await r.complete([{ role: 'user', content: 'Oi' }], 'ollama')).toMatchObject({ provider: 'ollama', text: 'Local' });
  expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:11434/v1/chat/completions');
});

it('uses only the exact model chosen for an agent regardless of global priority', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Escolhido' } }] }), { status: 200 }));
  const r = router(fetcher, { OPENAI_API_KEY: 'first', DEEPSEEK_API_KEY: 'second' });
  r.add({ provider: 'openai', model: 'first-model', priority: 1 });
  const chosen = r.add({ provider: 'deepseek', model: 'chosen-model', priority: 10 });
  expect(await r.complete([{ role: 'user', content: 'Analise' }], undefined, chosen.id)).toMatchObject({ provider: 'deepseek', model: 'chosen-model' });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).model).toBe('chosen-model');
  await expect(r.complete([{ role: 'user', content: 'Analise' }], undefined, 'missing')).rejects.toThrow('Modelo selecionado');
});

it('uses only the explicitly ordered agent fallback chain after a recoverable failure', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 429 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'Reserva respondeu' } }] }), { status: 200 }));
  const r = router(fetcher, { OPENAI_API_KEY: 'first', DEEPSEEK_API_KEY: 'second', OPENROUTER_API_KEY: 'third' });
  const unrelated = r.add({ provider: 'openrouter', model: 'unrelated', priority: 1 });
  const primary = r.add({ provider: 'openai', model: 'primary', priority: 10 });
  const backup = r.add({ provider: 'deepseek', model: 'backup', priority: 100 });
  const messages = [{ role: 'system' as const, content: 'Contexto' }, { role: 'user' as const, content: 'Pergunta' }];
  const result = await r.complete(messages, undefined, primary.id, [backup.id]);
  expect(result).toMatchObject({ provider: 'deepseek', model: 'backup', text: 'Reserva respondeu' });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ model: 'primary', messages });
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({ model: 'backup', messages });
  expect(fetcher.mock.calls.every((call) => !String(call[1]?.body).includes(unrelated.model))).toBe(true);
});

it('skips an unavailable primary but does not fall back after an invalid request', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'Backup' } }] }), { status: 200 }))
    .mockResolvedValueOnce(new Response('', { status: 400 }));
  const r = router(fetcher, { DEEPSEEK_API_KEY: 'backup' });
  const primary = r.add({ provider: 'openai', model: 'primary', priority: 1 });
  const backup = r.add({ provider: 'deepseek', model: 'backup', priority: 2 });
  expect(await r.complete([{ role: 'user', content: 'Oi' }], undefined, primary.id, [backup.id])).toMatchObject({ provider: 'deepseek' });
  expect(fetcher).toHaveBeenCalledOnce();
  await expect(r.complete([{ role: 'user', content: 'Oi' }], undefined, backup.id, [primary.id])).rejects.toThrow('HTTP 400');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('continues with registered backups after a selected model is removed', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Reserva ativa' } }] }), { status: 200 }));
  const r = router(fetcher, { DEEPSEEK_API_KEY: 'backup' });
  const primary = r.add({ provider: 'openai', model: 'primary', priority: 1 });
  const removedBackup = r.add({ provider: 'openai', model: 'removed', priority: 2 });
  const backup = r.add({ provider: 'deepseek', model: 'backup', priority: 3 });
  r.remove(primary.id); r.remove(removedBackup.id);
  expect(await r.complete([{ role: 'user', content: 'Oi' }], undefined, primary.id, [removedBackup.id, backup.id])).toMatchObject({ provider: 'deepseek', text: 'Reserva ativa' });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('discovers an installed Ollama model once and keeps a configured choice', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ models: [
    { name: 'large:latest', size: 8_000_000_000 }, { name: 'small:latest', size: 1_000_000_000 },
  ] }), { status: 200 }));
  const r = router(fetcher);
  expect(await r.discoverLocalModel()).toMatchObject({ provider: 'ollama', model: 'small:latest' });
  expect(await r.discoverLocalModel()).toMatchObject({ model: 'small:latest' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(new ModelRouter(r.file, fetcher).status().models).toHaveLength(1);
});

it('does not register an Ollama model without a valid local response', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ models: [{ name: '../invalid model' }] }), { status: 200 }));
  const r = router(fetcher);
  expect(await r.discoverLocalModel()).toBeUndefined();
  expect(r.status().models).toHaveLength(0);
});

it('respects a deliberately disabled Ollama model', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const r = router(fetcher);
  const model = r.add({ provider: 'ollama', model: 'chosen:latest', priority: 1 });
  r.update(model.id, { enabled: false });
  expect(await r.discoverLocalModel()).toBeUndefined();
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
