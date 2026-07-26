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

export const learningStageLabel: Record<LearningQuestionStage, string> = {
  study: "Studying the relationship",
  prompt: "Thinking before the choices",
  choices: "Choosing an answer",
  feedback: "Reviewing feedback",
};
