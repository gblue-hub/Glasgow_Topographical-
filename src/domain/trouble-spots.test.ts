import { describe, expect, it } from "vitest";
import { buildTroubleSpots } from "./trouble-spots";
import type { Association, Attempt } from "./types";

const associations: Association[] = ["recurring", "one-off", "unknown", "clean"].map((id) => ({
  id,
  record_id: `record:${id}`,
  section_code: "A",
  kind: "category_to_streets",
  direction: "forward",
  prompt: id,
  answer: `${id} answer`,
  required: true,
  scope: "record_set",
  parent_association_id: null,
  feature_index: null,
}));
const attempt = (association_id: string, correct: boolean, minute: number): Attempt => ({
  association_id,
  exercise_family: "multiple_choice",
  correct,
  used_reveal: false,
  latency_ms: 1000,
  confidence: correct ? 3 : 1,
  created_at: `2026-07-13T10:${String(minute).padStart(2, "0")}:00.000Z`,
});

describe("trouble spots", () => {
  it("separates recurring slips, one-off slips and answers not yet correct", () => {
    const spots = buildTroubleSpots(associations, [
      attempt("recurring", true, 1),
      attempt("recurring", false, 2),
      attempt("recurring", false, 3),
      attempt("one-off", true, 4),
      attempt("one-off", false, 5),
      attempt("unknown", false, 6),
      attempt("clean", true, 7),
    ]);
    expect(spots.map((spot) => [spot.association.id, spot.kind])).toEqual([
      ["recurring", "recurring_slip"],
      ["one-off", "one_off_slip"],
      ["unknown", "not_yet_secure"],
    ]);
    expect(spots[0].recentResults).toEqual([true, false, false]);
  });
  it("shows a missed street instead of its missed parent set", () => {
    const parent = associations[0];
    const street: Association = {
      ...parent,
      id: `${parent.id}:feature:2`,
      answer: "EXACT STREET",
      required: false,
      scope: "street",
      parent_association_id: parent.id,
      feature_index: 2,
    };
    const spots = buildTroubleSpots([parent, street], [
      attempt(parent.id, false, 1),
      attempt(street.id, false, 1),
    ]);
    expect(spots.map((spot) => spot.association.id)).toEqual([street.id]);
    expect(spots[0].association.answer).toBe("EXACT STREET");
  });
});
