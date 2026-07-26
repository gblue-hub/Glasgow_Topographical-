import {
  KNOWLEDGE_AREAS,
  classifyRecordAreas,
  knowledgeAreaLabels,
  primaryKnowledgeArea,
  recordCoordinate,
  type KnowledgeArea,
} from "./geographic-knowledge";
import type { Association, LearningRecord } from "./types";

export type AreaQuizGroup = {
  id: KnowledgeArea;
  label: string;
  recordIds: string[];
  recordCount: number;
  directionTotals: Record<Association["direction"], number>;
};

function recordIdsForArea(
  records: LearningRecord[],
  area: KnowledgeArea,
) {
  const classifiedAreas = classifyRecordAreas(records);
  return records.flatMap((record) => {
    const coordinate = recordCoordinate(record);
    if (!coordinate) return [];
    return primaryKnowledgeArea(record, classifiedAreas) === area
      ? [record.id]
      : [];
  });
}

export function requiredAssociationsForArea(
  records: LearningRecord[],
  associations: Association[],
  area: KnowledgeArea,
  direction?: Association["direction"],
) {
  const recordIds = new Set(recordIdsForArea(records, area));
  return associations.filter(
    (association) =>
      recordIds.has(association.record_id) &&
      association.required &&
      association.scope === "record_set" &&
      (!direction || association.direction === direction),
  );
}

export function buildAreaQuizGroups(
  records: LearningRecord[],
  associations: Association[],
): AreaQuizGroup[] {
  return KNOWLEDGE_AREAS.map((area) => {
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
      label: knowledgeAreaLabels[area],
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
