import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

type Action = 'Status' | 'Install' | 'Remove';
type Runner = (action: Action) => Promise<string>;
export type WindowsStartupStatus = { supported: boolean; enabled: boolean; shortcut?: string; error?: string };
const execFileAsync = promisify(execFile);

async function runScript(action: Action): Promise<string> {
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'autostart-windows.ps1');
  if (!existsSync(script)) throw new Error('Script de inicialização automática não encontrado');
  const { stdout } = await execFileAsync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action],
    { windowsHide: true, timeout: 15_000, maxBuffer: 100_000 });
  return stdout.trim();
}

/** Controls only this installation's shortcut in the current user's Startup folder. */
export class WindowsStartupManager {
  constructor(private readonly runner: Runner = runScript, private readonly platform: NodeJS.Platform = process.platform) {}
  private async read(action: Action): Promise<WindowsStartupStatus & { installed: boolean; owned: boolean }> {
    const raw = JSON.parse(await this.runner(action)) as { installed?: unknown; owned?: unknown; shortcut?: unknown };
    if (typeof raw.installed !== 'boolean' || typeof raw.owned !== 'boolean') throw new Error('Resposta inválida do inicializador');
    return { supported: true, enabled: raw.installed && raw.owned, installed: raw.installed, owned: raw.owned,
      shortcut: typeof raw.shortcut === 'string' ? raw.shortcut : undefined };
  }
  async status(): Promise<WindowsStartupStatus> {
    if (this.platform !== 'win32') return { supported: false, enabled: false };
    const { owned: _owned, installed: _installed, ...status } = await this.read('Status');
    return status;
  }
  async setEnabled(enabled: boolean): Promise<WindowsStartupStatus> {
    if (this.platform !== 'win32') throw new Error('Inicialização automática disponível somente no Windows');
    if (typeof enabled !== 'boolean') throw new Error('Estado inválido');
    const current = await this.read('Status');
    if (current.installed && !current.owned) throw new Error('O atalho pertence a outra instalação');
    const { owned: _owned, installed: _installed, ...status } = await this.read(enabled ? 'Install' : 'Remove');
    return status;
  }
}
