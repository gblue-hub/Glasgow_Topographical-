import { recordCoordinate } from "./geographic-knowledge";
import type { LearningRecord } from "./types";

const CITY_CENTRE: [number, number] = [-4.2518, 55.8642];

const squaredDistance = (
  left: [number, number],
  right: [number, number],
) => {
  const longitudeScale = Math.cos(((left[1] + right[1]) / 2) * Math.PI / 180);
  const longitude = (left[0] - right[0]) * longitudeScale;
  const latitude = left[1] - right[1];
  return longitude * longitude + latitude * latitude;
};

/**
 * Produces a stable learning route: begin near the city centre, then choose
 * the nearest remaining record. Unmapped records stay available at the end.
 */
export function orderRecordsGeographically(records: LearningRecord[]) {
  const remaining = records
    .map((record) => ({ record, coordinate: recordCoordinate(record) }))
    .filter(
      (item): item is { record: LearningRecord; coordinate: [number, number] } =>
        item.coordinate !== null,
    );
  const unmapped = records
    .filter((record) => !recordCoordinate(record))
    .sort((left, right) => left.exam_name.localeCompare(right.exam_name, "en-GB"));
  const ordered: LearningRecord[] = [];
  let current = CITY_CENTRE;

  while (remaining.length) {
    remaining.sort(
      (left, right) =>
        squaredDistance(current, left.coordinate) -
          squaredDistance(current, right.coordinate) ||
        left.record.exam_name.localeCompare(right.record.exam_name, "en-GB"),
    );
    const next = remaining.shift()!;
    ordered.push(next.record);
    current = next.coordinate;
  }

  return [...ordered, ...unmapped];
}
