import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calls, type Call, type CallStatus } from "@/db/schema";
import { toTranscript, waitForDone } from "./elevenlabs";
import { computeMetrics, mapTerminationReason, type CallMetrics } from "./metrics";
import { getPersona } from "./personas";
import { scoreCall } from "./scoring";

/**
 * A call still at `ended` this long after it ended is stuck (the finalization
 * job died mid-way), not in progress. Must exceed the job's worst case:
 * FINALIZE_WAIT (~150 s) plus a judge call bounded at 90 s with one retry.
 * Used by the rescore action and the results page.
 */
export const STUCK_AFTER_SECS = 360;

/**
 * How long the background finalizer waits for ElevenLabs to finish processing
 * the conversation before scoring whatever transcript it has. Long calls take
 * a minute or two to process; the client transcript is the fallback.
 */
export const FINALIZE_WAIT = { attempts: 30, delayMs: 5000 };

/** Deterministic metrics from the stored transcript; cheap, idempotent, no network. */
export async function storeMetrics(call: Call): Promise<CallMetrics> {
  const metrics = computeMetrics({
    transcript: call.transcript ?? [],
    durationSecs: call.durationSecs,
    terminationReason: call.terminationReason,
    source: call.transcriptSource ?? "client",
  });
  await getDb().update(calls).set({ metrics }).where(eq(calls.id, call.id));
  return metrics;
}

/**
 * The single write path after a call ends: metrics first (so they exist even
 * when scoring fails), then Claude's scorecard. Used by finalizeCall and
 * scripts/rescore.ts.
 */
export async function runScoring(call: Call): Promise<CallStatus> {
  const db = getDb();
  const markFailed = () =>
    db
      .update(calls)
      .set({ status: "failed" })
      .where(eq(calls.id, call.id))
      .catch((err) => console.error(`[scoring] call ${call.id} could not mark failed`, err));

  // Everything is inside the try so no exception can leave the row at `ended`,
  // which the results page would show as "scoring" forever.
  try {
    await storeMetrics(call);

    const persona = getPersona(call.personaId);
    const transcript = call.transcript ?? [];
    if (!persona || transcript.length === 0) {
      await markFailed();
      return "failed";
    }

    const scorecard = await scoreCall(transcript, persona, call.repName);
    await db
      .update(calls)
      .set({ scorecard, status: "scored" })
      .where(eq(calls.id, call.id));
    return "scored";
  } catch (err) {
    console.error(`[scoring] call ${call.id} failed`, err);
    await markFailed();
    return "failed";
  }
}

/**
 * Finish an `ended` call: swap in the ElevenLabs transcript once the
 * conversation has been processed (real timestamps, interruption flags,
 * duration, termination reason), then score exactly once. Runs after the
 * `/end` response via `after()`, and from the rescore action with a short wait.
 *
 * The swap is a conditional UPDATE on `status = 'ended'`; if some other path
 * finished the row in the meantime, this one logs and stands down.
 */
export async function finalizeCall(
  call: Call,
  opts: { wait?: { attempts: number; delayMs: number } } = {},
): Promise<CallStatus> {
  const db = getDb();
  let next: Call = call;
  const startedAt = Date.now();

  if (call.elevenlabsConversationId && call.transcriptSource !== "elevenlabs") {
    const convo = await waitForDone(call.elevenlabsConversationId, opts.wait ?? FINALIZE_WAIT).catch(
      (err) => {
        console.error(`[finalize] call ${call.id}: transcript fetch failed`, err);
        return null;
      },
    );
    const serverTranscript = convo ? toTranscript(convo) : [];
    if (convo && serverTranscript.length > 0) {
      const patch = {
        transcript: serverTranscript,
        transcriptSource: "elevenlabs" as const,
        durationSecs: convo.metadata?.call_duration_secs ?? call.durationSecs,
        terminationReason: convo.metadata?.termination_reason ?? call.terminationReason,
      };
      const [swapped] = await db
        .update(calls)
        .set(patch)
        .where(and(eq(calls.id, call.id), eq(calls.status, "ended")))
        .returning({ id: calls.id });
      if (!swapped) {
        const current = await db.query.calls.findFirst({
          where: eq(calls.id, call.id),
          columns: { status: true },
        });
        console.warn(
          `[finalize] call ${call.id} already left 'ended' (now ${current?.status ?? "missing"}); standing down`,
        );
        return current?.status ?? "failed";
      }
      next = { ...call, ...patch };
    }
  }

  const waited = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `[finalize] call ${call.id} source=${next.transcriptSource ?? "client"} waited=${waited}s turns=${next.transcript?.length ?? 0} termination_reason=${next.terminationReason ?? "null"} endedBy=${mapTerminationReason(next.terminationReason)}`,
  );
  return runScoring(next);
}
