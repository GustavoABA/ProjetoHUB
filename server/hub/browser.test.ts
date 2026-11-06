import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserManager } from './browser';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'projecthub-browser-')); dirs.push(dir);
  let current = 'about:blank';
  const page = { url: () => current, goto: vi.fn(async (url: string) => { current = url; }), screenshot: vi.fn(async () => Buffer.from('png')), locator: vi.fn(() => ({ fill: vi.fn(async () => {}) })), isClosed: () => false, close: vi.fn(async () => {}) };
  const context = { pages: () => [], newPage: vi.fn(async () => page), close: vi.fn(async () => {}), on: vi.fn() };
  const launch = vi.fn(async () => context);
  return { dir, page, context, launch, manager: new BrowserManager({ profileDir: join(dir, 'profile'), logFile: join(dir, 'navigation.jsonl'), launch }) };
}

it('uses a dedicated persistent profile, navigates and records only safe URL components', async () => {
  const { dir, launch, manager } = fixture();
  await manager.start({ headless: true });
  expect(launch).toHaveBeenCalledWith(join(dir, 'profile'), expect.objectContaining({ headless: true }));
  const page = await manager.open('https://example.com/jobs?token=secret#fragment');
  expect(manager.status().pages).toMatchObject([{ id: page.id, url: 'https://example.com/jobs?token=secret#fragment' }]);
  const log = readFileSync(join(dir, 'navigation.jsonl'), 'utf8');
  expect(log).toContain('https://example.com');
  expect(log).not.toContain('/jobs');
  expect(log).not.toContain('secret');
});

it('rejects non-web navigation and suspends automation during manual takeover', async () => {
  const { manager, page } = fixture();
  await manager.start({ headless: false });
  await expect(manager.open('file:///C:/secret')).rejects.toThrow();
  const tab = await manager.open('https://example.com');
  manager.setManual(true);
  await expect(manager.navigate(tab.id, 'https://example.com/next')).rejects.toThrow('manual');
  await expect(manager.fill(tab.id, 'input[name=email]', 'x@y.com')).rejects.toThrow('manual');
  expect(await manager.screenshot(tab.id)).toEqual(Buffer.from('png'));
  expect(page.goto).toHaveBeenCalledTimes(1);
});
