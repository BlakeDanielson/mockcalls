"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const INTERVAL_MS = 4000;
/** ~16 minutes, past RESEARCH_STUCK_AFTER_SECS in lib/run-custom-persona.ts. */
const MAX_POLLS = 240;

/** Refreshes the custom persona page once research lands. Renders nothing. */
export function ResearchPoller({ id }: { id: string }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (cancelled) return;
      polls++;
      const res = await fetch(`/api/custom-personas/${id}`).catch(() => null);
      if (cancelled) return;
      if (res?.status === 401) {
        router.refresh();
        return;
      }
      if (res?.ok) {
        const data = (await res.json().catch(() => null)) as { status?: string } | null;
        if (data?.status === "ready" || data?.status === "failed") {
          router.refresh();
          return;
        }
      }
      if (polls >= MAX_POLLS) {
        router.refresh();
        return;
      }
      timer = setTimeout(poll, INTERVAL_MS);
    };
    timer = setTimeout(poll, INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, router]);

  return null;
}
