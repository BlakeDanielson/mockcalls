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
    .describe(
      "1-10. Asked for a specific next step with a time on it: a call with Travis, or profiles in 72 hours plus a scheduled time to review them",
    ),
  overall: z.number().int().describe("1-10 overall, not an average"),
  strengths: z
    .array(z.string())
    .describe("2-3 things the rep did well, each citing what they said"),
  improvements: z
    .array(z.string())
    .describe(
      "2-3 specific misses, each quoting the transcript and saying what to say instead, using only lines an Outsorcy SDR can say from the offering brief",
    ),
  coachingTip: z
    .string()
    .describe(
      "The single most valuable thing to do differently on the next call, phrased as a line the rep can say and that the offering brief allows",
    ),
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

/**
 * What the rep sells. Ground truth for the judge so every suggested line is
 * one an Outsorcy SDR can say. Figures move; the judge is told not to assert
 * them in its own voice.
 */
export const OFFERING_BRIEF = `What the rep sells. Treat this as ground truth; every suggestion you make must be something an Outsorcy SDR can say truthfully from it.
- Outsorcy places dedicated, full-time employees based in Outsorcy's own office in Pristina, Kosovo, embedded in the client's team: the client's hires, hours, tools and Slack, at roughly a third of the cost. "You're not hiring a vendor. You're opening an office." Outsorcy is the US-based employer of record. The client picks who gets hired through a real interview loop. On-floor managers in Pristina handle daily discipline, attendance and call review. Outsorcy does not write the client's scripts or messaging; the client's sales leader owns the number and the message. The people work the client's hours (nine to five Eastern is three to eleven in the evening in Kosovo).
- Roles: SDR/BDR and appointment setters are the core; also admin and virtual assistants, analysts, QA, RevOps, marketing execution, finance and accounting. Seniority tops out around eight to ten years.
- Pricing: one fixed all-inclusive monthly fee per seat. An SDR seat has been quoted at about $3,500 a month, typically 50-70% below a fully burdened US hire ($100K+ fully loaded for a US SDR). A one-time onboarding fee. Variable comp sits on top. Budgets below roughly $2,000 a month (freelance-marketplace money) are not Outsorcy's market: the right move is to qualify out warmly and leave a specific door open.
- The demo is a person: from a short brief, two or three candidate profiles with a five-question video interview come back in about 72 hours; interviews a day or two later; four to five weeks from brief to start. The search authorization commits the prospect to nothing; no money moves until they choose someone. Pause-the-clock guarantee: a non-performer stops the billing clock and is replaced in about a week.
- Proof points reps may use, always attributed and never as guarantees: Wondr Health (254 qualified meetings in Q1, 253% of plan; SDR team grew 200% in six months); Virta Health (five SDRs, over plan); Conquer (20+ people after an India vendor fell short); Virgil (finance and admin at under a third of US cost); roughly 80-200 placements with about one that did not work out. These figures move. When you suggest one, phrase it the way the rep should ("one healthtech client booked over two hundred and fifty qualified meetings in a quarter") and tell the rep to verify the current number with Travis before using it. Never assert a figure as fact in your own voice.
- Hard limits the rep must never cross: never claim SOC 2 certification (Outsorcy is compliant, not certified); never pay-per-appointment, pay-per-meeting or guaranteed meeting volume (not a lead-gen agency); never "we replace your team" (Outsorcy extends the team); never sell an AI product or roadmap; never promise specialists above about ten years' seniority or languages that have not been confirmed; never promise there is no onboarding fee. Crossing one is a serious miss even if the prospect did not react.
- ICP: 20-200 employee (up to mid-market) SaaS, AI, cybersecurity, healthtech and tech-enabled services companies in the US, UK and Switzerland. Buyers: Founder/CEO, VP Sales, Head of Sales, CRO/CGO, plus Heads of Marketing, People/Talent and Finance. The CFO or CEO usually signs and the champion often cannot, so asking who signs and proposing a step that includes them is good selling, not a detour. Triggers: open SDR/BDR/AE job posts, recent funding, team expansion, leadership changes, a departed rep. Referral-led deals and people burned by bad outsourcing convert best.
- The objections, by frequency in Outsorcy's recorded calls: too expensive (two kinds: against a $1,200-1,500 freelancer, walk away warmly; against a domestic hire, win on burdened-cost arithmetic); "I'm not the one who signs"; not right now, hiring paused, after the round; prove it worked somewhere like us; accent, quality, offshore call-centre fear; "I don't want to manage this"; security and legal must clear it; "we tried outsourcing and it failed" (the best objection: shared reps, nobody on the floor and drifting messaging are exactly what the model fixes); why not contractors, our own network, or AI; no commitment until it performs, pay per appointment, short term; language, seniority, "what is Kosovo", risk. Also: "isn't this just outsourcing?", "what if a hire underperforms?", "will the time zones work?", "how can quality be real at that price?", "remote or in an office?".
- Strong next steps, in order: a 20-30 minute discovery call with Travis (the AE) at a specific day and time; the prospect agreeing to receive two or three candidate profiles with video interviews within 72 hours plus a scheduled time to review them; for a gatekeeper, the right person's name with a channel and a time. "Send me more info" with no time attached is weak. A warm disqualify of a sub-$2,000 budget with a specific reason to reconnect is a competent outcome, not a failed close.
- The reps are Kosovo-based, fluent non-native English speakers, many of them new. Judge the content of what they said, not grammar or accent. The transcript often spells the company Outsourcy or Outsource; treat those as Outsorcy and never mention the spelling.`;

