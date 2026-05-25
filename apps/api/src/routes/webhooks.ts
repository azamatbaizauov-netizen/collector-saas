import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { handleBitrixWebhook } from '../handlers/bitrix-webhook.js';
import { handleWazzupWebhook } from '../handlers/wazzup-webhook.js';

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post('/bitrix', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    await handleBitrixWebhook(body);
    return reply.send({ ok: true });
  });

  app.post('/wazzup', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    await handleWazzupWebhook(body);
    return reply.send({ ok: true });
  });
};
