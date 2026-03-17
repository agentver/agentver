-- Add BUNDLE to PackageType enum
ALTER TYPE "PackageType" ADD VALUE 'BUNDLE';

-- Add new notification types
ALTER TYPE "NotificationType" ADD VALUE 'SECRET_ROTATION_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'SECRET_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'BUNDLE_UPDATED';

-- CreateEnum
CREATE TYPE "SecretSharing" AS ENUM ('INDIVIDUAL', 'TEAM', 'ORG');

-- CreateTable: Credential Vault
CREATE TABLE "secret_vault" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "teamId" TEXT,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "sharing" "SecretSharing" NOT NULL DEFAULT 'INDIVIDUAL',
    "rotationDays" INTEGER,
    "lastRotatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secret_vault_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Secret Access Logs
CREATE TABLE "secret_access_logs" (
    "id" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "secret_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MCP Server Catalogue
CREATE TABLE "mcp_server_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourcePackage" TEXT,
    "sourceUri" TEXT,
    "latestVersion" TEXT,
    "transport" TEXT NOT NULL DEFAULT 'stdio',
    "command" TEXT,
    "args" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "url" TEXT,
    "credentialSchema" JSONB,
    "toolManifest" JSONB,
    "compatibility" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "installCount" INTEGER NOT NULL DEFAULT 0,
    "starCount" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_server_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Secret Vault
CREATE INDEX "secret_vault_organisationId_idx" ON "secret_vault"("organisationId");
CREATE INDEX "secret_vault_teamId_idx" ON "secret_vault"("teamId");
CREATE UNIQUE INDEX "secret_vault_organisationId_teamId_key_key" ON "secret_vault"("organisationId", "teamId", "key");

-- CreateIndex: Secret Access Logs
CREATE INDEX "secret_access_logs_secretId_idx" ON "secret_access_logs"("secretId");
CREATE INDEX "secret_access_logs_userId_idx" ON "secret_access_logs"("userId");
CREATE INDEX "secret_access_logs_createdAt_idx" ON "secret_access_logs"("createdAt");

-- CreateIndex: MCP Server Definitions
CREATE UNIQUE INDEX "mcp_server_definitions_name_key" ON "mcp_server_definitions"("name");
CREATE INDEX "mcp_server_definitions_sourceType_idx" ON "mcp_server_definitions"("sourceType");
CREATE INDEX "mcp_server_definitions_verified_idx" ON "mcp_server_definitions"("verified");

-- AddForeignKey: Secret Vault
ALTER TABLE "secret_vault" ADD CONSTRAINT "secret_vault_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "secret_vault" ADD CONSTRAINT "secret_vault_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "secret_vault" ADD CONSTRAINT "secret_vault_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Secret Access Logs
ALTER TABLE "secret_access_logs" ADD CONSTRAINT "secret_access_logs_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secret_vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;
