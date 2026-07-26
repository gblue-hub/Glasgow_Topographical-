import { describe, expect, it } from "vitest";
import {
  buildGeographicKnowledge,
  classifyRecordArea,
  isCityCentreRecord,
  primaryKnowledgeArea,
  recordCoordinate,
  recordTopic,
} from "./geographic-knowledge";
import type {
  Association,
  LearningRecord,
  Mastery,
} from "./types";

const feature = (longitude: number, latitude: number, role = "place") => ({
  index: 0,
  role,
  exam_name: "Feature",
  map_name: "feature",
  postcode: "",
  effective_coordinates: [longitude, latitude] as [number, number],
  road_link_id: null,
  spatial_status: "mapped",
});

const record = (
  id: string,
  sectionCode: string,
  sectionName: string,
  longitude: number,
  latitude: number,
  type: LearningRecord["type"] = "place",
): LearningRecord => ({
  id,
  type,
  section: { code: sectionCode, name: sectionName },
  exam_name: id,
  review_state: "canonical",
  features: [
    feature(
      longitude,
      latitude,
      type === "district" ? "district_associated_road" : type,
    ),
  ],
});

const association = (
  recordId: string,
  direction: Association["direction"],
): Association => ({
  id: `${recordId}:${direction}`,
  record_id: recordId,
  section_code: "AA",
  kind: direction,
  direction,
  prompt: recordId,
  answer: "answer",
  required: true,
  scope: "record_set",
  parent_association_id: null,
  feature_index: null,
});

const mastered = (id: string): Mastery => ({
  association_id: id,
  state: "mastered",
  correct_retrievals: 3,
  recall_successes: 3,
  consecutive_errors: 0,
  last_seen_at: "2026-07-20T12:00:00.000Z",
  next_due_at: "2026-08-03T12:00:00.000Z",
});

describe("geographic knowledge", () => {
  it("uses authored NEWS sections and data-derived district proximity", () => {
    const eastSeed = record(
      "district:east",
      "A",
      "DISTRICTS (EAST)",
      -4.1,
      55.86,
      "district",
    );
    const westSeed = record(
      "district:west",
      "D",
      "DISTRICTS (WEST)",
      -4.35,
      55.87,
      "district",
    );
    const pub = record("pub:west", "AA", "PUBLIC_HOUSES", -4.34, 55.87);

    expect(classifyRecordArea(eastSeed, [])).toBe("east");
    expect(classifyRecordArea(pub, [
      { area: "east", coordinate: recordCoordinate(eastSeed)! },
      { area: "west", coordinate: recordCoordinate(westSeed)! },
    ])).toBe("west");
  });

  it("combines NEWS variants into one learner-facing topic", () => {
    expect(
      recordTopic(
        record(
          "road",
          "E",
          "MAIN ROADS (EAST)",
          -4.2,
          55.86,
          "middle_road",
        ),
      ),
    ).toEqual({ key: "main-roads", label: "Main roads" });
    expect(recordTopic(record("pub", "AA", "PUBLIC_HOUSES", -4.2, 55.86)))
      .toEqual({ key: "section:aa", label: "Public Houses" });
  });

  it("assigns central records to a distinct City Centre area", () => {
    const northSeed = record(
      "district:north",
      "B",
      "DISTRICTS (NORTH)",
      -4.25,
      55.9,
      "district",
    );
    const southSeed = record(
      "district:south",
      "C",
      "DISTRICTS (SOUTH)",
      -4.25,
      55.81,
      "district",
    );
    const centralPub = record(
      "pub:centre",
      "AA",
      "PUBLIC_HOUSES",
      -4.25,
      55.86,
    );
    const records = [northSeed, southSeed, centralPub];
    const summary = buildGeographicKnowledge({
      records,
      associations: records.map((item) => association(item.id, "reverse")),
      mastery: new Map(),
      attempts: [],
      now: "2026-07-26T12:00:00.000Z",
    });
    const pubs = summary.topics.find((topic) => topic.key === "section:aa")!;

    expect(isCityCentreRecord(centralPub)).toBe(true);
    expect(
      isCityCentreRecord(
        record("south-of-clyde", "AA", "PUBLIC_HOUSES", -4.25, 55.851),
      ),
    ).toBe(false);
    expect(
      isCityCentreRecord(
        record("east-of-high-street", "AA", "PUBLIC_HOUSES", -4.23, 55.86),
      ),
    ).toBe(false);
    expect(
      isCityCentreRecord(
        record("west-of-north-street", "AA", "PUBLIC_HOUSES", -4.28, 55.86),
      ),
    ).toBe(false);
    expect(pubs.cells.centre.recordIds).toEqual(["pub:centre"]);
    expect(pubs.cells.north.recordIds).not.toContain("pub:centre");
    expect(pubs.cells.south.recordIds).not.toContain("pub:centre");
    expect(pubs.total).toBe(1);
  });

  it("keeps Cowcaddens, Garnethill and Townhead north of the revised centre boundary", () => {
    for (const [name, longitude, latitude] of [
      ["Cowcaddens", -4.2556416, 55.8679398],
      ["Garnethill", -4.2659099, 55.8673481],
      ["Townhead", -4.2440773, 55.8666569],
    ] as const)
      {
        const district = record(
          `district:${name}`,
          "B",
          "DISTRICTS (NORTH)",
          longitude,
          latitude,
          "district",
        );
        expect(isCityCentreRecord(district)).toBe(false);
        expect(
          primaryKnowledgeArea(
            district,
            new Map([[district.id, "north"]]),
          ),
        ).toBe("north");
      }
  });

  it("recommends a granular topic and area using record-level mastery", () => {
    const seeds = [
      record("district:north", "B", "DISTRICTS (NORTH)", -4.24, 55.91, "district"),
      record("district:south", "C", "DISTRICTS (SOUTH)", -4.24, 55.81, "district"),
    ];
    const northPubs = Array.from({ length: 6 }, (_, index) =>
      record(`north-pub:${index}`, "AA", "PUBLIC_HOUSES", -4.24, 55.9),
    );
    const southPubs = Array.from({ length: 9 }, (_, index) =>
      record(`south-pub:${index}`, "AA", "PUBLIC_HOUSES", -4.24, 55.82),
    );
    const records = [...seeds, ...northPubs, ...southPubs];
    const associations = records.flatMap((item) => [
      association(item.id, "reverse"),
      association(item.id, "forward"),
    ]);
    const mastery = new Map<string, Mastery>();
    for (const pub of northPubs)
      for (const direction of ["reverse", "forward"] as const)
        mastery.set(
          `${pub.id}:${direction}`,
          mastered(`${pub.id}:${direction}`),
        );

    const summary = buildGeographicKnowledge({
      records,
      associations,
      mastery,
      attempts: [],
      now: "2026-07-26T12:00:00.000Z",
    });

    expect(summary.recommendation).toMatchObject({
      topicLabel: "Public Houses",
      area: "south",
      total: 9,
      secure: 0,
      unseen: 9,
    });
    expect(
      summary.topics.find((topic) => topic.key === "section:aa")?.cells.north,
    ).toMatchObject({ total: 6, secure: 6, securePercentage: 100 });
  });
});
