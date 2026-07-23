import type { Association, LearningRecord } from "./types";
import { normaliseRoadName } from "./road-names";
export const QUESTION_GENERATOR_VERSION = "section-questions.v2.0.0";
export type QuestionOption = { id: string; label: string };
export type SectionQuestion = {
  id: string;
  association_id: string;
  record_id: string;
  direction: "streets_to_category" | "category_to_streets";
  prompt: string;
  street_names: string[];
  options: QuestionOption[];
  answer_option_ids: string[];
  selection_mode: "single" | "multiple";
};
type RoadFeature = { properties: { road_link_id: string; names: string[] } };
const answerFeatures = (record: LearningRecord) =>
  record.features.filter(
    (feature) =>
      record.type === "district" ||
      !["place", "middle_road"].includes(feature.role),
  );
const roadAliases = (record: LearningRecord, aliases: Map<string, string[]>) =>
  answerFeatures(record).map(
    (feature) =>
      new Set(
        [
          feature.exam_name,
          feature.map_name,
          ...(feature.road_link_id
            ? aliases.get(feature.road_link_id) || []
            : []),
        ].map(normaliseRoadName),
      ),
  );
const featureAliases = (
  feature: LearningRecord["features"][number],
  aliases: Map<string, string[]>,
) =>
  new Set(
    [
      feature.exam_name,
      feature.map_name,
      ...(feature.road_link_id ? aliases.get(feature.road_link_id) || [] : []),
    ].map(normaliseRoadName),
  );
const overlaps = (left: Set<string>[], right: Set<string>[]) =>
  left.some((a) => right.some((b) => [...a].some((name) => b.has(name))));
