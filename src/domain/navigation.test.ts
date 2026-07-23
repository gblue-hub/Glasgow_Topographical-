import { describe, expect, it } from "vitest";
import {
  PRIMARY_NAVIGATION,
  primaryAreaForView,
  type AppView,
} from "./navigation";

describe("primary navigation", () => {
  it("exposes only the four user-goal areas", () => {
    expect(PRIMARY_NAVIGATION.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "learn", label: "Learn" },
      { id: "explore", label: "Explore" },
      { id: "mock", label: "Mock Exam" },
      { id: "progress", label: "Progress" },
    ]);
  });

  it("keeps implementation views under their owning area", () => {
    const expected: Record<AppView, string> = {
      overview: "learn",
      practice: "learn",
      lesson: "learn",
      results: "learn",
      explore: "explore",
      "explore-record": "explore",
      roads: "explore",
      journeys: "explore",
      mock: "mock",
      final: "mock",
      feedback: "progress",
      trouble: "progress",
      mastery: "progress",
    };

    for (const [view, area] of Object.entries(expected))
      expect(primaryAreaForView(view as AppView)).toBe(area);
  });
});
