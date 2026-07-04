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
  if (plan.managers.length === 0 && plan.ownerTasks.length === 0) {
    log.info({ organizationId }, 'OVERDUE_CHECK: план дня пуст, счётчик не отправляем');
    return;
  }

  const api = getTelegramApi();
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { telegramGroupChatId: true, ownerTelegramUserId: true },
  });
  if (!api) {
    log.warn({ organizationId }, 'OVERDUE_CHECK: нет TELEGRAM_BOT_TOKEN, счётчик посчитан, но не отправлен');
    return;
  }

  // Сегодняшние исходящие касания (= сам написал) → номера по менеджеру/владельцу.
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

  // Обращение по @username (механика 1); нет username — по имени. Владельца тоже
  // резолвим тут — его счётчик пойдёт ему в личку, а не в общий чат.
  const managers = await prisma.manager.findMany({
    where: { organizationId },
    select: { id: true, fullName: true, telegramUsername: true, isOwner: true },
  });
  const mentionById = new Map(
    managers.map((m) => [m.id, m.telegramUsername ? `@${m.telegramUsername}` : m.fullName]),
  );
  const ownerManagerId = managers.find((m) => m.isOwner)?.id;

  // Счётчик менеджеров → общий чат (публичная прозрачность, ADR 0004/0006).
  const chatId = settings?.telegramGroupChatId;
  if (plan.managers.length > 0 && chatId) {
    const entries: CoverageEntry[] = plan.managers.map((mp) => {
      const contacted = contactedByManager.get(mp.managerId) ?? new Set<string>();
      return {
        mention: mentionById.get(mp.managerId) ?? mp.managerId,
        debtors: mp.tasks.map((t) => ({ client: t.client, contacted: contacted.has(t.phone) })),
      };
    });
    for (const message of formatCoverage(entries, stage)) {
      await api.sendMessage(chatId, message);
    }
    log.info(
      { organizationId, stage, managers: entries.length },
      'OVERDUE_CHECK: счётчик покрытия менеджеров отправлен в общий чат',
    );
  } else if (plan.managers.length > 0) {
    log.warn({ organizationId }, 'OVERDUE_CHECK: нет telegramGroupChatId, счётчик менеджеров не отправлен');
  }

  // Счётчик владельца → ему в личку (в общий чат его не выносим — по его просьбе).
  if (plan.ownerTasks.length > 0 && ownerManagerId && settings?.ownerTelegramUserId) {
    const contacted = contactedByManager.get(ownerManagerId) ?? new Set<string>();
    const ownerEntry: CoverageEntry = {
      mention: mentionById.get(ownerManagerId) ?? 'Вы',
      debtors: plan.ownerTasks.map((t) => ({ client: t.client, contacted: contacted.has(t.phone) })),
    };
    for (const message of formatCoverage([ownerEntry], stage)) {
      await api.sendMessage(settings.ownerTelegramUserId, message);
    }
    log.info(
      { organizationId, stage, ownerTasks: plan.ownerTasks.length },
      'OVERDUE_CHECK: счётчик покрытия владельца отправлен в личку',
    );
  } else if (plan.ownerTasks.length > 0) {
    log.warn(
      { organizationId },
      'OVERDUE_CHECK: владелец не резолвится (isOwner/ownerTelegramUserId), его счётчик не отправлен',
    );
  }
}
