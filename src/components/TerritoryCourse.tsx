import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Polygon,
  Tooltip,
} from "react-leaflet";
import { TaxiMapTiles } from "./TaxiMapTiles";
import {
  compareRouteGeometry,
  formatJourneyDistance,
  journeyRoadOptions,
  requestOsrmRoute,
  roadWaypointOnRoute,
  type OsrmRoute,
} from "../domain/journeys";
import {
  buildTerritoryChallenge,
  connectorRoadSequence,
  curriculumRoadSequence,
  routeUsesEndpointRoads,
  scoreRouteAttempt,
  spineRoadSequence,
  TERRITORY_CHECKPOINT_RUNS_REQUIRED,
  updateTerritoryProgress,
} from "../domain/route-learning";
import { knowledgeAreaLabels } from "../domain/geographic-knowledge";
import { normaliseRoadName } from "../domain/road-names";
import { buildTerritoryPolygons } from "../domain/territory-polygons";
import { buildPersonalRouteHints } from "../domain/personal-route-hints";
import { PersonalRouteHint } from "./PersonalRouteHint";
import {
  buildTerritoryQuestions,
  selectTerritoryQuestion,
  type TerritoryQuestion,
} from "../domain/territory-questions";
import type {
  Association,
  LearningRecord,
  Mastery,
  RoadGeometryCollection,
  RouteAttempt,
  RouteChallenge,
  RouteSession,
  RoutingManifest,
  TerritoryDefinition,
  TerritoryProgress,
  PersonalPlace,
  TerritoryStitch,
} from "../domain/types";
import "./territory-course.css";
import "./territory-motion.css";

const OSRM_BASE_URL =
  import.meta.env.VITE_BACKEND_BASE_URL?.trim() ||
  import.meta.env.VITE_OSRM_BASE_URL?.trim() ||
  (import.meta.env.DEV ? "/api/osrm" : "https://router.project-osrm.org");

type Props = {
  territories: TerritoryDefinition[];
  records: LearningRecord[];
  geometry: RoadGeometryCollection;
  routing: RoutingManifest;
  associations: Association[];
  mastery: ReadonlyMap<string, Mastery>;
  attempts: RouteAttempt[];
  progress: ReadonlyMap<string, TerritoryProgress>;
  onAttempt: (attempt: RouteAttempt, progress: TerritoryProgress) => Promise<void>;
  savedSession?: RouteSession | null;
  onSessionSave?: (session: RouteSession) => Promise<void>;
  onSessionClear?: () => Promise<void>;
  onPracticeFacts?: (territory: TerritoryDefinition) => void;
  personalPlaces?: PersonalPlace[];
  stitches?: TerritoryStitch[];
  initialTerritoryId?: string | null;
};

const unique = (values: string[]) => [...new Set(values)];

