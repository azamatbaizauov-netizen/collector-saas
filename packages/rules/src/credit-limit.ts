import type { CustomerRatingValue } from '@repo/shared';

export interface LimitSuggestion {
  newAmount: bigint;
  reason: string;
}

export interface LimitRules {
  increaseAfterConsecutiveOnTime: number;
  increasePercent: number;
  decreasePercent: number;
}

export const DEFAULT_LIMIT_RULES: LimitRules = {
  increaseAfterConsecutiveOnTime: 3,
  increasePercent: 20,
  decreasePercent: 15,
};

export function suggestLimitChange(
  currentLimit: bigint,
  rating: CustomerRatingValue,
  consecutiveOnTimePayments: number,
  rules: LimitRules = DEFAULT_LIMIT_RULES,
): LimitSuggestion | null {
  if (rating === 'STOP' || rating === 'DANGEROUS') {
    return { newAmount: 0n, reason: 'Рейтинг СТОП или Опасный — лимит обнуляется' };
  }

  if (rating === 'RISK') {
    const decreased = (currentLimit * BigInt(100 - rules.decreasePercent)) / 100n;
    return { newAmount: decreased, reason: `Рейтинг РИСК — лимит снижается на ${rules.decreasePercent}%` };
  }

  if (consecutiveOnTimePayments >= rules.increaseAfterConsecutiveOnTime) {
    const increased = (currentLimit * BigInt(100 + rules.increasePercent)) / 100n;
    return {
      newAmount: increased,
      reason: `${consecutiveOnTimePayments} оплат подряд вовремя — лимит повышается на ${rules.increasePercent}%`,
    };
  }

  return null;
}
