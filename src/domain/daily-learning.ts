import { seededRandom } from "./session";
import { compareSectionCodes } from "./sections";
import type { Association, Attempt, Mastery } from "./types";

const DAY_MS = 86_400_000;

export const DEFAULT_DAILY_LEARNING_LIMIT = 15;
export const DEFAULT_DAILY_NEW_LIMIT = 5;
export const DEFAULT_DAILY_REVIEW_LIMIT = 10;
export const DEFAULT_WEAK_ATTEMPT_WINDOW_DAYS = 14;
export const DEFAULT_READINESS_WINDOW_DAYS = 30;

export type DailyLearningReason = "due" | "weak" | "new";
export type DailyLearningBlock =
  | "recovery"
  | "recognition"
  | "new"
  | "promotion"
  | "maintenance";

export type DailyLearningItem = {
  association: Association;
  reason: DailyLearningReason;
  block: DailyLearningBlock;
  dueAt: string | null;
  lastAttemptAt: string | null;
};

export type DailyLearningCounts = {
  due: number;
  weak: number;
  new: number;
  total: number;
};

export type DailyLearningBlockCounts = Record<DailyLearningBlock, number> & {
  total: number;
};

export type ExamReadinessLevel =
  | "getting_started"
  | "building"
  | "progressing"
  | "nearly_ready"
  | "ready";

export type ExamReadinessSummary = {
  score: number;
  level: ExamReadinessLevel;
  mastery: {
    mastered: number;
    current: number;
    overdue: number;
    required: number;
    percentage: number;
    currentPercentage: number;
  };
  recentUnassistedFirstPass: {
    correct: number;
    attempted: number;
    uniqueAssociations: number;
    accuracyPercentage: number | null;
    since: string;
  };
};

export type DailyLearningPlan = {
  generatedAt: string;
  seed: string;
  direction: Association["direction"] | "mixed";
  focusSectionCode: string | null;
  queue: Association[];
  items: DailyLearningItem[];
  counts: DailyLearningCounts;
  blockCounts: DailyLearningBlockCounts;
  readiness: ExamReadinessSummary;
};

export type DailyLearningInput = {
  associations: Association[];
  mastery: ReadonlyMap<string, Mastery>;
  attempts: Attempt[];
  now?: string | Date;
  seed?: string;
  limit?: number;
  newLimit?: number;
  reviewLimit?: number;
  dayStart?: string | Date;
  weakAttemptWindowDays?: number;
  readinessWindowDays?: number;
};

const requiredBank = (associations: Association[]) =>
  associations.filter(
    (association) =>
      association.required && association.scope === "record_set",
  );

const timestamp = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normaliseNow = (value: string | Date | undefined) => {
  const date = value instanceof Date ? new Date(value) : new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime()))
    throw new Error("Daily learning requires a valid current date");
  return date;
};

const positiveInteger = (value: number | undefined, fallback: number) =>
  value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(0, Math.floor(value));

const isFirstPass = (attempt: Attempt) => attempt.phase !== "correction";

const attemptTieKey = (attempt: Attempt) =>
  [
    attempt.created_at,
    String(attempt.id ?? ""),
    attempt.session_id ?? "",
    attempt.question_instance_id ?? "",
    attempt.correct ? "1" : "0",
  ].join("|");

function latestAttempts(
  attempts: Attempt[],
  requiredIds: Set<string>,
  nowTime: number,
  sinceTime: number,
  unassistedOnly: boolean,
) {
  const latest = new Map<string, Attempt>();
  for (const attempt of attempts) {
    if (
      !requiredIds.has(attempt.association_id) ||
      !isFirstPass(attempt) ||
      (unassistedOnly && attempt.used_reveal)
    )
      continue;
    const attemptTime = timestamp(attempt.created_at);
    if (
      attemptTime === null ||
      attemptTime < sinceTime ||
      attemptTime > nowTime
    )
      continue;
    const previous = latest.get(attempt.association_id);
    const previousTime = timestamp(previous?.created_at) ?? Number.NEGATIVE_INFINITY;
    if (
      attemptTime > previousTime ||
      (attemptTime === previousTime &&
        attemptTieKey(attempt) > attemptTieKey(previous!))
    )
      latest.set(attempt.association_id, attempt);
  }
  return latest;
}

function readinessLevel(
  score: number,
  masteryPercentage: number,
  recentAccuracy: number | null,
): ExamReadinessLevel {
  if (
    score >= 85 &&
    masteryPercentage >= 75 &&
    (recentAccuracy === null || recentAccuracy >= 75)
  )
    return "ready";
  if (score >= 70) return "nearly_ready";
  if (score >= 40) return "progressing";
  if (score > 0 || recentAccuracy !== null) return "building";
  return "getting_started";
}

