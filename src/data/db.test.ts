import { describe, expect, it } from "vitest";
import {
  progressItemKey,
  progressItemTimestamp,
} from "./db";
import type {
  Attempt,
  LearningPreferences,
  LearningSession,
} from "../domain/types";

describe("cloud progress identity", () => {
  it("gives repeated evidence from one question a stable unique key", () => {
    const attempt: Attempt = {
      association_id: "required:1",
      exercise_family: "multiple_choice",
      correct: true,
      used_reveal: false,
      latency_ms: 800,
      confidence: 3,
      created_at: "2026-07-26T12:00:00.000Z",
      session_id: "daily:one",
      question_instance_id: "seed:0:required:1",
      phase: "first_pass",
    };
    expect(progressItemKey("attempts", attempt)).toBe(
      "daily:one:seed:0:required:1:required:1:first_pass:multiple_choice",
    );
    expect(progressItemTimestamp("attempts", attempt)).toBe(
      attempt.created_at,
    );
  });

  it("uses the fixed active-session identity and its update time", () => {
    const session = {
      id: "active:learning",
      updated_at: "2026-07-26T12:01:00.000Z",
    } as LearningSession;
    expect(progressItemKey("learningSessions", session)).toBe(
      "active:learning",
    );
    expect(progressItemTimestamp("learningSessions", session)).toBe(
      session.updated_at,
    );
  });

  it("stores one timestamped learning-plan preference record", () => {
    const preferences: LearningPreferences = {
      id: "learning-plan",
      target_weeks: 4,
      study_days_per_week: 6,
      target_date: "2026-08-23T23:59:59.999Z",
      updated_at: "2026-07-26T12:02:00.000Z",
    };
    expect(progressItemKey("learningPreferences", preferences)).toBe(
      "learning-plan",
    );
    expect(progressItemTimestamp("learningPreferences", preferences)).toBe(
      preferences.updated_at,
    );
  });
});
