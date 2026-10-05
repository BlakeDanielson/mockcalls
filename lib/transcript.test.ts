import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TranscriptEntry } from "@/db/schema";
import {
  appendLine,
  applyAgentCorrection,
  markLastAgentInterrupted,
  patchLastAgentLine,
} from "./transcript";

describe("appendLine", () => {
  it("keeps alternating lines regardless of any event id pairing", () => {
    // ElevenLabs gives the agent reply the same event id as the user turn;
    // the reducer must not care.
    let lines: TranscriptEntry[] = [];
    lines = appendLine(lines, "agent", "Dana Whitfield.", 0);
    lines = appendLine(lines, "user", "Hi Dana, this is Sam.", 2);
    lines = appendLine(lines, "agent", "Who's this?", 4);
    lines = appendLine(lines, "user", "Sam from Outsorcy.", 6);
    lines = appendLine(lines, "agent", "Never heard of it.", 8);
    assert.deepEqual(
      lines.map((e) => [e.role, e.message]),
      [
        ["agent", "Dana Whitfield."],
        ["user", "Hi Dana, this is Sam."],
        ["agent", "Who's this?"],
        ["user", "Sam from Outsorcy."],
        ["agent", "Never heard of it."],
      ],
    );
    assert.equal(lines.filter((e) => e.role === "agent").length, 3);
  });

  it("drops an identical consecutive repeat from the same role, once", () => {
    let lines: TranscriptEntry[] = [];
    lines = appendLine(lines, "user", "Do you have thirty seconds?", 3);
    const same = appendLine(lines, "user", "Do you have thirty seconds?", 3);
    assert.equal(same, lines);
    assert.equal(same.length, 1);
    // a different user line right after is a new entry (split turns)
    lines = appendLine(lines, "user", "Thirty seconds, that's it.", 5);
    assert.equal(lines.length, 2);
  });

  it("keeps the same text when the other role says it", () => {
    let lines: TranscriptEntry[] = [];
    lines = appendLine(lines, "user", "Tuesday at ten.", 30);
    lines = appendLine(lines, "agent", "Tuesday at ten.", 32);
    assert.equal(lines.length, 2);
  });

  it("strips delivery tags and drops a tag-only message", () => {
    let lines: TranscriptEntry[] = [];
    lines = appendLine(lines, "agent", "[impatient]", 10);
    assert.equal(lines.length, 0);
    lines = appendLine(lines, "agent", "[flat] Which company?", 12);
    assert.deepEqual(lines, [
      { role: "agent", message: "Which company?", timeInCallSecs: 12, interrupted: false },
    ]);
  });

  it("stamps user lines without an interrupted flag", () => {
    const lines = appendLine([], "user", "Hello", 1);
    assert.deepEqual(lines, [{ role: "user", message: "Hello", timeInCallSecs: 1 }]);
  });
});

describe("patching the last agent line", () => {
  const base: TranscriptEntry[] = [
    { role: "agent", message: "Dana Whitfield.", timeInCallSecs: 0, interrupted: false },
    { role: "user", message: "Hi Dana.", timeInCallSecs: 2 },
    { role: "agent", message: "Sales of what, exactly?", timeInCallSecs: 5, interrupted: false },
    { role: "user", message: "Staffing.", timeInCallSecs: 6 },
  ];

  it("flags the last agent line, not the first", () => {
    const out = markLastAgentInterrupted(base);
    assert.equal(out[0].interrupted, false);
    assert.equal(out[2].interrupted, true);
    assert.equal(out.length, 4);
  });

  it("replaces the last agent line's text on a correction", () => {
    const out = applyAgentCorrection(base, "[flat] Sales of ...");
    assert.equal(out[2].message, "Sales of ...");
    assert.equal(out[0].message, "Dana Whitfield.");
  });

  it("removes the last agent line when the correction is empty", () => {
    const out = applyAgentCorrection(base, "   ");
    assert.equal(out.length, 3);
    assert.deepEqual(
      out.map((e) => e.message),
      ["Dana Whitfield.", "Hi Dana.", "Staffing."],
    );
  });

  it("is a no-op when there is no agent line", () => {
    const only: TranscriptEntry[] = [{ role: "user", message: "Hello?", timeInCallSecs: 1 }];
    assert.equal(patchLastAgentLine(only, (e) => ({ ...e, message: "x" })), only);
  });
});
