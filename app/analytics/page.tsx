import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import Link from "next/link";
import { DifficultyBadge } from "@/components/DifficultyBadge";
import { SCORE_ROWS, TILE_CLASS, outcomeLabel, scoreColor } from "@/components/ScorecardView";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import {
  bookedRate,
  dimensionAverage,
  hardestPersona,
  isScored,
  isThisWeek,
  perRep,
  talkShareAverage,
  topTag,
  weekStartKey,
  type ScoreKey,
} from "@/lib/analytics";
import { requireUser } from "@/lib/auth";
import { APP_TIMEZONE, formatClock, formatDate } from "@/lib/format";
import { SDR_TALK_TARGET, TREND_N } from "@/lib/metrics";
import { PERSONAS, getPersona } from "@/lib/personas";
import { tagMeta } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

const fmt1 = (n: number | null) => (n == null ? "—" : n.toFixed(1));
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

/** Tiny server-rendered trend line, 1–10 scale, dashed reference at 7. Null = gap. */
function Sparkline({ values }: { values: (number | null)[] }) {
  const w = 100;
  const h = 30;
  const n = Math.max(values.length - 1, 1);
  const x = (i: number) => (i / n) * w;
  const y = (v: number) => h - ((v - 1) / 9) * h;
  const segs: string[][] = [[]];
  values.forEach((v, i) => (v == null ? segs.push([]) : segs.at(-1)!.push(`${x(i)},${y(v)}`)));
  const ref = y(7);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 h-8 w-full">
      <line x1="0" x2={w} y1={ref} y2={ref} stroke="currentColor" strokeDasharray="2 2" strokeWidth="0.5" className="text-zinc-400" />
      {segs
        .filter((s) => s.length)
        .map((s, k) =>
          s.length === 1 ? (
            <circle key={k} cx={s[0].split(",")[0]} cy={s[0].split(",")[1]} r="1.5" fill="currentColor" className="text-zinc-900 dark:text-zinc-100" />
          ) : (
            <polyline key={k} points={s.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="text-zinc-900 dark:text-zinc-100" />
          ),
        )}
    </svg>
  );
}

