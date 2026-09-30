import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { Scorecard } from "@/lib/scoring";

export type TranscriptEntry = {
  role: "user" | "agent";
  message: string;
  timeInCallSecs: number;
};

export type CallStatus = "created" | "in_call" | "ended" | "scored" | "failed";

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  repName: text("rep_name").notNull(),
  personaId: text("persona_id").notNull(),
  elevenlabsConversationId: text("elevenlabs_conversation_id"),
  status: text("status").$type<CallStatus>().notNull().default("created"),
  transcript: jsonb("transcript").$type<TranscriptEntry[]>(),
  transcriptSource: text("transcript_source").$type<"client" | "elevenlabs">(),
  durationSecs: integer("duration_secs"),
  scorecard: jsonb("scorecard").$type<Scorecard>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export type Call = typeof calls.$inferSelect;
