import { describe, expect, it } from "vitest";
import {
  orderedSessionHistory,
  replayAssociationIds,
} from "./session-history";
import type { Association, Attempt, SessionResult } from "./types";

const association = (id: string): Association => ({
  id,
  record_id: `record:${id}`,
  section_code: "A",
  kind: "streets_to_category",
  direction: "reverse",
  prompt: id,
  answer: id,
  required: true,
  scope: "record_set",
  parent_association_id: null,
  feature_index: null,
});
const result = (overrides: Partial<SessionResult> = {}): SessionResult => ({
  session_id: "old-session",
  scope: "course",
  section_code: null,
  question_count: 2,
  correct_count: 1,
  percentage: 50,
  incorrect_association_ids: ["b"],
  completed_at: "2026-07-25T10:00:00.000Z",
  ...overrides,
});
const attempt = (
  associationId: string,
  position: number,
): Attempt => ({
  association_id: associationId,
  exercise_family: "multiple_choice",
  correct: true,
  used_reveal: false,
  latency_ms: 1000,
  confidence: 3,
  created_at: `2026-07-25T10:0${position}:00.000Z`,
  session_id: "old-session",
  phase: "first_pass",
  question_instance_id: `old-session:1:${position}`,
});

describe("learning session history", () => {
  const bank = [association("a"), association("b")];

  it("uses the exact stored queue for new history records", () => {
    expect(
      replayAssociationIds(
        result({ association_ids: ["b", "a"] }),
        [attempt("a", 0), attempt("b", 1)],
        bank,
      ),
    ).toEqual(["b", "a"]);
  });

  it("reconstructs old queues from required first-pass attempts", () => {
    expect(
      replayAssociationIds(
        result(),
        [attempt("b", 1), attempt("a", 0)],
        bank,
      ),
    ).toEqual(["a", "b"]);
  });

  it("orders the most recently completed session first", () => {
    expect(
      orderedSessionHistory([
        result(),
        result({
          session_id: "new",
          completed_at: "2026-07-27T10:00:00.000Z",
        }),
      ]).map((item) => item.session_id),
    ).toEqual(["new", "old-session"]);
  });
});
