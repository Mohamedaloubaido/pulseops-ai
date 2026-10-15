import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { performance } from "node:perf_hooks";
import { db } from "./db.js";
import { env } from "./env.js";
import { assertPublicMonitorTarget } from "./network.js";

type MonitorJob = { monitorId: string };

function redisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

const connection = redisConnection();
const queue = new Queue<MonitorJob>("monitor-checks", { connection });
const realtimePublisher = new Redis(env.REDIS_URL, {
  enableReadyCheck: true,
  maxRetriesPerRequest: 2,
});

async function publishMonitorEvent(organizationId: string, monitorId: string) {
  try {
    await realtimePublisher.publish(
      `pulseops:organization:${organizationId}`,
      JSON.stringify({
        type: "monitor.checked",
        organizationId,
        entityId: monitorId,
        occurredAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error("[monitor] failed to publish realtime event", error);
  }
}

async function syncServiceStatus(serviceId: string) {
  const [service, monitors] = await Promise.all([
    db.service.findUnique({ where: { id: serviceId }, select: { status: true } }),
    db.monitor.findMany({
      where: { serviceId, enabled: true },
      select: { lastStatus: true, consecutiveFailures: true },
    }),
  ]);

  if (!service || service.status === "MAINTENANCE") return;

  const confirmedDown = monitors.some(
    (monitor) => monitor.lastStatus === "DOWN" && monitor.consecutiveFailures >= 3,
  );
  const allHealthy = monitors.length > 0 && monitors.every((monitor) => monitor.lastStatus === "UP");

  if (confirmedDown && service.status === "OPERATIONAL") {
    await db.service.update({ where: { id: serviceId }, data: { status: "MAJOR_OUTAGE" } });
  } else if (allHealthy && service.status === "MAJOR_OUTAGE") {
    await db.service.update({ where: { id: serviceId }, data: { status: "OPERATIONAL" } });
  }
}

const worker = new Worker<MonitorJob>(
  "monitor-checks",
  async (job) => {
    const monitor = await db.monitor.findUnique({
      where: { id: job.data.monitorId },
      include: { service: { select: { organizationId: true } } },
    });
    if (!monitor || !monitor.enabled) return;

    let status: "UP" | "DOWN" = "DOWN";
    let statusCode: number | null = null;
    let errorMessage: string | null = null;
    const started = performance.now();

    try {
      await assertPublicMonitorTarget(monitor.url);
      const response = await fetch(monitor.url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(monitor.timeoutMs),
        headers: { "user-agent": "PulseOps-Monitor/0.2" },
      });
      statusCode = response.status;
      status = response.status === monitor.expectedStatus ? "UP" : "DOWN";
      if (status === "DOWN") {
        errorMessage = `Expected HTTP ${monitor.expectedStatus}, received ${response.status}`;
      }
      await response.body?.cancel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message.slice(0, 500) : "Unknown monitoring error";
    }

    const responseTimeMs = Math.max(0, Math.round(performance.now() - started));
    const consecutiveFailures = status === "DOWN" ? monitor.consecutiveFailures + 1 : 0;
    const checkedAt = new Date();

    await db.$transaction([
      db.monitorCheck.create({
        data: {
          monitorId: monitor.id,
          status,
          statusCode,
          responseTimeMs,
          error: errorMessage,
          checkedAt,
        },
      }),
      db.monitor.update({
        where: { id: monitor.id },
        data: {
          lastStatus: status,
          lastCheckedAt: checkedAt,
          lastResponseTimeMs: responseTimeMs,
          consecutiveFailures,
        },
      }),
    ]);

    await syncServiceStatus(monitor.serviceId);
    await publishMonitorEvent(monitor.service.organizationId, monitor.id);
  },
  { connection, concurrency: env.MONITOR_CONCURRENCY },
);

worker.on("completed", (job) => {
  console.info(`[monitor] completed ${job.data.monitorId}`);
});

worker.on("failed", (job, error) => {
  console.error(`[monitor] failed ${job?.data.monitorId ?? "unknown"}`, error);
});

async function scanDueMonitors() {
  const monitors = await db.monitor.findMany({
    where: { enabled: true },
    select: { id: true, intervalSeconds: true, lastCheckedAt: true },
    take: 2000,
  });

  const now = Date.now();
  const due = monitors.filter((monitor) => {
    if (!monitor.lastCheckedAt) return true;
    return now - monitor.lastCheckedAt.getTime() >= monitor.intervalSeconds * 1000;
  });

  await Promise.all(
    due.map((monitor) => {
      const bucket = Math.floor(now / (monitor.intervalSeconds * 1000));
      return queue.add(
        "check",
        { monitorId: monitor.id },
        {
          jobId: `${monitor.id}-${bucket}`,
          attempts: 2,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: 500,
          removeOnFail: 500,
        },
      );
    }),
  );
}

async function safeScan() {
  try {
    await scanDueMonitors();
  } catch (error) {
    console.error("[monitor] scheduler scan failed", error);
  }
}

await safeScan();
const scanTimer = setInterval(() => void safeScan(), env.MONITOR_SCAN_INTERVAL_MS);

async function shutdown(signal: string) {
  console.info(`[monitor] shutting down on ${signal}`);
  clearInterval(scanTimer);
  await worker.close();
  await queue.close();
  await realtimePublisher.quit();
  await db.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.info("PulseOps monitoring worker started");
