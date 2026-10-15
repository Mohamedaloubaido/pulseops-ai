"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function LiveStatusRefresh({ apiOrigin, slug }: { apiOrigin: string; slug: string }) {
  const router = useRouter();

  useEffect(() => {
    const source = new EventSource(`${apiOrigin}/api/status/${encodeURIComponent(slug)}/events`);
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 250);
    };

    source.addEventListener("status.changed", refresh);

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      source.removeEventListener("status.changed", refresh);
      source.close();
    };
  }, [apiOrigin, router, slug]);

  return null;
}
