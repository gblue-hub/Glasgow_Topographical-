// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { shouldIgnoreLessonShortcut } from "./lesson-keyboard";

describe("lesson keyboard shortcut targets", () => {
  it("keeps Space as Check/Next after an answer option receives focus", () => {
    const options = document.createElement("div");
    options.className = "mc-options";
    const button = document.createElement("button");
    const label = document.createElement("span");
    button.append(label);
    options.append(button);

    expect(shouldIgnoreLessonShortcut(button)).toBe(false);
    expect(shouldIgnoreLessonShortcut(label)).toBe(false);
  });

  it("preserves native Space behaviour for the map toggle and other controls", () => {
    const mapToggle = document.createElement("button");
    mapToggle.className = "map-label-toggle";
    const link = document.createElement("a");
    const input = document.createElement("input");

    expect(shouldIgnoreLessonShortcut(mapToggle)).toBe(true);
    expect(shouldIgnoreLessonShortcut(link)).toBe(true);
    expect(shouldIgnoreLessonShortcut(input)).toBe(true);
  });

  it("allows lesson shortcuts when focus is on non-interactive content", () => {
    expect(shouldIgnoreLessonShortcut(document.body)).toBe(false);
  });
});
