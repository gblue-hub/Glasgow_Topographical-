import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "./db";
import type { AssessmentSession, LearningSession } from "../domain/types";

const names: string[] = [];
afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe("IndexedDB migrations and recovery", () => {
  it("preserves v3 learning progress and adds assessment stores", async () => {
    const name = `migration-${crypto.randomUUID()}`;
    names.push(name);
    const legacy = new Dexie(name);
    legacy.version(3).stores({
      attempts: "++id,association_id,created_at",
      mastery: "association_id,state,next_due_at",
      studyAids: "record_id,updated_at",
      sessionResults: "++id,session_id,section_code,completed_at",
    });
    await legacy.open();
    await legacy.table("mastery").put({
      association_id: "required:1",
      state: "mastered",
      correct_retrievals: 3,
      recall_successes: 3,
      consecutive_errors: 0,
      last_seen_at: "2026-07-12T00:00:00.000Z",
      next_due_at: "2026-07-26T00:00:00.000Z",
    });
    await legacy.table("attempts").add({
      association_id: "required:1",
      exercise_family: "multiple_choice",
      correct: true,
      used_reveal: false,
      latency_ms: 1000,
      confidence: 3,
      created_at: "2026-07-12T00:00:00.000Z",
    });
    await legacy.table("studyAids").put({
      record_id: "record:1",
      mnemonic: "Memory aid",
      confusion_note: "",
      updated_at: "2026-07-12T00:00:00.000Z",
    });
    await legacy.table("sessionResults").add({
      session_id: "section:old",
      scope: "section",
      section_code: "A",
      question_count: 10,
      correct_count: 8,
      percentage: 80,
      incorrect_association_ids: ["required:2"],
      completed_at: "2026-07-12T00:00:00.000Z",
    });
    legacy.close();

    const migrated = createDatabase(name);
    await migrated.open();
    expect(await migrated.mastery.get("required:1")).toMatchObject({
      state: "mastered",
      correct_retrievals: 3,
    });
    expect(await migrated.attempts.count()).toBe(1);
    expect(await migrated.studyAids.get("record:1")).toMatchObject({
      mnemonic: "Memory aid",
    });
    expect(await migrated.sessionResults.count()).toBe(1);
    expect(migrated.tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        "assessmentSessions",
        "assessmentResults",
        "mockQuestionHistory",
        "learningSessions",
      ]),
    );
    migrated.close();
  });

  it("round-trips an active learning quiz without changing its order or position", async () => {
    const name = `learning-roundtrip-${crypto.randomUUID()}`;
    names.push(name);
    const database = createDatabase(name);
    const session: LearningSession = {
      id: "active:learning", schema_version: "1.0.0", status: "active", content_version: "content:one", generator_version: "section-questions.v2.0.0", session_id: "seed", source_mode: "section_set", selection_label: "East: district + main roads", section_code: null, section_codes: ["A", "E"], return_view: "sections", association_ids: ["a", "b"], position: 1, round: 1, phase: "first_pass", selected_option_ids: ["option:2"], checked: false, clue: false, hint_level: 0, first_pass_correct: 1, mistake_ids: ["a"], answer_review: [], created_at: "2026-07-13T12:00:00.000Z", updated_at: "2026-07-13T12:01:00.000Z",
    };
    await database.learningSessions.put(session);
    database.close();
    const reopened = createDatabase(name);
    expect(await reopened.learningSessions.get("active:learning")).toEqual(session);
    reopened.close();
  });

  it("round-trips the complete active assessment recovery payload", async () => {
    const name = `roundtrip-${crypto.randomUUID()}`;
    names.push(name);
    const database = createDatabase(name);
    const session: AssessmentSession = {
      id: "active:final",
      schema_version: "1.0.0",
      mode: "final",
      status: "active",
      selection_strategy: "exhaustive",
      content_version: "content:one",
      generator_version: "section-questions.v2.0.0",
      seed: "seed-one",
      association_ids: ["a", "b"],
      answers: {
        a: {
          association_id: "a",
          selected_option_ids: ["a:option:2"],
          selected_labels: ["Second"],
          correct_labels: ["Second"],
          correct: true,
          latency_ms: 900,
          answered_at: "2026-07-13T12:00:00.000Z",
        },
      },
      position: 1,
      created_at: "2026-07-13T11:59:00.000Z",
      updated_at: "2026-07-13T12:00:00.000Z",
    };
    await database.assessmentSessions.put(session);
    database.close();

    const reopened = createDatabase(name);
    expect(await reopened.assessmentSessions.get("active:final")).toEqual(session);
    reopened.close();
  });
});
