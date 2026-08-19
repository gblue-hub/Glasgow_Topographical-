// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionQuestion } from "../domain/questions";
import { WrongAnswerCorrection } from "./WrongAnswerCorrection";

afterEach(cleanup);

describe("WrongAnswerCorrection", () => {
  it("teaches the two street signatures for a confused district", () => {
    const question: SectionQuestion = {
      id: "q",
      association_id: "a",
      record_id: "budhill",
      direction: "streets_to_category",
      prompt: "Budhill",
      street_names: ["Balgair Terrace", "Gartcocher Terrace", "Greenfield Road", "Cramond Terrace"],
      options: [{ id: "budhill", label: "Budhill" }, { id: "sandyhills", label: "Sandyhills" }],
      answer_option_ids: ["budhill"],
      selection_mode: "single",
    };

    render(
      <WrongAnswerCorrection
        question={question}
        selectedAnswers={["Sandyhills"]}
        correctAnswers={["Budhill"]}
        missingAnswers={["Budhill"]}
        extraAnswers={["Sandyhills"]}
        explanations={[{
          optionId: "sandyhills",
          recordId: "sandyhills",
          selectedLabel: "Sandyhills",
          belongsTo: "Sandyhills",
          associatedAnswers: ["Strowan Street", "Taymouth Street", "Killin Street", "Dalry Street"],
        }]}
        onCompare={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Budhill, not Sandyhills" })).toBeVisible();
    expect(screen.getByText("Balgair Terrace")).toBeVisible();
    expect(screen.getByText("Strowan Street")).toBeVisible();
    expect(screen.queryByText("Do not include")).not.toBeInTheDocument();
  });

  it("shows only omissions and extras for a street-set correction", () => {
    const question: SectionQuestion = {
      id: "q",
      association_id: "a",
      record_id: "place",
      direction: "category_to_streets",
      prompt: "Target Place",
      street_names: ["Right Road", "Second Road"],
      options: [],
      answer_option_ids: [],
      selection_mode: "multiple",
    };

    render(
      <WrongAnswerCorrection
        question={question}
        selectedAnswers={["Right Road", "Wrong Road"]}
        correctAnswers={["Right Road", "Second Road"]}
        missingAnswers={["Second Road"]}
        extraAnswers={["Wrong Road"]}
        explanations={[]}
        onCompare={vi.fn()}
      />,
    );

    expect(screen.getByText("Add to your answer")).toBeVisible();
    expect(screen.getByText("Remove from your answer")).toBeVisible();
  });
});
