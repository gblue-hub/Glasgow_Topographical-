import { describe, expect, it } from "vitest";
import { buildGeographicCurriculum } from "./geographic-curriculum";
import type { LearningRecord } from "./types";

const record = (
  id: string,
  sectionCode: string,
  sectionName: string,
  type: LearningRecord["type"],
  longitude: number,
  latitude: number,
  roadName: string,
  roadLinkId: string | null = null,
): LearningRecord => ({
  id,
  type,
  section: { code: sectionCode, name: sectionName },
  exam_name: type === "middle_road" ? roadName : id,
  review_state: "canonical",
  features: [
    {
      index: 0,
      role:
        type === "place"
          ? "place"
          : type === "district"
            ? "district_associated_road"
            : "terminal_road",
      exam_name: roadName,
      map_name: roadName,
      postcode: "",
      effective_coordinates: [longitude, latitude],
      road_link_id: roadLinkId,
      spatial_status: "mapped",
    },
  ],
});

describe("area-first geographic curriculum", () => {
  it("places connected records directly after their geographic anchor", () => {
    const eastDistrict = record(
      "east-district",
      "A",
      "DISTRICTS (EAST)",
      "district",
      -4.2,
      55.86,
      "East Road",
      "east-link",
    );
    const westDistrict = record(
      "west-district",
      "D",
      "DISTRICTS (WEST)",
      "district",
      -4.35,
      55.87,
      "West Road",
      "west-link",
    );
    const eastRestaurant = record(
      "east-restaurant",
      "R",
      "RESTAURANTS",
      "place",
      -4.201,
      55.86,
      "East Road",
      "east-link",
    );
    const eastHotel = record(
      "east-hotel",
      "H",
      "Hotels",
      "place",
      -4.202,
      55.86,
      "East Road",
    );
    const curriculum = buildGeographicCurriculum([
      eastDistrict,
      westDistrict,
      eastRestaurant,
      eastHotel,
    ]);
    const east = curriculum.find((item) => item.area === "east")!;

    expect(east.orderedRecordIds[0]).toBe("east-district");
    expect(east.orderedRecordIds).toEqual(
      expect.arrayContaining(["east-restaurant", "east-hotel"]),
    );
    expect(
      east.orderedRecordIds.indexOf("east-restaurant"),
    ).toBeGreaterThan(east.orderedRecordIds.indexOf("east-district"));
  });

  it("interlaces place categories instead of exhausting one category", () => {
    const district = record(
      "west-district",
      "D",
      "DISTRICTS (WEST)",
      "district",
      -4.31,
      55.87,
      "Dumbarton Road",
    );
    const anchor = record(
      "west-road",
      "H",
      "MAIN ROADS (WEST)",
      "middle_road",
      -4.3,
      55.87,
      "Byres Road",
      "byres",
    );
    const places = [
      record("restaurant-1", "R", "RESTAURANTS", "place", -4.3, 55.87, "Byres Road", "byres"),
      record("restaurant-2", "R", "RESTAURANTS", "place", -4.3, 55.87, "Byres Road", "byres"),
      record("hotel-1", "T", "Hotels", "place", -4.3, 55.87, "Byres Road", "byres"),
      record("pub-1", "P", "PUBLIC_HOUSES", "place", -4.3, 55.87, "Byres Road", "byres"),
    ];
    const west = buildGeographicCurriculum([district, anchor, ...places]).find(
      (item) => item.area === "west",
    )!;

    expect(west.orderedRecordIds).toEqual([
      "west-district",
      "west-road",
      "pub-1",
      "restaurant-1",
      "hotel-1",
      "restaurant-2",
    ]);
  });

  it("assigns every supplied record exactly once", () => {
    const records = [
      record("east", "A", "DISTRICTS (EAST)", "district", -4.15, 55.86, "East Road"),
      record("north", "B", "DISTRICTS (NORTH)", "district", -4.25, 55.9, "North Road"),
      record("south", "C", "DISTRICTS (SOUTH)", "district", -4.25, 55.82, "South Road"),
      record("west", "D", "DISTRICTS (WEST)", "district", -4.35, 55.87, "West Road"),
      record("centre", "I", "CITY CENTRE STREETS", "middle_road", -4.25, 55.86, "Central Road"),
    ];
    const ordered = buildGeographicCurriculum(records).flatMap(
      (area) => area.orderedRecordIds,
    );
    expect(new Set(ordered)).toEqual(new Set(records.map((item) => item.id)));
    expect(ordered).toHaveLength(records.length);
  });
});
