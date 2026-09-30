import type { TranscriptEntry } from "@/db/schema";
import { formatClock } from "@/lib/format";

export function TranscriptView({ entries }: { entries: TranscriptEntry[] }) {
  return (
    <ol className="space-y-2">
      {entries.map((e, i) => {
        const mine = e.role === "user";
        return (
          <li key={i} className="flex gap-3 text-sm">
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
              </span>
              {e.message}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
