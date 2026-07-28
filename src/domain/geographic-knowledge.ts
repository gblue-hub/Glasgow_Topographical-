import type {
  Association,
  Attempt,
  LearningRecord,
  Mastery,
} from "./types";

export type KnowledgeArea = "north" | "east" | "south" | "west" | "centre";
export type NewsArea = Exclude<KnowledgeArea, "centre">;
export type GeographicScope = "all" | "news" | KnowledgeArea;

export const NEWS_AREAS: readonly NewsArea[] = [
  "north",
  "east",
  "south",
  "west",
];

export const KNOWLEDGE_AREAS: readonly KnowledgeArea[] = [
  ...NEWS_AREAS,
  "centre",
];

export const GEOGRAPHIC_SCOPES: readonly GeographicScope[] = [
  "all",
  "news",
  "centre",
  ...NEWS_AREAS,
];

export const knowledgeAreaLabels: Record<KnowledgeArea, string> = {
  north: "North",
  east: "East",
  south: "South",
  west: "West",
  centre: "City Centre",
};

export const geographicScopeLabels: Record<GeographicScope, string> = {
  all: "All Glasgow",
  news: "NEWS",
  ...knowledgeAreaLabels,
};

export type GeographicKnowledgeCell = {
  id: string;
  area: KnowledgeArea;
  areaLabel: string;
  topicKey: string;
  topicLabel: string;
  recordIds: string[];
  total: number;
  secure: number;
  learning: number;
  unseen: number;
  due: number;
  recentSlips: number;
  securePercentage: number;
  priorityScore: number;
};

export type GeographicKnowledgeTopic = {
  key: string;
  label: string;
  total: number;
  cells: Record<KnowledgeArea, GeographicKnowledgeCell>;
};

export type GeographicKnowledgeSummary = {
  topics: GeographicKnowledgeTopic[];
  areaTotals: Record<KnowledgeArea, GeographicKnowledgeCell>;
  recommendation: GeographicKnowledgeCell | null;
  classifiedRecordCount: number;
  unclassifiedRecordCount: number;
};

export type Coordinate = [number, number];

type AreaSeed = {
  area: KnowledgeArea;
  coordinate: Coordinate;
};

const RECENT_SLIP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_RECOMMENDATION_RECORDS = 6;
// Clyde → North Street → the central streets south of Garnethill,
// Cowcaddens and Townhead → High Street/Saltmarket. NEWS boundaries
// deliberately meet or overlap this polygon; primary ownership keeps every
// record in exactly one learner-facing area.
export const CITY_CENTRE_BOUNDARY: readonly Coordinate[] = [
  [-4.2727, 55.8572],
  [-4.2712, 55.8625],
  [-4.2695, 55.8648],
  [-4.264, 55.8652],
  [-4.257, 55.8651],
  [-4.251, 55.8648],
  [-4.245, 55.8647],
  [-4.2382, 55.8645],
  [-4.237, 55.865],
  [-4.2397, 55.8602],
  [-4.242, 55.856],
  [-4.2472, 55.8526],
  [-4.2516, 55.854],
  [-4.2577, 55.8555],
  [-4.2644, 55.8561],
];

// The portion removed from the former centre polygon is an intentional North
// transition belt. This makes the two learning areas meet without leaving
// Cowcaddens, Garnethill, Townhead or their surrounding places unowned.
const FORMER_CITY_CENTRE_BOUNDARY: readonly Coordinate[] = [
  [-4.2727, 55.8572],
  [-4.2712, 55.8625],
  [-4.2718, 55.867],
  [-4.2684, 55.8706],
  [-4.2646, 55.8699],
  [-4.2546, 55.8706],
  [-4.245, 55.8698],
  [-4.2382, 55.8688],
  [-4.237, 55.865],
  [-4.2397, 55.8602],
  [-4.242, 55.856],
  [-4.2472, 55.8526],
  [-4.2516, 55.854],
  [-4.2577, 55.8555],
  [-4.2644, 55.8561],
];

function explicitArea(sectionName: string): KnowledgeArea | null {
  const match = sectionName.match(/\b(NORTH|EAST|SOUTH|WEST)\b/i);
  return match ? (match[1].toLowerCase() as KnowledgeArea) : null;
}

function usableCoordinate(value: Coordinate | undefined): value is Coordinate {
  return Boolean(
    value &&
      value.length === 2 &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1]),
  );
}

