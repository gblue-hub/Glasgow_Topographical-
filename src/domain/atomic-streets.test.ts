import { describe, expect, it } from "vitest";
import { atomicStreetAttempts } from "./atomic-streets";
import type { Association } from "./types";
import type { SectionQuestion } from "./questions";

const parent: Association = {
  id: "record:category-to-streets",
  record_id: "record",
  section_code: "A",
  kind: "category_to_streets",
  direction: "forward",
  prompt: "PLACE",
  answer: "ALPHA STREET | BETA ROAD",
  required: true,
  scope: "record_set",
  parent_association_id: null,
  feature_index: null,
};
const atom = (index: number, answer: string): Association => ({
  ...parent,
  id: `${parent.id}:feature:${index}`,
  answer,
  required: false,
  scope: "street",
  parent_association_id: parent.id,
  feature_index: index,
});
const question: SectionQuestion = {
  id: `question:${parent.id}`,
  association_id: parent.id,
  record_id: "record",
  direction: "category_to_streets",
  prompt: "PLACE",
  street_names: ["ALPHA STREET", "BETA ROAD"],
  options: [],
  answer_option_ids: ["record:feature:1", "record:feature:2"],
  selection_mode: "multiple",
};
const context = {
  exercise_family: "multiple_choice",
  used_reveal: false,
  latency_ms: 1200,
  confidence: 1 as const,
  created_at: "2026-07-13T12:00:00.000Z",
};

describe("atomic street evidence", () => {
  it("records only the omitted keyed street as incorrect", () => {
    const attempts = atomicStreetAttempts(
      parent,
      [atom(1, "ALPHA STREET"), atom(2, "BETA ROAD")],
      question,
      ["record:feature:1"],
      context,
    );
    expect(attempts.map(({ association_id, correct }) => ({ association_id, correct }))).toEqual([
      { association_id: `${parent.id}:feature:1`, correct: true },
      { association_id: `${parent.id}:feature:2`, correct: false },
    ]);
  });

  it("does not split reverse or already-atomic questions", () => {
    expect(atomicStreetAttempts({ ...parent, kind: "streets_to_category" }, [], question, [], context)).toEqual([]);
    expect(atomicStreetAttempts(atom(1, "ALPHA STREET"), [], question, [], context)).toEqual([]);
  });
});
