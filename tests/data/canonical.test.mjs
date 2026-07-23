import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceBytes = await readFile('data/source/glasgow-taxis.json');
const source = JSON.parse(sourceBytes);
const canonical = JSON.parse(await readFile('data/generated/canonical-records.v1.json'));
const spatial = JSON.parse(await readFile('data/reports/spatial-validation.v1.json'));
const preservation = JSON.parse(await readFile('data/reports/preservation.v1.json'));
const records = canonical.records;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const coordinateUpdates = (
  await readFile('data/decisions/coordinate-updates.v1.jsonl', 'utf8')
    .catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
)
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

test('treats the canonical JSON as the exact coordinate authority', () => {
  assert.equal(preservation.source_sha256, digest(sourceBytes));
  assert.equal(preservation.canonical_source_mutated, false);

  for (const record of records) {
    const sourceFeatures = source[record.section.code].categories[record.exam_name];
    assert.deepEqual(record.source.raw_features, sourceFeatures);
    assert.equal(record.features.length, sourceFeatures.length);
    record.features.forEach((feature, index) => {
      assert.deepEqual(feature.original_coordinates, sourceFeatures[index].geometry.coordinates);
      assert.deepEqual(feature.effective_coordinates, sourceFeatures[index].geometry.coordinates);
    });
  }
});

test('accounts for every record with one stable unique identity and type', () => {
  assert.equal(records.length, 1672);
  assert.equal(new Set(records.map((record) => record.id)).size, 1672);
  const counts = Object.fromEntries(
    ['place', 'middle_road', 'district'].map((type) => [
      type,
      records.filter((record) => record.type === type).length,
    ]),
  );
  assert.deepEqual(counts, { place: 1236, middle_road: 282, district: 154 });
});

test('contains the accepted fixes directly in the canonical source', () => {
  assert.deepEqual(
    source.U.categories['Castlemilk Sports Centre'].map((feature) => feature.properties.Street),
    ['Castlemilk Sports Centre', 'Dougrie Road', 'Castlemilk Drive'],
  );
  assert.deepEqual(
    source.W.categories['Baillieston Health Centre'].map((feature) => feature.properties.Street),
    ['Baillieston Health Centre', 'Muirside Road', 'Millar Street'],
  );
  assert.deepEqual(
    source.Q.categories['Popworld Nightclub'][0].geometry.coordinates,
    [-4.256172328349216, 55.862398137635914],
  );
  assert.deepEqual(
    source.T.categories['B&Q Forge'][0].geometry.coordinates,
    [-4.209380736233494, 55.856273669202146],
  );
});

test('uses coordinate history as audit metadata, never as a source overlay', () => {
  const latestUpdates = new Map(
    coordinateUpdates.map((edit) => [
      `${edit.sectionCode}/${edit.category}/${edit.featureIndex}`,
      edit,
    ]),
  );
  for (const record of records) {
    for (const feature of record.features) {
      const edit = latestUpdates.get(
        `${record.section.code}/${record.exam_name}/${feature.index}`,
      );
      const sourceCoordinates =
        source[record.section.code].categories[record.exam_name][feature.index]
          .geometry.coordinates;
      const matchesAudit =
        edit && JSON.stringify(edit.coordinates) === JSON.stringify(sourceCoordinates);
      assert.equal(
        feature.provenance.kind,
        matchesAudit ? 'owner_coordinate_edit' : 'source',
      );
    }
  }
});

test('keeps matching-only aliases out of exam text', () => {
  const record = records.find(
    (candidate) => candidate.exam_name === 'Baillieston Health Centre',
  );
  const millar = record.features.find(
    (feature) => feature.exam_name === 'Millar Street',
  );
  assert.equal(millar.exam_name, 'Millar Street');
});

test('retains road bindings as display metadata without replacing source coordinates', () => {
  const middleRoads = records.filter((record) => record.type === 'middle_road');
  assert.equal(middleRoads.length, 282);
  assert.equal(
    middleRoads.filter(
      (record) =>
        record.geometry_binding?.transformation_version ===
        'middle-road-binding.v1.0.0',
    ).length,
    282,
  );
  for (const record of middleRoads) {
    assert.ok(record.geometry_binding.displayComponentLinkIds.length > 0);
    record.features.forEach((feature, index) => {
      assert.deepEqual(
        feature.effective_coordinates,
        source[record.section.code].categories[record.exam_name][index].geometry
          .coordinates,
      );
    });
  }
});

test('publishes spatial validation without using it to modify the source', () => {
  assert.equal(spatial.calibration_warning, false);
  assert.ok(spatial.aligned_rate_of_named_road_features >= 90);
  assert.equal(preservation.effective_placeholder_features.length, 0);
});
