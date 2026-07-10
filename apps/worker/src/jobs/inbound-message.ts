import type { InboundMessageJob } from '@repo/messaging';
import { prisma } from '@repo/db';
import { createAiClient, parseReply, extractDebtBalance } from '@repo/ai';
import { normalizePhone } from '@repo/rules';
import type { Logger } from 'pino';
import { processGroupMessage } from './group-message.js';

export async function processInboundMessage(job: InboundMessageJob, log: Logger): Promise<void> {
  // Группа — отдельный пайплайн (ADR 0008): копим ленту в дневной буфер, вечером
  // Sonnet кластеризует «сколько вернуло долг» (PAYMENT_DIGEST). В счётчик покрытия
  // (ADR 0006) группы НЕ идут — WhatsAppTouch здесь не пишем (chatId — это группа,
  // а не номер контрагента).
  if (job.isGroup) {
    await processGroupMessage(job, log);
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

  // Пустые сообщения (стикеры, фото без подписи) AI не разбирает ни в одну сторону.
  if (job.text.trim() === '') return;

  if (!process.env['ANTHROPIC_API_KEY']) {
    log.warn({ greenApiMessageId: job.greenApiMessageId }, 'ANTHROPIC_API_KEY not set — skipping AI');
    return;
  }

  const client = createAiClient();

  // ИСХОДЯЩЕЕ менеджера (ADR 0010): менеджер фиксирует итоговый остаток долга в USD.
  // Извлекаем число, журналируем событие и шлём владельцу карточку на подтверждение.
  // Сухой прогон: в лист ничего не пишем — только показываем, ЧТО было бы записано.
  if (job.isOutgoing) {
    await handleManagerBalance(job, phone, channel?.managerId ?? null, client, log);
    return;
  }

  // ВХОДЯЩЕЕ — ответ клиента на напоминание об оплате.
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
  // до резолва contactId по номеру телефона из источника дебиторки.
}

async function handleManagerBalance(
  job: InboundMessageJob,
  phone: string,
  managerId: string | null,
  client: ReturnType<typeof createAiClient>,
  log: Logger,
): Promise<void> {
  const extracted = await extractDebtBalance(client, job.text);
  if (!extracted.hasBalance || extracted.balanceUsd == null) return;

  // Идемпотентность (ADR 0010): одно сообщение = одно событие. Повторная доставка
  // того же greenApiMessageId не журналируется и не шлёт карточку дважды.
  const existing = await prisma.debtBalanceEvent.findUnique({
    where: {
      organizationId_greenApiMessageId: {
        organizationId: job.organizationId,
        greenApiMessageId: job.greenApiMessageId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    log.info({ greenApiMessageId: job.greenApiMessageId }, 'DebtBalanceEvent уже журналирован, пропуск');
    return;
  }

  const event = await prisma.debtBalanceEvent.create({
    data: {
      organizationId: job.organizationId,
      managerId,
      debtorPhone: phone,
      statedBalance: extracted.balanceUsd,
      currency: 'USD',
      kind: extracted.kind,
      rawText: job.text,
      greenApiMessageId: job.greenApiMessageId,
      status: 'PENDING',
    },
  });

  log.info(
    {
      organizationId: job.organizationId,
      eventId: event.id,
      phone,
      kind: extracted.kind,
      balanceUsd: extracted.balanceUsd.toString(),
    },
    'DebtBalanceEvent журналирован из фиксации менеджера',
  );

  // Карточку остатка владельцу (ADR 0010) пока НЕ шлём — по решению владельца из
  // личных чатов ничего не отправляем, только собираем событие в БД. Включается
  // обратно вызовом sendDebtEventCard(event.id, log) (apps/worker/jobs/debt-event-card.ts).
}
