import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HubStore } from './store';
import { WhatsAppStore } from './whatsapp';
import { WebhookListener } from './webhook-listener';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

async function freePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Endereço ausente');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function fixture(env: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-listener-')); dirs.push(dir);
  const hub = new HubStore(join(dir, 'hub.json'));
  const whatsapp = new WhatsAppStore(join(dir, 'whatsapp.json'));
  return { file: join(dir, 'listener.json'), hub, whatsapp, env };
}

it('starts an authenticated loopback listener from HUD settings and persists them', async () => {
  const { file, hub, whatsapp, env } = fixture();
  const port = await freePort();
  const listener = new WebhookListener(file, whatsapp, hub, env);
  try {
    expect(listener.status().running).toBe(false);
    const active = await listener.configure({ enabled: true, port, exposeLan: false });
    expect(active).toMatchObject({ enabled: true, running: true, port, bind: '127.0.0.1' });
    const response = await fetch(`http://127.0.0.1:${port}/webhook/evolution`, { method: 'POST' });
    expect(response.status).toBe(401);
    const recovered = new WebhookListener(file, whatsapp, hub, env);
    expect(recovered.status()).toMatchObject({ enabled: true, running: false, port, exposeLan: false });
  } finally { await listener.close(); }
});

it('stops its own listener and rejects invalid or reserved ports', async () => {
  const { file, hub, whatsapp, env } = fixture();
  const port = await freePort();
  const listener = new WebhookListener(file, whatsapp, hub, env, [port + 1]);
  try {
    await expect(listener.configure({ enabled: true, port: port + 1, exposeLan: false })).rejects.toThrow('reservada');
    await expect(listener.configure({ enabled: true, port: 0, exposeLan: false })).rejects.toThrow();
    await listener.configure({ enabled: true, port, exposeLan: false });
    expect((await listener.configure({ enabled: false, port, exposeLan: false })).running).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/webhook/evolution`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  } finally { await listener.close(); }
});

it('reports a port conflict and recovers after the port is released', async () => {
  const { file, hub, whatsapp, env } = fixture();
  const port = await freePort();
  const occupied = http.createServer();
  await new Promise<void>((resolve) => occupied.listen(port, '127.0.0.1', resolve));
  const listener = new WebhookListener(file, whatsapp, hub, env);
  try {
    expect(await listener.configure({ enabled: true, port, exposeLan: false })).toMatchObject({ enabled: true, running: false, error: 'Porta em uso' });
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    expect(await listener.reconcile()).toMatchObject({ running: true, port });
  } finally { if (occupied.listening) await new Promise<void>((resolve) => occupied.close(() => resolve())); await listener.close(); }
});

it('uses existing environment settings until saved settings override them', async () => {
  const { file, hub, whatsapp } = fixture({ PROJECTHUB_WHATSAPP_WEBHOOK_PORT: '4770', PROJECTHUB_WHATSAPP_WEBHOOK_BIND: '0.0.0.0' });
  const listener = new WebhookListener(file, whatsapp, hub, { PROJECTHUB_WHATSAPP_WEBHOOK_PORT: '4770', PROJECTHUB_WHATSAPP_WEBHOOK_BIND: '0.0.0.0' });
  expect(listener.status()).toMatchObject({ enabled: true, port: 4770, exposeLan: true, running: false });
  await listener.configure({ enabled: false, port: 4771, exposeLan: false });
  const restored = new WebhookListener(file, whatsapp, hub, { PROJECTHUB_WHATSAPP_WEBHOOK_PORT: '4770', PROJECTHUB_WHATSAPP_WEBHOOK_BIND: '0.0.0.0' });
  expect(restored.status()).toMatchObject({ enabled: false, port: 4771, exposeLan: false });
});

it('keeps the main service available when a previously saved listener port becomes reserved', async () => {
  const { file, hub, whatsapp, env } = fixture();
  writeFileSync(file, JSON.stringify({ version: 1, enabled: true, port: 4770, exposeLan: false }));
  const listener = new WebhookListener(file, whatsapp, hub, env, [4770]);
  expect(await listener.reconcile()).toMatchObject({ enabled: true, running: false, error: 'Porta do webhook reservada por outro serviço do escritório' });
});
