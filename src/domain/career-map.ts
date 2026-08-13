import { getAnswerFeatures } from "./questions";
import { normaliseRoadName } from "./road-names";
import type {
  Association,
  Attempt,
  LearningRecord,
  Mastery,
  RouteAttempt,
  TerritoryDefinition,
  TerritoryProgress,
  TerritoryStitch,
} from "./types";

export type KnowledgeEvidenceStatus =
  | "unseen"
  | "exploring"
  | "learning"
  | "overdue"
  | "operational"
  | "licensed";

export type CareerRank =
  | "Trainee"
  | "Local Driver"
  | "Area Driver"
  | "City Driver"
  | "Exam Ready";

export type CareerMapModel = {
  recordStatus: Map<string, KnowledgeEvidenceStatus>;
  roadStatus: Map<string, KnowledgeEvidenceStatus>;
  territoryStatus: Map<string, KnowledgeEvidenceStatus>;
  stitchStatus: Map<string, KnowledgeEvidenceStatus>;
  secureStitchIds: Set<string>;
  licensedTerritoryIds: Set<string>;
  competencePoints: number;
  rank: CareerRank;
  rankReason: string;
  totals: {
    operationalRecords: number;
    secureStitches: number;
    licensedTerritories: number;
    successfulFares: number;
    overdueRecords: number;
  };
};

const strongest = (
  left: KnowledgeEvidenceStatus | undefined,
  right: KnowledgeEvidenceStatus,
) => {
  const order: KnowledgeEvidenceStatus[] = [
    "unseen", "exploring", "learning", "overdue", "operational", "licensed",
  ];
  return !left || order.indexOf(right) > order.indexOf(left) ? right : left;
};

