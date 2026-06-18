import type { FastifyPluginAsync } from 'fastify';
import { handleBitrixWebhook } from '../handlers/bitrix-webhook.js';
import { handleWhatsappWebhook } from '../handlers/whatsapp-webhook.js';

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post('/bitrix', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    await handleBitrixWebhook(body);
    return reply.send({ ok: true });
  });

  app.post('/whatsapp', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    await handleWhatsappWebhook(body);
    return reply.send({ ok: true });
  });
};
