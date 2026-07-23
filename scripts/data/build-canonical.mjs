import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pointToLineDistance, readGpkgGeometry, wgs84ToBng } from './lib/spatial.mjs';
import { applySemanticGeometry } from './lib/semantic-geometry.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SOURCE = path.join(ROOT, 'data', 'source', 'glasgow-taxis.json');
const ROADS = path.join(ROOT, 'data', 'source', 'spatial', 'oproads_glasgow.gpkg');
const MAP_ALIASES = path.join(ROOT, 'data', 'decisions', 'map-aliases.v1.json');
const MIDDLE_ROAD_POLICY = path.join(ROOT, 'data', 'decisions', 'middle-road-binding-policy.v1.json');
const COORDINATE_UPDATES = path.join(ROOT, 'data', 'decisions', 'coordinate-updates.v1.jsonl');
const OUTPUT = path.join(ROOT, 'data', 'generated');
const REPORTS = path.join(ROOT, 'data', 'reports');
const PLACEHOLDER = '-4.2,55.8';

const normalize = (value) => value.normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ')
  .replace(/^(?:st|saint)\s+/, 'saint ').replace(/\brd\b/g, 'road').replace(/\bst\b$/g, 'street').replace(/\bave\b/g, 'avenue').replace(/\bdr\b/g, 'drive')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const percentile = (values, ratio) => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * ratio))] : null;

function typeFor(sectionCode) {
  if ('ABCD'.includes(sectionCode)) return 'district';
  if ('EFGHI'.includes(sectionCode)) return 'middle_road';
  return 'place';
}

function roleFor(type, index) {
  if (type === 'place') return index === 0 ? 'place' : 'associated_road';
  if (type === 'middle_road') return index === 0 ? 'middle_road' : 'terminal_road';
  return 'district_associated_road';
}

function loadRoads() {
  const db = new DatabaseSync(ROADS, { readOnly: true });
  const rows = db.prepare('SELECT id,name_1,name_2,start_node,end_node,geom FROM glasgow_roads ORDER BY id').all();
  db.close();
  const index = new Map();
  const links = rows.map((row) => ({ ...row, coordinates: readGpkgGeometry(row.geom).coordinates }));
  for (const link of links) for (const name of [link.name_1, link.name_2].filter(Boolean)) {
    const key = normalize(name);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(link);
  }
  return { links, index, normalize };
}

function validateFeature(roads, item, aliases, semanticBinding = null) {
  if (item.role === 'place') return { status: 'not_a_road' };
  const mapName = aliases[item.exam_name] ?? item.exam_name;
  const links = roads.index.get(normalize(mapName));
  if (!links?.length && item.role === 'terminal_road' && semanticBinding) return {
    status: 'named_endpoint_anchor',
    mapName,
    distanceMetres: semanticBinding.sourceDistanceMetres,
    roadLinkId: semanticBinding.targetRoadLinkId,
    candidateCount: 0,
    bindingMethod: semanticBinding.method,
  };
  if (!links?.length) return { status: 'road_name_unmatched', mapName };
  const point = wgs84ToBng(item.effective_coordinates);
  const ranked = links.map((link) => ({ link, distance: pointToLineDistance(point, link.coordinates) })).sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const status = best.distance <= 100 ? 'aligned' : best.distance <= 250 ? 'review' : 'outlier';
  return { status, mapName, distanceMetres: Number(best.distance.toFixed(2)), roadLinkId: best.link.id, candidateCount: links.length };
}

