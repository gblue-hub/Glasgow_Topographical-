import { useEffect, useMemo, useRef, useState } from "react";
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
  journeyAreaBoundary,
  journeyLocations,
  journeyRoadOptions,
  requestOsrmRoute,
  roadWaypoint,
  type JourneyAreaFilter,
  type JourneyLocation,
  type OsrmRoute,
  type RouteComparison,
} from "../domain/journeys";
import {
  KNOWLEDGE_AREAS,
  classifyRecordAreas,
  knowledgeAreaLabels,
} from "../domain/geographic-knowledge";
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

function JourneyViewport({
  frameCoordinates,
  extensionCoordinates,
  frameKey,
  extensionKey,
}: {
  frameCoordinates: [number, number][];
  extensionCoordinates: [number, number][];
  frameKey: string;
  extensionKey: string;
}) {
  const map = useMap();
  const framedKey = useRef("");

  useEffect(() => {
    const bounds = L.latLngBounds(
      frameCoordinates.map(([longitude, latitude]) => [latitude, longitude]),
    );
    if (!bounds.isValid() || framedKey.current === frameKey) return;
    map.fitBounds(bounds.pad(0.12), { maxZoom: 16, animate: false });
    framedKey.current = frameKey;
  }, [frameCoordinates, frameKey, map]);

  useEffect(() => {
    if (!extensionCoordinates.length) return;
    const currentBounds = map.getBounds();
    const outside = extensionCoordinates.filter(
      ([longitude, latitude]) => !currentBounds.contains([latitude, longitude]),
    );
    if (!outside.length) return;
    const extendedBounds = L.latLngBounds([
      currentBounds.getSouthWest(),
      currentBounds.getNorthEast(),
    ]);
    outside.forEach(([longitude, latitude]) =>
      extendedBounds.extend([latitude, longitude]),
    );
    map.fitBounds(extendedBounds.pad(0.06), { maxZoom: 16 });
  }, [extensionCoordinates, extensionKey, map]);

  return null;
}

