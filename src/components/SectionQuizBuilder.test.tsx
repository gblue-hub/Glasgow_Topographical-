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

    const addSection = screen.getByRole("combobox", { name: /add a section/i });
    await user.selectOptions(addSection, "A");
    await user.selectOptions(addSection, "B");
    await user.click(screen.getByRole("button", { name: /start 20-question quiz/i }));

    expect(onStartMultiple).toHaveBeenCalledWith(
      ["A", "B"],
      expect.stringContaining("Recall"),
      "forward",
    );
  });
});
