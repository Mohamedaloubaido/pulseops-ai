"use client";

const API_ORIGIN = process.env.NEXT_PUBLIC_PULSEOPS_API_URL ?? "http://localhost:4000";

export type ApiErrorBody = { error?: string };

export async function apiRequest<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body.error) message = body.error;
    } catch {
      // Keep the generic message when the response is not JSON.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const apiOrigin = API_ORIGIN;
