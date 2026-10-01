import type { Call } from "@/db/schema";
import { APP_TIMEZONE } from "./format";
import { PERSONAS } from "./personas";
import { SKILL_TAGS, type Dimension, type SkillTag, type TagPolarity } from "./taxonomy";

// Pure aggregations over already-fetched rows. Data is small (hundreds of
// calls), so everything is TypeScript rather than SQL.

export type CallLite = Pick<
  Call,
  | "id"
  | "userId"
  | "repName"
  | "personaId"
  | "status"
  | "createdAt"
  | "scorecard"
  | "metrics"
  | "transcriptSource"
>;
export type ScoredCall = CallLite & { scorecard: NonNullable<CallLite["scorecard"]> };

export type ScoreKey = "overall" | "opener" | Dimension;

export const isScored = (c: CallLite): c is ScoredCall =>
  c.status === "scored" && c.scorecard != null;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Meetings booked or callbacks agreed, over scored calls. */
export function bookedRate(rows: CallLite[]) {
  const scored = rows.filter(isScored);
  const booked = scored.filter(
    (r) => r.scorecard.outcome === "meeting_booked" || r.scorecard.outcome === "callback_agreed",
  ).length;
  return { booked, scored: scored.length, rate: scored.length ? booked / scored.length : null };
}

/** Average of one score; calls where that dimension was notAssessed are excluded. */
export function dimensionAverage(rows: CallLite[], key: ScoreKey) {
  const xs = rows
    .filter(isScored)
    .filter((r) => !(r.scorecard.notAssessed ?? []).includes(key as Dimension))
    .map((r) => r.scorecard[key]);
  return { avg: mean(xs), n: xs.length };
}

/** Lowest average overall among personas with ≥3 scored calls. */
export function hardestPersona(rows: CallLite[]) {
  const byPersona = new Map<string, number[]>();
  for (const r of rows.filter(isScored)) {
    byPersona.set(r.personaId, [...(byPersona.get(r.personaId) ?? []), r.scorecard.overall]);
  }
  let best: { personaId: string; avg: number; n: number } | null = null;
  for (const p of PERSONAS) {
    const xs = byPersona.get(p.id);
    if (!xs || xs.length < 3) continue;
    const avg = mean(xs)!;
    if (!best || avg < best.avg || (avg === best.avg && xs.length > best.n)) {
      best = { personaId: p.id, avg, n: xs.length };
    }
  }
  return best;
}

/** Most frequent tag of a polarity; each call counts a tag once; ties in taxonomy order. */
export function topTag(rows: CallLite[], polarity: TagPolarity) {
  const scored = rows.filter(isScored);
  const counts = new Map<SkillTag, number>();
  for (const r of scored) {
    for (const t of new Set(r.scorecard.tags ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: { tag: SkillTag; count: number; n: number } | null = null;
  for (const t of SKILL_TAGS) {
    if (t.polarity !== polarity) continue;
    const count = counts.get(t.id) ?? 0;
    if (count > 0 && (!best || count > best.count)) best = { tag: t.id, count, n: scored.length };
  }
  return best;
}

/** Mean SDR talk share over ElevenLabs-transcribed calls only (client rows have no timings). */
export function talkShareAverage(rows: CallLite[]) {
  const xs = rows
    .filter((r) => r.transcriptSource === "elevenlabs" && r.metrics?.sdrTalkShare != null)
    .map((r) => r.metrics!.sdrTalkShare!);
  return { avg: mean(xs), n: xs.length };
}

/** YYYY-MM-DD of an instant in the app zone. */
export function dayKey(d: Date, tz: string = APP_TIMEZONE): string {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

/** Monday of the week containing `now`, as a day key. DST-safe: pure calendar arithmetic. */
export function weekStartKey(now: Date, tz: string = APP_TIMEZONE): string {
  const utc = new Date(`${dayKey(now, tz)}T00:00:00Z`);
  const back = (utc.getUTCDay() + 6) % 7; // Mon → 0 … Sun → 6
  utc.setUTCDate(utc.getUTCDate() - back);
  return utc.toISOString().slice(0, 10);
}

export function isThisWeek(d: Date, now: Date, tz: string = APP_TIMEZONE): boolean {
  return dayKey(d, tz) >= weekStartKey(now, tz);
}

export type RepStats = {
  userId: string;
  repName: string;
  thisWeek: number;
  allTime: number;
  avgOverall: number | null;
  booked: ReturnType<typeof bookedRate>;
  topMiss: ReturnType<typeof topTag>;
  lastCall: Date | null;
};

/** One row per known rep, including reps with no calls in the window. */
export function perRep(
  rows: CallLite[],
  reps: { userId: string; repName: string }[],
  now: Date,
): RepStats[] {
  return reps
    .map((rep) => {
      const mine = rows.filter((r) => r.userId === rep.userId);
      return {
        ...rep,
        thisWeek: mine.filter((r) => isThisWeek(r.createdAt, now)).length,
        allTime: mine.length,
        avgOverall: dimensionAverage(mine, "overall").avg,
        booked: bookedRate(mine),
        topMiss: topTag(mine, "negative"),
        lastCall: mine.reduce<Date | null>(
          (acc, r) => (acc && acc > r.createdAt ? acc : r.createdAt),
          null,
        ),
      };
    })
    .sort((a, b) => b.thisWeek - a.thisWeek || a.repName.localeCompare(b.repName));
}
