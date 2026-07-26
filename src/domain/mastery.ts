import type { Attempt, Mastery } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function applyAttempt(
  previous: Mastery | undefined,
  attempt: Attempt,
): Mastery {
  const independentRetrieval =
    attempt.correct && !attempt.used_reveal && attempt.confidence > 1;
  const correctRetrievals =
    (previous?.correct_retrievals ?? 0) + (independentRetrieval ? 1 : 0);
  const recallSuccesses =
    (previous?.recall_successes ?? 0) + (independentRetrieval ? 1 : 0);
  const errors = attempt.correct
    ? 0
    : (previous?.consecutive_errors ?? 0) + 1;
  const mastered =
    independentRetrieval &&
    attempt.confidence === 3 &&
    correctRetrievals >= 3 &&
    recallSuccesses >= 1 &&
    errors === 0;
  const delay = mastered
    ? 14 * DAY
    : !attempt.correct
      ? 10 * MINUTE
      : attempt.used_reveal || attempt.confidence === 1
        ? 4 * HOUR
        : attempt.confidence === 2
          ? DAY
          : 2 * DAY;
  const state = mastered
    ? "mastered"
    : errors > 0 && previous?.state === "mastered"
      ? "lapsed"
      : attempt.correct && previous?.state === "mastered"
        ? "reviewing"
        : "learning";

  return {
    association_id: attempt.association_id,
    state,
    correct_retrievals: correctRetrievals,
    recall_successes: recallSuccesses,
    consecutive_errors: errors,
    last_seen_at: attempt.created_at,
    next_due_at: new Date(Date.parse(attempt.created_at) + delay).toISOString(),
  };
}

export function completion(
  requiredIds: string[],
  mastery: Map<string, Mastery>,
) {
  const mastered = requiredIds.filter(
    (id) => mastery.get(id)?.state === "mastered",
  ).length;
  return {
    mastered,
    total: requiredIds.length,
    percentage: requiredIds.length
      ? (mastered / requiredIds.length) * 100
      : 0,
    complete: requiredIds.length > 0 && mastered === requiredIds.length,
  };
}

export function applyAttemptEvidence(
  previous: ReadonlyMap<string, Mastery>,
  attempts: Attempt[],
  phase: "first_pass" | "correction",
) {
  const next = new Map(previous);
  if (phase === "correction") return next;
  for (const attempt of attempts)
    next.set(
      attempt.association_id,
      applyAttempt(next.get(attempt.association_id), attempt),
    );
  return next;
}
