import type { Association, Attempt } from "./types";
import type { SectionQuestion } from "./questions";

type AttemptContext = Omit<Attempt, "association_id" | "correct">;

/**
 * A multi-answer result contains independent evidence for each keyed street.
 * Only keyed streets are split: selecting a distractor remains evidence against
 * the parent set question, but does not invent a negative source association.
 */
export function atomicStreetAttempts(
  association: Association,
  atomicAssociations: Association[],
  question: SectionQuestion,
  selectedOptionIds: string[],
  context: AttemptContext,
): Attempt[] {
  if (association.scope !== "record_set" || association.kind !== "category_to_streets")
    return [];
  const selected = new Set(selectedOptionIds);
  const keyed = new Set(question.answer_option_ids);
  return atomicAssociations
    .filter(
      (candidate) =>
        candidate.scope === "street" &&
        candidate.parent_association_id === association.id &&
        candidate.feature_index !== null,
    )
    .map((candidate) => {
      const optionId = `${candidate.record_id}:feature:${candidate.feature_index}`;
      if (!keyed.has(optionId))
        throw new Error(`Atomic association ${candidate.id} is not keyed by ${question.id}`);
      return {
        ...context,
        association_id: candidate.id,
        correct: selected.has(optionId),
      };
    });
}
