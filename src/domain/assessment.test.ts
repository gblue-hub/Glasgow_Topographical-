import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createAssessmentOrder,
  createAssessmentSession,
  mockCoverage,
  validateAssessmentSession,
} from "./assessment";
import { isExactAnswer } from "./questions";
import type { Association, MockQuestionHistory } from "./types";

const association = (
  index: number,
  overrides: Partial<Association> = {},
): Association => ({
  id: `association:${index}`,
  record_id: `record:${Math.floor(index / 2)}`,
  section_code: "S",
  kind: index % 2 ? "category_to_streets" : "streets_to_category",
  direction: index % 2 ? "forward" : "reverse",
  prompt: `Prompt ${index}`,
  answer: `Answer ${index}`,
  required: true,
  scope: "record_set",
  parent_association_id: null,
  feature_index: null,
  ...overrides,
});
const bank = Array.from({ length: 250 }, (_, index) => association(index));
const served = (index: number, day: number): MockQuestionHistory => ({
  association_id: `association:${index}`,
  times_served: 1,
  first_served_at: `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  last_served_at: `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  last_session_id: "mock:old",
});

describe("exhaustive final assessment", () => {
  it("includes every required record-set association and no atomic remediation child", () => {
    const children = Array.from({ length: 30 }, (_, index) =>
      association(1000 + index, {
        required: false,
        scope: "street",
        parent_association_id: "association:1",
        feature_index: index,
      }),
    );
    const order = createAssessmentOrder({
      mode: "final",
      associations: [...bank, ...children],
      seed: "final-seed",
    });
    expect(order).toHaveLength(bank.length);
    expect(new Set(order.map((item) => item.id))).toEqual(
      new Set(bank.map((item) => item.id)),
    );
  });

  it("uses all 3,344 required production associations", () => {
    const production = JSON.parse(
      readFileSync(
        new URL("../../public/data/coverage-ledger.v1.json", import.meta.url),
        "utf8",
      ),
    ) as { associations: Association[] };
    const order = createAssessmentOrder({
      mode: "final",
      associations: production.associations,
      seed: "production-final",
    });
    expect(order).toHaveLength(3344);
    expect(order.every((item) => item.required && item.scope === "record_set")).toBe(true);
  });
});

describe("rotating mock selection", () => {
  it("uses 100 unique questions", () => {
    const order = createAssessmentOrder({
      mode: "mock",
      associations: bank,
      seed: "attempt-one",
    });
    expect(order).toHaveLength(100);
    expect(new Set(order.map((item) => item.id)).size).toBe(100);
  });

  it("reproduces supplied seeds independently of coverage history", () => {
    const first = createAssessmentOrder({
      mode: "mock",
      associations: bank,
      seed: "shared",
      suppliedSeed: true,
      history: [],
    });
    const second = createAssessmentOrder({
      mode: "mock",
      associations: bank,
      seed: "shared",
      suppliedSeed: true,
      history: bank.slice(0, 150).map((_, index) => served(index, 1)),
    });
    expect(second.map((item) => item.id)).toEqual(first.map((item) => item.id));
  });

  it("uses a different default selection for a different attempt seed", () => {
    const first = createAssessmentOrder({
      mode: "mock",
      associations: bank,
      seed: "attempt-a",
    });
    const second = createAssessmentOrder({
      mode: "mock",
      associations: bank,
      seed: "attempt-b",
    });
    expect(second.map((item) => item.id)).not.toEqual(first.map((item) => item.id));
  });

  it("prioritises unseen questions then least-recently served questions", () => {
    const history = bank.slice(0, 180).map((_, index) =>
      served(index, (index % 28) + 1),
    );
    const order = createAssessmentOrder({
      mode: "mock",
      associations: bank,
      seed: "rotating",
      history,
    });
    const ids = new Set(order.map((item) => item.id));
    for (let index = 180; index < 250; index++)
      expect(ids.has(`association:${index}`)).toBe(true);
    expect(order.slice(0, 70).every((item) => Number(item.id.split(":")[1]) >= 180)).toBe(true);
  });

  it("tracks cumulative bank coverage", () => {
    const history = bank.slice(0, 125).map((_, index) => served(index, 1));
    expect(mockCoverage(bank, history)).toEqual({
      served: 125,
      total: 250,
      percentage: 50,
    });
  });
});

describe("assessment recovery and grouped scoring", () => {
  it("restores a valid exact order, answer map, position, seed and version", () => {
    const session = createAssessmentSession({
      mode: "mock",
      associations: bank,
      contentVersion: "content:1",
      seed: "recover-me",
      suppliedSeed: true,
      now: "2026-07-13T12:00:00.000Z",
    });
    session.position = 17;
    session.answers[session.association_ids[0]] = {
      association_id: session.association_ids[0],
      selected_option_ids: ["option:a"],
      selected_labels: ["A"],
      correct_labels: ["A"],
      correct: true,
      latency_ms: 500,
      answered_at: "2026-07-13T12:01:00.000Z",
    };
    expect(validateAssessmentSession(session, bank, "content:1")).toBeNull();
    expect(validateAssessmentSession(session, bank, "content:2")).toBe(
      "content version changed",
    );
  });

  it("requires an exact grouped selection", () => {
    expect(isExactAnswer(["a", "b"], ["a", "b"])).toBe(true);
    expect(isExactAnswer(["a"], ["a", "b"])).toBe(false);
    expect(isExactAnswer(["a", "b", "extra"], ["a", "b"])).toBe(false);
  });
});
