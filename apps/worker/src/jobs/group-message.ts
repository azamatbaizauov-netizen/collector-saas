import type { InboundMessageJob } from '@repo/messaging';
import { prisma } from '@repo/db';
import { createAiClient, parseReceipt } from '@repo/ai';
import type { ReceiptMedia, ParsedReceipt } from '@repo/ai';
import type { Logger } from 'pino';
import { withAiCost } from '../lib/ai-cost.js';

// Захват ленты рабочей WhatsApp-ГРУППЫ «чеки» в дневной буфер (ADR 0008). Групповые
// сообщения НЕ идут в счётчик покрытия (ADR 0006). Копим за сутки ВСЁ: текст и
// строку разбора чека vision'ом. Вечером (PAYMENT_DIGEST, 18:00 Almaty) Sonnet
// кластеризует буфер: сколько РАЗНЫХ людей вернуло долг и на сумму. Здесь ничего
// не решаем и не шлём — только пишем в GroupDayMessage. Идемпотентность приёма
// уже на уровне WebhookProcessed (apps/api) + unique (organizationId, greenApiMessageId).

const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// Almaty — UTC+5 без переходов. Деловые сутки сообщения = его локальная дата.
// Возвращаем дату на UTC-полночь этой локальной даты (для @db.Date).
function almatyBusinessDay(receivedAt: Date): Date {
  const shifted = new Date(receivedAt.getTime() + 5 * 60 * 60 * 1000);
  const ymd = shifted.toISOString().slice(0, 10);
  return new Date(`${ymd}T00:00:00.000Z`);
}

// Возвращает mime для vision (image/* или application/pdf) либо null, если тип не поддержан.
function resolveMediaType(job: InboundMessageJob): string | null {
  const mime = job.mimeType?.toLowerCase();
  if (mime === 'application/pdf') return 'application/pdf';
  if (mime && IMAGE_MIME.has(mime)) return mime;
  if (job.messageType === 'imageMessage') return 'image/jpeg';
  if (job.messageType === 'documentMessage' && mime?.startsWith('image/')) return 'image/jpeg';
  return null;
}

// Компактная строка разбора чека для буфера — её же читает Sonnet при кластеризации.
function formatReceiptLine(parsed: ParsedReceipt): string {
  if (parsed.docType === 'EXCHANGE_RATE') {
    return `[курс] ${parsed.exchangeRate ?? parsed.note ?? 'скрин курса обмена'}`;
  }
  const kind = parsed.docType === 'NEW_DEBT' ? 'новый долг' : 'чек оплаты';
  const parts: string[] = [`[${kind}]`];
  if (parsed.amountMinor != null) {
    const major = (Number(parsed.amountMinor) / 100).toString();
    parts.push(`${major} ${parsed.currency ?? ''}`.trim());
  }
  if (parsed.payerName) parts.push(`плательщик: ${parsed.payerName}`);
  if (parsed.payeeName) parts.push(`получатель: ${parsed.payeeName}`);
  if (parsed.bank) parts.push(parsed.bank);
  if (parsed.dateText) parts.push(`дата: ${parsed.dateText}`);
  return parts.join(', ');
}

async function parseGroupMedia(job: InboundMessageJob, log: Logger): Promise<string | null> {
  const mediaType = resolveMediaType(job);
  if (!mediaType) {
    log.info(
      { greenApiMessageId: job.greenApiMessageId, messageType: job.messageType, mimeType: job.mimeType },
      'Group media: неподдерживаемый тип — в буфер только как медиа без разбора',
    );
    return null;
  }
  if (!process.env['ANTHROPIC_API_KEY']) {
    log.warn({ greenApiMessageId: job.greenApiMessageId }, 'ANTHROPIC_API_KEY not set — vision пропущен');
    return null;
  }

  let media: ReceiptMedia;
  try {
    const res = await fetch(job.downloadUrl as string);
    if (!res.ok) {
      log.warn({ greenApiMessageId: job.greenApiMessageId, status: res.status }, 'Не скачался файл чека');
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_MEDIA_BYTES) {
      log.warn({ greenApiMessageId: job.greenApiMessageId, bytes: buf.byteLength }, 'Файл чека слишком большой — пропуск разбора');
      return null;
    }
    media = { data: buf.toString('base64'), mediaType };
  } catch (err) {
    log.error({ greenApiMessageId: job.greenApiMessageId, err }, 'Ошибка скачивания файла чека');
    return null;
  }

  const parsed = await withAiCost(
    {
      scenario: 'parse-receipt',
      organizationId: job.organizationId,
      inputSummary: `${media.mediaType},${Math.round(media.data.length * 0.75)}b`,
      log,
    },
    (onUsage) => parseReceipt(createAiClient(), media, onUsage),
    (r) => `docType=${r.docType}`,
  );
  // OTHER (фото товара, случайное) в буфер не кладём — не про долг.
  if (parsed.docType === 'OTHER') {
    log.info({ greenApiMessageId: job.greenApiMessageId }, 'Vision: документ не про долг (OTHER) — не буферим');
    return null;
  }
  return formatReceiptLine(parsed);
}

export async function processGroupMessage(job: InboundMessageJob, log: Logger): Promise<void> {
  const text = job.text.trim();
  const hasMedia = Boolean(job.downloadUrl);

  // Медиа — разбираем vision'ом сразу (спред стоимости по мере поступления).
  const receiptLine = hasMedia ? await parseGroupMedia(job, log) : null;

  // Нечего копить: пустой текст и медиа не про долг (OTHER/неподдерживаемый тип).
  if (text === '' && !receiptLine) {
    log.info({ greenApiMessageId: job.greenApiMessageId }, 'Group message: ни текста, ни чека — пропуск буфера');
    return;
  }

  await prisma.groupDayMessage.upsert({
    where: {
      organizationId_greenApiMessageId: {
        organizationId: job.organizationId,
        greenApiMessageId: job.greenApiMessageId,
      },
    },
    update: {},
    create: {
      organizationId: job.organizationId,
      groupChatId: job.chatId,
      senderPhone: job.senderPhone ?? null,
      greenApiMessageId: job.greenApiMessageId,
      messageType: job.messageType,
      text: text === '' ? null : text,
      receiptLine,
      businessDay: almatyBusinessDay(new Date(job.receivedAt)),
    },
  });

  log.info(
    { organizationId: job.organizationId, greenApiMessageId: job.greenApiMessageId, hasReceipt: Boolean(receiptLine) },
    'Group message записан в дневной буфер',
  );
}
