import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { InboundMessageJob } from '@repo/messaging';

const connection = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const messagesQueue = new Queue('messages', { connection });

export async function enqueueInboundMessage(job: InboundMessageJob): Promise<void> {
  // jobId по greenApiMessageId — вторая страховка от дублей помимо WebhookProcessed.
  await messagesQueue.add('INBOUND_MESSAGE', job, {
    jobId: `${job.instanceId}_${job.greenApiMessageId}`,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}
