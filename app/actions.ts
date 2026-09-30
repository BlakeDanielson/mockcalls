"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { getPersona } from "@/lib/personas";
import { runScoring } from "@/lib/run-scoring";
import { isUuid } from "@/lib/uuid";

export async function createCall(formData: FormData) {
  const repName = String(formData.get("repName") ?? "")
    .trim()
    .slice(0, 60);
  const persona = getPersona(String(formData.get("personaId") ?? ""));
  if (!repName || !persona) redirect("/?error=missing");

  // Remember the rep so they don't retype it every call. No login, by design.
  (await cookies()).set("repName", repName, {
    maxAge: 60 * 60 * 24 * 90,
    sameSite: "lax",
    path: "/",
  });

  const [row] = await getDb()
    .insert(calls)
    .values({ repName, personaId: persona.id })
    .returning({ id: calls.id });

  redirect(`/call/${row.id}`);
}

export async function rescoreCall(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) redirect("/history");

  const call = await getDb().query.calls.findFirst({ where: eq(calls.id, id) });
  if (call) await runScoring(call);

  redirect(`/call/${id}/results`);
}
