import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Popup,
  Tooltip,
  useMap,
} from "react-leaflet";
import { TaxiMapTiles } from "./TaxiMapTiles";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  KNOWLEDGE_AREAS,
  NEWS_AREAS,
  knowledgeAreaBoundary,
  knowledgeAreaLabels,
  recordCoordinate,
  type Coordinate,
  type GeographicKnowledgeSummary,
  type KnowledgeArea,
  type NewsArea,
} from "../domain/geographic-knowledge";
import type {
  Association,
  LearningRecord,
  Mastery,
} from "../domain/types";
import "./geographic-knowledge.css";

type RecordStatus = "unseen" | "learning" | "secure";
type AreaFilter = "all" | KnowledgeArea;

const AREA_FILTERS: readonly AreaFilter[] = ["all", ...KNOWLEDGE_AREAS];

type MappedRecord = {
  record: LearningRecord;
  coordinate: [number, number];
  status: RecordStatus;
  newsArea: NewsArea | null;
};

const statusLabels: Record<RecordStatus, string> = {
  unseen: "Unseen",
  learning: "Learning",
  secure: "Secure",
};

const statusColours: Record<RecordStatus, string> = {
  unseen: "#9a665d",
  learning: "#c89536",
  secure: "#2f7b70",
};

const areaColours: Record<NewsArea, string> = {
  north: "#426b8a",
  east: "#bb7a2d",
  south: "#9a514a",
  west: "#39786f",
};

function MapController({
  points,
  selected,
}: {
  points: [number, number][];
  selected: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      if (!points.length) {
        map.setView([55.8642, -4.2518], 11, { animate: false });
        return;
      }
      const bounds = L.latLngBounds(
        points.map(([longitude, latitude]) => [latitude, longitude]),
      );
      if (bounds.getNorthEast().equals(bounds.getSouthWest()))
        map.setView(bounds.getCenter(), 14, { animate: false });
      else
        map.fitBounds(bounds, {
          padding: [28, 28],
          maxZoom: 14,
          animate: false,
        });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [map, points]);
  useEffect(() => {
    if (selected) map.flyTo([selected[1], selected[0]], 15);
  }, [map, selected]);
  return null;
}

function recordStatus(
  recordId: string,
  associationsByRecord: ReadonlyMap<string, Association[]>,
  mastery: ReadonlyMap<string, Mastery>,
): RecordStatus {
  const associations = associationsByRecord.get(recordId) ?? [];
  if (
    associations.length &&
    associations.every(
      (association) => mastery.get(association.id)?.state === "mastered",
    )
  )
    return "secure";
  if (associations.some((association) => mastery.has(association.id)))
    return "learning";
  return "unseen";
}

