import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SKILL_TAGS, TAG_IDS, isSkillTag, tagMeta } from "./taxonomy";

const ORIGINAL_IDS = [
  "permission_opener",
  "relevant_hook",
  "problem_question",
  "built_on_answer",
  "objection_reframed",
  "specific_time_ask",
  "fake_familiarity",
  "pitched_before_discovery",
  "caved_on_objection",
  "argued_with_prospect",
  "ignored_buying_signal",
  "no_close_attempt",
];

describe("skill tags", () => {
  it("has unique snake_case ids and valid polarities", () => {
    assert.equal(new Set(TAG_IDS).size, TAG_IDS.length);
    for (const t of SKILL_TAGS) {
      assert.match(t.id, /^[a-z]+(_[a-z]+)*$/);
      assert.ok(t.polarity === "positive" || t.polarity === "negative");
      assert.ok(t.label.length > 0 && t.criterion.length > 40);
    }
  });

  it("never drops an id that stored scorecards may reference", () => {
    for (const id of ORIGINAL_IDS) assert.ok(isSkillTag(id), id);
    for (const id of [
      "qualified_budget",
      "burdened_cost_reframe",
      "model_explained",
      "profiles_offered",
      "looped_in_signer",
      "overpromised",
    ]) {
      assert.ok(isSkillTag(id), id);
    }
    assert.equal(tagMeta("overpromised").polarity, "negative");
  });

  it("has no em or en dashes in labels or criteria", () => {
    for (const t of SKILL_TAGS) {
      assert.ok(!/[–—]/.test(t.label), t.id);
      assert.ok(!/[–—]/.test(t.criterion), t.id);
    }
  });
});