const roundOne = (value: number) => Math.round(value * 10) / 10;

export function calculateExamReadiness(input: {
  associations: Association[];
  mastery: ReadonlyMap<string, Mastery>;
  attempts: Attempt[];
  now?: string | Date;
  windowDays?: number;
}): ExamReadinessSummary {
  const now = normaliseNow(input.now);
  const nowTime = now.getTime();
  const windowDays = positiveInteger(
    input.windowDays,
    DEFAULT_READINESS_WINDOW_DAYS,
  );
  const since = new Date(nowTime - windowDays * DAY_MS);
  const bank = requiredBank(input.associations);
  const requiredIds = new Set(bank.map((association) => association.id));
  const mastered = bank.filter(
    (association) => input.mastery.get(association.id)?.state === "mastered",
  ).length;
  const current = bank.filter((association) => {
    const state = input.mastery.get(association.id);
    const dueTime = timestamp(state?.next_due_at);
    return (
      state?.state === "mastered" &&
      dueTime !== null &&
      dueTime > nowTime
    );
  }).length;
  const overdue = mastered - current;
  const masteryPercentage = bank.length ? (mastered / bank.length) * 100 : 0;
  const currentMasteryPercentage = bank.length
    ? (current / bank.length) * 100
    : 0;
  const recent = latestAttempts(
    input.attempts,
    requiredIds,
    nowTime,
    since.getTime(),
    true,
  );
  const attempted = recent.size;
  const correct = [...recent.values()].filter(
    (attempt) => attempt.correct && attempt.confidence > 1,
  ).length;
  const recentAccuracy = attempted ? (correct / attempted) * 100 : null;

  // Recent performance can refine, but cannot dominate, the repeated evidence
  // represented by mastery. Its weight grows to at most 25% over 100 distinct
  // recent exam-bank associations.
  const evidenceTarget = Math.min(100, bank.length);
  const evidenceCoverage = evidenceTarget
    ? Math.min(1, attempted / evidenceTarget)
    : 0;
  const recentWeight = 0.25 * evidenceCoverage;
  const score = bank.length
    ? roundOne(
        currentMasteryPercentage * (1 - recentWeight) +
          (recentAccuracy ?? currentMasteryPercentage) * recentWeight,
      )
    : 0;

  return {
    score,
    level: readinessLevel(score, currentMasteryPercentage, recentAccuracy),
    mastery: {
      mastered,
      current,
      overdue,
      required: bank.length,
      percentage: roundOne(masteryPercentage),
      currentPercentage: roundOne(currentMasteryPercentage),
    },
    recentUnassistedFirstPass: {
      correct,
      attempted,
      uniqueAssociations: attempted,
      accuracyPercentage:
        recentAccuracy === null ? null : roundOne(recentAccuracy),
      since: since.toISOString(),
    },
  };
}

function countReasons(items: DailyLearningItem[]): DailyLearningCounts {
  const counts: DailyLearningCounts = { due: 0, weak: 0, new: 0, total: 0 };
  for (const item of items) {
    counts[item.reason] += 1;
    counts.total += 1;
  }
  return counts;
}

function countBlocks(items: DailyLearningItem[]): DailyLearningBlockCounts {
  const counts: DailyLearningBlockCounts = {
    recovery: 0,
    recognition: 0,
    new: 0,
    promotion: 0,
    maintenance: 0,
    total: 0,
  };
  for (const item of items) {
    counts[item.block] += 1;
    counts.total += 1;
  }
  return counts;
}

const independentSuccess = (attempt: Attempt) =>
  attempt.correct && !attempt.used_reveal && attempt.confidence > 1;

const attemptSession = (attempt: Attempt) =>
  attempt.session_id || `legacy:${attempt.created_at.slice(0, 10)}`;

function successfulStudySessions(attempts: Attempt[], afterTime = -Infinity) {
  const bySession = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    const time = timestamp(attempt.created_at);
    if (
      time === null ||
      time <= afterTime ||
      attempt.phase === "correction"
    )
      continue;
    const session = attemptSession(attempt);
    bySession.set(session, [...(bySession.get(session) ?? []), attempt]);
  }
  return [...bySession.entries()]
    .filter(([, sessionAttempts]) => sessionAttempts.every(independentSuccess))
    .map(([session]) => session)
    .sort();
}

type CurriculumRecord = {
  recordId: string;
  sectionCode: string;
  recognition: Association;
  recall?: Association;
  block: DailyLearningBlock;
  dueAt: string | null;
  lastAttemptAt: string | null;
  due: boolean;
  promotionReady: boolean;
};

