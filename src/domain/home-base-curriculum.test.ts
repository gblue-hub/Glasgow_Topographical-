import { describe, expect, it } from "vitest";
import { buildHomeBaseCurriculum } from "./home-base-curriculum";
import type { LearningRecord, PersonalPlace, TerritoryDefinition } from "./types";

const territory = (id: string, centre: [number, number], neighbours: string[], district: string): TerritoryDefinition => ({
  id, name: id, area: "west", district_record_id: district, centre,
  polygon: [[centre[0]-.01,centre[1]-.01],[centre[0]+.01,centre[1]-.01],[centre[0]+.01,centre[1]+.01],[centre[0]-.01,centre[1]+.01]],
  associated_road_names: [], associated_road_link_ids: [], nearby_record_ids: [`place:${id}`], approach_record_ids: [`spine:${id}`],
  neighbouring_territory_ids: neighbours, stitch_ids: [], stitch_road_names: [], stitch_road_link_ids: [], target_road_names: [], target_road_link_ids: [], checkpoint_target_percentage: 80,
});

describe("home-base curriculum", () => {
  it("bleeds through touching districts in the home NEWS region", () => {
    const territories = [territory("home", [-4.30,55.87], ["next"], "district:home"), territory("next", [-4.28,55.87], ["home","far"], "district:next"), territory("far", [-4.26,55.87], ["next"], "district:far")];
    const records = territories.flatMap((item) => [item.district_record_id, ...item.approach_record_ids, ...item.nearby_record_ids].map((id) => ({ id, type: id.startsWith("district") ? "district" : id.startsWith("spine") ? "middle_road" : "place", exam_name: id, section: { code: "A", name: "WEST" }, review_state: "canonical", features: [] } as LearningRecord)));
    const home = { id: "flat", name: "My flat", coordinate: [-4.30,55.87], area: "west", is_home_base: true } as PersonalPlace;
    const result = buildHomeBaseCurriculum(records, territories, [home])!;
    expect(result.frontierTerritoryIds).toEqual(["home", "next", "far"]);
    expect(result.orderedRecordIds.slice(0, 3)).toEqual(["district:home", "spine:home", "place:home"]);
  });

  it("does nothing until the learner deliberately chooses a home base", () => {
    expect(buildHomeBaseCurriculum([], [], [])).toBeNull();
  });
});
