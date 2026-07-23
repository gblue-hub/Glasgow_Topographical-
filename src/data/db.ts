import Dexie, { type EntityTable } from "dexie";
import type {
  AssessmentResult,
  AssessmentSession,
  Attempt,
  Mastery,
  MockQuestionHistory,
  LearningSession,
  SessionResult,
  StudyAid,
} from "../domain/types";

export type AppDatabase = Dexie & {
  attempts: EntityTable<Attempt, "id">;
  mastery: EntityTable<Mastery, "association_id">;
  studyAids: EntityTable<StudyAid, "record_id">;
  sessionResults: EntityTable<SessionResult, "id">;
  assessmentSessions: EntityTable<AssessmentSession, "id">;
  assessmentResults: EntityTable<AssessmentResult, "id">;
  mockQuestionHistory: EntityTable<MockQuestionHistory, "association_id">;
  learningSessions: EntityTable<LearningSession, "id">;
};

const v1 = {
  attempts: "++id,association_id,created_at",
  mastery: "association_id,state,next_due_at",
};
const v2 = { ...v1, studyAids: "record_id,updated_at" };
const v3 = {
  ...v2,
  sessionResults: "++id,session_id,section_code,completed_at",
};
export const databaseSchemaV4 = {
  ...v3,
  assessmentSessions: "id,mode,status,updated_at",
  assessmentResults: "++id,session_id,mode,submitted_at",
  mockQuestionHistory: "association_id,last_served_at",
};
export const databaseSchemaV5 = {
  ...databaseSchemaV4,
  learningSessions: "id,status,updated_at",
};

export function createDatabase(name = "glasgow-knowledge-v1") {
  const database = new Dexie(name) as AppDatabase;
  database.version(1).stores(v1);
  database.version(2).stores(v2);
  database.version(3).stores(v3);
  database.version(4).stores(databaseSchemaV4);
  database.version(5).stores(databaseSchemaV5);
  return database;
}

export const db = createDatabase();
