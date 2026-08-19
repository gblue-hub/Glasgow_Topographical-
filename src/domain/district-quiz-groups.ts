import { buildCorridorCurriculum } from "./corridor-curriculum";
import { knowledgeAreaLabels, type NewsArea } from "./geographic-knowledge";
import type {
  Association,
  LearningRecord,
  TerritoryDefinition,
  TerritoryStitch,
} from "./types";

export type DistrictQuizGroup = {
  id: string;
  label: string;
  area: NewsArea;
  areaLabel: string;
  recordIds: string[];
  recordCount: number;
  categoryCount: number;
  directionTotals: Record<Association["direction"], number>;
};

export function requiredAssociationsForDistrict(
  group: DistrictQuizGroup,
  associations: Association[],
  direction: Association["direction"],
) {
  const byRecord = new Map<string, Association[]>();
  for (const association of associations) {
    if (
      !association.required ||
      association.scope !== "record_set" ||
      association.direction !== direction
    ) continue;
    byRecord.set(association.record_id, [
      ...(byRecord.get(association.record_id) ?? []),
      association,
    ]);
  }
  return group.recordIds.flatMap((recordId) => byRecord.get(recordId) ?? []);
}

export function buildDistrictQuizGroups(
  records: LearningRecord[],
  associations: Association[],
  territories: TerritoryDefinition[],
  stitches: TerritoryStitch[],
): DistrictQuizGroup[] {
  if (!records.length || !territories.length) return [];
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const associationsByRecord = new Map<string, Association[]>();
  for (const association of associations) {
    if (!association.required || association.scope !== "record_set") continue;
    associationsByRecord.set(association.record_id, [
      ...(associationsByRecord.get(association.record_id) ?? []),
      association,
    ]);
  }

  return buildCorridorCurriculum(records, territories, stitches).corridors
    .flatMap((corridor) =>
      corridor.stages.flatMap((stage): DistrictQuizGroup[] => {
        if (stage.kind !== "district" || !stage.territoryId) return [];
        const required = stage.recordIds.flatMap(
          (recordId) => associationsByRecord.get(recordId) ?? [],
        );
        return [{
          id: stage.territoryId,
          label: stage.name,
          area: stage.area,
          areaLabel: knowledgeAreaLabels[stage.area],
          recordIds: stage.recordIds,
          recordCount: stage.recordIds.length,
          categoryCount: new Set(
            stage.recordIds
              .map((recordId) => recordsById.get(recordId)?.section.code)
              .filter((code): code is string => Boolean(code)),
          ).size,
          directionTotals: {
            forward: required.filter(
              (association) => association.direction === "forward",
            ).length,
            reverse: required.filter(
              (association) => association.direction === "reverse",
            ).length,
          },
        }];
      }),
    );
}
