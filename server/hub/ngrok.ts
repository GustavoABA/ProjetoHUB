import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type NgrokStatus = { installed: boolean; running: boolean; publicUrl?: string; mcpUrl?: string; checkedAt?: string; error?: string };

/** Read the local ngrok agent API without accepting another tunnel's URL. */
export function ngrokEndpoint(raw: unknown, port: number): string | undefined {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { tunnels?: unknown }).tunnels)) return;
  for (const item of (raw as { tunnels: unknown[] }).tunnels) {
    if (!item || typeof item !== 'object') continue;
    const tunnel = item as { public_url?: unknown; config?: { addr?: unknown } };
    if (typeof tunnel.public_url !== 'string' || typeof tunnel.config?.addr !== 'string') continue;
    let publicUrl: URL, upstream: URL;
    try {
      publicUrl = new URL(tunnel.public_url);
      upstream = new URL(tunnel.config.addr.includes('://') ? tunnel.config.addr : `http://${/^\d+$/.test(tunnel.config.addr) ? `localhost:${tunnel.config.addr}` : tunnel.config.addr}`);
    } catch { continue; }
    if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/' ||
        upstream.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(upstream.hostname) || Number(upstream.port) !== port) continue;
    return publicUrl.origin;
  }
}

function findNgrok(): string | undefined {
  const configured = process.env.PROJECTHUB_NGROK_BIN;
  if (configured) return existsSync(configured) ? configured : undefined;
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const found = spawnSync(finder, ['ngrok'], { encoding: 'utf8', windowsHide: true, timeout: 2_000 });
  if (found.status === 0) return found.stdout.trim().split(/\r?\n/)[0];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const packages = join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
    if (existsSync(packages)) for (const entry of readdirSync(packages).filter((name) => name.startsWith('Ngrok.Ngrok_'))) {
      const candidate = join(packages, entry, 'ngrok.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export class NgrokManager {
  private child: ChildProcess | undefined;
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private stopped = false;
  private last: NgrokStatus = { installed: false, running: false };
  constructor(private readonly port: number, private readonly onChange: (status: NgrokStatus) => void,
    private readonly fetcher: typeof fetch = fetch, private readonly binary: string | undefined = findNgrok()) {
    this.last.installed = Boolean(binary);
  }
  status(): NgrokStatus { return { ...this.last }; }
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    void this.check();
    this.timer = setInterval(() => { void this.check(); }, 30_000);
    this.timer.unref();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.child?.kill();
    this.child = undefined;
    this.update({ installed: Boolean(this.binary), running: false });
  }
  async check(): Promise<NgrokStatus> {
    if (this.busy || this.stopped) return this.status();
    this.busy = true;
    try {
      if (!this.binary) { this.update({ installed: false, running: false, error: 'ngrok não encontrado; instale e configure o agente' }); return this.status(); }
      if (!this.child || this.child.exitCode !== null || this.child.killed) {
        const config = spawnSync(this.binary, ['config', 'check'], { windowsHide: true, stdio: 'ignore', timeout: 5_000 });
        if (config.status !== 0) { this.update({ installed: true, running: false, error: 'Configuração ngrok ausente ou inválida; configure a conta no agente' }); return this.status(); }
        const child = spawn(this.binary, ['http', String(this.port), '--log=stdout', '--log-format=json', '--log-level=warn'],
          { windowsHide: true, stdio: 'ignore' });
        this.child = child;
        child.on('error', () => { if (this.child !== child) return; this.child = undefined; this.update({ installed: true, running: false, error: 'Falha ao iniciar o ngrok' }); });
        child.on('exit', () => { if (this.child !== child) return; this.child = undefined; this.update({ installed: true, running: false, error: 'Túnel ngrok encerrado' }); });
      }
      const response = await this.fetcher('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(3_000) });
      if (!response.ok) throw new Error('API local do ngrok indisponível');
      const url = ngrokEndpoint(await response.json(), this.port);
      if (!url) throw new Error('Nenhum túnel HTTPS apontando para a porta MCP');
      const health = await this.fetcher(`${url}/health`, { headers: { 'ngrok-skip-browser-warning': 'true' }, signal: AbortSignal.timeout(5_000) });
      if (!health.ok || (await health.json() as { service?: string }).service !== 'projecthub-mcp') throw new Error('Endpoint público não confirmou o serviço MCP');
      if (!this.child || this.child.exitCode !== null || this.child.killed) throw new Error('Processo ngrok encerrou durante a verificação');
      this.update({ installed: true, running: true, publicUrl: url, mcpUrl: `${url}/mcp`, checkedAt: new Date().toISOString() });
    } catch (error) {
      this.update({ installed: true, running: false, error: error instanceof Error ? error.message : 'Falha de conexão ngrok', checkedAt: new Date().toISOString() });
    } finally { this.busy = false; }
    return this.status();
  }
  private update(next: NgrokStatus): void {
    if (JSON.stringify(this.last) !== JSON.stringify(next)) { this.last = next; this.onChange(this.status()); }
  }
}
