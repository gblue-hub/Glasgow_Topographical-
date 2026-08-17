import type {
  AssessmentResult,
  AssessmentSession,
  Attempt,
  LearningSession,
  LearningPreferences,
  Mastery,
  MockQuestionHistory,
  SessionResult,
  StudyAid,
  RouteAttempt,
  RouteSession,
  TerritoryProgress,
  AppSettings,
  PersonalPlace,
} from "../domain/types";
import { getSupabaseClient } from "./supabase";

const localDevelopment = import.meta.env.DEV;

export type ProgressStoreName =
  | "attempts"
  | "mastery"
  | "studyAids"
  | "sessionResults"
  | "assessmentSessions"
  | "assessmentResults"
  | "mockQuestionHistory"
  | "learningSessions"
  | "learningPreferences"
  | "routeAttempts"
  | "routeSessions"
  | "territoryProgress"
  | "appSettings"
  | "personalPlaces";

type StoreRows = {
  attempts: Attempt;
  mastery: Mastery;
  studyAids: StudyAid;
  sessionResults: SessionResult;
  assessmentSessions: AssessmentSession;
  assessmentResults: AssessmentResult;
  mockQuestionHistory: MockQuestionHistory;
  learningSessions: LearningSession;
  learningPreferences: LearningPreferences;
  routeAttempts: RouteAttempt;
  routeSessions: RouteSession;
  territoryProgress: TerritoryProgress;
  appSettings: AppSettings;
  personalPlaces: PersonalPlace;
};

type PersistedProgressRow = {
  store_name: ProgressStoreName;
  item_key: string;
  payload: unknown;
  client_updated_at: string;
};

const CLOUD_PAGE_SIZE = 1_000;
let pendingTransactionRows: PersistedProgressRow[] | null = null;

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
    case "learningPreferences":
      return row.id;
    case "routeAttempts":
      return row.id;
    case "routeSessions":
      return row.id;
    case "territoryProgress":
      return row.territory_id;
    case "appSettings":
      return row.id;
    case "personalPlaces":
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
    case "learningPreferences":
      return row.updated_at;
    case "sessionResults":
      return row.completed_at;
    case "assessmentResults":
      return row.submitted_at;
    case "mockQuestionHistory":
      return row.last_served_at;
    case "routeAttempts":
      return row.created_at;
    case "routeSessions":
    case "territoryProgress":
    case "appSettings":
    case "personalPlaces":
      return row.updated_at;
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
    if (localDevelopment) {
      this.rows.delete(key);
      publishSaved();
      return;
    }
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
  const payload = rows.map((row) => ({
    store_name: storeName,
    item_key: progressItemKey(storeName, row),
    payload: row,
    client_updated_at: progressItemTimestamp(storeName, row),
  }));
  if (pendingTransactionRows) {
    pendingTransactionRows.push(...payload);
    return;
  }
  await persistPayload(payload);
}

