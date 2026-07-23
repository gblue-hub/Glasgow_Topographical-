import { bngToWgs84, nearestPointOnLine, wgs84ToBng } from './spatial.mjs';

const TRANSFORMATION_VERSION = 'middle-road-binding.v1.0.0';
const round = (coordinate) => coordinate.map((value) => Number(value.toFixed(8)));
const lineLength = (line) => line.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - line[index][0], point[1] - line[index][1]), 0);

function linksFor(roads, name, aliases = {}) {
  return roads.index.get(roads.normalize(aliases[name] ?? name)) ?? [];
}

function nearestLink(links, point) {
  return links.map((link) => ({ link, ...nearestPointOnLine(point, link.coordinates) }))
    .sort((a, b) => a.distance - b.distance || a.link.id.localeCompare(b.link.id))[0];
}

function sharedNodes(leftLinks, rightLinks) {
  const right = new Set(rightLinks.flatMap((link) => [link.start_node, link.end_node]));
  const found = [];
  for (const link of leftLinks) for (const node of [link.start_node, link.end_node]) if (right.has(node)) {
    found.push({ node, coordinate: node === link.start_node ? link.coordinates[0] : link.coordinates.at(-1), targetLinkId: link.id });
  }
  return [...new Map(found.map((item) => [item.node, item])).values()];
}

function chooseNearest(candidates, original) {
  const point = wgs84ToBng(original);
  return candidates.map((item) => ({ ...item, distance: Math.hypot(point.x - item.coordinate[0], point.y - item.coordinate[1]) }))
    .sort((a, b) => a.distance - b.distance || String(a.node ?? a.targetLinkId).localeCompare(String(b.node ?? b.targetLinkId)))[0];
}

function graphFor(links) {
  const graph = new Map();
  for (const link of links) for (const [from, to, reverse] of [[link.start_node, link.end_node, false], [link.end_node, link.start_node, true]]) {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push({ to, link, reverse, weight: link.length ?? lineLength(link.coordinates) });
  }
  return graph;
}

function search(graph, start, finish = null, allowed = null) {
  const distances = new Map([[start, 0]]), previous = new Map(), pending = new Set([start]);
  while (pending.size) {
    let current;
    for (const node of pending) if (current == null || distances.get(node) < distances.get(current)) current = node;
    pending.delete(current);
    if (current === finish) break;
    for (const edge of graph.get(current) ?? []) {
      if (allowed && !allowed.has(edge.to)) continue;
      const candidate = distances.get(current) + edge.weight;
      if (candidate < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, candidate);
        previous.set(edge.to, { node: current, edge });
        pending.add(edge.to);
      }
    }
  }
  return { distances, previous };
}

function pathBetween(graph, start, finish, allowed = null) {
  const result = search(graph, start, finish, allowed);
  if (!result.distances.has(finish)) return null;
  const path = [];
  for (let current = finish; current !== start;) {
    const step = result.previous.get(current);
    if (!step) return null;
    path.push(step.edge);
    current = step.node;
  }
  return path.reverse();
}

function midpoint(path) {
  const lines = path.map((edge) => edge.reverse ? [...edge.link.coordinates].reverse() : edge.link.coordinates);
  let remaining = lines.reduce((sum, line) => sum + lineLength(line), 0) / 2;
  for (const line of lines) for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1], b = line[index], segment = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= segment) return [a[0] + (b[0] - a[0]) * remaining / segment, a[1] + (b[1] - a[1]) * remaining / segment];
    remaining -= segment;
  }
  return lines.at(-1)?.at(-1);
}

function component(graph, start) {
  const seen = new Set([start]), stack = [start];
  while (stack.length) for (const edge of graph.get(stack.pop()) ?? []) if (!seen.has(edge.to)) { seen.add(edge.to); stack.push(edge.to); }
  return seen;
}

