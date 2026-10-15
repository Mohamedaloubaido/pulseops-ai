import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/context.js";
import { requireOrganizationRole } from "../auth/rbac.js";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";

const monitorPayload = z.object({
  serviceId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  url: z.string().url().max(2048),
  intervalSeconds: z.number().int().min(15).max(3600).default(60),
  timeoutMs: z.number().int().min(500).max(30000).default(5000),
  expectedStatus: z.number().int().min(100).max(599).default(200),
});

const updateMonitorPayload = monitorPayload.partial().extend({
  enabled: z.boolean().optional(),
});

function assertHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "Monitor URL must use http or https");
  }
}

export const monitorRoutes: FastifyPluginAsync = async (app) => {
  app.get("/organizations/:organizationId/monitors", async (request) => {
    const auth = await requireAuth(request);
    const { organizationId } = z.object({ organizationId: z.string().min(1) }).parse(request.params);

    await requireOrganizationRole(auth.user.id, organizationId, ["OWNER", "ADMIN", "RESPONDER", "VIEWER"]);

    const monitors = await db.monitor.findMany({
      where: { service: { organizationId } },
      include: {
        service: { select: { id: true, name: true, slug: true, status: true } },
        checks: { orderBy: { checkedAt: "desc" }, take: 5 },
      },
      orderBy: { createdAt: "asc" },
    });

    return { monitors };
  });

  app.post("/organizations/:organizationId/monitors", async (request, reply) => {
    const auth = await requireAuth(request);
    const { organizationId } = z.object({ organizationId: z.string().min(1) }).parse(request.params);
    const parsed = monitorPayload.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "Invalid monitor payload");
    assertHttpUrl(parsed.data.url);

    await requireOrganizationRole(auth.user.id, organizationId, ["OWNER", "ADMIN"]);

    const service = await db.service.findFirst({
      where: { id: parsed.data.serviceId, organizationId },
      select: { id: true },
    });
    if (!service) throw new ApiError(404, "Service not found");

    const monitor = await db.monitor.create({ data: parsed.data });
    return reply.code(201).send({ monitor });
  });

  app.patch("/organizations/:organizationId/monitors/:monitorId", async (request) => {
    const auth = await requireAuth(request);
    const { organizationId, monitorId } = z
      .object({ organizationId: z.string().min(1), monitorId: z.string().min(1) })
      .parse(request.params);
    const parsed = updateMonitorPayload.safeParse(request.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      throw new ApiError(400, "Invalid monitor payload");
    }
    if (parsed.data.url) assertHttpUrl(parsed.data.url);

    await requireOrganizationRole(auth.user.id, organizationId, ["OWNER", "ADMIN"]);

    const existing = await db.monitor.findFirst({
      where: { id: monitorId, service: { organizationId } },
      select: { id: true },
    });
    if (!existing) throw new ApiError(404, "Monitor not found");

    if (parsed.data.serviceId) {
      const service = await db.service.findFirst({
        where: { id: parsed.data.serviceId, organizationId },
        select: { id: true },
      });
      if (!service) throw new ApiError(404, "Service not found");
    }

    const monitor = await db.monitor.update({ where: { id: monitorId }, data: parsed.data });
    return { monitor };
  });

  app.delete("/organizations/:organizationId/monitors/:monitorId", async (request, reply) => {
    const auth = await requireAuth(request);
    const { organizationId, monitorId } = z
      .object({ organizationId: z.string().min(1), monitorId: z.string().min(1) })
      .parse(request.params);

    await requireOrganizationRole(auth.user.id, organizationId, ["OWNER", "ADMIN"]);

    const existing = await db.monitor.findFirst({
      where: { id: monitorId, service: { organizationId } },
      select: { id: true },
    });
    if (!existing) throw new ApiError(404, "Monitor not found");

    await db.monitor.delete({ where: { id: monitorId } });
    return reply.code(204).send();
  });
};
