import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/context.js";
import { requireOrganizationRole } from "../auth/rbac.js";
import { ApiError } from "../lib/api-error.js";
import { db } from "../lib/db.js";
import { createRealtimeSubscriber, organizationChannel } from "../realtime/bus.js";

function openEventStream(reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  reply.raw.flushHeaders();
}

function writeEvent(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function streamOrganization(
  request: FastifyRequest,
  reply: FastifyReply,
  organizationId: string,
  mode: "internal" | "public",
) {
  openEventStream(reply);
  const subscriber = createRealtimeSubscriber();
  const channel = organizationChannel(organizationId);

  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    subscriber.removeAllListeners();
    try {
      await subscriber.unsubscribe(channel);
      await subscriber.quit();
    } catch {
      subscriber.disconnect();
    }
  };

  subscriber.on("message", (incomingChannel, message) => {
    if (incomingChannel !== channel || closed) return;

    if (mode === "public") {
      writeEvent(reply, "status.changed", { occurredAt: new Date().toISOString() });
      return;
    }

    try {
      writeEvent(reply, "organization.event", JSON.parse(message) as unknown);
    } catch {
      writeEvent(reply, "organization.event", { type: "unknown" });
    }
  });

  subscriber.on("error", (error) => {
    request.log.error(error, "Realtime subscriber error");
  });

  await subscriber.subscribe(channel);
  writeEvent(reply, "connected", { organizationId, mode, occurredAt: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    if (!closed) reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
  }, 20_000);

  request.raw.on("close", () => void cleanup());
  reply.raw.on("close", () => void cleanup());
}

export const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/organizations/:organizationId/events", async (request, reply) => {
    const auth = await requireAuth(request);
    const { organizationId } = z.object({ organizationId: z.string().min(1) }).parse(request.params);

    await requireOrganizationRole(auth.user.id, organizationId, ["OWNER", "ADMIN", "RESPONDER", "VIEWER"]);
    await streamOrganization(request, reply, organizationId, "internal");
  });

  app.get("/status/:slug/events", async (request, reply) => {
    const { slug } = z.object({ slug: z.string().min(1).max(120) }).parse(request.params);
    const organization = await db.organization.findFirst({
      where: { slug, statusPageEnabled: true },
      select: { id: true },
    });

    if (!organization) throw new ApiError(404, "Status page not found");
    await streamOrganization(request, reply, organization.id, "public");
  });
};
