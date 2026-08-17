import { normaliseRoadName } from "./road-names";
import type { LearningRecord } from "./types";

export type RelatedStreetAssociation = {
  record: LearningRecord;
  sharedStreetNames: string[];
  sameStreetSet: boolean;
};

export type StreetAssociationContext = {
  streetNames: string[];
  related: RelatedStreetAssociation[];
};

export type StreetAssociationIndex = {
  connectionsFor(recordId: string): StreetAssociationContext;
};

const roadRoles = new Set([
  "associated_road",
  "terminal_road",
  "middle_road",
  "district_associated_road",
]);

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left.size === right.size && [...left].every((item) => right.has(item));

/**
 * Indexes records by comparison-form road name. Feature order is deliberately
 * ignored, and names in a nominally non-road slot are admitted when the road
 * geometry or another published road feature confirms that they are roads.
 */
export function buildStreetAssociationIndex(
  records: LearningRecord[],
  roadAliases: Iterable<string> = [],
): StreetAssociationIndex {
  const knownRoads = new Set(
    [...roadAliases].map(normaliseRoadName).filter(Boolean),
  );
  for (const record of records)
    for (const feature of record.features)
      if (roadRoles.has(feature.role)) {
        knownRoads.add(normaliseRoadName(feature.exam_name));
        if (feature.map_name)
          knownRoads.add(normaliseRoadName(feature.map_name));
      }

  const roadsByRecord = new Map<string, Map<string, string>>();
  const recordsByRoad = new Map<string, Set<string>>();
  for (const record of records) {
    const roads = new Map<string, string>();
    const candidates = [
      { examName: record.exam_name, mapName: record.exam_name, confirmed: false },
      ...record.features.map((feature) => ({
        examName: feature.exam_name,
        mapName: feature.map_name,
        confirmed: roadRoles.has(feature.role),
      })),
    ];
    for (const candidate of candidates) {
      const identities = [candidate.examName, candidate.mapName]
        .filter(Boolean)
        .map(normaliseRoadName)
        .filter(Boolean);
      if (!candidate.confirmed && !identities.some((name) => knownRoads.has(name)))
        continue;
      const identity = identities.find((name) => knownRoads.has(name));
      if (!identity || roads.has(identity)) continue;
      roads.set(identity, candidate.examName);
      const owners = recordsByRoad.get(identity) ?? new Set<string>();
      owners.add(record.id);
      recordsByRoad.set(identity, owners);
    }
    roadsByRecord.set(record.id, roads);
  }

  const recordsById = new Map(records.map((record) => [record.id, record]));
  return {
    connectionsFor(recordId) {
      const roads = roadsByRecord.get(recordId) ?? new Map<string, string>();
      const relatedIds = new Set<string>();
      for (const identity of roads.keys())
        for (const ownerId of recordsByRoad.get(identity) ?? [])
          if (ownerId !== recordId) relatedIds.add(ownerId);
      const currentSet = new Set(roads.keys());
      const related = [...relatedIds].flatMap((id) => {
        const record = recordsById.get(id);
        if (!record) return [];
        const otherRoads = roadsByRecord.get(id) ?? new Map<string, string>();
        const sharedStreetNames = [...currentSet]
          .filter((identity) => otherRoads.has(identity))
          .map((identity) => roads.get(identity)!)
          .sort((left, right) => left.localeCompare(right, "en-GB"));
        return [{
          record,
          sharedStreetNames,
          sameStreetSet: currentSet.size > 0 && sameSet(currentSet, new Set(otherRoads.keys())),
        }];
      }).sort((left, right) =>
        Number(right.sameStreetSet) - Number(left.sameStreetSet) ||
        right.sharedStreetNames.length - left.sharedStreetNames.length ||
        left.record.exam_name.localeCompare(right.record.exam_name, "en-GB"),
      );
      return { streetNames: [...roads.values()], related };
    },
  };
}
