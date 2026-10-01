import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { rescoreCall } from "@/app/actions";
import { AudioPlayer } from "@/components/AudioPlayer";
import { MetricsStrip, MomentsTimeline } from "@/components/CallAnalytics";
import { DifficultyBadge } from "@/components/DifficultyBadge";
import { ScorecardView } from "@/components/ScorecardView";
import { ScoringPoller } from "@/components/ScoringPoller";
import { TranscriptView } from "@/components/TranscriptView";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { canSeeCall, requireUser } from "@/lib/auth";
import { formatClock, formatDate } from "@/lib/format";
import { getPersona } from "@/lib/personas";
import { STUCK_AFTER_SECS } from "@/lib/run-scoring";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";
// rescoreCall runs the judge inside this page's server action.
export const maxDuration = 120;

export default async function ResultsPage(
  props: PageProps<"/call/[id]/results">,
) {
  const viewer = await requireUser();
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const call = await getDb().query.calls.findFirst({
    where: eq(calls.id, id),
    extras: {
      // `ended` normally means "scoring in progress"; after STUCK_AFTER_SECS the
      // scoring request is gone and the rep needs a way to kick it again.
      stuck: sql<boolean>`${calls.status} = 'ended' and ${calls.endedAt} < now() - make_interval(secs => ${STUCK_AFTER_SECS})`.as(
        "stuck",
      ),
    },
  });
  if (!call || !canSeeCall(call, viewer)) notFound();
  const persona = getPersona(call.personaId);
  if (!persona) notFound();

  const unfinished = call.status === "created" || call.status === "in_call";
  const stuck = call.stuck === true;
  const transcript = call.transcript ?? [];
  const hasTranscript = transcript.length > 0;
  // A rep reads "You talked 72%"; a manager reading the same page sees the rep's name.
  const who = viewer.userId === call.userId ? "You" : call.repName.split(" ")[0];
  const them = persona.name.split(" ")[0];

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

      {call.elevenlabsConversationId && !unfinished && (
        <AudioPlayer callId={call.id} />
      )}

      {unfinished && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          This call never finished, so there&apos;s nothing to score.
        </p>
      )}

      {call.status === "ended" && !stuck && (
        <div className="flex items-center gap-3 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <span className="inline-block size-2 animate-pulse rounded-full bg-zinc-900 dark:bg-zinc-100" />
          Scoring your call… this usually takes under a minute.
          <ScoringPoller callId={call.id} />
        </div>
      )}

      {(call.status === "failed" || stuck) && (
        <form
          action={rescoreCall}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
        >
          <input type="hidden" name="id" value={call.id} />
          <span>
            {stuck ? "Scoring didn't finish" : "Scoring failed"}
            {!hasTranscript && " (empty transcript)"}.
          </span>
          {hasTranscript && call.userId === viewer.userId && (
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

      {call.metrics && (
        <MetricsStrip
          metrics={call.metrics}
          who={who}
          them={them}
          source={call.transcriptSource}
          terminationReason={call.terminationReason}
          durationSecs={call.durationSecs}
        />
      )}

      {call.status === "scored" && call.scorecard && (
        <MomentsTimeline
          moments={call.scorecard.moments ?? []}
          entries={transcript}
        />
      )}

      {hasTranscript && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Transcript</h2>
          <TranscriptView entries={transcript} />
        </section>
      )}
    </div>
  );
}
