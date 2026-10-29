-- AlterEnum
ALTER TYPE "SyncJobType" ADD VALUE 'RETURN_PULL';

-- AlterTable
ALTER TABLE "Return" ADD COLUMN     "canActViaApi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "channelStatus" TEXT,
ADD COLUMN     "customerName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Return_orderId_externalId_key" ON "Return"("orderId", "externalId");

