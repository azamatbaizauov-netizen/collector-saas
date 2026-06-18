import { describe, it, expect } from 'vitest';
import {
  normalizeDebtRow,
  normalizeAlias,
  normalizePhone,
  parseAmountMajor,
  parseSheetDate,
  isShiftedMopCell,
  type AliasMap,
  type RawDebtRow,
} from './debt-normalizer.js';

const aliases: AliasMap = new Map([
  ['адилбек', { managerId: 'm-adilbek', isOwner: false }],
  ['адилбек медет', { managerId: 'm-adilbek', isOwner: false }],
  ['амир', { managerId: 'm-amir', isOwner: false }],
  ['медет', { managerId: 'm-owner', isOwner: true }],
]);

// Базовая валидная строка (реальный пример: Дуйсебаев Даулет, Адилбек).
function baseRow(overrides: Partial<RawDebtRow> = {}): RawDebtRow {
  return {
    client: 'Дуйсебаев Даулет',
    mop: 'Адилбек',
    city: 'Алматы, Шымкент',
    phone: '77000248707',
    debt: 14217.0,
    aroseDate: new Date('2025-10-28'),
    promisedDate: new Date('2026-06-16'),
    lastPaymentDate: new Date('2026-06-05'),
    daysWithoutPayment: 11,
    limit: 0.0,
    comments: null,
    lastPaymentRaw: '1072$ оплатил 09.05',
    ...overrides,
  };
}

describe('normalizeAlias', () => {
  it('lower + trim + схлопывает пробелы', () => {
    expect(normalizeAlias('  Амир   Медет ')).toBe('амир медет');
    expect(normalizeAlias('Адилбек')).toBe('адилбек');
  });
});

describe('isShiftedMopCell', () => {
  it('число/мусор/пусто = съехавшая строка', () => {
    expect(isShiftedMopCell('603008.41')).toBe(true);
    expect(isShiftedMopCell('')).toBe(true);
    expect(isShiftedMopCell(123)).toBe(true);
    expect(isShiftedMopCell('Адилбек')).toBe(false);
  });
});

describe('normalizePhone', () => {
  it('float → E.164 (KZ)', () => {
    expect(normalizePhone(77757349292.0)).toBe('+77757349292');
    expect(normalizePhone('77000248707')).toBe('+77000248707');
  });
  it('Кыргызстан 996', () => {
    expect(normalizePhone('996700112233')).toBe('+996700112233');
  });
  it('битый/пустой → null', () => {
    expect(normalizePhone('7700024870')).toBeNull(); // 10 цифр
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('parseAmountMajor', () => {
  it('number и строки с мусором', () => {
    expect(parseAmountMajor(14217.0)).toBe(14217);
    expect(parseAmountMajor('5 256,9')).toBe(5256.9);
    expect(parseAmountMajor('')).toBeNull();
    expect(parseAmountMajor(null)).toBeNull();
  });
});

describe('parseSheetDate', () => {
  it('Date проходит насквозь, мусор → null', () => {
    const d = new Date('2026-06-16');
    expect(parseSheetDate(d)).toBe(d);
    expect(parseSheetDate('')).toBeNull();
    expect(parseSheetDate('не дата')).toBeNull();
  });
});

describe('normalizeDebtRow', () => {
  it('валидная строка нормализуется в USD-запись', () => {
    const r = normalizeDebtRow(baseRow(), aliases);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.managerId).toBe('m-adilbek');
    expect(r.isOwnerRow).toBe(false);
    expect(r.phone).toBe('+77000248707');
    expect(r.debt).toEqual({ amount: 1421700n, currency: 'USD' });
    expect(r.limit).toEqual({ amount: 0n, currency: 'USD' });
    expect(r.currencySuspect).toBe(false);
    expect(r.lastPaymentRaw).toBe('1072$ оплатил 09.05');
  });

  it('строка владельца помечается isOwnerRow', () => {
    const r = normalizeDebtRow(baseRow({ mop: 'Медет' }), aliases);
    expect(r.ok && r.isOwnerRow).toBe(true);
  });

  it('приставка "адилбек медет" → тот же менеджер', () => {
    const r = normalizeDebtRow(baseRow({ mop: 'Адилбек Медет' }), aliases);
    expect(r.ok && r.managerId).toBe('m-adilbek');
    expect(r.ok && r.isOwnerRow).toBe(false);
  });

  it('незнакомый МОП → unmatched_manager c алиасом', () => {
    const r = normalizeDebtRow(baseRow({ mop: 'Неизвестный' }), aliases);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unmatched_manager');
    expect(r.alias).toBe('неизвестный');
  });

  it('съехавшая строка (число в МОП) → unmatched_manager, alias null', () => {
    const r = normalizeDebtRow(baseRow({ mop: '603008.41' }), aliases);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unmatched_manager');
    expect(r.alias).toBeNull();
  });

  it('битый телефон → broken_phone (менеджер уже определён)', () => {
    const r = normalizeDebtRow(baseRow({ phone: '7700024870' }), aliases);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('broken_phone');
    expect(r.alias).toBe('адилбек');
  });

  it('тенге-выброс по долгу → currencySuspect', () => {
    const r = normalizeDebtRow(baseRow({ debt: 23000000 }), aliases);
    expect(r.ok && r.currencySuspect).toBe(true);
  });

  it('тенге-выброс по лимиту → currencySuspect', () => {
    const r = normalizeDebtRow(baseRow({ debt: 5000, limit: 1560500 }), aliases);
    expect(r.ok && r.currencySuspect).toBe(true);
  });
});
