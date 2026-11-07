import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Cipher = { protect(value: string): Promise<string>; unprotect(value: string): Promise<string> };
type State = { version: 1; baseUrl: string; protectedKey?: string };
const DEFAULT_URL = 'http://127.0.0.1:8080';

function privateHttpHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === 'host.docker.internal' || host === '::1') return true;
  if (isIP(host) !== 4) return false;
  const parts = host.split('.').map(Number);
  return parts[0] === 127 || parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}
function baseUrl(value: string): string {
  if (typeof value !== 'string' || value.length > 500) throw new Error('URL da Evolution inválida');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('URL da Evolution inválida'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      (url.protocol === 'http:' && !privateHttpHost(url.hostname))) throw new Error('Use HTTPS ou HTTP em endereço local, sem credenciais na URL');
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}

function dpapi(action: 'Protect' | 'Unprotect', value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'credential-windows.ps1');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(output); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Proteção da credencial excedeu o tempo limite')); }, 15_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; if (output.length > 20_000) { child.kill(); finish(new Error('Resposta de proteção inválida')); } });
    child.stderr.resume(); // Never include the process output in logs or HTTP errors.
    child.on('error', () => finish(new Error('Proteção de credenciais do Windows indisponível')));
    child.on('close', (code) => finish(code === 0 && output ? undefined : new Error('Falha na proteção da credencial')));
    child.stdin.on('error', () => {});
    child.stdin.end(value, 'utf8');
  });
}
const windowsCipher: Cipher = { protect: (value) => dpapi('Protect', value), unprotect: (value) => dpapi('Unprotect', value) };

/** The Evolution key is encrypted for the current Windows user; Linux/Docker can use an environment key. */
export class EvolutionSettings {
  private state: State;
  constructor(private readonly file: string, private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly platform: NodeJS.Platform = process.platform, private readonly cipher: Cipher = windowsCipher) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed as State).version !== 1 || typeof (parsed as State).baseUrl !== 'string' ||
          ((parsed as State).protectedKey !== undefined && typeof (parsed as State).protectedKey !== 'string')) throw new Error('Configuração Evolution inválida');
      this.state = parsed as State;
      this.state.baseUrl = baseUrl(this.state.baseUrl);
    } else this.state = { version: 1, baseUrl: DEFAULT_URL };
  }
  status() {
    return { baseUrl: this.state.baseUrl, apiKeyConfigured: Boolean(this.env.EVOLUTION_API_KEY || (this.platform === 'win32' && this.state.protectedKey)),
      apiKeySource: this.env.EVOLUTION_API_KEY ? 'environment' : this.platform === 'win32' && this.state.protectedKey ? 'windows' : null };
  }
  async apiKey(): Promise<string> {
    if (this.env.EVOLUTION_API_KEY) return this.env.EVOLUTION_API_KEY;
    if (this.platform !== 'win32' || !this.state.protectedKey) return '';
    return this.cipher.unprotect(this.state.protectedKey);
  }
  async configure(input: { baseUrl?: string; apiKey?: string }) {
    const url = input.baseUrl === undefined ? this.state.baseUrl : baseUrl(input.baseUrl);
    let protectedKey = this.state.protectedKey;
    if (input.apiKey !== undefined) {
      if (this.platform !== 'win32') throw new Error('Salvar chave no painel está disponível somente no Windows; use EVOLUTION_API_KEY neste ambiente');
      if (typeof input.apiKey !== 'string' || input.apiKey.length < 1 || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) throw new Error('Chave Evolution inválida');
      protectedKey = await this.cipher.protect(input.apiKey);
    }
    this.state = { version: 1, baseUrl: url, ...(protectedKey ? { protectedKey } : {}) };
    this.save();
    return this.status();
  }
  clearKey() { delete this.state.protectedKey; this.save(); return this.status(); }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}
