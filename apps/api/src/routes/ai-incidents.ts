import { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { generateAiJson } from "../ai/openai.js";
import { retrieveSimilarIncidents, type SimilarIncident } from "../ai/similar-incidents.js";
import { requireAuth } from "../auth/context.js";
import { requireOrganizationRole } from "../auth/rbac.js";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";

const paramsSchema = z.object({
  organizationId: z.string().min(1),
  incidentId: z.string().min(1),
});

const similarRequestSchema = z.object({
  topK: z.number().int().min(1).max(10).default(5),
  candidateLimit: z.number().int().min(5).max(50).default(30),
});

const analysisSchema = z.object({
  summary: z.string().min(1).max(2500),
  probableCause: z.string().min(1).max(2500),
  confidence: z.number().int().min(0).max(100),
  suggestedActions: z.array(z.string().min(1).max(500)).min(1).max(6),
  customerUpdate: z.string().min(1).max(1800),
  riskNotes: z.array(z.string().min(1).max(500)).max(6),
});

const postmortemSchema = z.object({
  summary: z.string().min(1).max(3000),
  impact: z.string().min(1).max(3000),
  timeline: z
    .array(z.object({ time: z.string().min(1).max(100), event: z.string().min(1).max(1000) }))
    .min(1)
    .max(30),
  rootCause: z.string().min(1).max(3000),
  resolution: z.string().min(1).max(3000),
  preventiveActions: z.array(z.string().min(1).max(700)).min(1).max(10),
  knownUnknowns: z.array(z.string().min(1).max(700)).max(10),
});

const memberRoles = ["OWNER", "ADMIN", "RESPONDER", "VIEWER"] as const;
const responderRoles = ["OWNER", "ADMIN", "RESPONDER"] as const;

async function loadIncidentContext(organizationId: string, incidentId: string) {
  const incident = await db.incident.findFirst({
    where: { id: incidentId, organizationId },
    select: {
      id: true,
      title: true,
      summary: true,
      severity: true,
      status: true,
      startedAt: true,
      resolvedAt: true,
      updatedAt: true,
      services: {
        select: {
          service: {
            select: {
              id: true,
              name: true,
              status: true,
              monitors: {
                where: { enabled: true },
                select: {
                  name: true,
                  lastStatus: true,
                  lastCheckedAt: true,
                  lastResponseTimeMs: true,
                  consecutiveFailures: true,
                  checks: {
                    orderBy: { checkedAt: "desc" },
                    take: 5,
                    select: {
                      status: true,
                      statusCode: true,
                      responseTimeMs: true,
                      error: true,
                      checkedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      updates: {
        orderBy: { createdAt: "asc" },
        take: 40,
        select: { message: true, status: true, createdAt: true },
      },
    },
  });

  if (!incident) throw new ApiError(404, "Incident not found");

  return {
    ...incident,
    services: incident.services.map(({ service }) => service),
  };
}

function operationalContext(incident: Awaited<ReturnType<typeof loadIncidentContext>>) {
  return JSON.stringify(
    {
      incident: {
        title: incident.title,
        summary: incident.summary,
        severity: incident.severity,
        status: incident.status,
        startedAt: incident.startedAt,
        resolvedAt: incident.resolvedAt,
        updatedAt: incident.updatedAt,
      },
      services: incident.services,
      timeline: incident.updates,
    },
    null,
    2,
  );
}

function serializeSimilarIncident(incident: SimilarIncident) {
  return {
    incidentId: incident.incidentId,
    title: incident.title,
    summary: incident.summary,
    severity: incident.severity,
    startedAt: incident.startedAt.toISOString(),
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    similarity: incident.similarity,
    services: incident.services,
    resolutionEvidence: incident.resolutionEvidence,
  };
}

const analysisInstructions = `You are the PulseOps incident copilot. Analyze only the operational evidence provided. Never invent logs, deployments, causes, or test results. Treat probable cause as a hypothesis, not a fact. Confidence must reflect the strength of the supplied evidence. Historical incidents may be provided as semantic analogies: use them to suggest investigation paths, but never treat similarity as proof that the current incident has the same root cause. Customer-facing text must avoid unsupported technical claims. Return ONLY valid JSON with exactly these keys: summary, probableCause, confidence, suggestedActions, customerUpdate, riskNotes.`;

const postmortemInstructions = `You are the PulseOps postmortem assistant. Draft a factual, blameless postmortem using only the supplied incident evidence. If root cause is not proven, explicitly say it remains unconfirmed. Do not invent impact metrics or timeline events. Return ONLY valid JSON with exactly these keys: summary, impact, timeline, rootCause, resolution, preventiveActions, knownUnknowns. Each timeline item must contain time and event.`;

export const aiIncidentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/organizations/:organizationId/incidents/:incidentId/ai", async (request) => {
    const auth = await requireAuth(request);
    const params = paramsSchema.parse(request.params);
    await requireOrganizationRole(auth.user.id, params.organizationId, [...memberRoles]);

    const incident = await loadIncidentContext(params.organizationId, params.incidentId);
    const artifacts = await db.aiArtifact.findMany({
      where: { incidentId: incident.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        payload: true,
        model: true,
        responseId: true,
        createdAt: true,
        createdById: true,
      },
    });

    return { artifacts };
  });

  app.post("/organizations/:organizationId/incidents/:incidentId/ai/similar", async (request) => {
    const auth = await requireAuth(request);
    const params = paramsSchema.parse(request.params);
    const parsed = similarRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new ApiError(400, "Invalid similar-incident request");

    await requireOrganizationRole(auth.user.id, params.organizationId, [...responderRoles]);

    const result = await retrieveSimilarIncidents({
      organizationId: params.organizationId,
      incidentId: params.incidentId,
      topK: parsed.data.topK,
      candidateLimit: parsed.data.candidateLimit,
    });

    return {
      model: result.model,
      similarIncidents: result.similarIncidents.map(serializeSimilarIncident),
      disclaimer: "Semantic similarity is historical context, not evidence that incidents share the same root cause.",
    };
  });

  app.post("/organizations/:organizationId/incidents/:incidentId/ai/analyze", async (request, reply) => {
    const auth = await requireAuth(request);
    const params = paramsSchema.parse(request.params);
    await requireOrganizationRole(auth.user.id, params.organizationId, [...responderRoles]);

    const incident = await loadIncidentContext(params.organizationId, params.incidentId);

    let retrieval: { model: string | null; similarIncidents: SimilarIncident[] } = {
      model: null,
      similarIncidents: [],
    };

    try {
      retrieval = await retrieveSimilarIncidents({
        organizationId: params.organizationId,
        incidentId: params.incidentId,
        candidateLimit: 30,
        topK: 3,
      });
    } catch (error) {
      request.log.warn({ error }, "Similar-incident retrieval unavailable; continuing with current evidence only");
    }

    const historicalContext = retrieval.similarIncidents.map(serializeSimilarIncident);
    const result = await generateAiJson({
      system: analysisInstructions,
      input: [
        `Analyze this incident evidence:\n${operationalContext(incident)}`,
        `Historical semantic analogies (not proof of cause):\n${JSON.stringify(historicalContext, null, 2)}`,
      ].join("\n\n"),
      maxOutputTokens: 1400,
    });
    const analysis = analysisSchema.safeParse(result.payload);
    if (!analysis.success) throw new ApiError(502, "AI analysis did not match the expected schema");

    const storedPayload = {
      ...analysis.data,
      retrieval: {
        model: retrieval.model,
        similarIncidents: historicalContext,
      },
    };

    const artifact = await db.aiArtifact.create({
      data: {
        type: "INCIDENT_ANALYSIS",
        incidentId: incident.id,
        createdById: auth.user.id,
        model: result.model,
        responseId: result.responseId,
        payload: storedPayload as Prisma.InputJsonValue,
      },
    });

    return reply.code(201).send({
      artifact,
      disclaimer: "AI-generated hypothesis. Similar incidents are contextual analogies only; verify evidence before taking operational action or publishing externally.",
    });
  });

  app.post("/organizations/:organizationId/incidents/:incidentId/ai/postmortem", async (request, reply) => {
    const auth = await requireAuth(request);
    const params = paramsSchema.parse(request.params);
    await requireOrganizationRole(auth.user.id, params.organizationId, [...responderRoles]);

    const incident = await loadIncidentContext(params.organizationId, params.incidentId);
    if (incident.status !== "RESOLVED") {
      throw new ApiError(409, "Resolve the incident before generating a postmortem");
    }

    const result = await generateAiJson({
      system: postmortemInstructions,
      input: `Draft a postmortem from this resolved incident evidence:\n${operationalContext(incident)}`,
      maxOutputTokens: 1800,
    });
    const postmortem = postmortemSchema.safeParse(result.payload);
    if (!postmortem.success) throw new ApiError(502, "AI postmortem did not match the expected schema");

    const artifact = await db.aiArtifact.create({
      data: {
        type: "POSTMORTEM",
        incidentId: incident.id,
        createdById: auth.user.id,
        model: result.model,
        responseId: result.responseId,
        payload: postmortem.data as Prisma.InputJsonValue,
      },
    });

    return reply.code(201).send({
      artifact,
      disclaimer: "AI-generated draft. Review and verify all claims before treating it as the official postmortem.",
    });
  });
};
