import type { OrganizationRole } from "@prisma/client";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";

export async function requireOrganizationRole(
  userId: string,
  organizationId: string,
  allowedRoles: OrganizationRole[],
) {
  const membership = await db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new ApiError(403, "Insufficient organization permissions");
  }

  return membership;
}
