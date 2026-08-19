import { describe, expect, it } from "vitest";
import {
  buildDistrictQuizGroups,
  requiredAssociationsForDistrict,
} from "./district-quiz-groups";
import type {
  Association,
  LearningRecord,
  TerritoryDefinition,
} from "./types";

const record = (
  id: string,
  type: LearningRecord["type"],
  sectionCode: string,
  coordinate: [number, number],
): LearningRecord => ({
  id,
  type,
  section: {
    code: sectionCode,
    name: type === "district" ? "DISTRICTS (NORTH)" : "LOCAL CATEGORY",
  },
  exam_name: id,
  review_state: "canonical",
  features: [{
    index: 0,
    role: type,
    exam_name: id,
    map_name: id,
    postcode: "G21 1AA",
    effective_coordinates: coordinate,
    road_link_id: null,
    spatial_status: "mapped",
  }],
});

const association = (
  recordId: string,
  sectionCode: string,
  direction: Association["direction"],
): Association => ({
  id: `${recordId}:${direction}`,
  record_id: recordId,
  section_code: sectionCode,
  kind: direction,
  direction,
  prompt: recordId,
  answer: recordId,
  required: true,
  scope: "record_set",
  parent_association_id: null,
  feature_index: null,
});

describe("district quiz groups", () => {
  const records = [
    record("district", "district", "E", [-4.24, 55.89]),
    record("place", "place", "A", [-4.241, 55.891]),
    record("road", "middle_road", "M", [-4.242, 55.892]),
  ];
  const associations = records.flatMap((item) => [
    association(item.id, item.section.code, "forward"),
    association(item.id, item.section.code, "reverse"),
  ]);
  const territory = {
    id: "territory:district",
    name: "Springburn",
    area: "north",
    district_record_id: "district",
    centre: [-4.24, 55.89],
    polygon: [
      [-4.3, 55.85],
      [-4.2, 55.85],
      [-4.2, 55.92],
      [-4.3, 55.92],
    ],
    nearby_record_ids: ["place"],
    approach_record_ids: ["road"],
    neighbouring_territory_ids: [],
    associated_road_names: [],
    associated_road_link_ids: [],
    stitch_ids: [],
    stitch_road_names: [],
    stitch_road_link_ids: [],
    target_road_names: [],
    target_road_link_ids: [],
    checkpoint_target_percentage: 80,
  } as TerritoryDefinition;

  it("includes every category owned by the district stage", () => {
    const [group] = buildDistrictQuizGroups(
      records,
      associations,
      [territory],
      [],
    );

    expect(group).toMatchObject({
      id: "territory:district",
      label: "Springburn",
      areaLabel: "North",
      recordCount: 3,
      categoryCount: 3,
      directionTotals: { forward: 3, reverse: 3 },
    });
    expect(group.recordIds).toEqual(
      expect.arrayContaining(["district", "place", "road"]),
    );
  });

  it("starts only the chosen practice direction in geographic order", () => {
    const [group] = buildDistrictQuizGroups(
      records,
      associations,
      [territory],
      [],
    );
    expect(
      requiredAssociationsForDistrict(group, associations, "reverse").map(
        (item) => item.id,
      ),
    ).toEqual(group.recordIds.map((recordId) => `${recordId}:reverse`));
  });
});
