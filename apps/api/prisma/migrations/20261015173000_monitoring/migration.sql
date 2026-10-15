CREATE TYPE "MonitorStatus" AS ENUM ('UNKNOWN', 'UP', 'DOWN');

CREATE TABLE "Monitor" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "intervalSeconds" INTEGER NOT NULL DEFAULT 60,
  "timeoutMs" INTEGER NOT NULL DEFAULT 5000,
  "expectedStatus" INTEGER NOT NULL DEFAULT 200,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastStatus" "MonitorStatus" NOT NULL DEFAULT 'UNKNOWN',
  "lastCheckedAt" TIMESTAMP(3),
  "lastResponseTimeMs" INTEGER,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "serviceId" TEXT NOT NULL,
  CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonitorCheck" (
  "id" TEXT NOT NULL,
  "status" "MonitorStatus" NOT NULL,
  "statusCode" INTEGER,
  "responseTimeMs" INTEGER,
  "error" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "monitorId" TEXT NOT NULL,
  CONSTRAINT "MonitorCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Monitor_serviceId_enabled_idx" ON "Monitor"("serviceId", "enabled");
CREATE INDEX "Monitor_enabled_lastCheckedAt_idx" ON "Monitor"("enabled", "lastCheckedAt");
CREATE INDEX "MonitorCheck_monitorId_checkedAt_idx" ON "MonitorCheck"("monitorId", "checkedAt");

ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitorCheck" ADD CONSTRAINT "MonitorCheck_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
