import type { InboundMessageJob } from '@repo/messaging';
import { createAiClient, parseReply } from '@repo/ai';
import type { Logger } from 'pino';

export async function processInboundMessage(job: InboundMessageJob, log: Logger): Promise<void> {
  // Группы и пустые сообщения (фото без подписи, стикеры) для дебиторки не парсим.
  if (job.isGroup || job.text.trim() === '') {
    log.info({ greenApiMessageId: job.greenApiMessageId, isGroup: job.isGroup }, 'Skipping non-parseable message');
    return;
  }

  if (!process.env['ANTHROPIC_API_KEY']) {
    log.warn({ greenApiMessageId: job.greenApiMessageId }, 'ANTHROPIC_API_KEY not set — skipping parse');
    return;
  }

  const client = createAiClient();
  const parsed = await parseReply(client, job.text, new Date(job.receivedAt));

  log.info(
    {
      organizationId: job.organizationId,
      phone: job.phone,
      intent: parsed.intent,
      promisedDate: parsed.promisedDate?.toISOString(),
      promisedAmount: parsed.promisedAmount?.toString(),
    },
    'Inbound message parsed',
  );

  // TODO: персистенция Reminder (source: MANAGER) + Promise — заблокировано
  // до настройки Bitrix: нужен contactId по номеру телефона (crm.contact resolve).
}
