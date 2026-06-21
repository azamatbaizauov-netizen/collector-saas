import type { Money } from '@repo/shared';
import type { NormalizedDebtRow } from './debt-normalizer.js';

// План «кому напомнить сегодня» (ADR 0004/0007, механики 1 и 2). Чистая функция:
// вход — нормализованные строки дебиторки, выход — задачи по менеджерам +
// отдельная корзина клиентов владельца (идёт в MORNING_DIGEST в личку, не в
// общий чат). Главный критерий — обещанная дата оплаты (колонка G): должник
// попадает в план менеджера, только если срок уже наступил или прошёл. Дни без
// оплаты (от последней оплаты) обманчивы и НЕ управляют планом. Сортировка по
// приоритету (просрочка по сроку ↓, затем сумма долга ↓). Согласовано с Алдияром.

// Порог эскалации (ADR 0007): просрочка по обещанной дате (G) больше этого числа
// дней — должник выпадает из плана МЕНЕДЖЕРА и уходит владельцу блоком эскалации.
// Касается только списков менеджеров; владелец в MORNING_DIGEST видит всех своих.
// Дефолт; переопределяется на организацию через OrganizationSettings.
export const ESCALATION_OVERDUE_DAYS = 30;

// Просрочка по обещанной дате в календарных днях (UTC-усечение до даты):
// >= 0 — срок наступил/прошёл, > 0 — просрочка, < 0 — срок ещё впереди.
// promisedDate из Excel-serial парсится как UTC-полночь; задачи идут утром/днём
// по KZ ≈ та же дата в UTC — для пилота сравнение по UTC-дате достаточно.
export function daysOverduePromised(promisedDate: Date, today: Date): number {
  const p = Date.UTC(
    promisedDate.getUTCFullYear(),
    promisedDate.getUTCMonth(),
    promisedDate.getUTCDate(),
  );
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((t - p) / 86_400_000);
}

export interface DailyTask {
  client: string;
  phone: string; // E.164 — для ссылки wa.me в Telegram-сообщении
  debt: Money;
  daysWithoutPayment: number | null;
  promisedDate: Date | null;
  daysOverdue: number | null; // просрочка по сроку G; null — срок не указан
}

export interface ManagerPlan {
  managerId: string;
  tasks: DailyTask[]; // отсортированы по приоритету
}

// Должник менеджера с просрочкой по сроку G > порога: из плана менеджера выпадает,
// но не теряется — уходит владельцу в MORNING_DIGEST отдельным блоком эскалации
// с указанием ответственного менеджера (managerId → имя резолвит воркер).
export interface EscalationTask extends DailyTask {
  managerId: string;
}

export interface DailyPlan {
  managers: ManagerPlan[]; // менеджеры (не владелец), у каждого свой список
  ownerTasks: DailyTask[]; // клиенты владельца → MORNING_DIGEST собственнику
  escalationTasks: EscalationTask[]; // >порога дней у менеджеров → MORNING_DIGEST, блок эскалации
  // Подозрение на тенге-выброс (ADR 0003): сумма нереальна для USD. Не показываем
  // как $-долг ни менеджеру, ни владельцу — выносим в блок «проверить валюту» в
  // MORNING_DIGEST. Это вопрос к данным (чинит владелец/админ в листе), а не задача
  // менеджеру: из планов и эскалации такие строки изымаются.
  currencyReview: DailyTask[];
}

function toTask(row: NormalizedDebtRow, today: Date): DailyTask {
  return {
    client: row.client,
    phone: row.phone,
    debt: row.debt,
    daysWithoutPayment: row.daysWithoutPayment,
    promisedDate: row.promisedDate,
    daysOverdue: row.promisedDate ? daysOverduePromised(row.promisedDate, today) : null,
  };
}

// Приоритет: больше просрочка по сроку — выше; при равенстве — больше долг.
// Неизвестная просрочка (null, срок не указан) уходит в конец.
function byPriority(a: DailyTask, b: DailyTask): number {
  const da = a.daysOverdue ?? -Infinity;
  const db = b.daysOverdue ?? -Infinity;
  if (da !== db) return db - da;
  if (a.debt.amount !== b.debt.amount) return a.debt.amount > b.debt.amount ? -1 : 1;
  return 0;
}

export function buildDailyPlan(
  rows: readonly NormalizedDebtRow[],
  today: Date = new Date(),
  escalationOverdueDays: number = ESCALATION_OVERDUE_DAYS,
): DailyPlan {
  const ownerTasks: DailyTask[] = [];
  const escalationTasks: EscalationTask[] = [];
  const currencyReview: DailyTask[] = [];
  const byManager = new Map<string, DailyTask[]>();

  for (const row of rows) {
    if (row.debt.amount <= 0n) continue; // долг закрыт/нулевой — не в план
    const task = toTask(row, today);
    // Подозрение на тенге: изымаем из всех списков (и менеджера, и владельца) —
    // это data-quality, а не «напомнить сегодня». Уходит в блок «проверить валюту».
    if (row.currencySuspect) {
      currencyReview.push(task);
      continue;
    }
    // Владельца порог/срок не касается — все его клиенты с долгом > 0 в сводку.
    if (row.isOwnerRow) {
      ownerTasks.push(task);
      continue;
    }
    // Менеджеру шлём только при наступившем сроке (G). Нет срока или срок впереди —
    // не «напомнить сегодня», должника в план не кладём.
    if (task.daysOverdue === null || task.daysOverdue < 0) continue;
    // Просрочка по сроку > порога — не «напомнить», а эскалация владельцу.
    if (task.daysOverdue > escalationOverdueDays) {
      escalationTasks.push({ ...task, managerId: row.managerId });
      continue;
    }
    const list = byManager.get(row.managerId);
    if (list) list.push(task);
    else byManager.set(row.managerId, [task]);
  }

  ownerTasks.sort(byPriority);
  escalationTasks.sort(byPriority);
  // Блок «проверить валюту»: срок тут не показатель, сортируем по сумме (больше — выше).
  currencyReview.sort((a, b) =>
    a.debt.amount === b.debt.amount ? 0 : a.debt.amount > b.debt.amount ? -1 : 1,
  );
  const managers: ManagerPlan[] = [...byManager.entries()]
    .map(([managerId, tasks]) => ({ managerId, tasks: tasks.sort(byPriority) }))
    .sort((a, b) => a.managerId.localeCompare(b.managerId));

  return { managers, ownerTasks, escalationTasks, currencyReview };
}
