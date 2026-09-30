import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { calls, type TranscriptEntry } from "@/db/schema";
import { waitForDone } from "@/lib/elevenlabs";
import { runScoring } from "@/lib/run-scoring";
import { isUuid } from "@/lib/uuid";

const Body = z.object({
  transcript: z.array(
    z.object({
      role: z.enum(["user", "agent"]),
      message: z.string(),
      timeInCallSecs: z.number(),
    }),
  ),
  durationSecs: z.number().int().nonnegative(),
});

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/calls/[id]/end">,
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "not found" }, { status: 404 });

  const db = getDb();
  const call = await db.query.calls.findFirst({ where: eq(calls.id, id) });
  if (!call) return Response.json({ error: "not found" }, { status: 404 });
  // Idempotent: a second submit (agent hang-up racing the End button) is a no-op.
  if (call.status === "scored" || call.status === "failed") {
    return Response.json({ status: call.status });
  }

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "bad body" }, { status: 400 });
  }

  // Save what the browser heard right away so nothing is lost if the rest fails.
  let transcript: TranscriptEntry[] = body.data.transcript;
  let durationSecs = body.data.durationSecs;
  await db
    .update(calls)
    .set({
      transcript,
      transcriptSource: "client",
      durationSecs,
      status: "ended",
      endedAt: new Date(),
    })
    .where(eq(calls.id, id));

  // Prefer ElevenLabs' own transcript (real timestamps, nothing missed) once
  // it has finished processing; keep the client copy if it doesn't show up.
  if (call.elevenlabsConversationId) {
    const convo = await waitForDone(call.elevenlabsConversationId).catch(
      (err) => {
        console.error(`[end] call ${id}: transcript fetch failed`, err);
        return null;
      },
    );
    const serverTranscript: TranscriptEntry[] =
      convo?.transcript
        .filter((t) => t.message?.trim())
        .map((t) => ({
          role: t.role,
          message: t.message!.trim(),
          timeInCallSecs: t.time_in_call_secs,
        })) ?? [];
    if (serverTranscript.length > 0) {
      transcript = serverTranscript;
      durationSecs = convo?.metadata?.call_duration_secs ?? durationSecs;
      await db
        .update(calls)
        .set({ transcript, transcriptSource: "elevenlabs", durationSecs })
        .where(eq(calls.id, id));
    }
  }

  const status = await runScoring({ ...call, transcript, durationSecs });
  return Response.json({ status });
}
