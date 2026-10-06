"use server";

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { calls, customPersonas } from "@/db/schema";
import { displayName, requireUser } from "@/lib/auth";
import { getPersona, type Persona } from "@/lib/personas";
import { finalizeCall, STUCK_AFTER_SECS } from "@/lib/run-scoring";
import { isUuid } from "@/lib/uuid";

export async function createCall(formData: FormData) {
  const viewer = await requireUser();
  const db = getDb();
  const requested = String(formData.get("personaId") ?? "");

  // A custom persona is snapshotted onto the call; only its owner can use it,
  // and only once research has finished.
  let persona: Persona | undefined;
  let customPersona: Persona | null = null;
  if (requested.startsWith("custom:")) {
    const rowId = requested.slice("custom:".length);
    const row = isUuid(rowId)
      ? await db.query.customPersonas.findFirst({
          where: and(eq(customPersonas.id, rowId), eq(customPersonas.userId, viewer.userId)),
          columns: { status: true, persona: true },
        })
      : undefined;
    if (row?.status === "ready" && row.persona) persona = customPersona = row.persona;
  } else {
    persona = getPersona(requested);
  }
  if (!persona || persona.retired) redirect("/?error=missing");

  const repName = await displayName();

  // A double submit (two clicks before the redirect) and any abandoned
  // `created` row converge on one row: reuse the caller's newest call that
  // was never started instead of inserting another. Single conditional
  // UPDATE so two racing submits cannot both reuse and insert.
  const newest = db
    .select({ id: calls.id })
    .from(calls)
    .where(and(eq(calls.userId, viewer.userId), eq(calls.status, "created")))
    .orderBy(desc(calls.createdAt))
    .limit(1);
  const [reused] = await db
    .update(calls)
    .set({ personaId: persona.id, customPersona, repName, createdAt: new Date() })
    .where(and(inArray(calls.id, newest), eq(calls.status, "created")))
    .returning({ id: calls.id });
  if (reused) redirect(`/call/${reused.id}`);

  const [row] = await db
    .insert(calls)
    .values({ userId: viewer.userId, repName, personaId: persona.id, customPersona })
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
  // One quick look for a now-ready ElevenLabs transcript, then the judge.
  if (call) await finalizeCall(call, { wait: { attempts: 1, delayMs: 0 } });

  redirect(`/call/${id}/results`);
}
