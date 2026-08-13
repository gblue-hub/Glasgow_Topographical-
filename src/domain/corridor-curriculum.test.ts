import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCorridorCurriculum } from "./corridor-curriculum";
import type { LearningContent, TerritoryContent } from "./types";

const content = JSON.parse(
  readFileSync(
    new URL(
      "../../.content-build/course-content/learning-content.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as LearningContent;
const territoryContent = JSON.parse(
  readFileSync(
    new URL(
      "../../.content-build/course-content/territories.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as TerritoryContent;

describe("centre-out corridor curriculum", () => {
  const curriculum = buildCorridorCurriculum(
    content.records,
    territoryContent.territories,
    territoryContent.stitches,
  );

  it("owns every learning record exactly once across four corridors", () => {
    expect(curriculum.corridors.map((corridor) => corridor.area)).toEqual([
      "north",
      "east",
      "south",
      "west",
    ]);
    const recordIds = curriculum.corridors.flatMap(
      (corridor) => corridor.recordIds,
    );
    expect(recordIds).toHaveLength(content.records.length);
    expect(new Set(recordIds).size).toBe(content.records.length);
    expect(curriculum.ownerByRecordId.size).toBe(content.records.length);
  }, 20_000);

  it("starts every corridor in its City Centre gateway", () => {
    for (const corridor of curriculum.corridors) {
      expect(corridor.stages[0]).toMatchObject({
        kind: "centre_gateway",
        area: corridor.area,
        previousStageId: null,
        incomingKind: "centre",
      });
      expect(corridor.stages[0].recordIds.length).toBeGreaterThan(0);
    }
  });

  it("reaches every district through a main-road approach or named stitch", () => {
    const recordsById = new Map(
      content.records.map((record) => [record.id, record]),
    );
    for (const corridor of curriculum.corridors) {
      const stageIndex = new Map(
        corridor.stages.map((stage, index) => [stage.id, index]),
      );
      for (const [index, stage] of corridor.stages.slice(1).entries()) {
        expect(stage.kind).toBe("district");
        expect(stage.previousStageId).not.toBeNull();
        expect(stageIndex.get(stage.previousStageId!)).toBeLessThan(index + 1);
        expect(stage.incomingRoadNames.length).toBeGreaterThan(0);
        const districtRecords = stage.recordIds.filter(
          (recordId) => recordsById.get(recordId)?.type === "district",
        );
        expect(districtRecords).toHaveLength(1);
        if (index === 0) expect(stage.incomingKind).toBe("main_road");
        else expect(stage.incomingKind).toBe("stitch_road");
      }
    }
  });
});

