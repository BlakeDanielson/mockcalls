import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { customPersonas, type CustomPersonaRow } from "@/db/schema";
import { buildCustomPersona } from "./custom-persona";

/**
 * A row still `researching` this long after it was (re)queued is stuck: the
 * background job died. Research is up to five resumed requests of web search
 * plus one build request, each bounded at 240 s with one retry, but in
 * practice finishes in one to three minutes.
 */
export const RESEARCH_STUCK_AFTER_SECS = 15 * 60;

export function isStuck(row: Pick<CustomPersonaRow, "status" | "createdAt">, now = Date.now()) {
  return row.status === "researching" && now - row.createdAt.getTime() > RESEARCH_STUCK_AFTER_SECS * 1000;
}

/**
 * Research the prospect and write the persona. Runs after the create/retry
 * action responds, via `after()`. Every write is conditional on the row still
 * being `researching`, so a retry racing a slow first run cannot be clobbered
 * by the older one finishing late with the same result.
 */
export async function runCustomPersona(row: CustomPersonaRow): Promise<void> {
  const db = getDb();
  const startedAt = Date.now();
  try {
    const { persona, research } = await buildCustomPersona(row.id, row.input);
    await db
      .update(customPersonas)
      .set({
        status: "ready",
        persona,
        dossier: research.dossier,
        sources: research.sources,
        error: null,
        readyAt: new Date(),
      })
      .where(and(eq(customPersonas.id, row.id), eq(customPersonas.status, "researching")));
    console.log(
      `[custom-persona] ${row.id} ready in ${Math.round((Date.now() - startedAt) / 1000)}s facts=${persona.facts.length} sources=${research.sources.length}`,
    );
  } catch (err) {
    console.error(`[custom-persona] ${row.id} failed`, err);
    await db
      .update(customPersonas)
      .set({ status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : "unknown error" })
      .where(and(eq(customPersonas.id, row.id), eq(customPersonas.status, "researching")))
      .catch((e) => console.error(`[custom-persona] ${row.id} could not mark failed`, e));
  }
}
