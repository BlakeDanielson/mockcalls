"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const INTERVAL_MS = 3000;
/** ~6.5 minutes, past STUCK_AFTER_SECS in lib/run-scoring.ts (not imported:
 *  that module pulls the database driver into the client bundle), after which
 *  the page re-renders with the "try again" form instead of the spinner. */
const MAX_POLLS = 130;

/** Refreshes the results page once scoring lands. Renders nothing. */
export function ScoringPoller({ callId }: { callId: string }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // setTimeout re-armed after each response, so slow requests never overlap.
    const poll = async () => {
      if (cancelled) return;
      polls++;
      const res = await fetch(`/api/calls/${callId}`).catch(() => null);
      if (cancelled) return;
      if (res?.status === 401) {
        // Session ended: let the page's requireUser send us to sign-in and back.
        router.refresh();
        return;
      }
      if (res?.ok) {
        const data = (await res.json().catch(() => null)) as { status?: string } | null;
        if (data?.status === "scored" || data?.status === "failed") {
          router.refresh();
          return;
        }
      }
      if (polls >= MAX_POLLS) {
        // Give up spinning; the page decides whether the call is stuck.
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
  }, [callId, router]);

  return null;
}
