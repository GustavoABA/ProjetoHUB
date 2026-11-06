import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright-core';

interface LocatorLike { fill?(value: string): Promise<void>; click?(options?: { timeout?: number }): Promise<void>;
  isVisible?(): Promise<boolean>; waitFor?(options: { state: 'visible'; timeout: number }): Promise<void>; textContent?(): Promise<string | null>; count?(): Promise<number>;
  scrollIntoViewIfNeeded?(): Promise<void> }
interface PageLike {
  url(): string;
  goto(url: string): Promise<unknown>;
  screenshot(): Promise<Buffer>;
  locator(selector: string): LocatorLike;
  getByRole?(role: 'button', options: { name: string; exact: true }): LocatorLike;
  getByText?(text: string, options: { exact: true }): LocatorLike;
  getByLabel?(label: string, options: { exact: true }): LocatorLike;
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
  constructor(private readonly options: { profileDir: string; logFile: string; launch?: Launch; channel?: string; confirmationTimeoutMs?: number }) {
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
    const locator = page.locator(selector);
    if (!locator.fill) throw new Error('Preenchimento não suportado nesta página');
    await locator.fill(value);
    this.record('fill', page.url());
  }

  async submitAndConfirm(id: string, submitSelector: string, confirmationSelector: string): Promise<{ url: string; confirmationText: string; screenshot: Buffer }> {
    this.validateSelector(submitSelector); this.validateSelector(confirmationSelector);
    const page = this.page(id); this.ready();
    return this.submitLocators(page, page.locator(submitSelector), page.locator(confirmationSelector));
  }

  async submitByTextAndConfirm(id: string, buttonText: string, confirmationText: string): Promise<{ url: string; confirmationText: string; screenshot: Buffer }> {
    this.validateLabel(buttonText); this.validateLabel(confirmationText);
    const page = this.page(id); this.ready();
    if (!page.getByRole || !page.getByText) throw new Error('Localização por texto não suportada');
    return this.submitLocators(page, page.getByRole('button', { name: buttonText, exact: true }), page.getByText(confirmationText, { exact: true }));
  }

  async submissionReadyByText(id: string, buttonText: string, confirmationText: string): Promise<void> {
    this.validateLabel(buttonText); this.validateLabel(confirmationText);
    const page = this.page(id); this.ready();
    if (!page.getByRole || !page.getByText) throw new Error('Localização por texto não suportada');
    const button = page.getByRole('button', { name: buttonText, exact: true });
    if (!button.count || await button.count() !== 1) throw new Error('Botão final não encontrado de forma única');
    const confirmation = page.getByText(confirmationText, { exact: true });
    if (!confirmation.isVisible) throw new Error('Verificação de página não suportada');
    if (await confirmation.isVisible()) throw new Error('Confirmação já estava visível antes do envio');
  }

  async fillAnswersByLabel(id: string, answers: Record<string, string>): Promise<{ filled: string[]; missing: string[] }> {
    const page = this.page(id); this.ready();
    if (!page.getByLabel) throw new Error('Localização por rótulo não suportada');
    const filled: string[] = [], missing: string[] = [];
    for (const [label, value] of Object.entries(answers)) {
      this.validateLabel(label);
      const field = page.getByLabel(label, { exact: true });
      if (!field.count || await field.count() !== 1 || !field.fill) { missing.push(label); continue; }
      await field.fill(value);
      filled.push(label);
      this.record('fill', page.url());
    }
    return { filled, missing };
  }

  private async submitLocators(page: PageLike, submit: LocatorLike, confirmation: LocatorLike): Promise<{ url: string; confirmationText: string; screenshot: Buffer }> {
    if (!confirmation.isVisible || !confirmation.waitFor || !confirmation.textContent) throw new Error('Verificação de página não suportada');
    if (await confirmation.isVisible()) throw new Error('Confirmação já estava visível antes do envio');
    if (!submit.click) throw new Error('Clique não suportado nesta página');
    this.record('submission_attempt', page.url());
    await submit.click({ timeout: 15_000 });
    return this.confirmationEvidence(page, confirmation);
  }

  async verifyConfirmation(id: string, confirmationSelector: string): Promise<{ url: string; confirmationText: string; screenshot: Buffer }> {
    this.validateSelector(confirmationSelector);
    const page = this.page(id); this.ready();
    const confirmation = page.locator(confirmationSelector);
    if (!confirmation.waitFor || !confirmation.textContent) throw new Error('Verificação de página não suportada');
    return this.confirmationEvidence(page, confirmation);
  }
  async verifyConfirmationText(id: string, expectedText: string): Promise<{ url: string; confirmationText: string; screenshot: Buffer }> {
    this.validateLabel(expectedText);
    const page = this.page(id); this.ready();
    if (!page.getByText) throw new Error('Localização por texto não suportada');
    return this.confirmationEvidence(page, page.getByText(expectedText, { exact: true }));
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
  private validateSelector(selector: string): void {
    if (typeof selector !== 'string' || !selector.trim() || selector.length > 500) throw new Error('Seletor inválido');
  }
  private validateLabel(value: string): void {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Texto de página inválido');
  }
  private async confirmationEvidence(page: PageLike, locator: LocatorLike): Promise<{ url: string; confirmationText: string; screenshot: Buffer }> {
    if (!locator.waitFor || !locator.textContent) throw new Error('Verificação de página não suportada');
    await locator.waitFor!({ state: 'visible', timeout: this.options.confirmationTimeoutMs ?? 20_000 });
    const confirmationText = (await locator.textContent!())?.trim();
    if (!confirmationText) throw new Error('Confirmação visível sem texto verificável');
    await locator.scrollIntoViewIfNeeded?.();
    const screenshot = await page.screenshot();
    this.record('submission_confirmation', page.url());
    return { url: page.url(), confirmationText: confirmationText.slice(0, 500), screenshot };
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
