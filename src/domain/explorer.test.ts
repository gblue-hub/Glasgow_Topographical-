import { describe, expect, it } from "vitest";
import {
  answerSummary,
  categoryLocationFeature,
  explorerMapPointFeatures,
  filterExplorerRecords,
  formatExplorerCoordinate,
} from "./explorer";
import type { LearningRecord } from "./types";

const feature = { index: 0, role: "associated_road", exam_name: "Castle Street", map_name: "castle street", postcode: "G4 0SF", effective_coordinates: [-4.234, 55.864] as [number, number], road_link_id: "road-1", spatial_status: "aligned" };
const records: LearningRecord[] = [
  {
    id: "one",
    type: "place",
    section: { code: "J", name: "Hospitals" },
    exam_name: "Royal Infirmary",
    review_state: "source_preserved",
    features: [
      {
        ...feature,
        role: "place",
        exam_name: "Royal Infirmary",
        effective_coordinates: [-4.235, 55.865],
      },
      { ...feature, index: 1 },
    ],
  },
  { id: "two", type: "district", section: { code: "A", name: "Districts (East)" }, exam_name: "Swinton", review_state: "source_preserved", features: [] },
];

describe("dataset explorer", () => {
  it("searches names, answers and postcodes", () => {
    expect(filterExplorerRecords(records, "castle", "", "all")).toHaveLength(1);
    expect(filterExplorerRecords(records, "G4 0SF", "", "all")[0].id).toBe("one");
  });
  it("uses a typed trailing space as a postcode boundary", () => {
    const g40 = {
      ...records[0],
      id: "g40",
      features: [{ ...feature, postcode: "G40 1AA" }],
    };
    expect(filterExplorerRecords([records[0], g40], "G4", "", "all")).toHaveLength(2);
    expect(filterExplorerRecords([records[0], g40], "G4 ", "", "all").map((item) => item.id)).toEqual(["one"]);
  });
  it("combines section and semantic type filters", () => {
    expect(filterExplorerRecords(records, "", "A", "district")).toEqual([records[1]]);
    expect(filterExplorerRecords(records, "", "J", "district")).toEqual([]);
  });
  it("provides the exact visible answer summary", () => expect(answerSummary(records[0])).toBe("Castle Street"));
  it("keeps a place category location separate from its associated road answers", () => {
    expect(categoryLocationFeature(records[0])).toMatchObject({
      role: "place",
      exam_name: "Royal Infirmary",
    });
    expect(answerSummary(records[0])).toBe("Castle Street");
  });
  it("publishes both category and associated-road source points to the map", () => {
    expect(
      explorerMapPointFeatures(records[0]).map(({ index, role, exam_name }) => ({
        index,
        role,
        exam_name,
      })),
    ).toEqual([
      { index: 0, role: "place", exam_name: "Royal Infirmary" },
      { index: 1, role: "associated_road", exam_name: "Castle Street" },
    ]);
  });
  it("formats source coordinates as latitude then longitude", () => {
    expect(formatExplorerCoordinate([-4.235, 55.865])).toBe("55.865000, -4.235000");
  });
});
