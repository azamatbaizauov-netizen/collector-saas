import type { ReminderTone } from '@repo/shared';

export function getReminderTone(overdueDays: number): ReminderTone {
  if (overdueDays <= 3) return 'SOFT';
  if (overdueDays <= 10) return 'FIRM';
  if (overdueDays <= 30) return 'STRICT';
  return 'FINAL';
}
