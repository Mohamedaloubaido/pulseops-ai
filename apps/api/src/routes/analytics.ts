import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/context.js";
import { requireOrganizationRole } from "../auth/rbac.js";
import { db } from "../lib/db.js";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const memberRoles = ["OWNER", "ADMIN", "RESPONDER", "VIEWER"] as const;

function roundRate(value: number) {
  return Math.round(value * 10) / 10;
}

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/organizations/:organizationId/analytics/reliability", async (request) => {
    const auth = await requireAuth(request);
    const { organizationId } = z.object({ organizationId: z.string().min(1) }).parse(request.params);
    const { days } = querySchema.parse(request.query);

    await requireOrganizationRole(auth.user.id, organizationId, [...memberRoles]);

    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    const [services, incidents, monitors] = await Promise.all([
      db.service.findMany({
        where: { organizationId },
        select: { id: true, name: true, status: true },
        orderBy: { displayOrder: "asc" },
      }),
      db.incident.findMany({
        where: { organizationId, startedAt: { gte: from } },
        select: {
          id: true,
          severity: true,
          status: true,
          startedAt: true,
          resolvedAt: true,
          services: { select: { serviceId: true } },
        },
      }),
      db.monitor.findMany({
        where: { service: { organizationId } },
        select: { id: true, serviceId: true },
      }),
    ]);

    const monitorIds = monitors.map((monitor) => monitor.id);
    const checkGroups = monitorIds.length
      ? await db.monitorCheck.groupBy({
          by: ["monitorId", "status"],
          where: { monitorId: { in: monitorIds }, checkedAt: { gte: from, lte: to } },
          _count: { _all: true },
          _avg: { responseTimeMs: true },
        })
      : [];

    const resolvedDurations = incidents
      .filter((incident) => incident.resolvedAt)
      .map((incident) => Math.max(0, (incident.resolvedAt!.getTime() - incident.startedAt.getTime()) / 60_000));

    const meanTimeToResolveMinutes = resolvedDurations.length
      ? Math.round(resolvedDurations.reduce((sum, value) => sum + value, 0) / resolvedDurations.length)
      : null;

    const severity = {
      MINOR: incidents.filter((incident) => incident.severity === "MINOR").length,
      MAJOR: incidents.filter((incident) => incident.severity === "MAJOR").length,
      CRITICAL: incidents.filter((incident) => incident.severity === "CRITICAL").length,
    };

    const monitorToService = new Map(monitors.map((monitor) => [monitor.id, monitor.serviceId]));
    const perServiceChecks = new Map<string, { checks: number; failedChecks: number }>();
    let checks = 0;
    let upChecks = 0;
    let downChecks = 0;
    let latencyWeightedTotal = 0;
    let latencyWeight = 0;

    for (const group of checkGroups) {
      const count = group._count._all;
      checks += count;
      if (group.status === "UP") upChecks += count;
      if (group.status === "DOWN") downChecks += count;

      if (group._avg.responseTimeMs !== null) {
        latencyWeightedTotal += group._avg.responseTimeMs * count;
        latencyWeight += count;
      }

      const serviceId = monitorToService.get(group.monitorId);
      if (serviceId) {
        const current = perServiceChecks.get(serviceId) ?? { checks: 0, failedChecks: 0 };
        current.checks += count;
        if (group.status === "DOWN") current.failedChecks += count;
        perServiceChecks.set(serviceId, current);
      }
    }

    const incidentCountByService = new Map<string, { incidents: number; active: number }>();
    for (const incident of incidents) {
      for (const link of incident.services) {
        const current = incidentCountByService.get(link.serviceId) ?? { incidents: 0, active: 0 };
        current.incidents += 1;
        if (incident.status !== "RESOLVED") current.active += 1;
        incidentCountByService.set(link.serviceId, current);
      }
    }

    const serviceReliability = services
      .map((service) => {
        const serviceChecks = perServiceChecks.get(service.id) ?? { checks: 0, failedChecks: 0 };
        const serviceIncidents = incidentCountByService.get(service.id) ?? { incidents: 0, active: 0 };
        const successfulChecks = serviceChecks.checks - serviceChecks.failedChecks;

        return {
          id: service.id,
          name: service.name,
          status: service.status,
          incidentCount: serviceIncidents.incidents,
          activeIncidentCount: serviceIncidents.active,
          checks: serviceChecks.checks,
          failedChecks: serviceChecks.failedChecks,
          checkSuccessRate: serviceChecks.checks
            ? roundRate((successfulChecks / serviceChecks.checks) * 100)
            : null,
        };
      })
      .sort((a, b) => b.incidentCount - a.incidentCount || b.failedChecks - a.failedChecks);

    return {
      window: { days, from, to },
      incidents: {
        total: incidents.length,
        active: incidents.filter((incident) => incident.status !== "RESOLVED").length,
        resolved: resolvedDurations.length,
        severity,
        meanTimeToResolveMinutes,
      },
      monitoring: {
        checks,
        upChecks,
        downChecks,
        checkSuccessRate: checks ? roundRate((upChecks / checks) * 100) : null,
        averageResponseTimeMs: latencyWeight ? Math.round(latencyWeightedTotal / latencyWeight) : null,
      },
      services: serviceReliability,
    };
  });
};
