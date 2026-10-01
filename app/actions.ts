"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { displayName, requireUser } from "@/lib/auth";
import { getPersona } from "@/lib/personas";
import { runScoring } from "@/lib/run-scoring";
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

  const call = await getDb().query.calls.findFirst({ where: eq(calls.id, id) });
  // Re-scoring is a write: owner only, and only for a call whose scoring failed.
  if (call && call.userId === viewer.userId && call.status === "failed") {
    await runScoring(call);
  }

  redirect(`/call/${id}/results`);
}
