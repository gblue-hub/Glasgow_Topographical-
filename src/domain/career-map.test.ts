import { describe, expect, it } from "vitest";
import { buildCareerMapModel } from "./career-map";
import type { Association, Attempt, LearningRecord, Mastery, RouteAttempt, TerritoryDefinition, TerritoryProgress, TerritoryStitch } from "./types";

const record = { id: "district", type: "district", exam_name: "District", section: { code: "A", name: "Districts" }, review_state: "canonical", features: [{ index: 0, role: "associated_road", exam_name: "Alpha Road", map_name: "Alpha Road", postcode: "", effective_coordinates: [-4.2, 55.86], road_link_id: "road", spatial_status: "mapped" }] } as LearningRecord;
const association = { id: "district:forward", record_id: "district", section_code: "A", kind: "category_to_streets", direction: "forward", prompt: "District", answer: "Alpha Road", required: true, scope: "record_set", parent_association_id: null, feature_index: null } as Association;
const territory = { id: "territory:a", area: "east", district_record_id: "district", stitch_ids: ["stitch:a:b"], stitch_road_names: ["Alpha Road"], target_road_names: ["Alpha Road"] } as TerritoryDefinition;
const stitch = { id: "stitch:a:b", territory_ids: ["territory:a", "territory:b"], road_names: ["Alpha Road"] } as TerritoryStitch;
const mastery = { association_id: association.id, state: "mastered", correct_retrievals: 3, recall_successes: 3, consecutive_errors: 0, last_seen_at: "2026-08-01T10:00:00.000Z", next_due_at: "2026-08-20T10:00:00.000Z" } as Mastery;
const attempt = { association_id: association.id, exercise_family: "recall", correct: true, used_reveal: false, latency_ms: 1000, confidence: 3, created_at: "2026-08-01T10:00:00.000Z" } as Attempt;
const routeAttempt = { id: "route", challenge_id: "challenge", territory_id: territory.id, passed: true, covered_road_names: ["Alpha Road"] } as RouteAttempt;

describe("career map evidence", () => {
  it("derives operational roads and secure stitches from successful evidence", () => {
    const model = buildCareerMapModel({ records: [record], associations: [association], mastery: new Map([[association.id, mastery]]), attempts: [attempt], territories: [territory], stitches: [stitch], territoryProgress: new Map(), routeAttempts: [routeAttempt], readiness: 50, now: new Date("2026-08-02T10:00:00.000Z") });
    expect(model.recordStatus.get(record.id)).toBe("operational");
    expect(model.roadStatus.get("alpha road")).toBe("operational");
    expect(model.stitchStatus.get(stitch.id)).toBe("operational");
    expect(model.territoryStatus.get(territory.id)).toBe("operational");
    expect(model.competencePoints).toBe(125);
  });

  it("does not make a stitch road a prerequisite for an operational area", () => {
    const model = buildCareerMapModel({ records: [record], associations: [association], mastery: new Map([[association.id, mastery]]), attempts: [attempt], territories: [territory], stitches: [stitch], territoryProgress: new Map(), routeAttempts: [], readiness: 50, now: new Date("2026-08-02T10:00:00.000Z") });
    expect(model.territoryStatus.get(territory.id)).toBe("operational");
    expect(model.stitchStatus.get(stitch.id)).toBe("unseen");
  });

  it("awards a licence and career rank only from completed evidence", () => {
    const progress = { territory_id: territory.id, checkpoint_passed: true } as TerritoryProgress;
    const model = buildCareerMapModel({ records: [record], associations: [association], mastery: new Map([[association.id, mastery]]), attempts: [attempt, attempt], territories: [territory], stitches: [stitch], territoryProgress: new Map([[territory.id, progress]]), routeAttempts: [routeAttempt, routeAttempt], readiness: 50, now: new Date("2026-08-02T10:00:00.000Z") });
    expect(model.rank).toBe("Local Driver");
    expect(model.totals.licensedTerritories).toBe(1);
    expect(model.totals.successfulFares).toBe(1);
    expect(model.competencePoints).toBe(275);
  });
});
