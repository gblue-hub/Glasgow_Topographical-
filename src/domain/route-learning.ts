import { getAnswerFeatures } from "./questions";
import { normaliseRoadName } from "./road-names";
import { seededRandom } from "./session";
import type {
  LearningRecord,
  RouteAttempt,
  RouteChallenge,
  RouteChallengeEndpoint,
  RoutingManifest,
  TerritoryDefinition,
  TerritoryProgress,
  TerritoryStitch,
} from "./types";
import type { JourneyRoadOption, OsrmRoute, RouteComparison } from "./journeys";

const distinct = (values: string[]) => [...new Set(values.filter(Boolean))];

export const TERRITORY_CHECKPOINT_RUNS_REQUIRED = 3;

const primaryFeature = (record: LearningRecord) =>
  record.features.find((feature) => feature.role === "place") ??
  record.features.find((feature) => feature.role === "middle_road") ??
  getAnswerFeatures(record)[0] ??
  record.features[0];

const endpoint = (
  record: LearningRecord,
  feature = primaryFeature(record),
): RouteChallengeEndpoint | null =>
  feature
    ? {
        record_id: record.id,
        record_name: record.exam_name,
        road_name: feature.exam_name,
        coordinate: feature.effective_coordinates,
      }
    : null;

export function buildTerritoryChallenge(input: {
  territory: TerritoryDefinition;
  territories: TerritoryDefinition[];
  records: LearningRecord[];
  routing: RoutingManifest;
  stitches?: TerritoryStitch[];
  preferredStitchId?: string;
  mode: "guided" | "checkpoint";
  seed: string;
}): RouteChallenge | null {
  const recordsById = new Map(input.records.map((record) => [record.id, record]));
  const district = recordsById.get(input.territory.district_record_id);
  if (!district) return null;
  const random = seededRandom(`${input.seed}:${input.territory.id}:${input.mode}`);
  const districtFeatures = getAnswerFeatures(district);
  const startFeature =
    districtFeatures[Math.floor(random() * Math.max(1, districtFeatures.length))] ??
    primaryFeature(district);
  const start = endpoint(district, startFeature);
  let endRecord: LearningRecord | undefined;
  const territoryStitches = (input.stitches ?? []).filter((stitch) =>
    input.territory.stitch_ids?.includes(stitch.id),
  );
  const selectedStitch =
    territoryStitches.find((stitch) => stitch.id === input.preferredStitchId) ??
    (territoryStitches.length
      ? territoryStitches[Math.floor(random() * territoryStitches.length)]
      : undefined);

  if (selectedStitch) {
    const destinationTerritoryId = selectedStitch.territory_ids.find(
      (id) => id !== input.territory.id,
    );
    const destination = input.territories.find(
      (item) => item.id === destinationTerritoryId,
    );
    endRecord = destination
      ? recordsById.get(destination.district_record_id)
      : undefined;
  } else if (input.mode === "checkpoint") {
    const neighbours = new Set(input.territory.neighbouring_territory_ids);
    const crossArea = input.territories.filter(
      (item) => item.id !== input.territory.id && item.area !== input.territory.area,
    );
    const nonNeighbours = input.territories.filter(
      (item) => item.id !== input.territory.id && !neighbours.has(item.id),
    );
    const neighbouring = input.territories.filter((item) => neighbours.has(item.id));
    // Checkpoints alternate between local joins and broader city work. This makes
    // district knowledge a property of real fares, not an isolated boundary quiz.
    const candidates = random() < 0.55 && crossArea.length
      ? crossArea
      : nonNeighbours.length
        ? nonNeighbours
        : neighbouring;
    const destination = candidates[Math.floor(random() * candidates.length)];
    endRecord = destination
      ? recordsById.get(destination.district_record_id)
      : undefined;
  }
  if (!endRecord && input.territory.nearby_record_ids.length) {
    const destinationId =
      input.territory.nearby_record_ids[
        Math.floor(random() * input.territory.nearby_record_ids.length)
      ];
    endRecord = recordsById.get(destinationId);
  }
  if (!endRecord && input.territory.approach_record_ids.length)
    endRecord = recordsById.get(input.territory.approach_record_ids[0]);
  const end = endRecord ? endpoint(endRecord) : null;
  if (!start || !end || start.record_id === end.record_id) return null;
  return {
    id: `route:${input.territory.id}:${input.mode}:${input.seed}`,
    territory_id: input.territory.id,
    mode: input.mode,
    start,
    end,
    target_road_names: distinct([
      start.road_name,
      ...(selectedStitch?.road_names ?? []),
      end.road_name,
    ]),
    stitch_id: selectedStitch?.id,
    routing_version: input.routing.routing_version,
  };
}

