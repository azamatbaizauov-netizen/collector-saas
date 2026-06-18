-- AlterEnum
BEGIN;
CREATE TYPE "ScheduleJobType_new" AS ENUM ('DAILY_OVERDUE_CHECK', 'RATING_RECALC', 'MORNING_DIGEST', 'PROMISE_FOLLOWUP');
ALTER TABLE "ScheduleJob" ALTER COLUMN "jobType" TYPE "ScheduleJobType_new" USING ("jobType"::text::"ScheduleJobType_new");
ALTER TYPE "ScheduleJobType" RENAME TO "ScheduleJobType_old";
ALTER TYPE "ScheduleJobType_new" RENAME TO "ScheduleJobType";
DROP TYPE "public"."ScheduleJobType_old";
COMMIT;

