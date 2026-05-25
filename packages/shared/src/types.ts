export type CustomerRatingValue = 'RELIABLE' | 'NORMAL' | 'RISK' | 'DANGEROUS' | 'STOP';

export type ReminderTone = 'SOFT' | 'FIRM' | 'STRICT' | 'FINAL';

export type ReplyIntent =
  | 'PROMISE_TO_PAY'
  | 'PAID'
  | 'DISPUTE'
  | 'REQUEST_DELAY'
  | 'OTHER';

export type ReminderSource = 'AUTO' | 'MANAGER';

export const RATING_ORDER: CustomerRatingValue[] = [
  'RELIABLE',
  'NORMAL',
  'RISK',
  'DANGEROUS',
  'STOP',
];
