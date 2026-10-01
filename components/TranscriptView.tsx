import type { TranscriptEntry } from "@/db/schema";
import { formatClock } from "@/lib/format";

/**
 * Each turn is addressable as #turn-N (N = array index, the same number the
 * judge cites). Hash navigation + Tailwind's `target:` variant give
 * scroll-and-highlight with no JavaScript.
 */
export function TranscriptView({ entries }: { entries: TranscriptEntry[] }) {
  return (
    <ol className="space-y-2">
      {entries.map((e, i) => {
        const mine = e.role === "user";
        return (
          <li
            key={i}
            id={`turn-${i}`}
            className="flex scroll-mt-24 gap-3 rounded-lg text-sm target:ring-2 target:ring-amber-400 target:ring-offset-2 dark:target:ring-offset-zinc-950"
          >
            <span className="w-12 shrink-0 pt-2 font-mono text-xs text-zinc-400">
              {formatClock(e.timeInCallSecs)}
            </span>
            <div
              className={`rounded-lg px-3 py-2 ${
                mine
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 dark:bg-zinc-800"
              }`}
            >
              <span className="block text-[10px] uppercase tracking-wide opacity-60">
                {mine ? "You" : "Prospect"}
                {!mine && e.interrupted && (
                  <span className="ml-1 normal-case">(cut off)</span>
                )}
              </span>
              {e.message}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
