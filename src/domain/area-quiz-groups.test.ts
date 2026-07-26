import { describe, expect, it } from "vitest";
import {
  buildAreaQuizGroups,
  requiredAssociationsForArea,
} from "./area-quiz-groups";
import type { Association, LearningRecord } from "./types";

const record = (
  id: string,
  sectionName: string,
  coordinate: [number, number],
): LearningRecord => ({
  id,
  type: "place",
  section: { code: id, name: sectionName },
  exam_name: id,
  review_state: "canonical",
  features: [
    {
      index: 0,
      role: "place",
      exam_name: id,
      map_name: id,
      postcode: "",
      effective_coordinates: coordinate,
      road_link_id: null,
      spatial_status: "mapped",
    },
  ],
});

const association = (
  recordId: string,
  direction: Association["direction"],
): Association => ({
  id: `${recordId}:${direction}`,
  record_id: recordId,
  section_code: recordId,
  kind: direction,
  direction,
  prompt: recordId,
  answer: "answer",
  required: true,
  scope: "record_set",
  parent_association_id: null,
  feature_index: null,
});

describe("area quiz groups", () => {
  const records = [
    record("east-a", "DISTRICTS (EAST)", [-4.18, 55.84]),
    record("east-b", "DISTRICTS (EAST)", [-4.1, 55.84]),
    record("east-c", "DISTRICTS (EAST)", [-4.14, 55.9]),
    record("inside-east", "DISTRICTS (NORTH)", [-4.14, 55.86]),
    record("centre", "PUBLIC_HOUSES", [-4.25, 55.86]),
  ];
  const associations = records.flatMap((item) => [
    association(item.id, "forward"),
    association(item.id, "reverse"),
  ]);

  it("includes every non-centre record inside the shared NEWS polygon", () => {
    const east = buildAreaQuizGroups(records, associations).find(
      (group) => group.id === "east",
    )!;
    expect(east.recordIds).toEqual(
      expect.arrayContaining(["east-a", "east-b", "east-c", "inside-east"]),
    );
    expect(east.recordIds).not.toContain("centre");
  });

  it("keeps the City Centre polygon as its own all-category group", () => {
    const centre = buildAreaQuizGroups(records, associations).find(
      (group) => group.id === "centre",
    )!;
    expect(centre.recordIds).toEqual(["centre"]);
    expect(centre.directionTotals).toEqual({ forward: 1, reverse: 1 });
  });

  it("selects required associations in the requested practice direction", () => {
    expect(
      requiredAssociationsForArea(
        records,
        associations,
        "centre",
        "reverse",
      ).map((item) => item.id),
    ).toEqual(["centre:reverse"]);
  });
});
