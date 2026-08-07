import { classifyRecordAreas, primaryKnowledgeArea, recordCoordinate } from "./geographic-knowledge";
import { getAnswerFeatures } from "./questions";
import { normaliseRoadName } from "./road-names";
import type { LearningRecord } from "./types";

export type StreetLandmark = {
  recordId: string;
  name: string;
  coordinate: [number, number];
};

export type StreetLandmarkSequence = {
  id: string;
  roadName: string;
  forwardHeading: "north" | "east";
  reverseHeading: "south" | "west";
  landmarks: StreetLandmark[];
};

/** Builds only evidence-backed drive-by runs: three or more mapped city-centre
 * places sharing the same learned road. The canonical direction is geographic,
 * so the same data always creates the same run and answer. */
export function buildStreetLandmarkSequences(records: LearningRecord[]) {
  const areas = classifyRecordAreas(records);
  const groups = new Map<string, { roadName: string; landmarks: Map<string, StreetLandmark> }>();
  for (const record of records) {
    if (record.type !== "place" || primaryKnowledgeArea(record, areas) !== "centre") continue;
    const coordinate = recordCoordinate(record);
    if (!coordinate) continue;
    for (const feature of getAnswerFeatures(record)) {
      const roadName = feature.exam_name.trim();
      const key = normaliseRoadName(roadName);
      if (!key) continue;
      const group = groups.get(key) ?? { roadName, landmarks: new Map() };
      group.landmarks.set(record.id, { recordId: record.id, name: record.exam_name, coordinate });
      groups.set(key, group);
    }
  }
  return [...groups.entries()].flatMap(([key, group]): StreetLandmarkSequence[] => {
    const landmarks = [...group.landmarks.values()];
    if (landmarks.length < 3) return [];
    const longitudes = landmarks.map((item) => item.coordinate[0]);
    const latitudes = landmarks.map((item) => item.coordinate[1]);
    const meanLatitude = latitudes.reduce((sum, value) => sum + value, 0) / latitudes.length;
    const longitudeRange = (Math.max(...longitudes) - Math.min(...longitudes)) * Math.cos(meanLatitude * Math.PI / 180);
    const latitudeRange = Math.max(...latitudes) - Math.min(...latitudes);
    const eastWest = longitudeRange >= latitudeRange;
    landmarks.sort((left, right) =>
      (eastWest ? left.coordinate[0] - right.coordinate[0] : left.coordinate[1] - right.coordinate[1]) ||
      left.name.localeCompare(right.name, "en-GB") || left.recordId.localeCompare(right.recordId),
    );
    return [{
      id: `street-sequence:${key}`,
      roadName: group.roadName,
      forwardHeading: eastWest ? "east" : "north",
      reverseHeading: eastWest ? "west" : "south",
      landmarks,
    }];
  }).sort((left, right) => left.roadName.localeCompare(right.roadName, "en-GB"));
}

export function streetSequenceForRecord(
  sequences: StreetLandmarkSequence[],
  recordId: string,
) {
  return sequences.find((sequence) => sequence.landmarks.some((item) => item.recordId === recordId)) ?? null;
}
