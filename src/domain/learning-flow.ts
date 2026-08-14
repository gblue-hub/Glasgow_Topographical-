import type {
  Association,
  Attempt,
  LearningQuestionStage,
  LearningSession,
  Mastery,
} from "./types";

export function hasIndependentSuccessfulRetrieval(
  attempts: Attempt[],
  associationId: string,
  excludedSessionId?: string,
) {
  return attempts.some(
    (attempt) =>
      attempt.association_id === associationId &&
      attempt.session_id !== excludedSessionId &&
      attempt.phase !== "correction" &&
      attempt.correct &&
      !attempt.used_reveal &&
      attempt.confidence > 1,
  );
}

export function needsStudyBeforeTest(input: {
  association: Association;
  sourceMode: LearningSession["source_mode"];
  mastery: Mastery | undefined;
  hasPriorAttempt: boolean;
  studiedRecordIds: ReadonlySet<string>;
  correctionMode: boolean;
}) {
  return (
    input.sourceMode === "daily" &&
    input.association.direction === "reverse" &&
    !input.correctionMode &&
    !input.hasPriorAttempt &&
    (!input.mastery || input.mastery.state === "unseen") &&
    !input.studiedRecordIds.has(input.association.record_id)
  );
}

export function initialQuestionStage(
  input: Parameters<typeof needsStudyBeforeTest>[0],
): LearningQuestionStage {
  return needsStudyBeforeTest(input) ? "study" : "prompt";
}

export function initialQuestionConfidence(input: {
  hasPriorAttempt: boolean;
  mastery: Mastery | undefined;
  correctionMode: boolean;
}): 2 | 3 {
  const hasSeenQuestion =
    input.hasPriorAttempt ||
    input.correctionMode ||
    (!!input.mastery && input.mastery.state !== "unseen");
  return hasSeenQuestion ? 3 : 2;
}

export function inferAnswerConfidence(input: {
  correct: boolean;
  usedAssistance: boolean;
  preRevealLatencyMs: number | null;
  answerSelectionLatencyMs: number;
  selectionInteractionCount: number;
  expectedSelectionCount: number;
}): 1 | 2 | 3 {
  if (!input.correct || input.usedAssistance) return 1;

  let uncertaintySignals = 0;
  const preRevealLatencyMs = input.preRevealLatencyMs;
  if (preRevealLatencyMs !== null) {
    if (preRevealLatencyMs < 800 || preRevealLatencyMs > 20_000)
      uncertaintySignals += 1;
    if (preRevealLatencyMs > 45_000) uncertaintySignals += 1;
  }
  if (input.answerSelectionLatencyMs > 12_000) uncertaintySignals += 1;
  if (input.answerSelectionLatencyMs > 30_000) uncertaintySignals += 1;

  const revisedSelections = Math.max(
    0,
    input.selectionInteractionCount - input.expectedSelectionCount,
  );
  if (revisedSelections > 0) uncertaintySignals += 1;
  if (revisedSelections > 1) uncertaintySignals += 1;

  if (uncertaintySignals >= 3) return 1;
  if (uncertaintySignals > 0) return 2;
  return 3;
}

export const learningStageLabel: Record<LearningQuestionStage, string> = {
  study: "Studying the relationship",
  prompt: "Thinking before the choices",
  choices: "Choosing an answer",
  feedback: "Reviewing feedback",
};

export function dailySessionQueue(input: {
  planned: Association[];
  studyRecordIds: ReadonlySet<string>;
  associations: Association[];
}) {
  const byRecord = new Map<string, Association[]>();
  for (const association of input.associations) {
    if (!association.required || association.scope !== "record_set") continue;
    byRecord.set(association.record_id, [
      ...(byRecord.get(association.record_id) ?? []),
      association,
    ]);
  }
  const studyFirst = input.planned.filter(
    (association) =>
      input.studyRecordIds.has(association.record_id) &&
      association.direction === "reverse",
  );
  const remainder = [
    ...input.planned,
    ...[...input.studyRecordIds].flatMap(
      (recordId) => byRecord.get(recordId) ?? [],
    ),
  ];
  const seen = new Set<string>();
  return [...studyFirst, ...remainder].filter((association) => {
    if (seen.has(association.id)) return false;
    seen.add(association.id);
    return true;
  });
}

export function correctionSessionQueue(
  missedAssociationIds: ReadonlySet<string>,
  associations: Association[],
) {
  const missedRecordIds = new Set(
    associations
      .filter((association) => missedAssociationIds.has(association.id))
      .map((association) => association.record_id),
  );
  const selected = associations.filter(
    (association) =>
      missedRecordIds.has(association.record_id) &&
      association.required &&
      association.scope === "record_set",
  );
  return [
    ...selected.filter((association) => association.direction === "reverse"),
    ...selected.filter((association) => association.direction === "forward"),
  ];
}
