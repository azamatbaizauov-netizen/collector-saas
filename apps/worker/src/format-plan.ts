import { fromMinorUnits } from '@repo/shared';
import type { DailyTask } from '@repo/rules';
import { TELEGRAM_MAX_LEN } from './telegram.js';

// Форматирование сообщений плана дня (ADR 0004). Чистые функции: расчёт плана
// живёт в @repo/rules, тут — только тексты для Telegram. Длинные списки бьём на
// несколько сообщений, чтобы не упереться в лимит Telegram.

function formatTask(t: DailyTask): string {
  const usd = fromMinorUnits(t.debt.amount);
  const days = t.daysWithoutPayment ?? '?';
  return `• ${t.client} — $${usd}, ${days} дн`;
}

// Собирает header + строки в одно или несколько сообщений под лимит Telegram.
function chunk(header: string, lines: string[]): string[] {
  const messages: string[] = [];
  let current = header;
  for (const line of lines) {
    if (current.length + line.length + 1 > TELEGRAM_MAX_LEN) {
      messages.push(current);
      current = line;
    } else {
      current += '\n' + line;
    }
  }
  messages.push(current);
  return messages;
}

// Механика 1: адресный план менеджеру в общий чат. mention = @username или имя.
export function formatManagerPlan(mention: string, tasks: DailyTask[]): string[] {
  const header = `${mention} сегодня напомни (${tasks.length}):`;
  return chunk(header, tasks.map(formatTask));
}

// Механика 2: дайджест собственнику в личку по его клиентам.
export function formatOwnerDigest(tasks: DailyTask[]): string[] {
  const header = `Ваши должники на сегодня (${tasks.length}):`;
  return chunk(header, tasks.map(formatTask));
}
