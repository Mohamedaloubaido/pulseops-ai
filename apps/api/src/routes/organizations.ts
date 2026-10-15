import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/context.js";
import { requireOrganizationRole } from "../auth/rbac.js";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";
import { createAvailableOrganizationSlug } from "../lib/slug.js";

const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(100),
});

const addMemberSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(["ADMIN", "RESPONDER", "VIEWER"]).default("VIEWER"),
});

export const organizationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/organizations", async (request) => {
    const auth = await requireAuth(request);
    return {
      organizations: auth.user.memberships.map((membership) => ({
        ...membership.organization,
        role: membership.role,
      })),
    };
  });

  app.post("/organizations", async (request, reply) => {
    const auth = await requireAuth(request);
    const parsed = createOrganizationSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "Invalid organization payload");

    const slug = await createAvailableOrganizationSlug(parsed.data.name);
    const organization = await db.organization.create({
      data: {
        name: parsed.data.name,
        slug,
        memberships: {
          create: { userId: auth.user.id, role: "OWNER" },
        },
      },
    });

    return reply.code(201).send({ organization });
  });

  app.get("/organizations/:organizationId/members", async (request) => {
    const auth = await requireAuth(request);
    const params = z.object({ organizationId: z.string().min(1) }).parse(request.params);

    await requireOrganizationRole(auth.user.id, params.organizationId, [
      "OWNER",
      "ADMIN",
      "RESPONDER",
      "VIEWER",
    ]);

    const members = await db.membership.findMany({
      where: { organizationId: params.organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });

    return { members };
  });

  app.post("/organizations/:organizationId/members", async (request, reply) => {
    const auth = await requireAuth(request);
    const params = z.object({ organizationId: z.string().min(1) }).parse(request.params);
    const parsed = addMemberSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "Invalid membership payload");

    await requireOrganizationRole(auth.user.id, params.organizationId, ["OWNER", "ADMIN"]);

    const user = await db.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    if (!user) throw new ApiError(404, "User not found");

    const existing = await db.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: params.organizationId,
        },
      },
    });
    if (existing) throw new ApiError(409, "User is already a member of this organization");

    const membership = await db.membership.create({
      data: {
        userId: user.id,
        organizationId: params.organizationId,
        role: parsed.data.role,
      },
    });

    return reply.code(201).send({ membership });
  });
};
