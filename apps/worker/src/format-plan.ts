import { fromMinorUnits } from '@repo/shared';
import type { DailyTask } from '@repo/rules';
import { TELEGRAM_MAX_LEN } from './telegram.js';

// Форматирование сообщений плана дня (ADR 0004). Чистые функции: расчёт плана
// живёт в @repo/rules, тут — только тексты для Telegram. Длинные списки бьём на
// несколько сообщений, чтобы не упереться в лимит Telegram.

// Тело строки должника без префикса (номер/буллет добавляет вызывающий).
function taskBody(t: DailyTask): string {
  const usd = fromMinorUnits(t.debt.amount);
  // Просрочка по обещанной дате (G): 0 — срок сегодня, >0 — просрочка N дн, <0 —
  // срок ещё впереди (бывает только у владельца — его строки без фильтра по G).
  // null (срок не указан) — без суффикса срока.
  if (t.daysOverdue === null) return `${t.client} — $${usd}`;
  const term =
    t.daysOverdue === 0
      ? 'срок сегодня'
      : t.daysOverdue > 0
        ? `просрочка ${t.daysOverdue} дн`
        : `срок через ${-t.daysOverdue} дн`;
  return `${t.client} — $${usd}, ${term}`;
}

// Нумерованные строки: «1. Должник — …». Номера сквозные по списку (нумеруем до
// разбивки на сообщения, поэтому продолжаются и в следующем сообщении менеджера).
function numbered(tasks: DailyTask[]): string[] {
  return tasks.map((t, i) => `${i + 1}. ${taskBody(t)}`);
}

// Суммарный долг списка в USD-мажорных (тенге-выбросы уже изъяты в currencyReview).
function totalUsd(tasks: { debt: { amount: bigint } }[]): number {
  return fromMinorUnits(tasks.reduce((acc, t) => acc + t.debt.amount, 0n));
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
  const header = `${mention} сегодня напомни (${tasks.length}, на $${totalUsd(tasks)}):`;
  return chunk(header, numbered(tasks));
}

// Эскалация для дайджеста владельца: должник менеджера с просрочкой по сроку G
// > порога (managerName — имя ответственного менеджера, резолвит вызывающий код).
export interface EscalationEntry extends DailyTask {
  managerName: string;
}

function formatEscalation(e: EscalationEntry): string {
  return `• ${taskBody(e)} (${e.managerName})`;
}

// Механика 2: дайджест собственнику в личку по его клиентам. Плюс отдельный
// блок эскалации — должники менеджеров с просрочкой по сроку G > порога (ADR
// 0007, >30 дней): из плана менеджеров выпали, владелец видит их с ответственным МОПом.
// Должник с подозрением на тенге-выброс (ADR 0003): сумму НЕ показываем как $-долг
// (она нереальна для USD), печатаем без символа валюты — это сигнал «проверить лист».
function formatCurrencyReview(t: DailyTask): string {
  return `• ${t.client} — ${fromMinorUnits(t.debt.amount)}`;
}

export function formatOwnerDigest(
  tasks: DailyTask[],
  escalations: EscalationEntry[] = [],
  currencyReview: DailyTask[] = [],
): string[] {
  const header = `Ваши должники на сегодня (${tasks.length}, на $${totalUsd(tasks)}):`;
  const messages = chunk(header, numbered(tasks));
  if (escalations.length > 0) {
    const escHeader = `⚠️ Эскалация (просрочка >30 дней) — ${escalations.length}, на $${totalUsd(escalations)}:`;
    messages.push(...chunk(escHeader, escalations.map(formatEscalation)));
  }
  if (currencyReview.length > 0) {
    const revHeader = `⚠️ Проверить валюту (${currencyReview.length}):`;
    messages.push(...chunk(revHeader, currencyReview.map(formatCurrencyReview)));
  }
  return messages;
}

// Публичный счётчик покрытия на cutoff (ADR 0004 схема 1+2+4, ADR 0006).
// На каждого менеджера: сколько из плана связались по WhatsApp, кто остался.
export interface CoverageEntry {
  mention: string; // @username или имя
  contacted: number;
  total: number;
  pending: string[]; // имена должников, с кем менеджер сегодня не связался
}

export type CoverageStage = 'reminder' | 'final';

export function formatCoverage(
  entries: CoverageEntry[],
  stage: CoverageStage = 'reminder',
): string[] {
  // 17:00 — финал: только те, с кем так и не связались. Имена в лоб («такие-то
  // сегодня не вышли на связь»). Все охвачены — короткое позитивное сообщение.
  if (stage === 'final') {
    const pendingEntries = entries.filter((e) => e.pending.length > 0);
    if (pendingEntries.length === 0) {
      return ['✅ Итог дня: все должники из плана сегодня охвачены.'];
    }
    const lines = pendingEntries.map(
      (e) => `🔴 ${e.mention} — не вышли на связь: ${e.pending.join(', ')}`,
    );
    return chunk('Итог дня — с этими должниками сегодня не связались:', lines);
  }

  // 14:00 — напоминание: по каждому менеджеру сколько написал и кто остался.
  const lines: string[] = [];
  for (const e of entries) {
    const mark = e.pending.length === 0 ? '✅' : '⚠️';
    lines.push(`${mark} ${e.mention} — написал ${e.contacted}/${e.total}`);
    if (e.pending.length > 0) {
      lines.push(`   ещё не написал: ${e.pending.join(', ')}`);
    }
  }
  return chunk('⏰ Напоминание: кто ещё не написал должникам сегодня:', lines);
}
