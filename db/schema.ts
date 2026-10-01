import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { CallMetrics } from "@/lib/metrics";
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
