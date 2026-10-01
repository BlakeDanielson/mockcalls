import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { TranscriptEntry } from "@/db/schema";
import { formatClock } from "./format";
import { personaBrief, type Persona } from "./personas";
import {
  DIMENSIONS,
  MOMENT_TYPES,
  SKILL_TAGS,
  TAG_IDS,
  isDimension,
  isSkillTag,
  type Dimension,
  type Moment,
  type MomentType,
  type SkillTag,
} from "./taxonomy";

// Ranges live in .describe() and are enforced by normalizeScorecard: structured
// outputs reject .min/.max, and `enum` on the new fields would turn one
// hallucinated id into a failed call instead of a dropped value.
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
  notAssessed: z
    .array(z.string())
    .describe(
      `Dimensions that never had an opportunity to occur, using only: ${DIMENSIONS.join(", ")}. Example: the prospect hung up before any objection or before a close was possible. Score those dimensions 5 and list them here. Usually empty.`,
    ),
  moments: z
    .array(
      z.object({
        type: z
          .string()
          .describe(
            `One of: ${MOMENT_TYPES.join(", ")}. opener = the SDR's first real line; permission_ask = SDR asked for time; first_objection = the prospect's first pushback; best_question = the single SDR question that got the most useful answer; close_attempt = the SDR's first explicit ask for a next step; hang_up = the prospect ended the call (only then); other = one more turning point`,
          ),
        turnIndex: z
          .number()
          .int()
          .describe(
            "The N from the [#N mm:ss] prefix of the transcript turn where this happens, exactly as printed (0-based)",
          ),
        note: z
          .string()
          .describe(
            "One sentence to the rep in second person: what happened and why it mattered. Under 20 words.",
          ),
      }),
    )
    .describe(
      "3 to 7 moments in transcript order. Always include opener; include first_objection and close_attempt when they happened; hang_up only if the prospect ended the call; at most one of each type except other (max 2).",
    ),
  tags: z
    .array(z.string())
    .describe(
      `Every skill tag whose detection criterion (in the system prompt) is literally met, using only these ids: ${TAG_IDS.join(", ")}. Omit when in doubt. Empty array is fine; 0-6 is typical.`,
    ),
});

type RawScorecard = z.infer<typeof ScorecardSchema>;

/** What scoreCall returns: the new fields are always present and validated. */
export type Scorecard = Omit<RawScorecard, "moments" | "tags" | "notAssessed"> & {
  moments: Moment[];
  tags: SkillTag[];
  notAssessed: Dimension[];
};

/** What the jsonb column may hold: rows scored before analytics lack the new fields. */
export type StoredScorecard = Omit<Scorecard, "moments" | "tags" | "notAssessed"> & {
  moments?: Moment[];
  tags?: SkillTag[];
  notAssessed?: Dimension[];
};

const clampScore = (n: number) => Math.min(10, Math.max(1, Math.round(n)));
const MAX_MOMENTS = 8;

/** Server-side guard rails on the judge's output. Exported for unit tests. */
export function normalizeScorecard(raw: RawScorecard, turnCount: number): Scorecard {
  const dropped: string[] = [];

  const notAssessed = [...new Set(raw.notAssessed)].filter((d) => {
    if (isDimension(d)) return true;
    dropped.push(`notAssessed "${d}"`);
    return false;
  }) as Dimension[];

  const scores = {
    opener: clampScore(raw.opener),
    discovery: clampScore(raw.discovery),
    objectionHandling: clampScore(raw.objectionHandling),
    close: clampScore(raw.close),
    overall: clampScore(raw.overall),
  };
  // The no-opportunity rule holds regardless of model compliance.
  for (const d of notAssessed) scores[d] = 5;

  const seenTypes = new Map<MomentType, number>();
  const moments: Moment[] = [];
  for (const m of raw.moments) {
    const note = m.note.trim().slice(0, 200);
    if (!note) {
      dropped.push("moment with empty note");
      continue;
    }
    const type: MomentType = (MOMENT_TYPES as readonly string[]).includes(m.type)
      ? (m.type as MomentType)
      : (dropped.push(`moment type "${m.type}" → other`), "other");
    if (!Number.isFinite(m.turnIndex) || turnCount === 0) {
      dropped.push(`moment turnIndex ${m.turnIndex}`);
      continue;
    }
    const turnIndex = Math.min(Math.max(Math.trunc(m.turnIndex), 0), turnCount - 1);
    const count = seenTypes.get(type) ?? 0;
    if (count >= (type === "other" ? 2 : 1)) {
      dropped.push(`duplicate moment ${type}`);
      continue;
    }
    seenTypes.set(type, count + 1);
    moments.push({ type, turnIndex, note });
  }
  moments.sort((a, b) => a.turnIndex - b.turnIndex);

  const tagSet = new Set(raw.tags);
  for (const t of raw.tags) if (!isSkillTag(t)) dropped.push(`tag "${t}"`);
  const tags = SKILL_TAGS.map((t) => t.id).filter((id) => tagSet.has(id));

  if (dropped.length) {
    console.warn(`[scoring] normalization: ${dropped.join("; ")}`);
  }

  return {
    ...raw,
    ...scores,
    strengths: raw.strengths.slice(0, 4),
    improvements: raw.improvements.slice(0, 4),
    notAssessed,
    moments: moments.slice(0, MAX_MOMENTS),
    tags,
  };
}

