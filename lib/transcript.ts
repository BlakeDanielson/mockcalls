import type { TranscriptEntry } from "@/db/schema";
import { stripDeliveryTags } from "./format";

// Pure reducers for the transcript the browser builds during a live call.
// Client-safe: no database, no environment.
//
// ElevenLabs forwards an `event_id` on both `user_transcript` and
// `agent_response` events, and the agent's reply carries the SAME id as the
// user turn that triggered it. Deduping across roles on that id therefore
// drops every prospect line after the first message (seen in production), so
// nothing here looks at event ids. The only dedupe is an identical repeat of
// the immediately preceding line from the same role.

export type SpeakerRole = TranscriptEntry["role"];

/** Append one spoken line; returns the same array when nothing was added. */
export function appendLine(
  lines: TranscriptEntry[],
  role: SpeakerRole,
  rawMessage: string,
  timeInCallSecs: number,
): TranscriptEntry[] {
  const message = stripDeliveryTags(rawMessage);
  if (!message) return lines;
  const last = lines.at(-1);
  if (last && last.role === role && last.message === message) return lines;
  const entry: TranscriptEntry =
    role === "agent"
      ? // explicit false on prospect lines so "0 interruptions" is distinguishable from "unknown"
        { role, message, timeInCallSecs, interrupted: false }
      : { role, message, timeInCallSecs };
  return [...lines, entry];
}

/**
 * The SDK's interruption and correction events always concern the prospect
 * line currently being spoken, i.e. the most recent agent entry. Returning
 * null from `patch` removes that entry.
 */
export function patchLastAgentLine(
  lines: TranscriptEntry[],
  patch: (entry: TranscriptEntry) => TranscriptEntry | null,
): TranscriptEntry[] {
  const idx = lines.map((e) => e.role).lastIndexOf("agent");
  if (idx < 0) return lines;
  const next = patch(lines[idx]);
  return next
    ? lines.map((e, i) => (i === idx ? next : e))
    : lines.filter((_, i) => i !== idx);
}

/** The SDR talked over the prospect's current line. */
export function markLastAgentInterrupted(lines: TranscriptEntry[]): TranscriptEntry[] {
  return patchLastAgentLine(lines, (e) => ({ ...e, interrupted: true }));
}

/**
 * `agent_response` carried the full planned reply; the correction carries
 * what was actually said before the cut-off. An empty correction means the
 * prospect was cut off before the first word, so the line goes away.
 */
export function applyAgentCorrection(
  lines: TranscriptEntry[],
  correctedResponse: string,
): TranscriptEntry[] {
  const text = stripDeliveryTags(correctedResponse);
  return patchLastAgentLine(lines, (e) => (text ? { ...e, message: text } : null));
}
