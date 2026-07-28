// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Association, SessionResult } from "../domain/types";
import { SessionHistory } from "./SessionHistory";

afterEach(cleanup);

const association: Association = {
  id: "a",
  record_id: "record:a",
  section_code: "A",
  kind: "streets_to_category",
  direction: "reverse",
  prompt: "Road",
  answer: "Place",
  required: true,
  scope: "record_set",
  parent_association_id: null,
  feature_index: null,
};
const result: SessionResult = {
  session_id: "session",
  scope: "course",
  section_code: null,
  selection_label: "North learning session",
  source_mode: "daily",
  focus_area: "north",
  association_ids: ["a"],
  question_count: 1,
  correct_count: 1,
  percentage: 100,
  incorrect_association_ids: [],
  completed_at: "2026-07-25T10:00:00.000Z",
};

describe("SessionHistory", () => {
  it("shows completed sessions and replays their exact stored queue", async () => {
    const onReplay = vi.fn();
    render(
      <SessionHistory
        results={[result]}
        attempts={[]}
        associations={[association]}
        onReplay={onReplay}
      />,
    );

    expect(screen.getByText("North learning session")).toBeVisible();
    expect(screen.getByText(/recommended learning · north/i)).toBeVisible();
    await userEvent.setup().click(
      screen.getByRole("button", { name: /replay this session/i }),
    );
    expect(onReplay).toHaveBeenCalledWith(result, ["a"]);
  });
});
