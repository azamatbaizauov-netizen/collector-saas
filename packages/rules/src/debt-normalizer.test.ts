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
  it('KZ во всех формах записи → один E.164', () => {
    // 8 778 159 89 55 записан по-разному — результат одинаковый
    expect(normalizePhone('+77781598955')).toBe('+77781598955'); // +7 …
    expect(normalizePhone('87781598955')).toBe('+77781598955'); // 8 …
    expect(normalizePhone('77781598955')).toBe('+77781598955'); // 7 …
    expect(normalizePhone('7781598955')).toBe('+77781598955'); // без кода, сразу с оператора
    expect(normalizePhone('8 (778) 159-89-55')).toBe('+77781598955'); // с разделителями
    expect(normalizePhone('87075551235')).toBe('+77075551235');
    expect(normalizePhone(87757349292.0)).toBe('+77757349292'); // float с 8
  });
  it('Кыргызстан 996', () => {
    expect(normalizePhone('996700112233')).toBe('+996700112233');
  });
  it('битый/пустой → null', () => {
    expect(normalizePhone('778159895')).toBeNull(); // 9 цифр — слишком коротко
    expect(normalizePhone('12025550173')).toBeNull(); // чужой код страны
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
    expect(r.kind).toBe('imported');
    if (r.kind !== 'imported') return;
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
    expect(r.kind === 'imported' && r.isOwnerRow).toBe(true);
  });

  it('приставка "адилбек медет" → тот же менеджер', () => {
    const r = normalizeDebtRow(baseRow({ mop: 'Адилбек Медет' }), aliases);
    expect(r.kind === 'imported' && r.managerId).toBe('m-adilbek');
    expect(r.kind === 'imported' && r.isOwnerRow).toBe(false);
  });

  it('незнакомый МОП → unmatched_manager c алиасом', () => {
    const r = normalizeDebtRow(baseRow({ mop: 'Неизвестный' }), aliases);
    expect(r.kind).toBe('rejected');
    if (r.kind !== 'rejected') return;
    expect(r.reason).toBe('unmatched_manager');
    expect(r.alias).toBe('неизвестный');
  });

  it('съехавшая строка с данными, но число в МОП → unmatched_manager, alias null', () => {
    const r = normalizeDebtRow(baseRow({ mop: '603008.41' }), aliases);
    expect(r.kind).toBe('rejected');
    if (r.kind !== 'rejected') return;
    expect(r.reason).toBe('unmatched_manager');
    expect(r.alias).toBeNull();
  });

  it('битый телефон → broken_phone (менеджер уже определён)', () => {
    const r = normalizeDebtRow(baseRow({ phone: '770002487' }), aliases); // 9 цифр — слишком коротко
    expect(r.kind).toBe('rejected');
    if (r.kind !== 'rejected') return;
    expect(r.reason).toBe('broken_phone');
    expect(r.alias).toBe('адилбек');
  });

  it('тенге-выброс по долгу → currencySuspect', () => {
    const r = normalizeDebtRow(baseRow({ debt: 23000000 }), aliases);
    expect(r.kind === 'imported' && r.currencySuspect).toBe(true);
  });

  it('тенге-выброс по лимиту → currencySuspect', () => {
    const r = normalizeDebtRow(baseRow({ debt: 5000, limit: 1560500 }), aliases);
    expect(r.kind === 'imported' && r.currencySuspect).toBe(true);
  });

  it('subtotal/footer строка (нет клиента и телефона) → skipped, без алерта', () => {
    // Реальный пример: счётчик в МОП, сумма в долге, клиента/телефона нет.
    const r = normalizeDebtRow(
      baseRow({ mop: 59, client: null, phone: null, debt: 171613.95 }),
      aliases,
    );
    expect(r.kind).toBe('skipped');
  });

  it('пустая строка → skipped', () => {
    const r = normalizeDebtRow(baseRow({ mop: null, client: null, phone: null, debt: null }), aliases);
    expect(r.kind).toBe('skipped');
  });
});
