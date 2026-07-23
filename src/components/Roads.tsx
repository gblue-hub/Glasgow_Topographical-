import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type {
  LearningRecord,
  RoadGeometryCollection,
  RoadGeometryFeature,
  RoadTopology,
} from "../domain/types";
import {
  datasetMarkersForRoad,
  geometryForLearningFeature,
  geometryForRoad,
  type DatasetRoadMarker,
} from "../domain/roads";
import {
  buildCompleteDatasetRoadAtlas,
  filterCompleteDatasetRoadAtlas,
} from "../domain/dataset-road-atlas";

type Props = {
  records: LearningRecord[];
  topology: RoadTopology;
  geometry: RoadGeometryCollection;
};

const CITY_CENTRE: [number, number] = [-4.2518, 55.8642];

const emptyGeometry = (): RoadGeometryCollection => ({
  type: "FeatureCollection",
  schema_version: "1.0.0",
  features: [],
});

function combineGeometry(
  collections: RoadGeometryCollection[],
): RoadGeometryCollection {
  const features = new Map<string, RoadGeometryFeature>();
  for (const collection of collections)
    for (const feature of collection.features)
      features.set(feature.properties.road_link_id, feature);
  return { ...emptyGeometry(), features: [...features.values()] };
}

const metresBetween = (left: [number, number], right: [number, number]) => {
  const latitude = ((left[1] + right[1]) * Math.PI) / 360;
  const dx = (left[0] - right[0]) * 111_320 * Math.cos(latitude);
  const dy = (left[1] - right[1]) * 110_540;
  return Math.hypot(dx, dy);
};

function lineLength(coordinates: [number, number][]) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1)
    total += metresBetween(coordinates[index - 1], coordinates[index]);
  return total;
}

function projectOntoLine(
  point: [number, number],
  coordinates: [number, number][],
) {
  const totalMetres = lineLength(coordinates);
  let cumulativeMetres = 0;
  let best = {
    offRoadMetres: Number.POSITIVE_INFINITY,
    fromStartMetres: 0,
    totalMetres,
  };

  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    const latitude = ((start[1] + end[1] + point[1]) * Math.PI) / 540;
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
    const projectedX = startX + position * dx;
    const projectedY = startY + position * dy;
    const offRoadMetres = Math.hypot(projectedX, projectedY);
    const segmentMetres = metresBetween(start, end);

    if (offRoadMetres < best.offRoadMetres) {
      best = {
        offRoadMetres,
        fromStartMetres: cumulativeMetres + position * segmentMetres,
        totalMetres,
      };
    }
    cumulativeMetres += segmentMetres;
  }

  return best;
}

function roadDistancesFromCityCentre(geometry: RoadGeometryCollection) {
  type Edge = { to: string; metres: number };
  const adjacency = new Map<string, Edge[]>();
  const coordinatesByNode = new Map<string, [number, number]>();

  const addEdge = (from: string, to: string, metres: number) => {
    const edges = adjacency.get(from) ?? [];
    edges.push({ to, metres });
    adjacency.set(from, edges);
  };

  for (const feature of geometry.features) {
    const coordinates = feature.geometry.coordinates;
    if (coordinates.length < 2) continue;
    const { start_node: startNode, end_node: endNode } = feature.properties;
    const metres = lineLength(coordinates);
    coordinatesByNode.set(startNode, coordinates[0]);
    coordinatesByNode.set(endNode, coordinates[coordinates.length - 1]);
    addEdge(startNode, endNode, metres);
    addEdge(endNode, startNode, metres);
  }

  const origin = [...coordinatesByNode.entries()].sort(
    (left, right) =>
      metresBetween(left[1], CITY_CENTRE) -
      metresBetween(right[1], CITY_CENTRE),
  )[0]?.[0];
  const distances = new Map<string, number>();
  if (!origin) return distances;

  distances.set(origin, 0);
  const visited = new Set<string>();
  while (true) {
    let currentNode = "";
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const [node, distance] of distances) {
      if (!visited.has(node) && distance < currentDistance) {
        currentNode = node;
        currentDistance = distance;
      }
    }
    if (!currentNode) break;
    visited.add(currentNode);
    for (const edge of adjacency.get(currentNode) ?? []) {
      const nextDistance = currentDistance + edge.metres;
      if (nextDistance < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY))
        distances.set(edge.to, nextDistance);
    }
  }

  return distances;
}

