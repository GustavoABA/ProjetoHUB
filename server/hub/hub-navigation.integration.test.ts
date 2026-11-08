import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta indisponível');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

it.skipIf(process.env.PROJECTHUB_UI_E2E !== '1')('navigates the real office HUD without losing edited fields', async () => {
  const edge = process.env.PROJECTHUB_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  if (!existsSync(edge)) throw new Error('Edge não encontrado para o teste visual');
  const dataDir = mkdtempSync(join(tmpdir(), 'projecthub-hud-tabs-'));
  const hubDir = join(dataDir, 'projecthub'); mkdirSync(hubDir);
  writeFileSync(join(hubDir, 'applications.json'), JSON.stringify({ version: 1, applications: [{
    id: '12345678-1234-1234-1234-123456789012', jobId: 'job-test', source: 'Teste local', sourceId: 'job-test',
    originalUrl: 'https://example.com/job-test', title: 'Vaga de teste', company: 'Empresa de teste',
    status: 'awaiting_approval', answers: { Disponibilidade: 'Confirmada' },
    createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z',
    history: [{ at: '2026-11-08T00:00:00.000Z', action: 'approval_requested' }],
  }] }));
  const port = await freePort();
  const child = spawn(process.execPath, ['dist/server/index.js'], { cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, HABBLAUD_DATA_DIR: dataDir, HABBLAUD_PORT: String(port), HABBLAUD_CODEX: '0',
      HABBLAUD_WORLD: '0', HABBLAUD_UPDATE_CHECK: '0', PROJECTHUB_MCP_PORT: '0' }, stdio: 'ignore' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/api/hub/agents`)).ok; } catch { /* starting */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Escritório não iniciou');
    browser = await chromium.launch({ executablePath: edge, headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#projecthub-open').waitFor();
    await expect.poll(() => page.locator('#hub-office-crew .hub-office-agent').filter({ hasText: 'Especialista em candidaturas' }).innerText())
      .toContain('Aguardando permissão');
    await page.locator('#hub-office-crew .hub-office-agent').filter({ hasText: 'Especialista em candidaturas' }).click();
    await expect.poll(() => page.locator('#hub-nav [data-view="applications"]').getAttribute('aria-selected')).toBe('true');
    await expect.poll(() => page.locator('#hub-application-form').isVisible()).toBe(true);
    await expect.poll(() => page.locator('#hub-applications').innerText()).toContain('Vaga de teste');
    await page.locator('#hub-nav [data-view="office"]').click();
    await page.locator('#projecthub-open').click();
    await expect.poll(() => page.locator('#hub-nav [data-view]').count()).toBe(7);
    await page.locator('#hub-nav [data-view="jobs"]').click();
    await expect.poll(() => page.locator('#hub-job-preferences').isVisible()).toBe(true);
    await expect.poll(() => page.locator('#hub-agent-form').isVisible()).toBe(false);
    await page.locator('#hub-job-preferences input[name="title"]').fill('Assistente');
    await page.locator('#hub-nav [data-view="tasks"]').click();
    await expect.poll(() => page.locator('#hub-task-form').isVisible()).toBe(true);
    await page.locator('#hub-nav [data-view="jobs"]').click();
    expect(await page.locator('#hub-job-preferences input[name="title"]').inputValue()).toBe('Assistente');
    await page.locator('#hub-nav [data-view="browser"]').click();
    await expect.poll(() => page.locator('#hub-browser-form').isVisible()).toBe(true);
    await page.locator('#hub-nav [data-view="settings"]').click();
    await expect.poll(() => page.locator('#hub-credential-form').isVisible()).toBe(true);
    await page.locator('#hub-nav [data-view="settings"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.locator('#hub-nav [data-view="agents"]').getAttribute('aria-selected')).toBe('true');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#hub-nav [data-view="jobs"]').click();
    await expect.poll(() => page.locator('#hub-job-preferences').isVisible()).toBe(true);
    expect(await page.locator('#projecthub-panel').evaluate((panel) => panel.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);
    await page.locator('#hub-nav [data-view="office"]').click();
    await expect.poll(() => page.locator('#projecthub-panel').isVisible()).toBe(false);
  } finally {
    await browser?.close();
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    rmSync(dataDir, { recursive: true, force: true });
  }
}, 60_000);
