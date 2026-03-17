/*
  Warnings:

  - The `status` column on the `subscriptions` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'UNPAID');

-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "id" DROP DEFAULT,
DROP COLUMN "status",
ADD COLUMN     "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING';

-- CreateIndex
CREATE INDEX "subscriptions_organisationId_idx" ON "subscriptions"("organisationId");
