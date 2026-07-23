import { describe, expect, it } from "vitest";
import { answerSummary, filterExplorerRecords } from "./explorer";
import type { LearningRecord } from "./types";

const feature = { index: 0, role: "associated_road", exam_name: "Castle Street", map_name: "castle street", postcode: "G4 0SF", effective_coordinates: [-4.234, 55.864] as [number, number], road_link_id: "road-1", spatial_status: "aligned" };
const records: LearningRecord[] = [
  { id: "one", type: "place", section: { code: "J", name: "Hospitals" }, exam_name: "Royal Infirmary", review_state: "source_preserved", features: [feature] },
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
});
