import { describe, expect, it } from "vitest";
import {
  connectorRoadSequence,
  curriculumRoadSequence,
  routeUsesEndpointRoads,
  scoreRouteAttempt,
  spineRoadSequence,
  TERRITORY_CHECKPOINT_RUNS_REQUIRED,
  updateTerritoryProgress,
} from "./route-learning";
import type { JourneyRoadOption, OsrmRoute } from "./journeys";
import type { LearningRecord, RouteChallenge, TerritoryDefinition } from "./types";

const route = (names: Array<{ name?: string; ref?: string }>): OsrmRoute => ({
  distanceMetres: 4_000,
  durationSeconds: 500,
  coordinates: [[-4.3, 55.87], [-4.25, 55.83]],
  roadNames: names.map((item) => item.name || item.ref || "Unnamed connector"),
  steps: names.map((item) => ({
    name: item.name ?? "",
    ref: item.ref ?? "",
    displayName: item.name || item.ref || "Unnamed connector",
    distanceMetres: 500,
    durationSeconds: 60,
    manoeuvreType: "turn",
    modifier: "straight",
  })),
});

const options = ["Byres Road", "Govan Road", "Pollokshaws Road"].map(
  (name): JourneyRoadOption => ({ name, coordinates: [], segments: [] }),
);

const challenge: RouteChallenge = {
  id: "challenge",
  territory_id: "territory:west",
  mode: "checkpoint",
  start: { record_id: "west", record_name: "West End", road_name: "Byres Road", coordinate: [-4.3, 55.87] },
  end: { record_id: "south", record_name: "Shawlands", road_name: "Pollokshaws Road", coordinate: [-4.25, 55.83] },
  target_road_names: ["Byres Road", "Pollokshaws Road"],
  routing_version: "routing:v1",
};

