// Recompute metrics and/or re-run the Claude judge for existing calls.
//
//   pnpm rescore                      recompute metrics for the newest 50 finished calls
//   pnpm rescore --metrics --missing  only rows without metrics
//   pnpm rescore --refetch --missing  upgrade browser-transcript rows to the ElevenLabs transcript
//                                     (re-runs metrics and the judge, since moment indexes change)
//   pnpm rescore --claude --id <uuid> re-run the judge for one call (20–40 s, a few cents)
//   pnpm rescore --claude --dry-run --id <uuid>   score without writing (run ×3 to gauge variance)
//   pnpm rescore --reasons            list termination_reason strings and how they map
//
// Env readers are lazy (getDb, ElevenLabs apiKey, Anthropic client), so loading
// .env.local here is enough even though imports are hoisted. Export DATABASE_URL
// first to target another database; loadEnvFile never overrides existing vars.
try {
  process.loadEnvFile(".env.local");
} catch {
  // ambient env (e.g. a Render shell)
}

import { parseArgs } from "node:util";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { calls, type Call } from "@/db/schema";
import { getConversation, toTranscript } from "@/lib/elevenlabs";
import { computeMetrics, mapTerminationReason } from "@/lib/metrics";
import { callPersona } from "@/lib/personas";
import { runScoring, storeMetrics } from "@/lib/run-scoring";
import { scoreCall } from "@/lib/scoring";

const { values: flags } = parseArgs({
  options: {
    metrics: { type: "boolean", default: false },
    refetch: { type: "boolean", default: false },
    claude: { type: "boolean", default: false },
    reasons: { type: "boolean", default: false },
    missing: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    id: { type: "string", multiple: true, default: [] },
    limit: { type: "string", default: "50" },
  },
});
const mode = flags.claude ? "claude" : flags.refetch ? "refetch" : "metrics";
const dryRun = flags["dry-run"];
const db = getDb();

const FINISHED = inArray(calls.status, ["ended", "scored", "failed"]);

async function main() {
  if (flags.reasons) {
    const rows = await db
      .select({ raw: calls.terminationReason, count: sql<number>`count(*)::int` })
      .from(calls)
      .where(FINISHED)
      .groupBy(calls.terminationReason)
      .orderBy(desc(sql`count(*)`));
    for (const r of rows) {
      console.log(`${String(r.count).padStart(5)} | ${r.raw ?? "(null)"} | ${mapTerminationReason(r.raw)}`);
    }
    return 0;
  }

  const missing =
    !flags.missing
      ? undefined
      : mode === "metrics"
        ? isNull(calls.metrics)
        : mode === "refetch"
          ? eq(calls.transcriptSource, "client")
          : or(isNull(calls.scorecard), sql`${calls.scorecard}->'moments' is null`);

  const rows: Call[] = flags.id.length
    ? await db.select().from(calls).where(inArray(calls.id, flags.id))
    : await db
        .select()
        .from(calls)
        // and() parenthesises `missing`; a raw template would let its OR escape
        // the status filter and pick up calls that are still in progress.
        .where(missing ? and(FINISHED, missing) : FINISHED)
        .orderBy(desc(calls.createdAt))
        .limit(Number(flags.limit));

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let call of rows) {
    const label = `${call.id} ${call.repName} ${call.personaId}`;
    try {
      if (mode === "refetch") {
        if (!call.elevenlabsConversationId) {
          console.log(`${label} skip (no conversation id)`);
          skipped++;
          continue;
        }
        const convo = await getConversation(call.elevenlabsConversationId);
        const transcript = convo.status === "done" ? toTranscript(convo) : [];
        if (transcript.length === 0) {
          console.log(`${label} skip (ElevenLabs status=${convo.status}, empty transcript)`);
          skipped++;
          continue;
        }
        call = {
          ...call,
          transcript,
          transcriptSource: "elevenlabs",
          durationSecs: convo.metadata?.call_duration_secs ?? call.durationSecs,
          terminationReason: convo.metadata?.termination_reason ?? call.terminationReason,
        };
        if (!dryRun) {
          await db
            .update(calls)
            .set({
              transcript: call.transcript,
              transcriptSource: call.transcriptSource,
              durationSecs: call.durationSecs,
              terminationReason: call.terminationReason,
            })
            .where(eq(calls.id, call.id));
        }
      }

      if (dryRun) {
        const m = computeMetrics({
          transcript: call.transcript ?? [],
          durationSecs: call.durationSecs,
          terminationReason: call.terminationReason,
          source: call.transcriptSource ?? "client",
        });
        const share = m.sdrTalkShare ?? m.sdrWordShare;
        console.log(
          `${label} src=${call.transcriptSource ?? "client"} talk=${share == null ? "-" : Math.round(share * 100) + "%"} q=${m.questions.total}/${m.questions.open} int=${m.interruptions ?? "-"} endedBy=${m.endedBy}`,
        );
        if (mode === "claude") {
          const persona = callPersona(call);
          if (!persona || !call.transcript?.length) {
            console.log(`${label} cannot score (no persona or empty transcript)`);
            skipped++;
            continue;
          }
          const s = await scoreCall(call.transcript, persona, call.repName);
          console.log(
            `  outcome=${s.outcome} opener=${s.opener} discovery=${s.discovery} objections=${s.objectionHandling} close=${s.close} overall=${s.overall} notAssessed=[${s.notAssessed}] tags=[${s.tags}]`,
          );
          for (const mo of s.moments) console.log(`  #${mo.turnIndex} ${mo.type}: ${mo.note}`);
        }
        updated++;
        continue;
      }

      // A refetched transcript has different turn indexes, so the judge's
      // key moments must be recomputed along with the metrics.
      if (mode === "claude" || mode === "refetch") {
        const status = await runScoring(call);
        console.log(`${label} → ${status}`);
        if (status === "failed") failed++;
        else updated++;
      } else {
        const m = await storeMetrics(call);
        console.log(`${label} metrics=ok endedBy=${m.endedBy} q=${m.questions.total}`);
        updated++;
      }
    } catch (err) {
      console.error(`${label} ERROR`, err);
      failed++;
    }
  }

  console.log(`\n${mode}${dryRun ? " (dry run)" : ""}: ${updated} updated, ${skipped} skipped, ${failed} failed`);
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
