import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FeatureCollection, GeoJsonObject } from "geojson";
import { saveFeatureCoordinates } from "../services/content";
import { explorerMapPointFeatures, formatExplorerCoordinate } from "../domain/explorer";
import { getAnswerFeatures } from "../domain/questions";
import {
  editablePointFeaturesForRecord,
  geometryForLearningFeature,
  geometryLayersForLearningRecord,
} from "../domain/roads";
import type { LearningRecord, RoadGeometryCollection } from "../domain/types";

type Props = {
  record: LearningRecord;
  roads: RoadGeometryCollection;
  mode?: "clue" | "study" | "explore";
  labelled?: boolean;
  editable?: boolean;
  onLabelledChange?: (labelled: boolean) => void;
  onCoordinateSaved?: (featureIndex: number, coordinates: [number, number]) => void;
  journeyRecords?: LearningRecord[];
  journeyRoadLinkIds?: string[];
};

export type AnswerMapAssociation = {
  record: LearningRecord;
  featureIndices: number[];
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

const editableCategoryIcon = L.divIcon({
  className: "coordinate-marker-shell",
  html: '<span class="coordinate-marker" aria-hidden="true"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const editableRoadPointIcon = L.divIcon({
  className: "coordinate-marker-shell",
  html: '<span class="coordinate-marker road-coordinate-marker" aria-hidden="true"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const isPrimaryPoint = (feature: LearningRecord["features"][number]) =>
  feature.role === "place" || feature.role === "middle_road";

const pointRoleLabel = (feature: LearningRecord["features"][number]) =>
  feature.role === "place"
    ? "Category location"
    : feature.role === "middle_road"
      ? "Main-road source point"
      : "Associated-road source point";

function ExplorePointPopup({
  feature,
  coordinates,
}: {
  feature: LearningRecord["features"][number];
  coordinates: [number, number];
}) {
  return (
    <Popup>
      <article className="map-point-popup">
        <small>{pointRoleLabel(feature)}</small>
        <strong>{feature.exam_name}</strong>
        {feature.postcode && <span>{feature.postcode}</span>}
        <code>{formatExplorerCoordinate(coordinates)}</code>
      </article>
    </Popup>
  );
}

export function LearningMap({
  record,
  roads,
  mode = "clue",
  labelled = false,
  editable = false,
  onLabelledChange,
  onCoordinateSaved,
  journeyRecords = [],
  journeyRoadLinkIds = [],
}: Props) {
  const isExplore = mode === "explore";
  const isStudy = mode === "study";
  const showsCompleteRelationship = isExplore || isStudy;
  const mapFeatures =
    showsCompleteRelationship
      ? explorerMapPointFeatures(record)
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
  const journeyRoads = useMemo(
    () => ({
      ...roads,
      features: roads.features.filter((feature) =>
        journeyRoadLinkIds.includes(feature.properties.road_link_id),
      ),
    }),
    [journeyRoadLinkIds, roads],
  );
  const journeyPoints = journeyRecords
    .filter((item) => item.id !== record.id)
    .map((item) => ({
      item,
      feature:
        item.features.find((feature) => feature.role === "place") ??
        getAnswerFeatures(item)[0],
    }))
    .filter((value) => Boolean(value.feature));
  const hideCluePlaceRoads =
    mode === "clue" && editable && record.type === "place";
  const associatedRoads = hideCluePlaceRoads
    ? { ...roads, features: [] }
    : roadLayers.associatedRoads;
  const visibleRoads = hideCluePlaceRoads
    ? { ...roads, features: [] }
    : roadLayers.allRoads;
  const point = mapFeatures[0]?.effective_coordinates;
  const points = [
    ...mapFeatures.map(
      (feature) => positions[feature.index] ?? feature.effective_coordinates,
    ),
    ...journeyPoints.map(({ feature }) => feature!.effective_coordinates),
  ];
  const renderedMapFeatures = [...mapFeatures].sort(
    (left, right) => Number(isPrimaryPoint(left)) - Number(isPrimaryPoint(right)),
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
            key="cyclosm-detailed"
            attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, <a href="https://github.com/cyclosm/cyclosm-cartocss-style" title="CyclOSM - OpenStreetMap tour bike route render">CyclOSM</a>'
            url="https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"
          />
        ) : (
         <TileLayer
            key="cyclosm-test"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://github.com/cyclosm/cyclosm-cartocss-style">CyclOSM</a>'
            url="https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"
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
        {!!journeyRoads.features.length && (
          <GeoJSON
            key={`${record.id}:learning-journey`}
            data={journeyRoads as FeatureCollection}
            style={() => ({ color: "#087a55", weight: 9, opacity: 0.42 })}
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
          ? renderedMapFeatures.map((feature) => (
              <Marker
                key={`${record.id}:${feature.index}:${positions[feature.index]?.join(",")}`}
                position={[
                  (positions[feature.index] ?? feature.effective_coordinates)[1],
                  (positions[feature.index] ?? feature.effective_coordinates)[0],
                ]}
                icon={isPrimaryPoint(feature) ? editableCategoryIcon : editableRoadPointIcon}
                zIndexOffset={isPrimaryPoint(feature) ? 1000 : 0}
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
                  {pointRoleLabel(feature)}
                  <br />
                  Drag to correct and save
                </Tooltip>
                {isExplore && (
                  <ExplorePointPopup
                    feature={feature}
                    coordinates={
                      positions[feature.index] ?? feature.effective_coordinates
                    }
                  />
                )}
              </Marker>
            ))
          : renderedMapFeatures.map((feature) => (
              <CircleMarker
                key={`${record.id}:${feature.index}`}
                center={[feature.effective_coordinates[1], feature.effective_coordinates[0]]}
                radius={8}
                pathOptions={{
                  color: "#fff",
                  weight: 3,
                  fillColor: isPrimaryPoint(feature) ? "#e04f16" : "#155eef",
                  fillOpacity: 1,
                }}
              >
                <Tooltip direction="top" offset={[0, -8]}>
                  <b>{feature.exam_name}</b>
                  {showsCompleteRelationship && (
                    <>
                      <br />
                      {pointRoleLabel(feature)}
                    </>
                  )}
                </Tooltip>
                {isExplore && (
                  <ExplorePointPopup
                    feature={feature}
                    coordinates={feature.effective_coordinates}
                  />
                )}
              </CircleMarker>
            ))}
        {isStudy && journeyPoints.map(({ item, feature }) => (
          <CircleMarker
            key={`journey-stop:${item.id}`}
            center={[
              feature!.effective_coordinates[1],
              feature!.effective_coordinates[0],
            ]}
            radius={6}
            pathOptions={{
              color: "#fff",
              weight: 2,
              fillColor: "#087a55",
              fillOpacity: 1,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <b>{item.exam_name}</b>
              <br />
              Another stop on this learning run
            </Tooltip>
          </CircleMarker>
        ))}
        <Fit
          data={journeyRoads.features.length ? journeyRoads : visibleRoads}
          points={points}
        />
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
        ) : showsCompleteRelationship && record.type === "place" ? (
          <>
            <span>
              <i className="point-map-mark" />
              Category location
            </span>
            <span>
              <i className="road-point-map-mark" />
              Associated-road coordinates
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
        {isStudy && !!journeyRoads.features.length && (
          <span>
            <i className="journey-study-line" />
            Learning journey corridor
          </span>
        )}
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

export function AnswerComparisonMap({
  correct,
  selected,
  roads,
}: {
  correct: AnswerMapAssociation[];
  selected: AnswerMapAssociation[];
  roads: RoadGeometryCollection;
}) {
  const associationFeatures = (associations: AnswerMapAssociation[]) =>
    associations.flatMap(({ record, featureIndices }) =>
      featureIndices.flatMap((featureIndex) => {
        const feature = record.features.find((item) => item.index === featureIndex);
        return feature ? [{ record, feature }] : [];
      }),
    );
  const correctFeatures = associationFeatures(correct);
  const selectedFeatures = associationFeatures(selected);
  const geometryFor = (features: typeof correctFeatures) => {
    const unique = new Map(
      features
        .flatMap(({ feature }) => geometryForLearningFeature(roads, feature).features)
        .map((feature) => [feature.properties.road_link_id, feature]),
    );
    return { ...roads, features: [...unique.values()] };
  };
  const selectedRoads = geometryFor(selectedFeatures);
  const correctRoads = geometryFor(correctFeatures);
  const allRoads = {
    ...roads,
    features: [...selectedRoads.features, ...correctRoads.features],
  };
  const points = [...selectedFeatures, ...correctFeatures].map(
    ({ feature }) => feature.effective_coordinates,
  );
  const point = points[0];

  return (
    <div className="map-panel answer-comparison-map">
      <MapContainer
        center={point ? [point[1], point[0]] : [55.8642, -4.2518]}
        zoom={14}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://github.com/cyclosm/cyclosm-cartocss-style">CyclOSM</a>'
          url="https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"
        />
        {!!selectedRoads.features.length && (
          <GeoJSON
            data={selectedRoads as FeatureCollection}
            style={() => ({ color: "#b42318", weight: 8, opacity: 0.78 })}
          />
        )}
        {!!correctRoads.features.length && (
          <GeoJSON
            data={correctRoads as FeatureCollection}
            style={() => ({ color: "#087a55", weight: 7, opacity: 0.88 })}
          />
        )}
        {selectedFeatures.map(({ record, feature }) => (
          <CircleMarker
            key={`selected:${record.id}:${feature.index}`}
            center={[feature.effective_coordinates[1], feature.effective_coordinates[0]]}
            radius={7}
            pathOptions={{ color: "#fff", weight: 2, fillColor: "#b42318", fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -7]}>
              <b>{feature.exam_name}</b><br />Your selection · {record.exam_name}
            </Tooltip>
          </CircleMarker>
        ))}
        {correctFeatures.map(({ record, feature }) => (
          <CircleMarker
            key={`correct:${record.id}:${feature.index}`}
            center={[feature.effective_coordinates[1], feature.effective_coordinates[0]]}
            radius={7}
            pathOptions={{ color: "#fff", weight: 2, fillColor: "#087a55", fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -7]}>
              <b>{feature.exam_name}</b><br />Correct association · {record.exam_name}
            </Tooltip>
          </CircleMarker>
        ))}
        <Fit data={allRoads} points={points} />
      </MapContainer>
      <div className="map-key answer-comparison-key" aria-label="Answer comparison colours">
        <span><i className="correct-answer-line" />Correct association</span>
        <span><i className="selected-answer-line" />Your selection</span>
      </div>
    </div>
  );
}
