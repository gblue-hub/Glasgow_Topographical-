import { buildGeographicCurriculum } from "./geographic-curriculum";
import type { LearningRecord, PersonalPlace, TerritoryDefinition } from "./types";

export type HomeBaseCurriculum = {
  homeBase: PersonalPlace;
  homeTerritoryId: string;
  homeArea: TerritoryDefinition["area"];
  frontierTerritoryIds: string[];
  orderedRecordIds: string[];
};

const pointInPolygon = (point: [number, number], polygon: [number, number][]) => {
  let inside = false;
  for (let left = 0, right = polygon.length - 1; left < polygon.length; right = left++) {
    const a = polygon[left], b = polygon[right];
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / ((b[1] - a[1]) || Number.EPSILON) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
};

const distanceSquared = (left: [number, number], right: [number, number]) =>
  (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2;

export function buildHomeBaseCurriculum(
  records: LearningRecord[],
  territories: TerritoryDefinition[],
  personalPlaces: PersonalPlace[],
): HomeBaseCurriculum | null {
  const homeBase = personalPlaces.find((place) => place.is_home_base);
  if (!homeBase || !territories.length) return null;
  const homeTerritory = territories.find((territory) => pointInPolygon(homeBase.coordinate, territory.polygon)) ??
    [...territories].sort((left, right) =>
      distanceSquared(left.centre, homeBase.coordinate) - distanceSquared(right.centre, homeBase.coordinate) ||
      left.id.localeCompare(right.id),
    )[0];
  if (!homeTerritory) return null;
  const territoryById = new Map(territories.map((territory) => [territory.id, territory]));
  const frontier: string[] = [];
  const queue = [homeTerritory.id];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift()!;
    const territory = territoryById.get(id);
    if (!territory || territory.area !== homeTerritory.area) continue;
    frontier.push(id);
    const neighbours = territory.neighbouring_territory_ids
      .map((neighbourId) => territoryById.get(neighbourId))
      .filter((candidate): candidate is TerritoryDefinition => candidate?.area === homeTerritory.area)
      .sort((left, right) =>
        distanceSquared(left.centre, homeBase.coordinate) - distanceSquared(right.centre, homeBase.coordinate) ||
        left.id.localeCompare(right.id),
      );
    for (const neighbour of neighbours) if (!seen.has(neighbour.id)) {
      seen.add(neighbour.id);
      queue.push(neighbour.id);
    }
  }
  const ordered: string[] = [];
  const add = (id: string) => { if (!ordered.includes(id)) ordered.push(id); };
  for (const id of frontier) {
    const territory = territoryById.get(id)!;
    add(territory.district_record_id);
    territory.approach_record_ids.forEach(add);
    territory.nearby_record_ids.forEach(add);
  }
  const areaCurriculum = buildGeographicCurriculum(records).find((area) => area.area === homeTerritory.area);
  areaCurriculum?.orderedRecordIds.forEach(add);
  return {
    homeBase,
    homeTerritoryId: homeTerritory.id,
    homeArea: homeTerritory.area,
    frontierTerritoryIds: frontier,
    orderedRecordIds: ordered,
  };
}
