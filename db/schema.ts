import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { CustomPersonaInput, ResearchSource } from "@/lib/custom-persona";
import type { CallMetrics } from "@/lib/metrics";
import type { Persona } from "@/lib/personas";
import type { StoredScorecard } from "@/lib/scoring";

export type TranscriptEntry = {
  role: "user" | "agent";
  message: string;
  /** Start of the turn, seconds into the call (ElevenLabs gives no end time). */
  timeInCallSecs: number;
  /** Agent turn cut off by the SDR talking over it. Only known for ElevenLabs transcripts. */
  interrupted?: boolean;
};

export type CallStatus = "created" | "in_call" | "ended" | "scored" | "failed";

export const calls = pgTable(
  "calls",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Clerk user id of the rep who made the call. */
  userId: text("user_id").notNull(),
  /** Display-name snapshot at call time, so history never needs a Clerk lookup. */
  repName: text("rep_name").notNull(),
  personaId: text("persona_id").notNull(),
  /**
   * Snapshot of a custom persona (personaId `custom:<uuid>`) taken when the
   * call was created, so results and rescoring never depend on the source row.
   * Null for the built-in personas.
   */
  customPersona: jsonb("custom_persona").$type<Persona>(),
  elevenlabsConversationId: text("elevenlabs_conversation_id"),
  status: text("status").$type<CallStatus>().notNull().default("created"),
  transcript: jsonb("transcript").$type<TranscriptEntry[]>(),
  transcriptSource: text("transcript_source").$type<"client" | "elevenlabs">(),
  durationSecs: integer("duration_secs"),
  /** ElevenLabs metadata.termination_reason, raw. */
  terminationReason: text("termination_reason"),
  /** Claude's judgement; rows scored before analytics lack moments/tags/notAssessed. */
  scorecard: jsonb("scorecard").$type<StoredScorecard>(),
  /** Deterministic transcript metrics, written before Claude runs. */
  metrics: jsonb("metrics").$type<CallMetrics>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("calls_user_created_idx").on(t.userId, t.createdAt)],
);

export type Call = typeof calls.$inferSelect;

export type CustomPersonaStatus = "researching" | "ready" | "failed";

/** A prospect persona researched from a real person and company the rep entered. */
export const customPersonas = pgTable(
  "custom_personas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Clerk user id of the rep who built it. */
    userId: text("user_id").notNull(),
    /** What the rep typed in, signals included. */
    input: jsonb("input").$type<CustomPersonaInput>().notNull(),
    status: text("status").$type<CustomPersonaStatus>().notNull().default("researching"),
    /** The generated persona; set once status is `ready`. */
    persona: jsonb("persona").$type<Persona>(),
    /** Research write-up shown to the rep before they call. */
    dossier: text("dossier"),
    sources: jsonb("sources").$type<ResearchSource[]>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
  },
  (t) => [index("custom_personas_user_created_idx").on(t.userId, t.createdAt)],
);

export type CustomPersonaRow = typeof customPersonas.$inferSelect;