const routeNames = (route: OsrmRoute) =>
  route.steps.map((step) => step.displayName).filter(Boolean);

const roadNamesMatch = (left: string, right: string) => {
  const a = normaliseRoadName(left);
  const b = normaliseRoadName(right);
  return Boolean(
    a &&
      b &&
      (a === b ||
        (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)))),
  );
};

export function routeUsesEndpointRoads(
  route: OsrmRoute,
  startRoadName: string,
  endRoadName: string,
) {
  const meaningful = routeNames(route).filter(
    (name) => normaliseRoadName(name) !== "unnamed connector",
  );
  const startWindow = meaningful.slice(0, 3);
  const endWindow = meaningful.slice(-3);
  return {
    start: startWindow.some((name) => roadNamesMatch(name, startRoadName)),
    end: endWindow.some((name) => roadNamesMatch(name, endRoadName)),
  };
}

export function curriculumRoadSequence(
  route: OsrmRoute,
  roadOptions: JourneyRoadOption[],
) {
  const optionByNormalised = new Map<string, string>();
  for (const option of roadOptions)
    optionByNormalised.set(normaliseRoadName(option.name), option.name);
  const output: string[] = [];
  for (const stepName of routeNames(route)) {
    const normalised = normaliseRoadName(stepName);
    const exact = optionByNormalised.get(normalised);
    const fuzzy = exact
      ? exact
      : [...optionByNormalised].find(
          ([candidate]) =>
            candidate.length >= 4 &&
            normalised.length >= 4 &&
            (candidate.includes(normalised) || normalised.includes(candidate)),
        )?.[1];
    if (fuzzy && output.at(-1) !== fuzzy) output.push(fuzzy);
  }
  return output;
}

/** Main-road records become working curriculum when OSRM uses them in a fare. */
export function spineRoadSequence(route: OsrmRoute, records: LearningRecord[]) {
  const identities = new Map<string, string>();
  for (const record of records.filter((item) => item.type === "middle_road")) {
    const spine = record.features.find((feature) => feature.role === "middle_road");
    if (!spine) continue;
    const canonical = spine.exam_name || record.exam_name;
    for (const name of [record.exam_name, spine.exam_name, spine.map_name]) {
      const identity = normaliseRoadName(name);
      if (identity) identities.set(identity, canonical);
    }
  }
  const output: string[] = [];
  for (const stepName of routeNames(route)) {
    const identity = normaliseRoadName(stepName);
    const exact = identities.get(identity);
    const fuzzy = exact ?? [...identities].find(([candidate]) =>
      candidate.length >= 5 && identity.length >= 5 &&
      (candidate.includes(identity) || identity.includes(candidate)),
    )?.[1];
    if (fuzzy && output.at(-1) !== fuzzy && !output.includes(fuzzy)) output.push(fuzzy);
  }
  return output;
}

export function connectorRoadSequence(
  route: OsrmRoute,
  curriculumRoadNames: string[],
) {
  const learned = new Set(curriculumRoadNames.map(normaliseRoadName));
  return distinct(
    route.steps
      .filter((step) => !learned.has(normaliseRoadName(step.displayName)))
      .map((step) => step.displayName),
  );
}

function orderedCoverage(selected: string[], required: string[]) {
  const selectedNormalised = selected.map(normaliseRoadName);
  let cursor = -1;
  let ordered = 0;
  for (const road of required.map(normaliseRoadName)) {
    const index = selectedNormalised.indexOf(road, cursor + 1);
    if (index < 0) continue;
    cursor = index;
    ordered += 1;
  }
  return required.length ? ordered / required.length : 1;
}

