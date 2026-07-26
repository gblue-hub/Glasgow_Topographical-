import { describe, expect, it } from "vitest";
import {
  buildOsrmRouteUrl,
  compareRouteGeometry,
  generateJourneyPair,
} from "./journeys";

describe("journey generation", () => {
  it("chooses distinct locations within the preferred distance range", () => {
    const locations = [
      { id: "a", name: "A", coordinate: [-4.25, 55.86] as [number, number] },
      { id: "b", name: "B", coordinate: [-4.20, 55.86] as [number, number] },
      { id: "c", name: "C", coordinate: [-4.60, 55.86] as [number, number] },
    ];
    expect(generateJourneyPair(locations, () => 0)).toEqual({
      start: locations[0],
      end: locations[1],
    });
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
    expect(comparison.divergencePoint).toEqual([-4.235, 55.865]);
    expect(comparison.reconnectionPoint).toEqual([-4.22, 55.86]);
    expect(comparison.agreementPoints[0]).toEqual([-4.25, 55.86]);
  });

  it("has no divergence when the lines agree", () => {
    const line: [number, number][] = [
      [-4.25, 55.86],
      [-4.24, 55.86],
    ];
    expect(compareRouteGeometry(line, line).divergencePoint).toBeNull();
  });
});
