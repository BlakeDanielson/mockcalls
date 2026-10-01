import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calls, type Call, type CallStatus } from "@/db/schema";
import { computeMetrics, type CallMetrics } from "./metrics";
import { getPersona } from "./personas";
import { scoreCall } from "./scoring";

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
 * when scoring fails), then Claude's scorecard. Used by the end route, the
 * rescore action and scripts/rescore.ts.
 */
export async function runScoring(call: Call): Promise<CallStatus> {
  const db = getDb();
  await storeMetrics(call);

  const persona = getPersona(call.personaId);
  const transcript = call.transcript ?? [];
  if (!persona || transcript.length === 0) {
    await db.update(calls).set({ status: "failed" }).where(eq(calls.id, call.id));
    return "failed";
  }

  try {
    const scorecard = await scoreCall(transcript, persona, call.repName);
    await db
      .update(calls)
      .set({ scorecard, status: "scored" })
      .where(eq(calls.id, call.id));
    return "scored";
  } catch (err) {
    console.error(`[scoring] call ${call.id} failed`, err);
    await db.update(calls).set({ status: "failed" }).where(eq(calls.id, call.id));
    return "failed";
  }
}
