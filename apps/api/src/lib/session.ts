import { createHash, randomBytes } from "node:crypto";
import { db } from "./db.js";

const SESSION_TTL_DAYS = 30;

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const session = await db.session.create({
    data: { userId, tokenHash, expiresAt },
  });

  return { token, session };
}
