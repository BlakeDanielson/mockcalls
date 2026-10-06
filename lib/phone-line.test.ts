import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LANDLINE, mulawCurve } from "./phone-line";

describe("mulawCurve", () => {
  const curve = mulawCurve();

  it("maps the ends and the middle exactly", () => {
    assert.equal(curve.length, 65536);
    assert.ok(Math.abs(curve[0] + 1) < 1e-9);
    assert.ok(Math.abs(curve[curve.length - 1] - 1) < 1e-9);
    assert.equal(Math.abs(curve[32767]) < 1e-3, true);
  });

  it("never reverses direction and stays in range", () => {
    for (let i = 1; i < curve.length; i++) {
      assert.ok(curve[i] >= curve[i - 1] - 1e-12, `decreases at ${i}`);
      assert.ok(Math.abs(curve[i]) <= 1 + 1e-9);
    }
  });

  it("quantizes to 8-bit mu-law levels (at most 255 distinct values)", () => {
    const levels = new Set(Array.from(curve, (v) => v.toFixed(7)));
    assert.ok(levels.size <= 255, `${levels.size} levels`);
    assert.ok(levels.size > 200, `${levels.size} levels`);
  });

  it("keeps quiet speech finer than loud speech", () => {
    // mu-law steps are small near zero and large near full scale
    const step = (x: number) => {
      const i = Math.round(((x + 1) / 2) * (curve.length - 1));
      let j = i;
      while (j < curve.length - 1 && curve[j] === curve[i]) j++;
      return curve[j] - curve[i];
    };
    assert.ok(step(0.01) < step(0.9) / 10);
  });
});

describe("LANDLINE preset", () => {
  it("is real telephone bandwidth", () => {
    assert.equal(LANDLINE.sampleRate, 8000);
    assert.ok(LANDLINE.low >= 250 && LANDLINE.low <= 350);
    assert.ok(LANDLINE.high <= LANDLINE.sampleRate / 2 && LANDLINE.high >= 3000);
    assert.equal(LANDLINE.mulaw, true);
  });
});
