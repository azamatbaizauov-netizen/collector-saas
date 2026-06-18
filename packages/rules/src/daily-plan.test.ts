import { describe, it, expect } from 'vitest';
import { buildDailyPlan } from './daily-plan.js';
import type { NormalizedDebtRow } from './debt-normalizer.js';

function row(overrides: Partial<NormalizedDebtRow> = {}): NormalizedDebtRow {
  return {
    kind: 'imported',
    managerId: 'm-adilbek',
    isOwnerRow: false,
    client: 'Клиент',
    city: null,
    phone: '+77000000000',
    debt: { amount: 100000n, currency: 'USD' },
    limit: null,
    currencySuspect: false,
    aroseDate: null,
    promisedDate: null,
    lastPaymentDate: null,
    daysWithoutPayment: 5,
    commentsRaw: null,
    lastPaymentRaw: null,
    ...overrides,
  };
}

describe('buildDailyPlan', () => {
  it('группирует по менеджеру, владельца — в отдельную корзину', () => {
    const plan = buildDailyPlan([
      row({ managerId: 'm-adilbek', client: 'А' }),
      row({ managerId: 'm-amir', client: 'Б' }),
      row({ managerId: 'm-owner', isOwnerRow: true, client: 'Владелец-клиент' }),
    ]);
    expect(plan.managers.map((m) => m.managerId)).toEqual(['m-adilbek', 'm-amir']);
    expect(plan.ownerTasks).toHaveLength(1);
    expect(plan.ownerTasks[0]?.client).toBe('Владелец-клиент');
  });

  it('должники с нулевым/отрицательным долгом не попадают в план', () => {
    const plan = buildDailyPlan([
      row({ client: 'Должен', debt: { amount: 5000n, currency: 'USD' } }),
      row({ client: 'Закрыл', debt: { amount: 0n, currency: 'USD' } }),
    ]);
    expect(plan.managers).toHaveLength(1);
    expect(plan.managers[0]?.tasks.map((t) => t.client)).toEqual(['Должен']);
  });

  it('сортировка: больше дней без оплаты — выше, при равенстве больше долг', () => {
    const plan = buildDailyPlan([
      row({ client: 'мало дней', daysWithoutPayment: 3, debt: { amount: 999999n, currency: 'USD' } }),
      row({ client: 'много дней', daysWithoutPayment: 30, debt: { amount: 100n, currency: 'USD' } }),
      row({ client: 'те же дни, больше долг', daysWithoutPayment: 30, debt: { amount: 500000n, currency: 'USD' } }),
    ]);
    expect(plan.managers[0]?.tasks.map((t) => t.client)).toEqual([
      'те же дни, больше долг',
      'много дней',
      'мало дней',
    ]);
  });

  it('неизвестные дни без оплаты (null) уходят в конец', () => {
    const plan = buildDailyPlan([
      row({ client: 'null дней', daysWithoutPayment: null }),
      row({ client: '0 дней', daysWithoutPayment: 0 }),
    ]);
    expect(plan.managers[0]?.tasks.map((t) => t.client)).toEqual(['0 дней', 'null дней']);
  });

  it('пустой вход → пустой план', () => {
    const plan = buildDailyPlan([]);
    expect(plan.managers).toEqual([]);
    expect(plan.ownerTasks).toEqual([]);
  });
});
