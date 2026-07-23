import { describe, expect, it } from "vitest";
import { generateSectionQuestion, getAnswerFeatures } from "./questions";
import { normaliseRoadName } from "./road-names";
import type { Association, LearningRecord } from "./types";
const record = (
  id: string,
  name: string,
  roads: string[],
  x: number,
  type: "place" | "district" = "place",
): LearningRecord => ({
  id,
  type,
  exam_name: name,
  section: { code: "S", name: "SECTION" },
  review_state: "ok",
  features: [
    ...(type === "place"
      ? [
          {
            index: 0,
            role: "place",
            exam_name: name,
            map_name: name.toLowerCase(),
            postcode: "",
            effective_coordinates: [x, 55] as [number, number],
            road_link_id: null,
            spatial_status: "ok",
          },
        ]
      : []),
    ...roads.map((road, index) => ({
      index: index + (type === "place" ? 1 : 0),
      role: type === "place" ? "associated_road" : "district_associated_road",
      exam_name: road,
      map_name: road.toLowerCase(),
      postcode: "",
      effective_coordinates: [x, 55] as [number, number],
      road_link_id: `r:${road}`,
      spatial_status: "ok",
    })),
  ],
});
const association: Association = {
  id: "a",
  record_id: "1",
  section_code: "S",
  kind: "category_to_streets",
  direction: "forward",
  prompt: "Place",
  answer: "Alpha Road | Beta Street",
  required: true,
  scope: "record_set",
  parent_association_id: null,
  feature_index: null,
};
describe("section questions", () => {
  it("never includes a place primary feature as a street", () =>
    expect(
      getAnswerFeatures(
        record("1", "Place", ["Alpha Road", "Beta Street"], 0),
      ).map((f) => f.exam_name),
    ).toEqual(["Alpha Road", "Beta Street"]));
  it("includes district feature zero", () =>
    expect(
      getAnswerFeatures(
        record("d", "District", ["First Road", "Second Road"], 0, "district"),
      ).map((f) => f.exam_name),
    ).toEqual(["First Road", "Second Road"]));
  it("rejects distractors sharing an OS name_1/name_2 alias", () => {
    const records = [
      record("1", "Place", ["Alpha Road", "Beta Street"], 0),
      record("2", "Near", ["Alpha Rd", "Other"], 0.001),
      record("3", "Third", ["Gamma", "Delta"], 0.002),
      record("4", "Fourth", ["Echo", "Foxtrot"], 0.003),
      record("5", "Fifth", ["Golf", "Hotel"], 0.004),
    ];
    const geo = {
      features: [
        { properties: { road_link_id: "r:Alpha Road", names: ["Alpha Road"] } },
        { properties: { road_link_id: "r:Alpha Rd", names: ["Alpha Road"] } },
      ],
    };
    const q = generateSectionQuestion(records[0], association, records, geo);
    expect(q.options.some((o) => o.id.startsWith("2:"))).toBe(false);
    expect(q.options).toHaveLength(8);
    expect(q.answer_option_ids).toHaveLength(2);
    expect(new Set(q.options.map((o) => o.label)).size).toBe(8);
    const distractorOwners = new Set(
      q.options
        .filter((option) => !q.answer_option_ids.includes(option.id))
        .map((option) => option.id.split(":feature:")[0]),
    );
    expect(distractorOwners).toEqual(new Set(["3", "4", "5"]));
  });
  it("builds a single-choice question for one atomic street without changing its exam text", () => {
    const records = [
      record("1", "Place", ["Alpha Road", "Beta Street"], 0),
      record("2", "Second", ["Gamma", "Delta"], 0.001),
      record("3", "Third", ["Echo", "Foxtrot"], 0.002),
      record("4", "Fourth", ["Golf", "Hotel"], 0.003),
      record("5", "Fifth", ["India", "Juliett"], 0.004),
    ];
    const q = generateSectionQuestion(
      records[0],
      {
        ...association,
        id: "a:feature:1",
        answer: "Alpha Road",
        required: false,
        scope: "street",
        parent_association_id: "a",
        feature_index: 1,
      },
      records,
      { features: [] },
    );
    expect(q.selection_mode).toBe("single");
    expect(q.answer_option_ids).toEqual(["1:feature:1"]);
    expect(q.options.find((option) => option.id === "1:feature:1")?.label).toBe("Alpha Road");
  });
  it("never offers the abbreviated middle-road prompt as its own distractor", () => {
    const target = record("1", "PRW", ["First End Road", "Second End Street"], 0);
    target.type = "middle_road";
    target.features = [
      { ...target.features[0], role: "middle_road", exam_name: "Paisley Rd West", map_name: "paisley road west" },
      { ...target.features[1], role: "terminal_road" },
      { ...target.features[2], role: "terminal_road" },
    ];
    const candidates = [
      record("2", "Two", ["PRW"], .001),
      record("3", "Three", ["Third Road"], .002),
      record("4", "Four", ["Fourth Road"], .003),
      record("5", "Five", ["Fifth Road"], .004),
      record("6", "Six", ["Sixth Road"], .005),
      record("7", "Seven", ["Seventh Road"], .006),
      record("8", "Eight", ["Eighth Road"], .007),
    ];
    const q = generateSectionQuestion(target, { ...association, record_id: "1" }, [target, ...candidates], { features: [] });
    expect(q.options.filter((option) => !q.answer_option_ids.includes(option.id)).some(
      (option) => normaliseRoadName(option.label) === normaliseRoadName(target.exam_name),
    )).toBe(false);
  });
});
