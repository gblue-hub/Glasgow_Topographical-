import type {
  LearningRecord,
  RoadGeometryCollection,
} from "./types";
import {
  KNOWLEDGE_AREAS,
  classifyRecordAreas,
  knowledgeAreaBoundary,
  primaryKnowledgeArea,
  type Coordinate,
  type KnowledgeArea,
  type NewsArea,
} from "./geographic-knowledge";

export type JourneyLocation = {
  id: string;
  name: string;
  coordinate: [number, number];
  area: KnowledgeArea;
};

export type JourneyRoadOption = {
  name: string;
  coordinates: [number, number][];
  segments: [number, number][][];
};

export type JourneyAreaFilter = KnowledgeArea | "all";

export type OsrmRoute = {
  distanceMetres: number;
  durationSeconds: number;
  coordinates: [number, number][];
  roadNames: string[];
};

export type RouteComparison = {
  agreementPoints: [number, number][];
  divergencePoint: [number, number] | null;
  reconnectionPoint: [number, number] | null;
  overlapPercentage: number;
  maximumDeviationMetres: number;
  substantialDifference: boolean;
};

export type SelectedRoadAssessment = {
  name: string;
  waypoint: [number, number];
  distanceFromSuggestionMetres: number;
  followsSuggestedCorridor: boolean;
  confirmedByLearnerRoute: boolean;
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function metresBetween(
  left: [number, number],
  right: [number, number],
) {
  const latitude = radians((left[1] + right[1]) / 2);
  const dx = (left[0] - right[0]) * 111_320 * Math.cos(latitude);
  const dy = (left[1] - right[1]) * 110_540;
  return Math.hypot(dx, dy);
}

function closestPointOnSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
) {
  const latitude = radians((start[1] + end[1] + point[1]) / 3);
  const xScale = 111_320 * Math.cos(latitude);
  const yScale = 110_540;
  const startX = (start[0] - point[0]) * xScale;
  const startY = (start[1] - point[1]) * yScale;
  const endX = (end[0] - point[0]) * xScale;
  const endY = (end[1] - point[1]) * yScale;
  const dx = endX - startX;
  const dy = endY - startY;
  const squaredLength = dx * dx + dy * dy;
  const position = squaredLength
    ? Math.max(0, Math.min(1, -(startX * dx + startY * dy) / squaredLength))
    : 0;
  const projected: [number, number] = [
    start[0] + (end[0] - start[0]) * position,
    start[1] + (end[1] - start[1]) * position,
  ];
  return { coordinate: projected, metres: metresBetween(point, projected) };
}

function distanceFromLine(
  point: [number, number],
  line: [number, number][],
) {
  let closest = {
    coordinate: line[0] ?? point,
    metres: Number.POSITIVE_INFINITY,
  };
  for (let index = 1; index < line.length; index += 1) {
    const candidate = closestPointOnSegment(point, line[index - 1], line[index]);
    if (candidate.metres < closest.metres) closest = candidate;
  }
  return closest;
}

function sampleLine(
  line: [number, number][],
  intervalMetres = 30,
) {
  if (line.length < 2) return [...line];
  const samples: [number, number][] = [line[0]];
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    const steps = Math.max(
      1,
      Math.ceil(metresBetween(start, end) / intervalMetres),
    );
    for (let step = 1; step <= steps; step += 1) {
      const fraction = step / steps;
      samples.push([
        start[0] + (end[0] - start[0]) * fraction,
        start[1] + (end[1] - start[1]) * fraction,
      ]);
    }
  }
  return samples;
}

const normalizedRoadName = (name: string) =>
  name
    .toLocaleLowerCase("en-GB")
    .replace(/\b(?:street|road|avenue|drive|lane)\b/g, (suffix) => suffix[0])
    .replace(/[^a-z0-9]/g, "");

export function assessSelectedRoads(
  selected: Array<{ name: string; waypoint: [number, number] }>,
  suggestedRoute: [number, number][],
  learnerRoadNames: string[],
  corridorMetres = 80,
): SelectedRoadAssessment[] {
  const usedNames = learnerRoadNames.map(normalizedRoadName);
  return selected.map(({ name, waypoint }) => {
    const distance = distanceFromLine(waypoint, suggestedRoute).metres;
    const normalized = normalizedRoadName(name);
    return {
      name,
      waypoint,
      distanceFromSuggestionMetres: distance,
      followsSuggestedCorridor: distance <= corridorMetres,
      confirmedByLearnerRoute: usedNames.some(
        (usedName) =>
          normalized.length >= 3 &&
          usedName.length >= 3 &&
          (usedName === normalized ||
            usedName.includes(normalized) ||
            normalized.includes(usedName)),
      ),
    };
  });
}

