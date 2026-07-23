import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coordinatePaths, persistCoordinateUpdate, persistCoordinateUpdateWithRebuild, validateCoordinateUpdate } from "./coordinate-updates";

const update = {
  recordId: "record-1",
  sectionCode: "G",
  category: "Aikenhead Rd",
  featureIndex: 1,
  featureName: "Cathcart Road",
  coordinates: [-4.25, 55.84] as [number, number],
};

describe("coordinate update persistence", () => {
  it("validates coordinate bounds", () => {
    expect(() => validateCoordinateUpdate({ ...update, coordinates: [-4.2, 91] })).toThrow(/outside valid/);
  });

  it("updates only the selected point and appends an audit record", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "taxi-coordinate-test-"));
    const source = path.join(directory, "glasgow-taxis.json");
    const audit = path.join(directory, "updates.jsonl");
    const dataset = { G: { name: "MAIN ROADS (SOUTH)", categories: { "Aikenhead Rd": [
      { properties: { Street: "Aikenhead Road" }, geometry: { type: "Point", coordinates: [-4.24, 55.83] } },
      { properties: { Street: "Cathcart Road" }, geometry: { type: "Point", coordinates: [-4.26, 55.85] } },
    ] } } };
    await writeFile(source, JSON.stringify(dataset));

    const result = await persistCoordinateUpdate(source, audit, update);
    const saved = JSON.parse(await readFile(source, "utf8"));
    expect(result.previousCoordinates).toEqual([-4.26, 55.85]);
    expect(saved.G.categories["Aikenhead Rd"][1].geometry.coordinates).toEqual(update.coordinates);
    expect(saved.G.categories["Aikenhead Rd"][0].geometry.coordinates).toEqual([-4.24, 55.83]);
    expect(JSON.parse((await readFile(audit, "utf8")).trim())).toMatchObject({ kind: "owner_coordinate_edit", featureName: "Cathcart Road" });
  });

  it("rejects stale feature identities", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "taxi-coordinate-test-"));
    const source = path.join(directory, "glasgow-taxis.json");
    await writeFile(source, JSON.stringify({ G: { categories: { "Aikenhead Rd": [
      { properties: { Street: "Different Road" }, geometry: { type: "Point", coordinates: [-4.2, 55.8] } },
    ] } } }));
    await expect(persistCoordinateUpdate(source, path.join(directory, "audit.jsonl"), { ...update, featureIndex: 0 })).rejects.toThrow(/no longer matches/);
  });

  it("rolls source and audit back when regeneration fails", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "taxi-coordinate-rollback-"));
    const source = path.join(directory, "glasgow-taxis.json");
    const audit = path.join(directory, "updates.jsonl");
    const original = { G: { categories: { "Aikenhead Rd": [
      { properties: { Street: "Aikenhead Road" }, geometry: { type: "Point", coordinates: [-4.24, 55.83] } },
      { properties: { Street: "Cathcart Road" }, geometry: { type: "Point", coordinates: [-4.26, 55.85] } },
    ] } } };
    await writeFile(source, JSON.stringify(original));
    await writeFile(audit, '{"existing":true}\n');

    await expect(
      persistCoordinateUpdateWithRebuild(source, audit, update, async () => {
        throw new Error("build rejected");
      }),
    ).rejects.toThrow(/build rejected/);

    expect(JSON.parse(await readFile(source, "utf8"))).toEqual(original);
    expect(await readFile(audit, "utf8")).toBe('{"existing":true}\n');
  });

  it("resolves the one canonical source below the repository root", () => {
    expect(coordinatePaths("C:\\workspace")).toEqual({
      source: path.join("C:\\workspace", "data", "source", "glasgow-taxis.json"),
      audit: path.join("C:\\workspace", "data", "decisions", "coordinate-updates.v1.jsonl"),
    });
  });
});
