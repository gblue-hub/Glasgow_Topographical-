import { describe, expect, it } from "vitest";
import {
  PRIMARY_NAVIGATION,
  primaryAreaForView,
  type AppView,
} from "./navigation";

describe("primary navigation", () => {
  it("exposes the professionally named user-goal areas", () => {
    expect(PRIMARY_NAVIGATION.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "learn", label: "Learn" },
      { id: "route_lab", label: "Route Lab" },
      { id: "atlas", label: "Knowledge Atlas" },
      { id: "checkpoints", label: "Checkpoints" },
      { id: "progress", label: "Progress" },
      { id: "settings", label: "Settings" },
    ]);
  });

  it("keeps implementation views under their owning area", () => {
    const expected: Record<AppView, string> = {
      overview: "learn",
      practice: "learn",
      territories: "learn",
      history: "learn",
      lesson: "learn",
      results: "learn",
      explore: "atlas",
      "explore-record": "atlas",
      roads: "atlas",
      journeys: "route_lab",
      mock: "checkpoints",
      final: "checkpoints",
      areas: "progress",
      feedback: "progress",
      trouble: "progress",
      mastery: "progress",
      settings: "settings",
    };

    for (const [view, area] of Object.entries(expected))
      expect(primaryAreaForView(view as AppView)).toBe(area);
  });
});
