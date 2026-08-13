import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyRecordAreas,
  primaryKnowledgeArea,
  recordCoordinate,
} from "./geographic-knowledge";
import { buildGeographicCurriculum } from "./geographic-curriculum";
import { buildCorridorCurriculum } from "./corridor-curriculum";
import { buildDailyLearningPlan } from "./daily-learning";
import type {
  CoverageLedger,
  LearningContent,
  TerritoryContent,
} from "./types";

const content = JSON.parse(
  readFileSync(
    new URL("../../.content-build/course-content/learning-content.json", import.meta.url),
    "utf8",
  ),
) as LearningContent;
const ledger = JSON.parse(
  readFileSync(
    new URL("../../.content-build/course-content/coverage-ledger.json", import.meta.url),
    "utf8",
  ),
) as CoverageLedger;
const territoryContent = JSON.parse(
  readFileSync(
    new URL("../../.content-build/course-content/territories.json", import.meta.url),
    "utf8",
  ),
) as TerritoryContent;

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

  it("places every real record exactly once in the area-first curriculum", () => {
    const curriculum = buildGeographicCurriculum(content.records);
    const orderedIds = curriculum.flatMap((area) => area.orderedRecordIds);
    expect(orderedIds).toHaveLength(content.records.length);
    expect(new Set(orderedIds).size).toBe(content.records.length);
    for (const area of curriculum)
      expect(
        area.anchorRecordIds.length,
        `${area.area} has no district, main-road or centre-street anchors`,
      ).toBeGreaterThan(0);
  }, 15_000);

  it("builds a real new-learner session from one area and mixed categories", () => {
    const plan = buildDailyLearningPlan({
      associations: ledger.associations,
      records: content.records,
      territories: territoryContent.territories,
      stitches: territoryContent.stitches,
      activeCorridor: "north",
      mastery: new Map(),
      attempts: [],
      now: "2026-07-26T12:00:00.000Z",
      seed: "real-area-session",
      newLimit: 15,
    });
    const recordById = new Map(
      content.records.map((record) => [record.id, record]),
    );
    const corridor = buildCorridorCurriculum(
      content.records,
      territoryContent.territories,
      territoryContent.stitches,
    ).corridors.find((item) => item.area === "north")!;
    const activeStageIds = new Set(corridor.stages[0].recordIds);
    const newItems = plan.items.filter((item) => item.block === "new");
    const sections = new Set(
      newItems.map(
        (item) => recordById.get(item.association.record_id)!.section.code,
      ),
    );
    expect(plan.focusArea).toBe("north");
    expect(newItems).toHaveLength(15);
    expect(
      newItems.every(
        (item) => activeStageIds.has(item.association.record_id),
      ),
    ).toBe(true);
    expect(sections.size).toBeGreaterThan(2);
  }, 15_000);

  it("does not unlock the next stage while a current-stage direction is still missed", () => {
    const corridor = buildCorridorCurriculum(
      content.records,
      territoryContent.territories,
      territoryContent.stitches,
    ).corridors.find((item) => item.area === "west")!;
    const centreIds = new Set(corridor.stages[0].recordIds);
    const recordAssociations = ledger.associations.filter(
      (association) =>
        association.required &&
        association.scope === "record_set" &&
        centreIds.has(association.record_id),
    );
    const heldAssociation = recordAssociations[0];
    const attempts = recordAssociations.map((association) => ({
      association_id: association.id,
      exercise_family: "multiple_choice",
      correct: association.id !== heldAssociation.id,
      used_reveal: false,
      latency_ms: 1_000,
      confidence: 3 as const,
      created_at: "2026-07-25T12:00:00.000Z",
      phase: "first_pass" as const,
      session_id: "centre-west-check",
    }));
    const plan = buildDailyLearningPlan({
      associations: ledger.associations,
      records: content.records,
      territories: territoryContent.territories,
      stitches: territoryContent.stitches,
      activeCorridor: "west",
      mastery: new Map(),
      attempts,
      now: "2026-07-26T12:00:00.000Z",
      newLimit: 15,
    });

    expect(plan.corridor?.stageId).toBe(corridor.stages[0].id);
    expect(plan.items.some((item) => item.block === "recovery")).toBe(true);
    expect(
      plan.items
        .filter((item) => item.block === "new")
        .every((item) => centreIds.has(item.association.record_id)),
    ).toBe(true);
  }, 20_000);
});