function roadMidpoint(links, original) {
  const closest = nearestLink(links, wgs84ToBng(original));
  if (!closest) return null;
  const graph = graphFor(links), nodes = component(graph, closest.link.start_node);
  const farthest = (result) => [...result.distances].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const endA = farthest(search(graph, [...nodes].sort()[0], null, nodes));
  const endB = farthest(search(graph, endA, null, nodes));
  return midpoint(pathBetween(graph, endA, endB, nodes));
}

function linkComponents(links) {
  const byNode = new Map();
  for (const link of links) for (const node of [link.start_node, link.end_node]) {
    if (!byNode.has(node)) byNode.set(node, []);
    byNode.get(node).push(link);
  }
  const seen = new Set(), components = [];
  for (const link of links) if (!seen.has(link.id)) {
    const current = [], pending = [link];
    seen.add(link.id);
    while (pending.length) {
      const item = pending.pop();
      current.push(item);
      for (const node of [item.start_node, item.end_node]) for (const adjacent of byNode.get(node) ?? []) if (!seen.has(adjacent.id)) {
        seen.add(adjacent.id);
        pending.push(adjacent);
      }
    }
    components.push(current.sort((a, b) => a.id.localeCompare(b.id)));
  }
  return components.sort((a, b) => a[0].id.localeCompare(b[0].id));
}

function componentGap(left, right) {
  let best = Number.POSITIVE_INFINITY;
  for (const link of left) for (const coordinate of [link.coordinates[0], link.coordinates.at(-1)]) {
    const point = { x: coordinate[0], y: coordinate[1] };
    for (const candidate of right) best = Math.min(best, nearestPointOnLine(point, candidate.coordinates).distance);
  }
  return best;
}

function corridorClusters(links, joinGapMetres) {
  const components = linkComponents(links), parent = components.map((_, index) => index);
  const find = (index) => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const join = (left, right) => {
    const a = find(left), b = find(right);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };
  for (let left = 0; left < components.length; left += 1) for (let right = left + 1; right < components.length; right += 1) {
    if (componentGap(components[left], components[right]) <= joinGapMetres) join(left, right);
  }
  const grouped = new Map();
  components.forEach((linksInComponent, index) => {
    const key = find(index);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(...linksInComponent);
  });
  return [...grouped.values()].map((cluster) => cluster.sort((a, b) => a.id.localeCompare(b.id)))
    .sort((a, b) => a[0].id.localeCompare(b[0].id));
}

function selectCorridor(links, sourceCoordinates, policy) {
  const points = sourceCoordinates.map(wgs84ToBng), clusters = corridorClusters(links, policy.component_join_gap_metres);
  const ranked = clusters.map((cluster) => {
    const distances = points.map((point) => nearestLink(cluster, point).distance);
    const supportCount = distances.filter((distance) => distance <= policy.point_support_metres).length;
    const middleSupported = distances[0] <= policy.point_support_metres ? 1 : 0;
    const weightedDistance = Math.min(distances[0], policy.distance_cap_metres) * policy.middle_point_weight
      + distances.slice(1).reduce((sum, distance) => sum + Math.min(distance, policy.distance_cap_metres), 0);
    return { cluster, distances, supportCount, middleSupported, weightedDistance, key: cluster[0].id };
  }).sort((a, b) => b.supportCount - a.supportCount || b.middleSupported - a.middleSupported || a.weightedDistance - b.weightedDistance || a.key.localeCompare(b.key));
  return { selected: ranked[0], alternatives: ranked.slice(1).map((item) => ({ key: item.key, supportCount: item.supportCount, middleSupported: Boolean(item.middleSupported), weightedDistanceMetres: Number(item.weightedDistance.toFixed(2)), pointDistancesMetres: item.distances.map((value) => Number(value.toFixed(2))) })) };
}

