import { describe, expect, it } from "vitest";
import {
  assessSelectedRoads,
  buildOsrmRouteUrl,
  compareRouteGeometry,
  generateJourneyPair,
} from "./journeys";

describe("journey generation", () => {
  it("chooses distinct locations within the preferred distance range", () => {
    const locations = [
      { id: "a", name: "A", area: "west" as const, coordinate: [-4.25, 55.86] as [number, number] },
      { id: "b", name: "B", area: "east" as const, coordinate: [-4.20, 55.86] as [number, number] },
      { id: "c", name: "C", area: "west" as const, coordinate: [-4.60, 55.86] as [number, number] },
    ];
    expect(generateJourneyPair(locations, () => 0)).toEqual({
      start: locations[0],
      end: locations[1],
    });
  });

  it("honours independently selected start and destination areas", () => {
    const locations = [
      { id: "west-a", name: "West A", area: "west" as const, coordinate: [-4.32, 55.87] as [number, number] },
      { id: "west-b", name: "West B", area: "west" as const, coordinate: [-4.30, 55.88] as [number, number] },
      { id: "east", name: "East", area: "east" as const, coordinate: [-4.18, 55.86] as [number, number] },
    ];
    expect(
      generateJourneyPair(locations, () => 0, {
        startArea: "west",
        endArea: "east",
      }),
    ).toEqual({ start: locations[0], end: locations[2] });
    expect(
      generateJourneyPair(locations, () => 0, {
        startArea: "west",
        endArea: "west",
      }),
    ).toEqual({ start: locations[0], end: locations[1] });
  });

  it("requests full GeoJSON geometry and steps", () => {
    const url = buildOsrmRouteUrl("http://127.0.0.1:5000/", [
      [-4.25, 55.86],
      [-4.2, 55.87],
    ]);
    expect(url).toBe(
      "http://127.0.0.1:5000/route/v1/driving/-4.25,55.86;-4.2,55.87?overview=full&geometries=geojson&steps=true",
    );
  });
});

describe("route comparison", () => {
  it("marks the first divergence and a later reconnection", () => {
    const suggested: [number, number][] = [
      [-4.25, 55.86],
      [-4.24, 55.86],
      [-4.23, 55.86],
      [-4.22, 55.86],
    ];
    const learner: [number, number][] = [
      [-4.25, 55.86],
      [-4.24, 55.86],
      [-4.235, 55.865],
      [-4.23, 55.865],
      [-4.22, 55.86],
      [-4.2199, 55.86],
      [-4.2198, 55.86],
    ];
    const comparison = compareRouteGeometry(learner, suggested, 40);
    expect(comparison.divergencePoint).not.toBeNull();
    expect(comparison.reconnectionPoint).not.toBeNull();
    expect(comparison.agreementPoints[0]).toEqual([-4.25, 55.86]);
    expect(comparison.overlapPercentage).toBeLessThan(100);
    expect(comparison.maximumDeviationMetres).toBeGreaterThan(40);
  });

  it("has no divergence when the lines agree", () => {
    const line: [number, number][] = [
      [-4.25, 55.86],
      [-4.24, 55.86],
    ];
    const comparison = compareRouteGeometry(line, line);
    expect(comparison.divergencePoint).toBeNull();
    expect(comparison.overlapPercentage).toBe(100);
    expect(comparison.maximumDeviationMetres).toBeCloseTo(0);
    expect(comparison.substantialDifference).toBe(false);
  });

  it("does not mistake shared endpoints for agreement on a large detour", () => {
    const suggested: [number, number][] = [
      [-4.25, 55.86],
      [-4.2, 55.86],
    ];
    const detour: [number, number][] = [
      [-4.25, 55.86],
      [-4.4, 55.95],
      [-4.2, 55.86],
    ];
    const comparison = compareRouteGeometry(detour, suggested);
    expect(comparison.overlapPercentage).toBeLessThan(20);
    expect(comparison.maximumDeviationMetres).toBeGreaterThan(10_000);
    expect(comparison.substantialDifference).toBe(true);
  });

  it("flags a selected street whose waypoint is far from the suggestion", () => {
    const assessments = assessSelectedRoads(
      [
        { name: "Far Road", waypoint: [-4.4, 55.95] },
        { name: "Near Road", waypoint: [-4.225, 55.86] },
      ],
      [
        [-4.25, 55.86],
        [-4.2, 55.86],
      ],
      ["Far Road", "Near Road"],
    );
    expect(assessments[0]).toMatchObject({
      followsSuggestedCorridor: false,
      confirmedByLearnerRoute: true,
    });
    expect(assessments[0].distanceFromSuggestionMetres).toBeGreaterThan(10_000);
    expect(assessments[1]).toMatchObject({
      followsSuggestedCorridor: true,
      confirmedByLearnerRoute: true,
    });
  });
});
