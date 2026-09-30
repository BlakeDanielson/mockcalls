import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { isUuid } from "@/lib/uuid";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/calls/[id]">,
) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "not found" }, { status: 404 });

  const call = await getDb().query.calls.findFirst({
    where: eq(calls.id, id),
    columns: { status: true, scorecard: true },
  });
  if (!call) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json(call);
}
