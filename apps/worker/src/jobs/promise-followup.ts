import { prisma } from '@repo/db';

export async function processPromiseFollowup(data: { organizationId: string }): Promise<void> {
  // TODO: check PENDING promises past due date, mark as BROKEN, escalate
  void data;
}
