import type { Association, SessionResult } from "./types";
import { normaliseSectionCodes } from "./section-groups";

export function seededRandom(seed: string) {
  let value = [...seed].reduce(
    (number, character) => Math.imul(number ^ character.charCodeAt(0), 16777619),
    2166136261,
  );
  return () => ((value = Math.imul(value ^ (value >>> 15), 1 | value)) >>> 0) / 4294967296;
}

export function randomiseAssociations(
  items: Association[],
  random: () => number = Math.random,
) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  for (let index = 1; index < result.length; index += 1) {
    if (result[index].record_id !== result[index - 1].record_id) continue;
    const swap = result.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        candidate.record_id !== result[index - 1].record_id &&
        (candidateIndex === result.length - 1 || candidate.record_id !== result[index + 1]?.record_id),
    );
    if (swap > index) [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function createSessionResult(input: {
  sessionId: string;
  sectionCode: string | null;
  sectionCodes?: string[];
  selectionLabel?: string;
  practiceDirection?: Association["direction"];
  questionCount: number;
  correctCount: number;
  incorrectAssociationIds: Iterable<string>;
  completedAt?: string;
}): SessionResult {
  const questionCount = Math.max(0, input.questionCount);
  const correctCount = Math.min(questionCount, Math.max(0, input.correctCount));
  const sectionCodes = normaliseSectionCodes(input.sectionCodes ?? (input.sectionCode ? [input.sectionCode] : []));
  const scope = sectionCodes.length > 1 ? "section_set" : input.sectionCode ? "section" : "course";
  return {
    schema_version: "1.1.0",
    session_id: input.sessionId,
    scope,
    section_code: scope === "section" ? input.sectionCode : null,
    ...(sectionCodes.length ? { section_codes: sectionCodes } : {}),
    ...(input.selectionLabel ? { selection_label: input.selectionLabel } : {}),
    ...(input.practiceDirection ? { practice_direction: input.practiceDirection } : {}),
    question_count: questionCount,
    correct_count: correctCount,
    percentage: questionCount ? (correctCount / questionCount) * 100 : 0,
    incorrect_association_ids: [...input.incorrectAssociationIds],
    completed_at: input.completedAt || new Date().toISOString(),
  };
}

export const sectionResultKey = (
  sectionCode: string,
  direction: Association["direction"],
) => `${sectionCode}:${direction}`;

/** One replaceable score per section and practice direction. */
export function indexLatestSectionResults(results: SessionResult[]) {
  const latest = new Map<string, SessionResult>();
  for (const result of results) {
    if (result.scope !== "section" || !result.section_code || !result.practice_direction) continue;
    const key = sectionResultKey(result.section_code, result.practice_direction);
    const previous = latest.get(key);
    const isNewer = !previous ||
      previous.completed_at < result.completed_at ||
      (previous.completed_at === result.completed_at && (previous.id ?? 0) < (result.id ?? 0));
    if (isNewer) latest.set(key, result);
  }
  return latest;
}
