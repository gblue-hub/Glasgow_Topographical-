import { getAnswerFeatures } from "./questions";
import { normaliseRoadName } from "./road-names";
import type {
  LearningRecord,
  RoadGeometryCollection,
  RoadGeometryFeature,
  TerritoryDefinition,
} from "./types";

export type LearningJourney = {
  id: string;
  kind: "district_run" | "road_run" | "local_run";
  title: string;
  reason: string;
  anchorName: string;
  anchorRecordId: string | null;
  recordIds: string[];
  destinationNames: string[];
  roadNames: string[];
  spineRoadNames: string[];
  roadLinkIds: string[];
};

const linkIds = (record: LearningRecord) =>
  [...new Set(getAnswerFeatures(record).flatMap((feature) => [
    feature.road_link_id,
    ...(feature.road_link_ids ?? []),
  ]).filter((id): id is string => Boolean(id)))];

const roadNames = (record: LearningRecord) =>
  [...new Map(getAnswerFeatures(record).flatMap((feature) => [
    feature.exam_name,
    feature.map_name,
  ]).filter(Boolean).map((name) => [normaliseRoadName(name), name])).values()];

const recordPoint = (record: LearningRecord) => {
  const points = getAnswerFeatures(record)
    .map((feature) => feature.effective_coordinates)
    .filter(Boolean);
  if (!points.length) return null;
  return points.reduce<[number, number]>(
    (total, point) => [
      total[0] + point[0] / points.length,
      total[1] + point[1] / points.length,
    ],
    [0, 0],
  );
};

const distanceMetres = (
  left: [number, number] | null,
  right: [number, number] | null,
) => {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const longitude =
    (left[0] - right[0]) *
    111_000 *
    Math.cos((((left[1] + right[1]) / 2) * Math.PI) / 180);
  const latitude = (left[1] - right[1]) * 111_000;
  return Math.hypot(longitude, latitude);
};

type RoadGraph = {
  features: Map<string, RoadGeometryFeature>;
  neighbours: Map<string, Set<string>>;
};

function buildRoadGraph(geometry?: RoadGeometryCollection): RoadGraph {
  const features = new Map<string, RoadGeometryFeature>();
  const linksByNode = new Map<string, string[]>();
  for (const feature of geometry?.features ?? []) {
    const id = feature.properties.road_link_id;
    features.set(id, feature);
    for (const node of [feature.properties.start_node, feature.properties.end_node])
      linksByNode.set(node, [...(linksByNode.get(node) ?? []), id]);
  }
  const neighbours = new Map<string, Set<string>>();
  for (const links of linksByNode.values())
    for (const link of links) {
      const values = neighbours.get(link) ?? new Set<string>();
      links.forEach((candidate) => candidate !== link && values.add(candidate));
      neighbours.set(link, values);
    }
  return { features, neighbours };
}

function reachableRoadChains(
  graph: RoadGraph,
  starts: string[],
  maximumLinks = 7,
) {
  const paths = new Map<string, string[]>();
  if (!starts.length) return paths;
  const queue = starts.map((id) => [id]);
  const visited = new Set(starts);
  starts.forEach((id) => paths.set(id, [id]));
  while (queue.length) {
    const path = queue.shift()!;
    const current = path.at(-1)!;
    if (path.length >= maximumLinks) continue;
    for (const next of graph.neighbours.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      const nextPath = [...path, next];
      paths.set(next, nextPath);
      queue.push(nextPath);
    }
  }
  return paths;
}

const anchorRank = (record: LearningRecord) =>
  record.type === "middle_road" ? 0 : record.type === "district" ? 1 : 2;

function chooseAnchor(
  target: LearningRecord,
  anchors: LearningRecord[],
  graph: RoadGraph,
) {
  const targetLinks = linkIds(target);
  const targetPoint = recordPoint(target);
  const reachable = reachableRoadChains(graph, targetLinks);
  return anchors
    .map((anchor) => {
      const chain = linkIds(anchor)
        .map((id) => reachable.get(id) ?? [])
        .filter((path) => path.length)
        .sort((left, right) => left.length - right.length)[0] ?? [];
      const distance = distanceMetres(targetPoint, recordPoint(anchor));
      return {
        anchor,
        chain,
        score:
          (chain.length ? chain.length * 1_000 : 20_000) +
          Math.min(distance, 20_000) +
          anchorRank(anchor),
      };
    })
    .filter((candidate) => candidate.chain.length || candidate.score < 22_500)
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.anchor.exam_name.localeCompare(right.anchor.exam_name, "en-GB"),
    )[0] ?? null;
}

