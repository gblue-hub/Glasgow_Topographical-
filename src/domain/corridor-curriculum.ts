import {
  classifyRecordAreas,
  primaryKnowledgeArea,
  recordCoordinate,
  type Coordinate,
  type NewsArea,
} from "./geographic-knowledge";
import { normaliseRoadName } from "./road-names";
import type {
  LearningRecord,
  TerritoryDefinition,
  TerritoryStitch,
} from "./types";

const CITY_CENTRE: Coordinate = [-4.2518, 55.8642];

export type CorridorStage = {
  id: string;
  area: NewsArea;
  kind: "centre_gateway" | "district";
  name: string;
  territoryId: string | null;
  previousStageId: string | null;
  incomingKind: "centre" | "main_road" | "stitch_road";
  incomingRoadNames: string[];
  incomingRoadRecordIds: string[];
  recordIds: string[];
};

export type LearningCorridor = {
  area: NewsArea;
  stages: CorridorStage[];
  recordIds: string[];
};

export type CorridorCurriculum = {
  corridors: LearningCorridor[];
  ownerByRecordId: Map<string, string>;
};

const curriculumCache = new WeakMap<
  LearningRecord[],
  WeakMap<
    TerritoryDefinition[],
    WeakMap<TerritoryStitch[], CorridorCurriculum>
  >
>();

const distanceSquared = (left: Coordinate, right: Coordinate) => {
  const latitude = ((left[1] + right[1]) / 2) * (Math.PI / 180);
  const longitudeDelta = (left[0] - right[0]) * Math.cos(latitude);
  return longitudeDelta ** 2 + (left[1] - right[1]) ** 2;
};

