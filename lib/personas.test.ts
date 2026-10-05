import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PERSONAS,
  RETIRED_PERSONAS,
  buildOverrides,
  buildSystemPrompt,
  getPersona,
  personaBrief,
  type Persona,
} from "./personas";

const ALL = [...PERSONAS, ...RETIRED_PERSONAS];
const DASHES = /[–—]/;
const RANK = { easy: 0, medium: 1, hard: 2 } as const;

function stringsOf(p: Persona): string[] {
  const out: string[] = [];
  for (const v of Object.values(p)) {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === "string"));
  }
  return out;
}

describe("persona integrity", () => {
  it("has unique ids, retired ids only in the retired list, and resolves all of them", () => {
    const ids = ALL.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(PERSONAS.every((p) => !p.retired));
    assert.ok(RETIRED_PERSONAS.every((p) => p.retired));
    for (const id of ["skeptical-cfo", "busy-vp-ops", "noncommittal-manager", "gatekeeper"]) {
      assert.ok(getPersona(id)?.retired, `${id} should resolve as retired`);
    }
    assert.equal(getPersona("nope"), undefined);
  });

  it("orders the picker easy, then medium, then hard", () => {
    const ranks = PERSONAS.map((p) => RANK[p.difficulty]);
    for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i] >= ranks[i - 1]);
    assert.equal(PERSONAS[0].difficulty, "easy");
  });

  it("keeps every string free of em and en dashes, including the built prompt and brief", () => {
    for (const p of ALL) {
      for (const s of stringsOf(p)) assert.ok(!DASHES.test(s), `${p.id}: ${s}`);
      assert.ok(!DASHES.test(buildSystemPrompt(p, "Test Rep")), `${p.id} prompt`);
      assert.ok(!DASHES.test(personaBrief(p)), `${p.id} brief`);
    }
  });

  it("keeps first messages short and tag-free, and voice settings in range", () => {
    for (const p of ALL) {
      assert.ok(p.firstMessage.split(/\s+/).length <= 8, `${p.id} first message too long`);
      assert.ok(!p.firstMessage.includes("["), `${p.id} first message has a tag`);
      assert.ok(p.voice.stability >= 0 && p.voice.stability <= 1, `${p.id} stability`);
      assert.ok(p.voice.speed >= 0.7 && p.voice.speed <= 1.2, `${p.id} speed`);
      assert.ok(p.voiceId.length >= 20, `${p.id} voice id`);
    }
  });

  it("gives every active persona facts, objections, pains, reactions and a drill", () => {
    for (const p of PERSONAS) {
      assert.ok(p.facts.length >= 4, `${p.id} facts`);
      assert.ok(p.objections.length >= 4, `${p.id} objections`);
      assert.ok(p.painPoints.length >= 3, `${p.id} pains`);
      assert.ok(p.reactions.length >= 4, `${p.id} reactions`);
      assert.ok(p.drill.length > 20, `${p.id} drill`);
    }
  });
});

describe("buildSystemPrompt", () => {
  it("renders the research facts, the rep name, Outsorcy and the leak guardrail", () => {
    const p = getPersona("cfo-hiring-freeze")!;
    const prompt = buildSystemPrompt(p, "Arta Krasniqi");
    assert.ok(prompt.includes("# What you know"));
    for (const f of p.facts) assert.ok(prompt.includes(f));
    assert.ok(prompt.includes("Arta Krasniqi"));
    assert.ok(prompt.includes("Outsorcy"));
    assert.ok(prompt.includes("Never say Outsorcy, Kosovo, Pristina"));
    assert.ok(prompt.includes("# Reacting to what the rep says"));
    for (const r of p.reactions) assert.ok(prompt.includes(r));
  });

  it("uses the gatekeeper arc for the EA and the difficulty arc otherwise", () => {
    const tom = buildSystemPrompt(getPersona("gatekeeper-ea")!, "Dren");
    assert.ok(tom.includes("Is she expecting your call?"));
    assert.ok(!tom.includes("ninety seconds"));
    const rachel = buildSystemPrompt(getPersona("head-of-people")!, "Rina");
    assert.ok(rachel.includes("ninety seconds"));
  });

  it("still builds a prompt for a retired persona without facts", () => {
    const prompt = buildSystemPrompt(getPersona("skeptical-cfo")!, "Blake");
    assert.ok(prompt.includes("- Nothing specific."));
    assert.ok(!prompt.includes("How you in particular react"));
  });

  it("builds overrides with the persona voice", () => {
    const p = getPersona("burned-vp-sales")!;
    const o = buildOverrides(p, "Dren");
    assert.equal(o.tts.voiceId, p.voiceId);
    assert.equal(o.agent.firstMessage, p.firstMessage);
    assert.ok(o.agent.prompt.prompt.startsWith("# Personality"));
  });
});

describe("personaBrief", () => {
  it("flags the gatekeeper and retired personas and includes facts and reactions", () => {
    assert.ok(personaBrief(getPersona("gatekeeper-ea")!).includes("gatekeeper"));
    assert.ok(personaBrief(getPersona("gatekeeper")!).includes("Retired"));
    const brief = personaBrief(getPersona("freelancer-founder")!);
    assert.ok(brief.includes("Research facts"));
    assert.ok(brief.includes("How they react"));
    assert.ok(brief.includes("What this persona drills"));
  });
});
