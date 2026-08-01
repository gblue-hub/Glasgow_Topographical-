import { describe, expect, it } from "vitest";
import { learningSessionQueue, validateLearningSession } from "./learning-session";
import type { Association, LearningSession } from "./types";

const association = (id: string): Association => ({ id, record_id: id, section_code: "A", kind: "category_to_streets", direction: "forward", prompt: id, answer: id, required: true, scope: "record_set", parent_association_id: null, feature_index: null });
const bank = [association("a"), association("b")];
const session: LearningSession = { id: "active:learning", schema_version: "1.1.0", status: "active", content_version: "v1", generator_version: "section-questions.v2.2.0", session_id: "seed", source_mode: "section", selection_label: "Section A", section_code: "A", section_codes: ["A"], return_view: "sections", association_ids: ["b", "a"], position: 1, round: 1, phase: "first_pass", question_stage: "feedback", studied_record_ids: [], selected_option_ids: ["option"], checked: true, map_open: false, used_assistance: false, hint_level: 0, confidence: 3, first_pass_correct: 1, mistake_ids: ["b"], answer_review: [], created_at: "2026-07-13T00:00:00.000Z", updated_at: "2026-07-13T00:01:00.000Z" };

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
  it("accepts the complete learning interaction fields", () => {
    expect(
      validateLearningSession(
        {
          ...session,
          question_stage: "choices",
          selected_option_ids: [],
          checked: false,
          confidence: 2,
        },
        bank,
        "v1",
      ),
    ).toBeNull();
  });
  it("rejects selected answers whose choices are marked hidden", () => {
    expect(
      validateLearningSession(
        { ...session, question_stage: "prompt", checked: false },
        bank,
        "v1",
      ),
    ).toBe("selected answers were hidden");
  });
  it("allows a persisted daily curriculum to mix recognition and recall", () => {
    expect(
      validateLearningSession(
        {
          ...session,
          source_mode: "daily",
          question_stage: "prompt",
          selected_option_ids: [],
          checked: false,
        },
        bank,
        "v1",
      ),
    ).toBeNull();
    expect(
      validateLearningSession(
        {
          ...session,
          source_mode: "daily",
          practice_direction: "reverse",
          question_stage: "prompt",
          selected_option_ids: [],
          checked: false,
        },
        bank,
        "v1",
      ),
    ).toBe("practice directions were mixed");
  });

  it("persists a valid geographic focus for an area-first session", () => {
    expect(
      validateLearningSession(
        {
          ...session,
          source_mode: "daily",
          daily_focus_area: "north",
          question_stage: "prompt",
          selected_option_ids: [],
          checked: false,
        },
        bank,
        "v1",
      ),
    ).toBeNull();
  });
});
