import type {
  LearningRecord,
  RoadGeometryCollection,
  RoadGeometryFeature,
  RoadLink,
  RoadTopology,
} from "./types";
import { normaliseRoadName } from "./road-names";
export { normaliseRoadName } from "./road-names";

export type DatasetRoadMarker = {
  id: string;
  recordId: string;
  recordType: LearningRecord["type"];
  label: string;
  associationLabel: string;
  coordinate: [number, number];
  featureIndex: number;
  reveal: null | {
    kind: "middle_road" | "place";
    connectingRoad: LearningRecord["features"][number] | null;
    otherRoads: LearningRecord["features"];
  };
};

export type RoadAtlasEntry = {
  name: string;
  linkIds: string[];
  lengthMetres: number;
  roadFunctions: string[];
  formsOfWay: string[];
  connectionCount?: number;
  sourceComponentCount?: number;
  excludedSeededComponentCount?: number;
};

export type RoadJunction = {
  nodeId: string;
  selectedLinkIds: string[];
  connectedRoadNames: string[];
};

export type RoadConnection = {
  id: string;
  name: string;
  nodeId: string;
  coordinate: [number, number] | null;
  adjacentLinkIds: string[];
};

const compareNames = (left: string, right: string) =>
  left.localeCompare(right, "en-GB", { sensitivity: "base", numeric: true });

const featureNames = (feature: LearningRecord["features"][number]) =>
  new Set([feature.exam_name, feature.map_name].filter(Boolean).map(normaliseRoadName));

const featureMatchesRoad = (feature: LearningRecord["features"][number], road: RoadAtlasEntry) =>
  Boolean(feature.road_link_id && road.linkIds.includes(feature.road_link_id)) ||
  Boolean(feature.road_link_ids?.some((id) => road.linkIds.includes(id))) ||
  featureNames(feature).has(normaliseRoadName(road.name));

const metresBetween = (left: [number, number], right: [number, number]) => {
  const latitude = (left[1] + right[1]) * Math.PI / 360;
  const dx = (left[0] - right[0]) * 111_320 * Math.cos(latitude);
  const dy = (left[1] - right[1]) * 110_540;
  return Math.hypot(dx, dy);
};

function componentEndpointGap(left: RoadLink[], right: RoadLink[], geometryById: Map<string, RoadGeometryFeature>) {
  const endpoints = (links: RoadLink[]) => links.flatMap((link) => {
    const coordinates = geometryById.get(link.id)?.geometry.coordinates ?? [];
    return coordinates.length ? [coordinates[0], coordinates[coordinates.length - 1]] : [];
  });
  let best = Number.POSITIVE_INFINITY;
  for (const a of endpoints(left)) for (const b of endpoints(right)) best = Math.min(best, metresBetween(a, b));
  return best;
}

function connectedNameComponents(links: RoadLink[], geometry?: RoadGeometryCollection, joinGapMetres = 100) {
  const byNode = new Map<string, RoadLink[]>();
  for (const link of links) for (const node of [link.start_node, link.end_node]) {
    const entries = byNode.get(node) ?? [];
    entries.push(link);
    byNode.set(node, entries);
  }
  const seen = new Set<string>(), components: RoadLink[][] = [];
  for (const link of [...links].sort((a, b) => a.id.localeCompare(b.id))) if (!seen.has(link.id)) {
    const component: RoadLink[] = [], pending = [link];
    seen.add(link.id);
    while (pending.length) {
      const current = pending.pop()!;
      component.push(current);
      for (const node of [current.start_node, current.end_node]) for (const adjacent of byNode.get(node) ?? []) if (!seen.has(adjacent.id)) {
        seen.add(adjacent.id);
        pending.push(adjacent);
      }
    }
    components.push(component.sort((a, b) => a.id.localeCompare(b.id)));
  }
  if (!geometry || components.length < 2) return components;
  const geometryById = new Map(geometry.features.map((feature) => [feature.properties.road_link_id, feature]));
  const parent = components.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const join = (left: number, right: number) => {
    const a = find(left), b = find(right);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };
  for (let left = 0; left < components.length; left += 1) for (let right = left + 1; right < components.length; right += 1) {
    if (componentEndpointGap(components[left], components[right], geometryById) <= joinGapMetres) join(left, right);
  }
  const merged = new Map<number, RoadLink[]>();
  components.forEach((component, index) => merged.set(find(index), [...(merged.get(find(index)) ?? []), ...component]));
  return [...merged.values()].map((component) => component.sort((a, b) => a.id.localeCompare(b.id)));
}

