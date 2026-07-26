import type {
  AssessmentResult,
  AssessmentSession,
  Attempt,
  LearningSession,
  Mastery,
  MockQuestionHistory,
  SessionResult,
  StudyAid,
} from "../domain/types";
import { getSupabaseClient } from "./supabase";

export type ProgressStoreName =
  | "attempts"
  | "mastery"
  | "studyAids"
  | "sessionResults"
  | "assessmentSessions"
  | "assessmentResults"
  | "mockQuestionHistory"
  | "learningSessions";

type StoreRows = {
  attempts: Attempt;
  mastery: Mastery;
  studyAids: StudyAid;
  sessionResults: SessionResult;
  assessmentSessions: AssessmentSession;
  assessmentResults: AssessmentResult;
  mockQuestionHistory: MockQuestionHistory;
  learningSessions: LearningSession;
};

type PersistedProgressRow = {
  store_name: ProgressStoreName;
  item_key: string;
  payload: unknown;
  client_updated_at: string;
};

export type SaveState = {
  status: "loading" | "saved" | "saving" | "error";
  message: string;
  savedAt: string | null;
};

let saveState: SaveState = {
  status: "loading",
  message: "Loading your progress…",
  savedAt: null,
};
const saveListeners = new Set<(state: SaveState) => void>();

function publishSaveState(next: SaveState) {
  saveState = next;
  for (const listener of saveListeners) listener(next);
}

export function subscribeToSaveState(
  listener: (state: SaveState) => void,
) {
  saveListeners.add(listener);
  listener(saveState);
  return () => {
    saveListeners.delete(listener);
  };
}

export function progressItemKey(
  store: ProgressStoreName,
  row: any,
): string {
  switch (store) {
    case "attempts":
      return [
        row.session_id ?? "standalone",
        row.question_instance_id ?? row.created_at,
        row.association_id,
        row.phase ?? "first_pass",
        row.exercise_family,
      ].join(":");
    case "mastery":
    case "mockQuestionHistory":
      return row.association_id;
    case "studyAids":
      return row.record_id;
    case "sessionResults":
    case "assessmentResults":
      return row.session_id;
    case "assessmentSessions":
    case "learningSessions":
      return row.id;
  }
}

export function progressItemTimestamp(
  store: ProgressStoreName,
  row: any,
): string {
  switch (store) {
    case "attempts":
      return row.created_at;
    case "mastery":
      return row.last_seen_at;
    case "studyAids":
    case "assessmentSessions":
    case "learningSessions":
      return row.updated_at;
    case "sessionResults":
      return row.completed_at;
    case "assessmentResults":
      return row.submitted_at;
    case "mockQuestionHistory":
      return row.last_served_at;
  }
}

class CloudQuery<T extends Record<string, any>> {
  private reversed = false;
  private maximum: number | null = null;
  private readonly values: () => T[];
  private readonly field: keyof T;

  constructor(values: () => T[], field: keyof T) {
    this.values = values;
    this.field = field;
  }

  equals(value: unknown) {
    const filtered = () =>
      this.values().filter((row) => row[this.field] === value);
    return {
      last: async () => filtered().at(-1),
      toArray: async () => filtered(),
    };
  }

  reverse() {
    this.reversed = true;
    return this;
  }

  limit(value: number) {
    this.maximum = Math.max(0, value);
    return this;
  }

  async toArray() {
    const ordered = [...this.values()].sort((left, right) =>
      String(left[this.field] ?? "").localeCompare(
        String(right[this.field] ?? ""),
      ),
    );
    if (this.reversed) ordered.reverse();
    return this.maximum === null ? ordered : ordered.slice(0, this.maximum);
  }
}

class CloudTable<K extends ProgressStoreName> {
  readonly rows = new Map<string, StoreRows[K]>();
  readonly storeName: K;

  constructor(storeName: K) {
    this.storeName = storeName;
  }

  async toArray() {
    return [...this.rows.values()];
  }

  async count() {
    return this.rows.size;
  }

  async get(key: string) {
    return this.rows.get(key);
  }

  async put(row: StoreRows[K]) {
    await persistRows(this.storeName, [row]);
    this.rows.set(progressItemKey(this.storeName, row), row);
    return progressItemKey(this.storeName, row);
  }

