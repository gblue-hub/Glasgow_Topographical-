import { useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  Tooltip,
  useMapEvents,
} from "react-leaflet";
import { TaxiMapTiles } from "./TaxiMapTiles";
import type { LatLngBounds } from "leaflet";
import { recordCoordinate } from "../domain/geographic-knowledge";
import { normaliseRoadName } from "../domain/road-names";
import type { CareerMapModel, KnowledgeEvidenceStatus } from "../domain/career-map";
import type {
  LearningRecord,
  PersonalPlace,
  RoadGeometryCollection,
  RouteAttempt,
  TerritoryDefinition,
  TerritoryProgress,
  TerritoryStitch,
} from "../domain/types";
import "leaflet/dist/leaflet.css";
import "./career-map.css";

type Layers = {
  districts: boolean;
  stitches: boolean;
  fares: boolean;
  places: boolean;
  personal: boolean;
};

const statusLabels: Record<KnowledgeEvidenceStatus, string> = {
  unseen: "Unseen",
  exploring: "Exploring",
  learning: "Learning",
  overdue: "Review due",
  operational: "Operational",
  licensed: "Licensed",
};

const colours: Record<KnowledgeEvidenceStatus, string> = {
  unseen: "#758195",
  exploring: "#5f7897",
  learning: "#d89614",
  overdue: "#d34b3f",
  operational: "#13866f",
  licensed: "#7a5af8",
};

function ViewportObserver({
  onChange,
}: {
  onChange: (zoom: number, bounds: LatLngBounds) => void;
}) {
  const map = useMapEvents({
    moveend: () => onChange(map.getZoom(), map.getBounds()),
    zoomend: () => onChange(map.getZoom(), map.getBounds()),
  });
  return null;
}

const inBounds = (
  coordinate: [number, number],
  bounds: LatLngBounds | null,
) => !bounds || bounds.contains([coordinate[1], coordinate[0]]);

type Selection =
  | { kind: "territory"; id: string }
  | { kind: "stitch"; id: string }
  | null;

