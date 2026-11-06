import { expect, test, vi } from 'vitest';
import { ngrokEndpoint } from './ngrok';

test('aceita apenas endpoint HTTPS que encaminha para a porta MCP', () => {
  const list = { tunnels: [
    { public_url: 'https://other.ngrok.app', config: { addr: 'http://localhost:9999' } },
    { public_url: 'https://office.ngrok.app', config: { addr: 'http://localhost:4748' } },
  ] };
  expect(ngrokEndpoint(list, 4748)).toBe('https://office.ngrok.app');
  expect(ngrokEndpoint(list, 4749)).toBeUndefined();
  expect(ngrokEndpoint({ tunnels: [{ public_url: 'http://office.ngrok.app', config: { addr: '4748' } }] }, 4748)).toBeUndefined();
  expect(ngrokEndpoint({ tunnels: [{ public_url: 'https://office.ngrok.app', config: { addr: 'http://evil.example:4748' } }] }, 4748)).toBeUndefined();
});
