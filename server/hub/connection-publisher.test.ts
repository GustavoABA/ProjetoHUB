import { expect, test, vi } from 'vitest';
import { ConnectionPublisher } from './connection-publisher';

test('publica somente metadados permitidos e usa o SHA do arquivo existente', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'abc123' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ commit: { sha: 'commit123' } }), { status: 200 }));
  const publisher = new ConnectionPublisher('test-token', fetcher, 'AI-Working');
  await publisher.publish({ installationId: 'install-1', mcpUrl: 'https://office.ngrok.app/mcp',
    updatedAt: '2026-11-06T10:00:00.000Z', version: '1.0.3', status: 'online',
    sessionStartedAt: '2026-11-06T10:00:00.000Z', sessionExpiresAt: '2026-11-06T22:00:00.000Z' });
  const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  const published = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
  expect(body).toMatchObject({ branch: 'AI-Working', sha: 'abc123' });
  expect(published).toMatchObject({ mcpUrl: 'https://office.ngrok.app/mcp', status: 'online' });
  expect(JSON.stringify(body)).not.toContain('test-token');
  expect(publisher.status()).toMatchObject({ configured: true, lastCommit: 'commit123' });
});

test('sem token não envia requisições nem inventa publicação', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const publisher = new ConnectionPublisher(undefined, fetcher);
  await expect(publisher.publish({ installationId: 'x', mcpUrl: null, updatedAt: new Date().toISOString(),
    version: '1.0.3', status: 'offline', sessionStartedAt: new Date().toISOString(), sessionExpiresAt: new Date().toISOString() })).rejects.toThrow('GITHUB_TOKEN');
  expect(fetcher).not.toHaveBeenCalled();
  expect(publisher.status().lastCommit).toBeUndefined();
});
