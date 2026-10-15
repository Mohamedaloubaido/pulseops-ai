import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { pulseopsWorkerDb?: PrismaClient };

export const db =
  globalForPrisma.pulseopsWorkerDb ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.pulseopsWorkerDb = db;
}
