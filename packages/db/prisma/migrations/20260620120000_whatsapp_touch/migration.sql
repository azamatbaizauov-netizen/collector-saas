-- CreateEnum
CREATE TYPE "TouchDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateTable
CREATE TABLE "WhatsAppTouch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "managerId" TEXT,
    "phone" TEXT NOT NULL,
    "direction" "TouchDirection" NOT NULL,
    "greenApiMessageId" TEXT NOT NULL,
    "touchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppTouch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppTouch_organizationId_touchedAt_idx" ON "WhatsAppTouch"("organizationId", "touchedAt");

-- CreateIndex
CREATE INDEX "WhatsAppTouch_organizationId_managerId_touchedAt_idx" ON "WhatsAppTouch"("organizationId", "managerId", "touchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTouch_organizationId_greenApiMessageId_key" ON "WhatsAppTouch"("organizationId", "greenApiMessageId");

-- AddForeignKey
ALTER TABLE "WhatsAppTouch" ADD CONSTRAINT "WhatsAppTouch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