function buildCurriculumRecords(input: {
  bank: Association[];
  mastery: ReadonlyMap<string, Mastery>;
  attempts: Attempt[];
  nowTime: number;
}) {
  const attemptsByAssociation = new Map<string, Attempt[]>();
  for (const attempt of input.attempts) {
    const attemptTime = timestamp(attempt.created_at);
    if (
      attempt.phase === "correction" ||
      attemptTime === null ||
      attemptTime > input.nowTime
    )
      continue;
    attemptsByAssociation.set(attempt.association_id, [
      ...(attemptsByAssociation.get(attempt.association_id) ?? []),
      attempt,
    ]);
  }
  for (const attempts of attemptsByAssociation.values())
    attempts.sort((left, right) => left.created_at.localeCompare(right.created_at));

  const byRecord = new Map<
    string,
    { recognition?: Association; recall?: Association }
  >();
  for (const association of input.bank) {
    const pair = byRecord.get(association.record_id) ?? {};
    if (association.direction === "reverse") pair.recognition = association;
    else pair.recall = association;
    byRecord.set(association.record_id, pair);
  }

  const records: CurriculumRecord[] = [];
  for (const [recordId, pair] of byRecord) {
    if (!pair.recognition) continue;
    const recognitionAttempts =
      attemptsByAssociation.get(pair.recognition.id) ?? [];
    const recallAttempts = pair.recall
      ? attemptsByAssociation.get(pair.recall.id) ?? []
      : [];
    const allAttempts = [...recognitionAttempts, ...recallAttempts].sort(
      (left, right) => left.created_at.localeCompare(right.created_at),
    );
    const latestFailure = [...allAttempts]
      .reverse()
      .find((attempt) => !attempt.correct);
    const latestFailureTime = latestFailure
      ? timestamp(latestFailure.created_at) ?? -Infinity
      : -Infinity;
    const recoverySessions = successfulStudySessions(
      recognitionAttempts,
      latestFailureTime,
    );
    const inRecovery =
      latestFailure !== undefined && recoverySessions.length < 2;
    const latestRecognitionFailure = [...recognitionAttempts]
      .reverse()
      .find((attempt) => !attempt.correct);
    const recognitionSuccessSessions = successfulStudySessions(
      recognitionAttempts,
      latestRecognitionFailure
        ? timestamp(latestRecognitionFailure.created_at) ?? -Infinity
        : -Infinity,
    );
    const recognitionSolid = recognitionSuccessSessions.length >= 3;
    const latestRecallFailure = [...recallAttempts]
      .reverse()
      .find((attempt) => !attempt.correct);
    const recallSuccessSessions = successfulStudySessions(
      recallAttempts,
      latestRecallFailure
        ? timestamp(latestRecallFailure.created_at) ?? -Infinity
        : -Infinity,
    );
    const recallSolid = recallSuccessSessions.length >= 3;
    const targetAssociation =
      inRecovery || !recognitionSolid || !pair.recall
        ? pair.recognition
        : pair.recall;
    const state = input.mastery.get(targetAssociation.id);
    const dueTime = timestamp(state?.next_due_at);
    const due = dueTime === null || dueTime <= input.nowTime;
    const lastAttemptAt =
      (targetAssociation.direction === "reverse"
        ? recognitionAttempts
        : recallAttempts
      ).at(-1)?.created_at ?? null;
    const block: DailyLearningBlock = !recognitionAttempts.length
      ? "new"
      : inRecovery
        ? "recovery"
        : !recognitionSolid
          ? "recognition"
          : recallSolid
            ? "maintenance"
            : "promotion";

    records.push({
      recordId,
      sectionCode: pair.recognition.section_code,
      recognition: pair.recognition,
      recall: pair.recall,
      block,
      dueAt: dueTime === null ? null : state!.next_due_at,
      lastAttemptAt,
      due,
      promotionReady: block === "promotion",
    });
  }
  return records;
}

