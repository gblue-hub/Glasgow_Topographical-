// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningRecord } from "../domain/types";
import { StudyBeforeTestCard } from "./StudyBeforeTestCard";
import { TodaySessionCard } from "./TodaySessionCard";

afterEach(cleanup);

const record: LearningRecord = {
  id: "place:st-enoch",
  type: "place",
  section: { code: "A", name: "Places" },
  exam_name: "St. Enoch Sqare",
  review_state: "published",
  features: [
    {
      index: 0,
      role: "place",
      exam_name: "St. Enoch Square",
      map_name: "St. Enoch Square",
      postcode: "",
      effective_coordinates: [-4.255, 55.857],
      road_link_id: null,
      spatial_status: "mapped",
    },
    {
      index: 1,
      role: "associated_road",
      exam_name: "Argyle Stret",
      map_name: "Argyle Street",
      postcode: "",
      effective_coordinates: [-4.254, 55.858],
      road_link_id: "argyle",
      spatial_status: "mapped",
    },
    {
      index: 2,
      role: "associated_road",
      exam_name: "Oswald Street",
      map_name: "Oswald Street",
      postcode: "",
      effective_coordinates: [-4.258, 55.858],
      road_link_id: "oswald",
      spatial_status: "mapped",
    },
  ],
};

describe("TodaySessionCard", () => {
  it("shows the session mix and starts the session", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    render(
      <TodaySessionCard
        counts={{ due: 6, weak: 4, new: 5 }}
        totalItemCount={15}
        estimatedMinutes={12}
        focusLabel="City Centre"
        onStart={onStart}
      />,
    );

    expect(screen.getByText("15")).toBeVisible();
    expect(screen.getByText("Reviews due")).toBeVisible();
    expect(screen.getByText("Weak connections")).toBeVisible();
    expect(screen.getByText("New connections")).toBeVisible();
    expect(screen.getByLabelText("Estimated time 12 minutes")).toBeVisible();
    expect(
      screen.getByText(/grouped around City Centre/i),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: /start today's session/i }),
    );
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("renders a supplied empty state without offering an empty session", () => {
    render(
      <TodaySessionCard
        counts={{ due: 0, weak: 0, new: 0 }}
        totalItemCount={0}
        estimatedMinutes={0}
        onStart={vi.fn()}
        emptyState={<span>Come back tomorrow for your next review.</span>}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Come back tomorrow for your next review.",
    );
    expect(
      screen.queryByRole("button", { name: /start today's session/i }),
    ).not.toBeInTheDocument();
  });
});

describe("StudyBeforeTestCard", () => {
  it("preserves exam wording and associated-answer spellings", async () => {
    const user = userEvent.setup();
    const onReady = vi.fn();

    render(
      <StudyBeforeTestCard
        record={record}
        mapSlot={<div data-testid="study-map">Map</div>}
        onReady={onReady}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "St. Enoch Sqare" }),
    ).toBeVisible();
    expect(screen.getByText("Argyle Stret")).toBeVisible();
    expect(screen.getByText("Oswald Street")).toBeVisible();
    expect(screen.queryByText("Argyle Street")).not.toBeInTheDocument();
    expect(screen.queryByText("St. Enoch Square")).not.toBeInTheDocument();
    expect(screen.getByTestId("study-map")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /i'm ready/i }));
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("accepts custom study instructions and ready copy", () => {
    render(
      <StudyBeforeTestCard
        record={record}
        instructions={<p>Notice where both roads meet the square.</p>}
        readyLabel="Ready for the choices"
        onReady={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Notice where both roads meet the square."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Ready for the choices" }),
    ).toBeVisible();
  });
});
