import { getAnswerFeatures } from "./questions";
import { normaliseRoadName } from "./road-names";
import { seededRandom } from "./session";
import type { LearningRecord, TerritoryDefinition, TerritoryStitch } from "./types";

export type TerritoryQuestionFamily =
  | "corridor_terminal"
  | "destination_approach"
  | "district_exit"
  | "stitch_entry"
  | "crossing_connection";

export type TerritoryQuestion = {
  id: string;
  family: TerritoryQuestionFamily;
  prompt: string;
  context: string;
  options: Array<{ id: string; label: string }>;
  answerId: string;
  explanation: string;
};

const shuffle = <T>(values: T[], random: () => number) => {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
};

const optionSet = (
  answer: string,
  candidates: string[],
  random: () => number,
) => {
  const seen = new Set([normaliseRoadName(answer)]);
  const distractors: string[] = [];
  for (const candidate of shuffle(candidates, random)) {
    const identity = normaliseRoadName(candidate);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    distractors.push(candidate);
    if (distractors.length === 3) break;
  }
  if (distractors.length < 3) return null;
  return shuffle([answer, ...distractors], random).map((label) => ({
    id: normaliseRoadName(label),
    label,
  }));
};

export function buildTerritoryQuestions(input: {
  territory: TerritoryDefinition;
  territories: TerritoryDefinition[];
  records: LearningRecord[];
  stitches?: TerritoryStitch[];
  seed: string;
}): TerritoryQuestion[] {
  const random = seededRandom(`${input.seed}:${input.territory.id}:dispatch`);
  const recordsById = new Map(input.records.map((record) => [record.id, record]));
  const output: TerritoryQuestion[] = [];
  const globalRoads = input.records.flatMap((record) =>
    getAnswerFeatures(record).map((feature) => feature.exam_name),
  );

  for (const stitch of (input.stitches ?? []).filter((candidate) =>
    input.territory.stitch_ids?.includes(candidate.id),
  )) {
    const otherId = stitch.territory_ids.find((id) => id !== input.territory.id);
    const other = input.territories.find((candidate) => candidate.id === otherId);
    const answer = stitch.entry_road_names[input.territory.id] ?? stitch.road_names[0];
    if (!other || !answer) continue;
    const candidates = [
      ...input.territory.stitch_road_names,
      ...other.stitch_road_names,
      ...input.territories
        .filter((candidate) => candidate.area === input.territory.area)
        .flatMap((candidate) => candidate.stitch_road_names ?? []),
    ];
    const options = optionSet(answer, candidates, random);
    if (!options) continue;
    const otherRoad = stitch.entry_road_names[other.id] ?? stitch.road_names.at(-1);
    output.push({
      id: `territory-question:stitch:${stitch.id}:${input.territory.id}`,
      family: "stitch_entry",
      prompt: `Which learned road takes you out of ${input.territory.name} on the stitch toward ${other.name}?`,
      context: `${input.territory.name} → ${other.name} · district seam`,
      options,
      answerId: normaliseRoadName(answer),
      explanation:
        answer === otherRoad
          ? `${answer} continues across the shared district seam.`
          : `${answer} is the ${input.territory.name} side of the stitch and hands over to ${otherRoad} entering ${other.name}.`,
    });
  }

  for (const roadId of input.territory.approach_record_ids) {
    const road = recordsById.get(roadId);
    if (!road || road.type !== "middle_road") continue;
    const terminals = getAnswerFeatures(road);
    if (terminals.length < 2) continue;
    const from = terminals[0].exam_name;
    const answer = terminals.at(-1)!.exam_name;
    const nearbyTerminals = input.territory.approach_record_ids
      .filter((id) => id !== roadId)
      .flatMap((id) => getAnswerFeatures(recordsById.get(id)!).map((feature) => feature.exam_name));
    const options = optionSet(answer, [...nearbyTerminals, ...globalRoads], random);
    if (!options) continue;
    output.push({
      id: `territory-question:corridor:${road.id}`,
      family: "corridor_terminal",
      prompt: `You join ${road.exam_name} from ${from}. Which street marks the far end of this connecting road?`,
      context: `${input.territory.name} · corridor decision`,
      options,
      answerId: normaliseRoadName(answer),
      explanation: `${road.exam_name} is recorded between ${from} and ${answer}.`,
    });
  }

  for (const placeId of input.territory.nearby_record_ids) {
    const place = recordsById.get(placeId);
    if (!place) continue;
    const approaches = getAnswerFeatures(place);
    const answer = approaches[0]?.exam_name;
    if (!answer) continue;
    const peerRoads = input.territory.nearby_record_ids
      .filter((id) => id !== placeId)
      .flatMap((id) => getAnswerFeatures(recordsById.get(id)!).map((feature) => feature.exam_name));
    const options = optionSet(answer, [...peerRoads, ...globalRoads], random);
    if (!options) continue;
    const crossing = place.section.name.includes("RIVER CROSSINGS");
    output.push({
      id: `territory-question:${crossing ? "crossing" : "approach"}:${place.id}`,
      family: crossing ? "crossing_connection" : "destination_approach",
      prompt: crossing
        ? `${place.exam_name} connects to ${answer} on one side. Which road is its other recorded connection?`
        : `Your fare finishes at ${place.exam_name}. Which learned street should you place for the final approach?`,
      context: `${input.territory.name} · ${crossing ? "barrier crossing" : place.section.name.toLocaleLowerCase("en-GB").replaceAll("_", " ")}`,
      options: crossing && approaches[1]
        ? optionSet(approaches[1].exam_name, [...peerRoads, ...globalRoads], random) ?? options
        : options,
      answerId: normaliseRoadName(crossing && approaches[1] ? approaches[1].exam_name : answer),
      explanation: crossing && approaches[1]
        ? `${place.exam_name} is recorded between ${answer} and ${approaches[1].exam_name}.`
        : `${place.exam_name} is associated with ${approaches.map((feature) => feature.exam_name).join(" and ")}.`,
    });
  }

  const neighbour = input.territories.find((candidate) =>
    input.territory.neighbouring_territory_ids.includes(candidate.id),
  );
  const exit = input.territory.associated_road_names[0];
  if (neighbour && exit) {
    const distractors = [
      ...neighbour.associated_road_names,
      ...input.territories
        .filter((candidate) => candidate.area === input.territory.area)
        .flatMap((candidate) => candidate.associated_road_names),
    ];
    const options = optionSet(exit, distractors, random);
    if (options)
      output.push({
        id: `territory-question:exit:${input.territory.id}:${neighbour.id}`,
        family: "district_exit",
        prompt: `A run leaves ${input.territory.name} toward ${neighbour.name}. Which option is one of ${input.territory.name}'s defining streets?`,
        context: "District-to-district dispatch",
        options,
        answerId: normaliseRoadName(exit),
        explanation: `${exit} is attached to ${input.territory.name}; the other options belong to nearby territories.`,
      });
  }
  return output;
}

export function selectTerritoryQuestion(
  questions: TerritoryQuestion[],
  seed: string,
) {
  if (!questions.length) return null;
  const random = seededRandom(`${seed}:territory-question-selection`);
  return questions[Math.floor(random() * questions.length)];
}
