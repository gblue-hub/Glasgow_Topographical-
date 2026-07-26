import { describe, expect, it } from "vitest";
import {
  buildDailyLearningPlan,
  calculateDailyNewTarget,
  calculateExamReadiness,
} from "./daily-learning";
import type { Association, Attempt, Mastery } from "./types";

const NOW = "2026-07-23T12:00:00.000Z";

const association = (
  record: number,
  direction: Association["direction"],
  overrides: Partial<Association> = {},
): Association => ({
  id: `${record}:${direction}`,
  record_id: `record:${record}`,
  section_code: record < 5 ? "A" : "B",
  kind:
    direction === "reverse"
      ? "streets_to_category"
      : "category_to_streets",
  direction,
  prompt: `Prompt ${record}`,
  answer: `Answer ${record}`,
  required: true,
  scope: "record_set",
  parent_association_id: null,
  feature_index: null,
  ...overrides,
});

const pairedBank = (records: number) =>
  Array.from({ length: records }, (_, record) => [
    association(record, "reverse"),
    association(record, "forward"),
  ]).flat();

const mastery = (
  associationId: string,
  overrides: Partial<Mastery> = {},
): Mastery => ({
  association_id: associationId,
  state: "learning",
  correct_retrievals: 1,
  recall_successes: 1,
  consecutive_errors: 0,
  last_seen_at: "2026-07-20T12:00:00.000Z",
  next_due_at: "2026-07-20T12:00:00.000Z",
  ...overrides,
});

const attempt = (
  associationId: string,
  correct: boolean,
  createdAt: string,
  overrides: Partial<Attempt> = {},
): Attempt => ({
  association_id: associationId,
  exercise_family: "multiple_choice",
  correct,
  used_reveal: false,
  latency_ms: 1000,
  confidence: correct ? 3 : 1,
  created_at: createdAt,
  phase: "first_pass",
  ...overrides,
});

const successfulDays = (
  associationId: string,
  dates: string[],
  overrides: Partial<Attempt> = {},
) =>
  dates.map((date) =>
    attempt(associationId, true, `${date}T10:00:00.000Z`, overrides),
  );

