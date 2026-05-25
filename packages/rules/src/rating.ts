import type { CustomerRatingValue } from '@repo/shared';

export interface PaymentHistory {
  totalPayments: number;
  overdueCount: number;
  maxOverdueDays: number;
  brokenPromisesInRow: number;
  currentOverdueDays: number;
  currentDebtAmount: bigint;
  creditLimit: bigint;
}

export interface RatingRules {
  reliableMinPayments: number;
  normalMaxOverdueCount: number;
  normalMaxOverdueDays: number;
  riskMaxOverdueCount: number;
  riskMaxOverdueDays: number;
  dangerousOverdueDays: number;
  dangerousBrokenPromises: number;
  stopOverdueDays: number;
  stopDebtMultiplier: number;
}

export const DEFAULT_RATING_RULES: RatingRules = {
  reliableMinPayments: 5,
  normalMaxOverdueCount: 2,
  normalMaxOverdueDays: 7,
  riskMaxOverdueCount: 3,
  riskMaxOverdueDays: 14,
  dangerousOverdueDays: 30,
  dangerousBrokenPromises: 2,
  stopOverdueDays: 60,
  stopDebtMultiplier: 2,
};

export function calculateRating(
  history: PaymentHistory,
  rules: RatingRules = DEFAULT_RATING_RULES,
): CustomerRatingValue {
  const {
    totalPayments,
    overdueCount,
    maxOverdueDays,
    brokenPromisesInRow,
    currentOverdueDays,
    currentDebtAmount,
    creditLimit,
  } = history;

  if (
    currentOverdueDays > rules.stopOverdueDays ||
    (creditLimit > 0n && currentDebtAmount > creditLimit * BigInt(rules.stopDebtMultiplier))
  ) {
    return 'STOP';
  }

  if (
    currentOverdueDays > rules.dangerousOverdueDays ||
    brokenPromisesInRow >= rules.dangerousBrokenPromises
  ) {
    return 'DANGEROUS';
  }

  if (overdueCount >= rules.riskMaxOverdueCount || maxOverdueDays > rules.riskMaxOverdueDays) {
    return 'RISK';
  }

  if (overdueCount <= rules.normalMaxOverdueCount && maxOverdueDays <= rules.normalMaxOverdueDays) {
    if (overdueCount === 0 && totalPayments >= rules.reliableMinPayments) {
      return 'RELIABLE';
    }
    return 'NORMAL';
  }

  return 'RISK';
}