const centre = (record: LearningRecord) => {
  const points = answerFeatures(record)
    .map((f) => f.effective_coordinates)
    .filter(Boolean);
  return points.reduce(
    (sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length],
    [0, 0],
  );
};
const distance = (a: number[], b: number[]) => {
  const x = (a[0] - b[0]) * 111000 * Math.cos((a[1] * Math.PI) / 180),
    y = (a[1] - b[1]) * 111000;
  return Math.hypot(x, y);
};
function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = old;
    }
  }
  return row[b.length];
}
const seeded = (seed: string) => {
  let value = [...seed].reduce(
    (n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619),
    2166136261,
  );
  return () =>
    ((value = Math.imul(value ^ (value >>> 15), 1 | value)) >>> 0) / 4294967296;
};
const shuffle = <T>(items: T[], random: () => number) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
export function generateSectionQuestion(
  record: LearningRecord,
  association: Association,
  sectionRecords: LearningRecord[],
  roadGeoJSON: any,
  seed = "default",
): SectionQuestion {
  const aliasMap = new Map<string, string[]>(
    (roadGeoJSON.features as RoadFeature[]).map((feature) => [
      feature.properties.road_link_id,
      feature.properties.names || [],
    ]),
  );
  const uniqueFeatures = (candidate: LearningRecord) => {
    const features: LearningRecord["features"] = [],
      identities: Set<string>[] = [];
    for (const feature of answerFeatures(candidate)) {
      const identity = featureAliases(feature, aliasMap);
      if (identities.some((existing) => overlaps([existing], [identity])))
        continue;
      features.push(feature);
      identities.push(identity);
    }
    return features;
  };
  const allCorrectFeatures = uniqueFeatures(record),
    correctFeatures = association.scope === "street"
      ? answerFeatures(record).filter((feature) => feature.index === association.feature_index)
      : allCorrectFeatures,
    correctAliases = roadAliases(record, aliasMap),
    promptAliases = new Set([
      record.exam_name,
      ...record.features
        .filter((feature) => ["middle_road", "place"].includes(feature.role))
        .flatMap((feature) => [feature.exam_name, feature.map_name]),
    ].filter(Boolean).map(normaliseRoadName)),
    origin = centre(record),
    random = seeded(`${seed}:${association.id}`);
  const direction = association.kind as SectionQuestion["direction"];
  if (association.scope === "street" && correctFeatures.length !== 1)
    throw new Error(`Atomic street association ${association.id} has no unique target feature`);
  const streetOrder = (candidate: LearningRecord) =>
    shuffle(
      uniqueFeatures(candidate).map((feature) => feature.exam_name),
      seeded(`${seed}:${association.id}:${candidate.id}:street-order`),
    );
  const ranked = sectionRecords
    .filter(
      (candidate) =>
        candidate.id !== record.id &&
        !overlaps(correctAliases, roadAliases(candidate, aliasMap)),
    )
    .map((candidate) => {
      const proximity = distance(origin, centre(candidate));
      const fuzzy = editDistance(
        normaliseRoadName(record.exam_name),
        normaliseRoadName(candidate.exam_name),
      );
      return {
        candidate,
        aliases: roadAliases(candidate, aliasMap),
        score: proximity + fuzzy * 180 + random() * 25,
      };
    })
    .sort((a, b) => a.score - b.score);
  const streets = association.scope === "street"
    ? correctFeatures.map((feature) => feature.exam_name)
    : streetOrder(record);
  if (direction === "category_to_streets") {
    if (correctFeatures.length > 8)
      throw new Error(`More than eight correct streets for ${record.id}`);
    const correctOptions = correctFeatures.map((feature) => ({
      id: `${record.id}:feature:${feature.index}`,
      label: feature.exam_name,
    }));
    const distractors: QuestionOption[] = [],
      distractorAliases: Set<string>[] = [],
      distractorPools = ranked.map((item) => ({
        candidate: item.candidate,
        features: shuffle(
          uniqueFeatures(item.candidate),
          seeded(`${seed}:${association.id}:${item.candidate.id}:distractors`),
        ),
      }));
    // Take at most one street from each alternative record per pass. This
    // prevents a learner eliminating one known record and receiving several
    // other options for free. Later passes only fill any remaining spaces.
    const maximumPoolSize = Math.max(0, ...distractorPools.map((pool) => pool.features.length));
    for (let pass = 0; pass < maximumPoolSize && correctOptions.length + distractors.length < 8; pass += 1) {
      for (const pool of distractorPools) {
        const feature = pool.features[pass];
        if (!feature) continue;
        const aliases = featureAliases(feature, aliasMap);
        if (
          correctAliases.some((correct) => overlaps([correct], [aliases])) ||
          overlaps([promptAliases], [aliases]) ||
          distractorAliases.some((existing) => overlaps([existing], [aliases]))
        )
          continue;
        distractors.push({
          id: `${pool.candidate.id}:feature:${feature.index}`,
          label: feature.exam_name,
        });
        distractorAliases.push(aliases);
        if (correctOptions.length + distractors.length === 8) break;
      }
    }
    if (correctOptions.length + distractors.length !== 8)
      throw new Error(`Not enough unique street distractors for ${record.id}`);
    return {
      id: `question:${association.id}`,
      association_id: association.id,
      record_id: record.id,
      direction,
      prompt: record.exam_name,
      street_names: streets,
      options: shuffle([...correctOptions, ...distractors], random),
      answer_option_ids: correctOptions.map((option) => option.id),
      selection_mode: correctOptions.length > 1 ? "multiple" : "single",
    };
  }
  const candidates: LearningRecord[] = [],
    candidateAliases: Set<string>[][] = [],
    seenLabels = new Set([normaliseRoadName(record.exam_name)]);
  for (const item of ranked) {
    const candidateLabel = normaliseRoadName(item.candidate.exam_name);
    if (
      seenLabels.has(candidateLabel) ||
      candidateAliases.some((existing) => overlaps(existing, item.aliases))
    )
      continue;
    candidates.push(item.candidate);
    candidateAliases.push(item.aliases);
    seenLabels.add(candidateLabel);
    if (candidates.length === 3) break;
  }
  if (candidates.length < 3)
    throw new Error(`Not enough unique category distractors for ${record.id}`);
  const records = shuffle([record, ...candidates], random);
  return {
    id: `question:${association.id}`,
    association_id: association.id,
    record_id: record.id,
    direction,
    prompt:
      direction === "streets_to_category"
        ? streets.join(" · ")
        : record.exam_name,
    street_names: streets,
    options: records.map((candidate) => ({
      id: candidate.id,
      label: candidate.exam_name,
    })),
    answer_option_ids: [record.id],
    selection_mode: "single",
  };
}
export const getAnswerFeatures = answerFeatures;
export const isExactAnswer = (selectedOptionIds: string[], answerOptionIds: string[]) =>
  selectedOptionIds.length === answerOptionIds.length &&
  answerOptionIds.every((id) => selectedOptionIds.includes(id));

export type DistractorExplanation = {
  optionId: string;
  selectedLabel: string;
  belongsTo: string;
  associatedAnswers: string[];
};

/** Teaching feedback for selected wrong options. Uses the option's source ID,
 * never a name guess, so similarly named streets cannot be misattributed. */
export function explainSelectedDistractors(
  question: SectionQuestion,
  selectedOptionIds: string[],
  records: LearningRecord[],
): DistractorExplanation[] {
  const wrongIds = selectedOptionIds.filter((id) => !question.answer_option_ids.includes(id));
  return wrongIds.flatMap((optionId) => {
    const option = question.options.find((candidate) => candidate.id === optionId);
    if (!option) return [];
    const owner = question.direction === "streets_to_category"
      ? records.find((candidate) => candidate.id === optionId)
      : records.find((candidate) =>
        candidate.features.some((feature) => `${candidate.id}:feature:${feature.index}` === optionId),
      );
    if (!owner) return [];
    return [{
      optionId,
      selectedLabel: option.label,
      belongsTo: owner.exam_name,
      associatedAnswers: answerFeatures(owner).map((feature) => feature.exam_name),
    }];
  });
}