function orderMarkersFromCityCentre(
  markers: DatasetRoadMarker[],
  roadGeometry: RoadGeometryCollection,
) {
  const nodeDistances = roadDistancesFromCityCentre(roadGeometry);

  const distanceAlongRoad = (marker: DatasetRoadMarker) => {
    let closestProjection = Number.POSITIVE_INFINITY;
    let routeDistance = Number.POSITIVE_INFINITY;

    for (const feature of roadGeometry.features) {
      const coordinates = feature.geometry.coordinates;
      if (coordinates.length < 2) continue;
      const projection = projectOntoLine(marker.coordinate, coordinates);
      if (projection.offRoadMetres >= closestProjection) continue;

      const fromStart =
        (nodeDistances.get(feature.properties.start_node) ??
          Number.POSITIVE_INFINITY) + projection.fromStartMetres;
      const fromEnd =
        (nodeDistances.get(feature.properties.end_node) ??
          Number.POSITIVE_INFINITY) +
        projection.totalMetres -
        projection.fromStartMetres;
      closestProjection = projection.offRoadMetres;
      routeDistance = Math.min(fromStart, fromEnd);
    }

    return Number.isFinite(routeDistance)
      ? routeDistance
      : metresBetween(marker.coordinate, CITY_CENTRE);
  };

  return [...markers].sort(
    (left, right) =>
      distanceAlongRoad(left) - distanceAlongRoad(right) ||
      left.associationLabel.localeCompare(right.associationLabel, "en-GB", {
        sensitivity: "base",
        numeric: true,
      }) ||
      left.label.localeCompare(right.label, "en-GB", {
        sensitivity: "base",
        numeric: true,
      }),
  );
}

function FitRoad({ geometry }: { geometry: RoadGeometryCollection }) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.geoJSON(geometry as any).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.25), { maxZoom: 16 });
  }, [geometry, map]);
  return null;
}

