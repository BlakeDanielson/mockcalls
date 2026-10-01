"use client";

import { useEffect, useState } from "react";

type State =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "not_ready" }
  | { kind: "missing" }
  | { kind: "error" };

const RETRY_MS = 10_000;
const MAX_AUTO_RETRIES = 6;

/**
 * Plays the ElevenLabs recording through /api/calls/[id]/audio. The file is
 * fetched whole and played from a blob URL so scrubbing works without Range
 * support on the route; a 5-minute call is a few MB.
 */
export function AudioPlayer({ callId }: { callId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  // Bumping this re-runs the fetch effect (auto-retry while processing, or the button).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetch(`/api/calls/${callId}/audio`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 425) return setState({ kind: "not_ready" });
        if (res.status === 404) return setState({ kind: "missing" });
        if (!res.ok) throw new Error(`audio ${res.status}`);
        objectUrl = URL.createObjectURL(await res.blob());
        if (cancelled) return;
        setState({ kind: "ready", url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [callId, attempt]);

  useEffect(() => {
    if (state.kind !== "not_ready" || attempt >= MAX_AUTO_RETRIES) return;
    const t = setTimeout(() => {
      setState({ kind: "loading" });
      setAttempt((a) => a + 1);
    }, RETRY_MS);
    return () => clearTimeout(t);
  }, [state.kind, attempt]);

  const retry = (
    <button
      onClick={() => {
        setState({ kind: "loading" });
        setAttempt((a) => a + 1);
      }}
      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      Check again
    </button>
  );

  return (
    <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        Recording
      </div>
      {state.kind === "loading" && (
        <p className="text-sm text-zinc-500">Loading recording…</p>
      )}
      {state.kind === "ready" && (
        <audio controls preload="metadata" src={state.url} className="w-full" />
      )}
      {state.kind === "not_ready" && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <span>
            {attempt < MAX_AUTO_RETRIES
              ? "Recording isn't ready yet — ElevenLabs is still processing it. Checking again…"
              : "Still processing."}
          </span>
          {attempt >= MAX_AUTO_RETRIES && retry}
        </div>
      )}
      {state.kind === "missing" && (
        <p className="text-sm text-zinc-500">No recording is available for this call.</p>
      )}
      {state.kind === "error" && (
        <div className="flex items-center gap-3 text-sm text-red-600">
          <span>Couldn&apos;t load the recording.</span>
          {retry}
        </div>
      )}
    </section>
  );
}
