import { Worker } from 'bullmq';
import type { InboundMessageJob } from '@repo/messaging';
import { connection } from './redis.js';
import { processRatingRecalc } from './jobs/rating-recalc.js';
import { processOverdueCheck } from './jobs/overdue-check.js';
import { processMorningDigest } from './jobs/morning-digest.js';
import { processPromiseFollowup } from './jobs/promise-followup.js';
import { processDebtSheetPoll } from './jobs/debt-sheet-poll.js';
import { processDailyPlan } from './jobs/daily-plan.js';
import { processInboundMessage } from './jobs/inbound-message.js';
import { registerScheduleJobs } from './scheduler.js';
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
        return processOverdueCheck({ ...(job.data as { organizationId: string }), stage: 'reminder' });
      case 'FINAL_COVERAGE':
        return processOverdueCheck({ ...(job.data as { organizationId: string }), stage: 'final' });
      case 'MORNING_DIGEST':
        return processMorningDigest(job.data as { organizationId: string });
      case 'PROMISE_FOLLOWUP':
        return processPromiseFollowup(job.data as { organizationId: string });
      case 'DEBT_SHEET_POLL':
        return processDebtSheetPoll(job.data as { organizationId: string });
      case 'DAILY_PLAN':
        return processDailyPlan(job.data as { organizationId: string });
      default:
        log.warn({ jobName: job.name }, 'Unknown job type');
    }
  },
  { connection },
);

worker.on('completed', (job) => log.info({ jobId: job.id }, 'Job completed'));
worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'Job failed'));

const messagesWorker = new Worker(
  'messages',
  async (job) => {
    log.info({ jobType: job.name, jobId: job.id }, 'Processing message job');
    if (job.name === 'INBOUND_MESSAGE') {
      return processInboundMessage(job.data as InboundMessageJob, log);
    }
    log.warn({ jobName: job.name }, 'Unknown message job type');
  },
  { connection },
);

messagesWorker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'Message job failed'));

await registerScheduleJobs(log);

log.info('Worker started');