export function journeyLocations(
  records: LearningRecord[],
  classifiedAreas: ReadonlyMap<string, NewsArea> = classifyRecordAreas(records),
): JourneyLocation[] {
  return records.flatMap((record) => {
    if (record.type !== "place") return [];
    const area = primaryKnowledgeArea(record, classifiedAreas);
    if (!area) return [];
    const feature =
      record.features.find((candidate) => candidate.role === "place") ??
      record.features[0];
    if (!feature) return [];
    return [{
      id: record.id,
      name: record.exam_name,
      coordinate: feature.effective_coordinates,
      area,
    }];
  });
}

export function journeyAreaBoundary(
  records: LearningRecord[],
  area: KnowledgeArea,
  classifiedAreas: ReadonlyMap<string, NewsArea> = classifyRecordAreas(records),
): Coordinate[] {
  return knowledgeAreaBoundary(records, area, classifiedAreas);
}

export function generateJourneyPair(
  locations: JourneyLocation[],
  random = Math.random,
  filters: {
    startArea?: JourneyAreaFilter;
    endArea?: JourneyAreaFilter;
  } = {},
) {
  const startLocations = locations.filter(
    (location) =>
      !filters.startArea ||
      filters.startArea === "all" ||
      location.area === filters.startArea,
  );
  if (!startLocations.length) return null;
  const start =
    startLocations[
      Math.min(
        startLocations.length - 1,
        Math.floor(random() * startLocations.length),
      )
    ];
  const endLocations = locations.filter(
    (location) =>
      location.id !== start.id &&
      (!filters.endArea ||
        filters.endArea === "all" ||
        location.area === filters.endArea),
  );
  if (!endLocations.length) return null;
  const preferred = endLocations.filter((location) => {
    const distance = metresBetween(start.coordinate, location.coordinate);
    return distance >= 2_000 && distance <= 16_000;
  });
  const candidates = preferred.length ? preferred : endLocations;
  const end =
    candidates[
      Math.min(
        candidates.length - 1,
        Math.floor(random() * candidates.length),
      )
    ];
  return { start, end };
}

const journeyRoadOptionsCache = new WeakMap<
  RoadGeometryCollection,
  JourneyRoadOption[]
>();

export function journeyRoadOptions(
  geometry: RoadGeometryCollection,
): JourneyRoadOption[] {
  const cached = journeyRoadOptionsCache.get(geometry);
  if (cached) return cached;
  const segmentsByName = new Map<string, [number, number][][]>();
  for (const feature of geometry.features) {
    const coordinates = feature.geometry.coordinates;
    if (!coordinates.length) continue;
    for (const rawName of feature.properties.names) {
      const name = rawName.trim();
      if (!name) continue;
      const existing = segmentsByName.get(name) ?? [];
      existing.push(coordinates);
      segmentsByName.set(name, existing);
    }
  }
  const options = [...segmentsByName]
    .map(([name, segments]) => ({
      name,
      segments,
      coordinates: segments.flatMap((coordinates) => [
        coordinates[0],
        coordinates[Math.floor(coordinates.length / 2)],
        coordinates[coordinates.length - 1],
      ]),
    }))
    .sort((left, right) =>
      left.name.localeCompare(right.name, "en-GB", {
        sensitivity: "base",
        numeric: true,
      }),
    );
  journeyRoadOptionsCache.set(geometry, options);
  return options;
}

export function prepareJourneyWorkshop(
  records: LearningRecord[],
  geometry: RoadGeometryCollection,
) {
  const classifiedAreas = classifyRecordAreas(records);
  journeyLocations(records, classifiedAreas);
  journeyRoadOptions(geometry);
  for (const area of KNOWLEDGE_AREAS)
    journeyAreaBoundary(records, area, classifiedAreas);
}