function pointInPolygon(point: Coordinate, polygon: Coordinate[]) {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const left = polygon[current];
    const right = polygon[previous];
    const crosses =
      left[1] > point[1] !== right[1] > point[1] &&
      point[0] <
        ((right[0] - left[0]) * (point[1] - left[1])) /
          (right[1] - left[1] || Number.EPSILON) +
          left[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function centreDirection(point: Coordinate, origin: Coordinate): NewsArea {
  const latitude = ((point[1] + origin[1]) / 2) * (Math.PI / 180);
  const eastWest = (point[0] - origin[0]) * Math.cos(latitude);
  const northSouth = point[1] - origin[1];
  if (Math.abs(eastWest) >= Math.abs(northSouth))
    return eastWest < 0 ? "west" : "east";
  return northSouth < 0 ? "south" : "north";
}

const recordLinks = (record: LearningRecord) =>
  new Set(
    record.features
      .flatMap((feature) => [
        feature.road_link_id,
        ...(feature.road_link_ids ?? []),
      ])
      .filter((id): id is string => Boolean(id)),
  );

const recordRoadNames = (record: LearningRecord) =>
  new Set(
    [
      record.type === "middle_road" ? record.exam_name : "",
      ...record.features.flatMap((feature) => [
        feature.exam_name,
        feature.map_name,
      ]),
    ]
      .map(normaliseRoadName)
      .filter(Boolean),
  );

function recordsForStitch(
  stitch: TerritoryStitch,
  records: LearningRecord[],
) {
  const links = new Set(stitch.road_link_ids);
  const names = new Set(stitch.road_names.map(normaliseRoadName));
  return records
    .filter((record) => record.type === "middle_road")
    .filter((record) => {
      const candidateLinks = recordLinks(record);
      const candidateNames = recordRoadNames(record);
      return (
        [...candidateLinks].some((id) => links.has(id)) ||
        [...candidateNames].some((name) => names.has(name))
      );
    })
    .map((record) => record.id);
}

function orderedTerritories(
  area: NewsArea,
  territories: TerritoryDefinition[],
  stitches: TerritoryStitch[],
) {
  const candidates = territories.filter((territory) => territory.area === area);
  if (!candidates.length) return [];
  const byId = new Map(candidates.map((territory) => [territory.id, territory]));
  const stitchByPair = new Map<string, TerritoryStitch>();
  for (const stitch of stitches) {
    const [left, right] = stitch.territory_ids;
    if (byId.has(left) && byId.has(right)) {
      stitchByPair.set(`${left}|${right}`, stitch);
      stitchByPair.set(`${right}|${left}`, stitch);
    }
  }
  const root = [...candidates].sort(
    (left, right) =>
      distanceSquared(left.centre, CITY_CENTRE) -
        distanceSquared(right.centre, CITY_CENTRE) ||
      left.name.localeCompare(right.name, "en-GB"),
  )[0];
  const output: Array<{
    territory: TerritoryDefinition;
    parent: TerritoryDefinition | null;
    stitch: TerritoryStitch | null;
  }> = [{ territory: root, parent: null, stitch: null }];
  const visited = new Set([root.id]);
  while (visited.size < candidates.length) {
    const frontier = [...visited].flatMap((parentId) => {
      const parent = byId.get(parentId)!;
      return parent.neighbouring_territory_ids.flatMap((candidateId) => {
        const territory = byId.get(candidateId);
        const stitch = stitchByPair.get(`${parentId}|${candidateId}`);
        return territory && stitch && !visited.has(candidateId)
          ? [{ territory, parent, stitch }]
          : [];
      });
    });
    const next = frontier.sort(
      (left, right) =>
        distanceSquared(left.territory.centre, CITY_CENTRE) -
          distanceSquared(right.territory.centre, CITY_CENTRE) ||
        distanceSquared(left.parent.centre, left.territory.centre) -
          distanceSquared(right.parent.centre, right.territory.centre) ||
        left.territory.name.localeCompare(right.territory.name, "en-GB"),
    )[0];
    if (next) {
      output.push(next);
      visited.add(next.territory.id);
      continue;
    }
    // The generated territory graph is expected to be connected. Retaining a
    // deterministic fallback makes the curriculum inspectable if bad content
    // reaches the browser; coverage tests still reject the missing stitch.
    const disconnected = candidates
      .filter((territory) => !visited.has(territory.id))
      .sort(
        (left, right) =>
          distanceSquared(left.centre, CITY_CENTRE) -
            distanceSquared(right.centre, CITY_CENTRE) ||
          left.name.localeCompare(right.name, "en-GB"),
      )[0];
    output.push({ territory: disconnected, parent: null, stitch: null });
    visited.add(disconnected.id);
  }
  return output;
}

function orderStageRecords(
  recordIds: string[],
  recordsById: ReadonlyMap<string, LearningRecord>,
  entryIds: ReadonlySet<string>,
) {
  const byName = (leftId: string, rightId: string) =>
    recordsById
      .get(leftId)!
      .exam_name.localeCompare(recordsById.get(rightId)!.exam_name, "en-GB") ||
    leftId.localeCompare(rightId);
  const entry = recordIds.filter((id) => entryIds.has(id)).sort(byName);
  const districts = recordIds
    .filter(
      (id) => !entryIds.has(id) && recordsById.get(id)?.type === "district",
    )
    .sort(byName);
  const groups = new Map<string, string[]>();
  for (const id of recordIds) {
    if (entryIds.has(id) || districts.includes(id)) continue;
    const record = recordsById.get(id)!;
    groups.set(record.section.code, [...(groups.get(record.section.code) ?? []), id]);
  }
  const orderedGroups = [...groups.entries()]
    .sort(([left], [right]) =>
      left.localeCompare(right, "en-GB", { numeric: true }),
    )
    .map(([, ids]) => ids.sort(byName));
  const interlaced: string[] = [];
  for (let position = 0; interlaced.length < recordIds.length - entry.length - districts.length; position += 1)
    for (const group of orderedGroups) {
      const id = group[position];
      if (id) interlaced.push(id);
    }
  return [...entry, ...districts, ...interlaced];
}

/**
 * Builds four exhaustive, centre-out learning corridors. Every source record
 * receives one owner stage. District stages form a connected traversal and
 * expose the named main/stitch road used to enter them.
 */
export function buildCorridorCurriculum(
  records: LearningRecord[],
  territories: TerritoryDefinition[],
  stitches: TerritoryStitch[],
): CorridorCurriculum {
  const cached = curriculumCache.get(records)?.get(territories)?.get(stitches);
  if (cached) return cached;
  const areas: NewsArea[] = ["north", "east", "south", "west"];
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const classified = classifyRecordAreas(records);
  const centrePoints = records.flatMap((record): Coordinate[] => {
    const point = recordCoordinate(record);
    return point && primaryKnowledgeArea(record, classified) === "centre"
      ? [point]
      : [];
  });
  const centreOrigin: Coordinate = centrePoints.length
    ? [
        centrePoints.reduce((sum, point) => sum + point[0], 0) /
          centrePoints.length,
        centrePoints.reduce((sum, point) => sum + point[1], 0) /
          centrePoints.length,
      ]
    : CITY_CENTRE;
  const orderedByArea = new Map(
    areas.map((area) => [area, orderedTerritories(area, territories, stitches)]),
  );
  const territoryByDistrict = new Map(
    territories.map((territory) => [territory.district_record_id, territory]),
  );
  const ownerTerritoryByRecord = new Map<string, TerritoryDefinition>();
  const centreAreaByRecord = new Map<string, NewsArea>();

  for (const record of records) {
    const point = recordCoordinate(record) ?? CITY_CENTRE;
    const primaryArea = primaryKnowledgeArea(record, classified);
    if (primaryArea === "centre" || !primaryArea) {
      centreAreaByRecord.set(record.id, centreDirection(point, centreOrigin));
      continue;
    }
    const exactDistrict = territoryByDistrict.get(record.id);
    if (exactDistrict) {
      ownerTerritoryByRecord.set(record.id, exactDistrict);
      continue;
    }
    const candidates = territories.filter(
      (territory) => territory.area === primaryArea,
    );
    const owner = candidates
      .map((territory) => {
        const approach = territory.approach_record_ids.includes(record.id);
        const nearby = territory.nearby_record_ids.includes(record.id);
        const contained = pointInPolygon(point, territory.polygon);
        return {
          territory,
          rank: approach ? 0 : nearby ? 1 : contained ? 2 : 3,
          distance: distanceSquared(point, territory.centre),
        };
      })
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          left.distance - right.distance ||
          left.territory.id.localeCompare(right.territory.id),
      )[0]?.territory;
    if (owner) ownerTerritoryByRecord.set(record.id, owner);
    else centreAreaByRecord.set(record.id, centreDirection(point, centreOrigin));
  }

  const ownerByRecordId = new Map<string, string>();
  const corridors = areas.map((area): LearningCorridor => {
    const centreId = `corridor:${area}:centre`;
    const centreRecordIds = orderStageRecords(records
      .filter((record) => centreAreaByRecord.get(record.id) === area)
      .map((record) => record.id), recordsById, new Set());
    centreRecordIds.forEach((id) => ownerByRecordId.set(id, centreId));
    const stages: CorridorStage[] = [
      {
        id: centreId,
        area,
        kind: "centre_gateway",
        name: `City Centre ${area[0].toUpperCase()}${area.slice(1)}`,
        territoryId: null,
        previousStageId: null,
        incomingKind: "centre",
        incomingRoadNames: [],
        incomingRoadRecordIds: [],
        recordIds: centreRecordIds,
      },
    ];
    for (const item of orderedByArea.get(area) ?? []) {
      const stageId = `corridor:${area}:${item.territory.id}`;
      const owned = records
        .filter(
          (record) =>
            ownerTerritoryByRecord.get(record.id)?.id === item.territory.id,
        )
        .map((record) => record.id);
      owned.forEach((id) => ownerByRecordId.set(id, stageId));
      const rootRoadIds = item.territory.approach_record_ids.filter((id) =>
        recordsById.has(id),
      );
      const stitchRoadIds = item.stitch
        ? recordsForStitch(item.stitch, records)
        : [];
      const incomingRoadRecordIds = item.stitch
        ? stitchRoadIds
        : rootRoadIds.slice(0, 1);
      const incomingRoadNames = item.stitch
        ? item.stitch.road_names
        : incomingRoadRecordIds.map(
            (id) => recordsById.get(id)?.exam_name ?? id,
          );
      const ownedEntryIds = new Set(
        incomingRoadRecordIds.filter((id) => owned.includes(id)),
      );
      const orderedOwned = orderStageRecords(owned, recordsById, ownedEntryIds);
      stages.push({
        id: stageId,
        area,
        kind: "district",
        name: item.territory.name,
        territoryId: item.territory.id,
        previousStageId:
          item.parent === null
            ? centreId
            : `corridor:${area}:${item.parent.id}`,
        incomingKind: item.stitch ? "stitch_road" : "main_road",
        incomingRoadNames,
        incomingRoadRecordIds,
        recordIds: orderedOwned,
      });
    }
    const order = new Map(
      stages.flatMap((stage, stageIndex) =>
        stage.recordIds.map((recordId, recordIndex) => [
          recordId,
          stageIndex * 100_000 + recordIndex,
        ] as const),
      ),
    );
    for (const stage of stages)
      stage.recordIds.sort(
        (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
      );
    return {
      area,
      stages,
      recordIds: stages.flatMap((stage) => stage.recordIds),
    };
  });

  const curriculum = { corridors, ownerByRecordId };
  const byTerritory =
    curriculumCache.get(records) ??
    new WeakMap<TerritoryDefinition[], WeakMap<TerritoryStitch[], CorridorCurriculum>>();
  const byStitches =
    byTerritory.get(territories) ??
    new WeakMap<TerritoryStitch[], CorridorCurriculum>();
  byStitches.set(stitches, curriculum);
  byTerritory.set(territories, byStitches);
  curriculumCache.set(records, byTerritory);
  return curriculum;
}
