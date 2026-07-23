import type {
  LearningRecord,
  RoadGeometryCollection,
  RoadLink,
  RoadTopology,
} from "./types";
import {
  buildDatasetRoadAtlas,
  geometryForLearningFeature,
  normaliseRoadName,
  type RoadAtlasEntry,
} from "./roads";

const DATASET_ROAD_ROLES = new Set([
  "associated_road",
  "terminal_road",
  "district_associated_road",
]);

const compareNames = (left: string, right: string) =>
  left.localeCompare(right, "en-GB", { sensitivity: "base", numeric: true });

/**
 * The original spine atlas deliberately admitted only roads shared by multiple
 * records. That made the page nearly empty for datasets where most mapped roads
 * currently occur once. Keep those shared-road entries, but also add every
 * other mapped road that is explicitly referenced by the learning dataset.
 */
export function buildCompleteDatasetRoadAtlas(
  records: LearningRecord[],
  topology: RoadTopology,
  geometry: RoadGeometryCollection,
): RoadAtlasEntry[] {
  const entries = new Map(
    buildDatasetRoadAtlas(records, topology, geometry).map((entry) => [
      normaliseRoadName(entry.name),
      entry,
    ]),
  );

  const grouped = new Map<
    string,
    {
      name: string;
      recordIds: Set<string>;
      features: LearningRecord["features"];
    }
  >();

  for (const record of records) {
    for (const feature of record.features) {
      if (!DATASET_ROAD_ROLES.has(feature.role)) continue;
      const key = normaliseRoadName(feature.map_name || feature.exam_name);
      if (!key) continue;

      const group = grouped.get(key) ?? {
        name: feature.exam_name,
        recordIds: new Set<string>(),
        features: [],
      };
      group.recordIds.add(record.id);
      group.features.push(feature);
      grouped.set(key, group);
    }
  }

  const linksById = new Map(topology.links.map((link) => [link.id, link]));

  for (const [key, group] of grouped) {
    if (entries.has(key)) continue;

    const linkIds = new Set<string>();
    for (const feature of group.features) {
      for (const roadFeature of geometryForLearningFeature(geometry, feature).features) {
        linkIds.add(roadFeature.properties.road_link_id);
      }
    }

    const links = [...linkIds]
      .map((id) => linksById.get(id))
      .filter((link): link is RoadLink => Boolean(link));
    if (!links.length) continue;

    entries.set(key, {
      name: group.name,
      linkIds: links.map((link) => link.id).sort(),
      lengthMetres: Math.round(
        links.reduce((sum, link) => sum + link.length_metres, 0),
      ),
      roadFunctions: [...new Set(links.map((link) => link.road_function))].sort(
        compareNames,
      ),
      formsOfWay: [...new Set(links.map((link) => link.form_of_way))].sort(
        compareNames,
      ),
      connectionCount: group.recordIds.size,
    });
  }

  return [...entries.values()].sort((left, right) =>
    compareNames(left.name, right.name),
  );
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function tokenMatches(queryToken: string, roadToken: string) {
  if (
    roadToken.includes(queryToken) ||
    (queryToken.length >= 4 && queryToken.includes(roadToken))
  ) {
    return true;
  }

  if (Math.min(queryToken.length, roadToken.length) < 4) return false;
  const allowedDistance = Math.max(queryToken.length, roadToken.length) >= 8 ? 2 : 1;
  return editDistance(queryToken, roadToken) <= allowedDistance;
}

/** Exact and partial matching remain first-class, with small spelling mistakes tolerated. */
export function filterCompleteDatasetRoadAtlas(
  entries: RoadAtlasEntry[],
  query: string,
) {
  const needle = normaliseRoadName(query);
  if (!needle) return entries;

  const queryTokens = needle.split(" ");
  return entries.filter((entry) => {
    const roadName = normaliseRoadName(entry.name);
    if (roadName.includes(needle)) return true;

    const roadTokens = roadName.split(" ");
    return queryTokens.every((queryToken) =>
      roadTokens.some((roadToken) => tokenMatches(queryToken, roadToken)),
    );
  });
}
