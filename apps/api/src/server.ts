import Fastify from "fastify";
import { ZodError } from "zod";
import { env } from "./env.js";
import { ApiError } from "./lib/api-error.js";
import { db } from "./lib/db.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { organizationRoutes } from "./routes/organizations.js";
import { serviceRoutes } from "./routes/services.js";

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
  },
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: "Invalid request", details: error.flatten().fieldErrors });
  }

  if (error instanceof ApiError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

  request.log.error(error);
  return reply.code(500).send({ error: "Internal server error" });
});

await app.register(healthRoutes, { prefix: "/api" });
await app.register(authRoutes, { prefix: "/api" });
await app.register(organizationRoutes, { prefix: "/api" });
await app.register(serviceRoutes, { prefix: "/api" });

app.get("/", async () => ({
  name: "PulseOps AI API",
  version: "0.3.0",
  status: "ok",
}));

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down PulseOps API");
  await app.close();
  await db.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error(error);
  await db.$disconnect();
  process.exit(1);
}
