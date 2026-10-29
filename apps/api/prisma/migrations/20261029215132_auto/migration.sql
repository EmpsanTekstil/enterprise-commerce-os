-- AlterEnum
ALTER TYPE "SyncJobType" ADD VALUE 'BATCH_CHECK';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "batchRequestId" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ChannelBrand" (
    "id" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelBrand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelBrand_channelAccountId_name_idx" ON "ChannelBrand"("channelAccountId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelBrand_channelAccountId_externalId_key" ON "ChannelBrand"("channelAccountId", "externalId");

-- CreateIndex
CREATE INDEX "Listing_batchRequestId_idx" ON "Listing"("batchRequestId");

-- AddForeignKey
ALTER TABLE "ChannelBrand" ADD CONSTRAINT "ChannelBrand_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