describe("route learning", () => {
  it("keeps M8 as an automatic connector rather than a tested road", () => {
    const suggested = route([
      { name: "Byres Road" },
      { ref: "M8" },
      { name: "Govan Road" },
      { name: "Pollokshaws Road" },
    ]);
    const curriculum = curriculumRoadSequence(suggested, options);
    expect(curriculum).toEqual(["Byres Road", "Govan Road", "Pollokshaws Road"]);
    expect(connectorRoadSequence(suggested, curriculum)).toEqual(["M8"]);
  });

  it("promotes main-road spines used by the fare while leaving the motorway automatic", () => {
    const mainRoad = {
      id: "main:edinburgh",
      type: "middle_road",
      exam_name: "Edinburgh Rd",
      section: { code: "E", name: "MAIN ROADS (EAST)" },
      features: [{ index: 0, role: "middle_road", exam_name: "Edinburgh Road", map_name: "edinburgh road", effective_coordinates: [-4.18, 55.86] }],
    } as LearningRecord;
    const suggested = route([{ name: "Byres Road" }, { ref: "M8" }, { name: "Edinburgh Road" }, { name: "Pollokshaws Road" }]);
    expect(spineRoadSequence(suggested, [mainRoad])).toEqual(["Edinburgh Road"]);
  });

  it("requires learned roads in travel order while allowing connectors", () => {
    const suggested = route([{ name: "Byres Road" }, { ref: "M8" }, { name: "Pollokshaws Road" }]);
    const attempt = scoreRouteAttempt({
      challenge,
      selectedRoadNames: ["Byres Road", "Pollokshaws Road"],
      requiredRoadNames: ["Byres Road", "Pollokshaws Road"],
      connectorRoadNames: ["M8"],
      suggested,
      learner: suggested,
      comparison: { agreementPoints: [], divergencePoint: null, reconnectionPoint: null, overlapPercentage: 100, maximumDeviationMetres: 0, substantialDifference: false },
      now: "2026-08-01T12:00:00.000Z",
    });
    expect(attempt).toMatchObject({ passed: true, score_percentage: 100, connector_road_names: ["M8"], missing_road_names: [] });
  });

  it("stores a compact fare trace for the learned-city map", () => {
    const longRoute = route([{ name: "Byres Road" }, { name: "Pollokshaws Road" }]);
    longRoute.coordinates = Array.from({ length: 300 }, (_, index) => [-4.3 + index / 10_000, 55.87 - index / 20_000]);
    const attempt = scoreRouteAttempt({
      challenge,
      selectedRoadNames: ["Byres Road", "Pollokshaws Road"],
      requiredRoadNames: ["Byres Road", "Pollokshaws Road"],
      connectorRoadNames: [],
      suggested: longRoute,
      learner: longRoute,
      comparison: { agreementPoints: [], divergencePoint: null, reconnectionPoint: null, overlapPercentage: 100, maximumDeviationMetres: 0, substantialDifference: false },
    });
    expect(attempt.start_coordinate).toEqual(challenge.start.coordinate);
    expect(attempt.end_coordinate).toEqual(challenge.end.coordinate);
    expect(attempt.trace_coordinates?.length).toBeLessThanOrEqual(120);
    expect(attempt.trace_coordinates?.at(0)).toEqual(longRoute.coordinates[0]);
    expect(attempt.trace_coordinates?.at(-1)).toEqual(longRoute.coordinates.at(-1));
  });

  it("validates the advertised learned roads at both route endpoints", () => {
    const suggested = route([
      { name: "Byres Road" },
      { ref: "M8" },
      { name: "Pollokshaws Road" },
    ]);
    expect(routeUsesEndpointRoads(suggested, "Byres Road", "Pollokshaws Road"))
      .toEqual({ start: true, end: true });
    expect(routeUsesEndpointRoads(suggested, "Great Western Road", "Pollokshaws Road"))
      .toEqual({ start: false, end: true });
  });

  it("keeps territory completion gated by coverage and a passed checkpoint", () => {
    const territory = {
      id: "territory:west",
      target_road_names: ["Byres Road", "Govan Road"],
      checkpoint_target_percentage: 80,
    } as TerritoryDefinition;
    const progress = updateTerritoryProgress({
      territory,
      routingVersion: "routing:v1",
      attempts: [{
        ...scoreRouteAttempt({
          challenge,
          selectedRoadNames: ["Byres Road"],
          requiredRoadNames: ["Byres Road"],
          connectorRoadNames: ["M8"],
          suggested: route([{ name: "Byres Road" }]),
          learner: route([{ name: "Byres Road" }]),
          comparison: { agreementPoints: [], divergencePoint: null, reconnectionPoint: null, overlapPercentage: 100, maximumDeviationMetres: 0, substantialDifference: false },
        }),
        passed: true,
      }],
    });
    expect(progress.route_coverage_percentage).toBe(50);
    expect(progress.checkpoint_passed).toBe(false);
  });

  it("requires three distinct checkpoint fares before territory sign-off", () => {
    const territory = {
      id: "territory:west",
      target_road_names: ["Byres Road"],
      checkpoint_target_percentage: 80,
    } as TerritoryDefinition;
    const attempts = Array.from(
      { length: TERRITORY_CHECKPOINT_RUNS_REQUIRED },
      (_, index) => ({
        ...scoreRouteAttempt({
          challenge: { ...challenge, id: `checkpoint:${index}` },
          selectedRoadNames: ["Byres Road"],
          requiredRoadNames: ["Byres Road"],
          connectorRoadNames: [],
          suggested: route([{ name: "Byres Road" }]),
          learner: route([{ name: "Byres Road" }]),
          comparison: { agreementPoints: [], divergencePoint: null, reconnectionPoint: null, overlapPercentage: 100, maximumDeviationMetres: 0, substantialDifference: false },
        }),
        passed: true,
      }),
    );
    expect(updateTerritoryProgress({ territory, attempts: attempts.slice(0, 2), routingVersion: "routing:v1" }).checkpoint_passed).toBe(false);
    expect(updateTerritoryProgress({ territory, attempts, routingVersion: "routing:v1" }).checkpoint_passed).toBe(true);
  });

  it("does not sign off a territory until every stitch road has been covered", () => {
    const territory = {
      id: "territory:west",
      target_road_names: ["Byres Road"],
      stitch_road_names: ["Govan Road"],
      checkpoint_target_percentage: 80,
    } as TerritoryDefinition;
    const attempts = Array.from({ length: 3 }, (_, index) => ({
      ...scoreRouteAttempt({
        challenge: { ...challenge, id: `stitch-checkpoint:${index}` },
        selectedRoadNames: ["Byres Road"], requiredRoadNames: ["Byres Road"], connectorRoadNames: [],
        suggested: route([{ name: "Byres Road" }]), learner: route([{ name: "Byres Road" }]),
        comparison: { agreementPoints: [], divergencePoint: null, reconnectionPoint: null, overlapPercentage: 100, maximumDeviationMetres: 0, substantialDifference: false },
      }),
      passed: true,
    }));
    expect(updateTerritoryProgress({ territory, attempts, routingVersion: "routing:v1" })).toMatchObject({ route_coverage_percentage: 100, checkpoint_passed: false });
  });
});
