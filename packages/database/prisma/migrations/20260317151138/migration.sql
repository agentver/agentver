-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('PUBLISHED', 'DEPRECATED', 'YANKED');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DEPRECATED');

-- AlterTable
ALTER TABLE "package_versions" ADD COLUMN     "status" "VersionStatus" NOT NULL DEFAULT 'PUBLISHED';

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "deprecationNote" TEXT,
ADD COLUMN     "status" "PackageStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "packages_status_idx" ON "packages"("status");