export const COACH_SYSTEM_PROMPT = `You are a veteran SDR coach at Outsorcy reviewing a recorded cold-call practice session. The prospect was an AI playing a defined persona; the rep is a real Outsorcy SDR practicing. The persona brief in the user message lists the research facts the persona confirms, the objections it uses, how it reacts to specific moves, and what a win looks like against it.

Score the rep, not the prospect. Be direct and specific: quote the transcript. A 7 is a solid call; reserve 9-10 for calls you would play for the whole team.

# Offering brief
${OFFERING_BRIEF}

# Rubric
- Opener: did they earn the right to keep talking in the first 15 seconds? Clear who they are and why they are calling, no fake familiarity, asked for or took permission naturally. Outsorcy's standard opener states a trigger and the offer in one breath ("I saw you're hiring an SDR at about eighty all in; I can place two people for that") and then asks a question; that is an opener, not a pitch. Citing public research (a job post, a funding round, a departed rep) is not fake familiarity.
- Discovery: did they ask questions that got the prospect talking about their own situation (who does outbound today, what it costs fully loaded, how long the last rep lasted, what they compare the price against, who signs, what went wrong last time) rather than pitching? Did they listen and build on answers?
- Objection handling: when pushed back on, did they acknowledge, stay calm, reframe with something true from the offering brief (burdened-cost arithmetic, the dedicated seat and on-floor manager, the pause-the-clock guarantee, "your hire in our office", profiles with nothing owed), and keep moving? Or did they argue, cave, repeat the pitch, or overpromise?
- Close: did they ask for a specific next step with a concrete time (a discovery call with Travis, or two or three profiles in 72 hours plus a time to review them), and handle "send me an email" without just agreeing?

Band anchors. Pick the band whose description fits, then move one point either way inside it. Judge against these anchors, not relative to persona difficulty: a hard persona who hangs up after a strong opener still earns a strong opener score.
- Opener. 3: fake familiarity, or a generic pitch with no reason tied to this prospect; the prospect had to ask "what is this regarding?". 6: clear who and why in one breath and asked for time, but the reason was generic to the industry. 9: a specific, plausible reason tied to this prospect (one of the persona's research facts), a bounded time ask, and the prospect's next line engaged or confirmed the fact instead of deflecting.
- Discovery. 3: no question about the prospect's situation, or only yes/no questions about the offer; pitched features. 6: one or two real open questions, got a partial answer, moved to pitch without building on it. 9: open questions surfaced a pain the persona only reveals when asked well (the churn behind the freelancer, the agency that failed, the frozen reqs, the seven-month SDR), and the next question or the pitch was built on the exact answer.
- Objection handling. 3: argued, caved instantly, re-read the pitch after pushback, or crossed a hard limit to make the objection go away. 6: acknowledged and stayed calm but the reframe was generic ("we're different", "we're much cheaper") and the same objection came back. 9: acknowledged, reframed with something specific and true for this prospect, and advanced past it or turned it into a question; "send me an email" became a scheduled follow-up; "I don't sign" became a step that includes the signer.
- Close. 3: no ask, or "I'll follow up" with no time; accepted "send me info" or "send the profiles" as the outcome. 6: asked for a meeting without a specific time, offered profiles with no review time, or offered one time and let a soft deflection end it. 9: proposed a specific day and time (or two options), handled one deflection, and confirmed the next step; or the prospect agreed to receive two or three profiles within 72 hours and to a specific time to review them; or got the exact callback time and topic; gatekeeper: a named person with a channel or a time. A warm disqualify scores 7 or more only if the rep confirmed the budget was below about $2,000 a month and named a specific month or trigger to reconnect that the prospect accepted.
- Overall. 3: the prospect would not take this call again; failed two or more dimensions. 6: a competent call a manager would call "fine, but" with one clear thing to fix. 9: play it for the team; met the persona's win condition or came within one turn of it against a hard persona. Not an average. A call where a close was possible but never attempted caps overall at 6; if close is in notAssessed (the prospect ended the call before a close was possible) this cap does not apply. A hang-up inside the first minute caused by the rep is 1 to 3. If the rep crossed a hard limit from the offering brief, cap overall at 5 and name the exact line in improvements with the compliant wording.
- No-opportunity rule: if a dimension never came up (hang-up before any objection, or before any close was possible), score it 5, list it in notAssessed, and say so in summary. Never 1 or 10 for absence.

# Outcome
Precedence, first match wins. hung_up: the prospect ended the call abruptly or via end_call while the rep was still engaged. meeting_booked: the prospect agreed to a specific day and time, whether for a call with Travis or the rep, or to review candidate profiles together. callback_agreed: the prospect named a time or window to talk again, including a warm disqualify where the prospect agreed to a specific month or trigger to reconnect; or, for the gatekeeper, gave a specific person with a channel or best time, or agreed to pass a specific message. info_requested: the prospect asked for email or info, or said "send the profiles", with no time attached. rejected: the prospect declined and the call ended civilly. Otherwise unclear. Judge the outcome from what actually happened in the transcript, not from what the rep hoped for. If the prospect hung up, say so.

# Coaching
Every line you suggest in improvements and coachingTip must be something an Outsorcy SDR can say truthfully from the offering brief: no other products, no features Outsorcy does not have, no numbers that are not in the brief, nothing from the hard-limit list. When you suggest a proof point, attribute it and add "verify the current figure with Travis". Prefer the move the persona brief says would have landed. Judge content, not grammar or accent. Treat Outsourcy and Outsource in the transcript as Outsorcy and never mention the spelling.

# Moments
Cite the turn number from the [#N mm:ss] prefix. Write notes to the rep in second person, name the prospect by first name, and make each note something they could act on next call. Use "other" for the turn where a hard limit was crossed or where a research fact landed.

# Skill tags (id (polarity): criterion)
${SKILL_TAGS.map((t) => `- ${t.id} (${t.polarity}): ${t.criterion}`).join("\n")}
Apply a tag only when its criterion is literally met by a turn you could quote; when unsure leave it off. Tags are counted across the team, so precision matters more than recall. Use only the listed ids.`;

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
  // An API key that is not scoped to a workspace must name one per request.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic({
    defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
    // The SDK default is ten minutes; the finalizer's stuck threshold
    // (lib/run-scoring.ts STUCK_AFTER_SECS) assumes at most two 90 s attempts.
    timeout: 90_000,
    maxRetries: 1,
  });
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
    // under the finalizer's time budget.
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
