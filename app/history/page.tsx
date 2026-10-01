import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { outcomeLabel } from "@/components/ScorecardView";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatClock, formatDate } from "@/lib/format";
import { getPersona } from "@/lib/personas";

export const dynamic = "force-dynamic";

export default async function HistoryPage(props: PageProps<"/history">) {
  const viewer = await requireUser();
  const sp = await props.searchParams;
  const repFilter =
    viewer.isManager && typeof sp.rep === "string" && sp.rep ? sp.rep : null;

  const db = getDb();
  const scope = viewer.isManager
    ? repFilter
      ? eq(calls.userId, repFilter)
      : undefined
    : eq(calls.userId, viewer.userId);

  const [rows, repRows] = await Promise.all([
    db.select().from(calls).where(scope).orderBy(desc(calls.createdAt)).limit(200),
    viewer.isManager
      ? // one chip per rep, labelled with their most recent display name
        db
          .selectDistinctOn([calls.userId], {
            userId: calls.userId,
            repName: calls.repName,
          })
          .from(calls)
          .orderBy(calls.userId, desc(calls.createdAt))
      : Promise.resolve([]),
  ]);
  const reps = [...repRows].sort((a, b) => a.repName.localeCompare(b.repName));

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${
      active
        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
        : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
    }`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {viewer.isManager ? "Team call history" : "Your call history"}
      </h1>

      {viewer.isManager && reps.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link href="/history" className={chip(!repFilter)}>
            Everyone
          </Link>
          {reps.map((r) => (
            <Link
              key={r.userId}
              href={`/history?rep=${encodeURIComponent(r.userId)}`}
              className={chip(repFilter === r.userId)}
            >
              {r.repName}
            </Link>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          {viewer.isManager ? (
            repFilter ? "No calls from this rep yet." : "No team calls yet."
          ) : (
            <>
              No calls yet.{" "}
              <Link href="/" className="underline">
                Make the first one.
              </Link>
            </>
          )}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">When</th>
                {viewer.isManager && <th className="px-3 py-2">Rep</th>}
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
                    {viewer.isManager && (
                      <td className="px-3 py-2">{c.repName}</td>
                    )}
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
