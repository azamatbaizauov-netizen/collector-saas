import { prisma } from '@repo/db';

export async function processMorningDigest(data: { organizationId: string }): Promise<void> {
  // TODO: compile daily digest and send to owner via Telegram bot
  void data;
}
