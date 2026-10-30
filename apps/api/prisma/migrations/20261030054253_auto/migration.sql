-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "PriceProposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "ruleId" TEXT,
    "currentPrice" DECIMAL(14,2),
    "proposedPrice" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "breakdownJson" JSONB,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceProposal_organizationId_status_createdAt_idx" ON "PriceProposal"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PriceProposal_listingId_idx" ON "PriceProposal"("listingId");

