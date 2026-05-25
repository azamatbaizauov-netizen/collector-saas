import { prisma } from '@repo/db';

export async function processOverdueCheck(data: { organizationId: string }): Promise<void> {
  // TODO: fetch overdue invoices, generate and send reminders via Wazzup
  void data;
}
