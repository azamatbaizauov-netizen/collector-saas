import { prisma } from '@repo/db';
import { logger } from '../logger.js';

export async function handleWazzupWebhook(body: Record<string, unknown>): Promise<void> {
  const messages = body['messages'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(messages)) return;

  for (const msg of messages) {
    const messageId = String(msg['id'] ?? '');
    if (!messageId) continue;

    const existing = await prisma.webhookProcessed.findUnique({
      where: { source_eventId: { source: 'WAZZUP', eventId: messageId } },
    });
    if (existing) continue;

    logger.info({ messageId, channelId: msg['channelId'] }, 'Wazzup message received');

    // TODO: queue message for AI parsing (parse-reply scenario)

    await prisma.webhookProcessed.create({
      data: {
        source: 'WAZZUP',
        eventId: messageId,
        // organizationId resolved from channelId mapping at queue processing time
        organizationId: '',
      },
    });
  }
}
