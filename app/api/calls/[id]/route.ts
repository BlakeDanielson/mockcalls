import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { apiUser, canSeeCall } from "@/lib/auth";
import { isUuid } from "@/lib/uuid";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/calls/[id]">,
) {
  const viewer = await apiUser();
  if (!viewer) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "not found" }, { status: 404 });

  const call = await getDb().query.calls.findFirst({
    where: eq(calls.id, id),
    columns: { userId: true, status: true, scorecard: true },
  });
  if (!call || !canSeeCall(call, viewer)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  return Response.json({ status: call.status, scorecard: call.scorecard });
}
