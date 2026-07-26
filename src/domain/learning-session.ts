import type { Association, LearningSession } from "./types";
import { QUESTION_GENERATOR_VERSION } from "./questions";

export const LEARNING_SESSION_SCHEMA_VERSION = "1.1.0" as const;

export function validateLearningSession(
  session: LearningSession,
  associations: Association[],
  contentVersion: string,
) {
  if (session.schema_version !== LEARNING_SESSION_SCHEMA_VERSION) return "unsupported session schema";
  if (session.content_version !== contentVersion) return "content version changed";
  if (session.generator_version !== QUESTION_GENERATOR_VERSION) return "question generator changed";
  if (!session.association_ids.length) return "empty question selection";
  if (new Set(session.association_ids).size !== session.association_ids.length) return "duplicate question IDs";
  const known = new Set(associations.map((association) => association.id));
  if (session.association_ids.some((id) => !known.has(id))) return "question bank changed";
  if (session.source_mode === "daily" && !session.practice_direction)
    return "daily practice direction missing";
  if (
    session.practice_direction &&
    session.association_ids.some(
      (id) => associations.find((association) => association.id === id)?.direction !== session.practice_direction,
    )
  )
    return "practice directions were mixed";
  if (!Number.isInteger(session.position) || session.position < 0 || session.position >= session.association_ids.length)
    return "invalid question position";
  if (!Number.isInteger(session.round) || session.round < 1) return "invalid correction round";
  if (!Number.isInteger(session.hint_level) || session.hint_level < 0 || session.hint_level > 2)
    return "invalid hint state";
  if (!["study", "prompt", "choices", "feedback"].includes(session.question_stage))
    return "invalid question stage";
  if (![1, 2, 3].includes(session.confidence))
    return "invalid confidence state";
  if (new Set(session.studied_record_ids).size !== session.studied_record_ids.length)
    return "duplicate studied record IDs";
  const recordIds = new Set(
    associations.map((association) => association.record_id),
  );
  if (session.studied_record_ids.some((id) => !recordIds.has(id)))
    return "unknown studied record ID";
  if (
    session.selected_option_ids.length > 0 &&
    !["choices", "feedback"].includes(session.question_stage)
  )
    return "selected answers were hidden";
  if (session.checked && session.question_stage !== "feedback")
    return "checked answer missing feedback stage";
  if (!session.checked && session.question_stage === "feedback")
    return "feedback stage missing checked answer";
  if (
    session.question_stage === "study" &&
    (session.selected_option_ids.length > 0 || session.used_assistance)
  )
    return "invalid study stage state";
  if (session.mistake_ids.some((id) => !known.has(id))) return "unknown mistake ID";
  return null;
}

export function learningSessionQueue(session: LearningSession, associations: Association[]) {
  const byId = new Map(associations.map((association) => [association.id, association]));
  return session.association_ids.map((id) => byId.get(id)).filter((item): item is Association => Boolean(item));
}