function Tile({ label, value, caption }: { label: string; value: React.ReactNode; caption?: React.ReactNode }) {
  return (
    <div className={TILE_CLASS}>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {caption && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{caption}</div>}
    </div>
  );
}

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${
    active
      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
      : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
  }`;

export default async function AnalyticsPage(props: PageProps<"/analytics">) {
  const viewer = await requireUser();
  const sp = await props.searchParams;
  const personaId = typeof sp.persona === "string" && getPersona(sp.persona) ? sp.persona : null;
  const now = new Date();
  const db = getDb();

  const [rows, reps] = await Promise.all([
    db
      .select({
        id: calls.id,
        userId: calls.userId,
        repName: calls.repName,
        personaId: calls.personaId,
        customPersonaName: sql<string | null>`${calls.customPersona}->>'name'`,
        status: calls.status,
        createdAt: calls.createdAt,
        scorecard: calls.scorecard,
        metrics: calls.metrics,
        transcriptSource: calls.transcriptSource,
        durationSecs: calls.durationSecs,
      })
      .from(calls)
      // Reps are always scoped to themselves; managers see every finished call.
      .where(and(isNotNull(calls.endedAt), viewer.isManager ? undefined : eq(calls.userId, viewer.userId)))
      .orderBy(desc(calls.createdAt))
      .limit(1000),
    viewer.isManager
      ? db
          .selectDistinctOn([calls.userId], { userId: calls.userId, repName: calls.repName })
          .from(calls)
          .orderBy(calls.userId, desc(calls.createdAt))
      : Promise.resolve([]),
  ]);

  const requestedRep = typeof sp.rep === "string" ? sp.rep : null;
  const repId = viewer.isManager
    ? requestedRep && reps.some((r) => r.userId === requestedRep)
      ? requestedRep
      : null
    : viewer.userId;
  const repName = repId
    ? (reps.find((r) => r.userId === repId)?.repName ?? rows.find((r) => r.userId === repId)?.repName ?? "this rep")
    : null;
  const who = repId === viewer.userId ? "You" : (repName?.split(" ")[0] ?? "");

  const query = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = { rep: viewer.isManager ? repId : null, persona: personaId, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return `/analytics${s ? `?${s}` : ""}`;
  };

  // Trend series: the rep's last N scored calls, oldest → newest.
  const trendRows = repId
    ? rows
        .filter((r) => isScored(r) && r.userId === repId && (!personaId || r.personaId === personaId))
        .slice(0, TREND_N)
        .reverse()
    : [];
  const historyHref = viewer.isManager && repId ? `/history?rep=${encodeURIComponent(repId)}` : "/history";
  const series = (key: ScoreKey) =>
    trendRows.map((r) =>
      isScored(r) && !(r.scorecard.notAssessed ?? []).includes(key as never) ? r.scorecard[key] : null,
    );
  const trendBooked = bookedRate(trendRows);
  const trendTalk = talkShareAverage(trendRows);
  const trendMiss = topTag(trendRows, "negative");
  const trendStrength = topTag(trendRows, "positive");

  // Team section inputs (managers).
  const teamWeek = rows.filter((r) => isThisWeek(r.createdAt, now));
  const teamOverall = dimensionAverage(rows, "overall");
  const teamBooked = bookedRate(rows);
  const hardest = hardestPersona(rows);
  const teamMiss = topTag(rows, "negative");
  const teamStrength = topTag(rows, "positive");
  const repStats = viewer.isManager ? perRep(rows, reps, now) : [];
  const weekLabel = new Date(`${weekStartKey(now)}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="space-y-10">
      {viewer.isManager && (
        <section className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
            <p className="text-sm text-zinc-500">
              Week of Mon {weekLabel} ({APP_TIMEZONE}) · quality numbers are all time
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile
              label="Calls this week"
              value={teamWeek.length}
              caption={`${new Set(teamWeek.map((r) => r.userId)).size} reps active`}
            />
            <Tile label="Avg overall" value={fmt1(teamOverall.avg)} caption={`${teamOverall.n} scored calls`} />
            <Tile
              label="Meetings booked"
              value={pct(teamBooked.rate)}
              caption={`${teamBooked.booked} of ${teamBooked.scored} scored`}
            />
            <Tile
              label="Hardest persona"
              value={
                hardest ? (
                  <span className="flex items-center gap-2 text-base">
                    {getPersona(hardest.personaId)?.name.split(" ")[0]}
                    <DifficultyBadge level={getPersona(hardest.personaId)!.difficulty} />
                  </span>
                ) : (
                  <span className="text-sm text-zinc-400">Not enough calls</span>
                )
              }
              caption={hardest ? `avg ${hardest.avg.toFixed(1)} over ${hardest.n}` : "3 per persona needed"}
            />
            <Tile
              label="Most common miss"
              value={<span className="text-base">{teamMiss ? tagMeta(teamMiss.tag).label : "—"}</span>}
              caption={
                teamMiss
                  ? `in ${teamMiss.count} of ${teamMiss.n} calls${teamStrength ? ` · strength: ${tagMeta(teamStrength.tag).label}` : ""}`
                  : undefined
              }
            />
          </div>

          {repStats.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">No calls yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                  <tr>
                    <th className="px-3 py-2">Rep</th>
                    <th className="px-3 py-2 text-right">This week</th>
                    <th className="px-3 py-2 text-right">All time</th>
                    <th className="px-3 py-2">Avg overall</th>
                    <th className="px-3 py-2 text-right">Booked</th>
                    <th className="px-3 py-2">Top miss</th>
                    <th className="px-3 py-2">Last call</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {repStats.map((r) => (
                    <tr key={r.userId} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="px-3 py-2">
                        <Link href={query({ rep: r.userId })} className={`underline-offset-2 hover:underline ${r.userId === repId ? "font-semibold" : ""}`}>
                          {r.repName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.thisWeek}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.allTime}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`w-8 tabular-nums ${r.avgOverall != null ? scoreColor(r.avgOverall) : ""}`}>{fmt1(r.avgOverall)}</span>
                          <div className="h-1.5 w-20 rounded-full bg-zinc-200 dark:bg-zinc-800">
                            {r.avgOverall != null && (
                              <div className="h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${(r.avgOverall / 10) * 100}%` }} />
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(r.booked.rate)}</td>
                      <td className="px-3 py-2">{r.topMiss ? tagMeta(r.topMiss.tag).label : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.lastCall ? formatDate(r.lastCall) : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-right">
                        <Link href={`/history?rep=${encodeURIComponent(r.userId)}`} className="text-zinc-500 underline-offset-2 hover:underline">
                          View calls
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {viewer.isManager ? (repName ? `${repName}'s trends` : "Trends") : "Your trends"}
          </h2>
          <p className="text-sm text-zinc-500">Last {TREND_N} scored calls, oldest to newest · dashed line is 7, a solid call</p>
        </div>

        {viewer.isManager && !repId ? (
          <p className="text-zinc-600 dark:text-zinc-400">Pick a rep above to see their trends.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Link href={query({ persona: null })} className={chip(!personaId)}>
                All personas
              </Link>
              {PERSONAS.map((p) => (
                <Link key={p.id} href={query({ persona: p.id })} className={chip(personaId === p.id)}>
                  {p.name.split(" ")[0]}
                </Link>
              ))}
            </div>

            {trendRows.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-400">
                {repId === viewer.userId ? (
                  <>
                    Score a few calls and your trends show up here.{" "}
                    <Link href="/" className="underline">
                      Make a call.
                    </Link>
                  </>
                ) : (
                  <>
                    No scored calls for {repName} yet.{" "}
                    <Link href="/analytics" className="underline">
                      Back to the team.
                    </Link>
                  </>
                )}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {(
                    [{ key: "overall" as const, label: "Overall" }, ...SCORE_ROWS] as { key: ScoreKey; label: string }[]
                  ).map(({ key, label }) => {
                    const values = series(key);
                    const latest = values.at(-1) ?? null;
                    const { avg, n } = dimensionAverage(trendRows, key);
                    return (
                      <div key={key} className={TILE_CLASS}>
                        <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
                        <div className={`text-2xl font-semibold tabular-nums ${latest == null ? "text-zinc-400" : scoreColor(latest)}`}>
                          {latest ?? "n/a"}
                        </div>
                        <div className="text-xs text-zinc-500">avg {fmt1(avg)} over {n}</div>
                        <Sparkline values={values} />
                      </div>
                    );
                  })}
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Booked {trendBooked.booked} of {trendBooked.scored}
                  {trendTalk.n > 0 &&
                    ` · ${who} talked ~${pct(trendTalk.avg)} of the time on average over ${trendTalk.n} ElevenLabs-transcribed calls (target ≤${Math.round(SDR_TALK_TARGET * 100)}%)`}
                  {(trendMiss || trendStrength) && (
                    <>
                      <br />
                      {trendMiss && `Most common miss: ${tagMeta(trendMiss.tag).label} (${trendMiss.count} of ${trendMiss.n})`}
                      {trendMiss && trendStrength && " · "}
                      {trendStrength && `Most common strength: ${tagMeta(trendStrength.tag).label} (${trendStrength.count} of ${trendStrength.n})`}
                    </>
                  )}
                </p>

                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-sm font-medium">Calls behind these numbers</h3>
                    <Link href={historyHref} className="text-sm text-zinc-500 underline-offset-2 hover:underline">
                      All calls in History
                    </Link>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                        <tr>
                          <th className="px-3 py-2">When</th>
                          <th className="px-3 py-2">Prospect</th>
                          <th className="px-3 py-2">Length</th>
                          <th className="px-3 py-2">Outcome</th>
                          <th className="px-3 py-2 text-right">Overall</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {[...trendRows].reverse().map((c) => {
                          if (!isScored(c)) return null;
                          const persona = getPersona(c.personaId);
                          return (
                            <tr key={c.id} className="border-t border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
                              <td className="px-3 py-2 whitespace-nowrap">
                                <Link href={`/call/${c.id}/results`} className="underline-offset-2 hover:underline">
                                  {formatDate(c.createdAt)}
                                </Link>
                              </td>
                              <td className="px-3 py-2">{persona?.name ?? c.customPersonaName ?? c.personaId}</td>
                              <td className="px-3 py-2 tabular-nums">{c.durationSecs != null ? formatClock(c.durationSecs) : "—"}</td>
                              <td className="px-3 py-2">{outcomeLabel(c.scorecard.outcome)}</td>
                              <td className={`px-3 py-2 text-right font-medium tabular-nums ${scoreColor(c.scorecard.overall)}`}>
                                {c.scorecard.overall}/10
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap text-right">
                                <Link href={`/call/${c.id}/results`} className="text-zinc-500 underline-offset-2 hover:underline">
                                  Transcript &amp; recording
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
