// Score transcript fixtures with the judge and check expectations, without a
// database. Needs only ANTHROPIC_API_KEY (and ANTHROPIC_WORKSPACE_ID if the
// key is not workspace-scoped).
//
//   pnpm judge fixtures/judge/*.json            score every fixture once
//   pnpm judge --runs 3 fixtures/judge/cfo-hiring-freeze.json
//
// Fixture shape: { personaId, repName, transcript: TranscriptEntry[], expect?: {
//   outcome?: string[]; tagsInclude?: string[]; tagsExclude?: string[];
//   min?: Record<ScoreKey, number>; max?: Record<ScoreKey, number>;
//   requireText?: string[]; forbidText?: string[] } }
// requireText/forbidText are case-insensitive substrings searched across
// coachingTip, improvements, strengths and summary.
try {
  process.loadEnvFile(".env.local");
} catch {
  // ambient env
}

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { TranscriptEntry } from "@/db/schema";
import { computeMetrics } from "@/lib/metrics";
import { getPersona } from "@/lib/personas";
import { scoreCall, type Scorecard } from "@/lib/scoring";

type ScoreKey = "opener" | "discovery" | "objectionHandling" | "close" | "overall";
type Fixture = {
  personaId: string;
  repName: string;
  transcript: TranscriptEntry[];
  expect?: {
    outcome?: string[];
    tagsInclude?: string[];
    tagsExclude?: string[];
    min?: Partial<Record<ScoreKey, number>>;
    max?: Partial<Record<ScoreKey, number>>;
    requireText?: string[];
    forbidText?: string[];
  };
};

const { values: flags, positionals } = parseArgs({
  options: { runs: { type: "string", default: "1" } },
  allowPositionals: true,
});
const runs = Math.max(1, Number(flags.runs) || 1);

function check(s: Scorecard, fx: Fixture): string[] {
  const e = fx.expect ?? {};
  const problems: string[] = [];
  if (e.outcome && !e.outcome.includes(s.outcome)) {
    problems.push(`outcome ${s.outcome} not in [${e.outcome}]`);
  }
  for (const t of e.tagsInclude ?? []) {
    if (!(s.tags as string[]).includes(t)) problems.push(`missing tag ${t}`);
  }
  for (const t of e.tagsExclude ?? []) {
    if ((s.tags as string[]).includes(t)) problems.push(`unexpected tag ${t}`);
  }
  for (const [k, v] of Object.entries(e.min ?? {})) {
    if (s[k as ScoreKey] < v) problems.push(`${k} ${s[k as ScoreKey]} < ${v}`);
  }
  for (const [k, v] of Object.entries(e.max ?? {})) {
    if (s[k as ScoreKey] > v) problems.push(`${k} ${s[k as ScoreKey]} > ${v}`);
  }
  const text = [s.coachingTip, ...s.improvements, ...s.strengths, s.summary]
    .join("\n")
    .toLowerCase();
  for (const t of e.requireText ?? []) {
    if (!text.includes(t.toLowerCase())) problems.push(`coaching lacks "${t}"`);
  }
  for (const t of e.forbidText ?? []) {
    if (text.includes(t.toLowerCase())) problems.push(`coaching contains "${t}"`);
  }
  return problems;
}

async function main() {
  if (positionals.length === 0) {
    console.error("usage: pnpm judge [--runs N] <fixture.json> [...]");
    return 2;
  }
  let failures = 0;
  for (const path of positionals) {
    const fx = JSON.parse(readFileSync(path, "utf8")) as Fixture;
    const persona = getPersona(fx.personaId);
    if (!persona) {
      console.error(`${path}: unknown persona ${fx.personaId}`);
      failures++;
      continue;
    }
    const m = computeMetrics({
      transcript: fx.transcript,
      durationSecs: fx.transcript.at(-1)?.timeInCallSecs ?? null,
      terminationReason: null,
      source: "client",
    });
    console.log(
      `\n=== ${path} (${persona.name}, rep ${fx.repName}) turns=${fx.transcript.length} q=${m.questions.total}/${m.questions.open} wordShare=${m.sdrWordShare == null ? "-" : Math.round(m.sdrWordShare * 100) + "%"}`,
    );
    for (let r = 1; r <= runs; r++) {
      const started = Date.now();
      const s = await scoreCall(fx.transcript, persona, fx.repName);
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(
        `run ${r}/${runs} (${secs}s): outcome=${s.outcome} opener=${s.opener} discovery=${s.discovery} objections=${s.objectionHandling} close=${s.close} overall=${s.overall} notAssessed=[${s.notAssessed}]`,
      );
      console.log(`  tags: ${s.tags.join(", ") || "(none)"}`);
      for (const mo of s.moments) console.log(`  #${mo.turnIndex} ${mo.type}: ${mo.note}`);
      console.log(`  tip: ${s.coachingTip}`);
      for (const i of s.improvements) console.log(`  fix: ${i}`);
      const problems = check(s, fx);
      if (problems.length) {
        failures++;
        console.log(`  FAIL: ${problems.join("; ")}`);
      } else {
        console.log("  ok");
      }
    }
  }
  console.log(`\n${failures ? `${failures} failing run(s)` : "all runs passed"}`);
  return failures ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
