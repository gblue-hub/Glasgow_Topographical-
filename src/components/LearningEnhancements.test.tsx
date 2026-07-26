// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningRecord } from "../domain/types";
import { StudyBeforeTestCard } from "./StudyBeforeTestCard";
import { TodaySessionCard } from "./TodaySessionCard";
import { LearningPlanSettings } from "./LearningPlanSettings";

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
        counts={{
          recovery: 2,
          maintenance: 3,
          recognition: 4,
          new: 5,
          promotion: 1,
        }}
        totalItemCount={15}
        estimatedMinutes={12}
        focusLabel="City Centre"
        onStart={onStart}
      />,
    );

    expect(screen.getByText("15")).toBeVisible();
    expect(screen.getByText("Daily recovery")).toBeVisible();
    expect(screen.getByText("Older knowledge")).toBeVisible();
    expect(screen.getByText("Identify the place")).toBeVisible();
    expect(screen.getByText("New from one section")).toBeVisible();
    expect(screen.getByText("Recall all streets")).toBeVisible();
    expect(screen.getByLabelText("Estimated time 12 minutes")).toBeVisible();
    expect(
      screen.getByText(/stays within City Centre/i),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: /start today's session/i }),
    );
    expect(onStart).toHaveBeenCalledOnce();
  }, 10_000);

  it("renders a supplied empty state without offering an empty session", () => {
    render(
      <TodaySessionCard
        counts={{
          recovery: 0,
          maintenance: 0,
          recognition: 0,
          new: 0,
          promotion: 0,
        }}
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

describe("LearningPlanSettings", () => {
  it("shows a calculated pace and exposes a separately warned reset action", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onResetProgress = vi.fn();

    render(
      <LearningPlanSettings
        preferences={{
          id: "learning-plan",
          target_weeks: 4,
          study_days_per_week: 6,
          target_date: "2026-08-23T23:59:59.999Z",
          updated_at: "2026-07-26T12:00:00.000Z",
        }}
        dailyNewTarget={18}
        remainingNew={420}
        remainingStudyDays={24}
        onChange={onChange}
        onResetProgress={onResetProgress}
      />,
    );

    expect(screen.getByText("18 new / study day")).toBeVisible();
    await user.click(screen.getByText("Learning plan"));
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent?.includes(
            "420 unfamiliar connections over approximately 24 study days",
          ) === true,
      ),
    ).toBeVisible();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Finish new material in" }),
      "2",
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ target_weeks: 2 }),
    );

    await user.click(
      screen.getByRole("button", { name: "Reset progress…" }),
    );
    expect(onResetProgress).toHaveBeenCalledOnce();
  });
});