export function Roads({ records, topology, geometry }: Props) {
  const atlas = useMemo(
    () => buildCompleteDatasetRoadAtlas(records, topology, geometry),
    [records, topology, geometry],
  );
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState(atlas[0]?.name ?? "");
  const [selectedMarkerIds, setSelectedMarkerIds] = useState<Set<string>>(
    new Set(),
  );
  const filtered = useMemo(
    () => filterCompleteDatasetRoadAtlas(atlas, query),
    [atlas, query],
  );
  const selected = atlas.find((road) => road.name === selectedName) ?? atlas[0];
  const mainGeometry = useMemo(
    () =>
      selected ? geometryForRoad(geometry, selected.linkIds) : emptyGeometry(),
    [geometry, selected],
  );
  const markers = useMemo(
    () =>
      selected
        ? orderMarkersFromCityCentre(
            datasetMarkersForRoad(records, selected),
            mainGeometry,
          )
        : [],
    [mainGeometry, records, selected],
  );
  const selectedMarkers = useMemo(
    () => markers.filter((marker) => selectedMarkerIds.has(marker.id)),
    [markers, selectedMarkerIds],
  );
  const ribGeometry = useMemo(
    () =>
      combineGeometry(
        selectedMarkers
          .filter((marker) => marker.reveal?.connectingRoad)
          .map((marker) =>
            geometryForLearningFeature(
              geometry,
              marker.reveal!.connectingRoad!,
            ),
          ),
      ),
    [geometry, selectedMarkers],
  );
  const oppositeGeometry = useMemo(
    () =>
      combineGeometry(
        selectedMarkers
          .filter((marker) => marker.reveal)
          .flatMap((marker) =>
            marker.reveal!.otherRoads.map((road) =>
              geometryForLearningFeature(geometry, road),
            ),
          ),
      ),
    [geometry, selectedMarkers],
  );
  const visibleGeometry = useMemo(
    () => combineGeometry([mainGeometry, ribGeometry, oppositeGeometry]),
    [mainGeometry, ribGeometry, oppositeGeometry],
  );

  useEffect(() => setSelectedMarkerIds(new Set()), [selectedName]);

  useEffect(() => {
    if (!query.trim() || filtered.length !== 1) return;
    if (filtered[0].name !== selectedName) setSelectedName(filtered[0].name);
  }, [filtered, query, selectedName]);

  const toggleMarker = (id: string) =>
    setSelectedMarkerIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <header className="page-head roads-head">
        <div>
          <p>SPINE AND RIB ROADS</p>
          <h1>See every learned connection on a shared road.</h1>
          <span>
            Every mapped road explicitly referenced by the learning dataset is
            available. Select a marker to reveal its full rib or a place's other
            road.
          </span>
        </div>
      </header>
      <section className="road-stats" aria-label="Dataset road coverage">
        <article>
          <b>{atlas.length.toLocaleString()}</b>
          <span>dataset roads</span>
        </article>
        <article>
          <b>{markers.length.toLocaleString()}</b>
          <span>dataset connections on selected road</span>
        </article>
        <article>
          <b>{selectedMarkers.length.toLocaleString()}</b>
          <span>connections highlighted</span>
        </article>
      </section>
      <section className="road-atlas">
        <aside className="road-picker">
          <label htmlFor="road-search">Choose a road</label>
          <input
            id="road-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search dataset roads…"
          />
          <p>{filtered.length.toLocaleString()} matching roads</p>
          <div className="road-results" role="listbox" aria-label="Roads">
            {filtered.map((road) => (
              <button
                key={road.name}
                role="option"
                aria-selected={road.name === selected?.name}
                onClick={() => setSelectedName(road.name)}
              >
                <span>{road.name}</span>
                <small>
                  {road.connectionCount} dataset connection
                  {road.connectionCount === 1 ? "" : "s"}
                </small>
              </button>
            ))}
            {!filtered.length && (
              <p className="road-empty">No dataset road matches that search.</p>
            )}
          </div>
        </aside>
        {selected && (
          <div className="road-detail dataset-road-detail">
            <div className="road-map">
              <MapContainer
                center={[55.8642, -4.2518]}
                zoom={13}
                scrollWheelZoom
              >
                <TileLayer
                  attribution="&copy; OpenStreetMap &copy; CARTO"
                  url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                />
                <GeoJSON
                  key={`main:${selected.name}`}
                  data={mainGeometry as any}
                  style={() => ({ color: "#155eef", weight: 7, opacity: 0.9 })}
                />
                {!!oppositeGeometry.features.length && (
                  <GeoJSON
                    key={`opposites:${[...selectedMarkerIds].sort().join(":")}`}
                    data={oppositeGeometry as any}
                    style={() => ({
                      color: "#7a5af8",
                      weight: 6,
                      opacity: 0.88,
                    })}
                  />
                )}
                {!!ribGeometry.features.length && (
                  <GeoJSON
                    key={`ribs:${[...selectedMarkerIds].sort().join(":")}`}
                    data={ribGeometry as any}
                    style={() => ({
                      color: "#e04f16",
                      weight: 7,
                      opacity: 0.95,
                    })}
                  />
                )}
                {markers.map((marker, index) => {
                  const active = selectedMarkerIds.has(marker.id);
                  return (
                    <CircleMarker
                      key={marker.id}
                      center={[marker.coordinate[1], marker.coordinate[0]]}
                      radius={active ? 10 : 8}
                      pathOptions={{
                        color: "#fff",
                        weight: 3,
                        fillColor: active
                          ? "#e04f16"
                          : marker.recordType === "place"
                            ? "#087a55"
                            : marker.recordType === "district"
                              ? "#b54708"
                              : "#155eef",
                        fillOpacity: 1,
                      }}
                      eventHandlers={{
                        click: () => {
                          if (marker.reveal) toggleMarker(marker.id);
                        },
                      }}
                    >
                      <Tooltip direction="top" offset={[0, -8]}>
                        <b>
                          {index + 1}. {marker.label}
                        </b>
                        <br />
                        {marker.reveal ? (
                          <>
                            {active
                              ? "Click to hide roads"
                              : "Click to reveal roads"}
                            <br />
                            {marker.reveal.kind === "middle_road"
                              ? "Ends at "
                              : "Other road: "}
                            {marker.reveal.otherRoads
                              .map((road) => road.exam_name)
                              .join(" · ")}
                          </>
                        ) : marker.recordType === "place" ? (
                          "Place on this road"
                        ) : (
                          "District connection"
                        )}
                      </Tooltip>
                    </CircleMarker>
                  );
                })}
                <FitRoad geometry={visibleGeometry} />
              </MapContainer>
            </div>
            <div className="road-summary">
              <p className="eyebrow">SELECTED ROAD</p>
              <h2>{selected.name}</h2>
              <p className="muted">
                Every place, district and middle-road terminal explicitly tied
                to this road in the taxi dataset is shown.
              </p>
              <div className="road-map-key" aria-label="Map colours">
                <span>
                  <i className="main-road-key" />
                  Main road
                </span>
                <span>
                  <i className="rib-road-key" />
                  Selected rib
                </span>
                <span>
                  <i className="end-road-key" />
                  Other / end road
                </span>
                <span>
                  <i className="place-point-key" />
                  Place
                </span>
                <span>
                  <i className="district-point-key" />
                  District
                </span>
              </div>
              <h3>Dataset connections — city centre outward</h3>
              <p className="muted">
                Ordered along {selected.name} from the end nearest Glasgow city
                centre.
              </p>
              {markers.length ? (
                <div className="dataset-rib-list">
                  {markers.map((marker, index) => {
                    const active = selectedMarkerIds.has(marker.id);
                    return marker.reveal ? (
                      <button
                        key={marker.id}
                        className="dataset-connection"
                        aria-pressed={active}
                        onClick={() => toggleMarker(marker.id)}
                      >
                        <span>
                          {index + 1}. {marker.label}
                        </span>
                        <small>
                          {marker.associationLabel}
                          {marker.reveal?.kind === "middle_road"
                            ? " → "
                            : " + "}
                          {marker.reveal?.otherRoads
                            .map((road) => road.exam_name)
                            .join(" · ") || "Other road unavailable"}
                        </small>
                        <b>{active ? "Selected" : "Show"}</b>
                      </button>
                    ) : (
                      <div
                        className="dataset-connection static"
                        key={marker.id}
                      >
                        <span>
                          {index + 1}. {marker.label}
                        </span>
                        <small>Connected by {marker.associationLabel}</small>
                        <b>
                          {marker.recordType === "place" ? "Place" : "District"}
                        </b>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">
                  No dataset record is connected to this road.
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
