import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getPersona, type CustomPersonaId, type Persona } from "./personas";
import { OFFERING_BRIEF } from "./scoring";

/**
 * Custom personas: the rep enters a real prospect, their company and any
 * buying signals they know about; Claude researches the person and company on
 * the web, then writes a Persona in the same shape as the hand-tuned ones in
 * lib/personas.ts. Two requests: research (web search + fetch, free text),
 * then build (structured output, no tools).
 */

export const SIGNAL_KINDS = [
  { id: "jobPostings", label: "Job postings", hint: "Open SDR/BDR, sales or marketing roles, salary bands, how long they have been up" },
  { id: "leadershipChange", label: "Leadership changes", hint: "New CRO, VP Sales, CEO; the prospect themselves just started" },
  { id: "funding", label: "Funding", hint: "Recent round, amount, investors, IPO or acquisition" },
  { id: "growth", label: "Growth or expansion", hint: "New market, new office, product launch, headcount growth" },
  { id: "other", label: "Anything else", hint: "Layoffs, tech stack change, a post they wrote, a mutual connection, a past conversation" },
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number]["id"];

export type VoiceGender = "female" | "male";

export type CustomPersonaInput = {
  prospectName: string;
  prospectTitle: string;
  company: string;
  /** Company website, optional. */
  website?: string;
  /** Prospect's LinkedIn profile URL, optional. */
  linkedin?: string;
  voice: VoiceGender;
  difficulty: Persona["difficulty"];
  /** What the rep already knows, keyed by signal kind; blank kinds are omitted. */
  signals: Partial<Record<SignalKind, string>>;
  /** Free-form notes from the rep. */
  notes?: string;
};

export type ResearchSource = { url: string; title: string };

/**
 * Premade ElevenLabs voices for custom personas, distinct from the named
 * personas' voices so a custom prospect never sounds like Marcus or Dana.
 */
export const CUSTOM_VOICES: Record<VoiceGender, { voiceId: string; label: string }> = {
  female: { voiceId: "EXAVITQu4vr4xnSDxMaL", label: "Sarah: mature, confident American woman" },
  male: { voiceId: "cjVigY5qzO86Huf0OWal", label: "Eric: smooth, trustworthy American man in his 40s" },
};

const MODEL = "claude-opus-5-5";

function client() {
  // An API key that is not scoped to a workspace must name one per request.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  return new Anthropic({
    defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
    timeout: 240_000,
    maxRetries: 1,
  });
}

/** Persona text must be free of em and en dashes (lib/personas.test.ts holds the built-ins to the same rule). */
export function scrubDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").trim();
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Signals the rep entered, as labelled lines. */
export function formatSignals(input: CustomPersonaInput): string[] {
  return SIGNAL_KINDS.flatMap((k) => {
    const v = input.signals[k.id]?.trim();
    return v ? [`${k.label}: ${v}`] : [];
  });
}

