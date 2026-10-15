import Fastify from "fastify";
import { env } from "./env.js";
import { healthRoutes } from "./routes/health.js";

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
  },
});

await app.register(healthRoutes, { prefix: "/api" });

app.get("/", async () => ({
  name: "PulseOps AI API",
  version: "0.1.0",
  status: "ok",
}));

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down PulseOps API");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
