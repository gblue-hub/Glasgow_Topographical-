import type { Association, Attempt, LearningRecord } from "./types";

export type DirectionEvidenceStatus =
  | "not_tried"
  | "last_wrong"
  | "assisted_only"
  | "recovered"
  | "correct_so_far";

export type DirectionalPattern =
  | "unsupported_pair"
  | "not_tested"
  | "one_direction_unattempted"
  | "assisted_only"
  | "both_latest_wrong"
  | "forward_latest_wrong"
  | "reverse_latest_wrong"
  | "latest_correct_both";

export type DirectionEvidence = {
  association: Association | null;
  status: DirectionEvidenceStatus;
  attemptCount: number;
  correctAttempts: number;
  incorrectAttempts: number;
  helpedAttempts: number;
  currentCorrectStreak: number;
  recentResults: Array<{ correct: boolean; usedReveal: boolean }>;
  lastAttemptAt: string | null;
  lastAttemptCorrect: boolean | null;
  hasLegacyEvidence: boolean;
};

export type DirectionalFeedbackItem = {
  record: LearningRecord;
  pattern: DirectionalPattern;
  forward: DirectionEvidence;
  reverse: DirectionEvidence;
  totalIncorrectAttempts: number;
  lastAttemptAt: string | null;
  fragile: boolean;
  confusionPairs: Array<{
    recordId: string;
    examName: string;
    count: number;
    directions: Array<"forward" | "reverse">;
  }>;
};

const patternRank: Record<DirectionalPattern, number> = {
  both_latest_wrong: 0,
  forward_latest_wrong: 1,
  reverse_latest_wrong: 1,
  one_direction_unattempted: 2,
  assisted_only: 3,
  latest_correct_both: 4,
  not_tested: 5,
  unsupported_pair: 6,
};

function buildDirectionEvidence(
  association: Association | undefined,
  attemptsByAssociation: Map<string, Attempt[]>,
): DirectionEvidence {
  if (!association) {
    return {
      association: null,
      status: "not_tried",
      attemptCount: 0,
      correctAttempts: 0,
      incorrectAttempts: 0,
      helpedAttempts: 0,
      currentCorrectStreak: 0,
      recentResults: [],
      lastAttemptAt: null,
      lastAttemptCorrect: null,
      hasLegacyEvidence: false,
    };
  }
  // Older rows pre-date the phase field. Keep them visible, but flag that the
  // evidence may include an old correction round. New correction rows are
  // explicitly excluded and can no longer conceal the first-pass result.
  const ordered = [...(attemptsByAssociation.get(association.id) ?? [])]
    .filter((attempt) => attempt.phase !== "correction")
    .sort((left, right) =>
      left.created_at.localeCompare(right.created_at) || (left.id ?? 0) - (right.id ?? 0),
    );
  const decisive = ordered.filter((attempt) => !attempt.correct || !attempt.used_reveal);
  const correctAttempts = ordered.filter((attempt) => attempt.correct).length;
  const incorrectAttempts = ordered.length - correctAttempts;
  const helpedAttempts = ordered.filter((attempt) => attempt.correct && attempt.used_reveal).length;
  const last = decisive.at(-1);
  let currentCorrectStreak = 0;
  for (let index = decisive.length - 1; index >= 0 && decisive[index].correct; index -= 1)
    currentCorrectStreak += 1;
  const status: DirectionEvidenceStatus = !ordered.length
    ? "not_tried"
    : !decisive.length
      ? "assisted_only"
      : !last!.correct
        ? "last_wrong"
        : incorrectAttempts
          ? "recovered"
          : "correct_so_far";
  return {
    association,
    status,
    attemptCount: ordered.length,
    correctAttempts,
    incorrectAttempts,
    helpedAttempts,
    currentCorrectStreak,
    recentResults: decisive.slice(-5).map((attempt) => ({
      correct: attempt.correct,
      usedReveal: attempt.used_reveal,
    })),
    lastAttemptAt: last?.created_at ?? ordered.at(-1)?.created_at ?? null,
    lastAttemptCorrect: last?.correct ?? null,
    hasLegacyEvidence: ordered.some((attempt) => attempt.phase === undefined),
  };
}

function patternFor(forward: DirectionEvidence, reverse: DirectionEvidence): DirectionalPattern {
  if (!forward.association || !reverse.association) return "unsupported_pair";
  if (forward.status === "not_tried" && reverse.status === "not_tried") return "not_tested";
  if (forward.status === "not_tried" || reverse.status === "not_tried") return "one_direction_unattempted";
  if (forward.status === "assisted_only" || reverse.status === "assisted_only") return "assisted_only";
  if (forward.status === "last_wrong" && reverse.status === "last_wrong") return "both_latest_wrong";
  if (forward.status === "last_wrong") return "forward_latest_wrong";
  if (reverse.status === "last_wrong") return "reverse_latest_wrong";
  return "latest_correct_both";
}

