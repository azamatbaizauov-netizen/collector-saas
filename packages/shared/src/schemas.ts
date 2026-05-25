import { z } from 'zod';

export const organizationIdSchema = z.string().cuid();
export const contactIdSchema = z.string().min(1);

export const moneySchema = z.object({
  amount: z.bigint().nonnegative(),
  currency: z.string().length(3),
});
