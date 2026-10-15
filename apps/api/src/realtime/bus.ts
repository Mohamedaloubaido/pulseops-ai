import Redis from "ioredis";
import { env } from "../env.js";

export type OrganizationEvent = {
  type:
    | "service.created"
    | "service.updated"
    | "service.status_changed"
    | "incident.created"
    | "incident.updated"
    | "monitor.checked";
  organizationId: string;
  entityId: string;
  occurredAt: string;
};

const publisher = new Redis(env.REDIS_URL, {
  enableReadyCheck: true,
  maxRetriesPerRequest: 2,
});

export function organizationChannel(organizationId: string) {
  return `pulseops:organization:${organizationId}`;
}

export async function publishOrganizationEvent(
  event: Omit<OrganizationEvent, "occurredAt"> & { occurredAt?: string },
) {
  const payload: OrganizationEvent = {
    ...event,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
  };

  await publisher.publish(organizationChannel(payload.organizationId), JSON.stringify(payload));
}

export function createRealtimeSubscriber() {
  return new Redis(env.REDIS_URL, {
    enableReadyCheck: true,
    maxRetriesPerRequest: 2,
  });
}

export async function closeRealtimePublisher() {
  await publisher.quit();
}
