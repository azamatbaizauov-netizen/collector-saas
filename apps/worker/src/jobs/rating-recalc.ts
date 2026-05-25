import { prisma } from '@repo/db';

export async function processRatingRecalc(data: { organizationId: string }): Promise<void> {
  // TODO: fetch contacts from Bitrix, calculate ratings, write to CustomerRating
  void data;
}
