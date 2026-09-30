import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { TranscriptEntry } from "@/db/schema";
import { formatClock } from "./format";
import { personaBrief, type Persona } from "./personas";

export const ScorecardSchema = z.object({
  outcome: z
    .enum([
      "meeting_booked",
      "callback_agreed",
      "info_requested",
      "rejected",
      "hung_up",
      "unclear",
    ])
    .describe("How the call actually ended for the rep"),
  opener: z
    .number()
    .int()
    .describe("1-10. Pattern interrupt, clarity, earned the next 30 seconds"),
  discovery: z
    .number()
    .int()
    .describe("1-10. Asked questions that surfaced the prospect's real situation"),
  objectionHandling: z
    .number()
    .int()
    .describe("1-10. Acknowledged, reframed, and moved past pushback without arguing"),
  close: z
    .number()
    .int()
    .describe("1-10. Asked for a specific next step with a time on it"),
  overall: z.number().int().describe("1-10 overall, not an average"),
  strengths: z
    .array(z.string())
    .describe("2-3 things the rep did well, each citing what they said"),
  improvements: z
    .array(z.string())
    .describe("2-3 specific misses, each quoting the transcript and saying what to say instead"),
  coachingTip: z
    .string()
    .describe("The single most valuable thing to do differently on the next call"),
  summary: z.string().describe("Two sentences on how the call went"),
});

export type Scorecard = z.infer<typeof ScorecardSchema>;

const COACH_SYSTEM_PROMPT = `You are a veteran SDR coach reviewing a recorded cold-call practice session. The prospect was an AI playing a defined persona; the rep is a real salesperson practicing.

Score the rep, not the prospect. Be direct and specific: quote the transcript. A 7 is a solid call; reserve 9-10 for calls you would play for the whole team.

Rubric:
- Opener: did they earn the right to keep talking in the first 15 seconds? Clear who they are and why they're calling, no fake familiarity, asked for or took permission naturally.
- Discovery: did they ask questions that got the prospect talking about their own situation, rather than pitching features? Did they listen and build on answers?
- Objection handling: when pushed back on, did they acknowledge, stay calm, reframe, and keep moving, or did they argue, cave, or repeat the pitch?
- Close: did they ask for a specific next step with a concrete time, and handle "send me an email" without just agreeing?

Judge the outcome from what actually happened in the transcript, not from what the rep hoped for. If the prospect hung up, say so.`;

export function formatTranscript(entries: TranscriptEntry[]): string {
  return entries
    .map(
      (e) =>
        `[${formatClock(e.timeInCallSecs)}] ${e.role === "user" ? "SDR" : "Prospect"}: ${e.message}`,
    )
    .join("\n");
}

export async function scoreCall(
  transcript: TranscriptEntry[],
  persona: Persona,
  repName: string,
): Promise<Scorecard> {
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: COACH_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Rep: ${repName}\n\nProspect persona:\n${personaBrief(persona)}\n\nTranscript:\n${formatTranscript(transcript)}`,
      },
    ],
    output_config: { format: zodOutputFormat(ScorecardSchema) },
  });

  if (res.stop_reason === "refusal") {
    throw new Error(`Scoring refused: ${res.stop_details?.explanation ?? "no explanation"}`);
  }
  if (!res.parsed_output) {
    throw new Error(`Scoring returned no parseable output (stop_reason=${res.stop_reason})`);
  }
  return res.parsed_output;
}
