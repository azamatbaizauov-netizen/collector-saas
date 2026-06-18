import { prisma } from '@repo/db';
import { loadDailyPlan } from '../debt-data.js';
import { getTelegramApi } from '../telegram.js';
import { formatManagerPlan } from '../format-plan.js';
import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

// Механика 1 (ADR 0004): утром бот постит план дня в общий чат адресно по
// @username. Собственник — участник чата, поэтому всё на его глазах. Система
// НЕ пишет должникам — только напоминает менеджеру, кому написать.
export async function processDailyPlan(data: { organizationId: string }): Promise<void> {
  const { organizationId } = data;

  const plan = await loadDailyPlan(organizationId);
  if (!plan) {
    log.warn({ organizationId }, 'DAILY_PLAN: источник дебиторки не сконфигурирован, пропуск');
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
      'DAILY_PLAN: нет TELEGRAM_BOT_TOKEN/telegramGroupChatId, план посчитан, но не отправлен',
    );
    return;
  }

  // Обращение по @username (механика 1); нет username — по имени.
  const managers = await prisma.manager.findMany({
    where: { organizationId },
    select: { id: true, fullName: true, telegramUsername: true },
  });
  const mentionById = new Map(
    managers.map((m) => [m.id, m.telegramUsername ? `@${m.telegramUsername}` : m.fullName]),
  );

  for (const mp of plan.managers) {
    const mention = mentionById.get(mp.managerId) ?? mp.managerId;
    for (const message of formatManagerPlan(mention, mp.tasks)) {
      await api.sendMessage(chatId, message);
    }
  }

  log.info(
    { organizationId, managers: plan.managers.length },
    'DAILY_PLAN: план дня отправлен в общий чат',
  );
}
