// Prints a review copy of every piece of text that prompts and guides the
// personas: the shared prompt template once, the call arcs, then each
// persona's own text. Generated from lib/personas.ts, so it is exactly what
// the ElevenLabs agent receives.
//   pnpm tsx scripts/persona-review.ts > docs/PERSONA-REVIEW.md
import { buildSystemPrompt, PERSONAS, type Persona } from "@/lib/personas";

const out: string[] = [];
const p = (...lines: string[]) => out.push(...lines);

const placeholder: Persona = {
  id: "warmup-marketing",
  name: "{NAME}",
  title: "{TITLE}",
  company: "{COMPANY}",
  industry: "{INDUSTRY}",
  difficulty: "medium",
  tagline: "",
  drill: "",
  personality: "{PERSONALITY}",
  speech: "{HOW THEY TALK}",
  warmsUpWhen: "{WHAT WARMS THEM UP}",
  facts: ["{RESEARCH FACTS, one per line}"],
  painPoints: ["{REAL SITUATION, one per line}"],
  objections: ["{PUSHBACK LINES, one per line}"],
  reactions: ["{PERSONA-SPECIFIC REACTIONS, one per line}"],
  winCondition: "{WIN CONDITION}",
  voiceId: "",
  voice: { stability: 0.5, speed: 1 },
  firstMessage: "",
};

// Swap the medium arc for a marker so the template shows where the arc goes.
const template = buildSystemPrompt(placeholder, "{REP NAME}");
const arcStart = template.indexOf("# How this call goes\n") + "# How this call goes\n".length;
const arcEnd = template.indexOf("- What finally warms you up:");
const templateWithArcMarker =
  template.slice(0, arcStart) +
  "{CALL ARC for this difficulty, see Part 2}\n" +
  template.slice(arcEnd);

p(
  "# Persona prompts: review copy",
  "",
  "Generated from `lib/personas.ts`. This is every word the ElevenLabs agent receives for a call, arranged for review:",
  "",
  "1. **The shared prompt.** Every persona gets this same text. Words in `{CAPS}` are filled from the persona.",
  "2. **The call arcs.** One block per difficulty level, plus one for the gatekeeper.",
  "3. **Each persona's own text.** Everything that differs from persona to persona.",
  "4. **One fully assembled prompt** (Dana), exactly as sent, so you can read it end to end.",
  "",
  "Agent settings that also shape behavior: Claude Sonnet 5.5 at temperature 0.6, ElevenLabs v4 turbo voice, calls capped at 8 minutes, the prospect can hang up on its own.",
  "",
  "---",
  "",
  "## Part 1: the shared prompt (every persona)",
  "",
  "```text",
  templateWithArcMarker,
  "```",
  "",
  "---",
  "",
  "## Part 2: call arcs",
  "",
  "Inserted under \"How this call goes\". Which one a persona gets depends on its difficulty; Tom the EA uses the gatekeeper arc.",
  "",
);

const arcOf = (prompt: string) =>
  prompt.slice(
    prompt.indexOf("# How this call goes\n") + "# How this call goes\n".length,
    prompt.indexOf("- What finally warms you up:"),
  ).trimEnd();

const arcSeen = new Set<string>();
for (const persona of PERSONAS) {
  const key = persona.gatekeeper ? "gatekeeper" : persona.difficulty;
  if (arcSeen.has(key)) continue;
  arcSeen.add(key);
  const users = PERSONAS.filter((x) => (x.gatekeeper ? "gatekeeper" : x.difficulty) === key)
    .map((x) => x.name.split(" ")[0])
    .join(", ");
  p(`### ${key[0].toUpperCase()}${key.slice(1)} (used by ${users})`, "", "```text", arcOf(buildSystemPrompt(persona, "{REP NAME}")), "```", "");
}

p("---", "", "## Part 3: each persona's own text", "");

const list = (items: string[]) => items.map((i) => `- ${i}`);
PERSONAS.forEach((persona, i) => {
  p(
    `### ${i + 1}. ${persona.name}, ${persona.title}, ${persona.company} (${persona.gatekeeper ? "gatekeeper, " : ""}${persona.difficulty})`,
    "",
    `**Company line:** ${persona.industry}`,
    "",
    `**Answers the phone with:** "${persona.firstMessage}"`,
    "",
    `**Voice:** \`${persona.voiceId}\`, stability ${persona.voice.stability}, speed ${persona.voice.speed}`,
    "",
    `**Card text the rep sees:** ${persona.tagline}`,
    "",
    `**Personality:** ${persona.personality}`,
    "",
    `**How they talk:** ${persona.speech}`,
    "",
    `**What warms them up:** ${persona.warmsUpWhen}.`,
    "",
    `**Win condition:** ${persona.winCondition}`,
    "",
    "**Research facts** (confirmed when the rep cites them, never volunteered early):",
    "",
    ...list(persona.facts),
    "",
    "**Real situation** (revealed one piece at a time, only to good questions):",
    "",
    ...list(persona.painPoints),
    "",
    "**Pushback lines:**",
    "",
    ...persona.objections.map((o) => `- "${o}"`),
    "",
    "**How they react to specific moves:**",
    "",
    ...list(persona.reactions),
    "",
    `**What this persona drills** (shown to the scoring judge only, not to the agent): ${persona.drill}`,
    "",
  );
});

const dana = PERSONAS.find((x) => x.id === "cfo-hiring-freeze")!;
p(
  "---",
  "",
  "## Part 4: one fully assembled prompt (Dana Whitfield, rep named \"Era Hoxha\")",
  "",
  "```text",
  buildSystemPrompt(dana, "Era Hoxha"),
  "```",
  "",
);

console.log(out.join("\n"));
