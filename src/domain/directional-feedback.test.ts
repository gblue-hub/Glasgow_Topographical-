import { describe, expect, it } from "vitest";
import { buildDirectionalFeedback } from "./directional-feedback";
import type { Association, Attempt, LearningRecord } from "./types";

const record = (id: string): LearningRecord => ({
  id,
  type: "district",
  section: { code: "A", name: "DISTRICTS (EAST)" },
  exam_name: id,
  review_state: "reviewed",
  features: [],
});
const association = (recordId: string, direction: "forward" | "reverse"): Association => ({
  id: `${recordId}:${direction}`,
  record_id: recordId,
  section_code: "A",
  kind: direction === "forward" ? "category_to_streets" : "streets_to_category",
  direction,
  prompt: direction === "forward" ? recordId : `${recordId} roads`,
  answer: direction === "forward" ? `${recordId} roads` : recordId,
  required: true,
  scope: "record_set",
  parent_association_id: null,
  feature_index: null,
});
const attempt = (
  associationId: string,
  correct: boolean,
  minute: number,
  extra: Partial<Attempt> = {},
): Attempt => ({
  association_id: associationId,
  exercise_family: "multiple_choice",
  correct,
  used_reveal: false,
  latency_ms: 1000,
  confidence: correct ? 3 : 1,
  created_at: `2026-07-13T10:${String(minute).padStart(2, "0")}:00.000Z`,
  ...extra,
});

describe("directional feedback", () => {
  it("distinguishes misses in both directions from either direction alone", () => {
    const records = [record("both"), record("forward"), record("reverse")];
    const associations = records.flatMap((item) => [association(item.id, "forward"), association(item.id, "reverse")]);
    const items = buildDirectionalFeedback(records, associations, [
      attempt("both:forward", false, 1),
      attempt("both:reverse", false, 2),
      attempt("forward:forward", false, 3),
      attempt("forward:reverse", true, 4),
      attempt("reverse:forward", true, 5),
      attempt("reverse:reverse", false, 6),
    ]);
    expect(items.map((item) => [item.record.id, item.pattern])).toEqual([
      ["both", "both_latest_wrong"],
      ["reverse", "reverse_latest_wrong"],
      ["forward", "forward_latest_wrong"],
    ]);
  });

  it("shows recovery and help without erasing the recorded miss", () => {
    const itemRecord = record("item");
    const associations = [association("item", "forward"), association("item", "reverse")];
    const [item] = buildDirectionalFeedback([itemRecord], associations, [
      attempt("item:forward", false, 1),
      attempt("item:forward", true, 2),
      attempt("item:reverse", true, 3, { used_reveal: true }),
    ]);
    expect(item.pattern).toBe("assisted_only");
    expect(item.forward).toMatchObject({ status: "recovered", correctAttempts: 1, incorrectAttempts: 1 });
    expect(item.reverse).toMatchObject({ status: "assisted_only", helpedAttempts: 1 });
  });

  it("excludes correction-round attempts from the directional diagnosis", () => {
    const itemRecord = record("item");
    const associations = [association("item", "forward"), association("item", "reverse")];
    const [item] = buildDirectionalFeedback([itemRecord], associations, [
      attempt("item:forward", false, 1),
      attempt("item:forward", true, 2, { phase: "correction" }),
    ]);
    expect(item.forward).toMatchObject({ status: "last_wrong", attemptCount: 1, incorrectAttempts: 1 });
    expect(item.forward.recentResults).toEqual([{ correct: false, usedReveal: false }]);
  });

  it("does not describe an untested opposite direction as correct", () => {
    const itemRecord = record("item");
    const associations = [association("item", "forward"), association("item", "reverse")];
    const [item] = buildDirectionalFeedback([itemRecord], associations, [
      attempt("item:forward", false, 1, { phase: "first_pass" }),
    ]);
    expect(item.pattern).toBe("one_direction_unattempted");
    expect(item.reverse.status).toBe("not_tried");
  });

  it("surfaces a repeatedly selected alternative record as a confusion pair", () => {
    const target = record("target");
    const alternative = record("alternative");
    const associations = [association("target", "forward"), association("target", "reverse")];
    const [item] = buildDirectionalFeedback([target, alternative], associations, [
      attempt("target:forward", false, 1, { phase: "first_pass", selected_option_ids: ["alternative:feature:0"], keyed_option_ids: ["target:feature:0"] }),
      attempt("target:forward", false, 2, { phase: "first_pass", selected_option_ids: ["alternative:feature:1"], keyed_option_ids: ["target:feature:0"] }),
    ]);
    expect(item.confusionPairs).toEqual([{ recordId: "alternative", examName: "alternative", count: 2, directions: ["forward"] }]);
  });
});
