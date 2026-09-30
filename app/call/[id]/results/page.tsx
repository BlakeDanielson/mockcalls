import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { rescoreCall } from "@/app/actions";
import { DifficultyBadge } from "@/components/DifficultyBadge";
import { ScorecardView } from "@/components/ScorecardView";
import { ScoringPoller } from "@/components/ScoringPoller";
import { TranscriptView } from "@/components/TranscriptView";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { formatClock, formatDate } from "@/lib/format";
import { getPersona } from "@/lib/personas";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

export default async function ResultsPage(
  props: PageProps<"/call/[id]/results">,
) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const call = await getDb().query.calls.findFirst({ where: eq(calls.id, id) });
  if (!call) notFound();
  const persona = getPersona(call.personaId);
  if (!persona) notFound();

  const unfinished = call.status === "created" || call.status === "in_call";
  const hasTranscript = (call.transcript?.length ?? 0) > 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {call.repName} × {persona.name}
            </h1>
            <DifficultyBadge level={persona.difficulty} />
          </div>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {persona.title}, {persona.company} · {formatDate(call.createdAt)}
            {call.durationSecs != null && ` · ${formatClock(call.durationSecs)}`}
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Call again
        </Link>
      </div>

      {unfinished && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          This call never finished, so there&apos;s nothing to score.
        </p>
      )}

      {call.status === "ended" && (
        <div className="flex items-center gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <span className="inline-block size-2 animate-pulse rounded-full bg-zinc-900 dark:bg-zinc-100" />
          Scoring your call… this usually takes under a minute.
          <ScoringPoller callId={call.id} />
        </div>
      )}

      {call.status === "failed" && (
        <form
          action={rescoreCall}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
          <input type="hidden" name="id" value={call.id} />
          <span>Scoring failed{!hasTranscript && " (empty transcript)"}.</span>
          {hasTranscript && (
            <button
              type="submit"
              className="rounded-md bg-red-700 px-3 py-1.5 font-medium text-white hover:bg-red-600"
            >
              Try scoring again
            </button>
          )}
        </form>
      )}

      {call.status === "scored" && call.scorecard && (
        <ScorecardView scorecard={call.scorecard} />
      )}

      {hasTranscript && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Transcript</h2>
          <TranscriptView entries={call.transcript!} />
        </section>
      )}
    </div>
  );
}
