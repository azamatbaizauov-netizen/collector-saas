import { Bot } from 'grammy';
import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

const token = process.env['TELEGRAM_BOT_TOKEN'];
if (!token) {
  log.warn('TELEGRAM_BOT_TOKEN is not set — bot will not start');
  process.exit(0);
}

const bot = new Bot(token);

bot.command('start', async (ctx) => {
  await ctx.reply('Бот активен. Вы будете получать утренние сводки и уведомления по дебиторке.');
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
