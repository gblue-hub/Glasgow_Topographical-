import { describe, expect, it } from "vitest";
import { buildStreetLandmarkSequences } from "./street-landmark-sequences";
import type { LearningRecord } from "./types";

const place = (id: string, name: string, longitude: number): LearningRecord => ({
  id, type: "place", exam_name: name, review_state: "ready",
  section: { code: "1", name: "CITY CENTRE RESTAURANTS" },
  features: [
    { index: 0, role: "place", exam_name: name, map_name: name, postcode: "", effective_coordinates: [longitude, 55.86], road_link_id: null, spatial_status: "mapped" },
    { index: 1, role: "associated_road", exam_name: "Sauchiehall Street", map_name: "Sauchiehall Street", postcode: "", effective_coordinates: [longitude, 55.86], road_link_id: `road-${id}`, spatial_status: "mapped" },
  ],
});

describe("buildStreetLandmarkSequences", () => {
  it("orders three city-centre landmarks in a deterministic driving direction", () => {
    const sequences = buildStreetLandmarkSequences([
      place("c", "Café C", -4.25), place("a", "Anchor A", -4.27), place("b", "Bistro B", -4.26),
    ]);
    expect(sequences).toHaveLength(1);
    expect(sequences[0].forwardHeading).toBe("east");
    expect(sequences[0].reverseHeading).toBe("west");
    expect(sequences[0].landmarks.map((item) => item.name)).toEqual(["Anchor A", "Bistro B", "Café C"]);
  });

  it("does not invent a sequence from fewer than three landmarks", () => {
    expect(buildStreetLandmarkSequences([place("a", "A", -4.27), place("b", "B", -4.26)])).toEqual([]);
  });
});
