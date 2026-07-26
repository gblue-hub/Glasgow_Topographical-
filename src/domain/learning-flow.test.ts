import { describe, expect, it } from "vitest";
import type { Association, Mastery } from "./types";
import {
  hasIndependentSuccessfulRetrieval,
  initialQuestionConfidence,
  initialQuestionStage,
  learningStageLabel,
  needsStudyBeforeTest,
  dailySessionQueue,
  correctionSessionQueue,
} from "./learning-flow";
import type { Attempt } from "./types";

const association: Association = {
  id: "association:one",
  record_id: "record:one",
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

const mastery: Mastery = {
  association_id: association.id,
  state: "learning",
  correct_retrievals: 1,
  recall_successes: 1,
  consecutive_errors: 0,
  last_seen_at: "2026-07-22T12:00:00.000Z",
  next_due_at: "2026-07-24T12:00:00.000Z",
};

const input = {
  association,
  sourceMode: "daily" as const,
  mastery: undefined,
  hasPriorAttempt: false,
  studiedRecordIds: new Set<string>(),
  correctionMode: false,
};

describe("learning question flow", () => {
  it("studies genuinely new daily material before testing", () => {
    expect(needsStudyBeforeTest(input)).toBe(true);
    expect(initialQuestionStage(input)).toBe("study");
  });

  it("does not repeat study for the other direction of a studied record", () => {
    expect(
      initialQuestionStage({
        ...input,
        studiedRecordIds: new Set([association.record_id]),
      }),
    ).toBe("prompt");
  });

  it("skips study for seen, correction, and custom-practice questions", () => {
    expect(initialQuestionStage({ ...input, mastery })).toBe("prompt");
    expect(
      initialQuestionStage({ ...input, hasPriorAttempt: true }),
    ).toBe("prompt");
    expect(
      initialQuestionStage({ ...input, correctionMode: true }),
    ).toBe("prompt");
    expect(
      initialQuestionStage({ ...input, sourceMode: "section" }),
    ).toBe("prompt");
  });

  it("does not reteach a recall promotion as if it were new material", () => {
    expect(
      initialQuestionStage({
        ...input,
        association: {
          ...association,
          id: "association:one:forward",
          direction: "forward",
          kind: "category_to_streets",
        },
      }),
    ).toBe("prompt");
  });

  it("provides a learner-facing label for every persisted stage", () => {
    expect(Object.keys(learningStageLabel)).toEqual([
      "study",
      "prompt",
      "choices",
      "feedback",
    ]);
  });

  it("defaults unseen questions to unsure and returning questions to confident", () => {
    expect(
      initialQuestionConfidence({
        hasPriorAttempt: false,
        mastery: undefined,
        correctionMode: false,
      }),
    ).toBe(2);
    expect(
      initialQuestionConfidence({
        hasPriorAttempt: true,
        mastery: undefined,
        correctionMode: false,
      }),
    ).toBe(3);
    expect(
      initialQuestionConfidence({
        hasPriorAttempt: false,
        mastery,
        correctionMode: false,
      }),
    ).toBe(3);
    expect(
      initialQuestionConfidence({
        hasPriorAttempt: false,
        mastery: undefined,
        correctionMode: true,
      }),
    ).toBe(3);
  });

  it("advances difficulty only after an independent successful retrieval", () => {
    const attempt = (
      overrides: Partial<Attempt>,
    ): Attempt => ({
      association_id: association.id,
      exercise_family: "multiple_choice",
      correct: false,
      used_reveal: false,
      latency_ms: 1000,
      confidence: 2,
      created_at: "2026-07-23T10:00:00.000Z",
      phase: "first_pass",
      session_id: "previous",
      ...overrides,
    });
    const insufficient = [
      attempt({ correct: false }),
      attempt({ correct: true, used_reveal: true }),
      attempt({ correct: true, confidence: 1 }),
      attempt({ correct: true, phase: "correction" }),
      attempt({ correct: true, session_id: "current" }),
    ];

    expect(
      hasIndependentSuccessfulRetrieval(
        insufficient,
        association.id,
        "current",
      ),
    ).toBe(false);
    expect(
      hasIndependentSuccessfulRetrieval(
        [...insufficient, attempt({ correct: true, confidence: 3 })],
        association.id,
        "current",
      ),
    ).toBe(true);
  });

  it("teaches all new records first and tests both directions", () => {
    const recall = {
      ...association,
      id: "association:one:forward",
      direction: "forward" as const,
      kind: "category_to_streets",
    };
    const review = {
      ...association,
      id: "association:review",
      record_id: "record:review",
    };
    const queue = dailySessionQueue({
      planned: [review, association],
      studyRecordIds: new Set([association.record_id]),
      associations: [association, recall, review],
    });
    expect(queue.map((item) => item.id)).toEqual([
      association.id,
      review.id,
      recall.id,
    ]);
  });

  it("retests both recognition and recall for every missed record", () => {
    const recall = {
      ...association,
      id: "association:one:forward",
      direction: "forward" as const,
      kind: "category_to_streets",
    };
    expect(
      correctionSessionQueue(new Set([association.id]), [
        association,
        recall,
      ]).map((item) => item.id),
    ).toEqual([association.id, recall.id]);
  });
});
