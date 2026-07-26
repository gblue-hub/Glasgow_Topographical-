import type {
  LearningRecord,
  RoadGeometryCollection,
} from "./types";

export type JourneyLocation = {
  id: string;
  name: string;
  coordinate: [number, number];
};

export type JourneyRoadOption = {
  name: string;
  coordinates: [number, number][];
};

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

export function journeyLocations(records: LearningRecord[]): JourneyLocation[] {
  return records.flatMap((record) => {
    if (record.type !== "place") return [];
    const feature =
      record.features.find((candidate) => candidate.role === "place") ??
      record.features[0];
    if (!feature) return [];
    return [{
      id: record.id,
      name: record.exam_name,
      coordinate: feature.effective_coordinates,
    }];
  });
}

export function generateJourneyPair(
  locations: JourneyLocation[],
  random = Math.random,
) {
  if (locations.length < 2) return null;
  const start = locations[Math.floor(random() * locations.length)];
  const preferred = locations.filter((location) => {
    const distance = metresBetween(start.coordinate, location.coordinate);
    return location.id !== start.id && distance >= 2_000 && distance <= 16_000;
  });
  const candidates = preferred.length
    ? preferred
    : locations.filter((location) => location.id !== start.id);
  const end = candidates[Math.floor(random() * candidates.length)];
  return { start, end };
}

export function journeyRoadOptions(
  geometry: RoadGeometryCollection,
): JourneyRoadOption[] {
  const coordinatesByName = new Map<string, [number, number][]>();
  for (const feature of geometry.features) {
    const coordinates = feature.geometry.coordinates;
    if (!coordinates.length) continue;
    const samples = [
      coordinates[0],
      coordinates[Math.floor(coordinates.length / 2)],
      coordinates[coordinates.length - 1],
    ];
    for (const rawName of feature.properties.names) {
      const name = rawName.trim();
      if (!name) continue;
      const existing = coordinatesByName.get(name) ?? [];
      existing.push(...samples);
      coordinatesByName.set(name, existing);
    }
  }
  return [...coordinatesByName]
    .map(([name, coordinates]) => ({ name, coordinates }))
    .sort((left, right) =>
      left.name.localeCompare(right.name, "en-GB", {
        sensitivity: "base",
        numeric: true,
      }),
    );
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
    };

  const matches = learner.map(
    (coordinate) =>
      distanceFromLine(coordinate, suggested).metres <= toleranceMetres,
  );
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
  learner.forEach((coordinate, index) => {
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

  return {
    agreementPoints: agreementPoints.slice(0, 24),
    divergencePoint:
      divergenceIndex >= 0 ? learner[divergenceIndex] : null,
    reconnectionPoint:
      reconnectionIndex >= 0 ? learner[reconnectionIndex] : null,
  };
}

export function formatJourneyDistance(metres: number) {
  return metres < 1_000
    ? `${Math.round(metres)} m`
    : `${(metres / 1_000).toFixed(1)} km`;
}
