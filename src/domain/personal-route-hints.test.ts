import { describe, expect, it } from "vitest";
import { buildPersonalRouteHints } from "./personal-route-hints";
import type { OsrmRoute } from "./journeys";
import type { PersonalPlace } from "./types";

describe("personal route hints", () => {
  it("turns a nearby saved point into an optional directional memory cue", () => {
    const route: OsrmRoute = {
      distanceMetres: 2_000,
      durationSeconds: 300,
      coordinates: [[-4.25, 55.86], [-4.23, 55.86]],
      roadNames: ["Argyle Street", "High Street", "Duke Street"],
      steps: [
        { name: "Argyle Street", ref: "", displayName: "Argyle Street", distanceMetres: 500, durationSeconds: 60, manoeuvreType: "depart", modifier: "straight", coordinate: [-4.25, 55.86] },
        { name: "High Street", ref: "", displayName: "High Street", distanceMetres: 500, durationSeconds: 60, manoeuvreType: "turn", modifier: "right", coordinate: [-4.24, 55.86] },
        { name: "Duke Street", ref: "", displayName: "Duke Street", distanceMetres: 500, durationSeconds: 60, manoeuvreType: "turn", modifier: "right", coordinate: [-4.23, 55.86] },
      ],
    };
    const place = { id: "gran", name: "Gran's close", relationship: "lived", coordinate: [-4.2502, 55.8602] } as PersonalPlace;
    const hints = buildPersonalRouteHints(route, [place]);
    expect(hints[0]).toMatchObject({ placeName: "Gran's close", roadName: "Argyle Street", heading: "east" });
    expect(hints[0].turns).toEqual([
      "Take the first right onto High Street.",
      "Take the second right onto Duke Street.",
    ]);
  });

  it("does not intrude when no personal point is near the fare", () => {
    const route = { distanceMetres: 1, durationSeconds: 1, coordinates: [], roadNames: [], steps: [{ name: "Road", ref: "", displayName: "Road", distanceMetres: 1, durationSeconds: 1, manoeuvreType: "depart", modifier: "", coordinate: [-4.25, 55.86] }] } as OsrmRoute;
    expect(buildPersonalRouteHints(route, [{ id: "far", name: "Far away", relationship: "other", coordinate: [-5, 56] } as PersonalPlace])).toEqual([]);
  });
});
