import { describe, expect, it } from "vitest";
import { learningSessionQueue, validateLearningSession } from "./learning-session";
import type { Association, LearningSession } from "./types";

const association = (id: string): Association => ({ id, record_id: id, section_code: "A", kind: "category_to_streets", direction: "forward", prompt: id, answer: id, required: true, scope: "record_set", parent_association_id: null, feature_index: null });
const bank = [association("a"), association("b")];
const session: LearningSession = { id: "active:learning", schema_version: "1.0.0", status: "active", content_version: "v1", generator_version: "section-questions.v2.0.0", session_id: "seed", source_mode: "section", selection_label: "Section A", section_code: "A", section_codes: ["A"], return_view: "sections", association_ids: ["b", "a"], position: 1, round: 1, phase: "first_pass", selected_option_ids: ["option"], checked: true, clue: false, hint_level: 0, first_pass_correct: 1, mistake_ids: ["b"], answer_review: [], created_at: "2026-07-13T00:00:00.000Z", updated_at: "2026-07-13T00:01:00.000Z" };

describe("learning quiz recovery", () => {
  it("restores the exact saved question order", () => {
    expect(validateLearningSession(session, bank, "v1")).toBeNull();
    expect(learningSessionQueue(session, bank).map((item) => item.id)).toEqual(["b", "a"]);
  });
  it("retires stale or structurally invalid sessions", () => {
    expect(validateLearningSession(session, bank, "v2")).toBe("content version changed");
    expect(validateLearningSession({ ...session, generator_version: "old" }, bank, "v1")).toBe("question generator changed");
    expect(validateLearningSession({ ...session, position: 2 }, bank, "v1")).toBe("invalid question position");
    expect(validateLearningSession({ ...session, association_ids: ["a", "missing"] }, bank, "v1")).toBe("question bank changed");
  });
});
