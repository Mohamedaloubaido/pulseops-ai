import { createHash } from "node:crypto";
import { env } from "../env.js";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";
import { generateEmbeddings } from "./embeddings.js";
import { cosineSimilarity } from "./vector.js";

type IncidentDocumentSource = {
  id: string;
  title: string;
  summary: string | null;
  severity: "MINOR" | "MAJOR" | "CRITICAL";
  status: "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";
  startedAt: Date;
  resolvedAt: Date | null;
  services: Array<{ service: { id: string; name: string } }>;
  updates: Array<{
    message: string;
    status: "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED" | null;
    createdAt: Date;
  }>;
};

const incidentDocumentSelect = {
  id: true,
  title: true,
  summary: true,
  severity: true,
  status: true,
  startedAt: true,
  resolvedAt: true,
  services: { select: { service: { select: { id: true, name: true } } } },
  updates: {
    orderBy: { createdAt: "asc" as const },
    take: 40,
    select: { message: true, status: true, createdAt: true },
  },
} as const;

function renderIncidentDocument(incident: IncidentDocumentSource) {
  const serviceNames = incident.services.map(({ service }) => service.name).join(", ") || "none";
  const timeline = incident.updates
    .map((update) => `${update.status ?? "UPDATE"}: ${update.message}`)
    .join("\n");

  return [
    `Title: ${incident.title}`,
    `Summary: ${incident.summary ?? "none"}`,
    `Severity: ${incident.severity}`,
    `Status: ${incident.status}`,
    `Services: ${serviceNames}`,
    `Timeline:\n${timeline || "none"}`,
  ].join("\n");
}

function contentHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export type SimilarIncident = {
  incidentId: string;
  title: string;
  summary: string | null;
  severity: "MINOR" | "MAJOR" | "CRITICAL";
  startedAt: Date;
  resolvedAt: Date | null;
  similarity: number;
  services: string[];
  resolutionEvidence: string[];
};

export async function retrieveSimilarIncidents({
  organizationId,
  incidentId,
  candidateLimit = 30,
  topK = 5,
}: {
  organizationId: string;
  incidentId: string;
  candidateLimit?: number;
  topK?: number;
}): Promise<{ model: string; similarIncidents: SimilarIncident[] }> {
  const current = await db.incident.findFirst({
    where: { id: incidentId, organizationId },
    select: incidentDocumentSelect,
  });
  if (!current) throw new ApiError(404, "Incident not found");

  const candidates = await db.incident.findMany({
    where: {
      organizationId,
      id: { not: incidentId },
      status: "RESOLVED",
    },
    select: incidentDocumentSelect,
    orderBy: [{ resolvedAt: "desc" }, { startedAt: "desc" }],
    take: candidateLimit,
  });

  if (candidates.length === 0) {
    return { model: env.OPENAI_EMBEDDING_MODEL, similarIncidents: [] };
  }

  const documents: IncidentDocumentSource[] = [current, ...candidates];
  const rendered = documents.map(renderIncidentDocument);
  const hashes = rendered.map(contentHash);
  const incidentIds = documents.map((incident) => incident.id);

  const cached = await db.incidentEmbedding.findMany({
    where: { incidentId: { in: incidentIds } },
  });
  const cachedByIncident = new Map(cached.map((item) => [item.incidentId, item]));

  const missingIndexes: number[] = [];
  for (let index = 0; index < documents.length; index += 1) {
    const existing = cachedByIncident.get(documents[index]!.id);
    if (
      !existing ||
      existing.contentHash !== hashes[index] ||
      existing.model !== env.OPENAI_EMBEDDING_MODEL
    ) {
      missingIndexes.push(index);
    }
  }

  if (missingIndexes.length > 0) {
    const generated = await generateEmbeddings(missingIndexes.map((index) => rendered[index]!));

    await Promise.all(
      missingIndexes.map(async (documentIndex, generatedIndex) => {
        const incident = documents[documentIndex]!;
        const embedding = generated.embeddings[generatedIndex]!;
        const record = await db.incidentEmbedding.upsert({
          where: { incidentId: incident.id },
          update: {
            organizationId,
            model: env.OPENAI_EMBEDDING_MODEL,
            dimensions: embedding.length,
            contentHash: hashes[documentIndex]!,
            embedding,
          },
          create: {
            incidentId: incident.id,
            organizationId,
            model: env.OPENAI_EMBEDDING_MODEL,
            dimensions: embedding.length,
            contentHash: hashes[documentIndex]!,
            embedding,
          },
        });
        cachedByIncident.set(incident.id, record);
      }),
    );
  }

  const currentEmbedding = cachedByIncident.get(current.id);
  if (!currentEmbedding) throw new ApiError(502, "Current incident embedding was not persisted");

  const similarIncidents = candidates
    .map((candidate) => {
      const candidateEmbedding = cachedByIncident.get(candidate.id);
      if (
        !candidateEmbedding ||
        candidateEmbedding.model !== currentEmbedding.model ||
        candidateEmbedding.dimensions !== currentEmbedding.dimensions
      ) {
        return null;
      }

      const similarity = cosineSimilarity(currentEmbedding.embedding, candidateEmbedding.embedding);
      const resolutionEvidence = candidate.updates
        .slice(-4)
        .map((update) => `${update.status ?? "UPDATE"}: ${update.message}`);

      return {
        incidentId: candidate.id,
        title: candidate.title,
        summary: candidate.summary,
        severity: candidate.severity,
        startedAt: candidate.startedAt,
        resolvedAt: candidate.resolvedAt,
        similarity: Math.round(Math.max(-1, Math.min(1, similarity)) * 10_000) / 10_000,
        services: candidate.services.map(({ service }) => service.name),
        resolutionEvidence,
      } satisfies SimilarIncident;
    })
    .filter((value): value is SimilarIncident => value !== null)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, topK);

  return {
    model: currentEmbedding.model,
    similarIncidents,
  };
}
