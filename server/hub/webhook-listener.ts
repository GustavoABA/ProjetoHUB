import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname } from 'node:path';
import type { HubStore } from './store';
import { handleWhatsAppWebhook } from './whatsapp-http';
import type { WhatsAppStore } from './whatsapp';

type Settings = { version: 1; enabled: boolean; port: number; exposeLan: boolean };
export type WebhookListenerStatus = { enabled: boolean; port: number; exposeLan: boolean; bind: '127.0.0.1' | '0.0.0.0'; running: boolean; error?: string };

function validPort(port: number, reserved: readonly number[]): void {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('Porta do webhook inválida');
  if (reserved.includes(port)) throw new Error('Porta do webhook reservada por outro serviço do escritório');
}

/** Owns only the dedicated authenticated WhatsApp listener; settings survive restarts. */
export class WebhookListener {
  private settings: Settings;
  private server?: http.Server;
  private boundPort?: number;
  private boundHost?: '127.0.0.1' | '0.0.0.0';
  private lastError?: string;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string, private readonly whatsapp: WhatsAppStore, private readonly hub: HubStore,
    env: NodeJS.ProcessEnv = process.env, private readonly reserved: readonly number[] = []) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed as Settings).version !== 1 ||
          typeof (parsed as Settings).enabled !== 'boolean' || typeof (parsed as Settings).exposeLan !== 'boolean')
        throw new Error('Configuração do listener WhatsApp incompatível ou corrompida');
      this.settings = parsed as Settings;
      validPort(this.settings.port, []);
    } else {
      const port = Number(env.PROJECTHUB_WHATSAPP_WEBHOOK_PORT);
      this.settings = { version: 1, enabled: Number.isSafeInteger(port) && port > 0 && port <= 65_535,
        port: Number.isSafeInteger(port) && port > 0 && port <= 65_535 ? port : 4770,
        exposeLan: env.PROJECTHUB_WHATSAPP_WEBHOOK_BIND === '0.0.0.0' };
    }
  }

  status(): WebhookListenerStatus {
    const bind = this.settings.exposeLan ? '0.0.0.0' : '127.0.0.1';
    return { enabled: this.settings.enabled, port: this.settings.port, exposeLan: this.settings.exposeLan, bind,
      running: Boolean(this.server?.listening), ...(this.lastError ? { error: this.lastError } : {}) };
  }

  configure(input: { enabled: boolean; port: number; exposeLan: boolean }): Promise<WebhookListenerStatus> {
    return this.enqueue(async () => {
      if (typeof input.enabled !== 'boolean' || typeof input.exposeLan !== 'boolean') throw new Error('Configuração do webhook inválida');
      validPort(input.port, this.reserved);
      this.settings = { version: 1, ...input };
      this.save();
      return this.apply();
    });
  }

  reconcile(): Promise<WebhookListenerStatus> { return this.enqueue(() => this.apply()); }
  close(): Promise<void> { return this.enqueue(async () => { await this.stopServer(); }); }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operation.then(work, work);
    this.operation = next.catch(() => {});
    return next;
  }

  private async apply(): Promise<WebhookListenerStatus> {
    const bind = this.settings.exposeLan ? '0.0.0.0' : '127.0.0.1';
    if (!this.settings.enabled) { await this.stopServer(); this.lastError = undefined; return this.status(); }
    if (this.reserved.includes(this.settings.port)) {
      await this.stopServer(); this.lastError = 'Porta do webhook reservada por outro serviço do escritório'; return this.status();
    }
    if (this.server?.listening && this.boundPort === this.settings.port && this.boundHost === bind) return this.status();
    await this.stopServer();
    const server = http.createServer((req, res) => handleWhatsAppWebhook(req, res, this.whatsapp, this.hub));
    const error = await new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
      const onError = (cause: NodeJS.ErrnoException) => { server.off('listening', onListening); resolve(cause); };
      const onListening = () => { server.off('error', onError); resolve(undefined); };
      server.once('error', onError);
      server.once('listening', onListening);
      try { server.listen(this.settings.port, bind); } catch (cause) { server.off('error', onError); server.off('listening', onListening); resolve(cause as NodeJS.ErrnoException); }
    });
    if (error) { this.lastError = error.code === 'EADDRINUSE' ? 'Porta em uso' : `Falha ao abrir listener (${error.code ?? 'erro desconhecido'})`; return this.status(); }
    this.server = server; this.boundPort = this.settings.port; this.boundHost = bind; this.lastError = undefined;
    server.on('error', (cause: NodeJS.ErrnoException) => {
      this.lastError = `Listener interrompido (${cause.code ?? 'erro desconhecido'})`;
      if (this.server === server) { this.server = undefined; this.boundPort = undefined; this.boundHost = undefined; }
      server.close();
    });
    return this.status();
  }

  private async stopServer(): Promise<void> {
    const server = this.server;
    this.server = undefined; this.boundPort = undefined; this.boundHost = undefined;
    if (!server?.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.settings, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}
