import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Provider } from './router';
import { windowsCipher, type Cipher } from './evolution-settings';

type ExternalProvider = Exclude<Provider, 'ollama'>;
type State = { version: 1; keys: Partial<Record<ExternalProvider, string>> };
const ENV: Record<ExternalProvider, string> = {
  openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY', openrouter: 'OPENROUTER_API_KEY',
};
const providers = Object.keys(ENV) as ExternalProvider[];
function external(provider: Provider): asserts provider is ExternalProvider {
  if (!providers.includes(provider as ExternalProvider)) throw new Error('Provedor sem credencial de API configurável');
}

/** Credentials are encrypted for this Windows account; environment variables remain the only non-Windows source. */
export class ProviderCredentials {
  private state: State;
  constructor(private readonly file: string, private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly platform: NodeJS.Platform = process.platform, private readonly cipher: Cipher = windowsCipher) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed as State).version !== 1 || !(parsed as State).keys ||
          typeof (parsed as State).keys !== 'object' || Array.isArray((parsed as State).keys) ||
          Object.entries((parsed as State).keys).some(([provider, value]) => !providers.includes(provider as ExternalProvider) || typeof value !== 'string'))
        throw new Error('Credenciais de modelos incompatíveis ou corrompidas');
      this.state = parsed as State;
    } else this.state = { version: 1, keys: {} };
  }
  status(): Record<ExternalProvider, { configured: boolean; source: 'environment' | 'windows' | null }> {
    return Object.fromEntries(providers.map((provider) => [provider, {
      configured: Boolean(this.env[ENV[provider]] || (this.platform === 'win32' && this.state.keys[provider])),
      source: this.env[ENV[provider]] ? 'environment' : this.platform === 'win32' && this.state.keys[provider] ? 'windows' : null,
    }])) as ReturnType<ProviderCredentials['status']>;
  }
  configured(provider: Provider): boolean { return provider === 'ollama' || (providers.includes(provider as ExternalProvider) && this.status()[provider as ExternalProvider].configured); }
  async get(provider: Provider): Promise<string> {
    if (provider === 'ollama') return '';
    external(provider);
    if (this.env[ENV[provider]]) return this.env[ENV[provider]]!;
    const stored = this.state.keys[provider];
    if (this.platform !== 'win32' || !stored) return '';
    return this.cipher.unprotect(stored);
  }
  async set(provider: Provider, key: string): Promise<void> {
    external(provider);
    if (this.env[ENV[provider]]) throw new Error('Credencial fornecida pelo ambiente do serviço; altere-a na origem');
    if (this.platform !== 'win32') throw new Error('Salvar credenciais no painel está disponível somente no Windows');
    if (typeof key !== 'string' || key.length < 1 || key.length > 4096 || /[\r\n]/.test(key)) throw new Error('Credencial inválida');
    const protectedKey = await this.cipher.protect(key);
    this.state.keys[provider] = protectedKey;
    this.save();
  }
  clear(provider: Provider): void {
    external(provider);
    if (this.env[ENV[provider]]) throw new Error('Credencial fornecida pelo ambiente do serviço; altere-a na origem');
    delete this.state.keys[provider];
    this.save();
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}