export function recordCoordinate(record: LearningRecord): Coordinate | null {
  const preferred =
    record.type === "place"
      ? record.features.filter((feature) => feature.role === "place")
      : record.features;
  const coordinates = (preferred.length ? preferred : record.features)
    .map((feature) => feature.effective_coordinates)
    .filter(usableCoordinate);
  if (!coordinates.length) return null;
  return [
    coordinates.reduce((sum, coordinate) => sum + coordinate[0], 0) /
      coordinates.length,
    coordinates.reduce((sum, coordinate) => sum + coordinate[1], 0) /
      coordinates.length,
  ];
}

export function coordinateInsideBoundary(
  coordinate: Coordinate,
  boundary: readonly Coordinate[],
) {
  if (boundary.length < 3) return false;
  const [longitude, latitude] = coordinate;
  let inside = false;
  for (
    let current = 0, previous = boundary.length - 1;
    current < boundary.length;
    previous = current++
  ) {
    const [currentLongitude, currentLatitude] = boundary[current];
    const [previousLongitude, previousLatitude] = boundary[previous];
    const crossesLatitude =
      currentLatitude > latitude !== previousLatitude > latitude;
    const boundaryLongitude =
      ((previousLongitude - currentLongitude) *
        (latitude - currentLatitude)) /
        (previousLatitude - currentLatitude) +
      currentLongitude;
    if (crossesLatitude && longitude < boundaryLongitude) inside = !inside;
  }
  return inside;
}

export function isCityCentreRecord(record: LearningRecord) {
  const coordinate = recordCoordinate(record);
  return coordinate
    ? coordinateInsideBoundary(coordinate, CITY_CENTRE_BOUNDARY)
    : false;
}

export function primaryKnowledgeArea(
  record: LearningRecord,
  classifiedAreas: ReadonlyMap<string, NewsArea>,
): KnowledgeArea | null {
  if (isCityCentreRecord(record)) return "centre";
  const coordinate = recordCoordinate(record);
  if (
    coordinate &&
    coordinateInsideBoundary(coordinate, FORMER_CITY_CENTRE_BOUNDARY)
  )
    return "north";
  return classifiedAreas.get(record.id) ?? null;
}

export function recordMatchesGeographicScope(
  record: LearningRecord,
  scope: GeographicScope,
  classifiedAreas: ReadonlyMap<string, NewsArea>,
) {
  if (scope === "all") return true;
  const area = primaryKnowledgeArea(record, classifiedAreas);
  if (scope === "news") return area !== null && area !== "centre";
  return area === scope;
}

function squaredDistance(left: Coordinate, right: Coordinate) {
  const meanLatitude = ((left[1] + right[1]) / 2) * (Math.PI / 180);
  const longitude = (left[0] - right[0]) * Math.cos(meanLatitude);
  const latitude = left[1] - right[1];
  return longitude * longitude + latitude * latitude;
}

function districtSeeds(records: LearningRecord[]): AreaSeed[] {
  return records.flatMap((record) => {
    if (record.type !== "district") return [];
    const area = explicitArea(record.section.name);
    const coordinate = recordCoordinate(record);
    return area && coordinate ? [{ area, coordinate }] : [];
  });
}

const areaClassificationCache = new WeakMap<
  LearningRecord[],
  Map<string, NewsArea>
>();

export function classifyRecordAreas(records: LearningRecord[]) {
  const cached = areaClassificationCache.get(records);
  if (cached) return cached;
  const seeds = districtSeeds(records);
  const areas = new Map<string, NewsArea>();
  for (const record of records) {
    const area = classifyRecordArea(record, seeds);
    if (area && area !== "centre") areas.set(record.id, area);
  }
  areaClassificationCache.set(records, areas);
  return areas;
}

function convexHull(points: Coordinate[]): Coordinate[] {
  const sorted = [
    ...new Map(points.map((point) => [point.join(","), point])).values(),
  ].sort(
    ([leftLongitude, leftLatitude], [rightLongitude, rightLatitude]) =>
      leftLongitude - rightLongitude || leftLatitude - rightLatitude,
  );
  if (sorted.length < 3) return sorted;
  const cross = (origin: Coordinate, left: Coordinate, right: Coordinate) =>
    (left[0] - origin[0]) * (right[1] - origin[1]) -
    (left[1] - origin[1]) * (right[0] - origin[0]);
  const half = (candidates: Coordinate[]) => {
    const hull: Coordinate[] = [];
    for (const point of candidates) {
      while (
        hull.length >= 2 &&
        cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0
      )
        hull.pop();
      hull.push(point);
    }
    return hull;
  };
  return [
    ...half(sorted).slice(0, -1),
    ...half([...sorted].reverse()).slice(0, -1),
  ];
}