export function TerritoryCourse({
  territories,
  records,
  geometry,
  routing,
  associations,
  mastery,
  attempts,
  progress,
  onAttempt,
  savedSession,
  onSessionSave,
  onSessionClear,
  onPracticeFacts,
  personalPlaces = [],
  stitches = [],
  initialTerritoryId,
}: Props) {
  const [selectedTerritoryId, setSelectedTerritoryId] = useState(
    savedSession?.territory_id ?? initialTerritoryId ?? territories[0]?.id ?? "",
  );
  const [area, setArea] = useState<TerritoryDefinition["area"] | "all">("all");
  const [challenge, setChallenge] = useState<RouteChallenge | null>(
    savedSession?.routing_version === routing.routing_version
      ? savedSession.challenge
      : null,
  );
  const [suggested, setSuggested] = useState<OsrmRoute | null>(null);
  const [learner, setLearner] = useState<OsrmRoute | null>(null);
  const [requiredRoads, setRequiredRoads] = useState<string[]>([]);
  const [connectors, setConnectors] = useState<string[]>([]);
  const [roadSelections, setRoadSelections] = useState(
    savedSession?.routing_version === routing.routing_version
      ? [...savedSession.selected_road_names, "", ""].slice(0, Math.max(3, savedSession.selected_road_names.length))
      : ["", "", ""],
  );
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [lastAttempt, setLastAttempt] = useState<RouteAttempt | null>(null);
  const [mapLayer, setMapLayer] = useState<"territories" | "connections">("territories");
  const [dispatchQuestion, setDispatchQuestion] = useState<TerritoryQuestion | null>(null);
  const [dispatchChoice, setDispatchChoice] = useState("");
  const [dispatchCleared, setDispatchCleared] = useState(false);
  const territory =
    territories.find((item) => item.id === selectedTerritoryId) ?? territories[0];
  const recordsById = useMemo(
    () => new Map(records.map((record) => [record.id, record])),
    [records],
  );
  const roadOptions = useMemo(() => journeyRoadOptions(geometry), [geometry]);
  const territoryPolygons = useMemo(
    () => buildTerritoryPolygons(territories),
    [territories],
  );
  const roadOptionsByName = useMemo(
    () =>
      new Map(
        roadOptions.flatMap((option) => [
          [option.name, option] as const,
          [normaliseRoadName(option.name), option] as const,
        ]),
      ),
    [roadOptions],
  );
  const visibleTerritories = territories.filter(
    (item) => area === "all" || item.area === area,
  );
  const territoryProgress = territory ? progress.get(territory.id) : undefined;
  const territoryRecordIds = new Set(
    territory
      ? [
          territory.district_record_id,
          ...territory.nearby_record_ids,
          ...territory.approach_record_ids,
        ]
      : [],
  );
  const factualAssociations = associations.filter(
    (association) =>
      association.required && territoryRecordIds.has(association.record_id),
  );
  const masteredFacts = factualAssociations.filter(
    (association) => mastery.get(association.id)?.state === "mastered",
  ).length;
  const factualPercentage = factualAssociations.length
    ? Math.round((masteredFacts / factualAssociations.length) * 100)
    : 0;
  const passedRuns = attempts.filter(
    (attempt) => attempt.territory_id === territory?.id && attempt.passed,
  );
  const streak = [...attempts]
    .reverse()
    .findIndex((attempt) => !attempt.passed);
  const routeReady =
    (territoryProgress?.route_coverage_percentage ?? 0) >=
    (territory?.checkpoint_target_percentage ?? 80);
  const checkpointReady = routeReady && factualPercentage === 100;
  const passedCheckpointRuns = new Set(
    passedRuns
      .filter((attempt) => attempt.mode === "checkpoint")
      .map((attempt) => attempt.challenge_id),
  ).size;
  const selectedTerritoryRoadFeatures = useMemo(
    () => {
      if (!territory) return [];
      const linkIds = new Set(territory.target_road_link_ids);
      return geometry.features.filter((feature) =>
        linkIds.has(feature.properties.road_link_id),
      );
    }, [geometry.features, territory],
  );
  const selectedStitches = useMemo(
    () => stitches.filter((stitch) => territory?.stitch_ids?.includes(stitch.id)),
    [stitches, territory],
  );
  const personalRouteHints = useMemo(
    () => suggested ? buildPersonalRouteHints(suggested, personalPlaces) : [],
    [personalPlaces, suggested],
  );

  useEffect(() => {
    if (
      savedSession &&
      savedSession.routing_version !== routing.routing_version
    )
      void onSessionClear?.();
  }, [onSessionClear, routing.routing_version, savedSession]);

  useEffect(() => {
    if (!challenge || suggested || !territory) return;
    let cancelled = false;
    setChecking(true);
    const challengeStitch = stitches.find(
      (stitch) => stitch.id === challenge.stitch_id,
    );
    const stitchWaypoints = (challengeStitch?.road_link_ids ?? [])
      .flatMap((linkId) => {
        const feature = geometry.features.find(
          (item) => item.properties.road_link_id === linkId,
        );
        if (!feature?.geometry.coordinates.length) return [];
        return [
          feature.geometry.coordinates.reduce((closest, point) => {
            const pointDistance =
              (point[0] - challengeStitch!.crossing_coordinate[0]) ** 2 +
              (point[1] - challengeStitch!.crossing_coordinate[1]) ** 2;
            const closestDistance =
              (closest[0] - challengeStitch!.crossing_coordinate[0]) ** 2 +
              (closest[1] - challengeStitch!.crossing_coordinate[1]) ** 2;
            return pointDistance < closestDistance ? point : closest;
          }),
        ];
      })
      .sort(
        (left, right) =>
          (left[0] - challenge.start.coordinate[0]) ** 2 +
          (left[1] - challenge.start.coordinate[1]) ** 2 -
          ((right[0] - challenge.start.coordinate[0]) ** 2 +
            (right[1] - challenge.start.coordinate[1]) ** 2),
      );
    requestOsrmRoute(OSRM_BASE_URL, [
      challenge.start.coordinate,
      ...stitchWaypoints,
      challenge.end.coordinate,
    ])
      .then((baseline) => {
        if (cancelled) return;
        const endpointUse = routeUsesEndpointRoads(
          baseline,
          challenge.start.road_name,
          challenge.end.road_name,
        );
        if (!endpointUse.start || !endpointUse.end)
          throw new Error(
            `OSRM could not confirm the learned ${!endpointUse.start && !endpointUse.end ? "start or finish roads" : !endpointUse.start ? "start road" : "finish road"} for this fare. Try another run.`,
          );
        const targetIdentities = new Set(
          territory.target_road_names.map(normaliseRoadName),
        );
        const routeCurriculum = curriculumRoadSequence(baseline, roadOptions);
        const spines = spineRoadSequence(baseline, records);
        const spineIdentities = new Set(spines.map(normaliseRoadName));
        const curriculum = routeCurriculum.filter((name) => {
          const identity = normaliseRoadName(name);
          return targetIdentities.has(identity) || spineIdentities.has(identity);
        });
        const required = unique([
          challenge.start.road_name,
          ...curriculum,
          ...challenge.target_road_names,
          challenge.end.road_name,
        ]);
        setSuggested(baseline);
        setRequiredRoads(required);
        setConnectors(connectorRoadSequence(baseline, required));
        setChallenge((current) =>
          current ? { ...current, target_road_names: required } : current,
        );
        const questions = buildTerritoryQuestions({
          territory,
          territories,
          records,
          stitches,
          seed: challenge.id,
        });
        setDispatchQuestion(
          questions.find((question) =>
            challenge.stitch_id
              ? question.id.includes(challenge.stitch_id)
              : false,
          ) ?? selectTerritoryQuestion(questions, challenge.id),
        );
        setDispatchCleared(Boolean(savedSession));
      })
      .catch((cause) =>
        !cancelled &&
        setError(
          cause instanceof Error
            ? cause.message
            : "OSRM could not prepare this learning run.",
        ),
      )
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [challenge, geometry.features, records, roadOptions, savedSession, stitches, suggested, territories, territory]);

  useEffect(() => {
    if (!challenge || !onSessionSave) return;
    const now = new Date().toISOString();
    void onSessionSave({
      id: "active:route",
      schema_version: "1.0.0",
      status: "active",
      territory_id: challenge.territory_id,
      mode: challenge.mode,
      challenge,
      selected_road_names: roadSelections.filter(Boolean),
      created_at: savedSession?.created_at ?? now,
      updated_at: now,
      routing_version: routing.routing_version,
    });
  }, [challenge, onSessionSave, roadSelections, routing.routing_version, savedSession?.created_at]);

  const startRun = (mode: "guided" | "checkpoint") => {
    if (!territory) return;
    const coveredRoads = new Set(
      (territoryProgress?.covered_road_names ?? []).map(normaliseRoadName),
    );
    const nextUncoveredStitch = selectedStitches.find((stitch) =>
      stitch.road_names.some(
        (name) => !coveredRoads.has(normaliseRoadName(name)),
      ),
    );
    const next = buildTerritoryChallenge({
      territory,
      territories,
      records,
      routing,
      stitches,
      preferredStitchId: nextUncoveredStitch?.id,
      mode,
      seed: `${attempts.length}:${Date.now()}`,
    });
    if (!next) {
      setError("This territory does not yet have enough mapped endpoints for a run.");
      return;
    }
    setError("");
    setLastAttempt(null);
    setLearner(null);
    setRoadSelections(["", "", ""]);
    setSuggested(null);
    setChallenge(next);
    setDispatchChoice("");
    setDispatchCleared(false);
  };

  const addRoadFromMap = (candidateNames: string[]) => {
    const candidate = candidateNames.find(
      (name) =>
        roadOptionsByName.has(name) ||
        roadOptionsByName.has(normaliseRoadName(name)),
    );
    if (!candidate) return;
    const canonical =
      roadOptionsByName.get(candidate)?.name ??
      roadOptionsByName.get(normaliseRoadName(candidate))?.name ??
      candidate;
    setRoadSelections((current) => {
      if (current.some((name) => normaliseRoadName(name) === normaliseRoadName(canonical)))
        return current;
      const blank = current.findIndex((name) => !name.trim());
      if (blank < 0) return [...current, canonical];
      return current.map((name, index) => (index === blank ? canonical : name));
    });
    setLastAttempt(null);
  };

  const compareRun = async () => {
    if (!territory || !challenge || !suggested) return;
    const selected = roadSelections.filter((name) =>
      roadOptionsByName.has(name) || roadOptionsByName.has(normaliseRoadName(name)),
    );
    if (!selected.length) return;
    setChecking(true);
    setError("");
    try {
      const waypoints = selected
        .map((name) => roadOptionsByName.get(name) ?? roadOptionsByName.get(normaliseRoadName(name))!)
        .map((option) => roadWaypointOnRoute(option, suggested.coordinates));
      const routed = await requestOsrmRoute(OSRM_BASE_URL, [
        challenge.start.coordinate,
        ...waypoints,
        challenge.end.coordinate,
      ]);
      const comparison = compareRouteGeometry(
        routed.coordinates,
        suggested.coordinates,
      );
      const attempt = scoreRouteAttempt({
        challenge,
        selectedRoadNames: selected,
        requiredRoadNames: requiredRoads,
        connectorRoadNames: connectors,
        suggested,
        learner: routed,
        comparison,
      });
      const nextAttempts = [...attempts, attempt];
      const nextProgress = updateTerritoryProgress({
        territory,
        attempts: nextAttempts,
        routingVersion: routing.routing_version,
      });
      setLearner(routed);
      setLastAttempt(attempt);
      await onAttempt(attempt, nextProgress);
      await onSessionClear?.();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "This run could not be checked.",
      );
    } finally {
      setChecking(false);
    }
  };

  if (!territory)
    return <section className="territory-empty">No district territories are available.</section>;

  const district = recordsById.get(territory.district_record_id);
  const destinationNames = territory.nearby_record_ids
    .map((id) => recordsById.get(id)?.exam_name)
    .filter((name): name is string => Boolean(name));
  const suggestedPositions = suggested?.coordinates.map(
    ([longitude, latitude]) => [latitude, longitude] as [number, number],
  );
  const learnerPositions = learner?.coordinates.map(
    ([longitude, latitude]) => [latitude, longitude] as [number, number],
  );
  const roadChoices = unique([
    ...(challenge?.mode === "guided" ? requiredRoads : []),
    ...territory.target_road_names,
    ...territory.neighbouring_territory_ids.flatMap(
      (id) => territories.find((item) => item.id === id)?.associated_road_names ?? [],
    ),
  ]).sort((left, right) => left.localeCompare(right, "en-GB"));

  return (
    <div className="territory-course">
      <header className="territory-course__hero">
        <div>
          <p className="eyebrow">GLASGOW TERRITORIES</p>
          <h1>Learn to work the city, not memorise a list.</h1>
          <span>
            Place the important knowledge roads. OSRM completes motorways,
            junctions and other non-tested connectors automatically.
          </span>
        </div>
        <div className="territory-game-stats">
          <div><strong>{passedRuns.length * 100}</strong><span>route XP</span></div>
          <div><strong>{streak < 0 ? attempts.length : streak}</strong><span>run streak</span></div>
          <div><strong>{progress.size}</strong><span>territories started</span></div>
        </div>
      </header>

      {!challenge ? (
        <section className="territory-select-layout">
          <aside className="territory-picker">
            <label>
              <span>City area</span>
              <select value={area} onChange={(event) => setArea(event.target.value as typeof area)}>
                <option value="all">All Glasgow</option>
                {(["north", "east", "south", "west"] as const).map((value) => (
                  <option value={value} key={value}>{knowledgeAreaLabels[value]}</option>
                ))}
              </select>
            </label>
            <div>
              {visibleTerritories.map((item) => {
                const itemProgress = progress.get(item.id);
                return (
                  <button
                    type="button"
                    className={item.id === territory.id ? "active" : ""}
                    onClick={() => setSelectedTerritoryId(item.id)}
                    key={item.id}
                  >
                    <span>{item.name}</span>
                    <small>{itemProgress?.route_coverage_percentage ?? 0}% route coverage</small>
                  </button>
                );
              })}
            </div>
          </aside>
          <article className="territory-brief">
            <div className="territory-map-panel">
              <header>
                <div><p className="eyebrow">CITY KNOWLEDGE MAP</p><strong>{mapLayer === "territories" ? "District territory coverage" : "How learned roads stitch territories together"}</strong></div>
                <div><button type="button" className={mapLayer === "territories" ? "active" : ""} onClick={() => setMapLayer("territories")}>Territories</button><button type="button" className={mapLayer === "connections" ? "active" : ""} onClick={() => setMapLayer("connections")}>Connections</button></div>
              </header>
              <MapContainer center={[55.8642, -4.2518]} zoom={11} scrollWheelZoom>
                <TaxiMapTiles />
                {territories.map((item) => {
                  const polygon = territoryPolygons.get(item.id) ?? [];
                  const coverage = progress.get(item.id)?.route_coverage_percentage ?? 0;
                  const selected = item.id === territory.id;
                  return polygon.length >= 3 ? (
                    <Polygon
                      key={item.id}
                      positions={polygon.map(([longitude, latitude]) => [latitude, longitude])}
                      pathOptions={{
                        color: selected ? "#f26b38" : item.area === "west" ? "#6941c6" : item.area === "east" ? "#c4320a" : item.area === "south" ? "#087a55" : "#155eef",
                        weight: selected ? 4 : 1.25,
                        fillOpacity: mapLayer === "connections" ? 0.06 : selected ? 0.42 : 0.1 + coverage / 180,
                      }}
                      eventHandlers={{ click: () => setSelectedTerritoryId(item.id) }}
                    >
                      <Tooltip sticky><strong>{item.name}</strong><br />{coverage}% route coverage</Tooltip>
                    </Polygon>
                  ) : null;
                })}
                {personalPlaces.map((place) => (
                  <CircleMarker key={`personal:${place.id}`} center={[place.coordinate[1], place.coordinate[0]]} radius={6} pathOptions={{ color: "#fff", weight: 2, fillColor: "#7a5af8", fillOpacity: 1 }}>
                    <Tooltip><strong>{place.name}</strong><br />Personal timeline · {place.from_date || "date not set"}{place.to_date ? ` – ${place.to_date}` : place.from_date ? " – present" : ""}{place.note && <><br />{place.note}</>}</Tooltip>
                  </CircleMarker>
                ))}
                {mapLayer === "connections" && selectedTerritoryRoadFeatures
                  .map((feature) => (
                    <Polyline
                      key={feature.properties.road_link_id}
                      positions={feature.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude])}
                      pathOptions={{ color: "#f26b38", weight: 5, opacity: .82 }}
                    ><Tooltip>{feature.properties.names.join(" / ") || "Mapped connector"}</Tooltip></Polyline>
                  ))}
                {mapLayer === "connections" && selectedStitches.map((stitch) => (
                  <Polyline
                    key={`seam:${stitch.id}`}
                    positions={stitch.shared_boundary.map(([longitude, latitude]) => [latitude, longitude])}
                    pathOptions={{ color: "#7a5af8", weight: 7, opacity: .9, dashArray: "3 8" }}
                  ><Tooltip sticky><strong>{stitch.road_name}</strong><br />Verified district stitch</Tooltip></Polyline>
                ))}
              </MapContainer>
              <footer><span><i className="territory-seam-key" />District learning territory</span><span><i className="territory-road-key" />Learned road connection</span><small>Learning territories are derived from district street anchors, not official administrative boundaries.</small></footer>
            </div>
            <div className="territory-brief__title">
              <div>
                <p className="eyebrow">CURRENT TERRITORY · {knowledgeAreaLabels[territory.area]}</p>
                <h2>{territory.name}</h2>
                <p>
                  Build a working mental map from its named streets to nearby
                  destinations, main-road approaches and neighbouring districts.
                </p>
              </div>
              <div className="territory-level"><strong>{territoryProgress?.route_coverage_percentage ?? 0}%</strong><span>route coverage</span></div>
            </div>
            <div className="territory-meters">
              <label>Street facts <progress value={factualPercentage} max={100} /><span>{factualPercentage}%</span></label>
              <label>Route knowledge <progress value={territoryProgress?.route_coverage_percentage ?? 0} max={100} /><span>{territoryProgress?.route_coverage_percentage ?? 0}%</span></label>
            </div>
            <section className="territory-mission-grid">
              <article><span>01</span><h3>Learn this area</h3><p>{district?.exam_name}, its streets, and {destinationNames.length} nearby named associations.</p></article>
              <article><span>02</span><h3>Test the associations</h3><p>Build recognition and recall using the exam-style choices.</p></article>
              <article><span>03</span><h3>Take a stitch road</h3><p>After the area is familiar, use one of {selectedStitches.length} pathways into an adjoining area.</p></article>
              <article><span>04</span><h3>Optional route practice</h3><p>Use guided runs to understand connections without blocking factual learning.</p></article>
            </section>
            <div className="territory-road-ribbon">
              <span>District streets</span>
              {territory.associated_road_names.map((name) => <b key={name}>{name}</b>)}
            </div>
            <section className="territory-stitch-list">
              <p className="eyebrow">AFTER THIS AREA · STITCH ROADS</p>
              <p>These are pathways into the next local group. They connect learned areas but are not prerequisites for learning this area&apos;s named associations.</p>
              {selectedStitches.map((stitch) => {
                const otherId = stitch.territory_ids.find((id) => id !== territory.id);
                const other = territories.find((item) => item.id === otherId);
                return <article className="stitch-road" key={stitch.id}><span>STITCH ROAD · {territory.name} → {other?.name ?? "adjoining district"}</span><strong>{stitch.entry_road_names[territory.id] ?? stitch.road_name}</strong><small>{stitch.connection_kind === "crossing_road" ? "Continues over the seam" : stitch.connection_kind === "road_junction" ? `Road-name handover · ${stitch.road_name}` : `Boundary approaches · ${stitch.road_name}`}</small></article>;
              })}
            </section>
            <div className="territory-actions">
              <button className="back" type="button" onClick={() => onPracticeFacts?.(territory)}>Practise street facts</button>
              <button className="primary" type="button" disabled={checking} onClick={() => startRun("guided")}>{checking ? "Preparing run…" : "Start guided run"}</button>
              <button className="back" type="button" disabled={!checkpointReady || checking} onClick={() => startRun("checkpoint")}>Territory checkpoint</button>
              {!checkpointReady && <small>Unlock at 100% street facts and {territory.checkpoint_target_percentage}% route coverage.</small>}
              {checkpointReady && <small>{Math.min(passedCheckpointRuns, TERRITORY_CHECKPOINT_RUNS_REQUIRED)} of {TERRITORY_CHECKPOINT_RUNS_REQUIRED} checkpoint fares cleared.</small>}
            </div>
          </article>
        </section>
      ) : (
        <section className="territory-run">
          <header className="territory-run__brief">
            <button className="back" type="button" onClick={() => { setChallenge(null); setSuggested(null); setLearner(null); void onSessionClear?.(); }}>← Territory overview</button>
            <div><p className="eyebrow">{challenge.mode === "checkpoint" ? "TERRITORY CHECKPOINT" : "GUIDED LEARNING RUN"}</p><h2>{challenge.start.record_name} → {challenge.end.record_name}</h2><span>Start on {challenge.start.road_name}. Finish through {challenge.end.road_name}.</span></div>
            <div className="run-reward"><strong>+100</strong><span>XP available</span></div>
          </header>
          {dispatchQuestion && !dispatchCleared ? (
            <section className="dispatch-decision">
              <div className="dispatch-radio" aria-hidden="true"><span>DISPATCH</span><i>•••</i></div>
              <p className="eyebrow">QUICK STREET DECISION · +25 XP</p>
              <h2>{dispatchQuestion.prompt}</h2>
              <span>{dispatchQuestion.context}</span>
              <div className="dispatch-options">
                {dispatchQuestion.options.map((option, index) => {
                  const chosen = dispatchChoice === option.id;
                  const correct = option.id === dispatchQuestion.answerId;
                  return <button type="button" className={chosen ? correct ? "correct" : "wrong" : ""} onClick={() => setDispatchChoice(option.id)} key={option.id}><kbd>{String.fromCharCode(65 + index)}</kbd><span>{option.label}</span></button>;
                })}
              </div>
              {dispatchChoice && (
                <div className={dispatchChoice === dispatchQuestion.answerId ? "dispatch-feedback correct" : "dispatch-feedback wrong"}>
                  <strong>{dispatchChoice === dispatchQuestion.answerId ? "Connection found" : "That would put the run on the wrong connection"}</strong>
                  <p>{dispatchChoice === dispatchQuestion.answerId ? dispatchQuestion.explanation : "Compare the road roles and try again—the alternatives are drawn from nearby territory knowledge."}</p>
                </div>
              )}
              <button className="primary" type="button" disabled={dispatchChoice !== dispatchQuestion.answerId} onClick={() => setDispatchCleared(true)}>Open the route map →</button>
            </section>
          ) : <div className="territory-run__workspace">
            <div className="territory-run__map">
              <MapContainer center={[challenge.start.coordinate[1], challenge.start.coordinate[0]]} zoom={13} scrollWheelZoom>
                <TaxiMapTiles />
                {selectedTerritoryRoadFeatures.map((feature) => (
                  <Polyline
                    key={`tap:${feature.properties.road_link_id}`}
                    positions={feature.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude])}
                    pathOptions={{ color: "#126e75", weight: 8, opacity: .3 }}
                    eventHandlers={{ click: () => addRoadFromMap(feature.properties.names) }}
                  >
                    <Tooltip sticky>{feature.properties.names.join(" / ") || "Learned road"}<br />Tap to add</Tooltip>
                  </Polyline>
                ))}
                {suggestedPositions && <Polyline positions={suggestedPositions} pathOptions={{ color: "#8b98aa", weight: 9, opacity: learner ? .42 : .18, dashArray: learner ? undefined : "8 12" }} />}
                {learnerPositions && <Polyline positions={learnerPositions} pathOptions={{ color: "#f26b38", weight: 6, opacity: .95, dashArray: "14 10", className: "fare-replay-line" }} />}
                <CircleMarker center={[challenge.start.coordinate[1], challenge.start.coordinate[0]]} radius={8} pathOptions={{color:"#fff",weight:3,fillColor:"#17212b",fillOpacity:1}}><Tooltip permanent>Pickup · {challenge.start.record_name}</Tooltip></CircleMarker>
                <CircleMarker center={[challenge.end.coordinate[1], challenge.end.coordinate[0]]} radius={8} pathOptions={{color:"#fff",weight:3,fillColor:"#f3a712",fillOpacity:1}}><Tooltip permanent>Drop-off · {challenge.end.record_name}</Tooltip></CircleMarker>
              </MapContainer>
            </div>
            <aside className="territory-run__builder">
              <p className="eyebrow">PLACE THE KNOWLEDGE ROADS</p>
              <h3>Which learned roads matter?</h3>
              <p>Work out through the local associations, use the area pathway roads, then choose the correct final approach. Stitch roads continue the pathway into neighbouring areas; motorways and unnamed infrastructure remain automatic.</p>
              {challenge.mode !== "checkpoint" && <PersonalRouteHint hints={personalRouteHints} />}
              {challenge.mode === "guided" && !!requiredRoads.length && <div className="working-corridor"><span>Working corridor</span>{requiredRoads.map((name, index) => <b key={`${name}:${index}`}>{name}</b>)}</div>}
              {challenge.mode === "guided" && <div className="run-hint"><strong>{requiredRoads.length} roads to place</strong><span>Initials: {requiredRoads.map((name) => name[0]).join(" · ")}</span></div>}
              <ol>
                {roadSelections.map((selection, index) => (
                  <li key={index}><span>{index + 1}</span><input list="territory-road-options" aria-label={`Knowledge road ${index + 1}`} value={selection} onChange={(event) => setRoadSelections((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} placeholder="Tap or type a learned road…" /><button type="button" aria-label={`Remove road ${index + 1}`} onClick={() => setRoadSelections((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></li>
                ))}
              </ol>
              <datalist id="territory-road-options">{roadChoices.map((name) => <option value={name} key={name} />)}</datalist>
              <button className="link" type="button" onClick={() => setRoadSelections((current) => [...current, ""])}>+ Add road</button>
              <button className="primary wide" type="button" disabled={checking || !roadSelections.some((name) => roadOptionsByName.has(name) || roadOptionsByName.has(normaliseRoadName(name)))} onClick={() => void compareRun()}>{checking ? "OSRM is checking…" : "Drive this route"}</button>
              {error && <p className="territory-run__error" role="alert">{error}</p>}
              {lastAttempt && (
                <section className={lastAttempt.passed ? "run-result passed" : "run-result retry"} aria-live="polite">
                  <div><strong>{lastAttempt.score_percentage}%</strong><span>{lastAttempt.passed ? "Run cleared" : "Route needs work"}</span></div>
                  <p>{lastAttempt.passed ? "Nice work—the important roads are in the right corridor." : `Missing: ${lastAttempt.missing_road_names.join(" · ") || "The chosen order left the OSRM corridor"}`}</p>
                  {!!connectors.length && <details open><summary>OSRM inserted {connectors.length} connector{connectors.length === 1 ? "" : "s"}</summary><div className="connector-chips">{connectors.map((name) => <span key={name}>AUTO · {name}</span>)}</div></details>}
                  <dl><div><dt>Route overlap</dt><dd>{lastAttempt.overlap_percentage}%</dd></div><div><dt>Efficiency</dt><dd>{lastAttempt.distance_efficiency_percentage}%</dd></div><div><dt>Distance</dt><dd>{learner ? formatJourneyDistance(learner.distanceMetres) : "—"}</dd></div></dl>
                  {lastAttempt.passed && challenge.mode === "checkpoint" && passedCheckpointRuns < TERRITORY_CHECKPOINT_RUNS_REQUIRED && (
                    <button className="primary wide" type="button" onClick={() => startRun("checkpoint")}>
                      Next checkpoint fare
                    </button>
                  )}
                </section>
              )}
            </aside>
          </div>}
        </section>
      )}
    </div>
  );
}
