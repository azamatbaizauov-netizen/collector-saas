import { Api } from 'grammy';

// Воркер шлёт исходящие в Telegram напрямую через grammy Api (бот-процесс
// apps/bot ловит входящие: /start, кнопки). Разделение, чтобы воркеру не
// держать long-polling. Нет токена → null, задачи деградируют с warn.
export function getTelegramApi(): Api | null {
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  if (!token) return null;
  return new Api(token);
}

// Telegram режет сообщение на 4096 символов — шлём с запасом.
export const TELEGRAM_MAX_LEN = 3500;
