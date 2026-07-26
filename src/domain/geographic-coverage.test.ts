import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyRecordAreas,
  primaryKnowledgeArea,
  recordCoordinate,
} from "./geographic-knowledge";
import type { LearningContent } from "./types";

const content = JSON.parse(
  readFileSync(
    new URL("../../public/data/learning-content.json", import.meta.url),
    "utf8",
  ),
) as LearningContent;

describe("geographic learning coverage", () => {
  const newsAreas = classifyRecordAreas(content.records);
  const primaryAreas = new Map(
    content.records.map((record) => [
      record.id,
      primaryKnowledgeArea(record, newsAreas),
    ]),
  );

  it("gives every mapped learning record exactly one primary area", () => {
    const mapped = content.records.filter((record) => recordCoordinate(record));
    expect(
      mapped.filter((record) => !primaryAreas.get(record.id)),
    ).toEqual([]);
    expect(primaryAreas.size).toBe(content.records.length);
  });

  it("keeps the three northern-edge districts in North", () => {
    for (const name of ["Cowcaddens", "Garnethill", "Townhead"]) {
      const district = content.records.find(
        (record) => record.type === "district" && record.exam_name === name,
      );
      expect(district, `${name} district is missing`).toBeDefined();
      expect(primaryAreas.get(district!.id)).toBe("north");
    }
  });

  it("keeps City Centre distinct from every NEWS area", () => {
    const centreIds = new Set(
      [...primaryAreas]
        .filter(([, area]) => area === "centre")
        .map(([recordId]) => recordId),
    );
    const newsIds = new Set(
      [...primaryAreas]
        .filter(([, area]) => area && area !== "centre")
        .map(([recordId]) => recordId),
    );
    expect([...centreIds].filter((recordId) => newsIds.has(recordId))).toEqual(
      [],
    );
    expect(centreIds.size).toBeGreaterThan(300);
  });
});