  async add(row: StoreRows[K]) {
    return this.put(row);
  }

  async bulkPut(rows: StoreRows[K][]) {
    if (!rows.length) return;
    await persistRows(this.storeName, rows);
    for (const row of rows)
      this.rows.set(progressItemKey(this.storeName, row), row);
  }

  async bulkAdd(rows: StoreRows[K][]) {
    return this.bulkPut(rows);
  }

  async delete(key: string) {
    const client = getSupabaseClient();
    publishSaveState({
      status: "saving",
      message: "Saving…",
      savedAt: saveState.savedAt,
    });
    const { error } = await client
      .from("learner_progress")
      .delete()
      .eq("store_name", this.storeName)
      .eq("item_key", key);
    if (error) {
      publishSaveState({
        status: "error",
        message: "Progress could not be saved",
        savedAt: saveState.savedAt,
      });
      throw error;
    }
    this.rows.delete(key);
    publishSaved();
  }

  where<F extends keyof StoreRows[K]>(field: F) {
    return new CloudQuery<StoreRows[K]>(
      () => [...this.rows.values()],
      field,
    );
  }

  orderBy<F extends keyof StoreRows[K]>(field: F) {
    return new CloudQuery<StoreRows[K]>(
      () => [...this.rows.values()],
      field,
    );
  }
}

function publishSaved() {
  const now = new Date().toISOString();
  publishSaveState({
    status: "saved",
    message: "Saved",
    savedAt: now,
  });
}

async function persistRows<K extends ProgressStoreName>(
  storeName: K,
  rows: StoreRows[K][],
) {
  const client = getSupabaseClient();
  publishSaveState({
    status: "saving",
    message: "Saving…",
    savedAt: saveState.savedAt,
  });
  const payload = rows.map((row) => ({
    store_name: storeName,
    item_key: progressItemKey(storeName, row),
    payload: row,
    client_updated_at: progressItemTimestamp(storeName, row),
  }));
  const { error } = await client
    .from("learner_progress")
    .upsert(payload, { onConflict: "user_id,store_name,item_key" });
  if (error) {
    publishSaveState({
      status: "error",
      message: "Progress could not be saved",
      savedAt: saveState.savedAt,
    });
    throw error;
  }
  publishSaved();
}

class CloudDatabase {
  attempts = new CloudTable("attempts");
  mastery = new CloudTable("mastery");
  studyAids = new CloudTable("studyAids");
  sessionResults = new CloudTable("sessionResults");
  assessmentSessions = new CloudTable("assessmentSessions");
  assessmentResults = new CloudTable("assessmentResults");
  mockQuestionHistory = new CloudTable("mockQuestionHistory");
  learningSessions = new CloudTable("learningSessions");

  private tableByName(storeName: ProgressStoreName): CloudTable<any> {
    return this[storeName] as CloudTable<any>;
  }

  async hydrate() {
    publishSaveState({
      status: "loading",
      message: "Loading your progress…",
      savedAt: null,
    });
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("learner_progress")
      .select("store_name,item_key,payload,client_updated_at");
    if (error) {
      publishSaveState({
        status: "error",
        message: "Progress could not be loaded",
        savedAt: null,
      });
      throw error;
    }
    for (const table of [
      this.attempts,
      this.mastery,
      this.studyAids,
      this.sessionResults,
      this.assessmentSessions,
      this.assessmentResults,
      this.mockQuestionHistory,
      this.learningSessions,
    ])
      table.rows.clear();
    for (const item of (data ?? []) as PersistedProgressRow[])
      this.tableByName(item.store_name).rows.set(
        item.item_key,
        item.payload,
      );
    publishSaved();
  }

  async transaction(
    _mode: "rw",
    ...tablesAndCallback: Array<CloudTable<any> | (() => Promise<void>)>
  ) {
    const callback = tablesAndCallback.at(-1);
    if (typeof callback !== "function")
      throw new Error("A cloud persistence transaction needs a callback.");
    await callback();
  }
}

export const db = new CloudDatabase();

export async function initialiseProgressStore() {
  await db.hydrate();
}
