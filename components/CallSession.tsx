"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { TranscriptEntry } from "@/db/schema";
import { formatClock } from "@/lib/format";
import type { Persona, SessionOverrides } from "@/lib/personas";
import { PhoneLine } from "@/lib/phone-line";
import {
  appendLine,
  applyAgentCorrection,
  markLastAgentInterrupted,
} from "@/lib/transcript";
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

// Per-browser preference for the landline effect on the prospect's voice.
// On by default. Kept in memory too, so the toggle works with storage blocked.
const PHONE_SOUND_KEY = "mockcalls.phoneSound";
const phonePrefListeners = new Set<() => void>();
let phonePrefMemory: boolean | null = null;
const readPhonePref = () => {
  if (phonePrefMemory != null) return phonePrefMemory;
  try {
    return window.localStorage.getItem(PHONE_SOUND_KEY) !== "off";
  } catch {
    return true;
  }
};
const writePhonePref = (on: boolean) => {
  phonePrefMemory = on;
  try {
    window.localStorage.setItem(PHONE_SOUND_KEY, on ? "on" : "off");
  } catch {
    // not remembered across visits; still applies now
  }
  phonePrefListeners.forEach((l) => l());
};
const subscribePhonePref = (onChange: () => void) => {
  phonePrefListeners.add(onChange);
  return () => {
    phonePrefListeners.delete(onChange);
  };
};
// If the prospect has been speaking this long and the filter has still heard
// nothing, this browser is not passing call audio to Web Audio. The rep is
// already hearing normal audio; this just says so and stops waiting.
const PHONE_SILENCE_FALLBACK_MS = 3000;

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
  const phoneOn = useSyncExternalStore(subscribePhonePref, readPhonePref, () => true);
  const [phoneUnavailable, setPhoneUnavailable] = useState(false);

  const startedAt = useRef<number | null>(null);
  const starting = useRef(false);
  const ending = useRef(false);
  const lines = useRef<TranscriptEntry[]>([]);
  const finishRef = useRef<() => void>(() => {});
  const endedBy = useRef<"user" | "agent" | "error">("user");
  const bottomRef = useRef<HTMLDivElement>(null);
  const phone = useRef<PhoneLine | null>(null);
  const phoneChecked = useRef(false);
  const phoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const togglePhone = () => {
    const next = !phoneOn;
    writePhonePref(next);
    phone.current?.setEnabled(next);
  };

  const closePhone = () => {
    if (phoneTimer.current) clearTimeout(phoneTimer.current);
    phoneTimer.current = null;
    phone.current?.close();
    phone.current = null;
  };

  useEffect(() => closePhone, []);

  const setLines = (next: TranscriptEntry[]) => {
    if (next === lines.current) return;
    lines.current = next;
    setTranscript(next);
  };

  const conversation = useConversation({
    overrides,
    onConnect: () => {
      startedAt.current = Date.now();
      setPhase("live");
    },
    // No event-id dedupe here: the agent's reply carries the same event_id as
    // the user turn that triggered it (see lib/transcript.ts).
    onMessage: ({ message, role }) => {
      setLines(
        appendLine(lines.current, role, message, Math.round(secondsSince(startedAt.current))),
      );
    },
    onInterruption: () => {
      setLines(markLastAgentInterrupted(lines.current));
    },
    onAgentResponseCorrection: ({ corrected_agent_response }) => {
      setLines(applyAgentCorrection(lines.current, corrected_agent_response));
    },
    onDisconnect: (details) => {
      // "user" means we hung up ourselves and finish() is already running.
      if (details.reason !== "user") {
        endedBy.current = details.reason;
        finishRef.current();
      }
    },
    onError: (message) => {
      closePhone();
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
      await conversation.endSession();
    } catch {
      // already disconnected (prospect hung up, or connection dropped)
    }
    closePhone();
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

    // Built inside the click so the browser lets its AudioContext play. It
    // waits for the SDK's audio element and filters the prospect's voice.
    closePhone();
    phoneChecked.current = false;
    setPhoneUnavailable(false);
    phone.current = new PhoneLine(phoneOn);
    phone.current.start();

    // Ask for the mic inside the click gesture so the browser prompts here
    // (and unlocks audio playback for the prospect's voice).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setError("Microphone access is required. Allow it and try again.");
      closePhone();
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
      // Awaited so a WebRTC failure lands in the catch instead of leaving the
      // button stuck on "starting".
      await conversation.startSession({ conversationToken: data.conversationToken });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      closePhone();
      setPhase("idle");
      starting.current = false;
    }
  };

  // The first time the prospect speaks, give the filter a few seconds to hear
  // them. If it never does, say so and keep the normal audio for this call.
  useEffect(() => {
    if (phase !== "live" || !conversation.isSpeaking || phoneChecked.current) return;
    const line = phone.current;
    if (!line?.waiting) return;
    phoneChecked.current = true;
    // Not cleared when isSpeaking flips back: one check per call, even if the
    // first line is short. Cleared on hang-up and unmount via closePhone.
    phoneTimer.current = setTimeout(() => {
      if (!line.heardSignal) {
        line.bypass();
        setPhoneUnavailable(true);
      }
    }, PHONE_SILENCE_FALLBACK_MS);
  }, [phase, conversation.isSpeaking]);

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

      {(phase === "idle" || phase === "starting" || phase === "live") && (
        <div className="flex items-center justify-between gap-4 text-sm">
          <div>
            <span className="font-medium">Phone sound</span>
            <span className="ml-2 text-zinc-500">
              {phoneUnavailable
                ? "Not supported in this browser, so you're hearing normal audio."
                : "Makes the prospect sound like a real phone line."}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={phoneOn}
            aria-label="Phone sound"
            onClick={togglePhone}
            disabled={phoneUnavailable}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
              phoneOn ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"
            }`}
          >
            <span
              className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
                phoneOn ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      )}

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
          {phase === "ending" ? "Hanging up…" : "Call saved. Opening your results…"}
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
