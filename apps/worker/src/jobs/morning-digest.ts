import { prisma } from '@repo/db';
import { loadDailyPlan } from '../debt-data.js';
import { getTelegramApi } from '../telegram.js';
import { formatOwnerDigest } from '../format-plan.js';
import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

// Механика 2 (ADR 0004): ежедневная сводка собственнику в личку — только его
// клиенты (строки "Медет" в Sheet). Информирование, без кнопки-подтверждения.
// В общий чат бот постит факт "✅ сводка сформирована" (присутствие, не дубль).
export async function processMorningDigest(data: { organizationId: string }): Promise<void> {
  const { organizationId } = data;

  const plan = await loadDailyPlan(organizationId);
  if (!plan) {
    log.warn({ organizationId }, 'MORNING_DIGEST: источник дебиторки не сконфигурирован, пропуск');
    return;
  }

  const api = getTelegramApi();
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { telegramGroupChatId: true, ownerTelegramUserId: true },
  });
  if (!api || !settings?.ownerTelegramUserId) {
    log.warn(
      { organizationId, ownerTasks: plan.ownerTasks.length },
      'MORNING_DIGEST: нет TELEGRAM_BOT_TOKEN/ownerTelegramUserId, сводка посчитана, но не отправлена',
    );
    return;
  }

  for (const message of formatOwnerDigest(plan.ownerTasks)) {
    await api.sendMessage(settings.ownerTelegramUserId, message);
  }

  if (settings.telegramGroupChatId) {
    await api.sendMessage(settings.telegramGroupChatId, '✅ сводка сформирована');
  }

  log.info(
    { organizationId, ownerTasks: plan.ownerTasks.length },
    'MORNING_DIGEST: сводка отправлена собственнику',
  );
}
