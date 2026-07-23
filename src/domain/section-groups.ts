import { compareSectionCodes } from "./sections";
import type { Association, Section } from "./types";

export const SECTION_GROUP_PRESET_VERSION = "section-groups.v1.0.0";

export type SectionGroupPreset = {
  id: "districts" | "main_roads" | "east" | "north" | "south" | "west" | "news";
  label: string;
  sectionCodes: string[];
  available: boolean;
  missingSectionNames: string[];
};

const names = {
  districtEast: "DISTRICTS (EAST)",
  districtNorth: "DISTRICTS (NORTH)",
  districtSouth: "DISTRICTS (SOUTH)",
  districtWest: "DISTRICTS (WEST)",
  roadEast: "MAIN ROADS (EAST)",
  roadNorth: "MAIN ROADS (NORTH)",
  roadSouth: "MAIN ROADS (SOUTH)",
  roadWest: "MAIN ROADS (WEST)",
} as const;

const definitions: Array<{ id: SectionGroupPreset["id"]; label: string; names: string[] }> = [
  { id: "districts", label: "All districts", names: [names.districtEast, names.districtNorth, names.districtSouth, names.districtWest] },
  { id: "main_roads", label: "All main roads", names: [names.roadEast, names.roadNorth, names.roadSouth, names.roadWest] },
  { id: "east", label: "East: district + main roads", names: [names.districtEast, names.roadEast] },
  { id: "north", label: "North: district + main roads", names: [names.districtNorth, names.roadNorth] },
  { id: "south", label: "South: district + main roads", names: [names.districtSouth, names.roadSouth] },
  { id: "west", label: "West: district + main roads", names: [names.districtWest, names.roadWest] },
  { id: "news", label: "All NEWS districts + main roads", names: Object.values(names) },
];

const normaliseName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleUpperCase("en-GB");

export function normaliseSectionCodes(sectionCodes: Iterable<string>) {
  return [...new Set([...sectionCodes].map((code) => code.trim().toUpperCase()).filter(Boolean))]
    .map((code) => ({ code }))
    .sort(compareSectionCodes)
    .map((item) => item.code);
}

export function buildSectionGroupPresets(sections: Section[]): SectionGroupPreset[] {
  const byName = new Map(sections.map((section) => [normaliseName(section.name), section]));
  return definitions.map((definition) => {
    const missingSectionNames = definition.names.filter((name) => !byName.has(normaliseName(name)));
    const sectionCodes = missingSectionNames.length
      ? []
      : normaliseSectionCodes(definition.names.map((name) => byName.get(normaliseName(name))!.code));
    return {
      id: definition.id,
      label: definition.label,
      sectionCodes,
      available: missingSectionNames.length === 0,
      missingSectionNames,
    };
  });
}

export function requiredAssociationsForSections(
  associations: Association[],
  sectionCodes: Iterable<string>,
  direction?: Association["direction"],
) {
  const selected = new Set(normaliseSectionCodes(sectionCodes));
  return associations.filter(
    (association) =>
      selected.has(association.section_code) &&
      association.required &&
      association.scope === "record_set" &&
      (!direction || association.direction === direction),
  );
}