describe("daily learning curriculum", () => {
  it("paces only the easier recognition introductions", () => {
    const bank = pairedBank(14);
    const states = new Map<string, Mastery>(
      bank
        .filter((item) => item.direction === "reverse")
        .slice(0, 4)
        .map((item) => [item.id, mastery(item.id)]),
    );

    expect(
      calculateDailyNewTarget({
        associations: bank,
        mastery: states,
        targetDate: "2026-08-06T12:00:00.000Z",
        studyDaysPerWeek: 5,
        now: NOW,
      }),
    ).toEqual({
      remainingNew: 10,
      remainingStudyDays: 10,
      dailyNewTarget: 1,
    });
  });

  it("introduces new records through recognition from one full section", () => {
    const plan = buildDailyLearningPlan({
      associations: pairedBank(10),
      mastery: new Map(),
      attempts: [],
      now: NOW,
      seed: "new-learner",
      newLimit: 3,
    });

    expect(plan.direction).toBe("reverse");
    expect(plan.focusSectionCode).toBe("A");
    expect(plan.queue).toHaveLength(3);
    expect(plan.queue.every((item) => item.direction === "reverse")).toBe(true);
    expect(plan.queue.every((item) => item.section_code === "A")).toBe(true);
    expect(plan.blockCounts).toEqual({
      recovery: 0,
      maintenance: 0,
      recognition: 0,
      new: 3,
      promotion: 0,
      total: 3,
    });
  });

  it("does not introduce the next section until every record in the active section has begun", () => {
    const bank = pairedBank(8);
    const partlyIntroduced = successfulDays(
      "0:reverse",
      ["2026-07-22"],
    );
    const first = buildDailyLearningPlan({
      associations: bank,
      mastery: new Map([["0:reverse", mastery("0:reverse")]]),
      attempts: partlyIntroduced,
      now: NOW,
      seed: "section-order",
      newLimit: 5,
    });
    expect(first.focusSectionCode).toBe("A");
    expect(
      first.items
        .filter((item) => item.block === "new")
        .every((item) => item.association.section_code === "A"),
    ).toBe(true);

    const allAStarted = Array.from({ length: 5 }, (_, record) =>
      attempt(`${record}:reverse`, true, "2026-07-22T10:00:00.000Z"),
    );
    const second = buildDailyLearningPlan({
      associations: bank,
      mastery: new Map(
        Array.from({ length: 5 }, (_, record) => [
          `${record}:reverse`,
          mastery(`${record}:reverse`),
        ]),
      ),
      attempts: allAStarted,
      now: NOW,
      seed: "section-order",
      newLimit: 5,
    });
    expect(second.focusSectionCode).toBe("B");
  });

  it("keeps a recognition mistake in daily recovery until two independent study days succeed", () => {
    const bank = pairedBank(1);
    const failure = attempt(
      "0:reverse",
      false,
      "2026-07-20T10:00:00.000Z",
    );
    const correction = attempt(
      "0:reverse",
      true,
      "2026-07-20T10:01:00.000Z",
      { phase: "correction" },
    );
    const oneRecoveryDay = successfulDays("0:reverse", ["2026-07-21"]);
    const twoRecoveryDays = successfulDays("0:reverse", [
      "2026-07-21",
      "2026-07-22",
    ]);

    const build = (attempts: Attempt[]) =>
      buildDailyLearningPlan({
        associations: bank,
        mastery: new Map([["0:reverse", mastery("0:reverse")]]),
        attempts,
        now: NOW,
      });

    expect(build([failure, correction]).items[0]?.block).toBe("recovery");
    expect(build([failure, ...oneRecoveryDay]).items[0]?.block).toBe(
      "recovery",
    );
    expect(build([failure, ...twoRecoveryDays]).items[0]?.block).toBe(
      "recognition",
    );
  });

  it("does not let a hint or a guessed answer clear daily recovery", () => {
    const plan = buildDailyLearningPlan({
      associations: pairedBank(1),
      mastery: new Map([["0:reverse", mastery("0:reverse")]]),
      attempts: [
        attempt("0:reverse", false, "2026-07-19T10:00:00.000Z"),
        ...successfulDays("0:reverse", ["2026-07-20"]),
        ...successfulDays("0:reverse", ["2026-07-21"], {
          used_reveal: true,
        }),
        ...successfulDays("0:reverse", ["2026-07-22"], {
          confidence: 1,
        }),
      ],
      now: NOW,
    });
    expect(plan.items[0]?.block).toBe("recovery");
  });

  it("promotes solid recognition to harder recall only on a later day", () => {
    const bank = pairedBank(1);
    const recognition = successfulDays("0:reverse", [
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
    ]);
    const nextDay = buildDailyLearningPlan({
      associations: bank,
      mastery: new Map([
        ["0:reverse", mastery("0:reverse")],
        ["0:forward", mastery("0:forward")],
      ]),
      attempts: recognition,
      now: NOW,
    });
    expect(nextDay.items[0]).toMatchObject({
      block: "promotion",
      association: { id: "0:forward" },
    });

    const sameDay = buildDailyLearningPlan({
      associations: bank,
      mastery: new Map([
        ["0:reverse", mastery("0:reverse")],
        ["0:forward", mastery("0:forward")],
      ]),
      attempts: [
        ...successfulDays("0:reverse", ["2026-07-20", "2026-07-21"]),
        attempt("0:reverse", true, "2026-07-23T09:00:00.000Z"),
      ],
      now: NOW,
    });
    expect(sameDay.blockCounts.promotion).toBe(0);
  });

  it("demotes a recall mistake to recognition recovery, then restores recall", () => {
    const bank = pairedBank(1);
    const recognitionSolid = successfulDays("0:reverse", [
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ]);
    const recallFailure = attempt(
      "0:forward",
      false,
      "2026-07-20T10:00:00.000Z",
    );
    const recovered = successfulDays("0:reverse", [
      "2026-07-21",
      "2026-07-22",
    ]);
    const states = new Map([
      ["0:reverse", mastery("0:reverse")],
      ["0:forward", mastery("0:forward")],
    ]);

    const recovery = buildDailyLearningPlan({
      associations: bank,
      mastery: states,
      attempts: [...recognitionSolid, recallFailure],
      now: NOW,
    });
    expect(recovery.items[0]).toMatchObject({
      block: "recovery",
      association: { id: "0:reverse" },
    });

    const restored = buildDailyLearningPlan({
      associations: bank,
      mastery: states,
      attempts: [...recognitionSolid, recallFailure, ...recovered],
      now: NOW,
    });
    expect(restored.items[0]).toMatchObject({
      block: "promotion",
      association: { id: "0:forward" },
    });
  });

  it("rotates older recall-solid knowledge alongside new material", () => {
    const bank = pairedBank(7);
    const olderRecognition = successfulDays("0:reverse", [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
    const olderRecall = successfulDays("0:forward", [
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
    ]);
    const plan = buildDailyLearningPlan({
      associations: bank,
      mastery: new Map([
        ["0:reverse", mastery("0:reverse")],
        ["0:forward", mastery("0:forward")],
      ]),
      attempts: [...olderRecognition, ...olderRecall],
      now: NOW,
      newLimit: 2,
    });

    expect(plan.items.some((item) => item.block === "maintenance")).toBe(true);
    expect(plan.items.some((item) => item.block === "new")).toBe(true);
    expect(plan.direction).toBe("mixed");
  });

  it("does not use attempts dated after the plan time as learning evidence", () => {
    const plan = buildDailyLearningPlan({
      associations: pairedBank(1),
      mastery: new Map(),
      attempts: successfulDays("0:reverse", [
        "2026-07-24",
        "2026-07-25",
        "2026-07-26",
      ]),
      now: NOW,
    });
    expect(plan.items[0]).toMatchObject({
      block: "new",
      association: { id: "0:reverse" },
    });
  });
});

describe("exam readiness", () => {
  it("combines whole-bank mastery with recent unassisted first-pass evidence", () => {
    const bank = pairedBank(2);
    const states = new Map<string, Mastery>([
      ["0:reverse", mastery("0:reverse", { state: "mastered", next_due_at: "2026-07-25T12:00:00.000Z" })],
      ["0:forward", mastery("0:forward", { state: "mastered", next_due_at: "2026-07-25T12:00:00.000Z" })],
    ]);
    const readiness = calculateExamReadiness({
      associations: bank,
      mastery: states,
      attempts: [
        attempt("0:reverse", true, "2026-07-22T10:00:00.000Z"),
        attempt("0:forward", false, "2026-07-22T10:00:00.000Z"),
        attempt("1:reverse", true, "2026-07-22T10:00:00.000Z", {
          used_reveal: true,
        }),
      ],
      now: NOW,
    });

    expect(readiness.mastery).toMatchObject({
      mastered: 2,
      current: 2,
      overdue: 0,
      required: 4,
      percentage: 50,
    });
    expect(readiness.recentUnassistedFirstPass).toMatchObject({
      correct: 1,
      attempted: 2,
      accuracyPercentage: 50,
    });
    expect(readiness.score).toBe(50);
  });

  it("uses only the latest recent first-pass result per association", () => {
    const readiness = calculateExamReadiness({
      associations: [association(0, "reverse")],
      mastery: new Map(),
      attempts: [
        attempt("0:reverse", false, "2026-07-20T10:00:00.000Z"),
        attempt("0:reverse", true, "2026-07-21T10:00:00.000Z"),
      ],
      now: NOW,
    });
    expect(readiness.recentUnassistedFirstPass).toMatchObject({
      correct: 1,
      attempted: 1,
      accuracyPercentage: 100,
    });
  });

  it("does not call overdue mastery or a guessed answer ready", () => {
    const readiness = calculateExamReadiness({
      associations: [association(0, "reverse")],
      mastery: new Map([
        [
          "0:reverse",
          mastery("0:reverse", {
            state: "mastered",
            next_due_at: "2026-07-01T12:00:00.000Z",
          }),
        ],
      ]),
      attempts: [
        attempt("0:reverse", true, "2026-07-22T10:00:00.000Z", {
          confidence: 1,
        }),
      ],
      now: NOW,
    });
    expect(readiness.mastery).toMatchObject({
      current: 0,
      overdue: 1,
    });
    expect(readiness.score).toBe(0);
    expect(readiness.level).toBe("building");
  });
});