const formatCoordinate = ([longitude, latitude]: [number, number]) =>
  `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

const locationLabel = (location: JourneyLocation) =>
  `${location.name} · ${knowledgeAreaLabels[location.area]}`;

function JourneyLocationField({
  id,
  label,
  location,
  candidates,
  excludedId,
  onSelect,
}: {
  id: string;
  label: string;
  location: JourneyLocation;
  candidates: JourneyLocation[];
  excludedId: string;
  onSelect: (locationId: string) => void;
}) {
  const [query, setQuery] = useState(() => locationLabel(location));
  useEffect(() => setQuery(locationLabel(location)), [location]);
  const available = useMemo(
    () => candidates.filter((candidate) => candidate.id !== excludedId),
    [candidates, excludedId],
  );
  const suggestions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en-GB");
    const matches = normalized
      ? available.filter((candidate) =>
          locationLabel(candidate)
            .toLocaleLowerCase("en-GB")
            .includes(normalized),
        )
      : available;
    return matches.slice(0, 60);
  }, [available, query]);

  return (
    <label htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        list={`${id}-options`}
        value={query}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          const match = available.find(
            (candidate) => locationLabel(candidate) === value,
          );
          if (match) onSelect(match.id);
        }}
        onBlur={() => {
          if (
            !available.some(
              (candidate) => locationLabel(candidate) === query,
            )
          )
            setQuery(locationLabel(location));
        }}
        autoComplete="off"
      />
      <datalist id={`${id}-options`}>
        {suggestions.map((candidate) => (
          <option value={locationLabel(candidate)} key={candidate.id} />
        ))}
      </datalist>
    </label>
  );
}

export function Journeys({ records, geometry }: Props) {
  const classifiedAreas = useMemo(
    () => classifyRecordAreas(records),
    [records],
  );
  const locations = useMemo(
    () => journeyLocations(records, classifiedAreas),
    [classifiedAreas, records],
  );
  const roadOptions = useMemo(
    () => journeyRoadOptions(geometry),
    [geometry],
  );
  const roadOptionsByName = useMemo(
    () => new Map(roadOptions.map((option) => [option.name, option])),
    [roadOptions],
  );
  const areaBoundaries = useMemo(
    () =>
      new Map(
        KNOWLEDGE_AREAS.map((area) => [
          area,
          journeyAreaBoundary(records, area, classifiedAreas),
        ]),
      ),
    [classifiedAreas, records],
  );
  const [pair, setPair] = useState(() => generateJourneyPair(locations));
  const [startArea, setStartArea] = useState<JourneyAreaFilter>("all");
  const [endArea, setEndArea] = useState<JourneyAreaFilter>("all");
  const [roadSelections, setRoadSelections] = useState(["", "", ""]);
  const [checkedJourney, setCheckedJourney] =
    useState<CheckedJourney | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [draggingRoad, setDraggingRoad] = useState<number | null>(null);
  const [locationsRevealed, setLocationsRevealed] = useState(false);
  const [activeRoadIndex, setActiveRoadIndex] = useState(0);

  const selectedRoads = useMemo(
    () =>
      roadSelections.flatMap((name, index) => {
        const option = roadOptionsByName.get(name);
        return option ? [{ option, index }] : [];
      }),
    [roadOptionsByName, roadSelections],
  );
  const roadSuggestions = useMemo(() => {
    const query = (roadSelections[activeRoadIndex] ?? "")
      .trim()
      .toLocaleLowerCase("en-GB");
    const matches = query
      ? roadOptions.filter((road) =>
          road.name.toLocaleLowerCase("en-GB").includes(query),
        )
      : roadOptions;
    return matches.slice(0, 60);
  }, [activeRoadIndex, roadOptions, roadSelections]);

  const resetAnswer = () => {
    setCheckedJourney(null);
    setError("");
  };

  const generateJourney = (
    nextStartArea = startArea,
    nextEndArea = endArea,
  ) => {
    setPair(
      generateJourneyPair(locations, Math.random, {
        startArea: nextStartArea,
        endArea: nextEndArea,
      }),
    );
    setRoadSelections(["", "", ""]);
    setLocationsRevealed(false);
    resetAnswer();
  };

  const changeArea = (
    kind: "start" | "end",
    value: JourneyAreaFilter,
  ) => {
    const nextStartArea = kind === "start" ? value : startArea;
    const nextEndArea = kind === "end" ? value : endArea;
    if (kind === "start") setStartArea(value);
    else setEndArea(value);
    generateJourney(nextStartArea, nextEndArea);
  };

  const selectLocation = (kind: "start" | "end", locationId: string) => {
    const location = locations.find((candidate) => candidate.id === locationId);
    if (!location) return;
    setPair((current) =>
      current ? { ...current, [kind]: location } : current,
    );
    setLocationsRevealed(false);
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
        ...selectedRoads.map(({ option }, index) =>
          roadWaypoint(
            option,
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
  const constructionCoordinates: [number, number][] = selectedRoads.flatMap(
    ({ option }) => option.segments.flat(),
  );
  const focusAreas = new Set([
    startArea === "all" ? pair.start.area : startArea,
    endArea === "all" ? pair.end.area : endArea,
  ]);
  const areaFocusCoordinates = [...focusAreas].flatMap(
    (area) => areaBoundaries.get(area) ?? [],
  );
  const viewportExtensionCoordinates = checkedJourney
    ? [...constructionCoordinates, ...resultCoordinates]
    : constructionCoordinates;
  const viewportFrameKey = [...focusAreas].sort().join(":");
  const viewportExtensionKey = [
    ...roadSelections,
    checkedJourney ? "checked" : "building",
  ].join(":");
  const startLocations = locations.filter(
    (location) => startArea === "all" || location.area === startArea,
  );
  const endLocations = locations.filter(
    (location) => endArea === "all" || location.area === endArea,
  );

  return (
    <>
      <header className="page-head journeys-head">
        <div>
          <p>JOURNEY WORKSHOP</p>
          <h1>Learn how Glasgow joins together.</h1>
          <span>
            Choose the parts of the city, then build the route street by
            street. The map responds as you think.
          </span>
        </div>
      </header>

      <section className="journey-brief" aria-label="Journey area and endpoints">
        <div className="journey-area-controls">
          <label htmlFor="journey-start-area">
            <span>From area</span>
            <select
              id="journey-start-area"
              value={startArea}
              onChange={(event) =>
                changeArea("start", event.target.value as JourneyAreaFilter)
              }
            >
              <option value="all">All Glasgow</option>
              {KNOWLEDGE_AREAS.map((area) => (
                <option value={area} key={area}>
                  {knowledgeAreaLabels[area]}
                </option>
              ))}
            </select>
          </label>
          <span className="journey-area-arrow" aria-hidden="true">→</span>
          <label htmlFor="journey-end-area">
            <span>To area</span>
            <select
              id="journey-end-area"
              value={endArea}
              onChange={(event) =>
                changeArea("end", event.target.value as JourneyAreaFilter)
              }
            >
              <option value="all">All Glasgow</option>
              {KNOWLEDGE_AREAS.map((area) => (
                <option value={area} key={area}>
                  {knowledgeAreaLabels[area]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            onClick={() => generateJourney()}
          >
            New journey
          </button>
        </div>

        <div className="journey-endpoints">
          <JourneyLocationField
            id="journey-start"
            label="Start"
            location={pair.start}
            candidates={startLocations}
            excludedId={pair.end.id}
            onSelect={(locationId) => selectLocation("start", locationId)}
          />
          <span className="journey-endpoint-line" aria-hidden="true" />
          <JourneyLocationField
            id="journey-end"
            label="Destination"
            location={pair.end}
            candidates={endLocations}
            excludedId={pair.start.id}
            onSelect={(locationId) => selectLocation("end", locationId)}
          />
        </div>
      </section>

      <section className="journey-workspace">
        <div className="journey-live-map">
          <header>
            <div>
              <p className="eyebrow">LIVE STREET MAP</p>
              <strong>
                {selectedRoads.length
                  ? `${selectedRoads.length} street${selectedRoads.length === 1 ? "" : "s"} placed`
                  : "Place your first street"}
              </strong>
            </div>
            <div className="journey-map-tools">
              <span>Every street appears here immediately.</span>
              {!checkedJourney && (
                <button
                  type="button"
                  className="back"
                  aria-pressed={locationsRevealed}
                  onClick={() => setLocationsRevealed((current) => !current)}
                >
                  {locationsRevealed ? "Hide points" : "Reveal points"}
                </button>
              )}
            </div>
          </header>
          <div className="journey-map-canvas">
            <MapContainer
              center={[pair.start.coordinate[1], pair.start.coordinate[0]]}
              zoom={13}
              scrollWheelZoom
            >
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {selectedRoads.flatMap(({ option }, roadIndex) =>
                option.segments.map((segment, segmentIndex) => (
                  <Polyline
                    key={`${option.name}:${roadIndex}:${segmentIndex}`}
                    positions={segment.map(
                      ([longitude, latitude]) => [latitude, longitude],
                    )}
                    pathOptions={{
                      color: checkedJourney ? "#0f6b6d" : "#126e75",
                      weight: checkedJourney ? 3 : 6,
                      opacity: checkedJourney ? 0.28 : 0.82,
                      lineCap: "round",
                    }}
                  >
                    <Tooltip>{roadIndex + 1}. {option.name}</Tooltip>
                  </Polyline>
                )),
              )}
              {checkedJourney && (
                <>
                  <Polyline
                    positions={checkedJourney.suggested.coordinates.map(
                      ([longitude, latitude]) => [latitude, longitude],
                    )}
                    pathOptions={{
                      color: "#2b5f8a",
                      weight: 9,
                      opacity: 0.55,
                      lineCap: "round",
                    }}
                  />
                  <Polyline
                    positions={checkedJourney.learner.coordinates.map(
                      ([longitude, latitude]) => [latitude, longitude],
                    )}
                    pathOptions={{
                      color: "#c7643f",
                      weight: 5,
                      opacity: 0.95,
                      lineCap: "round",
                    }}
                  />
                  {checkedJourney.comparison.agreementPoints.map(
                    (coordinate, index) => (
                      <CircleMarker
                        key={`agreement:${coordinate.join(":")}:${index}`}
                        center={[coordinate[1], coordinate[0]]}
                        radius={5}
                        pathOptions={{
                          color: "#fff",
                          weight: 2,
                          fillColor: "#0f7563",
                          fillOpacity: 1,
                        }}
                      >
                        <Tooltip>Routes agree</Tooltip>
                      </CircleMarker>
                    ),
                  )}
                  {checkedJourney.comparison.divergencePoint && (
                    <CircleMarker
                      center={[
                        checkedJourney.comparison.divergencePoint[1],
                        checkedJourney.comparison.divergencePoint[0],
                      ]}
                      radius={8}
                      pathOptions={{
                        color: "#fff",
                        weight: 3,
                        fillColor: "#a84332",
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
                      radius={7}
                      pathOptions={{
                        color: "#fff",
                        weight: 3,
                        fillColor: "#0f7563",
                        fillOpacity: 1,
                      }}
                    >
                      <Tooltip>Routes reconnect</Tooltip>
                    </CircleMarker>
                  )}
                </>
              )}
              {(checkedJourney || locationsRevealed) && (
                <>
                  <CircleMarker
                    center={[pair.start.coordinate[1], pair.start.coordinate[0]]}
                    radius={8}
                    pathOptions={{
                      color: "#fff",
                      weight: 3,
                      fillColor: "#17212b",
                      fillOpacity: 1,
                    }}
                  >
                    <Tooltip permanent direction="right">Start · {pair.start.name}</Tooltip>
                  </CircleMarker>
                  <CircleMarker
                    center={[pair.end.coordinate[1], pair.end.coordinate[0]]}
                    radius={8}
                    pathOptions={{
                      color: "#fff",
                      weight: 3,
                      fillColor: "#cf8a2c",
                      fillOpacity: 1,
                    }}
                  >
                    <Tooltip permanent direction="left">Destination · {pair.end.name}</Tooltip>
                  </CircleMarker>
                </>
              )}
              <JourneyViewport
                frameCoordinates={areaFocusCoordinates}
                extensionCoordinates={viewportExtensionCoordinates}
                frameKey={viewportFrameKey}
                extensionKey={viewportExtensionKey}
              />
            </MapContainer>
            <div className="journey-map-key">
              {checkedJourney ? (
                <>
                  <span><i className="learner-route-line" />Your route</span>
                  <span><i className="suggested-route-line" />Suggested route</span>
                </>
              ) : (
                <span><i className="selected-road-line" />Selected street</span>
              )}
            </div>
          </div>
        </div>

        <div className="journey-road-builder">
          <div className="journey-road-heading">
            <div>
              <p className="eyebrow">BUILD THE CONNECTION</p>
              <h2>Which streets join the two places?</h2>
              <span>Select them in travelling order and watch the city take shape.</span>
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
              + Add street
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
                  <span className="journey-step-number">{index + 1}</span>
                  <span
                    className="journey-drag-handle"
                    aria-hidden="true"
                    draggable
                    onDragStart={() => setDraggingRoad(index)}
                    onDragEnd={() => setDraggingRoad(null)}
                  >
                    ⠿
                  </span>
                </label>
                <input
                  id={`journey-road-${index}`}
                  list="journey-road-options"
                  aria-label={`Street ${index + 1}`}
                  value={selection}
                  onFocus={() => setActiveRoadIndex(index)}
                  onChange={(event) => changeRoad(index, event.target.value)}
                  placeholder="Choose or type a street…"
                  autoComplete="off"
                />
                <div className="journey-road-actions">
                  <button
                    type="button"
                    aria-label={`Move street ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => moveRoad(index, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move street ${index + 1} down`}
                    disabled={index === roadSelections.length - 1}
                    onClick={() => moveRoad(index, index + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="journey-remove-road"
                    aria-label={`Remove street ${index + 1}`}
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
          <datalist id="journey-road-options">
            {roadSuggestions.map((road) => (
              <option value={road.name} key={road.name} />
            ))}
          </datalist>

          <div className="journey-check-row">
            <span>
              {selectedRoads.length
                ? `${selectedRoads.length} street${selectedRoads.length === 1 ? "" : "s"} mapped`
                : "Add at least one street to compare the route"}
            </span>
            <button
              type="button"
              className="primary"
              disabled={!selectedRoads.length || checking}
              onClick={() => void checkRoute()}
            >
              {checking ? "Calculating routes…" : "Compare route"}
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

      {checkedJourney && (
        <section className="journey-result-summary" aria-live="polite">
          <div>
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
          <div className="journey-review-note">
            <span>What to notice</span>
            <p>
              Compare the streets you placed with the routed line. The useful
              question is not only whether it is shorter, but where your mental
              map stopped connecting.
            </p>
          </div>
        </section>
      )}
    </>
  );
}
