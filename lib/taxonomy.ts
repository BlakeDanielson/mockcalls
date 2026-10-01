// Single source of truth for the judge prompt, the results-page chips and analytics.

export const MOMENT_TYPES = [
  "opener",
  "permission_ask",
  "first_objection",
  "best_question",
  "close_attempt",
  "hang_up",
  "other",
] as const;
export type MomentType = (typeof MOMENT_TYPES)[number];

export const MOMENT_LABELS: Record<MomentType, string> = {
  opener: "Opener",
  permission_ask: "Asked for time",
  first_objection: "First objection",
  best_question: "Best question",
  close_attempt: "Close attempt",
  hang_up: "Hang-up",
  other: "Turning point",
};

export type Moment = { type: MomentType; turnIndex: number; note: string };

export const SKILL_TAGS = [
  {
    id: "permission_opener",
    polarity: "positive",
    label: "Asked for time up front",
    criterion:
      "Within the SDR's first two turns, the rep asks for a bounded slice of time or permission to continue ('do you have thirty seconds', 'mind if I take a minute to say why I called', 'I know I'm calling out of the blue'). Not met by 'how are you today' or 'did I catch you at a bad time'.",
  },
  {
    id: "relevant_hook",
    polarity: "positive",
    label: "Specific reason for calling",
    criterion:
      "Within the SDR's first three turns, the stated reason for the call names something specific to this prospect's role, company or industry (a plausible fact, event or role-specific pain from the persona brief) rather than a generic 'we help companies like yours'.",
  },
  {
    id: "problem_question",
    polarity: "positive",
    label: "Asked about their problem",
    criterion:
      "The rep asks at least one open question (what / how / why / tell me / walk me through) about the prospect's own situation, process or pain. Questions about the product, the meeting or the rep's own pitch do not count.",
  },
  {
    id: "built_on_answer",
    polarity: "positive",
    label: "Built on their answer",
    criterion:
      "An SDR turn explicitly restates, quotes or paraphrases a specific detail the prospect gave in the immediately preceding prospect turn and uses it to ask the next question or shape the pitch. Generic acknowledgements ('got it', 'makes sense') do not count.",
  },
  {
    id: "objection_reframed",
    polarity: "positive",
    label: "Reframed the pushback",
    criterion:
      "In the SDR turn immediately after a prospect objection (including 'send me an email', 'not this quarter', 'we have a guy'), the rep acknowledges it without arguing and then reframes or asks a question instead of repeating the pitch or conceding. For 'send me an email' it is met only if the rep also secures a specific follow-up time or asks what the email should contain.",
  },
  {
    id: "specific_time_ask",
    polarity: "positive",
    label: "Proposed a specific time",
    criterion:
      "The rep proposes a next step with a concrete day and time or offers two concrete slots ('Thursday at 2 or Friday at 10'), or, for the gatekeeper, asks for a named person, direct line or best time. 'Sometime next week' or 'I'll follow up' does not count.",
  },
  {
    id: "fake_familiarity",
    polarity: "negative",
    label: "Faked familiarity",
    criterion:
      "The rep implies a relationship or prior contact the transcript and persona brief do not support ('following up on my email', 'we spoke a while back', 'she's expecting my call', 'your colleague suggested I call'), or opens with small talk ('how's your day going?') before saying who they are and why they are calling.",
  },
  {
    id: "pitched_before_discovery",
    polarity: "negative",
    label: "Pitched before asking",
    criterion:
      "The rep describes the product or its features for two or more sentences (or lists three or more capabilities in one turn) before asking any question about the prospect's situation. Judge from transcript order, not from whether a question eventually came.",
  },
  {
    id: "caved_on_objection",
    polarity: "negative",
    label: "Caved at the first no",
    criterion:
      "In the SDR turn after the first objection, the rep concedes or retreats ('okay, no problem, I'll send something', 'I'll try back next quarter') with no acknowledge-and-reframe and no question. Not met if the rep made one real attempt and then exited gracefully.",
  },
  {
    id: "argued_with_prospect",
    polarity: "negative",
    label: "Argued with the prospect",
    criterion:
      "The rep directly contradicts or debates something the prospect stated ('actually that's not true', 'but you just said'), or repeats the same pitch point after the prospect rejected it. Firm but acknowledging reframes are not arguing.",
  },
  {
    id: "ignored_buying_signal",
    polarity: "negative",
    label: "Missed a buying signal",
    criterion:
      "The prospect volunteers a pain point, asks a question that shows interest, or names a constraint ('we're mid-rebrand', 'the board is asking about margin') and the rep's next two turns do not engage with it, moving to pitch or close instead.",
  },
  {
    id: "no_close_attempt",
    polarity: "negative",
    label: "Never asked for a next step",
    criterion:
      "The call ends without the rep ever asking for any next step (meeting, callback time, referral, or a specific follow-up with a time attached). Not met if the prospect hung up before the rep reasonably could have asked (call under ~30 seconds or ended mid-opener).",
  },
] as const;

export type SkillTag = (typeof SKILL_TAGS)[number]["id"];
export type TagPolarity = (typeof SKILL_TAGS)[number]["polarity"];

export const TAG_IDS: readonly string[] = SKILL_TAGS.map((t) => t.id);
export const isSkillTag = (s: string): s is SkillTag => TAG_IDS.includes(s);
export const tagMeta = (id: SkillTag) => SKILL_TAGS.find((t) => t.id === id)!;

/** Dimensions that can have had no opportunity to occur on a call. */
export const DIMENSIONS = ["discovery", "objectionHandling", "close"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const isDimension = (s: string): s is Dimension =>
  (DIMENSIONS as readonly string[]).includes(s);
