import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calls, type Call, type CallStatus } from "@/db/schema";
import { getPersona } from "./personas";
import { scoreCall } from "./scoring";

/** Score a call whose transcript is already saved, and persist the result. */
export async function runScoring(call: Call): Promise<CallStatus> {
  const db = getDb();
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
