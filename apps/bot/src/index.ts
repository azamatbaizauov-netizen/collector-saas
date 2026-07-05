import { Bot } from 'grammy';
import { prisma } from '@repo/db';
import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

const token = process.env['TELEGRAM_BOT_TOKEN'];
if (!token) {
  log.warn('TELEGRAM_BOT_TOKEN is not set — bot will not start');
  process.exit(0);
}

const bot = new Bot(token);

// Привязка идентичности менеджера (ADR 0004/0005). Матчим по @username, который
// Telegram подтверждает (ник нельзя подделать), а не по свободному вводу.
// Ожидаемые ники предзаполнены в Manager.telegramUsername (сид). Владелец
// дополнительно проставляет OrganizationSettings.ownerTelegramUserId (механика 2).
bot.command('start', async (ctx) => {
  const from = ctx.from;
  if (!from?.username) {
    await ctx.reply(
      'У вас не задан @username в Telegram. Укажите его в настройках Telegram и повторите /start, либо обратитесь к администратору.',
    );
    return;
  }
  const username = from.username.toLowerCase();

  const manager = await prisma.manager.findFirst({ where: { telegramUsername: username } });
  if (!manager) {
    log.warn({ username, tgUserId: from?.id }, '/start: неизвестный @username, привязка отклонена');
    await ctx.reply('Ваш аккаунт не найден в списке менеджеров. Обратитесь к администратору.');
    return;
  }

  const telegramUserId = String(from.id);
  await prisma.manager.update({ where: { id: manager.id }, data: { telegramUserId } });
  if (manager.isOwner) {
    await prisma.organizationSettings.update({
      where: { organizationId: manager.organizationId },
      data: { ownerTelegramUserId: telegramUserId },
    });
  }
  log.info({ managerId: manager.id, username, isOwner: manager.isOwner }, '/start: идентичность привязана');
  await ctx.reply(`Аккаунт привязан: ${manager.fullName}. Вы будете получать план дня и уведомления по дебиторке.`);
});

bot.command('status', async (ctx) => {
  // TODO: return current overdue summary for the organization
  await ctx.reply('Функция в разработке.');
});

// Утилита онбординга: показывает id текущего чата, чтобы владелец вписал его в
// OrganizationSettings.telegramGroupChatId (туда воркер постит план дня и счётчик).
bot.command('chatid', async (ctx) => {
  const chat = ctx.chat;
  await ctx.reply(`id этого чата: ${chat.id}\nтип: ${chat.type}`);
});

// Обработчик подтверждения изменения кредитного лимита
bot.callbackQuery(/^approve_limit:(.+)$/, async (ctx) => {
  const limitId = ctx.match[1];
  // TODO: set CreditLimit.status = APPROVED
  log.info({ limitId }, 'Limit approved via Telegram');
  await ctx.answerCallbackQuery('Лимит подтверждён');
});

bot.callbackQuery(/^reject_limit:(.+)$/, async (ctx) => {
  const limitId = ctx.match[1];
  // TODO: set CreditLimit.status = REJECTED
  log.info({ limitId }, 'Limit rejected via Telegram');
  await ctx.answerCallbackQuery('Лимит отклонён');
});

// Подтверждение события долга (ADR 0010). Подтверждать/отклонять может ТОЛЬКО
// владелец (сверяем tgUserId с OrganizationSettings.ownerTelegramUserId). В режиме
// сухого прогона фиксируем решение и пишем AuditLog, но лист НЕ трогаем. Боевая
// запись в лист (Фаза B) пока не реализована — при LIVE не помечаем APPLIED.
async function loadOwnerGatedEvent(
  eventId: string,
  fromId: number | undefined,
): Promise<
  | { ok: true; event: NonNullable<Awaited<ReturnType<typeof prisma.debtBalanceEvent.findUnique>>>; sheetWriteMode: 'DRY_RUN' | 'LIVE' }
  | { ok: false; reason: string }
> {
  const event = await prisma.debtBalanceEvent.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false, reason: 'Событие не найдено' };
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: event.organizationId },
    select: { ownerTelegramUserId: true, sheetWriteMode: true },
  });
  const presser = String(fromId ?? '');
  if (!settings?.ownerTelegramUserId || presser !== settings.ownerTelegramUserId) {
    return { ok: false, reason: 'Подтверждать может только владелец' };
  }
  if (event.status !== 'PENDING') return { ok: false, reason: 'Событие уже обработано' };
  return { ok: true, event, sheetWriteMode: settings.sheetWriteMode };
}

bot.callbackQuery(/^debtevent_apply:(.+)$/, async (ctx) => {
  const eventId = ctx.match[1];
  if (!eventId) return;
  const gate = await loadOwnerGatedEvent(eventId, ctx.from?.id);
  if (!gate.ok) {
    await ctx.answerCallbackQuery(gate.reason);
    return;
  }
  if (gate.sheetWriteMode === 'LIVE') {
    await ctx.answerCallbackQuery('Боевая запись в лист пока не реализована (Фаза B)');
    return;
  }
  const presser = String(ctx.from?.id ?? '');
  await prisma.debtBalanceEvent.update({
    where: { id: eventId },
    data: { status: 'APPLIED', decidedBy: presser, decidedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: gate.event.organizationId,
      actor: presser,
      action: 'debt.balance.applied.dryrun',
      entityType: 'DebtBalanceEvent',
      entityId: eventId,
      before: { status: 'PENDING' },
      after: {
        status: 'APPLIED',
        sheetWriteMode: 'DRY_RUN',
        kind: gate.event.kind,
        debtorPhone: gate.event.debtorPhone,
        statedBalance: gate.event.statedBalance.toString(),
        currency: gate.event.currency,
      },
    },
  });
  log.info({ eventId }, 'DebtBalanceEvent подтверждён (сухой прогон, лист не изменён)');
  await ctx.answerCallbackQuery('Подтверждено (сухой прогон, лист не изменён)');
  await ctx.editMessageReplyMarkup();
});

bot.callbackQuery(/^debtevent_reject:(.+)$/, async (ctx) => {
  const eventId = ctx.match[1];
  if (!eventId) return;
  const gate = await loadOwnerGatedEvent(eventId, ctx.from?.id);
  if (!gate.ok) {
    await ctx.answerCallbackQuery(gate.reason);
    return;
  }
  const presser = String(ctx.from?.id ?? '');
  await prisma.debtBalanceEvent.update({
    where: { id: eventId },
    data: { status: 'REJECTED', decidedBy: presser, decidedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: gate.event.organizationId,
      actor: presser,
      action: 'debt.balance.rejected',
      entityType: 'DebtBalanceEvent',
      entityId: eventId,
      before: { status: 'PENDING' },
      after: { status: 'REJECTED', debtorPhone: gate.event.debtorPhone },
    },
  });
  log.info({ eventId }, 'DebtBalanceEvent отклонён владельцем');
  await ctx.answerCallbackQuery('Отклонено');
  await ctx.editMessageReplyMarkup();
});

bot.catch((err) => log.error({ err }, 'Bot error'));

await bot.start();
log.info('Telegram bot started');
