-- AlterEnum
ALTER TYPE "ScheduleJobType" ADD VALUE 'WEEKLY_OWNER_DIGEST';

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "ownerTelegramUserId" TEXT,
ADD COLUMN     "telegramGroupChatId" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppChannel" DROP COLUMN "bitrixUserId",
DROP COLUMN "managerName",
ADD COLUMN     "managerId" TEXT;

-- CreateTable
CREATE TABLE "Manager" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "telegramUserId" TEXT,
    "telegramUsername" TEXT,
    "bitrixUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagerSheetAlias" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerSheetAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Manager_organizationId_idx" ON "Manager"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Manager_organizationId_telegramUserId_key" ON "Manager"("organizationId", "telegramUserId");

-- CreateIndex
CREATE INDEX "ManagerSheetAlias_managerId_idx" ON "ManagerSheetAlias"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagerSheetAlias_organizationId_normalizedAlias_key" ON "ManagerSheetAlias"("organizationId", "normalizedAlias");

-- CreateIndex
CREATE INDEX "WhatsAppChannel_managerId_idx" ON "WhatsAppChannel"("managerId");

-- AddForeignKey
ALTER TABLE "Manager" ADD CONSTRAINT "Manager_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerSheetAlias" ADD CONSTRAINT "ManagerSheetAlias_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerSheetAlias" ADD CONSTRAINT "ManagerSheetAlias_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppChannel" ADD CONSTRAINT "WhatsAppChannel_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

