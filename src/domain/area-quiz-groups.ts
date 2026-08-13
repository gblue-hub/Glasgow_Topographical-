import {
  GEOGRAPHIC_SCOPES,
  classifyRecordAreas,
  geographicScopeLabels,
  recordMatchesGeographicScope,
  type GeographicScope,
} from "./geographic-knowledge";
import type { Association, LearningRecord } from "./types";
import { orderRecordsGeographically } from "./geographic-order";

export type AreaQuizGroup = {
  id: GeographicScope;
  label: string;
  recordIds: string[];
  recordCount: number;
  directionTotals: Record<Association["direction"], number>;
};

function recordIdsForArea(
  records: LearningRecord[],
  area: GeographicScope,
) {
  const classifiedAreas = classifyRecordAreas(records);
  return orderRecordsGeographically(records).flatMap((record) => {
    return recordMatchesGeographicScope(record, area, classifiedAreas)
      ? [record.id]
      : [];
  });
}

export function requiredAssociationsForArea(
  records: LearningRecord[],
  associations: Association[],
  area: GeographicScope,
  direction?: Association["direction"],
) {
  const orderedRecordIds = recordIdsForArea(records, area);
  const byRecord = new Map<string, Association[]>();
  for (const association of associations) {
    if (
      !association.required ||
      association.scope !== "record_set" ||
      (direction && association.direction !== direction)
    ) continue;
    byRecord.set(association.record_id, [
      ...(byRecord.get(association.record_id) ?? []),
      association,
    ]);
  }
  return orderedRecordIds.flatMap((recordId) => byRecord.get(recordId) ?? []);
}

export function buildAreaQuizGroups(
  records: LearningRecord[],
  associations: Association[],
): AreaQuizGroup[] {
  return GEOGRAPHIC_SCOPES.map((area) => {
    const recordIds = recordIdsForArea(records, area);
    const recordSet = new Set(recordIds);
    const required = associations.filter(
      (association) =>
        recordSet.has(association.record_id) &&
        association.required &&
        association.scope === "record_set",
    );
    return {
      id: area,
      label: geographicScopeLabels[area],
      recordIds,
      recordCount: recordIds.length,
      directionTotals: {
        forward: required.filter(
          (association) => association.direction === "forward",
        ).length,
        reverse: required.filter(
          (association) => association.direction === "reverse",
        ).length,
      },
    };
  });
}
