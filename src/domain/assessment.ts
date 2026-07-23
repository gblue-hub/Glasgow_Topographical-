import { randomiseAssociations, seededRandom } from "./session";
import type {
  Association,
  AssessmentMode,
  AssessmentSession,
  MockQuestionHistory,
} from "./types";
import { QUESTION_GENERATOR_VERSION } from "./questions";

export const ASSESSMENT_SCHEMA_VERSION = "1.0.0" as const;
export const MOCK_QUESTION_COUNT = 100;

const requiredBank = (associations: Association[]) =>
  associations.filter(
    (association) => association.required && association.scope === "record_set",
  );

export function createAssessmentOrder(input: {
  mode: AssessmentMode;
  associations: Association[];
  seed: string;
  history?: MockQuestionHistory[];
  suppliedSeed?: boolean;
}) {
  const bank = requiredBank(input.associations);
  if (input.mode === "final")
    return randomiseAssociations(bank, seededRandom(`final:${input.seed}`));
  if (bank.length < MOCK_QUESTION_COUNT)
    throw new Error(`Mock requires ${MOCK_QUESTION_COUNT} unique questions`);
  if (input.suppliedSeed)
    return randomiseAssociations(
      bank,
      seededRandom(`mock:seeded:${input.seed}`),
    ).slice(0, MOCK_QUESTION_COUNT);

  const history = new Map(
    (input.history ?? []).map((item) => [item.association_id, item]),
  );
  const random = seededRandom(`mock:rotating:${input.seed}`);
  return bank
    .map((association) => ({
      association,
      served: history.get(association.id),
      tie: random(),
    }))
    .sort(
      (left, right) =>
        Number(Boolean(left.served)) - Number(Boolean(right.served)) ||
        (left.served?.last_served_at ?? "").localeCompare(
          right.served?.last_served_at ?? "",
        ) ||
        (left.served?.times_served ?? 0) - (right.served?.times_served ?? 0) ||
        left.tie - right.tie ||
        left.association.id.localeCompare(right.association.id),
    )
    .slice(0, MOCK_QUESTION_COUNT)
    .map((item) => item.association);
}

export function createAssessmentSession(input: {
  mode: AssessmentMode;
  associations: Association[];
  contentVersion: string;
  seed: string;
  history?: MockQuestionHistory[];
  suppliedSeed?: boolean;
  now?: string;
}): AssessmentSession {
  const now = input.now ?? new Date().toISOString();
  const order = createAssessmentOrder(input);
  return {
    id: `active:${input.mode}`,
    schema_version: ASSESSMENT_SCHEMA_VERSION,
    mode: input.mode,
    status: "active",
    selection_strategy:
      input.mode === "final"
        ? "exhaustive"
        : input.suppliedSeed
          ? "seeded"
          : "rotating",
    content_version: input.contentVersion,
    generator_version: QUESTION_GENERATOR_VERSION,
    seed: input.seed,
    association_ids: order.map((association) => association.id),
    answers: {},
    position: 0,
    created_at: now,
    updated_at: now,
  };
}

export function validateAssessmentSession(
  session: AssessmentSession,
  associations: Association[],
  contentVersion: string,
): string | null {
  if (session.schema_version !== ASSESSMENT_SCHEMA_VERSION)
    return "unsupported session schema";
  if (session.content_version !== contentVersion) return "content version changed";
  if (session.generator_version !== QUESTION_GENERATOR_VERSION)
    return "question generator changed";
  const bank = requiredBank(associations);
  const requiredIds = new Set(bank.map((association) => association.id));
  const expectedCount = session.mode === "final" ? bank.length : MOCK_QUESTION_COUNT;
  if (session.association_ids.length !== expectedCount)
    return "question count does not match this assessment mode";
  if (new Set(session.association_ids).size !== session.association_ids.length)
    return "question order contains duplicates";
  if (session.association_ids.some((id) => !requiredIds.has(id)))
    return "question order references unavailable or non-required content";
  if (
    !Number.isInteger(session.position) ||
    session.position < 0 ||
    session.position >= session.association_ids.length
  )
    return "saved position is invalid";
  if (
    Object.entries(session.answers).some(
      ([id, answer]) =>
        !session.association_ids.includes(id) || answer.association_id !== id,
    )
  )
    return "saved answers do not match the question order";
  return null;
}

export function mockCoverage(
  requiredAssociations: Association[],
  history: MockQuestionHistory[],
) {
  const required = requiredBank(requiredAssociations);
  const requiredIds = new Set(required.map((association) => association.id));
  const served = history.filter((item) => requiredIds.has(item.association_id)).length;
  return {
    served,
    total: required.length,
    percentage: required.length ? (served / required.length) * 100 : 0,
  };
}