/** Roads are admitted by learning-content features, never by incidental OS adjacency. */
export function buildDatasetRoadAtlas(records: LearningRecord[], topology: RoadTopology, geometry: RoadGeometryCollection): RoadAtlasEntry[] {
  const datasetNames = new Map<string, { name: string; recordIds: Set<string>; linkIds: Set<string>; seedCounts: Map<string, number> }>();
  const spineRoles = new Set(["associated_road", "terminal_road", "district_associated_road"]);
  for (const record of records) for (const feature of record.features) {
    if (!spineRoles.has(feature.role)) continue;
    const key = normaliseRoadName(feature.map_name || feature.exam_name);
    if (!key) continue;
    const entry = datasetNames.get(key) ?? { name: feature.exam_name, recordIds: new Set<string>(), linkIds: new Set<string>(), seedCounts: new Map<string, number>() };
    entry.recordIds.add(record.id);
    for (const id of [feature.road_link_id, ...(feature.road_link_ids ?? [])].filter((value): value is string => Boolean(value))) {
      entry.linkIds.add(id);
      entry.seedCounts.set(id, (entry.seedCounts.get(id) ?? 0) + 1);
    }
    datasetNames.set(key, entry);
  }
  const linksById = new Map(topology.links.map((link) => [link.id, link]));
  return [...datasetNames.values()].filter((entry) => entry.recordIds.size > 1).map((entry) => {
    const candidates = topology.links.filter((link) => link.names.some((name) => normaliseRoadName(name) === normaliseRoadName(entry.name)));
    const components = connectedNameComponents(candidates, geometry);
    const ranked = components.map((links) => ({
      links,
      support: links.reduce((sum, link) => sum + (entry.seedCounts.get(link.id) ?? 0), 0),
      key: links[0]?.id ?? '',
    })).filter((component) => component.support > 0)
      .sort((a, b) => b.support - a.support || b.links.length - a.links.length || a.key.localeCompare(b.key));
    const selected = ranked[0]?.links ?? [...entry.linkIds].map((id) => linksById.get(id)).filter((link): link is RoadLink => Boolean(link));
    const linkIds = selected.map((link) => link.id);
    const links = linkIds.map((id) => linksById.get(id)).filter((link): link is RoadLink => Boolean(link));
    return { name: entry.name, linkIds: linkIds.sort(), lengthMetres: Math.round(links.reduce((sum, link) => sum + link.length_metres, 0)), roadFunctions: [...new Set(links.map((link) => link.road_function))].sort(compareNames), formsOfWay: [...new Set(links.map((link) => link.form_of_way))].sort(compareNames), connectionCount: entry.recordIds.size, sourceComponentCount: components.length, excludedSeededComponentCount: Math.max(0, ranked.length - 1) };
  }).filter((road) => road.linkIds.length > 0).sort((left, right) => compareNames(left.name, right.name));
}

