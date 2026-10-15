import { randomBytes } from "node:crypto";
import { db } from "./db.js";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || "organization";
}

export async function createAvailableOrganizationSlug(name: string) {
  const base = slugify(name);
  const existing = await db.organization.findUnique({ where: { slug: base } });
  if (!existing) return base;
  return `${base}-${randomBytes(3).toString("hex")}`;
}