export function roadWaypoint(
  option: JourneyRoadOption,
  start: [number, number],
  end: [number, number],
  position: number,
  total: number,
) {
  const fraction = (position + 1) / (total + 1);
  const target: [number, number] = [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ];
  return [...option.coordinates].sort(
    (left, right) =>
      metresBetween(left, target) - metresBetween(right, target),
  )[0];
}

export function buildOsrmRouteUrl(
  baseUrl: string,
  coordinates: [number, number][],
) {
  const coordinatePath = coordinates
    .map(([longitude, latitude]) => `${longitude},${latitude}`)
    .join(";");
  return `${baseUrl.replace(/\/$/, "")}/route/v1/driving/${coordinatePath}?overview=full&geometries=geojson&steps=true`;
}

type OsrmResponse = {
  code?: string;
  message?: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry: { type: "LineString"; coordinates: [number, number][] };
    legs: Array<{ steps: Array<{ name: string }> }>;
  }>;
};

export async function requestOsrmRoute(
  baseUrl: string,
  coordinates: [number, number][],
  signal?: AbortSignal,
): Promise<OsrmRoute> {
  const response = await fetch(buildOsrmRouteUrl(baseUrl, coordinates), {
    signal,
  });
  const result = (await response.json().catch(() => null)) as OsrmResponse | null;
  const route = result?.routes?.[0];
  if (!response.ok || result?.code !== "Ok" || !route) {
    throw new Error(
      result?.message ||
        "The routing service could not calculate this journey.",
    );
  }
  const roadNames: string[] = [];
  for (const leg of route.legs)
    for (const step of leg.steps) {
      const name = step.name.trim();
      if (name && roadNames.at(-1) !== name) roadNames.push(name);
    }
  return {
    distanceMetres: route.distance,
    durationSeconds: route.duration,
    coordinates: route.geometry.coordinates,
    roadNames,
  };
}

export function compareRouteGeometry(
  learner: [number, number][],
  suggested: [number, number][],
  toleranceMetres = 35,
): RouteComparison {
  if (!learner.length || suggested.length < 2)
    return {
      agreementPoints: [],
      divergencePoint: null,
      reconnectionPoint: null,
      overlapPercentage: 0,
      maximumDeviationMetres: Number.POSITIVE_INFINITY,
      substantialDifference: true,
    };

  const sampledLearner = sampleLine(learner);
  const deviations = sampledLearner.map(
    (coordinate) => distanceFromLine(coordinate, suggested).metres,
  );
  const matches = deviations.map((metres) => metres <= toleranceMetres);
  const divergenceIndex = matches.findIndex((matchesRoute) => !matchesRoute);
  let reconnectionIndex = -1;
  if (divergenceIndex >= 0) {
    for (let index = divergenceIndex + 1; index < matches.length; index += 1) {
      if (matches[index] && matches.slice(index, index + 3).every(Boolean)) {
        reconnectionIndex = index;
        break;
      }
    }
  }

  const agreementPoints: [number, number][] = [];
  let lastAgreement: [number, number] | null = null;
  sampledLearner.forEach((coordinate, index) => {
    if (!matches[index]) return;
    const isBoundary =
      index === 0 ||
      index === learner.length - 1 ||
      !matches[index - 1] ||
      !matches[index + 1];
    if (
      isBoundary ||
      !lastAgreement ||
      metresBetween(lastAgreement, coordinate) >= 450
    ) {
      agreementPoints.push(coordinate);
      lastAgreement = coordinate;
    }
  });
  const overlapPercentage = matches.length
    ? Math.round(
        (matches.filter(Boolean).length / matches.length) * 100,
      )
    : 0;
  const maximumDeviationMetres = deviations.length
    ? Math.max(...deviations)
    : Number.POSITIVE_INFINITY;

  return {
    agreementPoints: agreementPoints.slice(0, 24),
    divergencePoint:
      divergenceIndex >= 0 ? sampledLearner[divergenceIndex] : null,
    reconnectionPoint:
      reconnectionIndex >= 0 ? sampledLearner[reconnectionIndex] : null,
    overlapPercentage,
    maximumDeviationMetres,
    substantialDifference:
      overlapPercentage < 85 || maximumDeviationMetres > 250,
  };
}

export function formatJourneyDistance(metres: number) {
  return metres < 1_000
    ? `${Math.round(metres)} m`
    : `${(metres / 1_000).toFixed(1)} km`;
}