/** Marker membership is entirely driven by associations encoded in learning records. */
export function datasetMarkersForRoad(records: LearningRecord[], road: RoadAtlasEntry): DatasetRoadMarker[] {
  const markers: DatasetRoadMarker[] = [];
  for (const record of records.filter((record) => record.type === "middle_road")) {
    const middleRoad = record.features.find((feature) => feature.role === "middle_road");
    const terminals = record.features.filter((feature) => feature.role === "terminal_road");
    for (const terminal of terminals) {
      if (!middleRoad || !featureMatchesRoad(terminal, road)) continue;
      const oppositeTerminal = terminals.find((feature) => feature.index !== terminal.index);
      markers.push({ id: `${record.id}:${terminal.index}`, recordId: record.id, recordType: record.type, label: record.exam_name, associationLabel: terminal.exam_name, coordinate: terminal.effective_coordinates, featureIndex: terminal.index, reveal: oppositeTerminal ? { kind: "middle_road", connectingRoad: middleRoad, otherRoads: [oppositeTerminal] } : null });
    }
  }
  for (const record of records.filter((record) => record.type === "place")) {
    const place = record.features.find((feature) => feature.role === "place");
    if (!place) continue;
    for (const feature of record.features.filter((feature) => feature.role === "associated_road")) {
      if (!featureMatchesRoad(feature, road)) continue;
      const otherRoads = record.features.filter((candidate) => candidate.role === "associated_road" && candidate.index !== feature.index);
      markers.push({ id: `${record.id}:${feature.index}`, recordId: record.id, recordType: record.type, label: record.exam_name, associationLabel: feature.exam_name, coordinate: place.effective_coordinates, featureIndex: feature.index, reveal: otherRoads.length ? { kind: "place", connectingRoad: null, otherRoads } : null });
    }
  }
  for (const record of records.filter((record) => record.type === "district")) {
    for (const feature of record.features.filter((feature) => feature.role === "district_associated_road")) {
      if (!featureMatchesRoad(feature, road)) continue;
      markers.push({ id: `${record.id}:${feature.index}`, recordId: record.id, recordType: record.type, label: record.exam_name, associationLabel: feature.exam_name, coordinate: feature.effective_coordinates, featureIndex: feature.index, reveal: null });
    }
  }
  return markers.sort((left, right) => compareNames(left.label, right.label));
}

export function geometryForLearningFeature(geometry: RoadGeometryCollection, feature: LearningRecord["features"][number]): RoadGeometryCollection {
  const names = featureNames(feature);
  const ids = new Set([feature.road_link_id, ...(feature.road_link_ids ?? [])].filter(Boolean));
  const candidates = geometry.features.filter((candidate) => candidate.properties.names.some((name) => names.has(normaliseRoadName(name))));
  if (!ids.size) return { ...geometry, features: candidates };
  const byNode = new Map<string, RoadGeometryFeature[]>();
  for (const candidate of candidates) for (const node of [candidate.properties.start_node, candidate.properties.end_node]) {
    const entries = byNode.get(node) ?? [];
    entries.push(candidate);
    byNode.set(node, entries);
  }
  const selected = new Set<string>(), pending = candidates.filter((candidate) => ids.has(candidate.properties.road_link_id));
  pending.forEach((candidate) => selected.add(candidate.properties.road_link_id));
  while (pending.length) {
    const current = pending.pop()!;
    for (const node of [current.properties.start_node, current.properties.end_node]) for (const adjacent of byNode.get(node) ?? []) if (!selected.has(adjacent.properties.road_link_id)) {
      selected.add(adjacent.properties.road_link_id);
      pending.push(adjacent);
    }
  }
  let expanded = true;
  while (expanded) {
    expanded = false;
    const chosen = candidates.filter((candidate) => selected.has(candidate.properties.road_link_id));
    for (const candidate of candidates.filter((item) => !selected.has(item.properties.road_link_id))) {
      const candidateEnds = [candidate.geometry.coordinates[0], candidate.geometry.coordinates.at(-1)!];
      const gap = Math.min(...chosen.flatMap((item) => [item.geometry.coordinates[0], item.geometry.coordinates.at(-1)!]).flatMap((left) => candidateEnds.map((right) => metresBetween(left, right))));
      if (gap <= 100) { selected.add(candidate.properties.road_link_id); expanded = true; }
    }
  }
  return { ...geometry, features: candidates.filter((candidate) => selected.has(candidate.properties.road_link_id)) };
}

