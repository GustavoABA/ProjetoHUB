import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJson, sendJson } from '../http/app';
import type { HubStore } from './store';
import type { WhatsAppStore } from './whatsapp';

/** Dedicated authenticated listener; never mounts on the Habblaud remote UI port. */
export function handleWhatsAppWebhook(req: IncomingMessage, res: ServerResponse, whatsapp: WhatsAppStore, hub: HubStore): void {
  if (req.url !== '/webhook/evolution') { req.resume(); sendJson(res, 404, { error: 'Rota desconhecida' }); return; }
  if (req.method !== 'POST') { req.resume(); sendJson(res, 405, { error: 'Método não permitido' }); return; }
  const token = req.headers['x-projecthub-token'];
  if (typeof token !== 'string' || !whatsapp.authenticateWebhook(token)) { req.resume(); sendJson(res, 401, { error: 'Não autorizado' }); return; }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) { req.resume(); sendJson(res, 415, { error: 'JSON necessário' }); return; }
  void readJson(req, 64 * 1024).then((body) => {
    const result = whatsapp.ingest(token, body, hub);
    sendJson(res, result === 'answered' ? 202 : 200, { status: result });
  }).catch(() => { if (!res.headersSent) sendJson(res, 400, { error: 'Evento inválido' }); });
}
