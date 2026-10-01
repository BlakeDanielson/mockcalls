"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the results page once scoring lands. Renders nothing. */
export function ScoringPoller({ callId }: { callId: string }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(async () => {
      const res = await fetch(`/api/calls/${callId}`).catch(() => null);
      if (res?.status === 401) {
        // Session ended: let the page's requireUser send us to sign-in and back.
        clearInterval(timer);
        router.refresh();
        return;
      }
      if (!res?.ok) return;
      const { status } = (await res.json()) as { status: string };
      if (status === "scored" || status === "failed") {
        clearInterval(timer);
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [callId, router]);

  return null;
}
