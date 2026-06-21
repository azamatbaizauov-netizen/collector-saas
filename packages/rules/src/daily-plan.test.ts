import { describe, it, expect } from 'vitest';
import { buildDailyPlan } from './daily-plan.js';
import type { NormalizedDebtRow } from './debt-normalizer.js';

// Фиксированное «сегодня» для детерминизма. Сравнение в daysOverduePromised —
// по UTC-дате, поэтому даты строим через Date.UTC.
const TODAY = new Date('2026-06-21T10:00:00Z');

// Обещанная дата (колонка G) со сдвигом относительно TODAY: отрицательное —
// просрочка, 0 — срок сегодня, положительное — срок в будущем.
function due(offsetDays: number): Date {
  return new Date(Date.UTC(2026, 5, 21 + offsetDays));
}

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
    promisedDate: due(-1), // по умолчанию срок просрочен на 1 день → в плане
    lastPaymentDate: null,
    daysWithoutPayment: 5,
    commentsRaw: null,
    lastPaymentRaw: null,
    ...overrides,
  };
}

describe('buildDailyPlan', () => {
  it('группирует по менеджеру, владельца — в отдельную корзину', () => {
    const plan = buildDailyPlan(
      [
        row({ managerId: 'm-adilbek', client: 'А' }),
        row({ managerId: 'm-amir', client: 'Б' }),
        row({ managerId: 'm-owner', isOwnerRow: true, client: 'Владелец-клиент' }),
      ],
      TODAY,
    );
    expect(plan.managers.map((m) => m.managerId)).toEqual(['m-adilbek', 'm-amir']);
    expect(plan.ownerTasks).toHaveLength(1);
    expect(plan.ownerTasks[0]?.client).toBe('Владелец-клиент');
  });

  it('должники с нулевым/отрицательным долгом не попадают в план', () => {
    const plan = buildDailyPlan(
      [
        row({ client: 'Должен', debt: { amount: 5000n, currency: 'USD' } }),
        row({ client: 'Закрыл', debt: { amount: 0n, currency: 'USD' } }),
      ],
      TODAY,
    );
    expect(plan.managers).toHaveLength(1);
    expect(plan.managers[0]?.tasks.map((t) => t.client)).toEqual(['Должен']);
  });

  it('будущий срок (G ещё не наступил) — не в плане менеджера', () => {
    const plan = buildDailyPlan(
      [
        row({ client: 'срок завтра', promisedDate: due(1) }),
        row({ client: 'срок через месяц', promisedDate: due(30) }),
        row({ client: 'срок вчера', promisedDate: due(-1) }),
      ],
      TODAY,
    );
    expect(plan.managers[0]?.tasks.map((t) => t.client)).toEqual(['срок вчера']);
  });

  it('пустой срок (G не указан) — должник менеджера не в плане', () => {
    const plan = buildDailyPlan(
      [
        row({ client: 'без срока', promisedDate: null }),
        row({ client: 'со сроком', promisedDate: due(-2) }),
      ],
      TODAY,
    );
    expect(plan.managers[0]?.tasks.map((t) => t.client)).toEqual(['со сроком']);
  });

  it('срок наступил сегодня — в плане, daysOverdue = 0', () => {
    const plan = buildDailyPlan([row({ client: 'сегодня', promisedDate: due(0) })], TODAY);
    expect(plan.managers[0]?.tasks[0]?.client).toBe('сегодня');
    expect(plan.managers[0]?.tasks[0]?.daysOverdue).toBe(0);
  });

  it('сортировка: больше просрочка по сроку — выше, при равенстве больше долг', () => {
    const plan = buildDailyPlan(
      [
        row({ client: 'мало просрочки', promisedDate: due(-3), debt: { amount: 999999n, currency: 'USD' } }),
        row({ client: 'много просрочки', promisedDate: due(-20), debt: { amount: 100n, currency: 'USD' } }),
        row({ client: 'та же просрочка, больше долг', promisedDate: due(-20), debt: { amount: 500000n, currency: 'USD' } }),
      ],
      TODAY,
    );
    expect(plan.managers[0]?.tasks.map((t) => t.client)).toEqual([
      'та же просрочка, больше долг',
      'много просрочки',
      'мало просрочки',
    ]);
  });

  it('просрочка по сроку > 30 дней уходит в эскалацию владельцу с менеджером', () => {
    const plan = buildDailyPlan(
      [
        row({ managerId: 'm-adilbek', client: 'свежая просрочка', promisedDate: due(-10) }),
        row({ managerId: 'm-adilbek', client: 'старая просрочка', promisedDate: due(-31) }),
        row({ managerId: 'm-adilbek', client: 'ровно 30', promisedDate: due(-30) }),
        row({ managerId: 'm-owner', isOwnerRow: true, client: 'старый владельца', promisedDate: due(-200) }),
      ],
      TODAY,
    );
    expect(plan.managers[0]?.tasks.map((t) => t.client)).toEqual([
      'ровно 30',
      'свежая просрочка',
    ]);
    // >30 дней просрочки менеджера — в эскалацию, с привязкой к менеджеру.
    expect(plan.escalationTasks.map((t) => t.client)).toEqual(['старая просрочка']);
    expect(plan.escalationTasks[0]?.managerId).toBe('m-adilbek');
    // Владельца порог/срок не касается — его клиент остаётся в ownerTasks.
    expect(plan.ownerTasks.map((t) => t.client)).toEqual(['старый владельца']);
  });

  it('эскалация сортируется по приоритету (больше просрочка — выше)', () => {
    const plan = buildDailyPlan(
      [
        row({ managerId: 'm-adilbek', client: '40 дн', promisedDate: due(-40) }),
        row({ managerId: 'm-amir', client: '90 дн', promisedDate: due(-90) }),
      ],
      TODAY,
    );
    expect(plan.escalationTasks.map((t) => t.client)).toEqual(['90 дн', '40 дн']);
    expect(plan.escalationTasks.map((t) => t.managerId)).toEqual(['m-amir', 'm-adilbek']);
  });

  it('владелец без срока G всё равно попадает в ownerTasks', () => {
    const plan = buildDailyPlan(
      [row({ managerId: 'm-owner', isOwnerRow: true, client: 'владелец без срока', promisedDate: null })],
      TODAY,
    );
    expect(plan.ownerTasks.map((t) => t.client)).toEqual(['владелец без срока']);
    expect(plan.ownerTasks[0]?.daysOverdue).toBeNull();
  });

  it('порог эскалации переопределяется параметром', () => {
    const plan = buildDailyPlan(
      [
        row({ client: 'просрочка 10', promisedDate: due(-10) }),
        row({ client: 'просрочка 11', promisedDate: due(-11) }),
      ],
      TODAY,
      10,
    );
    expect(plan.managers[0]?.tasks.map((t) => t.client)).toEqual(['просрочка 10']);
    expect(plan.escalationTasks.map((t) => t.client)).toEqual(['просрочка 11']);
  });

  it('пустой вход → пустой план', () => {
    const plan = buildDailyPlan([], TODAY);
    expect(plan.managers).toEqual([]);
    expect(plan.ownerTasks).toEqual([]);
    expect(plan.escalationTasks).toEqual([]);
  });
});
