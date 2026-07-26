import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  compareRouteGeometry,
  formatJourneyDistance,
  generateJourneyPair,
  journeyLocations,
  journeyRoadOptions,
  requestOsrmRoute,
  roadWaypoint,
  type OsrmRoute,
  type RouteComparison,
} from "../domain/journeys";
import type {
  LearningRecord,
  RoadGeometryCollection,
} from "../domain/types";

type Props = {
  records: LearningRecord[];
  geometry: RoadGeometryCollection;
};

type CheckedJourney = {
  learner: OsrmRoute;
  suggested: OsrmRoute;
  comparison: RouteComparison;
};

const OSRM_BASE_URL =
  import.meta.env.VITE_OSRM_BASE_URL?.trim() ||
  (import.meta.env.DEV
    ? "/api/osrm"
    : "https://router.project-osrm.org");

function FitJourney({
  coordinates,
}: {
  coordinates: [number, number][];
}) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.latLngBounds(
      coordinates.map(([longitude, latitude]) => [latitude, longitude]),
    );
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.12), { maxZoom: 16 });
  }, [coordinates, map]);
  return null;
}

const formatCoordinate = ([longitude, latitude]: [number, number]) =>
  `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

export function Journeys({ records, geometry }: Props) {
  const locations = useMemo(() => journeyLocations(records), [records]);
  const roadOptions = useMemo(
    () => journeyRoadOptions(geometry),
    [geometry],
  );
  const [pair, setPair] = useState(() => generateJourneyPair(locations));
  const [roadSelections, setRoadSelections] = useState(["", "", ""]);
  const [checkedJourney, setCheckedJourney] =
    useState<CheckedJourney | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [draggingRoad, setDraggingRoad] = useState<number | null>(null);

  const selectedRoads = roadSelections
    .map((name) => roadOptions.find((option) => option.name === name))
    .filter((option) => option !== undefined);

  const resetAnswer = () => {
    setCheckedJourney(null);
    setError("");
  };

  const generateJourney = () => {
    setPair(generateJourneyPair(locations));
    setRoadSelections(["", "", ""]);
    resetAnswer();
  };

  const selectLocation = (kind: "start" | "end", locationId: string) => {
    const location = locations.find((candidate) => candidate.id === locationId);
    if (!location) return;
    setPair((current) =>
      current ? { ...current, [kind]: location } : current,
    );
    resetAnswer();
  };

  const changeRoad = (index: number, name: string) => {
    setRoadSelections((current) =>
      current.map((selection, selectionIndex) =>
        selectionIndex === index ? name : selection,
      ),
    );
    resetAnswer();
  };

  const moveRoad = (fromIndex: number, toIndex: number) => {
    if (
      fromIndex === toIndex ||
      toIndex < 0 ||
      toIndex >= roadSelections.length
    )
      return;
    setRoadSelections((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    resetAnswer();
  };

  const checkRoute = async () => {
    if (!pair || !selectedRoads.length) return;
    setChecking(true);
    setError("");
    setCheckedJourney(null);
    const controller = new AbortController();
    try {
      const learnerCoordinates: [number, number][] = [
        pair.start.coordinate,
        ...selectedRoads.map((road, index) =>
          roadWaypoint(
            road,
            pair.start.coordinate,
            pair.end.coordinate,
            index,
            selectedRoads.length,
          ),
        ),
        pair.end.coordinate,
      ];
      const [learner, suggested] = await Promise.all([
        requestOsrmRoute(
          OSRM_BASE_URL,
          learnerCoordinates,
          controller.signal,
        ),
        requestOsrmRoute(
          OSRM_BASE_URL,
          [pair.start.coordinate, pair.end.coordinate],
          controller.signal,
        ),
      ]);
      setCheckedJourney({
        learner,
        suggested,
        comparison: compareRouteGeometry(
          learner.coordinates,
          suggested.coordinates,
        ),
      });
    } catch (routeError) {
      setError(
        routeError instanceof TypeError
          ? "The routing service is not responding. Please try again in a moment."
          : routeError instanceof Error
            ? routeError.message
            : "The route could not be checked.",
      );
    } finally {
      setChecking(false);
    }
  };

  if (!pair)
    return (
      <section className="journey-empty">
        Journey practice needs at least two mapped locations.
      </section>
    );

  const resultCoordinates = checkedJourney
    ? [
        ...checkedJourney.suggested.coordinates,
        ...checkedJourney.learner.coordinates,
      ]
    : [];
  const distanceDifference = checkedJourney
    ? checkedJourney.learner.distanceMetres -
      checkedJourney.suggested.distanceMetres
    : 0;

  return (
    <>
      <header className="page-head journeys-head">
        <div>
          <p>LOCATION TO LOCATION</p>
          <h1>Build the journey before you see the route.</h1>
          <span>
            Choose the roads in order. Checking reveals your routed journey and
            OSRM&apos;s suggestion together.
          </span>
        </div>
        <button type="button" className="back" onClick={generateJourney}>
          Random journey
        </button>
      </header>

      <section className="journey-builder">
        <div className="journey-endpoints" aria-label="Generated journey">
          <article>
            <label htmlFor="journey-start">START</label>
            <select
              id="journey-start"
              value={pair.start.id}
              onChange={(event) => selectLocation("start", event.target.value)}
            >
              {locations
                .filter((location) => location.id !== pair.end.id)
                .map((location) => (
                  <option value={location.id} key={location.id}>
                    {location.name}
                  </option>
                ))}
            </select>
          </article>
          <i aria-hidden="true">→</i>
          <article>
            <label htmlFor="journey-end">DESTINATION</label>
            <select
              id="journey-end"
              value={pair.end.id}
              onChange={(event) => selectLocation("end", event.target.value)}
            >
              {locations
                .filter((location) => location.id !== pair.start.id)
                .map((location) => (
                  <option value={location.id} key={location.id}>
                    {location.name}
                  </option>
                ))}
            </select>
          </article>
        </div>

        <div className="journey-road-builder">
          <div className="journey-road-heading">
            <div>
              <p className="eyebrow">YOUR JOURNEY</p>
              <h2>Which roads would you take?</h2>
              <span>Choose them in travelling order. Blank rows are ignored.</span>
            </div>
            <button
              type="button"
              className="link"
              disabled={roadSelections.length >= 10}
              onClick={() => {
                setRoadSelections((current) => [...current, ""]);
                resetAnswer();
              }}
            >
              + Add road
            </button>
          </div>

          <ol className="journey-road-list">
            {roadSelections.map((selection, index) => (
              <li
                key={index}
                className={draggingRoad === index ? "dragging" : ""}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggingRoad !== null) moveRoad(draggingRoad, index);
                  setDraggingRoad(null);
                }}
              >
                <label htmlFor={`journey-road-${index}`}>
                  <span
                    className="journey-drag-handle"
                    aria-hidden="true"
                    draggable
                    onDragStart={() => setDraggingRoad(index)}
                    onDragEnd={() => setDraggingRoad(null)}
                  >
                    ⠿
                  </span>
                  Road {index + 1}
                </label>
                <select
                  id={`journey-road-${index}`}
                  value={selection}
                  onChange={(event) => changeRoad(index, event.target.value)}
                >
                  <option value="">Choose a road…</option>
                  {roadOptions.map((road) => (
                    <option value={road.name} key={road.name}>
                      {road.name}
                    </option>
                  ))}
                </select>
                <div className="journey-road-actions">
                  <button
                    type="button"
                    aria-label={`Move road ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => moveRoad(index, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move road ${index + 1} down`}
                    disabled={index === roadSelections.length - 1}
                    onClick={() => moveRoad(index, index + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="journey-remove-road"
                    aria-label={`Remove road ${index + 1}`}
                    disabled={roadSelections.length === 1}
                    onClick={() => {
                      setRoadSelections((current) =>
                        current.filter((_, selectionIndex) => selectionIndex !== index),
                      );
                      resetAnswer();
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <div className="journey-check-row">
            <span>
              {selectedRoads.length
                ? `${selectedRoads.length} road${selectedRoads.length === 1 ? "" : "s"} selected`
                : "Select at least one road to check the journey"}
            </span>
            <button
              type="button"
              className="primary"
              disabled={!selectedRoads.length || checking}
              onClick={() => void checkRoute()}
            >
              {checking ? "Calculating both routes…" : "Check route"}
            </button>
          </div>
          {error && (
            <div className="journey-error" role="alert">
              <strong>Route unavailable</strong>
              <span>{error}</span>
            </div>
          )}
        </div>
      </section>

      {!checkedJourney && (
        <section className="journey-map-locked">
          <span aria-hidden="true">⌁</span>
          <div>
            <strong>The map stays hidden while you decide</strong>
            <p>It will appear only after you check your completed route.</p>
          </div>
        </section>
      )}

      {checkedJourney && (
        <section className="journey-results" aria-live="polite">
          <div className="journey-result-map">
            <MapContainer
              center={[pair.start.coordinate[1], pair.start.coordinate[0]]}
              zoom={13}
              scrollWheelZoom
            >
              <TileLayer
                attribution="&copy; OpenStreetMap &copy; CARTO"
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              />
              <Polyline
                positions={checkedJourney.suggested.coordinates.map(
                  ([longitude, latitude]) => [latitude, longitude],
                )}
                pathOptions={{
                  color: "#155eef",
                  weight: 9,
                  opacity: 0.65,
                  lineCap: "round",
                }}
              />
              <Polyline
                positions={checkedJourney.learner.coordinates.map(
                  ([longitude, latitude]) => [latitude, longitude],
                )}
                pathOptions={{
                  color: "#e04f16",
                  weight: 5,
                  opacity: 0.92,
                  lineCap: "round",
                }}
              />
              {checkedJourney.comparison.agreementPoints.map(
                (coordinate, index) => (
                  <CircleMarker
                    key={`agreement:${coordinate.join(":")}:${index}`}
                    center={[coordinate[1], coordinate[0]]}
                    radius={6}
                    pathOptions={{
                      color: "#fff",
                      weight: 2,
                      fillColor: "#087a55",
                      fillOpacity: 1,
                    }}
                  >
                    <Tooltip>
                      Routes agree
                      <br />
                      {formatCoordinate(coordinate)}
                    </Tooltip>
                  </CircleMarker>
                ),
              )}
              {checkedJourney.comparison.divergencePoint && (
                <CircleMarker
                  center={[
                    checkedJourney.comparison.divergencePoint[1],
                    checkedJourney.comparison.divergencePoint[0],
                  ]}
                  radius={9}
                  pathOptions={{
                    color: "#fff",
                    weight: 3,
                    fillColor: "#b42318",
                    fillOpacity: 1,
                  }}
                >
                  <Tooltip permanent direction="top">
                    First divergence
                    <br />
                    {formatCoordinate(
                      checkedJourney.comparison.divergencePoint,
                    )}
                  </Tooltip>
                </CircleMarker>
              )}
              {checkedJourney.comparison.reconnectionPoint && (
                <CircleMarker
                  center={[
                    checkedJourney.comparison.reconnectionPoint[1],
                    checkedJourney.comparison.reconnectionPoint[0],
                  ]}
                  radius={8}
                  pathOptions={{
                    color: "#fff",
                    weight: 3,
                    fillColor: "#087a55",
                    fillOpacity: 1,
                  }}
                >
                  <Tooltip>
                    Routes reconnect
                    <br />
                    {formatCoordinate(
                      checkedJourney.comparison.reconnectionPoint,
                    )}
                  </Tooltip>
                </CircleMarker>
              )}
              <CircleMarker
                center={[pair.start.coordinate[1], pair.start.coordinate[0]]}
                radius={8}
                pathOptions={{
                  color: "#fff",
                  weight: 3,
                  fillColor: "#182230",
                  fillOpacity: 1,
                }}
              >
                <Tooltip>{pair.start.name}</Tooltip>
              </CircleMarker>
              <CircleMarker
                center={[pair.end.coordinate[1], pair.end.coordinate[0]]}
                radius={8}
                pathOptions={{
                  color: "#fff",
                  weight: 3,
                  fillColor: "#182230",
                  fillOpacity: 1,
                }}
              >
                <Tooltip>{pair.end.name}</Tooltip>
              </CircleMarker>
              <FitJourney coordinates={resultCoordinates} />
            </MapContainer>
            <div className="journey-map-key">
              <span><i className="learner-route-line" />Your route</span>
              <span><i className="suggested-route-line" />OSRM suggestion</span>
              <span><i className="agreement-route-point" />Agreement coordinate</span>
              <span><i className="divergence-route-point" />First divergence</span>
            </div>
          </div>

          <div className="journey-result-summary">
            <p className="eyebrow">ROUTE COMPARISON</p>
            <h2>
              {checkedJourney.comparison.divergencePoint
                ? "Your journey takes a different path"
                : "Your journey follows the suggestion"}
            </h2>
            <dl>
              <div>
                <dt>Your route</dt>
                <dd>{formatJourneyDistance(checkedJourney.learner.distanceMetres)}</dd>
              </div>
              <div>
                <dt>Suggested route</dt>
                <dd>{formatJourneyDistance(checkedJourney.suggested.distanceMetres)}</dd>
              </div>
              <div>
                <dt>Difference</dt>
                <dd>
                  {distanceDifference >= 0 ? "+" : "−"}
                  {formatJourneyDistance(Math.abs(distanceDifference))}
                </dd>
              </div>
            </dl>
            {checkedJourney.comparison.divergencePoint ? (
              <p className="journey-divergence-copy">
                The red point marks the first coordinate where the two routes
                separate. Green points show agreement and any later
                reconnection.
              </p>
            ) : (
              <p className="journey-agreement-copy">
                The sampled green coordinates show where both calculated routes
                agree.
              </p>
            )}
            <details>
              <summary>OSRM suggested road sequence</summary>
              <ol>
                {checkedJourney.suggested.roadNames.map((name, index) => (
                  <li key={`${name}:${index}`}>{name}</li>
                ))}
              </ol>
            </details>
          </div>
        </section>
      )}
    </>
  );
}
