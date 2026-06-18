import type { Money } from '@repo/shared';
import type { NormalizedDebtRow } from './debt-normalizer.js';

// План «кому напомнить сегодня» (ADR 0004, механики 1 и 2). Чистая функция:
// вход — нормализованные строки дебиторки, выход — задачи по менеджерам +
// отдельная корзина клиентов владельца (идёт в MORNING_DIGEST в личку, не в
// общий чат). Критерий пилота: все должники с долгом > 0, сортировка по
// приоритету (дни без оплаты ↓, затем сумма долга ↓). Согласовано с Алдияром.

export interface DailyTask {
  client: string;
  phone: string; // E.164 — для ссылки wa.me в Telegram-сообщении
  debt: Money;
  daysWithoutPayment: number | null;
  promisedDate: Date | null;
}

export interface ManagerPlan {
  managerId: string;
  tasks: DailyTask[]; // отсортированы по приоритету
}

export interface DailyPlan {
  managers: ManagerPlan[]; // менеджеры (не владелец), у каждого свой список
  ownerTasks: DailyTask[]; // клиенты владельца → MORNING_DIGEST собственнику
}

function toTask(row: NormalizedDebtRow): DailyTask {
  return {
    client: row.client,
    phone: row.phone,
    debt: row.debt,
    daysWithoutPayment: row.daysWithoutPayment,
    promisedDate: row.promisedDate,
  };
}

// Приоритет: больше дней без оплаты — выше; при равенстве — больше долг.
// Неизвестные дни (null) уходят в конец.
function byPriority(a: DailyTask, b: DailyTask): number {
  const da = a.daysWithoutPayment ?? -1;
  const db = b.daysWithoutPayment ?? -1;
  if (da !== db) return db - da;
  if (a.debt.amount !== b.debt.amount) return a.debt.amount > b.debt.amount ? -1 : 1;
  return 0;
}

export function buildDailyPlan(rows: readonly NormalizedDebtRow[]): DailyPlan {
  const ownerTasks: DailyTask[] = [];
  const byManager = new Map<string, DailyTask[]>();

  for (const row of rows) {
    if (row.debt.amount <= 0n) continue; // долг закрыт/нулевой — не в план
    const task = toTask(row);
    if (row.isOwnerRow) {
      ownerTasks.push(task);
      continue;
    }
    const list = byManager.get(row.managerId);
    if (list) list.push(task);
    else byManager.set(row.managerId, [task]);
  }

  ownerTasks.sort(byPriority);
  const managers: ManagerPlan[] = [...byManager.entries()]
    .map(([managerId, tasks]) => ({ managerId, tasks: tasks.sort(byPriority) }))
    .sort((a, b) => a.managerId.localeCompare(b.managerId));

  return { managers, ownerTasks };
}
