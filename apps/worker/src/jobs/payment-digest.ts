import { prisma } from '@repo/db';
import { createAiClient, summarizeDayPayments } from '@repo/ai';
import { normalizePhone } from '@repo/rules';
import { getTelegramApi } from '../telegram.js';
import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

// Дневная сводка возвратов (ADR 0008): в 18:00 Almaty берём дневной буфер ленты
// группы «чеки», Sonnet кластеризует «сколько РАЗНЫХ людей вернуло долг», код
// детерминированно суммирует по каждой валюте (правила, а не магия — принцип 5).
// Сумму НЕ конвертируем: тенге и доллары показываем раздельно. Информирование,
// долг в листе не меняем (принцип 1). Постим в общий чат [собственник + МОПы]
// (telegramGroupChatId) с разбивкой по менеджерам — Медет там же её видит.

function almatyToday(): Date {
  const shifted = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return new Date(`${shifted.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

// Сумма по каждой валюте — строкой, без конвертации между валютами.
function formatByCurrency(byCurrency: Map<string, number>): string {
  return [...byCurrency.entries()]
    .map(([currency, sum]) => `${sum.toLocaleString('ru-RU')} ${currency}`)
    .join(', ');
}

// Русское склонение «клиент» по числу (принцип 8 — русский первый класс).
function clientsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'клиент';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'клиента';
  return 'клиентов';
}

export async function processPaymentDigest(data: { organizationId: string }): Promise<void> {
  const { organizationId } = data;

  const businessDay = almatyToday();
  const messages = await prisma.groupDayMessage.findMany({
    where: { organizationId, businessDay },
    orderBy: { createdAt: 'asc' },
    select: { senderPhone: true, text: true, receiptLine: true },
  });

  if (messages.length === 0) {
    log.info({ organizationId }, 'PAYMENT_DIGEST: за сегодня в группе пусто — сводку не шлём');
    return;
  }

  const api = getTelegramApi();
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { telegramGroupChatId: true },
  });
  if (!api || !settings?.telegramGroupChatId) {
    log.warn(
      { organizationId, buffered: messages.length },
      'PAYMENT_DIGEST: нет TELEGRAM_BOT_TOKEN/telegramGroupChatId — сводка не отправлена',
    );
    return;
  }

  if (!process.env['ANTHROPIC_API_KEY']) {
    log.warn({ organizationId }, 'PAYMENT_DIGEST: ANTHROPIC_API_KEY не задан — кластеризация невозможна');
    return;
  }

  // Кто запостил в группе → менеджер: сопоставляем senderPhone с номером канала
  // (WhatsAppChannel.phone). Нормализуем оба конца — форматы могут различаться.
  const channels = await prisma.whatsAppChannel.findMany({
    where: { organizationId },
    select: { phone: true, manager: { select: { fullName: true } } },
  });
  const managerByPhone = new Map<string, string>();
  for (const ch of channels) {
    if (!ch.manager) continue;
    const key = normalizePhone(ch.phone) ?? ch.phone;
    managerByPhone.set(key, ch.manager.fullName);
  }
  const resolveManager = (senderPhone: string | null): string => {
    if (!senderPhone) return '—';
    const key = normalizePhone(senderPhone) ?? senderPhone;
    return managerByPhone.get(key) ?? '—';
  };

  // Транскрипт по порядку: префикс «Менеджер X:» + текст и/или строку чека.
  const transcript = messages
    .map((m) => {
      const parts = [m.text, m.receiptLine].filter(Boolean).join(' ');
      return `Менеджер ${resolveManager(m.senderPhone)}: ${parts}`;
    })
    .join('\n');

  const summary = await summarizeDayPayments(createAiClient(), transcript);
  const payerCount = summary.payers.length;

  // Детерминированные подсчёты (модель не суммирует — принцип 5): общая сумма по
  // валютам и разбивка по менеджерам (число клиентов + сумма по валютам).
  const byCurrency = new Map<string, number>();
  const perManager = new Map<string, { count: number; byCurrency: Map<string, number> }>();
  for (const p of summary.payers) {
    byCurrency.set(p.currency, (byCurrency.get(p.currency) ?? 0) + p.amountMajor);
    const key = p.manager || '—';
    const agg = perManager.get(key) ?? { count: 0, byCurrency: new Map<string, number>() };
    agg.count += 1;
    agg.byCurrency.set(p.currency, (agg.byCurrency.get(p.currency) ?? 0) + p.amountMajor);
    perManager.set(key, agg);
  }

  const dateLabel = businessDay.toISOString().slice(0, 10).split('-').reverse().join('.');
  let text: string;
  if (payerCount === 0) {
    text = `💰 Возвраты долга за ${dateLabel}\n\nПо ленте группы возвратов не распознано.`;
  } else {
    const managerLines = [...perManager.entries()].map(
      ([name, agg]) =>
        `• ${name}: ${agg.count} ${clientsWord(agg.count)} на ${formatByCurrency(agg.byCurrency)}`,
    );
    text =
      `💰 Возвраты долга за ${dateLabel}\n\n` +
      `Вернуло людей: ${payerCount}\n` +
      `Сумма: ${formatByCurrency(byCurrency)}\n\n` +
      `По менеджерам:\n` +
      managerLines.join('\n') +
      `\n\nℹ️ Информационно по ленте группы. Долг в таблице не меняем.`;
  }

  await api.sendMessage(settings.telegramGroupChatId, text);

  log.info(
    { organizationId, payerCount, managers: perManager.size, currencies: [...byCurrency.keys()] },
    'PAYMENT_DIGEST: сводка возвратов отправлена в общий чат',
  );
}
