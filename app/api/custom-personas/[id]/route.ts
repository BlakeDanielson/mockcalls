import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { customPersonas } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { isUuid } from "@/lib/uuid";

/** Status for the persona page's poller. Owner or manager only. */
export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/custom-personas/[id]">,
) {
  const viewer = await apiUser();
  if (!viewer) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ error: "not found" }, { status: 404 });

  const row = await getDb().query.customPersonas.findFirst({
    where: eq(customPersonas.id, id),
    columns: { userId: true, status: true },
  });
  if (!row || (row.userId !== viewer.userId && !viewer.isManager)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ status: row.status });
}