function terminalAnchor(targetLinks, terminalLinks, sourceCoordinate) {
  const junction = terminalLinks.length ? chooseNearest(sharedNodes(targetLinks, terminalLinks), sourceCoordinate) : null;
  if (junction) return { coordinate: junction.coordinate, targetLinkId: junction.targetLinkId, terminalRoadLinkId: nearestLink(terminalLinks, { x: junction.coordinate[0], y: junction.coordinate[1] }).link.id, method: 'terminal_shared_node', sharedNode: junction.node, sourceDistanceMetres: junction.distance };
  const projected = nearestLink(targetLinks, wgs84ToBng(sourceCoordinate));
  return { coordinate: projected.coordinate, targetLinkId: projected.link.id, terminalRoadLinkId: null, method: terminalLinks.length ? 'terminal_point_projected_no_shared_node' : 'named_endpoint_projected_to_target', sharedNode: null, sourceDistanceMetres: projected.distance };
}

function relevantLinks(targetLinks, anchors) {
  const graph = graphFor(targetLinks), choices = [];
  const nodesFor = (anchor) => {
    const link = targetLinks.find((candidate) => candidate.id === anchor.targetLinkId);
    return [link.start_node, link.end_node];
  };
  for (const start of nodesFor(anchors[0])) for (const finish of nodesFor(anchors[1])) {
    const path = pathBetween(graph, start, finish);
    if (path) choices.push(path);
  }
  const path = choices.sort((a, b) => a.reduce((sum, edge) => sum + edge.weight, 0) - b.reduce((sum, edge) => sum + edge.weight, 0) || a.map((edge) => edge.link.id).join().localeCompare(b.map((edge) => edge.link.id).join()))[0];
  const ids = new Set([anchors[0].targetLinkId, anchors[1].targetLinkId, ...(path ?? []).map((edge) => edge.link.id)]);
  return { linkIds: [...ids].sort(), connectedPath: path ?? null };
}

function middleRoadBinding(sectionCode, category, features, roads, aliases, policy) {
  const targetName = aliases[features[0].properties.Street] ?? features[0].properties.Street;
  const targetCandidates = linksFor(roads, features[0].properties.Street, aliases);
  if (!targetCandidates.length) return { unresolved: { sectionCode, category, reason: 'middle_road_target_name_unmatched', targetName } };
  const selection = selectCorridor(targetCandidates, features.map((feature) => feature.geometry.coordinates), policy);
  const selected = selection.selected.cluster;
  const sourcePoints = features.map((feature) => wgs84ToBng(feature.geometry.coordinates));
  const topologyComponents = linkComponents(selected).map((links) => ({
    links,
    pointDistancesMetres: sourcePoints.map((point) => nearestLink(links, point).distance),
  })).sort((a, b) => a.pointDistancesMetres[0] - b.pointDistancesMetres[0] || a.links[0].id.localeCompare(b.links[0].id));
  const displayComponent = topologyComponents[0];
  const anchors = [1, 2].map((index) => terminalAnchor(selected, linksFor(roads, features[index].properties.Street, aliases), features[index].geometry.coordinates));
  const relevant = relevantLinks(selected, anchors);
  const midpointCoordinate = relevant.connectedPath?.length ? midpoint(relevant.connectedPath) : nearestLink(selected, wgs84ToBng(features[0].geometry.coordinates)).coordinate;
  const confidence = selection.selected.supportCount === 3 ? 'high' : selection.selected.middleSupported && selection.selected.supportCount >= 2 ? 'medium' : 'review';
  return {
    binding: {
      transformation_version: TRANSFORMATION_VERSION,
      sectionCode,
      category,
      targetExamName: features[0].properties.Street,
      targetMapName: targetName,
      selectionMethod: 'curated_point_supported_named_corridor',
      selectedCorridorKey: selection.selected.key,
      selectedCorridorLinkIds: selected.map((link) => link.id),
      displayComponentLinkIds: displayComponent.links.map((link) => link.id),
      selectedTopologyComponentCount: topologyComponents.length,
      disconnectedPointSupportedComponents: topologyComponents.slice(1).filter((component) => component.pointDistancesMetres.some((distance) => distance <= policy.point_support_metres)).map((component) => ({
        key: component.links[0].id,
        linkIds: component.links.map((link) => link.id),
        pointDistancesMetres: component.pointDistancesMetres.map((distance) => Number(distance.toFixed(2))),
      })),
      relevantPathLinkIds: relevant.linkIds,
      pathStatus: relevant.connectedPath ? 'connected_named_path' : 'selected_corridor_anchor_fallback',
      sourcePointDistancesMetres: selection.selected.distances.map((value) => Number(value.toFixed(2))),
      supportCount: selection.selected.supportCount,
      confidence,
      alternatives: selection.alternatives,
      anchors: anchors.map((anchor, offset) => ({ index: offset + 1, method: anchor.method, targetRoadLinkId: anchor.targetLinkId, terminalRoadLinkId: anchor.terminalRoadLinkId, sharedNode: anchor.sharedNode, sourceDistanceMetres: Number(anchor.sourceDistanceMetres.toFixed(2)) })),
    },
    coordinates: [midpointCoordinate, anchors[0].coordinate, anchors[1].coordinate],
  };
}

