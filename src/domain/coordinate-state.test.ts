import { describe, expect, it } from "vitest";
import { withUpdatedCoordinate } from "./coordinate-state";
import type { LearningRecord } from "./types";

const record = {
  id: "record-a",
  features: [
    {
      index: 0,
      original_coordinates: [-4.2, 55.8],
      effective_coordinates: [-4.2, 55.8],
    },
  ],
} as LearningRecord;

describe("coordinate state", () => {
  it("updates both loaded coordinate fields without replacing the active record identity", () => {
    const updated = withUpdatedCoordinate(record, "record-a", 0, [-4.25, 55.86]);

    expect(updated.id).toBe(record.id);
    expect(updated.features[0].original_coordinates).toEqual([-4.25, 55.86]);
    expect(updated.features[0].effective_coordinates).toEqual([-4.25, 55.86]);
  });

  it("leaves unrelated records untouched", () => {
    expect(withUpdatedCoordinate(record, "record-b", 0, [-4.25, 55.86])).toBe(record);
  });
});
