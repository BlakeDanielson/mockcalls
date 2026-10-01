"use server";

import { and, eq, or, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { displayName, requireUser } from "@/lib/auth";
import { getPersona } from "@/lib/personas";
import { runScoring, STUCK_AFTER_SECS } from "@/lib/run-scoring";
import { isUuid } from "@/lib/uuid";

export async function createCall(formData: FormData) {
  const viewer = await requireUser();
  const persona = getPersona(String(formData.get("personaId") ?? ""));
  if (!persona) redirect("/?error=missing");

  const repName = await displayName();
  const [row] = await getDb()
    .insert(calls)
    .values({ userId: viewer.userId, repName, personaId: persona.id })
    .returning({ id: calls.id });

  redirect(`/call/${row.id}`);
}

export async function rescoreCall(formData: FormData) {
  const viewer = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) redirect("/history");

  // Re-scoring is a write: owner only, for a call whose scoring failed or got
  // stuck. Moving failed → ended in the same statement that selects the row
  // makes a double submit on a failed call match zero rows.
  const [call] = await getDb()
    .update(calls)
    .set({ status: "ended" })
    .where(
      and(
        eq(calls.id, id),
        eq(calls.userId, viewer.userId),
        or(
          eq(calls.status, "failed"),
          and(
            eq(calls.status, "ended"),
            sql`${calls.endedAt} < now() - make_interval(secs => ${STUCK_AFTER_SECS})`,
          ),
        ),
      ),
    )
    .returning();
  if (call) await runScoring(call);

  redirect(`/call/${id}/results`);
}