const COACH_SYSTEM_PROMPT = `You are a veteran SDR coach reviewing a recorded cold-call practice session. The prospect was an AI playing a defined persona; the rep is a real salesperson practicing.

Score the rep, not the prospect. Be direct and specific: quote the transcript. A 7 is a solid call; reserve 9-10 for calls you would play for the whole team.

Rubric:
- Opener: did they earn the right to keep talking in the first 15 seconds? Clear who they are and why they're calling, no fake familiarity, asked for or took permission naturally.
- Discovery: did they ask questions that got the prospect talking about their own situation, rather than pitching features? Did they listen and build on answers?
- Objection handling: when pushed back on, did they acknowledge, stay calm, reframe, and keep moving, or did they argue, cave, or repeat the pitch?
- Close: did they ask for a specific next step with a concrete time, and handle "send me an email" without just agreeing?

Band anchors. Pick the band whose description fits, then move ±1 inside it. Judge against these anchors, not relative to persona difficulty: a hard persona who hangs up after a strong opener still earns a strong opener score.
- Opener — 3: fake familiarity or a generic pitch with no reason tied to this prospect; the prospect had to ask "what is this regarding?". 6: clear who/why in one breath and asked for time, but the reason was generic to the industry. 9: a specific, plausible reason for calling this person, a bounded time ask, and the prospect's next line engaged instead of deflecting.
- Discovery — 3: no question about the prospect's situation, or only yes/no questions about the product; pitched features. 6: one or two real open questions, got a partial answer, moved to pitch without building on it. 9: open questions surfaced a pain the persona only reveals when asked well, and the next question or the pitch was built on the exact answer.
- Objection handling — 3: argued, caved instantly, or re-read the pitch after pushback. 6: acknowledged and stayed calm but the reframe was generic and the same objection came back. 9: acknowledged, reframed with something specific to the prospect, and advanced past it or turned it into a question; "send me an email" became a scheduled follow-up.
- Close — 3: no ask, or "I'll follow up" with no time; accepted "send me info" as the outcome. 6: asked for a meeting without a specific time, or offered one time and let a soft deflection end it. 9: proposed a specific day/time (or two options), handled one deflection, and confirmed the next step or got the exact callback time and topic (gatekeeper: a named person and channel).
- Overall — 3: the prospect would not take this call again; failed two or more dimensions. 6: a competent call a manager would call "fine, but…" with one clear thing to fix. 9: play it for the team; met the persona's win condition or came within one turn of it against a hard persona. Not an average. A call where a close was possible but never attempted caps overall at 6; if close is in notAssessed (the prospect ended the call before a close was possible) this cap does not apply. A hang-up inside the first minute caused by the rep is 1–3.
- No-opportunity rule: if a dimension never came up (hang-up before any objection, or before any close was possible), score it 5, list it in notAssessed, and say so in summary. Never 1 or 10 for absence.

Outcome precedence (first match wins): hung_up if the prospect ended the call abruptly or via end_call while the rep was still engaged → meeting_booked if the prospect agreed to a specific meeting day/time → callback_agreed if the prospect named a time or window to talk again, or, for the gatekeeper, gave a specific person/line/best time or agreed to pass a specific message → info_requested if the prospect asked for email/info with no time attached → rejected if the prospect declined and the call ended civilly → unclear.

Moments: cite the turn number from the [#N mm:ss] prefix. Write notes to the rep in second person, name the prospect by first name, and make each note something they could act on next call.

Skill tags (id (polarity): criterion):
${SKILL_TAGS.map((t) => `- ${t.id} (${t.polarity}): ${t.criterion}`).join("\n")}
Apply a tag only when its criterion is literally met by a turn you could quote; when unsure leave it off. Tags are counted across the team, so precision matters more than recall. Use only the listed ids.

Judge the outcome from what actually happened in the transcript, not from what the rep hoped for. If the prospect hung up, say so.`;

/** `[#i mm:ss] SDR|Prospect (cut off by SDR): …` — i is the array index the judge cites. */
export function formatTranscript(entries: TranscriptEntry[]): string {
  return entries
    .map(
      (e, i) =>
        `[#${i} ${formatClock(e.timeInCallSecs)}] ${
          e.role === "user" ? "SDR" : "Prospect"
        }${e.role === "agent" && e.interrupted ? " (cut off by SDR)" : ""}: ${e.message}`,
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
        content: `Rep: ${repName}\n\nProspect persona:\n${personaBrief(persona)}\n\nTurns are numbered #0…#${Math.max(transcript.length - 1, 0)}; times are turn starts in whole seconds; cite the number when you report a moment.\n\nTranscript:\n${formatTranscript(transcript)}`,
      },
    ],
    // Opus defaults to effort "high", whose thinking shares the 16k budget with
    // the scorecard; medium keeps the judge well under the cap and the request
    // under the route's maxDuration.
    output_config: { effort: "medium", format: zodOutputFormat(ScorecardSchema) },
  });

  if (res.stop_reason === "refusal") {
    throw new Error(`Scoring refused: ${res.stop_details?.explanation ?? "no explanation"}`);
  }
  if (!res.parsed_output) {
    throw new Error(`Scoring returned no parseable output (stop_reason=${res.stop_reason})`);
  }
  return normalizeScorecard(res.parsed_output, transcript.length);
}