export function buildCareerMapModel(input: {
  records: LearningRecord[];
  associations: Association[];
  mastery: ReadonlyMap<string, Mastery>;
  attempts: Attempt[];
  territories: TerritoryDefinition[];
  stitches: TerritoryStitch[];
  territoryProgress: ReadonlyMap<string, TerritoryProgress>;
  routeAttempts: RouteAttempt[];
  readiness: number;
  now?: Date;
}): CareerMapModel {
  const now = input.now ?? new Date();
  const associationsByRecord = new Map<string, Association[]>();
  for (const association of input.associations) {
    if (!association.required || association.scope !== "record_set") continue;
    associationsByRecord.set(association.record_id, [
      ...(associationsByRecord.get(association.record_id) ?? []), association,
    ]);
  }
  const attemptedAssociationIds = new Set(input.attempts.map((attempt) => attempt.association_id));
  const recordStatus = new Map<string, KnowledgeEvidenceStatus>();
  let overdueRecords = 0;
  for (const record of input.records) {
    const associations = associationsByRecord.get(record.id) ?? [];
    const states = associations.map((association) => input.mastery.get(association.id));
    const mastered = associations.length > 0 && states.every((state) => state?.state === "mastered");
    const overdue = mastered && states.some((state) => Date.parse(state!.next_due_at) <= now.getTime());
    const hasEvidence = associations.some(
      (association) => input.mastery.has(association.id) || attemptedAssociationIds.has(association.id),
    );
    const status: KnowledgeEvidenceStatus = overdue
      ? "overdue"
      : mastered
        ? "operational"
        : hasEvidence
          ? "learning"
          : "unseen";
    if (overdue) overdueRecords += 1;
    recordStatus.set(record.id, status);
  }

  const passedRoutes = input.routeAttempts.filter((attempt) => attempt.passed);
  const coveredByTerritory = new Map<string, Set<string>>();
  for (const attempt of passedRoutes) {
    const covered = coveredByTerritory.get(attempt.territory_id) ?? new Set<string>();
    attempt.covered_road_names.forEach((name) => covered.add(normaliseRoadName(name)));
    coveredByTerritory.set(attempt.territory_id, covered);
  }
  const stitchStatus = new Map<string, KnowledgeEvidenceStatus>();
  const secureStitchIds = new Set<string>();
  for (const stitch of input.stitches) {
    const covered = new Set(
      stitch.territory_ids.flatMap((territoryId) => [
        ...(coveredByTerritory.get(territoryId) ?? []),
      ]),
    );
    const hitCount = stitch.road_names.filter((name) => covered.has(normaliseRoadName(name))).length;
    const status: KnowledgeEvidenceStatus = hitCount === stitch.road_names.length
      ? "operational"
      : hitCount
        ? "learning"
        : "unseen";
    if (status === "operational") secureStitchIds.add(stitch.id);
    stitchStatus.set(stitch.id, status);
  }

  const territoryStatus = new Map<string, KnowledgeEvidenceStatus>();
  const licensedTerritoryIds = new Set<string>();
  for (const territory of input.territories) {
    const progress = input.territoryProgress.get(territory.id);
    const districtStatus = recordStatus.get(territory.district_record_id) ?? "unseen";
    const securedStitches = territory.stitch_ids.filter((id) => secureStitchIds.has(id)).length;
    const hasRoutes = input.routeAttempts.some((attempt) => attempt.territory_id === territory.id);
    const status: KnowledgeEvidenceStatus = progress?.checkpoint_passed
      ? "licensed"
      : districtStatus === "operational"
        ? "operational"
        : hasRoutes || districtStatus !== "unseen" || securedStitches
          ? "learning"
          : "unseen";
    if (status === "licensed") licensedTerritoryIds.add(territory.id);
    territoryStatus.set(territory.id, status);
  }

  const roadStatus = new Map<string, KnowledgeEvidenceStatus>();
  for (const record of input.records) {
    const status = recordStatus.get(record.id) ?? "unseen";
    for (const feature of getAnswerFeatures(record)) {
      const identity = normaliseRoadName(feature.exam_name);
      roadStatus.set(identity, strongest(roadStatus.get(identity), status));
    }
  }
  for (const attempt of passedRoutes)
    for (const name of attempt.covered_road_names)
      roadStatus.set(normaliseRoadName(name), "operational");

  const independentAssociations = new Set(
    input.attempts
      .filter((attempt) => attempt.correct && !attempt.used_reveal && attempt.confidence > 1)
      .map((attempt) => attempt.association_id),
  );
  const masteredAssociations = new Set(
    [...input.mastery].filter(([, state]) => state.state === "mastered").map(([id]) => id),
  );
  const uniquePassedChallenges = new Set(passedRoutes.map((attempt) => attempt.challenge_id));
  const competencePoints =
    independentAssociations.size * 10 +
    masteredAssociations.size * 25 +
    secureStitchIds.size * 50 +
    uniquePassedChallenges.size * 40 +
    licensedTerritoryIds.size * 150;

  const licensedAreas = new Set(
    input.territories.filter((territory) => licensedTerritoryIds.has(territory.id)).map((territory) => territory.area),
  );
  const evidencedAreas = new Set(
    passedRoutes.flatMap((attempt) => {
      const territory = input.territories.find((item) => item.id === attempt.territory_id);
      return territory ? [territory.area] : [];
    }),
  );
  const lapsed = [...input.mastery.values()].some((state) => state.state === "lapsed");
  let rank: CareerRank = "Trainee";
  let rankReason = "License your first district to become a Local Driver.";
  if (licensedTerritoryIds.size >= 1) {
    rank = "Local Driver";
    rankReason = "License 10 districts across two city areas to become an Area Driver.";
  }
  if (licensedTerritoryIds.size >= 10 && licensedAreas.size >= 2) {
    rank = "Area Driver";
    rankReason = "License 40 districts and work fares in every city area to become a City Driver.";
  }
  if (licensedTerritoryIds.size >= 40 && evidencedAreas.size === 4) {
    rank = "City Driver";
    rankReason = "Reach 85% readiness with licensed knowledge in every city area and no lapsed block.";
  }
  if (input.readiness >= 85 && licensedAreas.size === 4 && !lapsed) {
    rank = "Exam Ready";
    rankReason = "Your current evidence meets the career-map readiness standard.";
  }

  return {
    recordStatus,
    roadStatus,
    territoryStatus,
    stitchStatus,
    secureStitchIds,
    licensedTerritoryIds,
    competencePoints,
    rank,
    rankReason,
    totals: {
      operationalRecords: [...recordStatus.values()].filter((status) => status === "operational").length,
      secureStitches: secureStitchIds.size,
      licensedTerritories: licensedTerritoryIds.size,
      successfulFares: uniquePassedChallenges.size,
      overdueRecords,
    },
  };
}
