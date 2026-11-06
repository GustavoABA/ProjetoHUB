import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright-core';

interface PageLike {
  url(): string;
  goto(url: string): Promise<unknown>;
  screenshot(): Promise<Buffer>;
  locator(selector: string): { fill(value: string): Promise<void> };
  isClosed(): boolean;
  close(): Promise<void>;
}
interface ContextLike {
  pages(): PageLike[];
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
  on?(event: 'close', listener: () => void): void;
}
type Launch = (profileDir: string, options: { headless: boolean; channel: string }) => Promise<ContextLike>;

function webUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('URL inválida'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Navegação permitida apenas para HTTP ou HTTPS');
  if (url.username || url.password) throw new Error('Credenciais na URL não são permitidas');
  return url.href;
}

/** Dedicated Playwright profile. A visible browser remains available for human login. */
export class BrowserManager {
  private context?: ContextLike;
  private pages = new Map<string, PageLike>();
  private manual = false;
  private headless = false;
  private readonly launch: Launch;
  constructor(private readonly options: { profileDir: string; logFile: string; launch?: Launch; channel?: string }) {
    this.launch = options.launch ?? ((dir, settings) => chromium.launchPersistentContext(dir, { channel: settings.channel, headless: settings.headless, acceptDownloads: true }));
  }

  async start(input: { headless: boolean }): Promise<ReturnType<BrowserManager['status']>> {
    if (this.context) return this.status();
    mkdirSync(this.options.profileDir, { recursive: true });
    this.context = await this.launch(this.options.profileDir, { headless: input.headless, channel: this.options.channel ?? (process.platform === 'win32' ? 'msedge' : 'chromium') });
    const opened = this.context;
    opened.on?.('close', () => { if (this.context === opened) { this.context = undefined; this.pages.clear(); this.manual = false; } });
    this.headless = input.headless;
    this.manual = false;
    for (const page of this.context.pages()) this.register(page);
    return this.status();
  }

  status(): { running: boolean; headless: boolean; manual: boolean; pages: { id: string; url: string }[] } {
    if (this.context) for (const page of this.context.pages()) this.register(page);
    for (const [id, page] of this.pages) if (page.isClosed()) this.pages.delete(id);
    return { running: !!this.context, headless: this.headless, manual: this.manual, pages: [...this.pages].map(([id, page]) => ({ id, url: page.url() })) };
  }

  setManual(value: boolean): void {
    if (!this.context) throw new Error('Navegador desligado');
    if (value && this.headless) throw new Error('Controle manual exige navegador visível');
    this.manual = value;
  }

  async open(rawUrl: string): Promise<{ id: string; url: string }> {
    const url = webUrl(rawUrl);
    const context = this.ready();
    const page = await context.newPage();
    const id = this.register(page);
    try {
      await page.goto(url);
      this.record('navigate', page.url());
      return { id, url: page.url() };
    } catch (error) {
      this.pages.delete(id);
      await page.close().catch(() => {});
      throw error;
    }
  }

  async navigate(id: string, rawUrl: string): Promise<{ id: string; url: string }> {
    const url = webUrl(rawUrl);
    const page = this.page(id);
    this.ready();
    await page.goto(url);
    this.record('navigate', page.url());
    return { id, url: page.url() };
  }

  async fill(id: string, selector: string, value: string): Promise<void> {
    if (!selector?.trim() || selector.length > 500) throw new Error('Seletor inválido');
    const page = this.page(id);
    this.ready();
    await page.locator(selector).fill(value);
    this.record('fill', page.url());
  }

  async screenshot(id: string): Promise<Buffer> { return this.page(id).screenshot(); }

  async stop(): Promise<void> {
    const context = this.context;
    this.context = undefined;
    this.pages.clear();
    this.manual = false;
    if (context) await context.close();
  }

  private ready(): ContextLike {
    if (!this.context) throw new Error('Navegador desligado');
    if (this.manual) throw new Error('Controle manual ativo; automação suspensa');
    return this.context;
  }
  private page(id: string): PageLike {
    const page = this.pages.get(id);
    if (!page || page.isClosed()) throw new Error('Página não encontrada');
    return page;
  }
  private register(page: PageLike): string {
    for (const [id, existing] of this.pages) if (existing === page) return id;
    const id = randomUUID(); this.pages.set(id, page); return id;
  }
  private record(action: string, rawUrl: string): void {
    const url = new URL(rawUrl);
    const pathHash = createHash('sha256').update(url.pathname).digest('hex').slice(0, 12);
    mkdirSync(dirname(this.options.logFile), { recursive: true });
    appendFileSync(this.options.logFile, JSON.stringify({ at: new Date().toISOString(), action, origin: url.origin, pathHash }) + '\n', 'utf8');
  }
}
