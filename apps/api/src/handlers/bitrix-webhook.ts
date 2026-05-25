import { prisma } from '@repo/db';
import { logger } from '../logger.js';

export async function handleBitrixWebhook(body: Record<string, unknown>): Promise<void> {
  const eventId = String(body['event_id'] ?? '');
  const event = String(body['event'] ?? '');

  if (!eventId || !event) {
    logger.warn({ body }, 'Bitrix webhook missing event_id or event');
    return;
  }

  // Idempotency: skip if already processed
  const existing = await prisma.webhookProcessed.findUnique({
    where: { source_eventId: { source: 'BITRIX', eventId } },
  });
  if (existing) {
    logger.debug({ eventId }, 'Bitrix webhook already processed, skipping');
    return;
  }

  logger.info({ event, eventId }, 'Bitrix webhook received');

  // TODO: route to specific handlers by event type
  // ONCRMDEALUPDATE, ONCRMCONTACTUPDATE, etc.

  await prisma.webhookProcessed.create({
    data: { source: 'BITRIX', eventId, organizationId: String(body['organization_id'] ?? '') },
  });
}
