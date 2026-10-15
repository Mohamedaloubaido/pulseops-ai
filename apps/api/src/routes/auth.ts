import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/context.js";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { createSession } from "../lib/session.js";
import { createAvailableOrganizationSlug } from "../lib/slug.js";

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128),
  organizationName: z.string().trim().min(2).max(100),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "Invalid registration payload");

    const email = parsed.data.email.toLowerCase();
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) throw new ApiError(409, "An account with this email already exists");

    const [passwordHash, slug] = await Promise.all([
      hashPassword(parsed.data.password),
      createAvailableOrganizationSlug(parsed.data.organizationName),
    ]);

    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: parsed.data.name, email, passwordHash },
      });
      const organization = await tx.organization.create({
        data: { name: parsed.data.organizationName, slug },
      });
      await tx.membership.create({
        data: { userId: user.id, organizationId: organization.id, role: "OWNER" },
      });
      return { user, organization };
    });

    const { token, session } = await createSession(result.user.id);

    return reply.code(201).send({
      token,
      expiresAt: session.expiresAt,
      user: { id: result.user.id, name: result.user.name, email: result.user.email },
      organization: result.organization,
    });
  });

  app.post("/auth/login", async (request) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "Invalid login payload");

    const email = parsed.data.email.toLowerCase();
    const user = await db.user.findUnique({ where: { email } });
    const valid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
    if (!user || !valid) throw new ApiError(401, "Invalid email or password");

    const { token, session } = await createSession(user.id);
    return {
      token,
      expiresAt: session.expiresAt,
      user: { id: user.id, name: user.name, email: user.email },
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const auth = await requireAuth(request);
    await db.session.delete({ where: { id: auth.sessionId } });
    return reply.code(204).send();
  });

  app.get("/auth/me", async (request) => {
    const auth = await requireAuth(request);
    return { user: auth.user };
  });
};
