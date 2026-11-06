import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { BrowserManager } from './browser';
import { ApplicationStore } from './applications';
import { HubStore } from './store';
import { handleHubRoute } from './http';

it.skipIf(process.env.PROJECTHUB_E2E !== '1')('preenche e confirma uma candidatura apenas após resposta real da página local', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-application-edge-'));
  let posts = 0;
  const store = new ApplicationStore(join(dir, 'applications.json'));
  const hub = new HubStore(join(dir, 'state.json'));
  const browser = new BrowserManager({ profileDir: join(dir, 'profile'), logFile: join(dir, 'navigation.jsonl'), confirmationTimeoutMs: 1_000 });
  const site = createServer((req, res) => {
    if (req.url?.startsWith('/api/hub/') && handleHubRoute(req, res, new URL(req.url, 'http://localhost'), hub, undefined, fetch, browser, undefined, store)) return;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.method === 'POST') { posts++; res.end(req.url === '/unconfirmed' ? '<h1>Sem confirmação de envio</h1>' : '<h1>Candidatura de teste recebida</h1>'); return; }
    res.end('<form method="post"><label for="name">Nome</label><input id="name" name="name"><button type="submit">Enviar candidatura de teste</button></form>');
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  const address = site.address(); if (!address || typeof address === 'string') throw new Error('Sem porta');
  try {
    const app = store.create({ jobId: 'local-test', source: 'LocalTest', sourceId: '1', originalUrl: 'https://example.com/test-only', title: 'Teste local', company: 'Servidor local' });
    store.setAnswers(app.id, { Nome: 'Pessoa de teste' }); store.requestApproval(app.id);
    await browser.start({ headless: true });
    const page = await browser.open(`http://127.0.0.1:${address.port}/apply`);
    const base = `http://127.0.0.1:${address.port}/api/hub/applications/${app.id}`;
    const send = (action: string, body: object) => fetch(`${base}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const fields = await send('prepare', { pageId: page.id });
    expect(await fields.json()).toEqual({ filled: ['Nome'], missing: [] });
    const finalBody = { pageId: page.id, buttonText: 'Enviar candidatura de teste', confirmationText: 'Candidatura de teste recebida' };
    expect((await send('submit', finalBody)).status).toBe(400);
    expect(posts).toBe(0);
    store.approve(app.id);
    const submitted = await send('submit', finalBody);
    expect(submitted.status).toBe(200);
    expect(await submitted.json()).toMatchObject({ status: 'submitted', submission: { confirmationText: 'Candidatura de teste recebida' } });
    expect(posts).toBe(1);
    expect(new ApplicationStore(join(dir, 'applications.json')).get(app.id)?.status).toBe('submitted');
    const proof = await fetch(`${base}/evidence`);
    expect(proof.status).toBe(200);
    expect(Buffer.from(await proof.arrayBuffer()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const other = store.create({ jobId: 'local-test-2', source: 'LocalTest', sourceId: '2', originalUrl: 'https://example.com/test-only-2', title: 'Teste local 2', company: 'Servidor local' });
    store.setAnswers(other.id, { Nome: 'Pessoa de teste' }); store.requestApproval(other.id); store.approve(other.id);
    const otherPage = await browser.open(`http://127.0.0.1:${address.port}/unconfirmed`);
    const uncertain = await fetch(`http://127.0.0.1:${address.port}/api/hub/applications/${other.id}/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...finalBody, pageId: otherPage.id }),
    });
    expect(uncertain.status).toBe(202);
    expect((await uncertain.json()).status).toBe('submission_uncertain');
    expect(posts).toBe(2);
    const duplicate = await fetch(`http://127.0.0.1:${address.port}/api/hub/applications/${other.id}/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...finalBody, pageId: otherPage.id }),
    });
    expect(duplicate.status).toBe(400);
    expect(posts).toBe(2);
  } finally {
    await browser.stop().catch(() => {});
    await new Promise<void>((resolve) => site.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
