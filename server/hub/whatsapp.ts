import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HubStore } from './store';

const INSTANCE = 'procura-de-emprego';
const DEFAULT_EVOLUTION_URL = 'http://127.0.0.1:8080';
type OutboundState = 'sending' | 'accepted' | 'uncertain' | 'failed';
export interface OutboundMessage { id: string; questionId: string; text: string; state: OutboundState; createdAt: string; updatedAt: string; providerMessageId?: string; error?: string }
interface InboundMessage { id: string; questionId: string; receivedAt: string }
interface State { version: 1; instance: typeof INSTANCE; mainNumber?: string; secondaryNumber?: string; webhookTokenHash?: string; inbound: InboundMessage[]; outbound: OutboundMessage[] }
function number(value: string): string {
  if (typeof value !== 'string' || !/^\d{10,15}$/.test(value)) throw new Error('Número deve conter DDI, DDD e número, somente dígitos');
  return value;
}
function hash(token: string): Buffer { return createHash('sha256').update(token).digest(); }
function object(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }

/** Local logical Evolution instance. Existing Evolution instances are never modified here. */
export class WhatsAppStore {
  private state: State;
  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || (parsed as State).version !== 1 || (parsed as State).instance !== INSTANCE || !Array.isArray((parsed as State).inbound) || !Array.isArray((parsed as State).outbound)) throw new Error('Estado WhatsApp incompatível ou corrompido');
      this.state = parsed as State;
      for (const item of this.state.outbound) if (item.state === 'sending') { item.state = 'uncertain'; item.updatedAt = new Date().toISOString(); }
      this.save();
    } else this.state = { version: 1, instance: INSTANCE, inbound: [], outbound: [] };
  }
  status() { return { instance: INSTANCE, mainNumber: this.state.mainNumber, secondaryNumber: this.state.secondaryNumber,
    webhookTokenConfigured: Boolean(this.state.webhookTokenHash), inboundCount: this.state.inbound.length, outbound: structuredClone(this.state.outbound) }; }
  configure(input: { mainNumber: string; secondaryNumber: string }) {
    const mainNumber = number(input.mainNumber), secondaryNumber = number(input.secondaryNumber);
    if (mainNumber === secondaryNumber) throw new Error('Número principal e secundário devem ser diferentes');
    this.state.mainNumber = mainNumber; this.state.secondaryNumber = secondaryNumber; this.save(); return this.status();
  }
  rotateWebhookToken(): string {
    const token = randomBytes(32).toString('base64url');
    this.state.webhookTokenHash = hash(token).toString('hex'); this.save(); return token;
  }
  authenticateWebhook(token: string): boolean {
    const expected = this.state.webhookTokenHash;
    return Boolean(expected && /^[0-9a-f]{64}$/.test(expected) && typeof token === 'string' && token.length <= 200 && timingSafeEqual(hash(token), Buffer.from(expected, 'hex')));
  }
  async diagnose(apiKey: string, fetcher: typeof fetch = fetch, baseUrl = DEFAULT_EVOLUTION_URL): Promise<{ reachable: boolean; version?: string; instanceExists: boolean | null; connectionStatus?: string; error?: string }> {
    try {
      const root = await fetcher(`${baseUrl}/`, { signal: AbortSignal.timeout(5_000) });
      if (!root.ok) return { reachable: false, instanceExists: null, error: `Evolution HTTP ${root.status}` };
      const info = object(await root.json());
      const version = typeof info?.version === 'string' ? info.version : undefined;
      if (!apiKey) return { reachable: true, ...(version ? { version } : {}), instanceExists: null, error: 'Chave da Evolution API não configurada' };
      const response = await fetcher(`${baseUrl}/instance/fetchInstances`, { headers: { apikey: apiKey }, signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return { reachable: true, ...(version ? { version } : {}), instanceExists: null, error: `Consulta de instâncias HTTP ${response.status}` };
      const instances: unknown = await response.json();
      if (!Array.isArray(instances)) return { reachable: true, ...(version ? { version } : {}), instanceExists: null, error: 'Resposta de instâncias inválida' };
      const instance = instances.map(object).find((item) => item?.name === INSTANCE || object(item?.instance)?.name === INSTANCE);
      const connectionStatus = instance && typeof (instance.connectionStatus ?? object(instance.instance)?.status) === 'string'
        ? String(instance.connectionStatus ?? object(instance.instance)?.status) : undefined;
      return { reachable: true, ...(version ? { version } : {}), instanceExists: Boolean(instance), ...(connectionStatus ? { connectionStatus } : {}) };
    } catch { return { reachable: false, instanceExists: null, error: 'Evolution indisponível ou resposta inválida' }; }
  }
  ingest(token: string, raw: unknown, hub: HubStore): 'answered' | 'duplicate' | 'ignored' {
    if (!this.authenticateWebhook(token)) throw new Error('Autenticação do webhook recusada');
    const event = object(raw);
    if (event?.event !== 'messages.upsert' || event.instance !== INSTANCE || !this.state.mainNumber) return 'ignored';
    const data = object(event.data), key = object(data?.key), message = object(data?.message);
    const remoteJid = key?.remoteJid, messageId = key?.id;
    if (key?.fromMe !== false || remoteJid !== `${this.state.mainNumber}@s.whatsapp.net` || typeof messageId !== 'string' || !/^[A-Za-z0-9_-]{3,150}$/.test(messageId)) return 'ignored';
    if (this.state.inbound.some((item) => item.id === messageId)) return 'duplicate';
    const extended = object(message?.extendedTextMessage);
    const text = typeof message?.conversation === 'string' ? message.conversation : extended?.text;
    if (typeof text !== 'string' || text.length > 5500) return 'ignored';
    const match = /^#([0-9a-f-]{8,36})\s+([\s\S]{1,5000})$/i.exec(text.trim());
    if (!match) return 'ignored';
    const candidates = hub.listQuestions().filter((q) => q.id.startsWith(match[1]) && (q.state === 'pending' || q.sourceMessageId === messageId));
    if (candidates.length !== 1) return 'ignored';
    const question = candidates[0];
    if (question.sourceMessageId === messageId) {
      this.state.inbound.push({ id: messageId, questionId: question.id, receivedAt: new Date().toISOString() }); this.save();
      return 'duplicate';
    }
    hub.answerQuestion(question.id, match[2].trim(), messageId);
    this.state.inbound.push({ id: messageId, questionId: question.id, receivedAt: new Date().toISOString() });
    if (this.state.inbound.length > 10_000) this.state.inbound.splice(0, this.state.inbound.length - 10_000);
    this.save(); return 'answered';
  }
  async sendQuestion(questionId: string, hub: HubStore, apiKey: string, fetcher: typeof fetch = fetch, baseUrl = DEFAULT_EVOLUTION_URL): Promise<OutboundMessage> {
    if (!this.state.mainNumber || !this.state.secondaryNumber) throw new Error('Configure os números principal e secundário');
    if (!apiKey) throw new Error('Chave da Evolution API não configurada');
    const existing = this.state.outbound.find((item) => item.questionId === questionId);
    if (existing) return structuredClone(existing);
    const question = hub.listQuestions().find((q) => q.id === questionId && q.state === 'pending');
    if (!question) throw new Error('Pergunta pendente não encontrada');
    const code = question.id.slice(0, 8);
    const text = `ProjetoHUB — pergunta #${code}\n${question.text}\nResponda com #${code} seguido da sua resposta.`;
    const now = new Date().toISOString();
    const message: OutboundMessage = { id: randomUUID(), questionId, text, state: 'sending', createdAt: now, updatedAt: now };
    this.state.outbound.push(message); this.save();
    try {
      const response = await fetcher(`${baseUrl}/message/sendText/${INSTANCE}`, { method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ number: this.state.mainNumber, text }), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        message.state = response.status >= 500 ? 'uncertain' : 'failed'; message.error = `Evolution HTTP ${response.status}`;
      } else {
        const body = object(await response.json()); const key = object(body?.key);
        if (typeof key?.id === 'string' && key.id) { message.state = 'accepted'; message.providerMessageId = key.id; }
        else { message.state = 'uncertain'; message.error = 'Evolution respondeu sem identificador de mensagem'; }
      }
    } catch { message.state = 'uncertain'; message.error = 'Resposta da Evolution não confirmada'; }
    message.updatedAt = new Date().toISOString(); this.save(); return structuredClone(message);
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.file);
  }
}
