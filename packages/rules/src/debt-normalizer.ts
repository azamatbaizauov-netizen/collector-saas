import { toMinorUnits, type Money } from '@repo/shared';

// Нормализация строки таблицы дебиторки (лист «Отчёт МОПа», ADR 0003).
// Чистые функции: на вход грязная строка Sheet, на выход либо нормализованная
// запись, либо отказ с причиной (строка уходит в «нераспределённые» + AuditLog).

// Пилот ведётся в USD. Долг/лимит сверх этих порогов (в мажорных единицах) —
// подозрение на тенге-выброс: не конвертируем, ведём вручную. См. ADR 0003.
export const CURRENCY_SUSPECT_DEBT_THRESHOLD = 100_000;
export const CURRENCY_SUSPECT_LIMIT_THRESHOLD = 50_000;

// Сырая строка таблицы. Значения — как их отдаёт парсер xlsx (number | string |
// Date | null), нормализатор сам приводит типы.
export interface RawDebtRow {
  client: unknown; // A — Клиент (free-text)
  mop: unknown; // B — МОП
  city: unknown; // C — Город
  phone: unknown; // D — Телефон
  debt: unknown; // E — Сумма долга
  aroseDate: unknown; // F — Дата возникновения
  promisedDate: unknown; // G — Обещанная дата оплаты
  lastPaymentDate: unknown; // H — Дата последней оплаты
  daysWithoutPayment: unknown; // I — Дней без оплаты
  limit: unknown; // J — Лимит в долг
  comments: unknown; // M — Комментарии (free-text)
  lastPaymentRaw: unknown; // N — Сумма последней оплаты (free-text)
}

export interface NormalizedDebtRow {
  kind: 'imported';
  managerId: string;
  isOwnerRow: boolean; // строка владельца: не идёт в счётчик задач менеджерам
  client: string;
  city: string | null;
  phone: string; // E.164
  debt: Money;
  limit: Money | null;
  currencySuspect: boolean;
  aroseDate: Date | null;
  promisedDate: Date | null;
  lastPaymentDate: Date | null;
  daysWithoutPayment: number | null;
  commentsRaw: string | null;
  lastPaymentRaw: string | null;
}

export type RejectReason = 'unmatched_manager' | 'broken_phone';

export interface RejectedDebtRow {
  kind: 'rejected';
  reason: RejectReason;
  alias: string | null;
  raw: RawDebtRow;
}

// Строка без должника (subtotal/footer/пустая): нет ни клиента, ни телефона.
// Пропускаем молча — не импортируем и НЕ алертим владельцу (это не «потерянный
// должник», а служебная строка таблицы).
export interface SkippedDebtRow {
  kind: 'skipped';
  raw: RawDebtRow;
}

export type NormalizeResult = NormalizedDebtRow | RejectedDebtRow | SkippedDebtRow;

// Соответствие нормализованного алиаса менеджеру (из ManagerSheetAlias, ADR 0005).
export interface AliasResolution {
  managerId: string;
  isOwner: boolean;
}
export type AliasMap = ReadonlyMap<string, AliasResolution>;

// lower + trim + схлопывание пробелов. То же делаем при сидировании алиасов.
export function normalizeAlias(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Съехавшая строка: в колонке МОП число/мусор вместо имени.
export function isShiftedMopCell(raw: unknown): boolean {
  const s = String(raw ?? '').trim();
  if (s === '') return true;
  return /^[\d.,\s-]+$/.test(s); // только цифры/разделители → не имя
}

// Телефон → E.164. Часто хранится как float (77757349292.0). KZ (+7) и KG (+996).
export function normalizePhone(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  let digits =
    typeof raw === 'number' ? String(Math.trunc(raw)) : String(raw).replace(/\D/g, '');
  // Приводим все варианты записи KZ-номера к международному виду 7XXXXXXXXXX (11 цифр):
  //  - 8 777… (ведущая 8) → 7 777… (та же +7)
  //  - 777… (10 цифр, «голый» национальный без кода страны) → добавляем 7
  //  - 7 777… / +7 777… (11 цифр) — уже в нужном виде
  if (/^8\d{10}$/.test(digits)) digits = `7${digits.slice(1)}`;
  else if (/^7\d{9}$/.test(digits)) digits = `7${digits}`;
  if (/^7\d{10}$/.test(digits)) return `+${digits}`;
  if (/^996\d{9}$/.test(digits)) return `+${digits}`;
  return null; // битый/слишком короткий/чужой код
}

// Сумма в мажорных единицах (доллары) или null. Принимает number и строку.
export function parseAmountMajor(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw)
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Дата из ячейки: Date (как отдаёт парсер для дат), ISO-строка или Excel-serial.
export function parseSheetDate(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'number') {
    // Excel serial: дни с 1899-12-30 (UTC).
    const ms = Math.round((raw - 25569) * 86_400_000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toMoneyUsd(major: number): Money {
  return { amount: toMinorUnits(major), currency: 'USD' };
}

function parseIntOrNull(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function textOrNull(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  return s === '' ? null : s;
}

function isBlank(raw: unknown): boolean {
  return raw == null || String(raw).trim() === '';
}

export function normalizeDebtRow(row: RawDebtRow, aliases: AliasMap): NormalizeResult {
  // 0. Служебная строка (subtotal/footer/пустая): ни клиента, ни телефона.
  // Часто содержит число в МОП (счётчик) и сумму в долге. Пропускаем молча.
  if (isBlank(row.client) && isBlank(row.phone)) {
    return { kind: 'skipped', raw: row };
  }

  // 1. МОП → менеджер. Съехавшая/незнакомая строка → unmatched_manager.
  if (isShiftedMopCell(row.mop)) {
    return { kind: 'rejected', reason: 'unmatched_manager', alias: null, raw: row };
  }
  const alias = normalizeAlias(row.mop);
  const resolution = aliases.get(alias);
  if (!resolution) {
    return { kind: 'rejected', reason: 'unmatched_manager', alias, raw: row };
  }

  // 2. Телефон → E.164. Битый → нераспределённые (не теряем должника).
  const phone = normalizePhone(row.phone);
  if (phone === null) {
    return { kind: 'rejected', reason: 'broken_phone', alias, raw: row };
  }

  // 3. Суммы. Подозрение на тенге считаем по мажорным значениям до конвертации.
  const debtMajor = parseAmountMajor(row.debt);
  const limitMajor = parseAmountMajor(row.limit);
  const currencySuspect =
    (debtMajor !== null && debtMajor > CURRENCY_SUSPECT_DEBT_THRESHOLD) ||
    (limitMajor !== null && limitMajor > CURRENCY_SUSPECT_LIMIT_THRESHOLD);

  return {
    kind: 'imported',
    managerId: resolution.managerId,
    isOwnerRow: resolution.isOwner,
    client: String(row.client ?? '').trim(),
    city: textOrNull(row.city),
    phone,
    debt: toMoneyUsd(debtMajor ?? 0),
    limit: limitMajor === null ? null : toMoneyUsd(limitMajor),
    currencySuspect,
    aroseDate: parseSheetDate(row.aroseDate),
    promisedDate: parseSheetDate(row.promisedDate),
    lastPaymentDate: parseSheetDate(row.lastPaymentDate),
    daysWithoutPayment: parseIntOrNull(row.daysWithoutPayment),
    commentsRaw: textOrNull(row.comments),
    lastPaymentRaw: textOrNull(row.lastPaymentRaw),
  };
}
