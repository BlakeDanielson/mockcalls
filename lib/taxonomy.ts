// Single source of truth for the judge prompt, the results-page chips and analytics.
// Tag ids are append-only: stored scorecards reference them by id.

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
      "Within the SDR's first three turns, the stated reason for the call names something specific to this prospect (a research fact from the persona brief such as an open SDR post, a funding round or a departed rep, or a plausible role-specific pain) rather than a generic 'we help companies like yours'. Public research is not fake familiarity. Not met if the prospect corrected the fact as untrue.",
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
      "In the SDR turn immediately after a prospect objection (including 'send me an email', 'not this quarter', 'we tried outsourcing', 'too expensive', 'I'm not the one who signs', 'after the round'), the rep acknowledges it without arguing and then reframes or asks a question instead of repeating the pitch or conceding. For 'send me an email' it is met only if the rep also secures a specific follow-up time or asks what the email should contain. For 'I'm not the one who signs' it is met only if the rep asks who is or proposes a step that includes them.",
  },
  {
    id: "specific_time_ask",
    polarity: "positive",
    label: "Proposed a specific time",
    criterion:
      "The rep proposes a next step with a concrete day and time or offers two concrete slots ('Thursday at 2 or Friday at 10'), or proposes a specific day and time to review candidate profiles, or, for the gatekeeper, asks for a named person, direct line or best time. 'Sometime next week' or 'I'll follow up' does not count.",
  },
  {
    id: "fake_familiarity",
    polarity: "negative",
    label: "Faked familiarity",
    criterion:
      "The rep implies a relationship or prior contact the transcript and persona brief do not support ('following up on my email', 'we spoke a while back', 'she's expecting my call', 'your colleague suggested I call'), or opens with small talk ('how's your day going?') before saying who they are and why they are calling. Citing public research (a job post, a funding announcement, a LinkedIn change) is not fake familiarity.",
  },
  {
    id: "pitched_before_discovery",
    polarity: "negative",
    label: "Pitched before asking",
    criterion:
      "The rep describes the product or its features for two or more sentences (or lists three or more capabilities in one turn) before asking any question about the prospect's situation. Judge from transcript order, not from whether a question eventually came. Outsorcy's one-breath trigger-and-offer opener ('I saw you're hiring an SDR at about eighty all in; I can place two people for that') is an opener, not a pitch, provided a question follows in the same or the next SDR turn.",
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
      "The prospect volunteers a pain point, asks a question that shows interest, or names a constraint ('our last SDR quit in month four', 'we have two reqs open', 'the round closes in six weeks', 'we tried an agency and it failed', 'I'm not the one who signs') and the rep's next two turns do not engage with it, moving to pitch or close instead.",
  },
  {
    id: "no_close_attempt",
    polarity: "negative",
    label: "Never asked for a next step",
    criterion:
      "The call ends without the rep ever asking for any next step (meeting, callback time, referral, profiles with a review time, or a specific follow-up with a time attached). Not met if the prospect hung up before the rep reasonably could have asked (call under ~30 seconds or ended mid-opener).",
  },
  // Outsorcy-specific tags, added for the SDR team launch.
  {
    id: "qualified_budget",
    polarity: "positive",
    label: "Asked what they compare against",
    criterion:
      "When price comes up (the prospect raises it, or the rep is about to state it), the rep asks a question about the prospect's reference point or current spend ('what are you comparing that to', 'what does that freelancer run you a month', 'what did your last SDR cost you fully loaded', 'what's budgeted for the role'). Must be a question the prospect could answer with a number or a comparison. If the prospect already named a figure, a question that probes it counts (whether it is all in, what it buys them, how long that person has lasted, or what they would actually compare Outsorcy against). Stating the price and asking 'does that work' does not count.",
  },
  {
    id: "burdened_cost_reframe",
    polarity: "positive",
    label: "Burdened-cost reframe",
    criterion:
      "In reply to a price objection or a comparison with a domestic hire, the rep contrasts Outsorcy's fixed monthly fee with the fully loaded cost of a US hire, with at least one number on each side (for example 'about thirty-five hundred a month all in, against a hundred thousand plus loaded for a US SDR', or the prospect's own OTE plus overhead). 'We're a lot cheaper than hiring' with no numbers does not count. Not met when the comparison is against a freelancer or an AI tool.",
  },
  {
    id: "model_explained",
    polarity: "positive",
    label: "Explained the model",
    criterion:
      "In reply to an outsourcing, quality, accent, management or 'isn't this just outsourcing' worry, the rep states at least two of: the person is a dedicated full-time employee who works only for the prospect; they sit in Outsorcy's own office in Pristina with a manager on the floor; they work the prospect's hours, tools and Slack; the prospect interviews and picks them; Outsorcy is the employer of record. A single 'they're dedicated' does not count.",
  },
  {
    id: "profiles_offered",
    polarity: "positive",
    label: "Offered profiles in 72 hours",
    criterion:
      "The rep offers two or three candidate profiles (with video interviews) within about seventy-two hours of a short brief and makes clear nothing is owed until the prospect chooses someone. Count it whether or not the prospect accepted. Not met by 'I can send you some CVs' with no timeframe and no no-commitment statement.",
  },
  {
    id: "looped_in_signer",
    polarity: "positive",
    label: "Looped in the decision maker",
    criterion:
      "After the prospect says they do not sign, that someone else decides, or that they would need to check with a named person, the rep asks who that is or what they would need, and proposes a next step that includes that person (a call with both, profiles sent to both with a review time, or the prospect bringing it to them at a stated time). Not met if the rep only asks the prospect to 'pass it along'.",
  },
  {
    id: "overpromised",
    polarity: "negative",
    label: "Crossed a hard limit",
    criterion:
      "The rep states any of: Outsorcy is SOC 2 certified ('compliant' is fine); a guaranteed number of meetings, appointments or results, or pay-per-appointment or pay-per-meeting pricing; that Outsorcy replaces the prospect's team or does the selling for them; that Outsorcy writes the prospect's scripts or messaging; an AI product or AI agents as part of the offer; candidates with more than about ten years of experience, or fluency in a specific language other than English, as a given; a monthly price below about two thousand dollars, or 'no onboarding fee'. One instance is enough, whether or not the prospect reacted.",
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
