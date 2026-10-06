// Research a real prospect and print the persona, without the database or the
// app. Use it to check research quality before reps rely on it.
//   pnpm custom-persona --name "Jordan Lee" --title "VP of Sales" --company "Acme Robotics" \
//     [--website acme.com] [--linkedin URL] [--voice male|female] [--difficulty easy|medium|hard] \
//     [--jobs "..."] [--leadership "..."] [--funding "..."] [--growth "..."] [--other "..."] [--prompt]
// Needs ANTHROPIC_API_KEY (and ANTHROPIC_WORKSPACE_ID if the key is unscoped).
import { parseArgs } from "node:util";
import { buildCustomPersona, type CustomPersonaInput } from "@/lib/custom-persona";
import { buildSystemPrompt } from "@/lib/personas";

const { values: v } = parseArgs({
  options: {
    name: { type: "string" },
    title: { type: "string" },
    company: { type: "string" },
    website: { type: "string" },
    linkedin: { type: "string" },
    voice: { type: "string", default: "female" },
    difficulty: { type: "string", default: "medium" },
    jobs: { type: "string" },
    leadership: { type: "string" },
    funding: { type: "string" },
    growth: { type: "string" },
    other: { type: "string" },
    notes: { type: "string" },
    prompt: { type: "boolean", default: false },
  },
});

if (!v.name || !v.title || !v.company) {
  console.error("--name, --title and --company are required");
  process.exit(1);
}

const input: CustomPersonaInput = {
  prospectName: v.name,
  prospectTitle: v.title,
  company: v.company,
  website: v.website,
  linkedin: v.linkedin,
  voice: v.voice === "male" ? "male" : "female",
  difficulty: v.difficulty === "easy" || v.difficulty === "hard" ? v.difficulty : "medium",
  notes: v.notes,
  signals: Object.fromEntries(
    (
      [
        ["jobPostings", v.jobs],
        ["leadershipChange", v.leadership],
        ["funding", v.funding],
        ["growth", v.growth],
        ["other", v.other],
      ] as const
    ).filter(([, s]) => s),
  ),
};

const started = Date.now();
const { persona, research } = await buildCustomPersona("dry-run", input);
console.log(`# Research (${Math.round((Date.now() - started) / 1000)}s)\n\n${research.dossier}\n`);
console.log(`# Sources\n${research.sources.map((s) => `- ${s.title}: ${s.url}`).join("\n")}\n`);
console.log(`# Persona\n${JSON.stringify(persona, null, 2)}`);
if (v.prompt) console.log(`\n# System prompt\n${buildSystemPrompt(persona, "Test Rep")}`);
