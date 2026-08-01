import { describe, expect, it } from "vitest";
import { buildTerritoryPolygons, pointInsideTerritory } from "./territory-polygons";
import type { TerritoryDefinition } from "./types";

const territory = (id: string, longitude: number, latitude: number) =>
  ({ id, centre: [longitude, latitude] }) as TerritoryDefinition;

describe("district learning polygons", () => {
  it("creates adjoining cells containing every district anchor", () => {
    const territories = [
      territory("west", -4.3, 55.86),
      territory("east", -4.2, 55.86),
      territory("south", -4.25, 55.8),
    ];
    const polygons = buildTerritoryPolygons(territories);
    expect(polygons.size).toBe(3);
    for (const item of territories)
      expect(pointInsideTerritory(item.centre, polygons.get(item.id)!)).toBe(true);
  });
});
