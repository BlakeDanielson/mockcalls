import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { apiUser, canSeeCall } from "@/lib/auth";
import { fetchConversationAudio } from "@/lib/elevenlabs";
import { isUuid } from "@/lib/uuid";

// Every non-200 is no-store: a transient "not ready" must never be cached for
// the URL the player retries.
const NO_STORE = { "Cache-Control": "no-store" };
const NOT_READY_WINDOW_MS = 15 * 60_000;

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/calls/[id]/audio">,
) {
  const viewer = await apiUser();
  if (!viewer) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const { id } = await ctx.params;
  if (!isUuid(id)) {
    return Response.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  }

  const call = await getDb().query.calls.findFirst({
    where: eq(calls.id, id),
    columns: { userId: true, status: true, elevenlabsConversationId: true, endedAt: true },
  });
  // Owner or manager, same as the results page; 404 so existence is never confirmed.
  if (!call || !canSeeCall(call, viewer)) {
    return Response.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  }
  const finished =
    call.status === "ended" || call.status === "scored" || call.status === "failed";
  if (!call.elevenlabsConversationId || !finished) {
    return Response.json({ error: "no_recording" }, { status: 404, headers: NO_STORE });
  }

  let upstream: Response;
  try {
    upstream = await fetchConversationAudio(call.elevenlabsConversationId);
  } catch (err) {
    console.error(`[audio] call ${id}`, err);
    return Response.json({ error: "upstream" }, { status: 502, headers: NO_STORE });
  }

  if (upstream.ok) {
    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      // A reload doesn't re-download; a different Clerk session (cookie) re-runs authz.
      "Cache-Control": "private, max-age=3600",
      Vary: "Cookie",
    });
    // fetch() yields the decoded stream, so the upstream length is only right when nothing was encoded.
    const len = upstream.headers.get("content-length");
    if (len && !upstream.headers.get("content-encoding")) headers.set("Content-Length", len);
    return new Response(upstream.body, { status: 200, headers });
  }

  if ([404, 425, 202, 409].includes(upstream.status)) {
    // ElevenLabs' exact not-ready status is undocumented; log it so the real one surfaces.
    console.warn(`[audio] call ${id} upstream=${upstream.status} ${(await upstream.text()).slice(0, 200)}`);
    const recent =
      call.endedAt != null && Date.now() - call.endedAt.getTime() < NOT_READY_WINDOW_MS;
    return Response.json(
      { error: recent ? "not_ready" : "no_recording" },
      { status: recent ? 425 : 404, headers: NO_STORE },
    );
  }

  // 401/403 here usually means the agent's Privacy → "store call audio" is off.
  console.error(`[audio] call ${id} upstream ${upstream.status}`);
  return Response.json({ error: "upstream" }, { status: 502, headers: NO_STORE });
}