async function persistPayload(payload: PersistedProgressRow[]) {
  if (!payload.length) return;
  publishSaveState({
    status: "saving",
    message: "Saving…",
    savedAt: saveState.savedAt,
  });
  if (localDevelopment) {
    publishSaved();
    return;
  }
  const client = getSupabaseClient();
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
  learningPreferences = new CloudTable("learningPreferences");
  routeAttempts = new CloudTable("routeAttempts");
  routeSessions = new CloudTable("routeSessions");
  territoryProgress = new CloudTable("territoryProgress");
  appSettings = new CloudTable("appSettings");
  personalPlaces = new CloudTable("personalPlaces");

  private tableByName(storeName: ProgressStoreName): CloudTable<any> {
    return this[storeName] as CloudTable<any>;
  }

  async hydrate(background = false) {
    if (!background)
      publishSaveState({
        status: "loading",
        message: "Loading your progress…",
        savedAt: null,
      });
    if (localDevelopment) {
      if (!background) publishSaved();
      return;
    }
    const client = getSupabaseClient();
    const first = await client
      .from("learner_progress")
      .select("store_name,item_key,payload,client_updated_at", { count: "exact" })
      .order("store_name")
      .order("item_key")
      .range(0, CLOUD_PAGE_SIZE - 1);
    if (first.error) {
      if (!background)
        publishSaveState({
          status: "error",
          message: "Progress could not be loaded",
          savedAt: null,
        });
      throw first.error;
    }
    const total = first.count ?? first.data?.length ?? 0;
    const remainingPages = Array.from(
      { length: Math.max(0, Math.ceil(total / CLOUD_PAGE_SIZE) - 1) },
      (_, index) => index + 1,
    );
    const remaining = await Promise.all(
      remainingPages.map((page) =>
        client
          .from("learner_progress")
          .select("store_name,item_key,payload,client_updated_at")
          .order("store_name")
          .order("item_key")
          .range(page * CLOUD_PAGE_SIZE, (page + 1) * CLOUD_PAGE_SIZE - 1),
      ),
    );
    const failedPage = remaining.find((page) => page.error);
    if (failedPage?.error) {
      if (!background)
        publishSaveState({
          status: "error",
          message: "Progress could not be loaded",
          savedAt: null,
        });
      throw failedPage.error;
    }
    const data = [
      ...(first.data ?? []),
      ...remaining.flatMap((page) => page.data ?? []),
    ] as PersistedProgressRow[];
    for (const table of [
      this.attempts,
      this.mastery,
      this.studyAids,
      this.sessionResults,
      this.assessmentSessions,
      this.assessmentResults,
      this.mockQuestionHistory,
      this.learningSessions,
      this.learningPreferences,
      this.routeAttempts,
      this.routeSessions,
      this.territoryProgress,
      this.appSettings,
      this.personalPlaces,
    ])
      table.rows.clear();
    for (const item of data)
      this.tableByName(item.store_name).rows.set(
        item.item_key,
        item.payload,
      );
    if (!background) publishSaved();
  }

  async transaction(
    _mode: "rw",
    ...tablesAndCallback: Array<CloudTable<any> | (() => Promise<void>)>
  ) {
    const callback = tablesAndCallback.at(-1);
    if (typeof callback !== "function")
      throw new Error("A cloud persistence transaction needs a callback.");
    if (pendingTransactionRows)
      throw new Error("Nested cloud persistence transactions are not supported.");
    pendingTransactionRows = [];
    try {
      await callback();
      const rows = pendingTransactionRows;
      pendingTransactionRows = null;
      await persistPayload(rows);
    } catch (cause) {
      pendingTransactionRows = null;
      throw cause;
    }
  }

  async resetLearningProgress() {
    const progressStores: ProgressStoreName[] = [
      "attempts",
      "mastery",
      "studyAids",
      "sessionResults",
      "assessmentSessions",
      "assessmentResults",
      "mockQuestionHistory",
      "learningSessions",
      "routeAttempts",
      "routeSessions",
      "territoryProgress",
    ];
    publishSaveState({
      status: "saving",
      message: "Resetting progress…",
      savedAt: saveState.savedAt,
    });
    if (localDevelopment) {
      for (const storeName of progressStores)
        this.tableByName(storeName).rows.clear();
      publishSaved();
      return;
    }
    const client = getSupabaseClient();
    const { error } = await client
      .from("learner_progress")
      .delete()
      .in("store_name", progressStores);
    if (error) {
      publishSaveState({
        status: "error",
        message: "Progress could not be reset",
        savedAt: saveState.savedAt,
      });
      throw error;
    }
    for (const storeName of progressStores)
      this.tableByName(storeName).rows.clear();
    publishSaved();
  }
}

export const db = new CloudDatabase();

let refreshInFlight: Promise<void> | null = null;

export async function initialiseProgressStore() {
  await db.hydrate();
}

/**
 * Pull progress written by another browser/device into the in-memory store.
 * Focus and visibility events can arrive together, so share one request rather
 * than clearing and repopulating the tables twice.
 */
export async function refreshProgressStore() {
  if (localDevelopment) return;
  refreshInFlight ??= db.hydrate(true).finally(() => {
    refreshInFlight = null;
  });
  await refreshInFlight;
}