export function scoreRouteAttempt(input: {
  challenge: RouteChallenge;
  selectedRoadNames: string[];
  requiredRoadNames: string[];
  connectorRoadNames: string[];
  suggested: OsrmRoute;
  learner: OsrmRoute;
  comparison: RouteComparison;
  now?: string;
}): RouteAttempt {
  const traceLimit = 120;
  const trace = input.learner.coordinates.length <= traceLimit
    ? input.learner.coordinates
    : Array.from({ length: traceLimit }, (_, index) =>
        input.learner.coordinates[
          Math.round((index / (traceLimit - 1)) * (input.learner.coordinates.length - 1))
        ],
      );
  const selected = new Set(input.selectedRoadNames.map(normaliseRoadName));
  const covered = input.requiredRoadNames.filter((name) =>
    selected.has(normaliseRoadName(name)),
  );
  const missing = input.requiredRoadNames.filter(
    (name) => !selected.has(normaliseRoadName(name)),
  );
  const coverage = input.requiredRoadNames.length
    ? covered.length / input.requiredRoadNames.length
    : 1;
  const order = orderedCoverage(input.selectedRoadNames, input.requiredRoadNames);
  const efficiency = input.learner.distanceMetres
    ? Math.min(1, input.suggested.distanceMetres / input.learner.distanceMetres)
    : 0;
  const score = Math.round(
    coverage * 60 +
      order * 20 +
      Math.min(1, input.comparison.overlapPercentage / 100) * 15 +
      efficiency * 5,
  );
  const passMark = input.challenge.mode === "checkpoint" ? 80 : 70;
  return {
    id: `${input.challenge.id}:${input.now ?? new Date().toISOString()}`,
    challenge_id: input.challenge.id,
    territory_id: input.challenge.territory_id,
    mode: input.challenge.mode,
    selected_road_names: [...input.selectedRoadNames],
    required_road_names: [...input.requiredRoadNames],
    covered_road_names: covered,
    missing_road_names: missing,
    connector_road_names: [...input.connectorRoadNames],
    overlap_percentage: input.comparison.overlapPercentage,
    distance_efficiency_percentage: Math.round(efficiency * 100),
    score_percentage: score,
    passed: score >= passMark && missing.length === 0,
    created_at: input.now ?? new Date().toISOString(),
    routing_version: input.challenge.routing_version,
    start_coordinate: input.challenge.start.coordinate,
    end_coordinate: input.challenge.end.coordinate,
    trace_coordinates: trace,
  };
}

export function updateTerritoryProgress(input: {
  territory: TerritoryDefinition;
  attempts: RouteAttempt[];
  routingVersion: string;
  now?: string;
}): TerritoryProgress {
  const currentAttempts = input.attempts.filter(
    (attempt) =>
      attempt.territory_id === input.territory.id &&
      attempt.routing_version === input.routingVersion,
  );
  const covered = new Set(
    currentAttempts.filter((attempt) => attempt.passed).flatMap(
      (attempt) => attempt.covered_road_names,
    ).map(normaliseRoadName),
  );
  const targetNames = distinct(input.territory.target_road_names);
  const coverage = targetNames.length
    ? Math.round(
        (targetNames.filter((name) => covered.has(normaliseRoadName(name))).length /
          targetNames.length) *
          100,
      )
    : 0;
  const passedCheckpointCount = distinct(
    currentAttempts
      .filter((attempt) => attempt.mode === "checkpoint" && attempt.passed)
      .map((attempt) => attempt.challenge_id),
  ).length;
  return {
    territory_id: input.territory.id,
    covered_road_names: targetNames.filter((name) =>
      covered.has(normaliseRoadName(name)),
    ),
    successful_challenge_ids: distinct(
      currentAttempts.filter((attempt) => attempt.passed).map(
        (attempt) => attempt.challenge_id,
      ),
    ),
    route_coverage_percentage: coverage,
    checkpoint_passed:
      passedCheckpointCount >= TERRITORY_CHECKPOINT_RUNS_REQUIRED &&
      coverage >= input.territory.checkpoint_target_percentage,
    updated_at: input.now ?? new Date().toISOString(),
    routing_version: input.routingVersion,
  };
}
