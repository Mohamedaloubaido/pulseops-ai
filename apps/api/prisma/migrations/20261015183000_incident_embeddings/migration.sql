CREATE TABLE "IncidentEmbedding" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "embedding" DOUBLE PRECISION[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IncidentEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncidentEmbedding_incidentId_key" ON "IncidentEmbedding"("incidentId");
CREATE INDEX "IncidentEmbedding_organizationId_model_idx" ON "IncidentEmbedding"("organizationId", "model");
CREATE INDEX "IncidentEmbedding_organizationId_updatedAt_idx" ON "IncidentEmbedding"("organizationId", "updatedAt");

ALTER TABLE "IncidentEmbedding"
  ADD CONSTRAINT "IncidentEmbedding_incidentId_fkey"
  FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IncidentEmbedding"
  ADD CONSTRAINT "IncidentEmbedding_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
