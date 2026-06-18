-- CreateEnum
CREATE TYPE "BitrixUserRole" AS ENUM ('OWNER', 'FIN_MANAGER', 'SALES_MANAGER');

-- CreateEnum
CREATE TYPE "CustomerRatingValue" AS ENUM ('RELIABLE', 'NORMAL', 'RISK', 'DANGEROUS', 'STOP');

-- CreateEnum
CREATE TYPE "CreditLimitStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "ReminderSource" AS ENUM ('AUTO', 'MANAGER');

-- CreateEnum
CREATE TYPE "ReminderTone" AS ENUM ('SOFT', 'FIRM', 'STRICT', 'FINAL');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'REPLIED');

-- CreateEnum
CREATE TYPE "ReplyIntent" AS ENUM ('PROMISE_TO_PAY', 'PAID', 'DISPUTE', 'REQUEST_DELAY', 'OTHER');

-- CreateEnum
CREATE TYPE "PromiseStatus" AS ENUM ('PENDING', 'FULFILLED', 'BROKEN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduleJobType" AS ENUM ('DAILY_OVERDUE_CHECK', 'RATING_RECALC', 'MORNING_DIGEST', 'PROMISE_FOLLOWUP');

-- CreateEnum
CREATE TYPE "WebhookSource" AS ENUM ('BITRIX', 'WHATSAPP');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bitrixPortalId" TEXT NOT NULL,
    "bitrixWebhook" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ratingRules" JSONB NOT NULL,
    "limitRules" JSONB NOT NULL,
    "reminderTones" JSONB NOT NULL,
    "scheduleConfig" JSONB NOT NULL,
    "templateConfig" JSONB NOT NULL,
    "whatsappRateLimit" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BitrixUser" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bitrixUserId" TEXT NOT NULL,
    "role" "BitrixUserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BitrixUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRating" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "rating" "CustomerRatingValue" NOT NULL,
    "previousRating" "CustomerRatingValue",
    "changedBy" TEXT NOT NULL,
    "overrideReason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLimit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "limitAmount" BIGINT NOT NULL,
    "previousAmount" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "status" "CreditLimitStatus" NOT NULL DEFAULT 'PENDING',
    "changedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "dealId" TEXT,
    "channel" "ReminderChannel" NOT NULL,
    "source" "ReminderSource" NOT NULL,
    "tone" "ReminderTone" NOT NULL,
    "templateKey" TEXT,
    "messageText" TEXT NOT NULL,
    "greenApiMessageId" TEXT,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "clientReply" TEXT,
    "replyReceivedAt" TIMESTAMP(3),
    "intent" "ReplyIntent",
    "aiActionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promise" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "amount" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "promisedDateFrom" TIMESTAMP(3) NOT NULL,
    "promisedDateTo" TIMESTAMP(3) NOT NULL,
    "status" "PromiseStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "scenario" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputSummary" TEXT NOT NULL,
    "outputSummary" TEXT,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "costMicrodollars" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "instanceToken" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "managerName" TEXT,
    "bitrixUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobType" "ScheduleJobType" NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookProcessed" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" "WebhookSource" NOT NULL,
    "eventId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookProcessed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_bitrixPortalId_key" ON "Organization"("bitrixPortalId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");

-- CreateIndex
CREATE INDEX "BitrixUser_organizationId_idx" ON "BitrixUser"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BitrixUser_organizationId_bitrixUserId_key" ON "BitrixUser"("organizationId", "bitrixUserId");

-- CreateIndex
CREATE INDEX "CustomerRating_organizationId_contactId_idx" ON "CustomerRating"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "CustomerRating_organizationId_changedAt_idx" ON "CustomerRating"("organizationId", "changedAt");

-- CreateIndex
CREATE INDEX "CreditLimit_organizationId_contactId_idx" ON "CreditLimit"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "CreditLimit_organizationId_status_idx" ON "CreditLimit"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Reminder_organizationId_contactId_idx" ON "Reminder"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "Reminder_organizationId_status_idx" ON "Reminder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Reminder_organizationId_createdAt_idx" ON "Reminder"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Promise_reminderId_key" ON "Promise"("reminderId");

-- CreateIndex
CREATE INDEX "Promise_organizationId_contactId_idx" ON "Promise"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "Promise_organizationId_promisedDateTo_idx" ON "Promise"("organizationId", "promisedDateTo");

-- CreateIndex
CREATE INDEX "Promise_organizationId_status_idx" ON "Promise"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AiAction_organizationId_scenario_idx" ON "AiAction"("organizationId", "scenario");

-- CreateIndex
CREATE INDEX "AiAction_organizationId_createdAt_idx" ON "AiAction"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppChannel_organizationId_idx" ON "WhatsAppChannel"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppChannel_organizationId_instanceId_key" ON "WhatsAppChannel"("organizationId", "instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleJob_organizationId_jobType_key" ON "ScheduleJob"("organizationId", "jobType");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_entityType_entityId_idx" ON "AuditLog"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookProcessed_organizationId_idx" ON "WebhookProcessed"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookProcessed_source_eventId_key" ON "WebhookProcessed"("source", "eventId");

-- AddForeignKey
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitrixUser" ADD CONSTRAINT "BitrixUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRating" ADD CONSTRAINT "CustomerRating_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLimit" ADD CONSTRAINT "CreditLimit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_aiActionId_fkey" FOREIGN KEY ("aiActionId") REFERENCES "AiAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promise" ADD CONSTRAINT "Promise_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promise" ADD CONSTRAINT "Promise_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAction" ADD CONSTRAINT "AiAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppChannel" ADD CONSTRAINT "WhatsAppChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleJob" ADD CONSTRAINT "ScheduleJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookProcessed" ADD CONSTRAINT "WebhookProcessed_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