export function knowledgeAreaBoundary(
  records: LearningRecord[],
  area: KnowledgeArea,
  classifiedAreas: ReadonlyMap<string, NewsArea> = classifyRecordAreas(records),
): Coordinate[] {
  if (area === "centre") return [...CITY_CENTRE_BOUNDARY];
  return convexHull(
    records.flatMap((record): Coordinate[] => {
      if (
        classifiedAreas.get(record.id) !== area ||
        isCityCentreRecord(record)
      )
        return [];
      const coordinate = recordCoordinate(record);
      return coordinate ? [coordinate] : [];
    }),
  );
}

export function classifyRecordArea(
  record: LearningRecord,
  seeds: AreaSeed[],
): KnowledgeArea | null {
  const authored = explicitArea(record.section.name);
  if (authored) return authored;
  const coordinate = recordCoordinate(record);
  if (!coordinate || !seeds.length) return null;

  const nearest: Array<{
    seed: AreaSeed;
    distance: number;
    sourceIndex: number;
  }> = [];
  seeds.forEach((seed, sourceIndex) => {
    const candidate = {
      seed,
      distance: squaredDistance(coordinate, seed.coordinate),
      sourceIndex,
    };
    const insertionIndex = nearest.findIndex(
      (current) =>
        candidate.distance < current.distance ||
        (candidate.distance === current.distance &&
          candidate.sourceIndex < current.sourceIndex),
    );
    if (insertionIndex < 0) nearest.push(candidate);
    else nearest.splice(insertionIndex, 0, candidate);
    if (nearest.length > 5) nearest.pop();
  });

  const votes = new Map<KnowledgeArea, number>();
  for (const { seed, distance: rawDistance } of nearest) {
    const distance = Math.max(rawDistance, 0.00000001);
    votes.set(seed.area, (votes.get(seed.area) ?? 0) + 1 / distance);
  }
  return [...votes.entries()].sort(
    ([leftArea, leftVote], [rightArea, rightVote]) =>
      rightVote - leftVote || leftArea.localeCompare(rightArea),
  )[0]?.[0] ?? null;
}

