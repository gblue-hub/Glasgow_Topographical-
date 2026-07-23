import { describe, expect, it } from "vitest";
import { buildSectionGroupPresets, normaliseSectionCodes, requiredAssociationsForSections } from "./section-groups";
import type { Association, Section } from "./types";

const sections: Section[] = [
  ["A", "DISTRICTS (EAST)"], ["B", "DISTRICTS (NORTH)"],
  ["C", "DISTRICTS (SOUTH)"], ["D", "DISTRICTS (WEST)"],
  ["E", "MAIN ROADS (EAST)"], ["F", "MAIN ROADS (NORTH)"],
  ["G", "MAIN ROADS (SOUTH)"], ["H", "MAIN ROADS (WEST)"],
].map(([code, name]) => ({ code, name, record_count: 1, association_count: 2 }));

describe("section group presets", () => {
  it("resolves districts, roads, regional pairs and all NEWS without partial groups", () => {
    const presets = Object.fromEntries(buildSectionGroupPresets(sections).map((preset) => [preset.id, preset]));
    expect(presets.districts.sectionCodes).toEqual(["A", "B", "C", "D"]);
    expect(presets.main_roads.sectionCodes).toEqual(["E", "F", "G", "H"]);
    expect(presets.east.sectionCodes).toEqual(["A", "E"]);
    expect(presets.north.sectionCodes).toEqual(["B", "F"]);
    expect(presets.south.sectionCodes).toEqual(["C", "G"]);
    expect(presets.west.sectionCodes).toEqual(["D", "H"]);
    expect(presets.news.sectionCodes).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
  });

  it("marks a preset unavailable instead of silently selecting a partial group", () => {
    const presets = buildSectionGroupPresets(sections.filter((section) => section.code !== "H"));
    expect(presets.find((preset) => preset.id === "main_roads")).toMatchObject({ available: false, sectionCodes: [] });
    expect(presets.find((preset) => preset.id === "news")).toMatchObject({ available: false, sectionCodes: [] });
  });

  it("resolves useful thematic groups from the published section taxonomy", () => {
    const thematicSections: Section[] = [
      ["J", "HOSPITALS"],
      ["K", "POLICE STATIONS"],
      ["M", "PUBLIC HALLS/COMMUNITY CENTRES"],
      ["N", "BINGO HALLS/CINEMAS/THEATRES"],
      ["O", "PLACES OF INTEREST"],
      ["Q", "NIGHT_CLUBS"],
      ["R", "Hotels"],
      ["S", "PARKS /GARDENS"],
      ["U", "SPORTS_AND_LEISURE"],
      ["V", "SPORTS_CLUBS"],
      ["W", "HEALTH_CENTRES"],
      ["X", "CARE_HOMES"],
      ["Z", "RESTAURANTS"],
      ["AA", "PUBLIC_HOUSES"],
      ["CC", "COLLEGES._HALLS._MEUSEUMS"],
    ].map(([code, name]) => ({
      code,
      name,
      record_count: 1,
      association_count: 2,
    }));
    const presets = Object.fromEntries(
      buildSectionGroupPresets(thematicSections).map((preset) => [
        preset.id,
        preset,
      ]),
    );

    expect(presets.emergency.sectionCodes).toEqual(["J", "K"]);
    expect(presets.healthcare.sectionCodes).toEqual(["J", "W", "X"]);
    expect(presets.food_stays_pubs.sectionCodes).toEqual(["R", "Z", "AA"]);
    expect(presets.night_out.sectionCodes).toEqual(["N", "Q", "Z", "AA"]);
    expect(presets.sport_leisure.sectionCodes).toEqual(["S", "U", "V"]);
    expect(presets.culture_community.sectionCodes).toEqual(["M", "N", "O", "CC"]);
  });
});

describe("arbitrary section selection", () => {
  it("deduplicates and orders selected codes", () => {
    expect(normaliseSectionCodes(["H", "A", "A", " f "])).toEqual(["A", "F", "H"]);
  });

  it("selects only required record-set associations from chosen sections", () => {
    const base: Association = { id: "a", record_id: "r", section_code: "A", kind: "category_to_streets", direction: "forward", prompt: "", answer: "", required: true, scope: "record_set", parent_association_id: null, feature_index: null };
    const associations: Association[] = [
      base,
      { ...base, id: "h", section_code: "H" },
      { ...base, id: "outside", section_code: "B" },
      { ...base, id: "atomic", required: false, scope: "street" },
      { ...base, id: "reverse", direction: "reverse" },
    ];
    expect(requiredAssociationsForSections(associations, ["H", "A"]).map((item) => item.id)).toEqual(["a", "h", "reverse"]);
    expect(requiredAssociationsForSections(associations, ["H", "A"], "forward").map((item) => item.id)).toEqual(["a", "h"]);
    expect(requiredAssociationsForSections(associations, ["H", "A"], "reverse").map((item) => item.id)).toEqual(["reverse"]);
  });
});