const categoryLabel = (record: LearningRecord) =>
  record.section.name
    .replaceAll("_", " ")
    .replace(/[./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-GB");

function destinationLabel(records: LearningRecord[]) {
  if (records.length === 1) return records[0].exam_name;
  const categories = [...new Set(records.map(categoryLabel))];
  if (categories.some((category) => category.includes("shop")))
    return "shops and nearby places";
  if (categories.length === 1) return categories[0];
  return "local destinations";
}

/**
 * Turns a set of curriculum records into small, explainable taxi journeys.
 * Road-link topology is preferred; coordinates are only a fallback when a
 * referenced road chain is unavailable.
 */
export function buildLearningJourneys(
  records: LearningRecord[],
  selectedRecordIds: ReadonlySet<string>,
  geometry?: RoadGeometryCollection,
  territories: TerritoryDefinition[] = [],
): LearningJourney[] {
  const selected = records.filter((record) => selectedRecordIds.has(record.id));
  if (!selected.length) return [];
  const graph = buildRoadGraph(geometry);
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const territoryByDistrict = new Map(
    territories.map((territory) => [territory.district_record_id, territory]),
  );
  const allAnchors = records.filter((record) => record.type !== "place");
  const selectedAnchors = selected.filter((record) => record.type !== "place");
  const assignments = new Map<
    string,
    { anchor: LearningRecord | null; records: LearningRecord[]; chains: string[][] }
  >();

  for (const record of selected) {
    const anchorChoice =
      record.type !== "place"
        ? { anchor: record, chain: linkIds(record) }
        : chooseAnchor(
            record,
            selectedAnchors.length ? selectedAnchors : allAnchors,
            graph,
          );
    const anchor = anchorChoice?.anchor ?? null;
    const fallbackRoad = linkIds(record)[0] ?? normaliseRoadName(roadNames(record)[0] ?? record.id);
    const key = anchor?.id ?? `road:${fallbackRoad}`;
    const group = assignments.get(key) ?? { anchor, records: [], chains: [] };
    group.records.push(record);
    if (anchorChoice?.chain.length) group.chains.push(anchorChoice.chain);
    assignments.set(key, group);
  }

  return [...assignments.entries()].map(([key, group]) => {
    const destinations = group.records.filter(
      (record) => record.id !== group.anchor?.id || record.type === "place",
    );
    const learningStops = destinations.length ? destinations : group.records;
    const routeLinks = [...new Set(group.chains.flat())];
    const mappedNames = routeLinks.flatMap(
      (id) => graph.features.get(id)?.properties.names ?? [],
    );
    const namedRoads = [
      ...new Map(
        [...mappedNames, ...group.records.flatMap(roadNames)]
          .filter(Boolean)
          .map((name) => [normaliseRoadName(name), name]),
      ).values(),
    ].slice(0, 4);
    const spineIdentities = new Map(
      records
        .filter((record) => record.type === "middle_road")
        .flatMap((record) => {
          const feature = record.features.find((item) => item.role === "middle_road");
          const canonical = feature?.exam_name ?? record.exam_name;
          return [record.exam_name, feature?.exam_name, feature?.map_name]
            .filter((name): name is string => Boolean(name))
            .map((name) => [normaliseRoadName(name), canonical] as const);
        }),
    );
    const mappedSpines = namedRoads.flatMap((name) => {
      const identity = normaliseRoadName(name);
      const match = spineIdentities.get(identity) ?? [...spineIdentities].find(
        ([candidate]) => candidate.length >= 5 && identity.length >= 5 &&
          (candidate.includes(identity) || identity.includes(candidate)),
      )?.[1];
      return match ? [match] : [];
    });
    const territorySpines = (group.anchor
      ? territoryByDistrict.get(group.anchor.id)?.approach_record_ids ?? []
      : [])
      .map((id) => recordsById.get(id))
      .filter((record): record is LearningRecord => record?.type === "middle_road")
      .map((record) => record.features.find((feature) => feature.role === "middle_road")?.exam_name ?? record.exam_name)
      .slice(0, 2);
    const spineRoadNames = [...new Set([...mappedSpines, ...territorySpines])];
    const anchorName = group.anchor?.exam_name ?? namedRoads[0] ?? "the local road network";
    const kind: LearningJourney["kind"] = group.anchor?.type === "district"
      ? "district_run"
      : group.anchor?.type === "middle_road"
        ? "road_run"
        : "local_run";
    const destination = destinationLabel(learningStops);
    const destinationPoint = recordPoint(learningStops[0]);
    const outwardFromCentre = distanceMetres([-4.2518, 55.8642], destinationPoint) > 1_800;
    const corridor = namedRoads.length
      ? namedRoads.join(" → ")
      : "their mapped local streets";
    return {
      id: `learning-journey:${key}`,
      kind,
      title: outwardFromCentre && spineRoadNames.length
        ? `City centre → ${destination} via ${spineRoadNames[0]}`
        : `${anchorName} → ${destination}`,
      reason: outwardFromCentre && spineRoadNames.length
        ? `Work this as an outward fare: leave the city centre on ${spineRoadNames.join(" then ")}, cross the learned district connections, and finish on the destination approach. The spine is learned inside the job.`
        : `Learn these together because ${corridor} forms the mapped street chain between the anchor and the destinations. This makes one usable taxi run, not a list of unrelated facts.`,
      anchorName,
      anchorRecordId: group.anchor?.id ?? null,
      recordIds: group.records.map((record) => record.id),
      destinationNames: learningStops.map((record) => record.exam_name),
      roadNames: namedRoads,
      spineRoadNames,
      roadLinkIds: routeLinks,
    };
  });
}

export function journeyForRecord(
  journeys: LearningJourney[],
  recordId: string,
) {
  return journeys.find((journey) => journey.recordIds.includes(recordId)) ?? null;
}