export function GeographicInsights({
  summary,
  records,
  associations,
  mastery,
}: {
  summary: GeographicKnowledgeSummary;
  records: LearningRecord[];
  associations: Association[];
  mastery: ReadonlyMap<string, Mastery>;
}) {
  const recommendation = summary.recommendation;
  const [topicKey, setTopicKey] = useState(
    recommendation?.topicKey ?? summary.topics[0]?.key ?? "",
  );
  const [area, setArea] = useState<AreaFilter>(
    recommendation?.area ?? "south",
  );
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const topic =
    summary.topics.find((candidate) => candidate.key === topicKey) ??
    summary.topics[0];
  const areaLabel =
    area === "all" ? "All Glasgow" : knowledgeAreaLabels[area];
  const selection = useMemo(() => {
    if (!topic) return [];
    const cells =
      area === "all"
        ? KNOWLEDGE_AREAS.map((candidate) => topic.cells[candidate])
        : [topic.cells[area]];
    return cells.flatMap((candidate) => candidate.recordIds);
  }, [area, topic]);
  const recordIds = useMemo(
    () => new Set(selection),
    [selection],
  );
  const newsAreaByRecord = useMemo(() => {
    const lookup = new Map<string, NewsArea>();
    if (!topic) return lookup;
    for (const candidate of NEWS_AREAS)
      for (const recordId of topic.cells[candidate].recordIds)
        lookup.set(recordId, candidate);
    return lookup;
  }, [topic]);
  const newsBoundaries = useMemo(() => {
    const boundaries = new Map<NewsArea, Coordinate[]>();
    for (const candidate of NEWS_AREAS)
      boundaries.set(candidate, knowledgeAreaBoundary(records, candidate));
    return boundaries;
  }, [records]);
  const visibleBoundaries = useMemo(() => {
    if (area === "centre")
      return [
        {
          key: "centre",
          colour: "#315b6a",
          coordinates: knowledgeAreaBoundary(records, "centre"),
        },
      ];
    const areas = area === "all" ? NEWS_AREAS : [area];
    return areas.map((candidate) => ({
      key: candidate,
      colour: areaColours[candidate],
      coordinates: newsBoundaries.get(candidate) ?? [],
    }));
  }, [area, newsBoundaries, records]);
  const associationsByRecord = useMemo(() => {
    const grouped = new Map<string, Association[]>();
    for (const association of associations) {
      if (!association.required || association.scope !== "record_set") continue;
      const current = grouped.get(association.record_id) ?? [];
      current.push(association);
      grouped.set(association.record_id, current);
    }
    return grouped;
  }, [associations]);
  const selectionStats = useMemo(() => {
    const counts = { secure: 0, learning: 0, unseen: 0, total: 0 };
    for (const record of records) {
      if (!recordIds.has(record.id)) continue;
      counts[recordStatus(record.id, associationsByRecord, mastery)] += 1;
      counts.total += 1;
    }
    return counts;
  }, [associationsByRecord, mastery, recordIds, records]);
  const securePercentage = selectionStats.total
    ? Math.round((selectionStats.secure / selectionStats.total) * 100)
    : 0;
  const mapped = useMemo(
    () =>
      records
        .filter((record) => recordIds.has(record.id))
        .flatMap((record): MappedRecord[] => {
          const coordinate = recordCoordinate(record);
          return coordinate
            ? [
                {
                  record,
                  coordinate,
                  status: recordStatus(
                    record.id,
                    associationsByRecord,
                    mastery,
                  ),
                  newsArea: newsAreaByRecord.get(record.id) ?? null,
                },
              ]
            : [];
        })
        .sort(
          (left, right) =>
            ["unseen", "learning", "secure"].indexOf(left.status) -
              ["unseen", "learning", "secure"].indexOf(right.status) ||
            left.record.exam_name.localeCompare(right.record.exam_name),
        ),
    [associationsByRecord, mastery, newsAreaByRecord, recordIds, records],
  );
  const points = useMemo(
    () => [
      ...mapped.map((item) => item.coordinate),
      ...visibleBoundaries.flatMap((boundary) => boundary.coordinates),
    ],
    [mapped, visibleBoundaries],
  );
  const selectedCoordinate =
    mapped.find((item) => item.record.id === selectedRecordId)?.coordinate ??
    null;
  useEffect(() => setSelectedRecordId(null), [area, topicKey]);

  return (
    <>
      <header className="page-head area-insights-head">
        <div>
          <p>AREA INSIGHTS</p>
          <h1>See the places behind the percentage.</h1>
          <span>
            Choose a topic and part of Glasgow to see every mapped entry and
            the evidence you have for it.
          </span>
        </div>
      </header>
      <section className="area-insights-controls" aria-label="Knowledge map filters">
        <label>
          <span>Topic</span>
          <select
            value={topic?.key ?? ""}
            onChange={(event) => setTopicKey(event.target.value)}
          >
            {summary.topics.map((candidate) => (
              <option value={candidate.key} key={candidate.key}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Area</legend>
          <div>
            {AREA_FILTERS.map((candidate) => (
              <button
                type="button"
                aria-pressed={area === candidate}
                onClick={() => setArea(candidate)}
                key={candidate}
              >
                {candidate === "all"
                  ? "All"
                  : knowledgeAreaLabels[candidate]}
              </button>
            ))}
          </div>
        </fieldset>
        <p>
          <strong>{securePercentage}% secure</strong>
          <span>
            {selectionStats.secure} secure · {selectionStats.learning} learning ·{" "}
            {selectionStats.unseen} unseen
          </span>
        </p>
      </section>
      <section className="area-insights-layout">
        <div
          className="area-insights-map"
          aria-label={`${topic?.label ?? "Knowledge"} in ${areaLabel}`}
        >
          <MapContainer
            center={[55.8642, -4.2518]}
            zoom={11}
            preferCanvas
            dragging
            touchZoom
            doubleClickZoom
            boxZoom
            keyboard
            zoomControl
            scrollWheelZoom
          >
            <TaxiMapTiles />
            {visibleBoundaries.map((boundary) =>
              boundary.coordinates.length >= 3 ? (
              <Polygon
                key={boundary.key}
                positions={
                  boundary.coordinates.map(
                    ([longitude, latitude]): [number, number] => [
                      latitude,
                      longitude,
                    ],
                  )
                }
                interactive={false}
                pathOptions={{
                  color: boundary.colour,
                  weight: 2,
                  fillColor: boundary.colour,
                  fillOpacity: area === "all" ? 0.025 : 0.055,
                }}
              />
              ) : null,
            )}
            {mapped.map((item) => (
              <CircleMarker
                key={item.record.id}
                center={[item.coordinate[1], item.coordinate[0]]}
                radius={item.status === "secure" ? 6 : 8}
                pathOptions={{
                  color: "#fff",
                  weight: 2,
                  fillColor:
                    area === "all" && item.newsArea
                      ? areaColours[item.newsArea]
                      : statusColours[item.status],
                  fillOpacity: item.status === "secure" ? 0.7 : 0.92,
                }}
              >
                <Tooltip direction="top" offset={[0, -7]}>
                  <b>{item.record.exam_name}</b>
                  <br />
                  {area === "all" && item.newsArea
                    ? `${knowledgeAreaLabels[item.newsArea]} · `
                    : ""}
                  {statusLabels[item.status]}
                </Tooltip>
                <Popup>
                  <article className="area-record-popup">
                    <small>{statusLabels[item.status]}</small>
                    <strong>{item.record.exam_name}</strong>
                    <span>{item.record.section.name}</span>
                  </article>
                </Popup>
              </CircleMarker>
            ))}
            <MapController points={points} selected={selectedCoordinate} />
          </MapContainer>
          <div className="area-map-legend" aria-label="Map marker status">
            {area === "all"
              ? NEWS_AREAS.map((candidate) => (
                  <span key={candidate}>
                    <i style={{ background: areaColours[candidate] }} />
                    {knowledgeAreaLabels[candidate]}
                  </span>
                ))
              : (Object.keys(statusLabels) as RecordStatus[]).map((status) => (
                  <span key={status}>
                    <i style={{ background: statusColours[status] }} />
                    {statusLabels[status]}
                  </span>
                ))}
          </div>
        </div>
        <aside className="area-entry-list">
          <header>
            <span>{topic?.label}</span>
            <strong>{areaLabel}</strong>
            <small>{mapped.length} mapped entries</small>
          </header>
          <ol>
            {mapped.length ? (
              mapped.map((item) => (
                <li key={item.record.id}>
                  <button
                    type="button"
                    aria-pressed={selectedRecordId === item.record.id}
                    onClick={() => setSelectedRecordId(item.record.id)}
                  >
                    <i
                      data-status={item.status}
                      aria-hidden="true"
                      style={
                        area === "all" && item.newsArea
                          ? { background: areaColours[item.newsArea] }
                          : undefined
                      }
                    />
                    <span>
                      <strong>{item.record.exam_name}</strong>
                      <small>{statusLabels[item.status]} · Show on map</small>
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li className="area-entry-list__empty">
                No mapped entries in this topic and area.
              </li>
            )}
          </ol>
        </aside>
      </section>
    </>
  );
}
