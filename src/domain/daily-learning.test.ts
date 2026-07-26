import { describe, expect, it } from "vitest";
import {
  buildDailyLearningPlan,
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
  section_code: record % 2 ? "A" : "B",
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
  next_due_at: "2026-07-25T12:00:00.000Z",
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

describe("daily learning selection", () => {
  it("defaults a new learner to a capped Recognition queue", () => {
    const bank = pairedBank(30);
    const plan = buildDailyLearningPlan({
      associations: [
        ...bank,
        association(100, "reverse", { required: false }),
        association(101, "reverse", { scope: "street" }),
      ],
      mastery: new Map(),
      attempts: [],
      now: NOW,
      seed: "new-learner",
    });

    expect(plan.direction).toBe("reverse");
    expect(plan.queue).toHaveLength(15);
    expect(plan.queue.every((item) => item.direction === "reverse")).toBe(true);
    expect(new Set(plan.queue.map((item) => item.record_id)).size).toBe(15);
    expect(new Set(plan.queue.map((item) => item.section_code))).toEqual(
      new Set([plan.focusSectionCode]),
    );
    expect(plan.counts).toEqual({ due: 0, weak: 0, new: 15, total: 15 });
  });

  it("chooses the direction with the greatest due and weak burden", () => {
    const bank = pairedBank(12);
    const states = new Map<string, Mastery>();
    for (let record = 0; record < 2; record += 1)
      states.set(
        `${record}:reverse`,
        mastery(`${record}:reverse`, {
          next_due_at: "2026-07-22T12:00:00.000Z",
        }),
      );
    for (let record = 0; record < 4; record += 1)
      states.set(
        `${record}:forward`,
        mastery(`${record}:forward`, {
          state: "lapsed",
          consecutive_errors: 2,
        }),
      );

    const plan = buildDailyLearningPlan({
      associations: bank,
      mastery: states,
      attempts: [],
      now: NOW,
      seed: "direction",
      limit: 6,
    });

    expect(plan.direction).toBe("forward");
    expect(plan.items.slice(0, 4).map((item) => item.reason)).toEqual([
      "weak",
      "weak",
      "weak",
      "weak",
    ]);
    expect(plan.counts).toEqual({ due: 0, weak: 4, new: 2, total: 6 });
  });

  it("orders overdue reviews before weak items, then fills with new items", () => {
    const bank = pairedBank(8).filter((item) => item.direction === "reverse");
    const states = new Map<string, Mastery>([
      [
        "0:reverse",
        mastery("0:reverse", {
          next_due_at: "2026-07-22T12:00:00.000Z",
        }),
      ],
      [
        "1:reverse",
        mastery("1:reverse", {
          next_due_at: "2026-07-20T12:00:00.000Z",
        }),
      ],
      [
        "2:reverse",
        mastery("2:reverse", {
          state: "lapsed",
          consecutive_errors: 2,
        }),
      ],
    ]);

    const plan = buildDailyLearningPlan({
      associations: bank,
      mastery: states,
      attempts: [],
      now: NOW,
      seed: "priority",
      limit: 5,
    });

    expect(plan.items.map((item) => item.reason)).toEqual([
      "due",
      "due",
      "weak",
      "new",
      "new",
    ]);
    expect(plan.queue.slice(0, 2).map((item) => item.id)).toEqual([
      "1:reverse",
      "0:reverse",
    ]);
    expect(plan.counts).toEqual({ due: 2, weak: 1, new: 2, total: 5 });
  });

  it("keeps reviews first and fills fresh material from one focus section", () => {
    const bank = [
      association(0, "reverse", { section_code: "A" }),
      ...Array.from({ length: 6 }, (_, index) =>
        association(index + 1, "reverse", { section_code: "B" }),
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        association(index + 10, "reverse", { section_code: "C" }),
      ),
    ];
    const states = new Map<string, Mastery>([
      [
        "0:reverse",
        mastery("0:reverse", {
          next_due_at: "2026-07-22T12:00:00.000Z",
        }),
      ],
    ]);

    const plan = buildDailyLearningPlan({
      associations: bank,
      mastery: states,
      attempts: [],
      now: NOW,
      seed: "clustered-fill",
      limit: 6,
    });

    expect(plan.items[0]).toMatchObject({
      reason: "due",
      association: { id: "0:reverse" },
    });
    expect(plan.focusSectionCode).not.toBeNull();
    expect(
      plan.items
        .filter((item) => item.reason === "new")
        .map((item) => item.association.section_code),
    ).toEqual(Array(5).fill(plan.focusSectionCode));
  });

  it("spills into another section only after the focus cluster is exhausted", () => {
    const bank = [
      ...Array.from({ length: 3 }, (_, index) =>
        association(index, "reverse", { section_code: "A" }),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        association(index + 10, "reverse", { section_code: "B" }),
      ),
    ];
    const plan = buildDailyLearningPlan({
      associations: bank,
      mastery: new Map(),
      attempts: [],
      now: NOW,
      seed: "cluster-spill",
      limit: 5,
    });

    expect(plan.focusSectionCode).toBe("A");
    expect(plan.queue.slice(0, 3).map((item) => item.section_code)).toEqual([
      "A",
      "A",
      "A",
    ]);
    expect(plan.queue.slice(3).map((item) => item.section_code)).toEqual([
      "B",
      "B",
    ]);
  });

  it("uses a recent first-pass miss as weak evidence and ignores its correction", () => {
    const bank = pairedBank(3).filter((item) => item.direction === "reverse");
    const plan = buildDailyLearningPlan({
      associations: bank,
      mastery: new Map([
        ["0:reverse", mastery("0:reverse")],
        ["1:reverse", mastery("1:reverse")],
      ]),
      attempts: [
        attempt("0:reverse", false, "2026-07-22T10:00:00.000Z"),
        attempt("0:reverse", true, "2026-07-22T10:01:00.000Z", {
          phase: "correction",
        }),
        attempt("1:reverse", false, "2026-06-01T10:00:00.000Z"),
      ],
      now: NOW,
      seed: "recent-miss",
      limit: 3,
    });

    expect(plan.items.map((item) => [item.association.id, item.reason])).toEqual([
      ["0:reverse", "weak"],
      ["2:reverse", "new"],
    ]);
  });

  it("is reproducible for a seed and independent of source ordering", () => {
    const bank = pairedBank(30);
    const first = buildDailyLearningPlan({
      associations: bank,
      mastery: new Map(),
      attempts: [],
      now: NOW,
      seed: "stable",
    });
    const second = buildDailyLearningPlan({
      associations: [...bank].reverse(),
      mastery: new Map(),
      attempts: [],
      now: NOW,
      seed: "stable",
    });
    const different = buildDailyLearningPlan({
      associations: bank,
      mastery: new Map(),
      attempts: [],
      now: NOW,
      seed: "different",
    });

    expect(second.queue.map((item) => item.id)).toEqual(
      first.queue.map((item) => item.id),
    );
    expect(second.focusSectionCode).toBe(first.focusSectionCode);
    expect(different.queue.map((item) => item.id)).not.toEqual(
      first.queue.map((item) => item.id),
    );
  });

  it("avoids duplicate records when alternatives are available", () => {
    const bank = [
      association(0, "reverse", { id: "0:reverse:a" }),
      association(0, "reverse", { id: "0:reverse:b" }),
      association(1, "reverse"),
      association(2, "reverse"),
    ];
    const plan = buildDailyLearningPlan({
      associations: bank,
      mastery: new Map(),
      attempts: [],
      now: NOW,
      seed: "records",
      limit: 3,
    });

    expect(new Set(plan.queue.map((item) => item.record_id)).size).toBe(3);
  });

  it("stops at the daily cap instead of offering an endless next batch", () => {
    const bank = pairedBank(20).filter(
      (item) => item.direction === "reverse",
    );
    const dailyAttempts = bank.slice(0, 15).map((item, index) =>
      attempt(item.id, true, `2026-07-23T09:${String(index).padStart(2, "0")}:00.000Z`, {
        source_mode: "daily",
      }),
    );
    const plan = buildDailyLearningPlan({
      associations: bank,
      mastery: new Map(),
      attempts: dailyAttempts,
      now: NOW,
      dayStart: "2026-07-23T00:00:00.000Z",
      seed: "completed-day",
    });
    expect(plan.queue).toEqual([]);
    expect(plan.counts).toEqual({ due: 0, weak: 0, new: 0, total: 0 });
  });

  it("offers only the uncompleted part of a partially finished daily target", () => {
    const bank = pairedBank(20).filter(
      (item) => item.direction === "reverse",
    );
    const dailyAttempts = bank.slice(0, 5).map((item, index) =>
      attempt(item.id, true, `2026-07-23T09:0${index}:00.000Z`, {
        source_mode: "daily",
      }),
    );
    const plan = buildDailyLearningPlan({
      associations: bank,
      mastery: new Map(),
      attempts: dailyAttempts,
      now: NOW,
      dayStart: "2026-07-23T00:00:00.000Z",
      seed: "partial-day",
    });
    expect(plan.queue).toHaveLength(10);
    expect(plan.queue.every((item) => item.direction === "reverse")).toBe(
      true,
    );
  });
});

describe("exam readiness", () => {
  it("combines whole-bank mastery with recent unassisted first-pass evidence", () => {
    const bank = pairedBank(2);
    const states = new Map<string, Mastery>([
      [
        "0:reverse",
        mastery("0:reverse", { state: "mastered" }),
      ],
      [
        "0:forward",
        mastery("0:forward", { state: "mastered" }),
      ],
    ]);
    const readiness = calculateExamReadiness({
      associations: [
        ...bank,
        association(10, "reverse", { required: false }),
      ],
      mastery: states,
      attempts: [
        attempt("0:reverse", true, "2026-07-22T10:00:00.000Z"),
        attempt("0:forward", false, "2026-07-22T10:00:00.000Z"),
        attempt("1:reverse", true, "2026-07-22T10:00:00.000Z", {
          used_reveal: true,
        }),
        attempt("1:forward", true, "2026-07-22T10:00:00.000Z", {
          phase: "correction",
        }),
        attempt("10:reverse", true, "2026-07-22T10:00:00.000Z"),
        attempt("1:reverse", true, "2026-05-01T10:00:00.000Z"),
      ],
      now: NOW,
    });

    expect(readiness.mastery).toEqual({
      mastered: 2,
      current: 2,
      overdue: 0,
      required: 4,
      percentage: 50,
      currentPercentage: 50,
    });
    expect(readiness.recentUnassistedFirstPass).toMatchObject({
      correct: 1,
      attempted: 2,
      uniqueAssociations: 2,
      accuracyPercentage: 50,
      since: "2026-06-23T12:00:00.000Z",
    });
    expect(readiness.score).toBe(50);
    expect(readiness.level).toBe("progressing");
  });

  it("uses only the latest recent first-pass result per association", () => {
    const bank = [association(0, "reverse")];
    const readiness = calculateExamReadiness({
      associations: bank,
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

  it("does not call overdue mastery or a guessed correct answer ready", () => {
    const bank = [association(0, "reverse")];
    const readiness = calculateExamReadiness({
      associations: bank,
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
      mastered: 1,
      current: 0,
      overdue: 1,
      currentPercentage: 0,
    });
    expect(readiness.recentUnassistedFirstPass).toMatchObject({
      correct: 0,
      attempted: 1,
      accuracyPercentage: 0,
    });
    expect(readiness.score).toBe(0);
    expect(readiness.level).toBe("building");
  });
});
