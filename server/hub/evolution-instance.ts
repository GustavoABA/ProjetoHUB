const INSTANCE = 'procura-de-emprego';
type Options = { baseUrl: string; apiKey: string; fetcher?: typeof fetch };
type Result = { instance: typeof INSTANCE; created?: boolean; status?: string; qrCode?: string; pairingCode?: string };
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
async function json(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error('Resposta Evolution muito grande');
  try { return JSON.parse(text); } catch { throw new Error('Resposta Evolution inválida'); }
}
function status(value: unknown): string | undefined { return typeof value === 'string' && /^[\w -]{1,50}$/.test(value) ? value : undefined; }
function qr(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 700_000) return undefined;
  const encoded = value.startsWith('data:image/png;base64,') ? value.slice('data:image/png;base64,'.length) : value;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return undefined;
  const png = Buffer.from(encoded, 'base64');
  if (png.length < 8 || png.length > 500_000 || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return undefined;
  return `data:image/png;base64,${encoded}`;
}
function safeResult(raw: unknown): Omit<Result, 'instance' | 'created'> {
  const data = object(raw), instance = object(data?.instance), qrcode = object(data?.qrcode);
  const qrCode = qr(qrcode?.base64 ?? data?.base64);
  const pairingCode = qrcode?.pairingCode ?? data?.pairingCode;
  return { ...(status(instance?.status ?? instance?.state) ? { status: status(instance?.status ?? instance?.state) } : {}),
    ...(qrCode ? { qrCode } : {}),
    ...(typeof pairingCode === 'string' && /^[A-Za-z0-9-]{6,16}$/.test(pairingCode) ? { pairingCode } : {}) };
}
function assertKey(key: string): void { if (!key) throw new Error('Configure a chave da Evolution API'); }

/** Check first; never mutate another instance, and never return Evolution's instance token. */
export async function ensureJobInstance({ baseUrl, apiKey, fetcher = fetch }: Options): Promise<Result> {
  assertKey(apiKey);
  const listed = await fetcher(`${baseUrl}/instance/fetchInstances`, { headers: { apikey: apiKey }, signal: AbortSignal.timeout(10_000) });
  if (!listed.ok) throw new Error(`Consulta de instâncias Evolution HTTP ${listed.status}`);
  const entries = await json(listed);
  if (!Array.isArray(entries)) throw new Error('Lista de instâncias Evolution inválida');
  const existing = entries.map(object).find((entry) => entry?.name === INSTANCE || object(entry?.instance)?.name === INSTANCE);
  if (existing) return { instance: INSTANCE, created: false,
    ...(status(existing.connectionStatus ?? object(existing.instance)?.status) ? { status: status(existing.connectionStatus ?? object(existing.instance)?.status) } : {}) };
  const created = await fetcher(`${baseUrl}/instance/create`, { method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceName: INSTANCE, qrcode: true, integration: 'WHATSAPP-BAILEYS' }), signal: AbortSignal.timeout(30_000) });
  if (!created.ok) throw new Error(`Criação da instância Evolution HTTP ${created.status}; consulte o diagnóstico antes de repetir`);
  const result = await json(created);
  if (object(object(result)?.instance)?.instanceName !== INSTANCE) throw new Error('Criação da instância com resultado incerto; consulte o diagnóstico');
  return { instance: INSTANCE, created: true, ...safeResult(result) };
}

/** Explicit pairing request, scoped to the dedicated instance. */
export async function connectJobInstance({ baseUrl, apiKey, fetcher = fetch }: Options): Promise<Result> {
  assertKey(apiKey);
  const response = await fetcher(`${baseUrl}/instance/connect/${INSTANCE}`, { method: 'GET', headers: { apikey: apiKey }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Conexão da instância Evolution HTTP ${response.status}`);
  const result = await json(response);
  if (object(result)?.error === true) throw new Error('Evolution recusou a conexão da instância');
  return { instance: INSTANCE, ...safeResult(result) };
}
