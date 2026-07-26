// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionQuizBuilder } from "./SectionQuizBuilder";

const sections = [
  {
    code: "A",
    name: "Places",
    record_count: 12,
    association_count: 24,
    directionTotals: { forward: 12, reverse: 12 },
    latestResults: {},
  },
  {
    code: "B",
    name: "Streets",
    record_count: 8,
    association_count: 16,
    directionTotals: { forward: 8, reverse: 8 },
    latestResults: {},
  },
];

afterEach(cleanup);

describe("SectionQuizBuilder practice directions", () => {
  it("starts recognition and recall as independent single-section quizzes", async () => {
    const user = userEvent.setup();
    const onStartSingle = vi.fn();

    render(
      <SectionQuizBuilder
        sections={sections}
        onStartSingle={onStartSingle}
        onStartMultiple={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /start recognition quiz/i }));
    expect(onStartSingle).toHaveBeenLastCalledWith("A", "reverse");

    await user.click(screen.getByRole("button", { name: /category → all streets/i }));
    await user.click(screen.getByRole("button", { name: /start recall quiz/i }));
    expect(onStartSingle).toHaveBeenLastCalledWith("A", "forward");
  });

  it("keeps the selected direction when building a multi-section quiz", async () => {
    const user = userEvent.setup();
    const onStartMultiple = vi.fn();

    render(
      <SectionQuizBuilder
        sections={sections}
        onStartSingle={vi.fn()}
        onStartMultiple={onStartMultiple}
      />,
    );

    await user.click(screen.getByRole("button", { name: /category → all streets/i }));
    await user.click(screen.getByRole("tab", { name: /multiple/i }));

    await user.click(screen.getByRole("checkbox", { name: /places/i }));
    await user.click(screen.getByRole("checkbox", { name: /streets/i }));
    await user.click(screen.getByRole("button", { name: /start 20-question quiz/i }));

    expect(onStartMultiple).toHaveBeenCalledWith(
      ["A", "B"],
      expect.stringContaining("Recall"),
      "forward",
    );
  });

  it("adds and removes sections directly from one visible checklist", async () => {
    const user = userEvent.setup();

    render(
      <SectionQuizBuilder
        sections={sections}
        onStartSingle={vi.fn()}
        onStartMultiple={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /multiple/i }));
    const places = screen.getByRole("checkbox", { name: /places/i });
    const streets = screen.getByRole("checkbox", { name: /streets/i });

    await user.click(places);
    await user.click(streets);
    expect(places).toBeChecked();
    expect(streets).toBeChecked();
    expect(screen.getByText("2", { selector: ".combined-selection-summary b" })).toBeVisible();

    await user.click(places);
    expect(places).not.toBeChecked();
    expect(streets).toBeChecked();
    expect(
      screen.getByRole("button", { name: /choose at least two sections/i }),
    ).toBeDisabled();
  });

  it("starts an all-category quiz for the selected shared area boundary", async () => {
    const user = userEvent.setup();
    const onStartArea = vi.fn();

    render(
      <SectionQuizBuilder
        sections={sections}
        areaGroups={[
          {
            id: "north",
            label: "North",
            recordIds: ["north-1"],
            recordCount: 1,
            directionTotals: { forward: 1, reverse: 1 },
          },
          {
            id: "centre",
            label: "City Centre",
            recordIds: ["centre-1", "centre-2"],
            recordCount: 2,
            directionTotals: { forward: 2, reverse: 2 },
          },
        ]}
        onStartSingle={vi.fn()}
        onStartMultiple={vi.fn()}
        onStartArea={onStartArea}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /area.*all categories/i }));
    await user.click(screen.getByRole("button", { name: /city centre/i }));
    await user.click(screen.getByRole("button", { name: /start city centre quiz/i }));

    expect(onStartArea).toHaveBeenCalledWith(
      "centre",
      "Recognition · City Centre · all categories",
      "reverse",
    );
  });
});
