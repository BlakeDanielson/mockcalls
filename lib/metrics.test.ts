import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TranscriptEntry } from "@/db/schema";
import {
  classifyQuestion,
  computeMetrics,
  mapTerminationReason,
  splitSentences,
} from "./metrics";

const t = (
  role: "user" | "agent",
  timeInCallSecs: number,
  message: string,
  interrupted?: boolean,
): TranscriptEntry =>
  interrupted === undefined
    ? { role, message, timeInCallSecs }
    : { role, message, timeInCallSecs, interrupted };

// Hand-counted fixture: 3 SDR turns (40 words), 4 prospect turns (17 words).
const FIXTURE_1: TranscriptEntry[] = [
  t("agent", 0, "Dana Whitfield.", false),
  t("user", 2, "Hi Dana, this is Sam from Acme. Do you have thirty seconds?"),
  t("agent", 7, "Thirty seconds. Go.", false),
  t("user", 9, "We help logistics CFOs cut carrier costs. What is your biggest margin pressure right now?"),
  t("agent", 27, "Carrier rates. But we're not evaluating anything this quarter.", true),
  t("user", 31, "Totally fair. Can I send a one-pager and call you Tuesday at ten?"),
  t("agent", 38, "Fine. Tuesday. Goodbye.", false),
];

const approx = (a: number | null, b: number) => {
  assert.ok(a !== null, "expected a number");
  assert.ok(Math.abs(a - b) < 0.005, `${a} ≈ ${b}`);
};

describe("computeMetrics — fixture 1 (ElevenLabs source)", () => {
  const m = computeMetrics({
    transcript: FIXTURE_1,
    durationSecs: 40,
    terminationReason: "agent_end_call",
    source: "elevenlabs",
  });
  it("counts turns and words", () => {
    assert.deepEqual(m.turns, { sdr: 3, prospect: 4 });
    assert.equal(m.sdrWords, 40);
    assert.equal(m.prospectWords, 17);
    approx(m.sdrWordShare, 40 / 57);
  });
  it("estimates talk time with the two-sided clamp", () => {
    // per-turn secs: 2, 5, 2, 13 (upper clamp binds on an 18 s gap), 4, 7, 2
    assert.equal(m.sdrTalkSecs, 25);
    assert.equal(m.prospectTalkSecs, 10);
    approx(m.sdrTalkShare, 25 / 35);
    assert.equal(m.sdrWpm, 96);
  });
  it("finds the longest monologue", () => {
    assert.deepEqual(m.longestMonologue, { turnIndex: 3, words: 15, secs: 13 });
  });
  it("counts and classifies questions", () => {
    assert.deepEqual(m.questions, { total: 3, open: 1, closed: 2 });
    assert.equal(m.firstQuestionAtSecs, 2);
    assert.equal(m.firstOpenQuestionAtSecs, 9);
  });
  it("counts interruptions from prospect flags", () => {
    assert.equal(m.interruptions, 1);
  });
  it("maps who ended the call", () => {
    assert.equal(m.endedBy, "prospect");
  });
  it("is identical after a jsonb round-trip", () => {
    const again = computeMetrics({
      transcript: JSON.parse(JSON.stringify(FIXTURE_1)),
      durationSecs: 40,
      terminationReason: "agent_end_call",
      source: "elevenlabs",
    });
    assert.deepEqual(again, m);
  });
});

describe("computeMetrics — fixture 1 as a client transcript", () => {
  const m = computeMetrics({
    transcript: FIXTURE_1,
    durationSecs: 40,
    terminationReason: "client:user",
    source: "client",
  });
  it("leaves time-based fields null and word-based fields intact", () => {
    assert.equal(m.sdrTalkSecs, null);
    assert.equal(m.prospectTalkSecs, null);
    assert.equal(m.sdrTalkShare, null);
    assert.equal(m.sdrWpm, null);
    assert.deepEqual(m.longestMonologue, { turnIndex: 3, words: 15, secs: null });
    approx(m.sdrWordShare, 40 / 57);
    assert.deepEqual(m.questions, { total: 3, open: 1, closed: 2 });
    assert.equal(m.interruptions, 1);
    assert.equal(m.endedBy, "sdr");
  });
});

