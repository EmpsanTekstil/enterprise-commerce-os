-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "piiMaskedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "piiLastRunAt" TIMESTAMP(3),
ADD COLUMN     "piiMaskAfterDays" INTEGER,
ADD COLUMN     "rawPurgeAfterDays" INTEGER;
