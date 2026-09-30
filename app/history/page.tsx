import { desc } from "drizzle-orm";
import Link from "next/link";
import { outcomeLabel } from "@/components/ScorecardView";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { formatClock, formatDate } from "@/lib/format";
import { getPersona } from "@/lib/personas";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const rows = await getDb()
    .select()
    .from(calls)
    .orderBy(desc(calls.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Call history</h1>
      {rows.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No calls yet.{" "}
          <Link href="/" className="underline">
            Make the first one.
          </Link>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Rep</th>
                <th className="px-3 py-2">Prospect</th>
                <th className="px-3 py-2">Length</th>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2 text-right">Overall</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const persona = getPersona(c.personaId);
                return (
                  <tr
                    key={c.id}
                    className="border-t border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/call/${c.id}/results`}
                        className="underline-offset-2 hover:underline"
                      >
                        {formatDate(c.createdAt)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{c.repName}</td>
                    <td className="px-3 py-2">{persona?.name ?? c.personaId}</td>
                    <td className="px-3 py-2">
                      {c.durationSecs != null ? formatClock(c.durationSecs) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {c.scorecard
                        ? outcomeLabel(c.scorecard.outcome)
                        : c.status.replace("_", " ")}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {c.scorecard ? `${c.scorecard.overall}/10` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