export function CareerMap({
  model,
  territories,
  stitches,
  geometry,
  records,
  routeAttempts,
  personalPlaces,
  territoryProgress,
  onOpenTerritory,
  onStartShift,
  canStartShift,
}: {
  model: CareerMapModel;
  territories: TerritoryDefinition[];
  stitches: TerritoryStitch[];
  geometry: RoadGeometryCollection;
  records: LearningRecord[];
  routeAttempts: RouteAttempt[];
  personalPlaces: PersonalPlace[];
  territoryProgress: ReadonlyMap<string, TerritoryProgress>;
  onOpenTerritory: (territoryId: string) => void;
  onStartShift: () => void;
  canStartShift: boolean;
}) {
  const [layers, setLayers] = useState<Layers>({
    districts: true,
    stitches: true,
    fares: true,
    places: true,
    personal: true,
  });
  const [zoom, setZoom] = useState(11);
  const [bounds, setBounds] = useState<LatLngBounds | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const territoryById = useMemo(
    () => new Map(territories.map((territory) => [territory.id, territory])),
    [territories],
  );
  const recordById = useMemo(
    () => new Map(records.map((record) => [record.id, record])),
    [records],
  );
  const successfulFares = useMemo(
    () =>
      routeAttempts
        .filter((attempt) => attempt.passed && attempt.trace_coordinates?.length)
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .slice(0, 30),
    [routeAttempts],
  );
  const visibleRoads = useMemo(() => {
    if (zoom < 14) return [];
    return geometry.features.filter((feature) => {
      if (!feature.geometry.coordinates.some((point) => inBounds(point, bounds)))
        return false;
      return feature.properties.names.some((name) =>
        model.roadStatus.has(normaliseRoadName(name)),
      );
    });
  }, [bounds, geometry.features, model.roadStatus, zoom]);
  const mappedRecords = useMemo(() => {
    if (zoom < 13 || !layers.places) return [];
    return records.flatMap((record) => {
      const coordinate = recordCoordinate(record);
      return coordinate && inBounds(coordinate, bounds)
        ? [{ record, coordinate, status: model.recordStatus.get(record.id) ?? "unseen" as const }]
        : [];
    });
  }, [bounds, layers.places, model.recordStatus, records, zoom]);

  const selectedTerritory =
    selection?.kind === "territory" ? territoryById.get(selection.id) : undefined;
  const selectedStitch =
    selection?.kind === "stitch" ? stitches.find((item) => item.id === selection.id) : undefined;
  const selectedTerritoryStitches = selectedTerritory
    ? stitches.filter((stitch) => selectedTerritory.stitch_ids.includes(stitch.id))
    : [];
  const selectedDistrictRecord = selectedTerritory
    ? recordById.get(selectedTerritory.district_record_id)
    : undefined;

  const toggle = (key: keyof Layers) =>
    setLayers((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div className="career-map-page">
      <header className="career-map-hero">
        <div>
          <p className="eyebrow">YOUR TAXI CAREER</p>
          <h1>Watch Glasgow become your city.</h1>
          <span>Every lit district, stitch and fare comes from learning evidence—not passive browsing.</span>
        </div>
        <div className="career-rank-card">
          <span>Current rank</span><strong>{model.rank}</strong>
          <b>{model.competencePoints.toLocaleString()} competence points</b>
          <small>{model.rankReason}</small>
        </div>
      </header>

      <section className="career-map-stats" aria-label="Career evidence totals">
        <article><strong>{model.totals.licensedTerritories}</strong><span>district licences</span></article>
        <article><strong>{model.totals.secureStitches}</strong><span>secure stitches</span></article>
        <article><strong>{model.totals.successfulFares}</strong><span>successful fares</span></article>
        <article><strong>{model.totals.operationalRecords}</strong><span>operational records</span></article>
      </section>

      <section className="career-map-layout">
        <div className="career-map-stage">
          <header>
            <div><p className="eyebrow">OPERATIONAL CITY</p><strong>Fog clears through proven knowledge</strong></div>
            <button type="button" className="primary" disabled={!canStartShift} onClick={onStartShift}>{canStartShift ? "Start next shift" : "Shift complete"}</button>
          </header>
          <div className="career-layer-controls" aria-label="Career map layers">
            {(Object.keys(layers) as Array<keyof Layers>).map((key) => (
              <button type="button" aria-pressed={layers[key]} onClick={() => toggle(key)} key={key}>{key}</button>
            ))}
          </div>
          <MapContainer center={[55.8642, -4.2518]} zoom={11} preferCanvas scrollWheelZoom>
            <TaxiMapTiles opacity={.42} />
            <ViewportObserver onChange={(nextZoom, nextBounds) => { setZoom(nextZoom); setBounds(nextBounds); }} />
            {layers.districts && territories.map((territory) => {
              const status = model.territoryStatus.get(territory.id) ?? "unseen";
              const colour = colours[status];
              return <Polygon key={territory.id} positions={territory.polygon.map(([longitude, latitude]) => [latitude, longitude])} pathOptions={{ color: colour, weight: status === "licensed" ? 4 : 1.5, fillColor: colour, fillOpacity: status === "unseen" ? .08 : status === "learning" ? .22 : .38, dashArray: status === "unseen" ? "4 7" : undefined }} eventHandlers={{ click: () => setSelection({ kind: "territory", id: territory.id }) }}><Tooltip sticky><strong>{territory.name}</strong><br />{statusLabels[status]} · {territoryProgress.get(territory.id)?.route_coverage_percentage ?? 0}% routes</Tooltip></Polygon>;
            })}
            {layers.stitches && stitches.map((stitch) => {
              const status = model.stitchStatus.get(stitch.id) ?? "unseen";
              return <Polyline key={stitch.id} positions={stitch.shared_boundary.map(([longitude, latitude]) => [latitude, longitude])} pathOptions={{ color: colours[status], weight: status === "operational" ? 7 : 4, opacity: status === "unseen" ? .17 : .9, dashArray: status === "operational" ? undefined : "3 8" }} eventHandlers={{ click: () => setSelection({ kind: "stitch", id: stitch.id }) }}><Tooltip sticky>{stitch.road_name}<br />{statusLabels[status]} stitch</Tooltip></Polyline>;
            })}
            {layers.fares && successfulFares.map((attempt) => <Polyline key={attempt.id} positions={attempt.trace_coordinates!.map(([longitude, latitude]) => [latitude, longitude])} pathOptions={{ color: "#f26b38", weight: 3, opacity: .36, className: "career-fare-trace" }}><Tooltip>Successful fare · {attempt.score_percentage}%</Tooltip></Polyline>)}
            {visibleRoads.map((feature) => {
              const status = feature.properties.names.reduce<KnowledgeEvidenceStatus>((current, name) => {
                const next = model.roadStatus.get(normaliseRoadName(name)) ?? "unseen";
                return current === "operational" || next === "operational" ? "operational" : current === "learning" || next === "learning" ? "learning" : next;
              }, "unseen");
              return <Polyline key={`road:${feature.id}`} positions={feature.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude])} pathOptions={{ color: colours[status], weight: status === "operational" ? 5 : 2, opacity: status === "unseen" ? .08 : .7 }}><Tooltip>{feature.properties.names.join(" / ")}</Tooltip></Polyline>;
            })}
            {mappedRecords.map(({ record, coordinate, status }) => <CircleMarker key={record.id} center={[coordinate[1], coordinate[0]]} radius={status === "unseen" ? 3 : 6} pathOptions={{ color: "#fff", weight: 1.5, fillColor: colours[status], fillOpacity: status === "unseen" ? .16 : .85 }}><Tooltip>{record.exam_name}<br />{statusLabels[status]}</Tooltip></CircleMarker>)}
            {layers.personal && personalPlaces.map((place) => <CircleMarker key={`personal:${place.id}`} center={[place.coordinate[1], place.coordinate[0]]} radius={7} pathOptions={{ color: "#fff", weight: 2, fillColor: "#d24e9b", fillOpacity: 1 }}><Tooltip><strong>{place.name}</strong><br />Your Glasgow timeline</Tooltip></CircleMarker>)}
          </MapContainer>
          <div className="career-map-legend">{(["unseen", "learning", "overdue", "operational", "licensed"] as KnowledgeEvidenceStatus[]).map((status) => <span key={status}><i style={{ background: colours[status] }} />{statusLabels[status]}</span>)}</div>
        </div>

        <aside className="career-evidence-drawer">
          {selectedTerritory ? <>
            <p className="eyebrow">DISTRICT EVIDENCE</p><h2>{selectedTerritory.name}</h2>
            <strong className="career-status" data-status={model.territoryStatus.get(selectedTerritory.id) ?? "unseen"}>{statusLabels[model.territoryStatus.get(selectedTerritory.id) ?? "unseen"]}</strong>
            <dl><div><dt>Route coverage</dt><dd>{territoryProgress.get(selectedTerritory.id)?.route_coverage_percentage ?? 0}%</dd></div><div><dt>Stitches secure</dt><dd>{selectedTerritoryStitches.filter((stitch) => model.secureStitchIds.has(stitch.id)).length}/{selectedTerritoryStitches.length}</dd></div></dl>
            {selectedDistrictRecord && <div className="career-drawer-roads"><span>Defining streets</span>{selectedTerritory.associated_road_names.map((name) => <b key={name}>{name}</b>)}</div>}
            <div className="career-drawer-stitches"><span>Stitch roads</span>{selectedTerritoryStitches.map((stitch) => <button type="button" onClick={() => setSelection({ kind: "stitch", id: stitch.id })} key={stitch.id}>{stitch.entry_road_names[selectedTerritory.id] ?? stitch.road_name}<small>{territoryById.get(stitch.territory_ids.find((id) => id !== selectedTerritory.id)!)?.name}</small></button>)}</div>
            <button type="button" className="primary wide" onClick={() => onOpenTerritory(selectedTerritory.id)}>Work this district</button>
          </> : selectedStitch ? <>
            <button type="button" className="back" onClick={() => setSelection(null)}>← Career overview</button>
            <p className="eyebrow">STITCH ROAD · AREA PATHWAY</p><h2>{selectedStitch.road_name}</h2>
            <strong className="career-status">{statusLabels[model.stitchStatus.get(selectedStitch.id) ?? "unseen"]}</strong>
            <ol className="career-stitch-direction">{selectedStitch.territory_ids.map((territoryId) => <li key={territoryId}><span>{territoryById.get(territoryId)?.name}</span><strong>{selectedStitch.entry_road_names[territoryId]}</strong></li>)}</ol>
            <p>{selectedStitch.connection_kind === "crossing_road" ? "The same learned road carries you from one learned area into the next." : selectedStitch.connection_kind === "road_junction" ? "This road-name handover is a pathway between two learned areas." : "Named approaches on both sides form a pathway between learned areas."}</p>
          </> : <div className="career-drawer-empty"><span aria-hidden="true">⌖</span><h2>Choose part of your city</h2><p>Tap a district or stitch to see the evidence behind its colour and what to learn next.</p>{model.totals.overdueRecords > 0 && <small>{model.totals.overdueRecords} learned records are due for a short refresh.</small>}</div>}
        </aside>
      </section>
    </div>
  );
}
