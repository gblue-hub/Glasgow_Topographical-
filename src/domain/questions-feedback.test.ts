import { describe, expect, it } from "vitest";
import { explainSelectedDistractors, type SectionQuestion } from "./questions";
import type { LearningRecord } from "./types";

const record = (id: string, name: string, street: string): LearningRecord => ({
  id,
  type: "place",
  section: { code: "I", name: "PLACES" },
  exam_name: name,
  review_state: "reviewed",
  features: [{ index: 0, role: "street", exam_name: street, map_name: street, postcode: "", effective_coordinates: [-4.2, 55.8], road_link_id: null, spatial_status: "source" }],
});

describe("wrong-option teaching feedback", () => {
  it("identifies the record that owns a selected street distractor", () => {
    const records = [record("target", "Target Place", "Right Road"), record("owner", "Owner Place", "Wrong Road")];
    const question: SectionQuestion = { id: "q", association_id: "a", record_id: "target", direction: "category_to_streets", prompt: "Target Place", street_names: ["Right Road"], options: [{ id: "target:feature:0", label: "Right Road" }, { id: "owner:feature:0", label: "Wrong Road" }], answer_option_ids: ["target:feature:0"], selection_mode: "single" };
    expect(explainSelectedDistractors(question, ["owner:feature:0"], records)).toEqual([{ optionId: "owner:feature:0", selectedLabel: "Wrong Road", belongsTo: "Owner Place", associatedAnswers: ["Wrong Road"] }]);
  });

  it("explains the associations behind a selected category distractor", () => {
    const records = [record("target", "Target Place", "Right Road"), record("owner", "Owner Place", "Wrong Road")];
    const question: SectionQuestion = { id: "q", association_id: "a", record_id: "target", direction: "streets_to_category", prompt: "Right Road", street_names: ["Right Road"], options: [{ id: "target", label: "Target Place" }, { id: "owner", label: "Owner Place" }], answer_option_ids: ["target"], selection_mode: "single" };
    expect(explainSelectedDistractors(question, ["owner"], records)[0]).toMatchObject({ belongsTo: "Owner Place", associatedAnswers: ["Wrong Road"] });
  });
});
