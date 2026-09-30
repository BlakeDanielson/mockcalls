import type { Scorecard } from "@/lib/scoring";

type Outcome = Scorecard["outcome"];

const OUTCOME_LABELS: Record<Outcome, string> = {
  meeting_booked: "Meeting booked",
  callback_agreed: "Callback agreed",
  info_requested: "Info requested",
  rejected: "Rejected",
  hung_up: "Hung up",
  unclear: "Unclear",
};

const OUTCOME_STYLES: Record<Outcome, string> = {
  meeting_booked:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  callback_agreed:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  info_requested:
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
  hung_up: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
  unclear: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100",
};

export function outcomeLabel(outcome: Outcome): string {
  return OUTCOME_LABELS[outcome] ?? outcome;
}

function scoreColor(n: number): string {
  if (n >= 8) return "text-emerald-600 dark:text-emerald-400";
  if (n >= 5) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

const SCORE_ROWS: {
  key: "opener" | "discovery" | "objectionHandling" | "close";
  label: string;
}[] = [
  { key: "opener", label: "Opener" },
  { key: "discovery", label: "Discovery" },
  { key: "objectionHandling", label: "Objections" },
  { key: "close", label: "Close" },
];

function List({
  title,
  items,
  dot,
}: {
  title: string;
  items: string[];
  dot: string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      <ul className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScorecardView({ scorecard: s }: { scorecard: Scorecard }) {
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-5xl font-semibold tabular-nums">
          <span className={scoreColor(s.overall)}>{s.overall}</span>
          <span className="text-xl text-zinc-400">/10</span>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${OUTCOME_STYLES[s.outcome]}`}
        >
          {outcomeLabel(s.outcome)}
        </span>
        <p className="basis-full text-zinc-700 dark:text-zinc-300">{s.summary}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SCORE_ROWS.map((r) => (
          <div
            key={r.key}
            className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <div className="text-xs uppercase tracking-wide text-zinc-500">
              {r.label}
            </div>
            <div
              className={`text-2xl font-semibold tabular-nums ${scoreColor(s[r.key])}`}
            >
              {s[r.key]}
              <span className="text-sm text-zinc-400">/10</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border-l-4 border-zinc-900 bg-zinc-50 p-4 dark:border-zinc-100 dark:bg-zinc-900">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Next call, try this
        </div>
        <p className="mt-1 font-medium">{s.coachingTip}</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <List title="What worked" items={s.strengths} dot="bg-emerald-500" />
        <List title="What to fix" items={s.improvements} dot="bg-amber-500" />
      </div>
    </section>
  );
}
