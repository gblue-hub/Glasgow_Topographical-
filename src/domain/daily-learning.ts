import { seededRandom } from "./session";
import type { Association, Attempt, Mastery } from "./types";

const DAY_MS = 86_400_000;

export const DEFAULT_DAILY_LEARNING_LIMIT = 15;
export const DEFAULT_WEAK_ATTEMPT_WINDOW_DAYS = 14;
export const DEFAULT_READINESS_WINDOW_DAYS = 30;

export type DailyLearningReason = "due" | "weak" | "new";

export type DailyLearningItem = {
  association: Association;
  reason: DailyLearningReason;
  dueAt: string | null;
  lastAttemptAt: string | null;
};

export type DailyLearningCounts = {
  due: number;
  weak: number;
  new: number;
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
  direction: Association["direction"];
  focusSectionCode: string | null;
  queue: Association[];
  items: DailyLearningItem[];
  counts: DailyLearningCounts;
  readiness: ExamReadinessSummary;
};

export type DailyLearningInput = {
  associations: Association[];
  mastery: ReadonlyMap<string, Mastery>;
  attempts: Attempt[];
  now?: string | Date;
  seed?: string;
  limit?: number;
  dayStart?: string | Date;
  weakAttemptWindowDays?: number;
  readinessWindowDays?: number;
};

type Candidate = DailyLearningItem & {
  dueTime: number;
  errorCount: number;
  weakStateRank: number;
  tie: number;
};

