import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COACH_SYSTEM_PROMPT, normalizeScorecard } from "./scoring";
import { SKILL_TAGS } from "./taxonomy";

// Importing lib/scoring needs no ANTHROPIC_API_KEY: the client is built inside scoreCall.

const base = {
  outcome: "rejected" as const,
  opener: 7,
  discovery: 6,
  objectionHandling: 5,
  close: 4,
  overall: 6,
  strengths: ["a", "b", "c", "d", "e", "f"],
  improvements: ["x"],
  coachingTip: "tip",
  summary: "summary",
  notAssessed: [] as string[],
  moments: [] as { type: string; turnIndex: number; note: string }[],
  tags: [] as string[],
};

describe("normalizeScorecard", () => {
  it("clamps scores, caps lists, drops unknown tags and coerces moment types", () => {
    const s = normalizeScorecard(
      {
        ...base,
        overall: 11,
        tags: ["problem_question", "bogus_tag", "problem_question", "no_close_attempt"],
        moments: [
          { type: "opener", turnIndex: 0, note: "You opened cleanly." },
          { type: "zzz", turnIndex: 2, note: "Something happened." },
          { type: "opener", turnIndex: 1, note: "duplicate opener" },
          { type: "close_attempt", turnIndex: 99, note: "You asked for Tuesday." },
          { type: "best_question", turnIndex: Number.NaN, note: "dropped" },
          { type: "first_objection", turnIndex: 4, note: "   " },
        ],
      },
      7,
    );
    assert.equal(s.overall, 10);
    assert.equal(s.strengths.length, 4);
    assert.deepEqual(s.tags, ["problem_question", "no_close_attempt"]); // taxonomy order, deduped
    assert.deepEqual(
      s.moments.map((m) => [m.type, m.turnIndex]),
      [
        ["opener", 0],
        ["other", 2],
        ["close_attempt", 6], // 99 clamped to n-1
      ],
    );
  });

  it("forces notAssessed dimensions to 5 and ignores unknown dimensions", () => {
    const s = normalizeScorecard({ ...base, close: 1, notAssessed: ["close", "bogus", "close"] }, 3);
    assert.deepEqual(s.notAssessed, ["close"]);
    assert.equal(s.close, 5);
    assert.equal(s.opener, 7);
  });

  it("allows two 'other' moments, caps at eight and sorts by turn", () => {
    const moments = Array.from({ length: 12 }, (_, i) => ({
      type: i % 2 ? "other" : "opener",
      turnIndex: 11 - i,
      note: `note ${i}`,
    }));
    const s = normalizeScorecard({ ...base, moments }, 20);
    assert.equal(s.moments.filter((m) => m.type === "other").length, 2);
    assert.equal(s.moments.filter((m) => m.type === "opener").length, 1);
    const idx = s.moments.map((m) => m.turnIndex);
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
    assert.ok(s.moments.length <= 8);
  });

  it("drops every moment when the transcript is empty", () => {
    const s = normalizeScorecard({ ...base, moments: [{ type: "opener", turnIndex: 0, note: "n" }] }, 0);
    assert.deepEqual(s.moments, []);
  });
});

describe("COACH_SYSTEM_PROMPT", () => {
  it("carries the offering brief, the hard limits, every tag id and no dashes", () => {
    assert.ok(COACH_SYSTEM_PROMPT.includes("Offering brief"));
    assert.ok(COACH_SYSTEM_PROMPT.includes("SOC 2 certification"));
    assert.ok(COACH_SYSTEM_PROMPT.includes("Travis"));
    for (const t of SKILL_TAGS) assert.ok(COACH_SYSTEM_PROMPT.includes(`- ${t.id} (`), t.id);
    assert.ok(!/[\u2013\u2014]/.test(COACH_SYSTEM_PROMPT));
  });
});
