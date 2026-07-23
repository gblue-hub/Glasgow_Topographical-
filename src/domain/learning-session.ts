import type { Association, LearningSession } from "./types";
import { QUESTION_GENERATOR_VERSION } from "./questions";

export const LEARNING_SESSION_SCHEMA_VERSION = "1.0.0" as const;

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
  if (session.mistake_ids.some((id) => !known.has(id))) return "unknown mistake ID";
  return null;
}

export function learningSessionQueue(session: LearningSession, associations: Association[]) {
  const byId = new Map(associations.map((association) => [association.id, association]));
  return session.association_ids.map((id) => byId.get(id)).filter((item): item is Association => Boolean(item));
}
