import { appendFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type CoordinateUpdate = {
  recordId: string;
  sectionCode: string;
  category: string;
  featureIndex: number;
  featureName: string;
  coordinates: [number, number];
};

type TaxiFeature = {
  properties?: { Street?: unknown };
  geometry?: { type?: unknown; coordinates?: unknown };
};

const coordinatePair = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((part) => typeof part === "number" && Number.isFinite(part));

export function validateCoordinateUpdate(value: unknown): CoordinateUpdate {
  if (!value || typeof value !== "object") throw new Error("A coordinate update object is required.");
  const item = value as Partial<CoordinateUpdate>;
  if (!item.recordId || typeof item.recordId !== "string") throw new Error("recordId is required.");
  if (!item.sectionCode || typeof item.sectionCode !== "string" || !/^[A-Z]$/.test(item.sectionCode)) throw new Error("sectionCode must be one uppercase letter.");
  if (!item.category || typeof item.category !== "string") throw new Error("category is required.");
  if (!Number.isInteger(item.featureIndex) || (item.featureIndex as number) < 0) throw new Error("featureIndex must be a non-negative integer.");
  if (!item.featureName || typeof item.featureName !== "string") throw new Error("featureName is required.");
  if (!coordinatePair(item.coordinates)) throw new Error("coordinates must be [longitude, latitude].");
  const [longitude, latitude] = item.coordinates;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new Error("coordinates are outside valid longitude/latitude bounds.");
  return item as CoordinateUpdate;
}

export async function persistCoordinateUpdate(
  sourcePath: string,
  auditPath: string,
  rawUpdate: unknown,
) {
  const update = validateCoordinateUpdate(rawUpdate);
  const dataset = JSON.parse(await readFile(sourcePath, "utf8"));
  const features = dataset?.[update.sectionCode]?.categories?.[update.category];
  if (!Array.isArray(features)) throw new Error(`Record ${update.sectionCode}/${update.category} was not found.`);
  const feature = features[update.featureIndex] as TaxiFeature | undefined;
  if (!feature) throw new Error(`Feature ${update.featureIndex} was not found.`);
  if (feature.properties?.Street !== update.featureName) throw new Error("The feature name no longer matches the loaded answer. Reload before editing.");
  if (feature.geometry?.type !== "Point" || !coordinatePair(feature.geometry.coordinates)) throw new Error("Only existing point coordinates can be edited.");

  const previousCoordinates = [...feature.geometry.coordinates] as [number, number];
  feature.geometry.coordinates = update.coordinates.map((part) => Number(part.toFixed(8))) as [number, number];
  const temporaryPath = `${sourcePath}.coordinate-update.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  await rename(temporaryPath, sourcePath);

  await appendFile(auditPath, `${JSON.stringify({
    schema_version: "1.0.0",
    kind: "owner_coordinate_edit",
    recorded_at: new Date().toISOString(),
    ...update,
    previousCoordinates,
    coordinates: feature.geometry.coordinates,
  })}\n`, "utf8");

  return { ...update, previousCoordinates, coordinates: feature.geometry.coordinates };
}

export async function persistCoordinateUpdateWithRebuild(
  sourcePath: string,
  auditPath: string,
  rawUpdate: unknown,
  rebuild: () => Promise<unknown>,
) {
  const sourceBefore = await readFile(sourcePath);
  const auditBefore = await readFile(auditPath).catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? null : Promise.reject(error),
  );
  try {
    const update = await persistCoordinateUpdate(sourcePath, auditPath, rawUpdate);
    await rebuild();
    return update;
  } catch (error) {
    const rollbackPath = `${sourcePath}.coordinate-rollback.tmp`;
    await writeFile(rollbackPath, sourceBefore);
    await rename(rollbackPath, sourcePath);
    if (auditBefore) await writeFile(auditPath, auditBefore);
    else await rm(auditPath, { force: true });
    throw error;
  }
}

export const coordinatePaths = (repositoryRoot: string) => ({
  source: path.join(repositoryRoot, "data", "source", "glasgow-taxis.json"),
  audit: path.join(repositoryRoot, "data", "decisions", "coordinate-updates.v1.jsonl"),
});