const reasonRank: Record<DailyLearningReason, number> = {
  due: 0,
  weak: 1,
  new: 2,
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

function classifyCandidate(
  association: Association,
  mastery: Mastery | undefined,
  latestAttempt: Attempt | undefined,
  nowTime: number,
  tie: number,
): Candidate | null {
  const dueTime = timestamp(mastery?.next_due_at);
  const lastAttemptAt = latestAttempt?.created_at ?? null;
  const recentlyIncorrect = Boolean(latestAttempt && !latestAttempt.correct);
  let reason: DailyLearningReason | null = null;

  if (mastery && dueTime !== null && dueTime <= nowTime) reason = "due";
  else if (
    mastery?.state === "lapsed" ||
    mastery?.state === "blocked" ||
    (mastery?.consecutive_errors ?? 0) > 0 ||
    recentlyIncorrect
  )
    reason = "weak";
  else if (!mastery || mastery.state === "unseen") reason = "new";

  if (!reason) return null;
  return {
    association,
    reason,
    dueAt: dueTime === null ? null : mastery!.next_due_at,
    lastAttemptAt,
    dueTime: dueTime ?? Number.POSITIVE_INFINITY,
    errorCount:
      mastery?.consecutive_errors ?? (recentlyIncorrect ? 1 : 0),
    weakStateRank:
      mastery?.state === "lapsed"
        ? 0
        : mastery?.state === "blocked"
          ? 1
          : 2,
    tie,
  };
}

function compareCandidates(left: Candidate, right: Candidate) {
  const reasonDifference = reasonRank[left.reason] - reasonRank[right.reason];
  if (reasonDifference) return reasonDifference;
  if (left.reason === "due" && left.dueTime !== right.dueTime)
    return left.dueTime - right.dueTime;
  if (left.reason === "weak" && left.weakStateRank !== right.weakStateRank)
    return left.weakStateRank - right.weakStateRank;
  if (left.errorCount !== right.errorCount)
    return right.errorCount - left.errorCount;
  if (
    left.reason === "weak" &&
    left.lastAttemptAt !== right.lastAttemptAt
  )
    return (right.lastAttemptAt ?? "").localeCompare(
      left.lastAttemptAt ?? "",
    );
  return left.tie - right.tie ||
    left.association.id.localeCompare(right.association.id);
}

function orderCandidatesWithSectionFocus(
  candidates: Candidate[],
  seed: string,
) {
  const priority = candidates
    .filter((candidate) => candidate.reason !== "new")
    .sort(compareCandidates);
  const fresh = candidates
    .filter((candidate) => candidate.reason === "new")
    .sort(compareCandidates);
  if (!fresh.length)
    return { ordered: priority, focusSectionCode: null };

  const priorityBySection = new Map<string, number>();
  for (const candidate of priority) {
    const sectionCode = candidate.association.section_code;
    priorityBySection.set(
      sectionCode,
      (priorityBySection.get(sectionCode) ?? 0) + 1,
    );
  }

  const freshRecordsBySection = new Map<string, Set<string>>();
  for (const candidate of fresh) {
    const sectionCode = candidate.association.section_code;
    const records =
      freshRecordsBySection.get(sectionCode) ?? new Set<string>();
    records.add(candidate.association.record_id);
    freshRecordsBySection.set(sectionCode, records);
  }

  const focusSectionCode = [...freshRecordsBySection.keys()].sort(
    (left, right) => {
      const capacityDifference =
        freshRecordsBySection.get(right)!.size -
        freshRecordsBySection.get(left)!.size;
      if (capacityDifference) return capacityDifference;

      const priorityDifference =
        (priorityBySection.get(right) ?? 0) -
        (priorityBySection.get(left) ?? 0);
      if (priorityDifference) return priorityDifference;

      const tieDifference =
        seededRandom(`${seed}:focus-section:${left}`)() -
        seededRandom(`${seed}:focus-section:${right}`)();
      return tieDifference || left.localeCompare(right);
    },
  )[0];

  return {
    ordered: [
      ...priority,
      ...fresh.filter(
        (candidate) =>
          candidate.association.section_code === focusSectionCode,
      ),
      ...fresh.filter(
        (candidate) =>
          candidate.association.section_code !== focusSectionCode,
      ),
    ],
    focusSectionCode,
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

function chooseDirection(
  candidates: Candidate[],
  bank: Association[],
  mastery: ReadonlyMap<string, Mastery>,
  attempts: Attempt[],
): Association["direction"] {
  const available = new Set(bank.map((association) => association.direction));
  if (!available.size) return "reverse";
  if (available.size === 1) return [...available][0];
  if (!available.has("reverse")) return "forward";

  const needs = {
    reverse: { due: 0, weak: 0, new: 0 },
    forward: { due: 0, weak: 0, new: 0 },
  };
  for (const candidate of candidates)
    needs[candidate.association.direction][candidate.reason] += 1;

  const reverseNeed = needs.reverse.due + needs.reverse.weak;
  const forwardNeed = needs.forward.due + needs.forward.weak;
  if (reverseNeed !== forwardNeed)
    return reverseNeed > forwardNeed ? "reverse" : "forward";
  if (needs.reverse.due !== needs.forward.due)
    return needs.reverse.due > needs.forward.due ? "reverse" : "forward";

  const requiredIds = new Set(bank.map((association) => association.id));
  const hasLearningEvidence =
    bank.some((association) => mastery.has(association.id)) ||
    attempts.some((attempt) => requiredIds.has(attempt.association_id));
  if (!hasLearningEvidence) return "reverse";
  if (needs.reverse.new !== needs.forward.new)
    return needs.reverse.new > needs.forward.new ? "reverse" : "forward";
  return "reverse";
}

function selectRecordDiverse(
  candidates: Candidate[],
  limit: number,
  finalCompare = compareCandidates,
) {
  if (limit <= 0) return [];
  const selected: Candidate[] = [];
  const deferred: Candidate[] = [];
  const seenRecords = new Set<string>();
  for (const candidate of candidates) {
    if (seenRecords.has(candidate.association.record_id)) {
      deferred.push(candidate);
      continue;
    }
    selected.push(candidate);
    seenRecords.add(candidate.association.record_id);
    if (selected.length === limit) break;
  }
  if (selected.length < limit) {
    const selectedIds = new Set(
      selected.map((candidate) => candidate.association.id),
    );
    for (const candidate of deferred) {
      if (selectedIds.has(candidate.association.id)) continue;
      selected.push(candidate);
      selectedIds.add(candidate.association.id);
      if (selected.length === limit) break;
    }
  }
  return selected.sort(finalCompare);
}

export function buildDailyLearningPlan(
  input: DailyLearningInput,
): DailyLearningPlan {
  const now = normaliseNow(input.now);
  const generatedAt = now.toISOString();
  const nowTime = now.getTime();
  const limit = positiveInteger(input.limit, DEFAULT_DAILY_LEARNING_LIMIT);
  const seed = input.seed ?? generatedAt.slice(0, 10);
  const weakWindowDays = positiveInteger(
    input.weakAttemptWindowDays,
    DEFAULT_WEAK_ATTEMPT_WINDOW_DAYS,
  );
  const bank = requiredBank(input.associations);
  const requiredIds = new Set(bank.map((association) => association.id));
  const defaultDayStart = new Date(now);
  defaultDayStart.setUTCHours(0, 0, 0, 0);
  const dayStart = input.dayStart
    ? normaliseNow(input.dayStart)
    : defaultDayStart;
  const completedTodayIds = new Set(
    input.attempts
      .filter((attempt) => {
        const attemptTime = timestamp(attempt.created_at);
        return (
          requiredIds.has(attempt.association_id) &&
          attempt.source_mode === "daily" &&
          isFirstPass(attempt) &&
          attemptTime !== null &&
          attemptTime >= dayStart.getTime() &&
          attemptTime <= nowTime
        );
      })
      .map((attempt) => attempt.association_id),
  );
  const remainingLimit = Math.max(0, limit - completedTodayIds.size);
  const recentAttempts = latestAttempts(
    input.attempts,
    requiredIds,
    nowTime,
    nowTime - weakWindowDays * DAY_MS,
    false,
  );
  const candidates = bank
    .filter((association) => !completedTodayIds.has(association.id))
    .map((association) =>
      classifyCandidate(
        association,
        input.mastery.get(association.id),
        recentAttempts.get(association.id),
        nowTime,
        seededRandom(`${seed}:${association.id}`)(),
      ),
    )
    .filter((candidate): candidate is Candidate => candidate !== null);
  const direction = chooseDirection(
    candidates,
    bank,
    input.mastery,
    input.attempts,
  );
  const clustered = orderCandidatesWithSectionFocus(
    candidates.filter(
      (candidate) => candidate.association.direction === direction,
    ),
    seed,
  );
  const selected = selectRecordDiverse(
    clustered.ordered,
    remainingLimit,
    (left, right) => {
      const reasonDifference =
        reasonRank[left.reason] - reasonRank[right.reason];
      if (reasonDifference) return reasonDifference;
      if (left.reason === "new") {
        const leftFocused =
          left.association.section_code === clustered.focusSectionCode;
        const rightFocused =
          right.association.section_code === clustered.focusSectionCode;
        if (leftFocused !== rightFocused) return leftFocused ? -1 : 1;
      }
      return compareCandidates(left, right);
    },
  );
  const items: DailyLearningItem[] = selected.map(
    ({ association, reason, dueAt, lastAttemptAt }) => ({
      association,
      reason,
      dueAt,
      lastAttemptAt,
    }),
  );

  return {
    generatedAt,
    seed,
    direction,
    focusSectionCode: selected.some(
      (candidate) =>
        candidate.reason === "new" &&
        candidate.association.section_code === clustered.focusSectionCode,
    )
      ? clustered.focusSectionCode
      : null,
    queue: items.map((item) => item.association),
    items,
    counts: countReasons(items),
    readiness: calculateExamReadiness({
      associations: bank,
      mastery: input.mastery,
      attempts: input.attempts,
      now,
      windowDays: input.readinessWindowDays,
    }),
  };
}
