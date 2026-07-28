import type { Association, Attempt, SessionResult } from "./types";

const questionPosition = (attempt: Attempt) => {
  const match = attempt.question_instance_id?.match(/:(\d+):(\d+)$/);
  return match ? Number(match[2]) : Number.POSITIVE_INFINITY;
};

export function replayAssociationIds(
  result: SessionResult,
  attempts: Attempt[],
  associations: Association[],
) {
  const required = new Set(
    associations
      .filter(
        (association) =>
          association.required && association.scope === "record_set",
      )
      .map((association) => association.id),
  );
  const stored = (result.association_ids ?? []).filter((id) =>
    required.has(id),
  );
  if (stored.length) return [...new Set(stored)];

  const seen = new Set<string>();
  return attempts
    .filter(
      (attempt) =>
        attempt.session_id === result.session_id &&
        attempt.phase !== "correction" &&
        required.has(attempt.association_id),
    )
    .sort(
      (left, right) =>
        questionPosition(left) - questionPosition(right) ||
        left.created_at.localeCompare(right.created_at) ||
        left.association_id.localeCompare(right.association_id),
    )
    .flatMap((attempt) => {
      if (seen.has(attempt.association_id)) return [];
      seen.add(attempt.association_id);
      return [attempt.association_id];
    });
}

export function orderedSessionHistory(results: SessionResult[]) {
  return [...results].sort(
    (left, right) =>
      right.completed_at.localeCompare(left.completed_at) ||
      (right.id ?? 0) - (left.id ?? 0),
  );
}