export function buildDailyLearningPlan(
  input: DailyLearningInput,
): DailyLearningPlan {
  const now = normaliseNow(input.now);
  const generatedAt = now.toISOString();
  const nowTime = now.getTime();
  const newLimit = positiveInteger(input.newLimit, DEFAULT_DAILY_NEW_LIMIT);
  const reviewLimit = positiveInteger(
    input.reviewLimit,
    DEFAULT_DAILY_REVIEW_LIMIT,
  );
  const seed = input.seed ?? generatedAt.slice(0, 10);
  const bank = requiredBank(input.associations);
  const curriculum = buildCurriculumRecords({
    bank,
    mastery: input.mastery,
    attempts: input.attempts,
    nowTime,
  });
  const available = curriculum.filter((record) => {
    const target =
      record.block === "promotion" || record.block === "maintenance"
        ? record.recall
        : record.recognition;
    return !!target;
  });
  const stableOrder = (left: CurriculumRecord, right: CurriculumRecord) => {
    const leftTie = seededRandom(`${seed}:${left.recordId}`)();
    const rightTie = seededRandom(`${seed}:${right.recordId}`)();
    return leftTie - rightTie || left.recordId.localeCompare(right.recordId);
  };
  const activeSectionCode = curriculum
    .filter((record) => record.block === "new")
    .map((record) => record.sectionCode)
    .sort((left, right) => compareSectionCodes({ code: left }, { code: right }))[0] ?? null;
  const recovery = available
    .filter((record) => record.block === "recovery")
    .sort((left, right) =>
      (right.lastAttemptAt ?? "").localeCompare(left.lastAttemptAt ?? "") ||
      stableOrder(left, right),
    );
  const maintenanceLimit = Math.min(
    reviewLimit,
    Math.max(3, Math.ceil(reviewLimit * 0.35)),
  );
  const maintenance = available
    .filter((record) => record.block === "maintenance" && record.due)
    .sort((left, right) =>
      (left.dueAt ?? "").localeCompare(right.dueAt ?? "") ||
      stableOrder(left, right),
    )
    .slice(0, maintenanceLimit);
  const recognition = available
    .filter((record) => record.block === "recognition" && record.due)
    .sort(stableOrder)
    .slice(0, Math.max(0, reviewLimit - maintenance.length));
  const fresh = available
    .filter(
      (record) =>
        record.block === "new" &&
        record.sectionCode === activeSectionCode,
    )
    .sort(stableOrder)
    .slice(0, newLimit);
  const promotionLimit = Math.max(
    2,
    Math.min(5, Math.ceil(Math.max(1, newLimit) / 3)),
  );
  const promotion = available
    .filter(
      (record) =>
        record.block === "promotion" &&
        record.promotionReady &&
        record.due &&
        !!record.recall,
    )
    .sort(stableOrder)
    .slice(0, promotionLimit);
  const selected = [
    ...recovery,
    ...maintenance,
    ...recognition,
    ...fresh,
    ...promotion,
  ];
  const items: DailyLearningItem[] = selected.map((record) => {
    const association =
      record.block === "promotion" || record.block === "maintenance"
        ? record.recall!
        : record.recognition;
    return {
      association,
      block: record.block,
      reason:
        record.block === "new"
          ? "new"
          : record.block === "recovery" || record.block === "recognition"
            ? "weak"
            : "due",
      dueAt: record.dueAt,
      lastAttemptAt: record.lastAttemptAt,
    };
  });
  const selectedDirections = new Set(
    items.map((item) => item.association.direction),
  );
  const direction =
    selectedDirections.size > 1
      ? "mixed"
      : selectedDirections.values().next().value ?? "reverse";

  return {
    generatedAt,
    seed,
    direction,
    focusSectionCode: activeSectionCode,
    queue: items.map((item) => item.association),
    items,
    counts: countReasons(items),
    blockCounts: countBlocks(items),
    readiness: calculateExamReadiness({
      associations: bank,
      mastery: input.mastery,
      attempts: input.attempts,
      now,
      windowDays: input.readinessWindowDays,
    }),
  };
}

export function calculateDailyNewTarget(input: {
  associations: Association[];
  mastery: ReadonlyMap<string, Mastery>;
  targetDate: string | Date;
  studyDaysPerWeek: number;
  now?: string | Date;
}) {
  const now = normaliseNow(input.now);
  const targetDate = normaliseNow(input.targetDate);
  const remainingCalendarDays = Math.max(
    1,
    Math.ceil((targetDate.getTime() - now.getTime()) / DAY_MS),
  );
  const studyDaysPerWeek = Math.min(
    7,
    Math.max(1, positiveInteger(input.studyDaysPerWeek, 6)),
  );
  const remainingStudyDays = Math.max(
    1,
    Math.ceil((remainingCalendarDays * studyDaysPerWeek) / 7),
  );
  const remainingNew = requiredBank(input.associations).filter(
    (association) => {
      if (association.direction !== "reverse") return false;
      const state = input.mastery.get(association.id);
      return !state || state.state === "unseen";
    },
  ).length;

  return {
    remainingNew,
    remainingStudyDays,
    dailyNewTarget: remainingNew
      ? Math.max(1, Math.ceil(remainingNew / remainingStudyDays))
      : 0,
  };
}
