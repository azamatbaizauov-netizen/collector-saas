import { Worker } from 'bullmq';
import { connection } from './redis.js';
import { processRatingRecalc } from './jobs/rating-recalc.js';
import { processOverdueCheck } from './jobs/overdue-check.js';
import { processMorningDigest } from './jobs/morning-digest.js';
import { processPromiseFollowup } from './jobs/promise-followup.js';
import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

const worker = new Worker(
  'schedule',
  async (job) => {
    log.info({ jobType: job.name, jobId: job.id }, 'Processing job');
    switch (job.name) {
      case 'RATING_RECALC':
        return processRatingRecalc(job.data as { organizationId: string });
      case 'DAILY_OVERDUE_CHECK':
        return processOverdueCheck(job.data as { organizationId: string });
      case 'MORNING_DIGEST':
        return processMorningDigest(job.data as { organizationId: string });
      case 'PROMISE_FOLLOWUP':
        return processPromiseFollowup(job.data as { organizationId: string });
      default:
        log.warn({ jobName: job.name }, 'Unknown job type');
    }
  },
  { connection },
);

worker.on('completed', (job) => log.info({ jobId: job.id }, 'Job completed'));
worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'Job failed'));

log.info('Worker started');
