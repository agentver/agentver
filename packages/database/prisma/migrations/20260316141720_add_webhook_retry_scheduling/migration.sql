-- AlterTable
ALTER TABLE "webhook_deliveries" ADD COLUMN     "nextRetryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "webhook_deliveries_nextRetryAt_idx" ON "webhook_deliveries"("nextRetryAt");
