import type { TerritoryDefinition } from "./types";

type Point = [number, number];

const side = (point: Point, centre: Point, competitor: Point) =>
  (point[0] - centre[0]) ** 2 + (point[1] - centre[1]) ** 2 -
  ((point[0] - competitor[0]) ** 2 +
    (point[1] - competitor[1]) ** 2);

function clipCloserTo(
  polygon: Point[],
  centre: Point,
  competitor: Point,
) {
  const output: Point[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const startSide = side(start, centre, competitor);
    const endSide = side(end, centre, competitor);
    const startInside = startSide <= 0;
    const endInside = endSide <= 0;
    if (startInside) output.push(start);
    if (startInside === endInside) continue;
    const position = startSide / (startSide - endSide);
    output.push([
      start[0] + (end[0] - start[0]) * position,
      start[1] + (end[1] - start[1]) * position,
    ]);
  }
  return output;
}

/** Creates a deterministic Voronoi-style learning territory layer. The cells
 * share exact seams, making main-road overlays visually stitch districts
 * together without pretending these are official administrative boundaries. */
export function buildTerritoryPolygons(
  territories: TerritoryDefinition[],
  paddingDegrees = 0.018,
) {
  if (!territories.length) return new Map<string, Point[]>();
  const longitudes = territories.map((territory) => territory.centre[0]);
  const latitudes = territories.map((territory) => territory.centre[1]);
  const bounds: Point[] = [
    [Math.min(...longitudes) - paddingDegrees, Math.min(...latitudes) - paddingDegrees],
    [Math.max(...longitudes) + paddingDegrees, Math.min(...latitudes) - paddingDegrees],
    [Math.max(...longitudes) + paddingDegrees, Math.max(...latitudes) + paddingDegrees],
    [Math.min(...longitudes) - paddingDegrees, Math.max(...latitudes) + paddingDegrees],
  ];
  const generated = new Map(
    territories.map((territory) => {
      let polygon = [...bounds];
      for (const competitor of territories) {
        if (competitor.id === territory.id) continue;
        polygon = clipCloserTo(polygon, territory.centre, competitor.centre);
        if (!polygon.length) break;
      }
      return [territory.id, polygon];
    }),
  );
  return new Map(
    territories.map((territory) => [
      territory.id,
      territory.polygon?.length >= 3
        ? territory.polygon
        : generated.get(territory.id) ?? [],
    ]),
  );
}

export function pointInsideTerritory(point: Point, polygon: Point[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const [currentX, currentY] = polygon[current];
    const [previousX, previousY] = polygon[previous];
    if (
      currentY > point[1] !== previousY > point[1] &&
      point[0] <
        ((previousX - currentX) * (point[1] - currentY)) /
          (previousY - currentY) +
          currentX
    )
      inside = !inside;
  }
  return inside;
}
