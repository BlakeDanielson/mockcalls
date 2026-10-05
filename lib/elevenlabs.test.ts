import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { toTranscript, waitForDone, type ElevenLabsConversation } from "./elevenlabs";

process.env.ELEVENLABS_API_KEY ??= "test-key";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Step = { status: number; body: unknown };
function stubFetch(steps: Step[]) {
  let i = 0;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    return new Response(JSON.stringify(step.body), {
      status: step.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

const convo = (status: ElevenLabsConversation["status"]): ElevenLabsConversation => ({
  status,
  transcript:
    status === "done"
      ? [
          { role: "agent", message: "Dana Whitfield.", time_in_call_secs: 0, interrupted: false },
          { role: "user", message: "Hi Dana.", time_in_call_secs: 2 },
        ]
      : [],
  metadata: status === "done" ? { call_duration_secs: 40, termination_reason: "end_call tool was called." } : {},
});

describe("waitForDone", () => {
  it("returns the conversation once it is done", async () => {
    const calls = stubFetch([
      { status: 200, body: convo("processing") },
      { status: 200, body: convo("processing") },
      { status: 200, body: convo("done") },
    ]);
    const out = await waitForDone("conv_1", { attempts: 5, delayMs: 1 });
    assert.equal(out?.status, "done");
    assert.equal(calls.length, 3);
  });

  it("survives a transient 5xx and keeps polling", async () => {
    stubFetch([
      { status: 500, body: { detail: "boom" } },
      { status: 200, body: convo("done") },
    ]);
    const out = await waitForDone("conv_2", { attempts: 3, delayMs: 1 });
    assert.equal(out?.status, "done");
  });

  it("returns null when attempts run out", async () => {
    const calls = stubFetch([{ status: 200, body: convo("processing") }]);
    const out = await waitForDone("conv_3", { attempts: 4, delayMs: 1 });
    assert.equal(out, null);
    assert.equal(calls.length, 4);
  });

  it("returns null immediately on a failed conversation", async () => {
    const calls = stubFetch([{ status: 200, body: convo("failed") }]);
    const out = await waitForDone("conv_4", { attempts: 4, delayMs: 1 });
    assert.equal(out, null);
    assert.equal(calls.length, 1);
  });
});

describe("toTranscript", () => {
  it("drops empty and tool turns, strips tags, flags only agent turns", () => {
    const out = toTranscript({
      status: "done",
      transcript: [
        { role: "agent", message: "[sighs] Dana Whitfield.", time_in_call_secs: 0, interrupted: false },
        { role: "user", message: "Hi.", time_in_call_secs: 2 },
        { role: "agent", message: null, time_in_call_secs: 5 },
        { role: "agent", message: "I'm going to stop you there.", time_in_call_secs: 8, interrupted: true },
      ],
    });
    assert.deepEqual(out, [
      { role: "agent", message: "Dana Whitfield.", timeInCallSecs: 0, interrupted: false },
      { role: "user", message: "Hi.", timeInCallSecs: 2 },
      { role: "agent", message: "I'm going to stop you there.", timeInCallSecs: 8, interrupted: true },
    ]);
  });
});
