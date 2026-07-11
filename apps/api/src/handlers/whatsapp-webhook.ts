import { prisma, Prisma } from '@repo/db';
import { parseGreenApiWebhook } from '@repo/messaging';
import { logger } from '../logger.js';
import { enqueueInboundMessage } from '../queue.js';

export async function handleWhatsappWebhook(body: Record<string, unknown>): Promise<void> {
  const message = parseGreenApiWebhook(body);
  if (!message) return;

  // Резолвим организацию по instanceId подключённого номера.
  const channel = await prisma.whatsAppChannel.findFirst({
    where: { instanceId: message.instanceId },
    select: { organizationId: true },
  });
  if (!channel) {
    logger.warn({ instanceId: message.instanceId }, 'WhatsApp webhook from unknown instance — skipping');
    return;
  }

  const organizationId = channel.organizationId;

  // Идемпотентность: один greenApiMessageId обрабатываем один раз. Green API
  // повторяет доставку (в т.ч. параллельно), поэтому findUnique+create — гонка:
  // оба запроса проходят проверку, второй падает на unique-констрейнте (P2002).
  // Быстрый путь — findUnique; но решает всё атомарный create: чей create прошёл,
  // тот и ставит задачу, проигравший P2002 просто выходит (дубль уже обработан).
  const existing = await prisma.webhookProcessed.findUnique({
    where: { source_eventId: { source: 'WHATSAPP', eventId: message.greenApiMessageId } },
  });
  if (existing) return;

  try {
    await prisma.webhookProcessed.create({
      data: {
        source: 'WHATSAPP',
        eventId: message.greenApiMessageId,
        organizationId,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.info(
        { organizationId, greenApiMessageId: message.greenApiMessageId },
        'WhatsApp webhook — дубль (гонка доставки), пропуск',
      );
      return;
    }
    throw err;
  }

  await enqueueInboundMessage({
    organizationId,
    instanceId: message.instanceId,
    chatId: message.chatId,
    phone: message.phone,
    isGroup: message.isGroup,
    isOutgoing: message.isOutgoing,
    messageType: message.messageType,
    text: message.text,
    downloadUrl: message.downloadUrl,
    mimeType: message.mimeType,
    fileName: message.fileName,
    senderPhone: message.senderPhone,
    greenApiMessageId: message.greenApiMessageId,
    receivedAt: message.receivedAt.toISOString(),
  });

  logger.info(
    { organizationId, instanceId: message.instanceId, phone: message.phone, isOutgoing: message.isOutgoing },
    'WhatsApp message enqueued',
  );
}
