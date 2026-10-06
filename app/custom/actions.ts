"use server";

import { and, eq, or, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { customPersonas } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { SIGNAL_KINDS, type CustomPersonaInput } from "@/lib/custom-persona";
import { RESEARCH_STUCK_AFTER_SECS, runCustomPersona } from "@/lib/run-custom-persona";
import { isUuid } from "@/lib/uuid";

const text = (max: number) => z.string().trim().max(max);
const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .transform((s) => (s && !/^https?:\/\//i.test(s) ? `https://${s}` : s))
  .pipe(z.union([z.literal(""), z.url()]));

const Form = z.object({
  prospectName: text(120).min(2),
  prospectTitle: text(120).min(2),
  company: text(120).min(2),
  website: optionalUrl,
  linkedin: optionalUrl,
  voice: z.enum(["female", "male"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  notes: text(2000),
  ...Object.fromEntries(SIGNAL_KINDS.map((k) => [`signal_${k.id}`, text(1000)])),
});

export async function createCustomPersona(formData: FormData) {
  const viewer = await requireUser();
  const raw = Object.fromEntries(
    [...formData.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]),
  );
  const parsed = Form.safeParse({ notes: "", website: "", linkedin: "", ...raw });
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "form");
    redirect(`/custom/new?error=${encodeURIComponent(field)}`);
  }
  const f = parsed.data as z.infer<typeof Form> & Record<string, string>;

  const input: CustomPersonaInput = {
    prospectName: f.prospectName,
    prospectTitle: f.prospectTitle,
    company: f.company,
    website: f.website || undefined,
    linkedin: f.linkedin || undefined,
    voice: f.voice,
    difficulty: f.difficulty,
    notes: f.notes || undefined,
    signals: Object.fromEntries(
      SIGNAL_KINDS.flatMap((k) => (f[`signal_${k.id}`] ? [[k.id, f[`signal_${k.id}`]]] : [])),
    ),
  };

  const [row] = await getDb()
    .insert(customPersonas)
    .values({ userId: viewer.userId, input })
    .returning();

  after(() => runCustomPersona(row));
  redirect(`/custom/${row.id}`);
}

/** Re-run research for a persona whose build failed or got stuck. Owner only. */
export async function retryCustomPersona(formData: FormData) {
  const viewer = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) redirect("/");

  // Moving failed/stuck → researching in the same statement that selects the
  // row makes a double submit match zero rows.
  const [row] = await getDb()
    .update(customPersonas)
    .set({ status: "researching", error: null, createdAt: new Date() })
    .where(
      and(
        eq(customPersonas.id, id),
        eq(customPersonas.userId, viewer.userId),
        or(
          eq(customPersonas.status, "failed"),
          and(
            eq(customPersonas.status, "researching"),
            sql`${customPersonas.createdAt} < now() - make_interval(secs => ${RESEARCH_STUCK_AFTER_SECS})`,
          ),
        ),
      ),
    )
    .returning();
  if (row) after(() => runCustomPersona(row));
  redirect(`/custom/${id}`);
}