function titleCase(value: string) {
  return value
    .replace(/[_.]+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-GB")
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-GB"));
}

export function recordTopic(record: LearningRecord) {
  if (/^DISTRICTS\b/i.test(record.section.name))
    return { key: "districts", label: "Districts" };
  if (/^MAIN ROADS\b/i.test(record.section.name))
    return { key: "main-roads", label: "Main roads" };
  return {
    key: `section:${record.section.code.toLocaleLowerCase("en-GB")}`,
    label: titleCase(record.section.name),
  };
}

function emptyCell(
  area: KnowledgeArea,
  topicKey: string,
  topicLabel: string,
): GeographicKnowledgeCell {
  return {
    id: `${topicKey}:${area}`,
    area,
    areaLabel: knowledgeAreaLabels[area],
    topicKey,
    topicLabel,
    recordIds: [],
    total: 0,
    secure: 0,
    learning: 0,
    unseen: 0,
    due: 0,
    recentSlips: 0,
    securePercentage: 0,
    priorityScore: 0,
  };
}

function cellsForTopic(topicKey: string, topicLabel: string) {
  return Object.fromEntries(
    KNOWLEDGE_AREAS.map((area) => [
      area,
      emptyCell(area, topicKey, topicLabel),
    ]),
  ) as Record<KnowledgeArea, GeographicKnowledgeCell>;
}

function finishCell(cell: GeographicKnowledgeCell) {
  cell.securePercentage = cell.total
    ? Math.round((cell.secure / cell.total) * 100)
    : 0;
  const unseenShare = cell.total ? cell.unseen / cell.total : 0;
  const learningShare = cell.total ? cell.learning / cell.total : 0;
  const dueShare = cell.total ? cell.due / cell.total : 0;
  const slipDensity = cell.total
    ? Math.min(1, cell.recentSlips / cell.total)
    : 0;
  const coverageGap = 1 - cell.securePercentage / 100;
  const substantiality = Math.min(1, cell.total / 50);
  cell.priorityScore = Math.round(
    (coverageGap * 60 +
      unseenShare * 18 +
      learningShare * 8 +
      dueShare * 9 +
      slipDensity * 5 +
      substantiality * 3) *
      10,
  ) / 10;
  return cell;
}

export function buildGeographicKnowledge(input: {
  records: LearningRecord[];
  associations: Association[];
  mastery: ReadonlyMap<string, Mastery>;
  attempts: Attempt[];
  now?: string | Date;
}): GeographicKnowledgeSummary {
  const now =
    input.now instanceof Date
      ? input.now
      : new Date(input.now ?? Date.now());
  const nowTime = now.getTime();
  const slipCutoff = nowTime - RECENT_SLIP_WINDOW_MS;
  const classifiedAreas = classifyRecordAreas(input.records);
  const associationsByRecord = new Map<string, Association[]>();
  const recordByAssociation = new Map<string, string>();
  for (const association of input.associations) {
    if (!association.required || association.scope !== "record_set") continue;
    const current = associationsByRecord.get(association.record_id) ?? [];
    current.push(association);
    associationsByRecord.set(association.record_id, current);
    recordByAssociation.set(association.id, association.record_id);
  }
  const recentSlipsByRecord = new Map<string, number>();
  for (const attempt of input.attempts) {
    if (attempt.correct || attempt.phase === "correction") continue;
    const createdAt = Date.parse(attempt.created_at);
    if (!Number.isFinite(createdAt) || createdAt < slipCutoff || createdAt > nowTime)
      continue;
    const recordId = recordByAssociation.get(attempt.association_id);
    if (recordId)
      recentSlipsByRecord.set(
        recordId,
        (recentSlipsByRecord.get(recordId) ?? 0) + 1,
      );
  }

  const topics = new Map<
    string,
    { key: string; label: string; cells: Record<KnowledgeArea, GeographicKnowledgeCell> }
  >();
  let classifiedRecordCount = 0;
  let unclassifiedRecordCount = 0;

  for (const record of input.records) {
    const area = primaryKnowledgeArea(record, classifiedAreas);
    if (!area) {
      unclassifiedRecordCount += 1;
      continue;
    }
    classifiedRecordCount += 1;
    const topic = recordTopic(record);
    const aggregate =
      topics.get(topic.key) ?? {
        ...topic,
        cells: cellsForTopic(topic.key, topic.label),
      };
    topics.set(topic.key, aggregate);
    const associations = associationsByRecord.get(record.id) ?? [];
    const states = associations
      .map((association) => input.mastery.get(association.id))
      .filter((state): state is Mastery => Boolean(state));
    const secure =
      associations.length > 0 &&
      associations.every(
        (association) =>
          input.mastery.get(association.id)?.state === "mastered",
      );
    const learning = !secure && states.length > 0;
    const due = states.some((state) => {
      const nextDue = Date.parse(state.next_due_at);
      return (
        state.state === "lapsed" ||
        state.state === "blocked" ||
        (Number.isFinite(nextDue) && nextDue <= nowTime)
      );
    });

    const cell = aggregate.cells[area];
    cell.recordIds.push(record.id);
    cell.total += 1;
    if (secure) cell.secure += 1;
    else if (learning) cell.learning += 1;
    else cell.unseen += 1;
    if (due) cell.due += 1;
    cell.recentSlips += recentSlipsByRecord.get(record.id) ?? 0;
  }

  const finishedTopics = [...topics.values()]
    .map((topic) => {
      for (const area of KNOWLEDGE_AREAS) finishCell(topic.cells[area]);
      return {
        ...topic,
        total: new Set(
          KNOWLEDGE_AREAS.flatMap((area) => topic.cells[area].recordIds),
        ).size,
      };
    })
    .sort(
      (left, right) =>
        right.total - left.total || left.label.localeCompare(right.label),
    );

  const areaTotals = cellsForTopic("all", "All knowledge");
  for (const topic of finishedTopics)
    for (const area of KNOWLEDGE_AREAS) {
      const source = topic.cells[area];
      const target = areaTotals[area];
      target.recordIds.push(...source.recordIds);
      target.total += source.total;
      target.secure += source.secure;
      target.learning += source.learning;
      target.unseen += source.unseen;
      target.due += source.due;
      target.recentSlips += source.recentSlips;
    }
  for (const area of KNOWLEDGE_AREAS) finishCell(areaTotals[area]);

  const recommendation =
    finishedTopics
      .flatMap((topic) => KNOWLEDGE_AREAS.map((area) => topic.cells[area]))
      .filter((cell) => cell.total >= MIN_RECOMMENDATION_RECORDS)
      .sort(
        (left, right) =>
          right.priorityScore - left.priorityScore ||
          right.recentSlips - left.recentSlips ||
          right.due - left.due ||
          right.unseen - left.unseen ||
          right.total - left.total ||
          left.id.localeCompare(right.id),
      )[0] ?? null;

  return {
    topics: finishedTopics,
    areaTotals,
    recommendation,
    classifiedRecordCount,
    unclassifiedRecordCount,
  };
}