function combineRoadGeometry(
  geometry: RoadGeometryCollection,
  collections: RoadGeometryCollection[],
): RoadGeometryCollection {
  const selected = new Map<string, RoadGeometryFeature>();
  for (const collection of collections)
    for (const feature of collection.features)
      selected.set(feature.properties.road_link_id, feature);
  return { ...geometry, features: [...selected.values()] };
}

/**
 * Complete, role-aware overlays for teaching maps. Keeping middle and associated
 * roads separate lets consumers style them distinctly without redefining which
 * geometry belongs to either semantic role.
 */
export function geometryLayersForLearningRecord(
  geometry: RoadGeometryCollection,
  record: LearningRecord,
) {
  const middleRoad = combineRoadGeometry(
    geometry,
    record.features
      .filter((feature) => feature.role === "middle_road")
      .map((feature) => geometryForLearningFeature(geometry, feature)),
  );
  const associatedRoads = combineRoadGeometry(
    geometry,
    record.features
      .filter((feature) => ["associated_road", "terminal_road", "district_associated_road"].includes(feature.role))
      .map((feature) => geometryForLearningFeature(geometry, feature)),
  );
  return {
    middleRoad,
    associatedRoads,
    allRoads: combineRoadGeometry(geometry, [associatedRoads, middleRoad]),
  };
}

/** Complete role-aware road overlays for answer browsing. */
export function geometryForExplorerRecord(
  geometry: RoadGeometryCollection,
  record: LearningRecord,
): RoadGeometryCollection {
  return geometryLayersForLearningRecord(geometry, record).allRoads;
}

export function editablePointFeaturesForRecord(record: LearningRecord) {
  if (record.type !== "place") return record.features;
  const place = record.features.find((feature) => feature.role === "place");
  return place ? [place] : record.features.slice(0, 1);
}

export function buildRoadAtlas(
  topology: RoadTopology,
  geometry: RoadGeometryCollection,
): RoadAtlasEntry[] {
  const referencedIds = new Set(
    geometry.features.map((feature) => feature.properties.road_link_id),
  );
  const learningNames = new Set<string>();
  for (const link of topology.links) {
    if (referencedIds.has(link.id))
      link.names.filter(Boolean).forEach((name) => learningNames.add(name));
  }
  const grouped = new Map<string, RoadAtlasEntry>();

  for (const link of topology.links) {
    for (const name of link.names.filter((value) => learningNames.has(value))) {
      const entry = grouped.get(name) ?? {
        name,
        linkIds: [],
        lengthMetres: 0,
        roadFunctions: [],
        formsOfWay: [],
      };
      entry.linkIds.push(link.id);
      entry.lengthMetres += link.length_metres;
      if (!entry.roadFunctions.includes(link.road_function))
        entry.roadFunctions.push(link.road_function);
      if (!entry.formsOfWay.includes(link.form_of_way))
        entry.formsOfWay.push(link.form_of_way);
      grouped.set(name, entry);
    }
  }

  return [...grouped.values()]
    .map((entry) => ({
      ...entry,
      linkIds: entry.linkIds.sort(),
      roadFunctions: entry.roadFunctions.sort(compareNames),
      formsOfWay: entry.formsOfWay.sort(compareNames),
    }))
    .sort((left, right) => compareNames(left.name, right.name));
}

export function linksNamed(topology: RoadTopology, name: string) {
  return topology.links.filter((link) => link.names.includes(name));
}

export function nodeCoordinates(geometry: RoadGeometryCollection) {
  const coordinates = new Map<string, [number, number]>();
  for (const feature of geometry.features) {
    const line = feature.geometry.coordinates;
    if (!line.length) continue;
    coordinates.set(feature.properties.start_node, line[0]);
    coordinates.set(feature.properties.end_node, line[line.length - 1]);
  }
  return coordinates;
}

