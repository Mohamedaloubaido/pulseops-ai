import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/context.js";
import { requireOrganizationRole } from "../auth/rbac.js";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";
import { publishOrganizationEvent } from "../realtime/bus.js";

const incidentStatusSchema = z.enum([
  "INVESTIGATING",
  "IDENTIFIED",
  "MONITORING",
  "RESOLVED",
]);

const createIncidentSchema = z.object({
  title: z.string().trim().min(3).max(140),
  summary: z.string().trim().max(2000).optional(),
  severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]),
  serviceIds: z.array(z.string().min(1)).min(1).max(20),
});

const createUpdateSchema = z.object({
  message: z.string().trim().min(2).max(2000),
  status: incidentStatusSchema.optional(),
});

const memberRoles = ["OWNER", "ADMIN", "RESPONDER", "VIEWER"] as const;
const responderRoles = ["OWNER", "ADMIN", "RESPONDER"] as const;

async function requireIncident(organizationId: string, incidentId: string) {
  const incident = await db.incident.findUnique({ where: { id: incidentId } });
  if (!incident || incident.organizationId !== organizationId) {
    throw new ApiError(404, "Incident not found");
  }
  return incident;
}

function publishIncidentEvent(
  request: FastifyRequest,
  type: "incident.created" | "incident.updated",
  organizationId: string,
  entityId: string,
) {
  void publishOrganizationEvent({ type, organizationId, entityId }).catch((error) => {
    request.log.error(error, "Failed to publish realtime incident event");
  });
}

export const incidentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/organizations/:organizationId/incidents", async (request) => {
    const auth = await requireAuth(request);
    const params = z.object({ organizationId: z.string().min(1) }).parse(request.params);
    const query = z.object({ status: incidentStatusSchema.optional() }).parse(request.query);

    await requireOrganizationRole(auth.user.id, params.organizationId, [...memberRoles]);

    const incidents = await db.incident.findMany({
      where: {
        organizationId: params.organizationId,
        ...(query.status ? { status: query.status } : {}),
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        services: { include: { service: true } },
      },
      orderBy: { startedAt: "desc" },
    });

    return { incidents };
  });

  app.get("/organizations/:organizationId/incidents/:incidentId", async (request) => {
    const auth = await requireAuth(request);
    const params = z
      .object({ organizationId: z.string().min(1), incidentId: z.string().min(1) })
      .parse(request.params);

    await requireOrganizationRole(auth.user.id, params.organizationId, [...memberRoles]);
    await requireIncident(params.organizationId, params.incidentId);

    const incident = await db.incident.findUnique({
      where: { id: params.incidentId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        services: { include: { service: true } },
        updates: {
          include: { author: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return { incident };
  });

  app.post("/organizations/:organizationId/incidents", async (request, reply) => {
    const auth = await requireAuth(request);
    const params = z.object({ organizationId: z.string().min(1) }).parse(request.params);
    const parsed = createIncidentSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "Invalid incident payload");

    await requireOrganizationRole(auth.user.id, params.organizationId, [...responderRoles]);

    const serviceIds = [...new Set(parsed.data.serviceIds)];
    const services = await db.service.findMany({
      where: { id: { in: serviceIds }, organizationId: params.organizationId },
      select: { id: true },
    });
    if (services.length !== serviceIds.length) {
      throw new ApiError(400, "One or more services do not belong to this organization");
    }

    const incident = await db.$transaction(async (tx) => {
      const created = await tx.incident.create({
        data: {
          organizationId: params.organizationId,
          createdById: auth.user.id,
          title: parsed.data.title,
          summary: parsed.data.summary,
          severity: parsed.data.severity,
          services: {
            create: serviceIds.map((serviceId) => ({ serviceId })),
          },
        },
      });

      await tx.incidentUpdate.create({
        data: {
          incidentId: created.id,
          authorId: auth.user.id,
          status: "INVESTIGATING",
          message: "Incident opened and investigation started.",
        },
      });

      return created;
    });

    publishIncidentEvent(request, "incident.created", params.organizationId, incident.id);
    return reply.code(201).send({ incident });
  });

  app.post("/organizations/:organizationId/incidents/:incidentId/updates", async (request, reply) => {
    const auth = await requireAuth(request);
    const params = z
      .object({ organizationId: z.string().min(1), incidentId: z.string().min(1) })
      .parse(request.params);
    const parsed = createUpdateSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "Invalid incident update payload");

    await requireOrganizationRole(auth.user.id, params.organizationId, [...responderRoles]);
    const incident = await requireIncident(params.organizationId, params.incidentId);

    const result = await db.$transaction(async (tx) => {
      const update = await tx.incidentUpdate.create({
        data: {
          incidentId: incident.id,
          authorId: auth.user.id,
          message: parsed.data.message,
          status: parsed.data.status,
        },
      });

      const nextIncident = parsed.data.status
        ? await tx.incident.update({
            where: { id: incident.id },
            data: {
              status: parsed.data.status,
              resolvedAt: parsed.data.status === "RESOLVED" ? new Date() : null,
            },
          })
        : incident;

      return { incident: nextIncident, update };
    });

    publishIncidentEvent(request, "incident.updated", params.organizationId, incident.id);
    return reply.code(201).send(result);
  });
};
