import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { hashPassword } from "../src/lib/password.js";

dotenv.config();
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: resolve(process.cwd(), "../../.env") });
}

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
  throw new Error("Refusing to seed demo credentials in production. Set ALLOW_DEMO_SEED=true only if this is intentional.");
}

const db = new PrismaClient();
const demoEmail = process.env.DEMO_EMAIL ?? "demo@pulseops.local";
const demoPassword = process.env.DEMO_PASSWORD ?? "PulseOpsDemo123!";
const now = Date.now();

async function main() {
  const passwordHash = await hashPassword(demoPassword);

  const user = await db.user.upsert({
    where: { email: demoEmail },
    update: { name: "Demo Operator", passwordHash },
    create: { name: "Demo Operator", email: demoEmail, passwordHash },
  });

  const organization = await db.organization.upsert({
    where: { slug: "northstar-cloud" },
    update: {
      name: "Northstar Cloud",
      statusPageEnabled: true,
      statusPageTitle: "Northstar Cloud Status",
      statusPageDescription: "Live service health and incident communication for the PulseOps demo workspace.",
    },
    create: {
      name: "Northstar Cloud",
      slug: "northstar-cloud",
      statusPageEnabled: true,
      statusPageTitle: "Northstar Cloud Status",
      statusPageDescription: "Live service health and incident communication for the PulseOps demo workspace.",
    },
  });

  await db.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
    update: { role: "OWNER" },
    create: { userId: user.id, organizationId: organization.id, role: "OWNER" },
  });

  const apiGateway = await db.service.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "api-gateway" } },
    update: { name: "API Gateway", description: "Public API edge and request routing", status: "MAJOR_OUTAGE", displayOrder: 0 },
    create: { organizationId: organization.id, name: "API Gateway", slug: "api-gateway", description: "Public API edge and request routing", status: "MAJOR_OUTAGE", displayOrder: 0 },
  });

  await db.service.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "primary-database" } },
    update: { name: "Primary Database", description: "PostgreSQL primary cluster", status: "OPERATIONAL", displayOrder: 1 },
    create: { organizationId: organization.id, name: "Primary Database", slug: "primary-database", description: "PostgreSQL primary cluster", status: "OPERATIONAL", displayOrder: 1 },
  });

  await db.service.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "web-application" } },
    update: { name: "Web Application", description: "Customer-facing application", status: "OPERATIONAL", displayOrder: 2 },
    create: { organizationId: organization.id, name: "Web Application", slug: "web-application", description: "Customer-facing application", status: "OPERATIONAL", displayOrder: 2 },
  });

  let monitor = await db.monitor.findFirst({
    where: { serviceId: apiGateway.id, name: "Demo API health check" },
  });

  if (!monitor) {
    monitor = await db.monitor.create({
      data: {
        serviceId: apiGateway.id,
        name: "Demo API health check",
        url: "https://example.com",
        intervalSeconds: 60,
        timeoutMs: 5000,
        expectedStatus: 503,
        enabled: true,
        lastStatus: "DOWN",
        lastCheckedAt: new Date(now - 2 * 60_000),
        lastResponseTimeMs: 812,
        consecutiveFailures: 3,
      },
    });

    await db.monitorCheck.createMany({
      data: [
        { monitorId: monitor.id, status: "DOWN", statusCode: 200, responseTimeMs: 548, error: "Expected HTTP 503, received 200", checkedAt: new Date(now - 6 * 60_000) },
        { monitorId: monitor.id, status: "DOWN", statusCode: 200, responseTimeMs: 676, error: "Expected HTTP 503, received 200", checkedAt: new Date(now - 4 * 60_000) },
        { monitorId: monitor.id, status: "DOWN", statusCode: 200, responseTimeMs: 812, error: "Expected HTTP 503, received 200", checkedAt: new Date(now - 2 * 60_000) },
      ],
    });
  }

  let incident = await db.incident.findFirst({
    where: { organizationId: organization.id, title: "Elevated API latency and request failures", status: { not: "RESOLVED" } },
  });

  if (!incident) {
    incident = await db.incident.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        title: "Elevated API latency and request failures",
        summary: "Customers are seeing intermittent API failures while the team investigates the gateway path.",
        severity: "MAJOR",
        status: "IDENTIFIED",
        startedAt: new Date(now - 42 * 60_000),
        services: { create: [{ serviceId: apiGateway.id }] },
      },
    });

    await db.incidentUpdate.createMany({
      data: [
        {
          incidentId: incident.id,
          authorId: user.id,
          status: "INVESTIGATING",
          message: "Automated monitoring detected repeated API health-check failures. Investigation started.",
          createdAt: new Date(now - 40 * 60_000),
        },
        {
          incidentId: incident.id,
          authorId: user.id,
          status: "IDENTIFIED",
          message: "Failures are isolated to the API gateway path. Database and web application health remain nominal.",
          createdAt: new Date(now - 27 * 60_000),
        },
        {
          incidentId: incident.id,
          authorId: user.id,
          message: "Traffic is being reviewed while response latency and gateway error rate are monitored.",
          createdAt: new Date(now - 11 * 60_000),
        },
      ],
    });
  }

  console.log("\nPulseOps demo workspace is ready.");
  console.log(`Login: ${demoEmail}`);
  console.log(`Password: ${demoPassword}`);
  console.log("Status page: http://localhost:3000/status/northstar-cloud");
  console.log("Dashboard: http://localhost:3000/login\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
