import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderCredentials } from './provider-credentials';

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'openrouter' | 'ollama';
export type Message = { role: 'system' | 'user' | 'assistant'; content: string };
export type Model = { id: string; provider: Provider; model: string; priority: number; enabled: boolean; createdAt: string;
  monthlyRequestLimit?: number; monthlyCostLimitUsd?: number; inputUsdPerMillion?: number; outputUsdPerMillion?: number };
type ModelUsage = { month: string; requests: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; unpricedRequests: number };
type UsagePolicy = Pick<Model, 'monthlyRequestLimit' | 'monthlyCostLimitUsd' | 'inputUsdPerMillion' | 'outputUsdPerMillion'>;
type UsagePolicyChanges = { [K in keyof UsagePolicy]?: number | null };
export type AgentUsagePolicy = { agentId: string; monthlyRequestLimit?: number; monthlyCostLimitUsd?: number };
type State = { version: 1; models: Model[]; usage: { inputTokens: number; outputTokens: number; requests: number; estimatedCostUsd?: number; unpricedRequests?: number };
  modelUsage?: Record<string, ModelUsage>; agentUsage?: Record<string, ModelUsage>; lastError?: string };
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
function emptyUsage(month: string): ModelUsage { return { month, requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, unpricedRequests: 0 }; }
function validateUsagePolicy(model: Model): void {
  const { monthlyRequestLimit, monthlyCostLimitUsd, inputUsdPerMillion, outputUsdPerMillion } = model;
  if (monthlyRequestLimit !== undefined && (!Number.isSafeInteger(monthlyRequestLimit) || monthlyRequestLimit < 1 || monthlyRequestLimit > 1_000_000)) throw new Error('Limite mensal de chamadas inválido');
  for (const amount of [monthlyCostLimitUsd, inputUsdPerMillion, outputUsdPerMillion]) {
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000)) throw new Error('Valor em USD inválido');
  }
  if (monthlyCostLimitUsd !== undefined && (monthlyCostLimitUsd === 0 || model.provider === 'ollama' ||
    !inputUsdPerMillion || !outputUsdPerMillion)) throw new Error('Limite de custo exige preços positivos de entrada e saída de modelo externo');
}
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
  private monthlyUsage(id: string, month = new Date().toISOString().slice(0, 7)): ModelUsage {
    const saved = this.state.modelUsage?.[id];
    return saved?.month === month ? { ...saved } : emptyUsage(month);
  }
  agentUsage(id: string): ModelUsage {
    const month = new Date().toISOString().slice(0, 7);
    const saved = this.state.agentUsage?.[id];
    return saved?.month === month ? { ...saved } : emptyUsage(month);
  }
  private agentLimitReached(policy?: AgentUsagePolicy): boolean {
    if (!policy) return false;
    const used = this.agentUsage(policy.agentId);
    return (policy.monthlyRequestLimit !== undefined && used.requests >= policy.monthlyRequestLimit) ||
      (policy.monthlyCostLimitUsd !== undefined && (used.unpricedRequests > 0 || used.estimatedCostUsd >= policy.monthlyCostLimitUsd));
  }
  private validateAgentPolicy(policy?: AgentUsagePolicy): void {
    if (!policy) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(policy.agentId) ||
      (policy.monthlyRequestLimit !== undefined && (!Number.isSafeInteger(policy.monthlyRequestLimit) || policy.monthlyRequestLimit < 1 || policy.monthlyRequestLimit > 1_000_000)) ||
      (policy.monthlyCostLimitUsd !== undefined && (!Number.isFinite(policy.monthlyCostLimitUsd) || policy.monthlyCostLimitUsd <= 0 || policy.monthlyCostLimitUsd > 1_000_000)))
      throw new Error('Limite mensal do agente inválido');
  }
  private canUse(model: Model): boolean {
    const used = this.monthlyUsage(model.id);
    return model.enabled && (this.credentials?.configured(model.provider) ?? (keys[model.provider] === null || Boolean(this.env[keys[model.provider]!]))) &&
      (model.monthlyRequestLimit === undefined || used.requests < model.monthlyRequestLimit) &&
      (model.monthlyCostLimitUsd === undefined || (used.unpricedRequests === 0 && used.estimatedCostUsd < model.monthlyCostLimitUsd));
  }
  private reserve(model: Model, policy?: AgentUsagePolicy): void {
    const usage = this.monthlyUsage(model.id);
    usage.requests++;
    this.state.modelUsage ??= {};
    this.state.modelUsage[model.id] = usage;
    if (policy) {
      const agent = this.agentUsage(policy.agentId);
      agent.requests++;
      this.state.agentUsage ??= {};
      this.state.agentUsage[policy.agentId] = agent;
    }
    this.save();
  }
  private recordUsage(model: Model, inputTokens: number | null, outputTokens: number | null, policy?: AgentUsagePolicy): void {
    const usage = this.monthlyUsage(model.id);
    usage.inputTokens += inputTokens ?? 0;
    usage.outputTokens += outputTokens ?? 0;
    const unpriced = inputTokens === null || outputTokens === null || (model.provider !== 'ollama' &&
      (model.inputUsdPerMillion === undefined || model.outputUsdPerMillion === undefined));
    const cost = unpriced ? 0 : ((inputTokens ?? 0) * (model.inputUsdPerMillion ?? 0) + (outputTokens ?? 0) * (model.outputUsdPerMillion ?? 0)) / 1_000_000;
    if (unpriced) usage.unpricedRequests++;
    else {
      usage.estimatedCostUsd += cost;
      this.state.usage.estimatedCostUsd = (this.state.usage.estimatedCostUsd ?? 0) + cost;
    }
    if (unpriced) this.state.usage.unpricedRequests = (this.state.usage.unpricedRequests ?? 0) + 1;
    this.state.modelUsage ??= {};
    this.state.modelUsage[model.id] = usage;
    if (policy) {
      const agent = this.agentUsage(policy.agentId);
      agent.inputTokens += inputTokens ?? 0;
      agent.outputTokens += outputTokens ?? 0;
      if (unpriced) agent.unpricedRequests++;
      else agent.estimatedCostUsd += cost;
      this.state.agentUsage ??= {};
      this.state.agentUsage[policy.agentId] = agent;
    }
  }
  status() {
    return { models: this.state.models.map((m) => ({ ...m, available: this.canUse(m), monthlyUsage: this.monthlyUsage(m.id) })),
      agentUsage: Object.fromEntries(Object.keys(this.state.agentUsage ?? {}).map((id) => [id, this.agentUsage(id)])),
      usage: { ...this.state.usage }, lastError: this.state.lastError };
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
  add(input: { provider: Provider; model: string; priority: number; enabled?: boolean } & UsagePolicy): Model {
    if (!providers.includes(input.provider)) throw new Error('Provedor desconhecido');
    if (typeof input.model !== 'string' || !/^[\w./:-]{1,150}$/.test(input.model)) throw new Error('Nome de modelo inválido');
    if (!Number.isSafeInteger(input.priority) || input.priority < 1 || input.priority > 1000) throw new Error('Prioridade inválida');
    if (this.state.models.some((m) => m.provider === input.provider && m.model === input.model)) throw new Error('Modelo já cadastrado');
    const model: Model = { id: randomUUID(), provider: input.provider, model: input.model, priority: input.priority, enabled: input.enabled ?? true, createdAt: new Date().toISOString(),
      ...(input.monthlyRequestLimit === undefined ? {} : { monthlyRequestLimit: input.monthlyRequestLimit }),
      ...(input.monthlyCostLimitUsd === undefined ? {} : { monthlyCostLimitUsd: input.monthlyCostLimitUsd }),
      ...(input.inputUsdPerMillion === undefined ? {} : { inputUsdPerMillion: input.inputUsdPerMillion }),
      ...(input.outputUsdPerMillion === undefined ? {} : { outputUsdPerMillion: input.outputUsdPerMillion }) };
    validateUsagePolicy(model);
    this.state.models.push(model); this.save(); return model;
  }
  remove(id: string): boolean {
    const before = this.state.models.length;
    this.state.models = this.state.models.filter((m) => m.id !== id);
    if (before !== this.state.models.length) this.save();
    return before !== this.state.models.length;
  }
  update(id: string, changes: { priority?: number; enabled?: boolean } & UsagePolicyChanges): Model {
    const model = this.state.models.find((m) => m.id === id);
    if (!model) throw new Error('Modelo não encontrado');
    const next: Model = { ...model, ...changes } as Model;
    for (const key of ['monthlyRequestLimit', 'monthlyCostLimitUsd', 'inputUsdPerMillion', 'outputUsdPerMillion'] as const) {
      if (changes[key] === null) delete next[key];
    }
    if (changes.priority !== undefined) {
      if (!Number.isSafeInteger(changes.priority) || changes.priority < 1 || changes.priority > 1000) throw new Error('Prioridade inválida');
    }
    if (changes.enabled !== undefined) {
      if (typeof changes.enabled !== 'boolean') throw new Error('Estado inválido');
    }
    validateUsagePolicy(next);
    for (const key of ['monthlyRequestLimit', 'monthlyCostLimitUsd', 'inputUsdPerMillion', 'outputUsdPerMillion'] as const) {
      if (changes[key] === null) delete model[key];
    }
    Object.assign(model, next);
    this.save(); return { ...model };
  }
  async complete(messages: Message[], onlyProvider?: Provider, onlyModelId?: string, fallbackModelIds?: string[], agentPolicy?: AgentUsagePolicy): Promise<Completion> {
    validMessages(messages);
    this.validateAgentPolicy(agentPolicy);
    if (this.agentLimitReached(agentPolicy)) throw new Error('Limite mensal do agente atingido ou custo não mensurável');
    if (onlyModelId && !this.state.models.some((m) => m.id === onlyModelId) && !fallbackModelIds?.length) throw new Error('Modelo selecionado não encontrado');
    if (fallbackModelIds !== undefined && (!onlyModelId || onlyProvider || !Array.isArray(fallbackModelIds) || fallbackModelIds.length > 3 ||
      fallbackModelIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) ||
      new Set([onlyModelId, ...fallbackModelIds]).size !== fallbackModelIds.length + 1)) throw new Error('Modelos de reserva inválidos');
    const orderedIds = onlyModelId ? [onlyModelId, ...(fallbackModelIds ?? [])] : undefined;
    const available = this.state.models.filter((m) => this.canUse(m) && (!onlyProvider || m.provider === onlyProvider) &&
      (!orderedIds || orderedIds.includes(m.id))).sort((a, b) =>
      orderedIds ? orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id) : a.priority - b.priority);
    if (onlyModelId && !available.length) throw new Error('Modelo selecionado indisponível; verifique a credencial e o estado do modelo');
    if (!available.length) throw new Error('Nenhum modelo disponível: cadastre um modelo e configure a credencial do provedor');
    for (const model of available) {
      if (this.agentLimitReached(agentPolicy)) throw new Error('Limite mensal do agente atingido ou custo não mensurável');
      if (!this.canUse(model)) continue;
      let key: string | undefined;
      try { key = this.credentials ? await this.credentials.get(model.provider) : keys[model.provider] ? this.env[keys[model.provider]!] : undefined; }
      catch { this.state.lastError = `${model.provider}: credencial local indisponível`; this.save(); continue; }
      if (this.agentLimitReached(agentPolicy)) throw new Error('Limite mensal do agente atingido ou custo não mensurável');
      const anthropic = model.provider === 'anthropic';
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const body = anthropic ? { model: model.model, max_tokens: 1024, ...(system ? { system } : {}), messages: messages.filter((m) => m.role !== 'system') } : { model: model.model, messages };
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (anthropic) { headers['x-api-key'] = key!; headers['anthropic-version'] = '2023-06-01'; }
      else if (key) headers.Authorization = `Bearer ${key}`;
      if (model.provider === 'gemini') headers['x-goog-api-client'] = 'projecthub/0.1';
      try {
        this.reserve(model, agentPolicy);
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
        this.recordUsage(model, inputTokens, outputTokens, agentPolicy);
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
