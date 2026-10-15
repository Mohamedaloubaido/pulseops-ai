import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/context.js";
import { requireOrganizationRole } from "../auth/rbac.js";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";

const serviceStatusSchema = z.enum([
  "OPERATIONAL",
  "DEGRADED",
  "PARTIAL_OUTAGE",
  "MAJOR_OUTAGE",
  "MAINTENANCE",
]);

const createServiceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
});

const updateServiceSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  displayOrder: z.number().int().min(0).max(10_000).optional(),
});

const updateStatusSchema = z.object({ status: serviceStatusSchema });

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || "service";
}

async function createAvailableServiceSlug(
  organizationId: string,
  name: string,
  excludeServiceId?: string,
) {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = await db.service.findUnique({
      where: { organizationId_slug: { organizationId, slug: candidate } },
    });
    if (!existing || existing.id === excludeServiceId) return candidate;
    candidate = `${base}-${suffix++}`;
  }
}

async function requireService(organizationId: string, serviceId: string) {
  const service = await db.service.findUnique({ where: { id: serviceId } });
  if (!service || service.organizationId !== organizationId) {
    throw new ApiError(404, "Service not found");
  }
  return service;
}

export const serviceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/organizations/:organizationId/services", async (request) => {
    const auth = await requireAuth(request);
    const params = z.object({ organizationId: z.string().min(1) }).parse(request.params);

    await requireOrganizationRole(auth.user.id, params.organizationId, [
      "OWNER",
      "ADMIN",
      "RESPONDER",
      "VIEWER",
    ]);

    const services = await db.service.findMany({
      where: { organizationId: params.organizationId },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });

    return { services };
  });

  app.post("/organizations/:organizationId/services", async (request, reply) => {
    const auth = await requireAuth(request);
    const params = z.object({ organizationId: z.string().min(1) }).parse(request.params);
    const parsed = createServiceSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "Invalid service payload");

    await requireOrganizationRole(auth.user.id, params.organizationId, ["OWNER", "ADMIN"]);

    const slug = await createAvailableServiceSlug(params.organizationId, parsed.data.name);
    const service = await db.service.create({
      data: {
        organizationId: params.organizationId,
        name: parsed.data.name,
        description: parsed.data.description,
        slug,
      },
    });

    return reply.code(201).send({ service });
  });

  app.patch("/organizations/:organizationId/services/:serviceId", async (request) => {
    const auth = await requireAuth(request);
    const params = z
      .object({ organizationId: z.string().min(1), serviceId: z.string().min(1) })
      .parse(request.params);
    const parsed = updateServiceSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "Invalid service update payload");

    await requireOrganizationRole(auth.user.id, params.organizationId, ["OWNER", "ADMIN"]);
    const current = await requireService(params.organizationId, params.serviceId);

    const nextSlug = parsed.data.name
      ? await createAvailableServiceSlug(params.organizationId, parsed.data.name, current.id)
      : current.slug;

    const service = await db.service.update({
      where: { id: current.id },
      data: { ...parsed.data, slug: nextSlug },
    });

    return { service };
  });

  app.post("/organizations/:organizationId/services/:serviceId/status", async (request) => {
    const auth = await requireAuth(request);
    const params = z
      .object({ organizationId: z.string().min(1), serviceId: z.string().min(1) })
      .parse(request.params);
    const parsed = updateStatusSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "Invalid service status payload");

    await requireOrganizationRole(auth.user.id, params.organizationId, [
      "OWNER",
      "ADMIN",
      "RESPONDER",
    ]);
    const current = await requireService(params.organizationId, params.serviceId);

    const service = await db.service.update({
      where: { id: current.id },
      data: { status: parsed.data.status },
    });

    return { service };
  });
};
