import type { Association, Attempt } from "./types";

export type TroubleKind = "recurring_slip" | "one_off_slip" | "not_yet_secure";

export type TroubleSpot = {
  association: Association;
  kind: TroubleKind;
  correctAttempts: number;
  incorrectAttempts: number;
  recentResults: boolean[];
  lastAttemptAt: string;
  lastAttemptCorrect: boolean;
};

const kindRank: Record<TroubleKind, number> = {
  recurring_slip: 0,
  one_off_slip: 1,
  not_yet_secure: 2,
};

export function buildTroubleSpots(
  associations: Association[],
  attempts: Attempt[],
): TroubleSpot[] {
  const associationsById = new Map(
    associations.map((association) => [association.id, association]),
  );
  const grouped = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    if (!associationsById.has(attempt.association_id)) continue;
    const values = grouped.get(attempt.association_id) ?? [];
    values.push(attempt);
    grouped.set(attempt.association_id, values);
  }

  const spots: TroubleSpot[] = [];
  for (const [associationId, values] of grouped) {
    const ordered = [...values].sort((left, right) =>
      left.created_at.localeCompare(right.created_at),
    );
    const correctAttempts = ordered.filter((attempt) => attempt.correct).length;
    const incorrectAttempts = ordered.length - correctAttempts;
    if (!incorrectAttempts) continue;
    const kind: TroubleKind = correctAttempts === 0
      ? "not_yet_secure"
      : incorrectAttempts > 1
        ? "recurring_slip"
        : "one_off_slip";
    spots.push({
      association: associationsById.get(associationId)!,
      kind,
      correctAttempts,
      incorrectAttempts,
      recentResults: ordered.slice(-5).map((attempt) => attempt.correct),
      lastAttemptAt: ordered.at(-1)!.created_at,
      lastAttemptCorrect: ordered.at(-1)!.correct,
    });
  }

  const parentsWithAtomicMisses = new Set(
    spots
      .filter((spot) => spot.association.scope === "street")
      .map((spot) => spot.association.parent_association_id),
  );
  return spots.filter(
    (spot) =>
      spot.association.scope === "street" ||
      !parentsWithAtomicMisses.has(spot.association.id),
  ).sort((left, right) =>
    kindRank[left.kind] - kindRank[right.kind] ||
    Number(left.lastAttemptCorrect) - Number(right.lastAttemptCorrect) ||
    right.incorrectAttempts - left.incorrectAttempts ||
    right.lastAttemptAt.localeCompare(left.lastAttemptAt),
  );
}
