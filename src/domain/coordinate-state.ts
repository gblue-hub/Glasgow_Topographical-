import type { LearningRecord } from "./types";

export function withUpdatedCoordinate(
  record: LearningRecord,
  targetRecordId: string,
  featureIndex: number,
  coordinates: [number, number],
): LearningRecord {
  if (record.id !== targetRecordId) return record;
  return {
    ...record,
    features: record.features.map((feature) =>
      feature.index === featureIndex
        ? {
            ...feature,
            original_coordinates: coordinates,
            effective_coordinates: coordinates,
          }
        : feature,
    ),
  };
}
