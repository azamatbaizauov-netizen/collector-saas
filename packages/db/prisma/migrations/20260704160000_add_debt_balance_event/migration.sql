-- CreateEnum
CREATE TYPE "SheetWriteMode" AS ENUM ('DRY_RUN', 'LIVE');

-- CreateEnum
CREATE TYPE "DebtEventKind" AS ENUM ('PAYMENT', 'NEW_DEBT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DebtEventStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "sheetWriteMode" "SheetWriteMode" NOT NULL DEFAULT 'DRY_RUN',
ADD COLUMN     "gracePeriodDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "DebtBalanceEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "managerId" TEXT,
    "debtorPhone" TEXT NOT NULL,
    "statedBalance" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "kind" "DebtEventKind" NOT NULL DEFAULT 'UNKNOWN',
    "rawText" TEXT NOT NULL,
    "greenApiMessageId" TEXT NOT NULL,
    "status" "DebtEventStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "aiActionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtBalanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DebtBalanceEvent_organizationId_status_idx" ON "DebtBalanceEvent"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DebtBalanceEvent_organizationId_debtorPhone_idx" ON "DebtBalanceEvent"("organizationId", "debtorPhone");

-- CreateIndex
CREATE UNIQUE INDEX "DebtBalanceEvent_organizationId_greenApiMessageId_key" ON "DebtBalanceEvent"("organizationId", "greenApiMessageId");

-- AddForeignKey
ALTER TABLE "DebtBalanceEvent" ADD CONSTRAINT "DebtBalanceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