export function practiceAssociationIds(item: DirectionalFeedbackItem) {
  const ids = (directions: DirectionEvidence[]) => directions
    .map((direction) => direction.association?.id)
    .filter((id): id is string => Boolean(id));
  switch (item.pattern) {
    case "both_latest_wrong": return ids([item.forward, item.reverse]);
    case "forward_latest_wrong": return ids([item.forward]);
    case "reverse_latest_wrong": return ids([item.reverse]);
    case "one_direction_unattempted": return ids([
      item.forward.status === "not_tried" ? item.forward : item.reverse,
    ]);
    case "assisted_only": return ids([
      ...(item.forward.status === "assisted_only" ? [item.forward] : []),
      ...(item.reverse.status === "assisted_only" ? [item.reverse] : []),
    ]);
    case "latest_correct_both": return ids([
      ...(item.forward.status === "recovered" ? [item.forward] : []),
      ...(item.reverse.status === "recovered" ? [item.reverse] : []),
    ]);
    case "not_tested": return ids([item.forward, item.reverse]);
    default: return [];
  }
}

export function buildDirectionalFeedback(
  records: LearningRecord[],
  associations: Association[],
  attempts: Attempt[],
): DirectionalFeedbackItem[] {
  const requiredByRecord = new Map<string, Association[]>();
  for (const association of associations) {
    if (!association.required || association.scope !== "record_set") continue;
    const values = requiredByRecord.get(association.record_id) ?? [];
    values.push(association);
    requiredByRecord.set(association.record_id, values);
  }
  const attemptsByAssociation = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    const values = attemptsByAssociation.get(attempt.association_id) ?? [];
    values.push(attempt);
    attemptsByAssociation.set(attempt.association_id, values);
  }
  const recordsById = new Map(records.map((record) => [record.id, record]));

  return records.flatMap((record) => {
    const recordAssociations = requiredByRecord.get(record.id) ?? [];
    const forward = buildDirectionEvidence(
      recordAssociations.find((association) => association.direction === "forward"),
      attemptsByAssociation,
    );
    const reverse = buildDirectionEvidence(
      recordAssociations.find((association) => association.direction === "reverse"),
      attemptsByAssociation,
    );
    if (!forward.association && !reverse.association) return [];
    const pattern = patternFor(forward, reverse);
    const confusionCounts = new Map<string, { count: number; directions: Set<"forward" | "reverse"> }>();
    for (const direction of [forward, reverse]) {
      if (!direction.association) continue;
      for (const attempt of attemptsByAssociation.get(direction.association.id) ?? []) {
        if (attempt.phase === "correction" || attempt.correct || !attempt.selected_option_ids) continue;
        const keyed = new Set(attempt.keyed_option_ids ?? []);
        for (const optionId of attempt.selected_option_ids) {
          if (keyed.has(optionId)) continue;
          const marker = optionId.lastIndexOf(":feature:");
          const sourceRecordId = direction.association.direction === "forward" && marker > 0
            ? optionId.slice(0, marker)
            : optionId;
          if (sourceRecordId === record.id || !recordsById.has(sourceRecordId)) continue;
          const value = confusionCounts.get(sourceRecordId) ?? { count: 0, directions: new Set() };
          value.count += 1;
          value.directions.add(direction.association.direction);
          confusionCounts.set(sourceRecordId, value);
        }
      }
    }
    const confusionPairs = [...confusionCounts.entries()]
      .filter(([, value]) => value.count >= 2)
      .map(([recordId, value]) => ({
        recordId,
        examName: recordsById.get(recordId)!.exam_name,
        count: value.count,
        directions: [...value.directions],
      }))
      .sort((left, right) => right.count - left.count || left.examName.localeCompare(right.examName, "en-GB"));
    return [{
      record,
      pattern,
      forward,
      reverse,
      totalIncorrectAttempts: forward.incorrectAttempts + reverse.incorrectAttempts,
      lastAttemptAt: [forward.lastAttemptAt, reverse.lastAttemptAt]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
      fragile: [forward, reverse].some((direction) => direction.status === "recovered"),
      confusionPairs,
    }];
  }).sort((left, right) =>
    patternRank[left.pattern] - patternRank[right.pattern] ||
    Number(right.fragile) - Number(left.fragile) ||
    right.totalIncorrectAttempts - left.totalIncorrectAttempts ||
    (right.lastAttemptAt ?? "").localeCompare(left.lastAttemptAt ?? "") ||
    left.record.exam_name.localeCompare(right.record.exam_name, "en-GB", { sensitivity: "base" }),
  );
}
