CREATE TYPE "AiArtifactType" AS ENUM ('INCIDENT_ANALYSIS', 'POSTMORTEM');

CREATE TABLE "AiArtifact" (
  "id" TEXT NOT NULL,
  "type" "AiArtifactType" NOT NULL,
  "payload" JSONB NOT NULL,
  "model" TEXT NOT NULL,
  "responseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "incidentId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  CONSTRAINT "AiArtifact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiArtifact_incidentId_type_createdAt_idx" ON "AiArtifact"("incidentId", "type", "createdAt");

ALTER TABLE "AiArtifact" ADD CONSTRAINT "AiArtifact_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiArtifact" ADD CONSTRAINT "AiArtifact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
