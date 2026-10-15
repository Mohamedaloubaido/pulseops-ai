import dotenv from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

const parsed = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().url(),
    MONITOR_SCAN_INTERVAL_MS: z.coerce.number().int().min(5000).max(60000).default(10000),
    MONITOR_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(10),
  })
  .safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid worker environment", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
