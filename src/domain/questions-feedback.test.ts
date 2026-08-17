import { describe, expect, it } from "vitest";
import { explainSelectedDistractors, questionMapAssociations, type SectionQuestion } from "./questions";
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
    expect(explainSelectedDistractors(question, ["owner:feature:0"], records)).toEqual([{ optionId: "owner:feature:0", recordId: "owner", selectedLabel: "Wrong Road", belongsTo: "Owner Place", associatedAnswers: ["Wrong Road"] }]);
  });

  it("explains the associations behind a selected category distractor", () => {
    const records = [record("target", "Target Place", "Right Road"), record("owner", "Owner Place", "Wrong Road")];
    const question: SectionQuestion = { id: "q", association_id: "a", record_id: "target", direction: "streets_to_category", prompt: "Right Road", street_names: ["Right Road"], options: [{ id: "target", label: "Target Place" }, { id: "owner", label: "Owner Place" }], answer_option_ids: ["target"], selection_mode: "single" };
    expect(explainSelectedDistractors(question, ["owner"], records)[0]).toMatchObject({ recordId: "owner", belongsTo: "Owner Place", associatedAnswers: ["Wrong Road"] });
  });

  it("maps only the exact street options in category-to-streets feedback", () => {
    const records = [record("target", "Target Place", "Right Road"), record("owner", "Owner Place", "Wrong Road")];
    const question: SectionQuestion = { id: "q", association_id: "a", record_id: "target", direction: "category_to_streets", prompt: "Target Place", street_names: ["Right Road"], options: [{ id: "target:feature:0", label: "Right Road" }, { id: "owner:feature:0", label: "Wrong Road" }], answer_option_ids: ["target:feature:0"], selection_mode: "single" };
    expect(questionMapAssociations(question, ["owner:feature:0"], records)).toEqual([{ record: records[1], featureIndices: [0] }]);
  });

  it("maps the prompted correct street and the selected category relationship", () => {
    const target = record("target", "Target Place", "Right Road");
    target.features.push({ ...target.features[0], index: 1, exam_name: "Other Right Road", map_name: "Other Right Road" });
    const owner = record("owner", "Owner Place", "Wrong Road");
    const question: SectionQuestion = { id: "q", association_id: "a", record_id: "target", direction: "streets_to_category", prompt: "Right Road", street_names: ["Right Road"], options: [{ id: "target", label: "Target Place" }, { id: "owner", label: "Owner Place" }], answer_option_ids: ["target"], selection_mode: "single" };
    expect(questionMapAssociations(question, ["target"], [target, owner])[0].featureIndices).toEqual([0]);
    expect(questionMapAssociations(question, ["owner"], [target, owner])[0].featureIndices).toEqual([0]);
  });

  it("includes the target street for middle-road associations but not districts", () => {
    const middleRoad = record("middle", "Target Street", "Associated Street");
    middleRoad.type = "middle_road";
    middleRoad.features.push({ ...middleRoad.features[0], index: 1, role: "middle_road", exam_name: "Target Street", map_name: "Target Street" });
    const question: SectionQuestion = { id: "q", association_id: "a", record_id: "middle", direction: "category_to_streets", prompt: "Target Street", street_names: ["Associated Street"], options: [{ id: "middle:feature:0", label: "Associated Street" }], answer_option_ids: ["middle:feature:0"], selection_mode: "single" };
    expect(questionMapAssociations(question, ["middle:feature:0"], [middleRoad])[0].featureIndices).toEqual([0, 1]);

    const district = record("district", "District", "District Street");
    district.type = "district";
    const districtQuestion = { ...question, record_id: "district", prompt: "District", options: [{ id: "district:feature:0", label: "District Street" }], answer_option_ids: ["district:feature:0"] };
    expect(questionMapAssociations(districtQuestion, ["district:feature:0"], [district])[0].featureIndices).toEqual([0]);
  });
});