export function applySemanticGeometry(corrected, roads, decisionByTarget, globalAliases = {}, policy = { component_join_gap_metres: 100, point_support_metres: 100, distance_cap_metres: 1000, middle_point_weight: 2 }) {
  const transformations = [], unresolved = [], middleRoadBindings = [];
  const set = (sectionCode, category, index, coordinate, method, evidence) => {
    const target = corrected[sectionCode].categories[category][index], before = target.geometry.coordinates;
    const after = round(bngToWgs84({ x: coordinate[0], y: coordinate[1] }));
    target.geometry.coordinates = after;
    transformations.push({ transformationVersion: TRANSFORMATION_VERSION, sectionCode, category, index, method, before, after, evidence });
  };
  for (const [sectionCode, section] of Object.entries(corrected)) for (const [category, features] of Object.entries(section.categories)) {
    const reviewedAliases = decisionByTarget.get(`${sectionCode}/${category}`)?.map_aliases ?? {};
    const aliases = 'EFGHI'.includes(sectionCode) ? { ...globalAliases, ...reviewedAliases } : reviewedAliases;
    if ('EFGHI'.includes(sectionCode)) {
      const result = middleRoadBinding(sectionCode, category, features, roads, aliases, policy);
      if (result.unresolved) { unresolved.push(result.unresolved); continue; }
      middleRoadBindings.push(result.binding);
      result.coordinates.forEach((coordinate, index) => set(sectionCode, category, index, coordinate, index === 0 ? 'middle_of_point_selected_road_corridor' : result.binding.anchors[index - 1].method, { bindingVersion: TRANSFORMATION_VERSION, selectedCorridorKey: result.binding.selectedCorridorKey, relevantPathLinkIds: result.binding.relevantPathLinkIds, ...(index ? result.binding.anchors[index - 1] : {}) }));
    } else if ('ABCD'.includes(sectionCode)) {
      features.forEach((feature, index) => {
        const links = linksFor(roads, feature.properties.Street, aliases), center = links.length ? roadMidpoint(links, feature.geometry.coordinates) : null;
        if (center) set(sectionCode, category, index, center, 'district_road_midpoint', { matchedName: aliases[feature.properties.Street] ?? feature.properties.Street });
        else unresolved.push({ sectionCode, category, index, reason: 'district_road_unmatched' });
      });
    } else {
      const place = wgs84ToBng(features[0].geometry.coordinates);
      features.slice(1).forEach((feature, offset) => {
        const index = offset + 1, links = linksFor(roads, feature.properties.Street, aliases);
        if (!links.length) return;
        const current = nearestLink(links, wgs84ToBng(feature.geometry.coordinates));
        if (current.distance <= 100) return;
        const nearest = nearestLink(links, place);
        set(sectionCode, category, index, nearest.coordinate, 'place_associated_road_nearest_to_place', { roadLinkId: nearest.link.id, previousDistanceMetres: Number(current.distance.toFixed(2)) });
      });
    }
  }
  return { transformations, unresolved, middleRoadBindings };
}
