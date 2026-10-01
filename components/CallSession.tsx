"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "@/db/schema";
import { formatClock } from "@/lib/format";
import type { Persona, SessionOverrides } from "@/lib/personas";
import { DifficultyBadge } from "./DifficultyBadge";
import { TranscriptView } from "./TranscriptView";

type Props = {
  callId: string;
  repName: string;
  persona: Persona;
  overrides: SessionOverrides;
};

type Phase = "idle" | "starting" | "live" | "ending" | "scoring" | "error";

const secondsSince = (start: number | null) =>
  start ? (Date.now() - start) / 1000 : 0;

export function CallSession(props: Props) {
  // useConversation must live under a ConversationProvider.
  return (
    <ConversationProvider>
      <CallUI {...props} />
    </ConversationProvider>
  );
}

function CallUI({ callId, repName, persona, overrides }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const startedAt = useRef<number | null>(null);
  const starting = useRef(false);
  const ending = useRef(false);
  const lines = useRef<TranscriptEntry[]>([]);
  const seenEventIds = useRef(new Set<number>());
  const finishRef = useRef<() => void>(() => {});
  const endedBy = useRef<"user" | "agent" | "error">("user");
  const bottomRef = useRef<HTMLDivElement>(null);

  // The SDK's interruption/correction events always concern the prospect line
  // currently being spoken, i.e. the most recent agent entry.
  const patchLastAgentLine = (
    patch: (e: TranscriptEntry) => TranscriptEntry | null,
  ) => {
    const idx = lines.current.map((e) => e.role).lastIndexOf("agent");
    if (idx < 0) return;
    const next = patch(lines.current[idx]);
    lines.current = next
      ? lines.current.map((e, i) => (i === idx ? next : e))
      : lines.current.filter((_, i) => i !== idx);
    setTranscript(lines.current);
  };

  const conversation = useConversation({
    overrides,
    onConnect: () => {
      startedAt.current = Date.now();
      setPhase("live");
    },
    onMessage: ({ message, role, event_id }) => {
      const text = message.trim();
      if (!text) return;
      if (event_id !== undefined) {
        if (seenEventIds.current.has(event_id)) return;
        seenEventIds.current.add(event_id);
      }
      // Tentative and final user transcripts can arrive as separate events.
      const last = lines.current.at(-1);
      if (last && last.role === role && last.message === text) return;
      lines.current = [
        ...lines.current,
        {
          role,
          message: text,
          timeInCallSecs: Math.round(secondsSince(startedAt.current)),
          // explicit false on prospect lines so "0 interruptions" is distinguishable from "unknown"
          ...(role === "agent" ? { interrupted: false } : {}),
        },
      ];
      setTranscript(lines.current);
    },
    onInterruption: () => {
      patchLastAgentLine((e) => ({ ...e, interrupted: true }));
    },
    onAgentResponseCorrection: ({ corrected_agent_response }) => {
      // agent_response carried the full planned reply; keep only what was actually said.
      const text = corrected_agent_response.trim();
      patchLastAgentLine((e) => (text ? { ...e, message: text } : null));
    },
    onDisconnect: (details) => {
      // "user" means we hung up ourselves and finish() is already running.
      if (details.reason !== "user") {
        endedBy.current = details.reason;
        finishRef.current();
      }
    },
    onError: (message) => {
      setError(message);
      setPhase("error");
    },
  });

  const finish = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    setPhase("ending");
    const durationSecs = Math.round(secondsSince(startedAt.current));
    try {
      conversation.endSession();
    } catch {
      // already disconnected (prospect hung up, or connection dropped)
    }
    setPhase("scoring");
    try {
      const res = await fetch(`/api/calls/${callId}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcript: lines.current,
          durationSecs,
          endedBy: endedBy.current,
        }),
      });
      if (res.status === 401) {
        throw new Error(
          "Your session expired. Sign in again in another tab, then retry saving — your transcript is still here.",
        );
      }
      if (!res.ok) throw new Error(`Saving the call failed (${res.status})`);
      router.push(`/call/${callId}/results`);
    } catch (err) {
      ending.current = false; // allow "Retry save" without losing the transcript
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [callId, conversation, router]);

  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const start = async () => {
    if (starting.current) return;
    starting.current = true;
    setError(null);
    setPhase("starting");

    // Ask for the mic inside the click gesture so the browser prompts here
    // (and unlocks audio playback for the prospect's voice).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setError("Microphone access is required. Allow it and try again.");
      setPhase("idle");
      starting.current = false;
      return;
    }

    try {
      const res = await fetch(`/api/calls/${callId}/start`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        conversationToken?: string;
        error?: string;
      };
      if (!res.ok || !data.conversationToken) {
        throw new Error(data.error ?? `Could not start the call (${res.status})`);
      }
      conversation.startSession({ conversationToken: data.conversationToken });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
      starting.current = false;
    }
  };

  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(
      () => setElapsed(Math.floor(secondsSince(startedAt.current))),
      1000,
    );
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [transcript]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{persona.name}</h1>
            <DifficultyBadge level={persona.difficulty} />
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {persona.title}, {persona.company}
          </p>
          <p className="mt-2 text-sm">{persona.tagline}</p>
        </div>
        <div className="shrink-0 text-right text-sm text-zinc-500">
          <div>
            Calling as{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {repName}
            </span>
          </div>
          {phase === "live" && (
            <div className="mt-1 font-mono text-lg tabular-nums">
              {formatClock(elapsed)}
            </div>
          )}
        </div>
      </div>

      {phase === "idle" && (
        <button
          onClick={start}
          className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-semibold text-white hover:bg-emerald-500"
        >
          Call {persona.name}
        </button>
      )}

      {phase === "starting" && (
        <div className="rounded-xl border border-zinc-200 p-4 text-center text-zinc-500 dark:border-zinc-800">
          Connecting…
        </div>
      )}

      {phase === "live" && (
        <div className="flex items-center justify-between rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`size-2.5 rounded-full ${
                conversation.isSpeaking
                  ? "animate-pulse bg-emerald-500"
                  : "bg-zinc-400"
              }`}
            />
            {conversation.isSpeaking
              ? `${persona.name} is speaking`
              : "Listening to you"}
          </div>
          <button
            onClick={() => finish()}
            className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-500"
          >
            End call
          </button>
        </div>
      )}

      {(phase === "ending" || phase === "scoring") && (
        <div className="rounded-xl border border-zinc-200 p-4 text-center text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          {phase === "ending"
            ? "Hanging up…"
            : "Call saved. Scoring it now — this takes under a minute…"}
        </div>
      )}

      {phase === "error" && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          <p>{error}</p>
          <div className="mt-3 flex items-center gap-4">
            {transcript.length > 0 ? (
              <button
                onClick={() => finish()}
                className="rounded-md bg-red-700 px-3 py-1.5 font-medium text-white hover:bg-red-600"
              >
                Retry save
              </button>
            ) : (
              <button
                onClick={() => window.location.reload()}
                className="rounded-md bg-red-700 px-3 py-1.5 font-medium text-white hover:bg-red-600"
              >
                Try again
              </button>
            )}
            <Link href={`/call/${callId}/results`} className="underline">
              See what was saved
            </Link>
          </div>
        </div>
      )}

      {error && phase === "idle" && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-500">Transcript</h2>
        {transcript.length === 0 ? (
          <p className="text-sm text-zinc-400">
            {phase === "idle"
              ? "Your conversation will appear here as you talk."
              : "…"}
          </p>
        ) : (
          <TranscriptView entries={transcript} />
        )}
        <div ref={bottomRef} />
      </section>
    </div>
  );
}
