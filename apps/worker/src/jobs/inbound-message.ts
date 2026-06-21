import type { InboundMessageJob } from '@repo/messaging';
import { prisma } from '@repo/db';
import { createAiClient, parseReply } from '@repo/ai';
import { normalizePhone } from '@repo/rules';
import type { Logger } from 'pino';

export async function processInboundMessage(job: InboundMessageJob, log: Logger): Promise<void> {
  // Группы для дебиторки не учитываем (chatId — это группа, не контрагент).
  if (job.isGroup) {
    log.info({ greenApiMessageId: job.greenApiMessageId }, 'Skipping group message');
    return;
  }

  // Касание (ADR 0006): факт связи менеджера с контрагентом для счётчика покрытия.
  // Пишем ОБА направления и даже без текста (фото без подписи = тоже контакт).
  // Матчинг с планом дня — по номеру, поэтому канонизируем как в дебиторке.
  const channel = await prisma.whatsAppChannel.findFirst({
    where: { organizationId: job.organizationId, instanceId: job.instanceId },
    select: { managerId: true },
  });
  const phone = normalizePhone(job.phone) ?? job.phone;
  await prisma.whatsAppTouch.upsert({
    where: {
      organizationId_greenApiMessageId: {
        organizationId: job.organizationId,
        greenApiMessageId: job.greenApiMessageId,
      },
    },
    update: {},
    create: {
      organizationId: job.organizationId,
      managerId: channel?.managerId ?? null,
      phone,
      direction: job.isOutgoing ? 'OUTGOING' : 'INCOMING',
      greenApiMessageId: job.greenApiMessageId,
      touchedAt: new Date(job.receivedAt),
    },
  });

  // AI-парсинг — только входящие ответы клиента с текстом. Исходящие менеджера
  // и пустые сообщения (стикеры, фото) parse-reply не разбирает.
  if (job.isOutgoing || job.text.trim() === '') return;

  if (!process.env['ANTHROPIC_API_KEY']) {
    log.warn({ greenApiMessageId: job.greenApiMessageId }, 'ANTHROPIC_API_KEY not set — skipping parse');
    return;
  }

  const client = createAiClient();
  const parsed = await parseReply(client, job.text, new Date(job.receivedAt));

  log.info(
    {
      organizationId: job.organizationId,
      phone,
      intent: parsed.intent,
      promisedDate: parsed.promisedDate?.toISOString(),
      promisedAmount: parsed.promisedAmount?.toString(),
    },
    'Inbound message parsed',
  );

  // TODO: персистенция Reminder (source: MANAGER) + Promise — заблокировано
  // до настройки Bitrix: нужен contactId по номеру телефона (crm.contact resolve).
}
