import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { getWebrtcToken } from "@/lib/elevenlabs";
import { isUuid } from "@/lib/uuid";

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/calls/[id]/start">,
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "not found" }, { status: 404 });

  const db = getDb();
  const call = await db.query.calls.findFirst({ where: eq(calls.id, id) });
  if (!call) return Response.json({ error: "not found" }, { status: 404 });
  if (call.status !== "created" && call.status !== "in_call") {
    return Response.json(
      { error: "this call has already ended" },
      { status: 409 },
    );
  }

  try {
    const { token, conversationId } = await getWebrtcToken();
    await db
      .update(calls)
      .set({ elevenlabsConversationId: conversationId, status: "in_call" })
      .where(eq(calls.id, id));
    return Response.json({ conversationToken: token });
  } catch (err) {
    console.error(`[start] call ${id}`, err);
    return Response.json(
      { error: "could not get a call token from ElevenLabs" },
      { status: 502 },
    );
  }
}
