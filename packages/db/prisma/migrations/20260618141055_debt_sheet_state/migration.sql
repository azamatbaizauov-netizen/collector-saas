-- AlterEnum
ALTER TYPE "ScheduleJobType" ADD VALUE 'DEBT_SHEET_POLL';

-- CreateTable
CREATE TABLE "DebtSheetState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lastVersion" TEXT,
    "lastModifiedTime" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "lastImportedAt" TIMESTAMP(3),
    "lastImported" INTEGER NOT NULL DEFAULT 0,
    "lastSkipped" INTEGER NOT NULL DEFAULT 0,
    "lastUnmatched" INTEGER NOT NULL DEFAULT 0,
    "lastBrokenPhone" INTEGER NOT NULL DEFAULT 0,
    "lastCurrencySuspect" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebtSheetState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DebtSheetState_organizationId_key" ON "DebtSheetState"("organizationId");

-- AddForeignKey
ALTER TABLE "DebtSheetState" ADD CONSTRAINT "DebtSheetState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

