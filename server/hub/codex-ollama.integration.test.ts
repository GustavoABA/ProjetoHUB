import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { HubStore } from './store';
import { ModelRouter } from './router';
import { dispatchWithLocalFallback } from './dispatcher';

it.skipIf(process.env.PROJECTHUB_OLLAMA_E2E !== '1')('uses a real local Ollama response when Codex is offline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-ollama-e2e-'));
  try {
    const router = new ModelRouter(join(dir, 'router.json'));
    const model = await router.discoverLocalModel();
    if (!model) throw new Error('Nenhum modelo Ollama instalado ou serviço inacessível');
    const store = new HubStore(join(dir, 'state.json'));
    const agent = store.createAgent({ name: 'Teste Codex', objective: 'Responder texto',
      codexThread: '12345678-1234-1234-1234-123456789012', codexHome: 'C:/codex-inexistente' });
    const task = store.createTask({ agentId: agent.id, instruction: 'Responda apenas com uma frase curta em português.' });
    const result = await dispatchWithLocalFallback(store, async () => ({ ok: false, error: 'Codex offline' }),
      async (instruction) => {
        const answer = await router.complete([{ role: 'user', content: instruction }], 'ollama');
        return { text: answer.text, model: answer.model, provider: answer.provider };
      });
    expect(result).toMatchObject({ id: task.id, status: 'result_ready', executionProvider: 'ollama', executionModel: model.model });
    expect(result?.result?.trim().length).toBeGreaterThan(0);
    expect(new HubStore(join(dir, 'state.json')).listTasks().find((item) => item.id === task.id)?.result).toBe(result?.result);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 200_000);
