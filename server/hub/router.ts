import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderCredentials } from './provider-credentials';

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'openrouter' | 'ollama';
export type Message = { role: 'system' | 'user' | 'assistant'; content: string };
export type Model = { id: string; provider: Provider; model: string; priority: number; enabled: boolean; createdAt: string };
type State = { version: 1; models: Model[]; usage: { inputTokens: number; outputTokens: number; requests: number }; lastError?: string };
export type Completion = { text: string; provider: Provider; model: string; inputTokens: number | null; outputTokens: number | null };
const endpoints: Record<Provider, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  ollama: 'http://127.0.0.1:11434/v1/chat/completions',
};
const keys: Record<Provider, string | null> = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', deepseek: 'DEEPSEEK_API_KEY', openrouter: 'OPENROUTER_API_KEY', ollama: null };
const providers = Object.keys(endpoints) as Provider[];

function tokenCount(value: unknown): number | null { return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null; }
function validMessages(messages: Message[]): void {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50 || messages.some((m) => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 40_000)) throw new Error('Mensagens inválidas');
}

export class ModelRouter {
  private state: State;
  constructor(public readonly file: string, private readonly fetcher: typeof fetch = fetch, private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly credentials?: ProviderCredentials) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed as State).version !== 1 || !Array.isArray((parsed as State).models) || !(parsed as State).usage) throw new Error('Configuração de modelos incompatível ou corrompida');
      this.state = parsed as State;
    } else this.state = { version: 1, models: [], usage: { inputTokens: 0, outputTokens: 0, requests: 0 } };
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2));
    renameSync(temp, this.file);
  }
  status() {
    return { models: this.state.models.map((m) => ({ ...m, available: m.enabled && (this.credentials?.configured(m.provider) ?? (keys[m.provider] === null || Boolean(this.env[keys[m.provider]!]))) })), usage: { ...this.state.usage }, lastError: this.state.lastError };
  }
  /** Register the smallest installed local model only when the user has not configured Ollama. */
  async discoverLocalModel(): Promise<Model | undefined> {
    const configured = this.state.models.find((model) => model.provider === 'ollama');
    if (configured) return configured.enabled ? { ...configured } : undefined;
    try {
      const response = await this.fetcher('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return undefined;
      const data: unknown = await response.json();
      const candidates = (data as { models?: unknown })?.models;
      if (!Array.isArray(candidates)) return undefined;
      const models = candidates.filter((item): item is { name: string; size?: number } =>
        !!item && typeof item === 'object' && typeof item.name === 'string' && /^[\w./:-]{1,150}$/.test(item.name));
      models.sort((a, b) => (Number.isFinite(a.size) ? a.size! : Number.MAX_SAFE_INTEGER) -
        (Number.isFinite(b.size) ? b.size! : Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
      return models[0] ? this.add({ provider: 'ollama', model: models[0].name, priority: 100 }) : undefined;
    } catch { return undefined; }
  }
  add(input: { provider: Provider; model: string; priority: number; enabled?: boolean }): Model {
    if (!providers.includes(input.provider)) throw new Error('Provedor desconhecido');
    if (typeof input.model !== 'string' || !/^[\w./:-]{1,150}$/.test(input.model)) throw new Error('Nome de modelo inválido');
    if (!Number.isSafeInteger(input.priority) || input.priority < 1 || input.priority > 1000) throw new Error('Prioridade inválida');
    if (this.state.models.some((m) => m.provider === input.provider && m.model === input.model)) throw new Error('Modelo já cadastrado');
    const model: Model = { id: randomUUID(), provider: input.provider, model: input.model, priority: input.priority, enabled: input.enabled ?? true, createdAt: new Date().toISOString() };
    this.state.models.push(model); this.save(); return model;
  }
  remove(id: string): boolean {
    const before = this.state.models.length;
    this.state.models = this.state.models.filter((m) => m.id !== id);
    if (before !== this.state.models.length) this.save();
    return before !== this.state.models.length;
  }
  update(id: string, changes: { priority?: number; enabled?: boolean }): Model {
    const model = this.state.models.find((m) => m.id === id);
    if (!model) throw new Error('Modelo não encontrado');
    if (changes.priority !== undefined) {
      if (!Number.isSafeInteger(changes.priority) || changes.priority < 1 || changes.priority > 1000) throw new Error('Prioridade inválida');
      model.priority = changes.priority;
    }
    if (changes.enabled !== undefined) {
      if (typeof changes.enabled !== 'boolean') throw new Error('Estado inválido');
      model.enabled = changes.enabled;
    }
    this.save(); return { ...model };
  }
  async complete(messages: Message[], onlyProvider?: Provider, onlyModelId?: string, fallbackModelIds?: string[]): Promise<Completion> {
    validMessages(messages);
    if (onlyModelId && !this.state.models.some((m) => m.id === onlyModelId) && !fallbackModelIds?.length) throw new Error('Modelo selecionado não encontrado');
    if (fallbackModelIds !== undefined && (!onlyModelId || onlyProvider || !Array.isArray(fallbackModelIds) || fallbackModelIds.length > 3 ||
      fallbackModelIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) ||
      new Set([onlyModelId, ...fallbackModelIds]).size !== fallbackModelIds.length + 1)) throw new Error('Modelos de reserva inválidos');
    const orderedIds = onlyModelId ? [onlyModelId, ...(fallbackModelIds ?? [])] : undefined;
    const available = this.state.models.filter((m) => m.enabled && (!onlyProvider || m.provider === onlyProvider) &&
      (!orderedIds || orderedIds.includes(m.id)) && (this.credentials?.configured(m.provider) ?? (keys[m.provider] === null || this.env[keys[m.provider]!]))).sort((a, b) =>
      orderedIds ? orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id) : a.priority - b.priority);
    if (onlyModelId && !available.length) throw new Error('Modelo selecionado indisponível; verifique a credencial e o estado do modelo');
    if (!available.length) throw new Error('Nenhum modelo disponível: cadastre um modelo e configure a credencial do provedor');
    for (const model of available) {
      let key: string | undefined;
      try { key = this.credentials ? await this.credentials.get(model.provider) : keys[model.provider] ? this.env[keys[model.provider]!] : undefined; }
      catch { this.state.lastError = `${model.provider}: credencial local indisponível`; this.save(); continue; }
      const anthropic = model.provider === 'anthropic';
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const body = anthropic ? { model: model.model, max_tokens: 1024, ...(system ? { system } : {}), messages: messages.filter((m) => m.role !== 'system') } : { model: model.model, messages };
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (anthropic) { headers['x-api-key'] = key!; headers['anthropic-version'] = '2023-06-01'; }
      else if (key) headers.Authorization = `Bearer ${key}`;
      if (model.provider === 'gemini') headers['x-goog-api-client'] = 'projecthub/0.1';
      try {
        const response = await this.fetcher(endpoints[model.provider], { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(model.provider === 'ollama' ? 180_000 : 60_000) });
        if (!response.ok) {
          this.state.lastError = `${model.provider}: HTTP ${response.status}`; this.save();
          if (response.status === 429 || response.status >= 500) continue;
          throw new Error(this.state.lastError);
        }
        const raw: unknown = await response.json();
        const data = raw as Record<string, any>;
        const text = anthropic ? data.content?.filter((v: any) => v?.type === 'text').map((v: any) => v.text).join('') : data.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) throw new Error(`${model.provider}: resposta sem texto`);
        const inputTokens = tokenCount(anthropic ? data.usage?.input_tokens : data.usage?.prompt_tokens);
        const outputTokens = tokenCount(anthropic ? data.usage?.output_tokens : data.usage?.completion_tokens);
        this.state.usage.inputTokens += inputTokens ?? 0; this.state.usage.outputTokens += outputTokens ?? 0; this.state.usage.requests++;
        this.state.lastError = undefined; this.save();
        return { text, provider: model.provider, model: model.model, inputTokens, outputTokens };
      } catch (error) {
        if (error instanceof Error && /: HTTP (400|401|403|404|422)\b/.test(error.message)) throw error;
        this.state.lastError = `${model.provider}: falha de comunicação ou resposta`; this.save();
      }
    }
    throw new Error('Todos os modelos disponíveis falharam; verifique o estado do roteador');
  }
}
