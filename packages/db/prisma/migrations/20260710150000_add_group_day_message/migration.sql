-- AlterEnum
ALTER TYPE "ScheduleJobType" ADD VALUE 'PAYMENT_DIGEST';

-- CreateTable
CREATE TABLE "GroupDayMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupChatId" TEXT NOT NULL,
    "senderPhone" TEXT,
    "greenApiMessageId" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "text" TEXT,
    "receiptLine" TEXT,
    "businessDay" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupDayMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupDayMessage_organizationId_businessDay_idx" ON "GroupDayMessage"("organizationId", "businessDay");

-- CreateIndex
CREATE UNIQUE INDEX "GroupDayMessage_organizationId_greenApiMessageId_key" ON "GroupDayMessage"("organizationId", "greenApiMessageId");

-- AddForeignKey
ALTER TABLE "GroupDayMessage" ADD CONSTRAINT "GroupDayMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
