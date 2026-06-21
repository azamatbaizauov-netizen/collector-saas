import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { handleBitrixWebhook } from '../handlers/bitrix-webhook.js';
import { handleWhatsappWebhook } from '../handlers/whatsapp-webhook.js';

// Green API шлёт webhookUrlToken в заголовке Authorization: Bearer <token>.
// Если WHATSAPP_WEBHOOK_TOKEN задан — отбрасываем чужие запросы на публичный
// эндпоинт. Не задан — пускаем всех (обратная совместимость на время настройки).
function isWhatsappTokenValid(request: FastifyRequest): boolean {
  const expected = process.env['WHATSAPP_WEBHOOK_TOKEN'];
  if (!expected) return true;
  const header = request.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post('/bitrix', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    await handleBitrixWebhook(body);
    return reply.send({ ok: true });
  });

  app.post('/whatsapp', async (request, reply) => {
    if (!isWhatsappTokenValid(request)) {
      request.log.warn('WhatsApp webhook: неверный или отсутствующий токен — отклонено');
      return reply.code(401).send({ ok: false });
    }
    const body = request.body as Record<string, unknown>;
    await handleWhatsappWebhook(body);
    return reply.send({ ok: true });
  });
};
