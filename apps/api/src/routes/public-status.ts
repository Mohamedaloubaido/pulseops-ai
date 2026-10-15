import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";

export const publicStatusRoutes: FastifyPluginAsync = async (app) => {
  app.get("/status/:slug", async (request) => {
    const { slug } = z.object({ slug: z.string().min(1).max(120) }).parse(request.params);
    const historyCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const organization = await db.organization.findFirst({
      where: { slug, statusPageEnabled: true },
      select: {
        name: true,
        slug: true,
        statusPageTitle: true,
        statusPageDescription: true,
        updatedAt: true,
        services: {
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            status: true,
            updatedAt: true,
          },
        },
        incidents: {
          where: {
            OR: [
              { status: { not: "RESOLVED" } },
              { resolvedAt: { gte: historyCutoff } },
            ],
          },
          orderBy: { startedAt: "desc" },
          take: 20,
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
                service: { select: { id: true, name: true, slug: true } },
              },
            },
            updates: {
              orderBy: { createdAt: "desc" },
              take: 20,
              select: {
                id: true,
                message: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!organization) throw new ApiError(404, "Status page not found");

    const incidents = organization.incidents.map((incident) => ({
      ...incident,
      services: incident.services.map(({ service }) => service),
    }));

    const activeIncidents = incidents.filter((incident) => incident.status !== "RESOLVED");
    const healthy =
      activeIncidents.length === 0 &&
      organization.services.every((service) => service.status === "OPERATIONAL");

    return {
      organization: {
        name: organization.name,
        slug: organization.slug,
        title: organization.statusPageTitle ?? `${organization.name} Status`,
        description: organization.statusPageDescription,
      },
      overallStatus: healthy ? "OPERATIONAL" : "ISSUES_DETECTED",
      services: organization.services,
      activeIncidents,
      incidentHistory: incidents.filter((incident) => incident.status === "RESOLVED"),
      generatedAt: new Date().toISOString(),
    };
  });
};