describe("computeMetrics — fixture 2 (monologue merge, lower clamp)", () => {
  const base: TranscriptEntry[] = [
    t("agent", 0, "Hello?"),
    t("user", 2, "Hi, this is Sam from Acme about your dispatch scheduling."),
    t("user", 9, "Most ops leaders tell me no-shows are brutal."),
    t("agent", 14, "Yeah, they are."),
  ];
  it("merges consecutive SDR turns into one monologue", () => {
    const m = computeMetrics({ transcript: base, durationSecs: 16, terminationReason: null, source: "elevenlabs" });
    assert.deepEqual(m.longestMonologue, { turnIndex: 1, words: 18, secs: 12 });
    approx(m.sdrTalkShare, 12 / 16);
    assert.equal(m.sdrWpm, 90);
    assert.deepEqual(m.questions, { total: 0, open: 0, closed: 0 }); // "Hello?" is the prospect's
    assert.equal(m.firstQuestionAtSecs, null);
    assert.equal(m.interruptions, null); // no prospect turn carries a flag
    assert.equal(m.endedBy, "unknown");
  });
  it("never yields a zero-length turn on same-second stamps and keeps order", () => {
    const sameSecond = base.map((e, i) => (i === 2 ? { ...e, timeInCallSecs: 2 } : e));
    const m = computeMetrics({ transcript: sameSecond, durationSecs: 16, terminationReason: null, source: "elevenlabs" });
    // #1 gap 0 → lower clamp 2.5; #2 gap 12 → upper clamp 8.33
    approx(m.sdrTalkSecs, 10.8);
    assert.equal(m.longestMonologue?.turnIndex, 1);
    assert.ok((m.sdrWpm ?? 0) > 0 && Number.isFinite(m.sdrWpm));
  });
});

describe("computeMetrics — edge cases", () => {
  it("handles an empty transcript", () => {
    const m = computeMetrics({ transcript: [], durationSecs: null, terminationReason: "client:agent", source: "elevenlabs" });
    assert.deepEqual(m.turns, { sdr: 0, prospect: 0 });
    assert.equal(m.sdrWordShare, null);
    assert.equal(m.sdrTalkShare, null);
    assert.equal(m.longestMonologue, null);
    assert.equal(m.interruptions, null);
    assert.equal(m.sdrWpm, null);
    assert.equal(m.endedBy, "prospect");
  });
  it("gives a lone prospect turn at t=0 a talk share of 0 for the SDR, not null", () => {
    const m = computeMetrics({ transcript: [t("agent", 0, "Hello there.", false)], durationSecs: 0, terminationReason: null, source: "elevenlabs" });
    assert.equal(m.sdrWordShare, 0);
    assert.equal(m.sdrTalkShare, 0);
    assert.equal(m.interruptions, 0);
  });
  it("tolerates non-monotonic stamps and a null duration", () => {
    const m = computeMetrics({
      transcript: [t("user", 5, "Quick one."), t("agent", 3, "Go ahead.", false), t("user", 9, "Do you handle dispatch")],
      durationSecs: null,
      terminationReason: null,
      source: "elevenlabs",
    });
    assert.ok((m.sdrTalkSecs ?? -1) > 0);
    assert.ok((m.prospectTalkSecs ?? -1) > 0);
    assert.deepEqual(m.questions, { total: 1, open: 0, closed: 1 });
  });
  it("reports null interruptions when no prospect flags exist and 0 when all are false", () => {
    const noFlags = FIXTURE_1.map((e) => ({ role: e.role, message: e.message, timeInCallSecs: e.timeInCallSecs }));
    assert.equal(computeMetrics({ transcript: noFlags, durationSecs: 40, terminationReason: null, source: "elevenlabs" }).interruptions, null);
    const allFalse = FIXTURE_1.map((e) => (e.role === "agent" ? { ...e, interrupted: false } : e));
    assert.equal(computeMetrics({ transcript: allFalse, durationSecs: 40, terminationReason: null, source: "elevenlabs" }).interruptions, 0);
  });
});

describe("question heuristics", () => {
  const q = (s: string) => {
    const sentences = splitSentences(s);
    return sentences.map((x, i) => classifyQuestion(x, i === sentences.length - 1 && !/[.!?]$/.test(x)));
  };
  it("classifies open vs closed and handles fillers", () => {
    assert.deepEqual(q("Right?"), ["closed"]);
    assert.deepEqual(q("So, what's your setup?"), ["open"]);
    assert.deepEqual(q("Tell me about dispatch?"), ["open"]);
    assert.deepEqual(q("Can we talk Thursday?"), ["closed"]);
    assert.deepEqual(q("When works for you?"), ["closed"]);
  });
  it("counts one question per question sentence", () => {
    assert.deepEqual(q("Do you have 30s, and what would help?"), ["closed"]);
  });
  it("falls back on an unpunctuated trailing fragment only", () => {
    assert.deepEqual(q("Do you have a minute"), ["closed"]);
    assert.deepEqual(q("Hi Dana this is Sam"), [null]);
    assert.deepEqual(q("Thanks. What would help"), [null, "open"]);
  });
});

describe("mapTerminationReason", () => {
  it("maps client hints, known patterns and unknowns", () => {
    assert.equal(mapTerminationReason(null), "unknown");
    assert.equal(mapTerminationReason("client:user"), "sdr");
    assert.equal(mapTerminationReason("client:agent"), "prospect");
    assert.equal(mapTerminationReason("client:error"), "unknown");
    assert.equal(mapTerminationReason("inactivity timeout"), "timeout");
    assert.equal(mapTerminationReason("end_call tool was called"), "prospect");
    assert.equal(mapTerminationReason("Client disconnected"), "sdr");
    assert.equal(mapTerminationReason("something else"), "unknown");
  });
});
