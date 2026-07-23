import { describe, expect, it } from "vitest";
import {
  buildDatasetRoadAtlas,
  buildRoadAtlas,
  datasetMarkersForRoad,
  filterRoadAtlas,
  geometryForExplorerRecord,
  geometryForLearningFeature,
  geometryLayersForLearningRecord,
  junctionsForRoad,
  editablePointFeaturesForRecord,
} from "./roads";
import type { LearningRecord, RoadGeometryCollection, RoadTopology } from "./types";

const topology: RoadTopology = {
  schema_version: "1.0.0",
  links: [
    { id: "a", names: ["Alpha Road"], start_node: "1", end_node: "2", length_metres: 100, road_function: "A Road", form_of_way: "Single Carriageway" },
    { id: "b", names: ["Alpha Road"], start_node: "2", end_node: "3", length_metres: 70, road_function: "A Road", form_of_way: "Single Carriageway" },
    { id: "c", names: ["Cross Street"], start_node: "2", end_node: "4", length_metres: 40, road_function: "Local Road", form_of_way: "Single Carriageway" },
    { id: "p", names: ["Place Side Road"], start_node: "4", end_node: "5", length_metres: 60, road_function: "Local Road", form_of_way: "Single Carriageway" },
    { id: "unused", names: ["Not Learned"], start_node: "8", end_node: "9", length_metres: 20, road_function: "Local Road", form_of_way: "Single Carriageway" },
  ],
};
const geometry: RoadGeometryCollection = {
  type: "FeatureCollection",
  schema_version: "1.0.0",
  features: ["a", "b", "c", "p"].map((id) => ({
    type: "Feature",
    id,
    properties: { road_link_id: id, names: topology.links.find((link) => link.id === id)?.names || [], start_node: topology.links.find((link) => link.id === id)?.start_node || "", end_node: topology.links.find((link) => link.id === id)?.end_node || "" },
    geometry: { type: "LineString", coordinates: [[-4.2, 55.8], [-4.1, 55.9]] },
  })),
};
const middleRoadRecord: LearningRecord = {
  id: "middle-1",
  type: "middle_road",
  section: { code: "E", name: "MAIN ROADS (EAST)" },
  exam_name: "Cross Street",
  review_state: "reviewed",
  features: [
    { index: 0, role: "middle_road", exam_name: "Cross Street", map_name: "cross street", postcode: "", effective_coordinates: [-4.15, 55.85], road_link_id: "c", spatial_status: "aligned" },
    { index: 1, role: "terminal_road", exam_name: "Alpha Road", map_name: "alpha road", postcode: "", effective_coordinates: [-4.2, 55.8], road_link_id: "a", spatial_status: "aligned" },
    { index: 2, role: "terminal_road", exam_name: "Not Learned", map_name: "not learned", postcode: "", effective_coordinates: [-4.1, 55.9], road_link_id: "unused", spatial_status: "aligned" },
  ],
};
const unrelatedPlace: LearningRecord = {
  ...middleRoadRecord,
  id: "place-1",
  type: "place",
  exam_name: "Unrelated Place",
  features: [
    { ...middleRoadRecord.features[0], role: "place", exam_name: "Unrelated Place" },
    { ...middleRoadRecord.features[1], role: "associated_road", exam_name: "Alpha Road" },
    { ...middleRoadRecord.features[2], index: 2, role: "associated_road", exam_name: "Place Side Road", map_name: "place side road", road_link_id: "p" },
  ],
};