export function connectionsForRoad(
  topology: RoadTopology,
  selectedLinks: RoadLink[],
  geometry: RoadGeometryCollection,
  excludedNames: string[] = [],
): RoadConnection[] {
  const selectedIds = new Set(selectedLinks.map((link) => link.id));
  const nodes = new Set(
    selectedLinks.flatMap((link) => [link.start_node, link.end_node]),
  );
  const excluded = new Set([
    ...excludedNames,
    ...selectedLinks.flatMap((link) => link.names),
  ]);
  const coordinateByNode = nodeCoordinates(geometry);
  const grouped = new Map<string, RoadConnection>();

  for (const link of topology.links) {
    if (selectedIds.has(link.id)) continue;
    for (const nodeId of [link.start_node, link.end_node]) {
      if (!nodes.has(nodeId)) continue;
      for (const name of link.names.filter((value) => value && !excluded.has(value))) {
        const id = `${nodeId}:${name}`;
        const connection = grouped.get(id) ?? {
          id,
          name,
          nodeId,
          coordinate: coordinateByNode.get(nodeId) ?? null,
          adjacentLinkIds: [],
        };
        if (!connection.adjacentLinkIds.includes(link.id))
          connection.adjacentLinkIds.push(link.id);
        grouped.set(id, connection);
      }
    }
  }

  return [...grouped.values()]
    .map((connection) => ({
      ...connection,
      adjacentLinkIds: connection.adjacentLinkIds.sort(),
    }))
    .sort((left, right) =>
      compareNames(left.name, right.name) || left.nodeId.localeCompare(right.nodeId),
    );
}

export function filterRoadAtlas(entries: RoadAtlasEntry[], query: string) {
  const needle = query.trim().toLocaleLowerCase("en-GB");
  if (!needle) return entries;
  return entries.filter((entry) =>
    entry.name.toLocaleLowerCase("en-GB").includes(needle),
  );
}

export function geometryForRoad(
  geometry: RoadGeometryCollection,
  linkIds: string[],
): RoadGeometryCollection {
  const selected = new Set(linkIds);
  return {
    ...geometry,
    features: geometry.features.filter((feature) =>
      selected.has(feature.properties.road_link_id),
    ),
  };
}

export function linksForRoad(topology: RoadTopology, linkIds: string[]) {
  const selected = new Set(linkIds);
  return topology.links.filter((link) => selected.has(link.id));
}

export function junctionsForRoad(
  topology: RoadTopology,
  selectedLinks: RoadLink[],
): RoadJunction[] {
  const selectedIds = new Set(selectedLinks.map((link) => link.id));
  const selectedNodes = new Map<string, string[]>();
  for (const link of selectedLinks) {
    for (const node of [link.start_node, link.end_node]) {
      const ids = selectedNodes.get(node) ?? [];
      ids.push(link.id);
      selectedNodes.set(node, ids);
    }
  }

  const connectedByNode = new Map<string, Set<string>>();
  for (const link of topology.links) {
    for (const node of [link.start_node, link.end_node]) {
      if (!selectedNodes.has(node) || selectedIds.has(link.id)) continue;
      const names = connectedByNode.get(node) ?? new Set<string>();
      link.names.filter(Boolean).forEach((name) => names.add(name));
      connectedByNode.set(node, names);
    }
  }

  return [...selectedNodes.entries()]
    .map(([nodeId, selectedLinkIds]) => ({
      nodeId,
      selectedLinkIds: selectedLinkIds.sort(),
      connectedRoadNames: [...(connectedByNode.get(nodeId) ?? [])].sort(
        compareNames,
      ),
    }))
    .filter(
      (junction) =>
        junction.selectedLinkIds.length > 1 ||
        junction.connectedRoadNames.length > 0,
    )
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

export function roadFeatureCount(features: RoadGeometryFeature[]) {
  return new Set(features.map((feature) => feature.properties.road_link_id)).size;
}