function describeInput(input: CustomPersonaInput): string {
  const signals = formatSignals(input);
  return [
    `Prospect: ${input.prospectName}, ${input.prospectTitle} at ${input.company}`,
    input.website ? `Company website: ${input.website}` : null,
    input.linkedin ? `Prospect LinkedIn: ${input.linkedin}` : null,
    signals.length
      ? `Signals the rep already knows (treat as true):\n${signals.map((s) => `- ${s}`).join("\n")}`
      : "Signals the rep already knows: none given.",
    input.notes?.trim() ? `Rep's notes: ${input.notes.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Step 1: research

const RESEARCH_SYSTEM = `You research a sales prospect so a sales development rep can rehearse a cold call to them. The rep works for Outsorcy, which places dedicated full-time offshore sales development reps and other staff with US companies.

Find what a well-prepared rep could learn in fifteen minutes before dialing:
- The person: current role and how long they have held it, previous roles, what they own, anything they have said publicly about their work (posts, podcasts, interviews, quotes).
- The company: what it sells and to whom, size, stage, headquarters, funding history, recent news.
- Buying signals for Outsorcy: open sales, SDR, BDR or marketing roles (with salary bands and posting age when visible), leadership changes, funding, expansion, layoffs or hiring freezes, a sales team being built or rebuilt, use of agencies or offshore staff.
- The sales org: rough team size and shape, who likely signs for sales hiring.

Rules:
- Professional, public information only. Never include home addresses, family, health, personal social accounts, or anything about the person's private life.
- If several people share the name, use the company and title to pick the right one; if you cannot confirm it is the same person, say so and do not attribute their details.
- Confirm or contradict the rep's signals when you can; never drop them.
- Mark anything uncertain as uncertain. Do not guess numbers.
- Search efficiently; stop when you have the picture.

Finish with a plain-text write-up under these headings: PERSON, COMPANY, SIGNALS, SALES ORG, LIKELY PRIORITIES, UNKNOWNS. Short factual lines, each with the date or age of the information when you know it.`;

export type Research = { dossier: string; sources: ResearchSource[] };

const MAX_CONTINUATIONS = 4;

export async function researchProspect(input: CustomPersonaInput): Promise<Research> {
  const anthropic = client();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `${describeInput(input)}\n\nToday is ${new Date().toISOString().slice(0, 10)}.` },
  ];

  let res: Anthropic.Beta.BetaMessage | undefined;
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    res = await anthropic.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 32000,
        system: RESEARCH_SYSTEM,
        messages,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 10 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 },
        ],
        output_config: { effort: "medium" },
        // On a safety-classifier decline, re-run on a fallback model instead of failing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      })
      .finalMessage();
    // The server-side tool loop pauses after its iteration limit; resend to resume.
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  if (!res) throw new Error("Research returned nothing");
  if (res.stop_reason === "refusal") {
    throw new Error(`Research refused: ${res.stop_details?.explanation ?? "no explanation"}`);
  }

  const dossier = res.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  if (!dossier) throw new Error(`Research produced no write-up (stop_reason=${res.stop_reason})`);

  // Prefer what the write-up actually cites; fall back to everything searched.
  const cited = new Map<string, string>();
  const searched = new Map<string, string>();
  for (const b of res.content) {
    if (b.type === "text") {
      for (const c of b.citations ?? []) {
        if ("url" in c && c.url) cited.set(c.url, ("title" in c && c.title) || c.url);
      }
    } else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) searched.set(r.url, r.title || r.url);
    }
  }
  const pick = cited.size ? cited : searched;
  const sources = [...pick].slice(0, 12).map(([url, title]) => ({ url, title }));

  return { dossier: scrubDashes(dossier.replace(/\n{3,}/g, "\n\n")), sources };
}

// ---------------------------------------------------------------------------
// Step 2: build the persona

export const GeneratedPersonaSchema = z.object({
  industry: z
    .string()
    .describe("What the company does, size and stage in one line, e.g. 'Cybersecurity SaaS selling to CISOs, ~140 employees, Series B'"),
  tagline: z.string().describe("One or two sentences shown to the rep on the persona card: who this is and what the call will test"),
  drill: z.string().describe("For the judge: what this call is built to drill, tied to this prospect's situation"),
  personality: z.string().describe("How they behave on an unexpected sales call, in the style of the example"),
  speech: z.string().describe("Verbal tics and phone habits with two to four quoted example phrases"),
  warmsUpWhen: z.string().describe("The one thing that moves them from guarded to engaged; lowercase clause, no trailing period"),
  facts: z
    .array(z.string())
    .describe("5 to 8 research facts a prepared rep could cite. ONLY from the research or the rep's signals. Every rep signal appears here."),
  painPoints: z
    .array(z.string())
    .describe("3 or 4 private pains they admit only to good questions; plausible given the facts, never contradicting them"),
  objections: z.array(z.string()).describe("5 or 6 lines they push back with, in their own voice"),
  reactions: z
    .array(z.string())
    .describe(
      "5 to 7 'If the rep ..., ...' sentences covering: the burdened-cost reframe, the profiles-in-72-hours offer, pause-the-clock, where the people are (Kosovo), an overclaim (SOC 2 certified, guaranteed meetings, 'you won't need to hire'), and their specific main objection",
    ),
  winCondition: z.string().describe("A specific, earned next step: a call with Travis at a day and time, or profiles plus a review slot"),
  firstMessage: z.string().describe("How they answer the phone. Eight words or fewer, no brackets"),
  stability: z.number().describe("Voice stability 0.3 to 0.8: lower is more animated, higher is more measured"),
  speed: z.number().describe("Voice speed 0.9 to 1.15: faster for rushed or energetic people"),
});

export type GeneratedPersona = z.infer<typeof GeneratedPersonaSchema>;

const DIFFICULTY_GUIDE: Record<Persona["difficulty"], string> = {
  easy: "Easy: warm and chatty, happy to talk, agrees in tone and commits to nothing. The test is pinning down a specific next step.",
  medium: "Medium: busy and guarded but fair. Gives the rep two or three chances to be interesting; engages if they ask good questions.",
  hard: "Hard: skeptical, short on time, challenges claims and numbers, ends the call quickly if the rep is vague. Warms up only in stages.",
};

/** The hand-tuned persona used as a style reference for the builder. */
function exampleJson(): string {
  const p = getPersona("burned-vp-sales")!;
  const { personality, speech, warmsUpWhen, facts, painPoints, objections, reactions, winCondition, firstMessage, drill, tagline } = p;
  return JSON.stringify(
    { personality, speech, warmsUpWhen, facts, painPoints, objections, reactions, winCondition, firstMessage, drill, tagline },
    null,
    1,
  );
}

function buildSystem(): string {
  return `You turn research on a real sales prospect into a role-play persona for cold-call practice. An AI voice agent will play this person on the phone while an Outsorcy sales development rep practices calling them; a judge later scores the rep against the persona.

${OFFERING_BRIEF}

Write the persona in the same voice and level of specificity as this hand-tuned example (a different prospect):
${exampleJson()}

Rules:
- facts are the research the rep could have done. Use only what the research or the rep's signals support, with specifics (numbers, dates, names, salary bands). Include every signal the rep supplied. Where research is thin, use fewer facts rather than inventing them.
- painPoints, objections and reactions may be inferred, but must fit the facts and the person's role. Pains are what they would admit to a good question, not public facts.
- reactions are sentences addressed to the persona ("If the rep ..., say ..."). They decide how Outsorcy's real moves land with this person. Hard limits from the offering brief (not SOC 2 certified, no guaranteed meetings, not pay per meeting, not a replacement for their team) must lower trust when the rep crosses them.
- Name the real decision makers only if the research names them; otherwise refer to roles ("the CEO", "finance").
- If the prospect is not the person who would own sales hiring, make that part of the call: the win is a referral or a next step that includes the owner.
- Never use em dashes or en dashes. Plain sentences.
- firstMessage is how they pick up the phone, e.g. "This is Dana." or "Yeah, Marcus here."`;
}

export async function generatePersona(
  input: CustomPersonaInput,
  research: Research,
): Promise<GeneratedPersona> {
  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: buildSystem(),
    messages: [
      {
        role: "user",
        content: `${describeInput(input)}\n\nDifficulty: ${DIFFICULTY_GUIDE[input.difficulty]}\nVoice: ${input.voice}. Use pronouns that match.\n\nResearch:\n${research.dossier}`,
      },
    ],
    output_config: { effort: "medium", format: zodOutputFormat(GeneratedPersonaSchema) },
  });
  if (res.stop_reason === "refusal") {
    throw new Error(`Persona build refused: ${res.stop_details?.explanation ?? "no explanation"}`);
  }
  if (!res.parsed_output) {
    throw new Error(`Persona build returned no parseable output (stop_reason=${res.stop_reason})`);
  }
  return res.parsed_output;
}

/** Distinctive tokens: numbers and amounts, and words of four letters or more. */
const tokens = (s: string) =>
  new Set(s.toLowerCase().match(/\$?\d[\w.$%-]*|[a-z]{4,}/g) ?? []);

/** Whether a generated fact restates a signal: at least half its distinctive tokens appear. */
function covers(fact: string, signal: string): boolean {
  const want = tokens(signal);
  if (want.size === 0) return true;
  const have = tokens(fact);
  let hit = 0;
  for (const t of want) if (have.has(t)) hit++;
  return hit / want.size >= 0.5;
}

/** Generated fields + the rep's input → a Persona the prompt builder and judge accept. Pure; unit-tested. */
export function assemblePersona(rowId: string, input: CustomPersonaInput, g: GeneratedPersona): Persona {
  const list = (xs: string[]) => xs.map(scrubDashes).filter(Boolean);
  const firstMessage = scrubDashes(g.firstMessage.replace(/\[[^\]]*\]/g, ""))
    .split(/\s+/)
    .slice(0, 8)
    .join(" ");
  const facts = list(g.facts);
  // The rep's signals are ground truth; keep them even if the builder dropped one.
  for (const s of formatSignals(input)) {
    if (!facts.some((f) => covers(f, s.slice(s.indexOf(":") + 1)))) facts.push(scrubDashes(s));
  }
  return {
    id: `custom:${rowId}` as CustomPersonaId,
    custom: true,
    name: input.prospectName.trim(),
    title: input.prospectTitle.trim(),
    company: input.company.trim(),
    industry: scrubDashes(g.industry),
    difficulty: input.difficulty,
    tagline: scrubDashes(g.tagline),
    drill: scrubDashes(g.drill),
    personality: scrubDashes(g.personality),
    speech: scrubDashes(g.speech),
    warmsUpWhen: scrubDashes(g.warmsUpWhen).replace(/\.$/, ""),
    facts,
    painPoints: list(g.painPoints),
    objections: list(g.objections),
    reactions: list(g.reactions),
    winCondition: scrubDashes(g.winCondition),
    voiceId: CUSTOM_VOICES[input.voice].voiceId,
    voice: {
      stability: Math.round(clamp(Number.isFinite(g.stability) ? g.stability : 0.5, 0.3, 0.8) * 100) / 100,
      speed: Math.round(clamp(Number.isFinite(g.speed) ? g.speed : 1, 0.9, 1.15) * 100) / 100,
    },
    firstMessage: firstMessage || `This is ${input.prospectName.trim().split(/\s+/)[0]}.`,
  };
}

/** Research, then build. Throws on any failure; the caller records it. */
export async function buildCustomPersona(
  rowId: string,
  input: CustomPersonaInput,
): Promise<{ persona: Persona; research: Research }> {
  const research = await researchProspect(input);
  const generated = await generatePersona(input, research);
  return { persona: assemblePersona(rowId, input, generated), research };
}
