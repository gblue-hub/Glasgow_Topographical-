import {
  KNOWLEDGE_AREAS,
  classifyRecordAreas,
  primaryKnowledgeArea,
  recordCoordinate,
  type Coordinate,
  type KnowledgeArea,
} from "./geographic-knowledge";
import { normaliseRoadName } from "./road-names";
import { compareSectionCodes } from "./sections";
import type { LearningFeature, LearningRecord } from "./types";

export type GeographicCurriculumArea = {
  area: KnowledgeArea;
  orderedRecordIds: string[];
  anchorRecordIds: string[];
};

const isAnchor = (record: LearningRecord) =>
  record.type === "district" || record.type === "middle_road";

const featureLinkIds = (feature: LearningFeature) =>
  [feature.road_link_id, ...(feature.road_link_ids ?? [])].filter(
    (id): id is string => Boolean(id),
  );

function roadIdentity(record: LearningRecord) {
  const linkIds = new Set(record.features.flatMap(featureLinkIds));
  const names = new Set(
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
  return { linkIds, names };
}

const intersectionSize = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  [...left].filter((value) => right.has(value)).length;

function squaredDistance(left: Coordinate | null, right: Coordinate | null) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const meanLatitude = ((left[1] + right[1]) / 2) * (Math.PI / 180);
  const longitude = (left[0] - right[0]) * Math.cos(meanLatitude);
  const latitude = left[1] - right[1];
  return longitude * longitude + latitude * latitude;
}

function recordOrder(left: LearningRecord, right: LearningRecord) {
  return (
    compareSectionCodes(left.section, right.section) ||
    left.exam_name.localeCompare(right.exam_name, "en-GB") ||
    left.id.localeCompare(right.id)
  );
}

function spatialAnchorOrder(anchors: LearningRecord[]) {
  if (anchors.length < 2) return [...anchors];
  const remaining = [...anchors].sort(recordOrder);
  const ordered = [remaining.shift()!];
  while (remaining.length) {
    const previous = ordered.at(-1)!;
    remaining.sort(
      (left, right) =>
        squaredDistance(recordCoordinate(previous), recordCoordinate(left)) -
          squaredDistance(recordCoordinate(previous), recordCoordinate(right)) ||
        recordOrder(left, right),
    );
    ordered.push(remaining.shift()!);
  }
  return ordered;
}

function roundRobinSections(records: LearningRecord[]) {
  const sections = new Map<string, LearningRecord[]>();
  for (const record of [...records].sort(recordOrder))
    sections.set(record.section.code, [
      ...(sections.get(record.section.code) ?? []),
      record,
    ]);
  const orderedSections = [...sections.entries()].sort(
    ([leftCode], [rightCode]) =>
      compareSectionCodes({ code: leftCode }, { code: rightCode }),
  );
  const output: LearningRecord[] = [];
  let position = 0;
  while (output.length < records.length) {
    for (const [, sectionRecords] of orderedSections) {
      const record = sectionRecords[position];
      if (record) output.push(record);
    }
    position += 1;
  }
  return output;
}

function attachmentAnchor(
  record: LearningRecord,
  anchors: LearningRecord[],
  identities: ReadonlyMap<string, ReturnType<typeof roadIdentity>>,
) {
  const recordIdentity = identities.get(record.id)!;
  return [...anchors].sort((left, right) => {
    const leftIdentity = identities.get(left.id)!;
    const rightIdentity = identities.get(right.id)!;
    const leftLinks = intersectionSize(
      recordIdentity.linkIds,
      leftIdentity.linkIds,
    );
    const rightLinks = intersectionSize(
      recordIdentity.linkIds,
      rightIdentity.linkIds,
    );
    const leftNames = intersectionSize(
      recordIdentity.names,
      leftIdentity.names,
    );
    const rightNames = intersectionSize(
      recordIdentity.names,
      rightIdentity.names,
    );
    return (
      rightLinks - leftLinks ||
      rightNames - leftNames ||
      squaredDistance(recordCoordinate(record), recordCoordinate(left)) -
        squaredDistance(recordCoordinate(record), recordCoordinate(right)) ||
      recordOrder(left, right)
    );
  })[0];
}

export function buildGeographicCurriculum(
  records: LearningRecord[],
): GeographicCurriculumArea[] {
  const classifiedAreas = classifyRecordAreas(records);
  const recordsByArea = new Map<KnowledgeArea, LearningRecord[]>(
    KNOWLEDGE_AREAS.map((area) => [area, []]),
  );
  for (const record of records) {
    const area = primaryKnowledgeArea(record, classifiedAreas);
    if (area) recordsByArea.get(area)!.push(record);
  }

  return KNOWLEDGE_AREAS.map((area) => {
    const areaRecords = recordsByArea.get(area) ?? [];
    const anchors = spatialAnchorOrder(areaRecords.filter(isAnchor));
    if (!anchors.length)
      return {
        area,
        orderedRecordIds: roundRobinSections(areaRecords).map(
          (record) => record.id,
        ),
        anchorRecordIds: [],
      };

    const identities = new Map(
      areaRecords.map((record) => [record.id, roadIdentity(record)]),
    );
    const attachments = new Map<string, LearningRecord[]>(
      anchors.map((anchor) => [anchor.id, []]),
    );
    for (const record of areaRecords.filter((record) => !isAnchor(record))) {
      const anchor = attachmentAnchor(record, anchors, identities);
      attachments.get(anchor.id)!.push(record);
    }

    return {
      area,
      orderedRecordIds: anchors.flatMap((anchor) => [
        anchor.id,
        ...roundRobinSections(attachments.get(anchor.id) ?? []).map(
          (record) => record.id,
        ),
      ]),
      anchorRecordIds: anchors.map((anchor) => anchor.id),
    };
  });
}
