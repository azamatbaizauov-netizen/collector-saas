import { prisma } from '@repo/db';
import { loadDailyPlan } from '../debt-data.js';
import { getTelegramApi } from '../telegram.js';
import { formatCoverage, type CoverageEntry, type CoverageStage } from '../format-plan.js';
import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

// Счётчик покрытия (ADR 0004 схема 1+2+4, ADR 0006). По плану дня и сегодняшним
// исходящим касаниям WhatsApp считаем, кто из менеджеров со сколькими должниками
// связался, и постим публично в общий чат. stage='reminder' (14:00) — полный
// счётчик; stage='final' (17:00) — только кто так и не вышел на связь. Система
// НЕ пишет должникам.
export async function processOverdueCheck(data: {
  organizationId: string;
  stage?: CoverageStage;
}): Promise<void> {
  const { organizationId, stage = 'reminder' } = data;

  const plan = await loadDailyPlan(organizationId);
  if (!plan) {
    log.warn({ organizationId }, 'OVERDUE_CHECK: источник дебиторки не сконфигурирован, пропуск');
    return;
  }
  if (plan.managers.length === 0) {
    log.info({ organizationId }, 'OVERDUE_CHECK: план дня пуст, счётчик не отправляем');
    return;
  }

  const api = getTelegramApi();
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { telegramGroupChatId: true },
  });
  const chatId = settings?.telegramGroupChatId;
  if (!api || !chatId) {
    log.warn(
      { organizationId, managers: plan.managers.length },
      'OVERDUE_CHECK: нет TELEGRAM_BOT_TOKEN/telegramGroupChatId, счётчик посчитан, но не отправлен',
    );
    return;
  }

  // Сегодняшние исходящие касания (= менеджер написал сам) → номера по менеджеру.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const touches = await prisma.whatsAppTouch.findMany({
    where: { organizationId, direction: 'OUTGOING', touchedAt: { gte: startOfToday } },
    select: { managerId: true, phone: true },
  });
  const contactedByManager = new Map<string, Set<string>>();
  for (const t of touches) {
    if (!t.managerId) continue;
    const set = contactedByManager.get(t.managerId) ?? new Set<string>();
    set.add(t.phone);
    contactedByManager.set(t.managerId, set);
  }

  // Обращение по @username (механика 1); нет username — по имени.
  const managers = await prisma.manager.findMany({
    where: { organizationId },
    select: { id: true, fullName: true, telegramUsername: true },
  });
  const mentionById = new Map(
    managers.map((m) => [m.id, m.telegramUsername ? `@${m.telegramUsername}` : m.fullName]),
  );

  const entries: CoverageEntry[] = plan.managers.map((mp) => {
    const contacted = contactedByManager.get(mp.managerId) ?? new Set<string>();
    const pending = mp.tasks.filter((t) => !contacted.has(t.phone)).map((t) => t.client);
    return {
      mention: mentionById.get(mp.managerId) ?? mp.managerId,
      contacted: mp.tasks.length - pending.length,
      total: mp.tasks.length,
      pending,
    };
  });

  for (const message of formatCoverage(entries, stage)) {
    await api.sendMessage(chatId, message);
  }

  log.info(
    { organizationId, stage, managers: entries.length },
    'OVERDUE_CHECK: счётчик покрытия отправлен в общий чат',
  );
}
