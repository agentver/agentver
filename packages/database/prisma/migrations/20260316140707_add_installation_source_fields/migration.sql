-- AlterTable
ALTER TABLE "installation_reports" ADD COLUMN     "sourceCommit" TEXT,
ADD COLUMN     "sourcePath" TEXT,
ADD COLUMN     "sourceRef" TEXT,
ADD COLUMN     "sourceUri" TEXT;
