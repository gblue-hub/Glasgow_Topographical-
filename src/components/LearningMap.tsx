import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FeatureCollection, GeoJsonObject } from "geojson";
import { saveFeatureCoordinates } from "../data/content";
import { getAnswerFeatures } from "../domain/questions";
import { editablePointFeaturesForRecord, geometryLayersForLearningRecord } from "../domain/roads";
import type { LearningRecord, RoadGeometryCollection } from "../domain/types";

type Props = {
  record: LearningRecord;
  roads: RoadGeometryCollection;
  mode?: "clue" | "explore";
  labelled?: boolean;
  editable?: boolean;
  onLabelledChange?: (labelled: boolean) => void;
  onCoordinateSaved?: (featureIndex: number, coordinates: [number, number]) => void;
};

function Fit({ data, points = [] }: { data: unknown; points?: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    const bounds = L.geoJSON(data as GeoJsonObject).getBounds();
    points.forEach(([longitude, latitude]) => bounds.extend([latitude, longitude]));
    if (!bounds.isValid()) return;
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) map.setView(bounds.getCenter(), 16);
    else map.fitBounds(bounds.pad(0.2), { maxZoom: 16 });
  }, [data, map, points]);

  return null;
}

const editablePointIcon = L.divIcon({
  className: "coordinate-marker-shell",
  html: '<span class="coordinate-marker" aria-hidden="true"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

export function LearningMap({
  record,
  roads,
  mode = "clue",
  labelled = false,
  editable = false,
  onLabelledChange,
  onCoordinateSaved,
}: Props) {
  const isExplore = mode === "explore";
  const mapFeatures =
    isExplore && record.type === "place"
      ? editablePointFeaturesForRecord(record)
      : editable
        ? editablePointFeaturesForRecord(record)
        : getAnswerFeatures(record);
  const [positions, setPositions] = useState<Record<number, [number, number]>>(() =>
    Object.fromEntries(mapFeatures.map((feature) => [feature.index, feature.effective_coordinates])),
  );
  const [saveState, setSaveState] = useState<
    Record<number, { kind: "saving" | "saved" | "error"; message: string }>
  >({});
  const [showStreetNames, setShowStreetNames] = useState(labelled);
  const roadLayers = useMemo(
    () => geometryLayersForLearningRecord(roads, record),
    [record, roads],
  );
  const hideCluePlaceRoads = !isExplore && editable && record.type === "place";
  const associatedRoads = hideCluePlaceRoads
    ? { ...roads, features: [] }
    : roadLayers.associatedRoads;
  const visibleRoads = hideCluePlaceRoads
    ? { ...roads, features: [] }
    : roadLayers.allRoads;
  const point = mapFeatures[0]?.effective_coordinates;
  const points = mapFeatures.map(
    (feature) => positions[feature.index] ?? feature.effective_coordinates,
  );

  const moveCoordinate = async (
    feature: LearningRecord["features"][number],
    coordinates: [number, number],
  ) => {
    const previous = positions[feature.index] ?? feature.effective_coordinates;
    setPositions((current) => ({ ...current, [feature.index]: coordinates }));
    setSaveState((current) => ({
      ...current,
      [feature.index]: { kind: "saving", message: `Saving ${feature.exam_name}…` },
    }));
    try {
      const saved = await saveFeatureCoordinates({
        recordId: record.id,
        sectionCode: record.section.code,
        category: record.exam_name,
        featureIndex: feature.index,
        featureName: feature.exam_name,
        coordinates,
      });
      setPositions((current) => ({ ...current, [feature.index]: saved.coordinates }));
      setSaveState((current) => ({
        ...current,
        [feature.index]: {
          kind: "saved",
          message: `${feature.exam_name} saved. Keep studying; the canonical source and next refresh are updated.`,
        },
      }));
      onCoordinateSaved?.(feature.index, saved.coordinates);
    } catch (error) {
      setPositions((current) => ({ ...current, [feature.index]: previous }));
      setSaveState((current) => ({
        ...current,
        [feature.index]: {
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to save this coordinate.",
        },
      }));
    }
  };

  return (
    <div className="map-panel">
      <MapContainer
        center={point ? [point[1], point[0]] : [55.8642, -4.2518]}
        zoom={14}
        scrollWheelZoom
      >
        {isExplore ? (
          <TileLayer
            key="openstreetmap-standard"
            attribution="&copy; OpenStreetMap contributors"
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        ) : (
          <TileLayer
            key={showStreetNames ? "carto-labelled" : "carto-unlabelled"}
            attribution="&copy; OpenStreetMap &copy; CARTO"
            url={`https://{s}.basemaps.cartocdn.com/${showStreetNames ? "light_all" : "light_nolabels"}/{z}/{x}/{y}{r}.png`}
          />
        )}
        {!!associatedRoads.features.length && (
          <GeoJSON
            key={`${record.id}:associated-roads`}
            data={associatedRoads as FeatureCollection}
            style={() => ({
              color: record.type === "middle_road" ? "#e04f16" : "#155eef",
              weight: 6,
              opacity: 0.5,
            })}
          />
        )}
        {!!roadLayers.middleRoad.features.length && (
          <GeoJSON
            key={`${record.id}:middle-road`}
            data={roadLayers.middleRoad as FeatureCollection}
            style={() => ({ color: "#155eef", weight: 8, opacity: 0.56 })}
          />
        )}
        {editable
          ? mapFeatures.map((feature) => (
              <Marker
                key={`${record.id}:${feature.index}:${positions[feature.index]?.join(",")}`}
                position={[
                  (positions[feature.index] ?? feature.effective_coordinates)[1],
                  (positions[feature.index] ?? feature.effective_coordinates)[0],
                ]}
                icon={editablePointIcon}
                draggable
                autoPan
                eventHandlers={{
                  dragend: (event) => {
                    const location = event.target.getLatLng();
                    void moveCoordinate(feature, [location.lng, location.lat]);
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -12]}>
                  <b>{feature.exam_name}</b>
                  <br />
                  Drag to correct and save
                </Tooltip>
              </Marker>
            ))
          : mapFeatures.map((feature) => (
              <CircleMarker
                key={`${record.id}:${feature.index}`}
                center={[feature.effective_coordinates[1], feature.effective_coordinates[0]]}
                radius={8}
                pathOptions={{
                  color: "#fff",
                  weight: 3,
                  fillColor: isExplore && record.type === "place" ? "#e04f16" : "#155eef",
                  fillOpacity: 1,
                }}
              >
                <Tooltip direction="top" offset={[0, -8]}>
                  <b>{feature.exam_name}</b>
                </Tooltip>
              </CircleMarker>
            ))}
        <Fit data={visibleRoads} points={points} />
      </MapContainer>
      {!isExplore && (
        <button
          type="button"
          className="map-label-toggle"
          aria-pressed={showStreetNames}
          onClick={() =>
            setShowStreetNames((current) => {
              const next = !current;
              onLabelledChange?.(next);
              return next;
            })
          }
        >
          Street names <span>{showStreetNames ? "On" : "Off"}</span>
        </button>
      )}
      <div className="map-key" aria-label="Map colours">
        {record.type === "middle_road" ? (
          <>
            <span>
              <i className="middle-road-line" />
              Middle road
            </span>
            <span>
              <i className="side-road-line" />
              Complete mapped end roads
            </span>
          </>
        ) : isExplore && record.type === "place" ? (
          <>
            <span>
              <i className="point-map-mark" />
              Category location
            </span>
            {!!associatedRoads.features.length && (
              <span>
                <i className="associated-road-line" />
                Complete associated roads
              </span>
            )}
          </>
        ) : record.type === "place" && editable ? (
          <span>
            <i className="point-map-mark" />
            Place coordinate
          </span>
        ) : (
          <span>
            <i className="associated-road-line" />
            Complete associated roads
          </span>
        )}
        {editable && <small>Drag a point to save its coordinate</small>}
      </div>
      {editable && (
        <div className="coordinate-save-status" aria-live="polite">
          {Object.values(saveState).map((state, index) => (
            <span className={state.kind} key={`${state.message}:${index}`}>
              {state.message}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
