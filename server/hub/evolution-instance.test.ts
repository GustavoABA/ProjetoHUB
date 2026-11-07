import { expect, it, vi } from 'vitest';
import { connectJobInstance, ensureJobInstance } from './evolution-instance';

const options = { baseUrl: 'http://127.0.0.1:8080', apiKey: 'test-key' };

it('creates only the dedicated instance after checking existing names', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify([{ name: 'existing-one' }, { name: 'existing-two' }]), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ instance: { instanceName: 'procura-de-emprego', status: 'close' }, hash: 'sensitive-instance-key' }), { status: 201 }));
  const result = await ensureJobInstance({ ...options, fetcher });
  expect(result).toMatchObject({ created: true, status: 'close' });
  expect(JSON.stringify(result)).not.toContain('sensitive-instance-key');
  expect(fetcher.mock.calls).toHaveLength(2);
  expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:8080/instance/fetchInstances');
  expect(fetcher.mock.calls[1][0]).toBe('http://127.0.0.1:8080/instance/create');
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ instanceName: 'procura-de-emprego', qrcode: true, integration: 'WHATSAPP-BAILEYS' });
  expect(JSON.stringify(await ensureJobInstance({ ...options, fetcher: async () => new Response(JSON.stringify([{ name: 'procura-de-emprego', connectionStatus: 'close' }]), { status: 200 }) }))).not.toContain('sensitive-instance-key');
});

it('does not create if the target already exists or preflight cannot be trusted', async () => {
  const existing = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{ name: 'procura-de-emprego', connectionStatus: 'open' }]), { status: 200 }));
  expect(await ensureJobInstance({ ...options, fetcher: existing })).toMatchObject({ created: false, status: 'open' });
  expect(existing).toHaveBeenCalledOnce();
  const forbidden = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret upstream body', { status: 401 }));
  await expect(ensureJobInstance({ ...options, fetcher: forbidden })).rejects.toThrow('HTTP 401');
  expect(forbidden).toHaveBeenCalledOnce();
});

it('returns a validated QR only for the dedicated instance', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ base64: `data:image/png;base64,${png}`, pairingCode: '12345678' }), { status: 200 }));
  expect(await connectJobInstance({ ...options, fetcher })).toMatchObject({ qrCode: `data:image/png;base64,${png}`, pairingCode: '12345678' });
  expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:8080/instance/connect/procura-de-emprego');
  expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
});
