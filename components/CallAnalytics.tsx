import type { TranscriptEntry } from "@/db/schema";
import { formatClock } from "@/lib/format";
import { SDR_TALK_TARGET, type CallMetrics } from "@/lib/metrics";
import { MOMENT_LABELS, type Moment } from "@/lib/taxonomy";
import { TILE_CLASS } from "./ScorecardView";

type Tone = "good" | "ok" | "bad" | "neutral";
const TONE: Record<Tone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  ok: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
  neutral: "text-zinc-900 dark:text-zinc-100",
};

function Tile({
  label,
  value,
  tone = "neutral",
  caption,
  title,
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  caption?: React.ReactNode;
  title?: string;
}) {
  return (
    <div className={TILE_CLASS} title={title}>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${TONE[tone]}`}>{value}</div>
      {caption && (
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{caption}</div>
      )}
    </div>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/**
 * Deterministic numbers for one call. `who` is "You" for the rep or the rep's
 * first name for a manager; `them` is the persona's first name.
 */
export function MetricsStrip({
  metrics: m,
  who,
  them,
  source,
  terminationReason,
  durationSecs,
}: {
  metrics: CallMetrics;
  who: string;
  them: string;
  source: "client" | "elevenlabs" | null;
  terminationReason: string | null;
  durationSecs: number | null;
}) {
  const timed = source === "elevenlabs";
  const share = timed ? m.sdrTalkShare : m.sdrWordShare;
  const shareTone: Tone =
    share == null ? "neutral" : share <= SDR_TALK_TARGET ? "good" : share <= 0.6 ? "ok" : "bad";
  const fill = { good: "bg-emerald-500", ok: "bg-amber-500", bad: "bg-red-500", neutral: "bg-zinc-400" }[shareTone];

  const q = m.questions;
  const qTone: Tone = q.open >= 2 ? "good" : q.open === 1 ? "ok" : "bad";
  const approx = timed ? "" : "≈";

  const intTone: Tone =
    m.interruptions == null ? "neutral" : m.interruptions === 0 ? "good" : m.interruptions <= 2 ? "ok" : "bad";

  const mono = m.longestMonologue;
  const monoTone: Tone = !mono
    ? "neutral"
    : mono.secs != null
      ? mono.secs < 25 ? "good" : mono.secs <= 45 ? "ok" : "bad"
      : mono.words < 40 ? "good" : mono.words <= 80 ? "ok" : "bad";

  const ended = {
    sdr: `${who} ended the call`,
    prospect: `${them} ended the call`,
    timeout: "Timed out",
    unknown: "Unclear",
  }[m.endedBy];

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">By the numbers</h2>

      <div className={TILE_CLASS}>
        <div className="flex items-baseline justify-between">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Talk ratio</div>
          <div className="text-xs text-zinc-500">≤{Math.round(SDR_TALK_TARGET * 100)}% target</div>
        </div>
        <div className="relative mt-2 h-3 rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="absolute inset-y-0 left-0 rounded-l-full border-r border-emerald-500/60 bg-emerald-500/15"
            style={{ width: pct(SDR_TALK_TARGET) }}
          />
          {share != null && (
            <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: pct(share) }} />
          )}
        </div>
        <div className={`mt-2 text-sm ${TONE[shareTone]}`}>
          {share == null
            ? "—"
            : timed
              ? `${who} talked ${pct(share)} of the time (est.) · ${pct(m.sdrWordShare ?? 0)} of the words`
              : `${who} said ${pct(share)} of the words (browser transcript; timings unavailable)`}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile
          label="Questions"
          value={`${q.total} asked · ${q.open} open`}
          tone={qTone}
          caption={
            m.firstQuestionAtSecs == null
              ? "No questions asked"
              : m.firstOpenQuestionAtSecs == null
                ? `First question ${approx}${formatClock(m.firstQuestionAtSecs)} · no open questions`
                : `First question ${approx}${formatClock(m.firstQuestionAtSecs)} · first open ${approx}${formatClock(m.firstOpenQuestionAtSecs)}`
          }
        />
        <Tile
          label="Interruptions"
          value={m.interruptions ?? "—"}
          tone={intTone}
          caption={
            m.interruptions == null
              ? "n/a on this recording"
              : m.interruptions === 0
                ? `${who} let ${them} finish every time`
                : `${who} cut ${them} off ${times(m.interruptions)}${timed ? "" : " (approximate)"}`
          }
        />
        <Tile
          label="Longest monologue"
          value={mono ? (mono.secs != null ? `${mono.words} words · ~${Math.round(mono.secs)} s` : `${mono.words} words`) : "—"}
          tone={monoTone}
          caption={mono ? <a href={`#turn-${mono.turnIndex}`} className="underline">Jump to it</a> : undefined}
        />
        <Tile
          label="Pace"
          value={m.sdrWpm != null ? `${m.sdrWpm} wpm` : "—"}
          caption={m.sdrWpm != null ? "estimated" : undefined}
        />
        <Tile
          label="Who hung up"
          value={<span className="text-base">{ended}</span>}
          caption={durationSecs != null ? `at ${formatClock(durationSecs)}` : undefined}
          title={terminationReason ?? ""}
        />
        <Tile
          label="Turns"
          value={`${m.turns.sdr} · ${m.turns.prospect}`}
          caption={`${who} · ${them}`}
        />
      </div>
    </section>
  );
}

const MOMENT_PILL: Partial<Record<Moment["type"], string>> = {
  hang_up: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
  best_question: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
};

/** Clickable key moments; each links to its transcript turn. */
export function MomentsTimeline({
  moments,
  entries,
}: {
  moments: Moment[];
  entries: TranscriptEntry[];
}) {
  const rows = moments.filter((m) => entries[m.turnIndex]);
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Key moments</h2>
      <ol className="space-y-2">
        {rows.map((m, i) => {
          const e = entries[m.turnIndex];
          const quote = e.message.length > 90 ? `${e.message.slice(0, 90)}…` : e.message;
          return (
            <li key={i}>
              <a
                href={`#turn-${m.turnIndex}`}
                className="block rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-zinc-400">{formatClock(e.timeInCallSecs)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      MOMENT_PILL[m.type] ?? "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                    }`}
                  >
                    {MOMENT_LABELS[m.type]}
                  </span>
                  <span className="text-zinc-500">{e.role === "user" ? "You" : "Prospect"}</span>
                </div>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">“{quote}”</p>
                <p className="mt-1 text-sm">{m.note}</p>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
