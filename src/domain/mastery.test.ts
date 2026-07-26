import { describe, expect, it } from "vitest";
import type { Attempt } from "./types";
import { applyAttempt, applyAttemptEvidence, completion } from "./mastery";

const attempt = (
  correct = true,
  overrides: Partial<Attempt> = {},
): Attempt => ({
  association_id: "a",
  exercise_family: "multiple_choice",
  correct,
  used_reveal: false,
  latency_ms: 1_000,
  confidence: 3,
  created_at: "2026-07-12T12:00:00.000Z",
  ...overrides,
});

describe("mastery", () => {
  it("masters repeated confident, unassisted multiple-choice retrieval", () => {
    let state;
    for (let index = 0; index < 3; index += 1)
      state = applyAttempt(state, attempt());
    expect(state?.state).toBe("mastered");
  });

  it("does not count a revealed or hinted answer", () => {
    let state;
    for (let index = 0; index < 4; index += 1)
      state = applyAttempt(state, attempt(true, { used_reveal: true }));
    expect(state?.state).not.toBe("mastered");
    expect(state?.next_due_at).toBe("2026-07-12T16:00:00.000Z");
  });

  it("does not treat a guessed correct choice as secure retrieval", () => {
    let state;
    for (let index = 0; index < 4; index += 1)
      state = applyAttempt(state, attempt(true, { confidence: 1 }));
    expect(state?.correct_retrievals).toBe(0);
    expect(state?.state).not.toBe("mastered");
    expect(state?.next_due_at).toBe("2026-07-12T16:00:00.000Z");
  });

  it("brings an unsure correct answer back sooner", () => {
    const state = applyAttempt(undefined, attempt(true, { confidence: 2 }));
    expect(state.next_due_at).toBe("2026-07-13T12:00:00.000Z");
  });

  it("requires confidence before repeated evidence becomes mastered", () => {
    let state;
    for (let index = 0; index < 3; index += 1)
      state = applyAttempt(state, attempt(true, { confidence: 2 }));
    expect(state?.correct_retrievals).toBe(3);
    expect(state?.state).toBe("learning");
    state = applyAttempt(state, attempt(true, { confidence: 3 }));
    expect(state.state).toBe("mastered");
  });

  it("returns an incorrect answer after ten minutes", () => {
    const state = applyAttempt(undefined, attempt(false));
    expect(state.next_due_at).toBe("2026-07-12T12:10:00.000Z");
  });

  it("requires every association for completion", () => {
    const state = applyAttempt(
      applyAttempt(applyAttempt(undefined, attempt()), attempt()),
      attempt(),
    );
    expect(completion(["a", "b"], new Map([["a", state]])).complete).toBe(
      false,
    );
  });

  it("records correction practice without changing mastery evidence", () => {
    const mastered = applyAttempt(
      applyAttempt(applyAttempt(undefined, attempt()), attempt()),
      attempt(),
    );
    const previous = new Map([["a", mastered]]);
    const next = applyAttemptEvidence(
      previous,
      [attempt(false, { phase: "correction" })],
      "correction",
    );
    expect(next.get("a")).toEqual(mastered);
  });
});
