// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LearningRecord } from "../domain/types";
import { StudyBeforeTestCard } from "./StudyBeforeTestCard";
import { TodaySessionCard } from "./TodaySessionCard";
import { LearningPlanSettings } from "./LearningPlanSettings";
import { MistakeTestCard } from "./MistakeTestCard";
import type { TroubleSpot } from "../domain/trouble-spots";

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
    expect(screen.getByText("Previous misses")).toBeVisible();
    expect(screen.getByText("Older knowledge")).toBeVisible();
    expect(screen.getByText("Identify the place")).toBeVisible();
    expect(screen.getByText("New associations")).toBeVisible();
    expect(screen.getByText("Recall all streets")).toBeVisible();
    expect(screen.getByLabelText("Estimated time 12 minutes")).toBeVisible();
    expect(
      screen.getByText(/stays within City Centre/i),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: /start next session/i }),
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

  it("chooses one centre-out corridor and locks alternatives while it is active", async () => {
    const user = userEvent.setup();
    const onSelectCorridor = vi.fn();
    const corridors = ["north", "east", "south", "west"].map((area) => ({
      area: area as "north" | "east" | "south" | "west",
      totalRecords: 100,
      learnedRecords: area === "west" ? 12 : 0,
      complete: false,
    }));
    const { rerender } = render(
      <TodaySessionCard
        counts={{ recovery: 0, maintenance: 0, recognition: 0, new: 0, promotion: 0 }}
        totalItemCount={0}
        estimatedMinutes={0}
        availableCorridors={corridors}
        onSelectCorridor={onSelectCorridor}
        onStart={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /west\s*12 \/ 100/i }));
    expect(onSelectCorridor).toHaveBeenCalledWith("west");

    rerender(
      <TodaySessionCard
        counts={{ recovery: 0, maintenance: 0, recognition: 0, new: 0, promotion: 0 }}
        totalItemCount={0}
        estimatedMinutes={0}
        corridor={{ area: "west", stageId: "west:centre", stageName: "City Centre West", stageKind: "centre_gateway", stagePosition: 1, stageCount: 39, incomingKind: "centre", incomingRoadNames: [], remainingRecords: 88, complete: false }}
        availableCorridors={corridors}
        onSelectCorridor={onSelectCorridor}
        onStart={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /north\s*0 \/ 100/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /west\s*12 \/ 100/i })).toBeEnabled();
  });
});

describe("MistakeTestCard", () => {
  const spots: TroubleSpot[] = [
    {
      association: {
        id: "mistake:a",
        record_id: "place:st-enoch",
        section_code: "A",
        kind: "category_to_streets",
        direction: "forward",
        prompt: "St. Enoch Square",
        answer: "Argyle Street",
        required: true,
        scope: "record_set",
        parent_association_id: null,
        feature_index: null,
      },
      kind: "recurring_slip",
      correctAttempts: 1,
      incorrectAttempts: 2,
      recentResults: [false, true, false],
      lastAttemptAt: "2026-08-17T09:00:00.000Z",
      lastAttemptCorrect: false,
    },
  ];

  it("starts one test containing the complete deduplicated mistake bank", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(
      <MistakeTestCard spots={spots} onStart={onStart} onReview={vi.fn()} />,
    );

    expect(screen.getByText("missed more than once")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Test my 1 mistake" }));
    expect(onStart).toHaveBeenCalledWith(["mistake:a"]);
  });

  it("explains automatic collection and disables an empty test", () => {
    render(<MistakeTestCard spots={[]} onStart={vi.fn()} onReview={vi.fn()} />);
    expect(screen.getByText(/saved here automatically/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "No mistakes to test" })).toBeDisabled();
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

    expect(screen.getByText("18 new / session")).toBeVisible();
    await user.click(screen.getByText("Learning plan"));
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent?.includes(
            "420 unfamiliar connections over approximately 24 planned sessions",
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