describe("road atlas", () => {
  it("groups only learning-bound links under their named road", () => {
    const atlas = buildRoadAtlas(topology, geometry);
    expect(atlas.find((road) => road.name === "Alpha Road")).toMatchObject({ linkIds: ["a", "b"], lengthMetres: 170 });
    expect(atlas.some((road) => road.name === "Not Learned")).toBe(false);
  });

  it("searches road names case-insensitively", () => {
    expect(filterRoadAtlas(buildRoadAtlas(topology, geometry), "cross").map((road) => road.name)).toEqual(["Cross Street"]);
  });

  it("derives named roads connected at shared topology nodes", () => {
    const junctions = junctionsForRoad(topology, topology.links.slice(0, 2));
    expect(junctions.find((item) => item.nodeId === "2")?.connectedRoadNames).toEqual(["Cross Street"]);
  });

  it("offers only roads shared by more than one dataset record as main roads", () => {
    const atlas = buildDatasetRoadAtlas([middleRoadRecord, unrelatedPlace], topology, geometry);
    expect(atlas.map((road) => road.name)).toEqual(["Alpha Road"]);
    expect(atlas.find((road) => road.name === "Alpha Road")).toMatchObject({ linkIds: ["a", "b"], connectionCount: 2 });
  });

  it("shows every dataset connection and gives middle-road markers their reveal", () => {
    const atlas = buildDatasetRoadAtlas([middleRoadRecord, unrelatedPlace], topology, geometry);
    const alpha = atlas.find((road) => road.name === "Alpha Road")!;
    const markers = datasetMarkersForRoad([middleRoadRecord, unrelatedPlace], alpha);
    expect(markers).toHaveLength(2);
    expect(markers.find((marker) => marker.recordType === "middle_road")).toMatchObject({
      label: "Cross Street",
      associationLabel: "Alpha Road",
      reveal: {
        kind: "middle_road",
        connectingRoad: { exam_name: "Cross Street" },
        otherRoads: [{ exam_name: "Not Learned" }],
      },
    });
    expect(markers.find((marker) => marker.recordType === "place")).toMatchObject({
      label: "Unrelated Place",
      associationLabel: "Alpha Road",
      reveal: {
        kind: "place",
        connectingRoad: null,
        otherRoads: [{ exam_name: "Place Side Road" }],
      },
    });
  });

  it("draws every geometry link sharing the selected dataset road name", () => {
    const fullRoad = geometryForLearningFeature(geometry, middleRoadRecord.features[1]);
    expect(fullRoad.features.map((feature) => feature.properties.road_link_id)).toEqual(["a", "b"]);
  });

  it("draws complete middle and terminal roads in the answer explorer", () => {
    const fullAnswer = geometryForExplorerRecord(geometry, middleRoadRecord);
    expect(fullAnswer.features.map((feature) => feature.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps the complete middle road separate from complete end roads for teaching maps", () => {
    const layers = geometryLayersForLearningRecord(geometry, middleRoadRecord);
    expect(layers.middleRoad.features.map((feature) => feature.id)).toEqual(["c"]);
    expect(layers.associatedRoads.features.map((feature) => feature.id)).toEqual(["a", "b"]);
    expect(layers.allRoads.features.map((feature) => feature.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps place answers point-only", () => {
    expect(geometryForExplorerRecord(geometry, unrelatedPlace).features).toEqual([]);
    expect(editablePointFeaturesForRecord(unrelatedPlace).map((feature) => feature.index)).toEqual([0]);
  });

  it("expands the supported same-name component but excludes a disconnected homonym", () => {
    const albionTopology: RoadTopology = { schema_version: "1.0.0", links: [
      { id: "city-a", names: ["Albion Street"], start_node: "c1", end_node: "c2", length_metres: 100, road_function: "Local Road", form_of_way: "Single Carriageway" },
      { id: "city-b", names: ["Albion Street"], start_node: "c2", end_node: "c3", length_metres: 100, road_function: "Local Road", form_of_way: "Single Carriageway" },
      { id: "east", names: ["Albion Street"], start_node: "e1", end_node: "e2", length_metres: 80, road_function: "Local Road", form_of_way: "Single Carriageway" },
    ] };
    const albionCoordinates: Record<string, [[number, number], [number, number]]> = { "city-a": [[-4.25, 55.85], [-4.24, 55.85]], "city-b": [[-4.24, 55.85], [-4.23, 55.85]], east: [[-4.20, 55.86], [-4.19, 55.86]] };
    const albionGeometry: RoadGeometryCollection = { type: "FeatureCollection", schema_version: "1.0.0", features: albionTopology.links.map((link) => ({
      type: "Feature", id: link.id, properties: { road_link_id: link.id, names: link.names, start_node: link.start_node, end_node: link.end_node }, geometry: { type: "LineString", coordinates: albionCoordinates[link.id] },
    })) };
    const record = (id: string, linkId: string): LearningRecord => ({ ...unrelatedPlace, id, features: unrelatedPlace.features.map((feature, index) => index === 1 ? { ...feature, exam_name: "Albion Street", map_name: "albion street", road_link_id: linkId } : feature) });
    const atlas = buildDatasetRoadAtlas([record("city-1", "city-a"), record("city-2", "city-a"), record("bad-east", "east")], albionTopology, albionGeometry);
    expect(atlas.find((road) => road.name === "Albion Street")).toMatchObject({ linkIds: ["city-a", "city-b"], sourceComponentCount: 2, excludedSeededComponentCount: 1 });
    expect(geometryForLearningFeature(albionGeometry, { ...unrelatedPlace.features[1], exam_name: "Albion Street", map_name: "albion street", road_link_id: "city-a" }).features.map((item) => item.id)).toEqual(["city-a", "city-b"]);
  });

  it("includes a short-gapped continuation without admitting the far homonym", () => {
    const shortGapTopology: RoadTopology = { schema_version: "1.0.0", links: [
      { id: "west", names: ["Long Road"], start_node: "w1", end_node: "w2", length_metres: 100, road_function: "Local Road", form_of_way: "Single Carriageway" },
      { id: "east", names: ["Long Road"], start_node: "e1", end_node: "e2", length_metres: 100, road_function: "Local Road", form_of_way: "Single Carriageway" },
      { id: "homonym", names: ["Long Road"], start_node: "h1", end_node: "h2", length_metres: 100, road_function: "Local Road", form_of_way: "Single Carriageway" },
    ] };
    const coordinates: Record<string, [[number, number], [number, number]]> = {
      west: [[-4.25, 55.86], [-4.24, 55.86]], east: [[-4.2395, 55.86], [-4.23, 55.86]], homonym: [[-4.20, 55.86], [-4.19, 55.86]],
    };
    const shortGapGeometry: RoadGeometryCollection = { type: "FeatureCollection", schema_version: "1.0.0", features: shortGapTopology.links.map((link) => ({ type: "Feature", id: link.id, properties: { road_link_id: link.id, names: link.names, start_node: link.start_node, end_node: link.end_node }, geometry: { type: "LineString", coordinates: coordinates[link.id] } })) };
    const record = (id: string): LearningRecord => ({ ...unrelatedPlace, id, features: unrelatedPlace.features.map((feature, index) => index === 1 ? { ...feature, exam_name: "Long Road", map_name: "long road", road_link_id: "west" } : feature) });
    const road = buildDatasetRoadAtlas([record("one"), record("two")], shortGapTopology, shortGapGeometry).find((item) => item.name === "Long Road");
    expect(road?.linkIds).toEqual(["east", "west"]);
    expect(road?.sourceComponentCount).toBe(2);
  });
});