async function main() {
  const sourceBytes = await fs.readFile(SOURCE);
  const source = JSON.parse(sourceBytes);
  const mapAliases = JSON.parse(await fs.readFile(MAP_ALIASES, 'utf8'));
  const middleRoadPolicy = JSON.parse(await fs.readFile(MIDDLE_ROAD_POLICY, 'utf8'));
  const roads = loadRoads();
  const geometryInput = structuredClone(source);
  const semantic = applySemanticGeometry(geometryInput, roads, new Map(), mapAliases.aliases, middleRoadPolicy.selection);
  const coordinateUpdatesText = await fs.readFile(COORDINATE_UPDATES, 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error));
  const coordinateUpdates = coordinateUpdatesText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const coordinateEditByFeature = new Map();
  for (const edit of coordinateUpdates) {
    const target = source[edit.sectionCode]?.categories?.[edit.category]?.[edit.featureIndex];
    if (!target) throw new Error(`Coordinate update target not found: ${edit.sectionCode}/${edit.category}/${edit.featureIndex}`);
    if (target.properties.Street !== edit.featureName) throw new Error(`Coordinate update feature mismatch: ${edit.sectionCode}/${edit.category}/${edit.featureIndex}`);
    coordinateEditByFeature.set(`${edit.sectionCode}/${edit.category}/${edit.featureIndex}`, edit);
  }
  const middleBindingByTarget = new Map(semantic.middleRoadBindings.map((item) => [`${item.sectionCode}/${item.category}`, item]));
  const records = [];
  const validations = [];
  for (const [sectionCode, section] of Object.entries(source)) for (const [category, sourceFeatures] of Object.entries(section.categories)) {
    const type = typeFor(sectionCode);
    const middleRoadBinding = middleBindingByTarget.get(`${sectionCode}/${category}`);
    const canonicalFeatures = sourceFeatures.map((current, index) => {
      const coordinateEdit = coordinateEditByFeature.get(`${sectionCode}/${category}/${index}`);
      const coordinateMatchesAudit = coordinateEdit &&
        JSON.stringify(current.geometry.coordinates) === JSON.stringify(coordinateEdit.coordinates);
      const aliases = type === 'middle_road' ? mapAliases.aliases : {};
      const item = {
        index,
        role: roleFor(type, index),
        exam_name: current.properties.Street,
        map_name: normalize(aliases[current.properties.Street] ?? current.properties.Street),
        postcode: current.properties.Postcode,
        original_coordinates: current.geometry.coordinates,
        effective_coordinates: current.geometry.coordinates,
        provenance: coordinateMatchesAudit
          ? { kind: 'owner_coordinate_edit', recorded_at: coordinateEdit.recorded_at, before: coordinateEdit.previousCoordinates, audit_file: 'data/decisions/coordinate-updates.v1.jsonl' }
          : { kind: 'source', json_pointer: `/${sectionCode}/categories/${category}/${index}` },
      };
      const validation = validateFeature(roads, item, aliases, middleRoadBinding?.anchors.find((anchor) => anchor.index === index));
      validations.push({ sectionCode, category, ...item, validation });
      return { ...item, spatial_validation: validation };
    });
    records.push({
      schema_version: '1.0.0',
      id: `gt:v1:${type}:${sectionCode.toLowerCase()}:${digest(`${sectionCode}\0${category}`).slice(0, 16)}`,
      type,
      section: { code: sectionCode, name: section.name },
      exam_name: category,
      map_name: normalize(category),
      source: { dataset_sha256: digest(sourceBytes), json_pointer: `/${sectionCode}/categories/${category}`, raw_features: sourceFeatures },
      review_state: sourceFeatures.some((feature, index) => {
        const edit = coordinateEditByFeature.get(`${sectionCode}/${category}/${index}`);
        return edit && JSON.stringify(feature.geometry.coordinates) === JSON.stringify(edit.coordinates);
      }) ? 'owner_coordinate_edit_applied' : middleRoadBinding ? 'geometry_binding_available' : 'canonical_source',
      ...(middleRoadBinding ? { geometry_binding: middleRoadBinding } : {}),
      features: canonicalFeatures,
    });
  }
  const roadValidations = validations.filter((item) => item.role !== 'place');
  const statuses = ['aligned', 'review', 'outlier', 'road_name_unmatched', 'named_endpoint_anchor'];
  const counts = Object.fromEntries(statuses.map((status) => [status, roadValidations.filter((item) => item.validation.status === status).length]));
  const gwr = roadValidations.filter((item) => normalize(item.validation.mapName ?? '') === 'great western road' && item.validation.distanceMetres != null);
  const gwrDistances = gwr.map((item) => item.validation.distanceMetres).sort((a, b) => a - b);
  const ids = records.map((record) => record.id);
  const placeholderEffective = validations.filter((item) => item.effective_coordinates.join(',') === PLACEHOLDER);
  const report = {
    report_version: '1.0.0',
    thresholds_metres: { aligned_max: 100, review_max: 250 },
    totals: { records: records.length, features: validations.length, road_features: roadValidations.length, ...counts },
    aligned_rate_of_named_road_features: Number((counts.aligned / Math.max(1, roadValidations.length - counts.road_name_unmatched - counts.named_endpoint_anchor) * 100).toFixed(2)),
    calibration_warning: counts.outlier > roadValidations.length * 0.1,
    great_western_road_calibration: {
      count: gwr.length,
      min: percentile(gwrDistances, 0), median: percentile(gwrDistances, 0.5), p90: percentile(gwrDistances, 0.9), p95: percentile(gwrDistances, 0.95), max: percentile(gwrDistances, 1),
      review_or_outlier: gwr.filter((item) => item.validation.status !== 'aligned'),
    },
    outliers: roadValidations.filter((item) => ['review', 'outlier'].includes(item.validation.status)),
    unmatched: roadValidations.filter((item) => item.validation.status === 'road_name_unmatched'),
    named_endpoint_anchors: roadValidations.filter((item) => item.validation.status === 'named_endpoint_anchor'),
  };
  const preservation = {
    source_sha256: digest(sourceBytes),
    source_records: Object.values(source).reduce((sum, section) => sum + Object.keys(section.categories).length, 0),
    canonical_records: records.length,
    unique_ids: new Set(ids).size,
    duplicate_ids: ids.filter((id, index) => ids.indexOf(id) !== index),
    coordinate_audit_entries: coordinateUpdates.length,
    semantic_unresolved: semantic.unresolved,
    middle_road_bindings: semantic.middleRoadBindings,
    effective_placeholder_features: placeholderEffective,
    canonical_source_mutated: false,
  };
  await fs.mkdir(OUTPUT, { recursive: true });
  await fs.mkdir(REPORTS, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(OUTPUT, 'canonical-records.v1.json'), `${JSON.stringify({ schema_version: '1.0.0', records }, null, 2)}\n`),
    fs.writeFile(path.join(REPORTS, 'spatial-validation.v1.json'), `${JSON.stringify(report, null, 2)}\n`),
    fs.writeFile(path.join(REPORTS, 'preservation.v1.json'), `${JSON.stringify(preservation, null, 2)}\n`),
    fs.writeFile(path.join(REPORTS, 'middle-road-validation.v1.json'), `${JSON.stringify({
      report_version: '1.0.0',
      transformation_version: 'middle-road-binding.v1.0.0',
      policy: middleRoadPolicy,
      totals: {
        records: semantic.middleRoadBindings.length + semantic.unresolved.filter((item) => 'EFGHI'.includes(item.sectionCode)).length,
        bound: semantic.middleRoadBindings.length,
        unresolved: semantic.unresolved.filter((item) => 'EFGHI'.includes(item.sectionCode)).length,
        confidence: Object.fromEntries(['high', 'medium', 'review'].map((level) => [level, semantic.middleRoadBindings.filter((item) => item.confidence === level).length])),
        connected_named_paths: semantic.middleRoadBindings.filter((item) => item.pathStatus === 'connected_named_path').length,
        anchor_fallback_paths: semantic.middleRoadBindings.filter((item) => item.pathStatus !== 'connected_named_path').length,
        named_endpoint_anchors: semantic.middleRoadBindings.flatMap((item) => item.anchors).filter((item) => item.method === 'named_endpoint_projected_to_target').length,
        multipart_selected_corridors: semantic.middleRoadBindings.filter((item) => item.selectedTopologyComponentCount > 1).length,
        disconnected_point_supported_corridors: semantic.middleRoadBindings.filter((item) => item.disconnectedPointSupportedComponents.length > 0).length,
      },
      unresolved: semantic.unresolved.filter((item) => 'EFGHI'.includes(item.sectionCode)),
      multipart_or_disconnected: semantic.middleRoadBindings.filter((item) => item.selectedTopologyComponentCount > 1 || item.disconnectedPointSupportedComponents.length > 0).map((item) => ({
        sectionCode: item.sectionCode,
        category: item.category,
        selectedTopologyComponentCount: item.selectedTopologyComponentCount,
        displayComponentLinkIds: item.displayComponentLinkIds,
        disconnectedPointSupportedComponents: item.disconnectedPointSupportedComponents,
      })),
      bindings: semantic.middleRoadBindings,
    }, null, 2)}\n`),
  ]);
  console.log(JSON.stringify({ records: records.length, features: validations.length, counts, alignedRate: report.aligned_rate_of_named_road_features, greatWesternRoad: report.great_western_road_calibration }, null, 2));
}

await main();
