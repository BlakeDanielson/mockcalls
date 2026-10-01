import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { calls, type TranscriptEntry } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { toTranscript, waitForDone } from "@/lib/elevenlabs";
import { mapTerminationReason } from "@/lib/metrics";
import { runScoring } from "@/lib/run-scoring";
import { isUuid } from "@/lib/uuid";

const Body = z.object({
  transcript: z.array(
    z.object({
      role: z.enum(["user", "agent"]),
      message: z.string(),
      timeInCallSecs: z.number(),
      interrupted: z.boolean().optional(),
    }),
  ),
  durationSecs: z.number().int().nonnegative(),
  /** The browser's disconnect reason: who hung up, as far as the client can tell. */
  endedBy: z.enum(["user", "agent", "error"]).optional(),
});

// ElevenLabs polling (up to 15 s) plus the Claude judge run inside this request.
export const maxDuration = 120;

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/calls/[id]/end">,
) {
  const viewer = await apiUser();
  if (!viewer) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "not found" }, { status: 404 });

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "bad body" }, { status: 400 });
  }

  // Save what the browser heard right away so nothing is lost if the rest fails.
  // The `client:` prefix records that this reason came from the browser.
  const clientHint = body.data.endedBy ? `client:${body.data.endedBy}` : null;
  let transcript: TranscriptEntry[] = body.data.transcript;
  let transcriptSource: "client" | "elevenlabs" = "client";
  let durationSecs = body.data.durationSecs;
  let terminationReason: string | null = clientHint;

  // One atomic claim: only the request that moves the row from in_call to
  // ended goes on to fetch the transcript and score. A second submit (agent
  // hang-up racing the End button, or "Retry save" after a client timeout)
  // matches zero rows and just reports the current status. Only the owning
  // rep can end their call, and a call that never started has nothing to score.
  const db = getDb();
  const [call] = await db
    .update(calls)
    .set({
      transcript,
      transcriptSource,
      durationSecs,
      terminationReason,
      status: "ended",
      endedAt: new Date(),
    })
    .where(
      and(
        eq(calls.id, id),
        eq(calls.userId, viewer.userId),
        eq(calls.status, "in_call"),
      ),
    )
    .returning();

  if (!call) {
    const existing = await db.query.calls.findFirst({
      where: and(eq(calls.id, id), eq(calls.userId, viewer.userId)),
      columns: { status: true },
    });
    if (!existing) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    if (existing.status === "created") {
      return Response.json(
        { error: "this call was never started" },
        { status: 409 },
      );
    }
    return Response.json({ status: existing.status });
  }

  // Prefer ElevenLabs' own transcript (real timestamps, interruption flags,
  // nothing missed) once it has finished processing; keep the client copy if
  // it doesn't show up in time.
  if (call.elevenlabsConversationId) {
    const convo = await waitForDone(call.elevenlabsConversationId).catch(
      (err) => {
        console.error(`[end] call ${id}: transcript fetch failed`, err);
        return null;
      },
    );
    const serverTranscript = convo ? toTranscript(convo) : [];
    if (convo && serverTranscript.length > 0) {
      transcript = serverTranscript;
      transcriptSource = "elevenlabs";
      durationSecs = convo.metadata?.call_duration_secs ?? durationSecs;
      terminationReason = convo.metadata?.termination_reason ?? clientHint;
      console.log(
        `[end] call ${id} termination_reason=${terminationReason ?? "null"} endedBy=${mapTerminationReason(terminationReason)}`,
      );
      await db
        .update(calls)
        .set({ transcript, transcriptSource, durationSecs, terminationReason })
        .where(eq(calls.id, id));
    }
  }

  const status = await runScoring({
    ...call,
    transcript,
    transcriptSource,
    durationSecs,
    terminationReason,
  });
  return Response.json({ status });
}
