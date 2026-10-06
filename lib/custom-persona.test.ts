import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOM_VOICES,
  assemblePersona,
  formatSignals,
  scrubDashes,
  type CustomPersonaInput,
  type GeneratedPersona,
} from "./custom-persona";
import { buildOverrides, buildSystemPrompt, callPersona, getPersona, personaBrief } from "./personas";

const DASHES = /[–—]/;

const input: CustomPersonaInput = {
  prospectName: "  Jordan Lee ",
  prospectTitle: "VP of Sales",
  company: "Acme Robotics",
  voice: "male",
  difficulty: "hard",
  signals: {
    jobPostings: "Two SDR roles on LinkedIn, posted three weeks ago, $70-80k OTE",
    funding: "Raised a $30M Series B in August",
  },
};

const generated: GeneratedPersona = {
  industry: "Warehouse robotics — ~200 employees, Series B",
  tagline: "New VP, building the SDR team from scratch.",
  drill: "Earning time from a new leader who is drowning in vendor pitches.",
  personality: "Direct and fast – hates fluff.",
  speech: "\"Yeah, go.\" \"What's the ask?\"",
  warmsUpWhen: "the rep names the SDR roles and asks how ramp is going.",
  facts: ["Acme posted two SDR roles on LinkedIn three weeks ago at $70-80k OTE.", "Jordan joined Acme as VP of Sales in July."],
  painPoints: ["Needs pipeline by Q1.", "Lost two candidates to competitors.", "Board is watching CAC."],
  objections: ["Send me an email.", "We're hiring in-house.", "Where are these people?", "I've got two minutes."],
  reactions: [
    "If the rep lays out burdened cost, do the math out loud.",
    "If the rep offers profiles in seventy-two hours with a review time, agree.",
    "If the rep claims SOC 2 certified, trust drops.",
    "If the rep explains pause-the-clock, accept it.",
  ],
  winCondition: "A twenty-minute call with Travis at a specific day and time.",
  firstMessage: "[flat] Yeah, Jordan Lee here, who is this calling please?",
  stability: 2,
  speed: 0.2,
};

describe("assemblePersona", () => {
  const p = assemblePersona("1b4e28ba-2fa1-11d2-883f-0016d3cca427", input, generated);

  it("takes identity from the rep's input and marks the persona custom", () => {
    assert.equal(p.id, "custom:1b4e28ba-2fa1-11d2-883f-0016d3cca427");
    assert.equal(p.custom, true);
    assert.equal(p.name, "Jordan Lee");
    assert.equal(p.company, "Acme Robotics");
    assert.equal(p.difficulty, "hard");
  });

  it("uses the voice for the chosen gender and clamps delivery", () => {
    assert.equal(p.voiceId, CUSTOM_VOICES.male.voiceId);
    assert.equal(assemblePersona("x", { ...input, voice: "female" }, generated).voiceId, CUSTOM_VOICES.female.voiceId);
    assert.deepEqual(p.voice, { stability: 0.8, speed: 0.9 });
  });

  it("keeps first messages short and tag-free", () => {
    assert.ok(!p.firstMessage.includes("["));
    assert.ok(p.firstMessage.split(/\s+/).length <= 8);
  });

  it("keeps every rep signal as a fact, without duplicating ones the builder kept", () => {
    assert.ok(p.facts.some((f) => f.includes("$30M Series B")), "dropped funding signal is restored");
    assert.equal(p.facts.filter((f) => f.includes("SDR roles")).length, 1);
  });

  it("strips em and en dashes everywhere, including the built prompt and judge brief", () => {
    const strings = Object.values(p).flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v : []));
    for (const s of strings) assert.ok(!DASHES.test(s), s);
    assert.ok(!DASHES.test(buildSystemPrompt(p, "Test Rep")));
    assert.ok(!DASHES.test(personaBrief(p)));
    assert.ok(!p.warmsUpWhen.endsWith("."));
  });

  it("builds overrides and tells the judge the facts came from research", () => {
    const o = buildOverrides(p, "Dren");
    assert.equal(o.tts.voiceId, p.voiceId);
    assert.ok(o.agent.prompt.prompt.includes("Acme Robotics"));
    assert.ok(personaBrief(p).includes("Custom persona"));
  });
});

describe("helpers", () => {
  it("formats only the signals the rep filled in", () => {
    assert.deepEqual(formatSignals({ ...input, signals: { funding: " x ", other: "  " } }), ["Funding: x"]);
  });

  it("scrubs dashes into commas", () => {
    assert.equal(scrubDashes("a — b–c"), "a, b, c");
  });

  it("resolves a call's persona from the snapshot first, then by id", () => {
    const p = assemblePersona("abc", input, generated);
    assert.equal(callPersona({ personaId: p.id, customPersona: p }), p);
    assert.equal(callPersona({ personaId: "gatekeeper-ea", customPersona: null }), getPersona("gatekeeper-ea"));
    assert.equal(callPersona({ personaId: "custom:gone", customPersona: null }), undefined);
  });
});
