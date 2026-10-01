import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bookedRate,
  dimensionAverage,
  hardestPersona,
  isThisWeek,
  perRep,
  talkShareAverage,
  topTag,
  weekStartKey,
  type CallLite,
} from "./analytics";

const TZ = "America/New_York";

let seq = 0;
function call(partial: Partial<CallLite> & { overall?: number; tags?: string[]; outcome?: string; notAssessed?: string[] }): CallLite {
  const { overall = 6, tags = [], outcome = "rejected", notAssessed = [], ...rest } = partial;
  return {
    id: `id-${seq++}`,
    userId: "u1",
    repName: "Rep",
    personaId: "busy-vp-ops",
    status: "scored",
    createdAt: new Date("2026-10-01T15:00:00Z"),
    transcriptSource: "elevenlabs",
    metrics: null,
    scorecard: {
      outcome: outcome as never,
      opener: 6,
      discovery: 6,
      objectionHandling: 6,
      close: 6,
      overall,
      strengths: [],
      improvements: [],
      coachingTip: "",
      summary: "",
      tags: tags as never,
      notAssessed: notAssessed as never,
      moments: [],
    },
    ...rest,
  };
}

describe("week boundaries in America/New_York", () => {
  it("Sunday 23:30 local is still the current week", () => {
    // 2026-10-04 23:30 EDT = 2026-10-05T03:30Z
    const now = new Date("2026-10-05T03:30:00Z");
    assert.equal(weekStartKey(now, TZ), "2026-09-28");
    assert.equal(isThisWeek(new Date("2026-09-28T04:00:00Z"), now, TZ), true); // Mon 00:00 local
    assert.equal(isThisWeek(new Date("2026-09-28T03:59:00Z"), now, TZ), false); // Sun 23:59 local
  });
  it("Monday 00:10 local starts a new week", () => {
    const now = new Date("2026-10-05T04:10:00Z");
    assert.equal(weekStartKey(now, TZ), "2026-10-05");
  });
  it("resolves the right Monday during the DST-end week", () => {
    const now = new Date("2026-11-04T17:00:00Z"); // Wed Nov 4, noon EST
    assert.equal(weekStartKey(now, TZ), "2026-11-02");
  });
});

describe("bookedRate", () => {
  it("is null with no scored calls and counts meetings + callbacks", () => {
    assert.equal(bookedRate([]).rate, null);
    assert.equal(bookedRate([call({ status: "failed", scorecard: null })]).rate, null);
    const r = bookedRate([
      call({ outcome: "meeting_booked" }),
      call({ outcome: "callback_agreed" }),
      call({ outcome: "rejected" }),
      call({ outcome: "info_requested" }),
    ]);
    assert.deepEqual(r, { booked: 2, scored: 4, rate: 0.5 });
  });
});

describe("hardestPersona", () => {
  it("needs three scored calls and breaks ties by count then persona order", () => {
    const rows = [
      call({ personaId: "skeptical-cfo", overall: 3 }),
      call({ personaId: "skeptical-cfo", overall: 3 }), // only 2 → ignored
      call({ personaId: "busy-vp-ops", overall: 5 }),
      call({ personaId: "busy-vp-ops", overall: 5 }),
      call({ personaId: "busy-vp-ops", overall: 5 }),
      call({ personaId: "gatekeeper", overall: 5 }),
      call({ personaId: "gatekeeper", overall: 5 }),
      call({ personaId: "gatekeeper", overall: 5 }),
      call({ personaId: "gatekeeper", overall: 5 }),
    ];
    assert.deepEqual(hardestPersona(rows), { personaId: "gatekeeper", avg: 5, n: 4 });
    assert.equal(hardestPersona(rows.slice(0, 2)), null);
  });
});

describe("topTag", () => {
  it("counts a tag once per call, respects polarity and breaks ties in taxonomy order", () => {
    const rows = [
      call({ tags: ["no_close_attempt", "no_close_attempt", "problem_question"] }),
      call({ tags: ["caved_on_objection", "problem_question"] }),
      call({ tags: ["caved_on_objection"] }),
      call({ tags: ["no_close_attempt"] }),
    ];
    assert.deepEqual(topTag(rows, "negative"), { tag: "caved_on_objection", count: 2, n: 4 });
    assert.deepEqual(topTag(rows, "positive"), { tag: "problem_question", count: 2, n: 4 });
    assert.equal(topTag([call({})], "negative"), null);
  });
});

describe("dimensionAverage", () => {
  it("excludes notAssessed calls for that key only", () => {
    const rows = [
      call({ overall: 8, notAssessed: ["close"] }),
      call({ overall: 4 }),
    ];
    assert.deepEqual(dimensionAverage(rows, "close"), { avg: 6, n: 1 });
    assert.deepEqual(dimensionAverage(rows, "overall"), { avg: 6, n: 2 });
  });
});

describe("talkShareAverage", () => {
  it("uses ElevenLabs-transcribed rows only", () => {
    const m = (sdrTalkShare: number | null) =>
      ({ sdrTalkShare }) as unknown as NonNullable<CallLite["metrics"]>;
    const rows = [
      call({ metrics: m(0.5) }),
      call({ metrics: m(0.7) }),
      call({ metrics: m(0.9), transcriptSource: "client" }),
      call({ metrics: null }),
    ];
    assert.deepEqual(talkShareAverage(rows), { avg: 0.6, n: 2 });
  });
});

describe("perRep", () => {
  it("lists every rep including ones with no calls this week", () => {
    const now = new Date("2026-10-01T16:00:00Z");
    const rows = [
      call({ userId: "u1", createdAt: new Date("2026-09-30T12:00:00Z"), overall: 8 }),
      call({ userId: "u1", createdAt: new Date("2026-09-20T12:00:00Z"), overall: 4 }),
    ];
    const stats = perRep(rows, [{ userId: "u1", repName: "Ann" }, { userId: "u2", repName: "Bob" }], now);
    assert.equal(stats[0].repName, "Ann");
    assert.equal(stats[0].thisWeek, 1);
    assert.equal(stats[0].allTime, 2);
    assert.equal(stats[0].avgOverall, 6);
    assert.equal(stats[1].repName, "Bob");
    assert.equal(stats[1].thisWeek, 0);
    assert.equal(stats[1].lastCall, null);
  });
});
