import { describe, expect, it } from "vitest";
import { buildTerritoryQuestions } from "./territory-questions";
import type { LearningRecord, TerritoryDefinition, TerritoryStitch } from "./types";

const road = (id: string, name: string, ends: string[]): LearningRecord => ({
  id,
  type: "middle_road",
  section: { code: "E", name: "MAIN ROADS (EAST)" },
  exam_name: name,
  review_state: "canonical",
  features: ends.map((end, index) => ({ index, role: "terminal_road", exam_name: end, map_name: end, postcode: "", effective_coordinates: [-4.2 + index * .01, 55.86], road_link_id: `${id}:${index}`, spatial_status: "mapped" })),
});

describe("territory dispatch questions", () => {
  it("derives a corridor-end question with plausible road distractors", () => {
    const records = [
      road("main", "Great Route", ["First Street", "Last Street"]),
      road("peer", "Other Route", ["Nearby Road", "Another Road"]),
      road("extra", "Extra Route", ["Third Road", "Fourth Road"]),
    ];
    const territory = {
      id: "territory:a",
      name: "District A",
      approach_record_ids: ["main", "peer", "extra"],
      nearby_record_ids: [],
      neighbouring_territory_ids: [],
      associated_road_names: ["District Road"],
    } as TerritoryDefinition;
    const questions = buildTerritoryQuestions({ territory, territories: [territory], records, seed: "fixed" });
    const corridor = questions.find((question) => question.id.includes("corridor:main"));
    expect(corridor?.prompt).toContain("Which street marks the far end");
    expect(corridor?.options).toHaveLength(4);
    expect(corridor?.options.find((option) => option.id === corridor.answerId)?.label).toBe("Last Street");
  });

  it("tests the learned exit road on a district stitch", () => {
    const territory = {
      id: "territory:a", name: "District A", stitch_ids: ["stitch:a:b"],
      stitch_road_names: ["Alpha Road", "Beta Road", "Gamma Road", "Delta Road"],
      approach_record_ids: [], nearby_record_ids: [], neighbouring_territory_ids: ["territory:b"], associated_road_names: [],
    } as TerritoryDefinition;
    const neighbour = {
      id: "territory:b", name: "District B", stitch_ids: ["stitch:a:b"],
      stitch_road_names: ["Beta Road", "Fifth Road", "Sixth Road"],
      approach_record_ids: [], nearby_record_ids: [], neighbouring_territory_ids: ["territory:a"], associated_road_names: [],
    } as TerritoryDefinition;
    const stitch = {
      id: "stitch:a:b", territory_ids: ["territory:a", "territory:b"],
      connection_kind: "road_junction", road_name: "Alpha Road → Beta Road",
      road_names: ["Alpha Road", "Beta Road"],
      entry_road_names: { "territory:a": "Alpha Road", "territory:b": "Beta Road" },
      road_link_ids: ["a", "b"], crossing_coordinate: [-4.2, 55.86], shared_boundary: [[-4.2, 55.85], [-4.2, 55.87]],
    } as TerritoryStitch;
    const questions = buildTerritoryQuestions({ territory, territories: [territory, neighbour], records: [], stitches: [stitch], seed: "fixed" });
    const question = questions.find((item) => item.family === "stitch_entry");
    expect(question?.prompt).toContain("District A");
    expect(question?.answerId).toBe("alpha road");
    expect(question?.explanation).toContain("hands over to Beta Road");
  });
});
