import { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { prisma } from '@repo/db';
import { connection } from './redis.js';

// Регистратор расписаний: таблица ScheduleJob — источник истины по cron на
// организацию. На старте воркера превращаем активные строки в BullMQ Job
// Schedulers (идемпотентно по id), снимаем те, что выключили/удалили.
export const scheduleQueue = new Queue('schedule', { connection });

export async function registerScheduleJobs(log: Logger): Promise<void> {
  const jobs = await prisma.scheduleJob.findMany({ where: { isActive: true } });

  const desired = new Set<string>();
  for (const job of jobs) {
    const schedulerId = `${job.organizationId}:${job.jobType}`;
    desired.add(schedulerId);
    await scheduleQueue.upsertJobScheduler(
      schedulerId,
      { pattern: job.cronExpression },
      { name: job.jobType, data: { organizationId: job.organizationId } },
    );
    log.info({ schedulerId, cron: job.cronExpression }, 'Schedule job registered');
  }

  // Снимаем расписания, которых больше нет в активных (cron сменили/выключили).
  const existing = await scheduleQueue.getJobSchedulers();
  for (const s of existing) {
    if (!desired.has(s.key)) {
      await scheduleQueue.removeJobScheduler(s.key);
      log.info({ schedulerId: s.key }, 'Stale schedule job removed');
    }
  }
}
