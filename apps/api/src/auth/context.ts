import type { OrganizationRole } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";
import { hashSessionToken } from "../lib/session.js";

export type AuthContext = {
  sessionId: string;
  user: {
    id: string;
    email: string;
    name: string;
    memberships: Array<{
      organizationId: string;
      role: OrganizationRole;
      organization: { id: string; name: string; slug: string };
    }>;
  };
};

export async function requireAuth(request: FastifyRequest): Promise<AuthContext> {
  const authorization = request.headers.authorization;
  const [scheme, token] = authorization?.split(" ") ?? [];

  if (scheme !== "Bearer" || !token) {
    throw new ApiError(401, "Authentication required");
  }

  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: {
        include: {
          memberships: {
            include: { organization: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!session || session.expiresAt <= new Date()) {
    if (session) await db.session.delete({ where: { id: session.id } });
    throw new ApiError(401, "Session is invalid or expired");
  }

  return {
    sessionId: session.id,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      memberships: session.user.memberships.map((membership) => ({
        organizationId: membership.organizationId,
        role: membership.role,
        organization: {
          id: membership.organization.id,
          name: membership.organization.name,
          slug: membership.organization.slug,
        },
      })),
    },
  };
}
