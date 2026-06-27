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
// На каждого менеджера — поимённый список должников плана со статусом контакта:
// 🟢 менеджер сегодня написал, 🔴 ещё нет.
export interface CoverageDebtor {
  client: string;
  contacted: boolean;
}

export interface CoverageEntry {
  mention: string; // @username или имя
  debtors: CoverageDebtor[];
}

export type CoverageStage = 'reminder' | 'final';

// Блок одного менеджера: подзаголовок «написал X/Y» + нумерованный список
// должников с меткой 🟢 (написал сегодня) / 🔴 (ещё нет). Нумерация сквозная по
// списку менеджера, как в плане дня.
function coverageBlock(e: CoverageEntry): string[] {
  const contacted = e.debtors.filter((d) => d.contacted).length;
  const lines = [`${e.mention} — написал ${contacted}/${e.debtors.length}:`];
  e.debtors.forEach((d, i) => {
    lines.push(`${i + 1}. ${d.contacted ? '🟢' : '🔴'} ${d.client}`);
  });
  return lines;
}

export function formatCoverage(
  entries: CoverageEntry[],
  stage: CoverageStage = 'reminder',
): string[] {
  // Все охвачены — короткое позитивное сообщение (одинаково для обеих стадий).
  const allContacted = entries.every((e) => e.debtors.every((d) => d.contacted));
  if (allContacted) {
    return ['✅ Все должники из плана сегодня охвачены.'];
  }

  // 🟢 написал / 🔴 не написал — поимённо по каждому должнику в обеих сводках
  // (14:00 — напоминание, 17:00 — итог дня).
  const header =
    stage === 'final'
      ? 'Итог дня — 🟢 написал, 🔴 не вышли на связь:'
      : '⏰ Напоминание — 🟢 написал, 🔴 ещё не написал:';
  const lines: string[] = [];
  for (const e of entries) {
    lines.push(...coverageBlock(e));
  }
  return chunk(header, lines);
}
