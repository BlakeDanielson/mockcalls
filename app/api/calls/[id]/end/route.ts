import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { calls, type TranscriptEntry } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { computeMetrics } from "@/lib/metrics";
import { finalizeCall } from "@/lib/run-scoring";
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
  const transcript: TranscriptEntry[] = body.data.transcript;
  const durationSecs = body.data.durationSecs;

  // One atomic claim: only the request that moves the row from in_call to
  // ended goes on to finalize and score. A second submit (agent hang-up racing
  // the End button, or "Retry save" after a client timeout) matches zero rows
  // and just reports the current status. Only the owning rep can end their
  // call, and a call that never started has nothing to score. Client-source
  // metrics are written in the same statement so "By the numbers" renders
  // while the judge is still running.
  const db = getDb();
  const [call] = await db
    .update(calls)
    .set({
      transcript,
      transcriptSource: "client",
      durationSecs,
      terminationReason: clientHint,
      metrics: computeMetrics({
        transcript,
        durationSecs,
        terminationReason: clientHint,
        source: "client",
      }),
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

  // A one-sided client transcript is the signature of the onMessage dedupe
  // bug; keep it visible in the logs.
  const userLines = transcript.filter((e) => e.role === "user").length;
  const agentLines = transcript.filter((e) => e.role === "agent").length;
  const line = `[end] call ${id} client transcript user=${userLines} agent=${agentLines} duration=${durationSecs}s endedBy=${clientHint ?? "null"}`;
  if (agentLines === 0 && userLines >= 3) console.warn(`${line} (no prospect lines!)`);
  else console.log(line);

  // The ElevenLabs transcript takes a minute or two to process after a long
  // call and the judge another 20 to 40 s. Both happen after this response;
  // the results page polls until the row leaves `ended`.
  after(() =>
    finalizeCall(call).catch((err) =>
      console.error(`[finalize] call ${id} crashed`, err),
    ),
  );
  return Response.json({ status: "ended" });
}
