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

bot.catch((err) => log.error({ err }, 'Bot error'));

await bot.start();
log.info('Telegram bot started');
