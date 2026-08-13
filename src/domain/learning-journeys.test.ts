import { describe, expect, it } from "vitest";
import { buildLearningJourneys, journeyForRecord } from "./learning-journeys";
import type { LearningRecord, RoadGeometryCollection, TerritoryDefinition } from "./types";

const record = (
  id: string,
  type: LearningRecord["type"],
  name: string,
  section: string,
  road: string,
  roadLinkId: string,
  longitude: number,
): LearningRecord => ({
  id,
  type,
  section: { code: id, name: section },
  exam_name: name,
  review_state: "canonical",
  features: [{
    index: 0,
    role: type === "middle_road" ? "terminal_road" : "associated_road",
    exam_name: road,
    map_name: road,
    postcode: "",
    effective_coordinates: [longitude, 55.86],
    road_link_id: roadLinkId,
    spatial_status: "mapped",
  }],
});

const geometry: RoadGeometryCollection = {
  type: "FeatureCollection",
  schema_version: "1.0.0",
  features: [
    {
      type: "Feature",
      id: "link-a",
      properties: {
        road_link_id: "link-a",
        names: ["Argyle Street"],
        start_node: "one",
        end_node: "two",
      },
      geometry: { type: "LineString", coordinates: [[-4.26, 55.86], [-4.25, 55.86]] },
    },
    {
      type: "Feature",
      id: "link-b",
      properties: {
        road_link_id: "link-b",
        names: ["Trongate"],
        start_node: "two",
        end_node: "three",
      },
      geometry: { type: "LineString", coordinates: [[-4.25, 55.86], [-4.24, 55.86]] },
    },
  ],
};

describe("purposeful learning journeys", () => {
  it("groups a named road and shop as one mapped taxi run", () => {
    const anchor = record(
      "anchor",
      "middle_road",
      "Argyle Street",
      "CITY CENTRE STREETS",
      "Argyle Street",
      "link-a",
      -4.26,
    );
    const shop = record(
      "shop",
      "place",
      "St Enoch Centre",
      "SHOPS_AND_SUPERMARKETS",
      "Trongate",
      "link-b",
      -4.24,
    );
    const journeys = buildLearningJourneys(
      [anchor, shop],
      new Set([anchor.id, shop.id]),
      geometry,
    );

    expect(journeys).toHaveLength(1);
    expect(journeys[0]).toMatchObject({
      title: "Argyle Street → St Enoch Centre",
      anchorName: "Argyle Street",
      recordIds: ["anchor", "shop"],
      roadLinkIds: ["link-a", "link-b"],
    });
    expect(journeys[0].reason).toContain("one usable taxi run");
    expect(journeyForRecord(journeys, "shop")).toBe(journeys[0]);
  });

  it("frames an outer district as a city-centre fare via its derived main-road approach", () => {
    const district = record("district", "district", "Dennistoun", "DISTRICTS", "Duke Street", "link-b", -4.20);
    const spine = record("spine", "middle_road", "Duke St", "MAIN ROADS (EAST)", "High Street", "link-a", -4.23);
    spine.features.unshift({ ...spine.features[0], index: 0, role: "middle_road", exam_name: "Duke Street", map_name: "duke street", road_link_id: "link-b" });
    const territory = { district_record_id: district.id, approach_record_ids: [spine.id] } as TerritoryDefinition;
    const [journey] = buildLearningJourneys([district, spine], new Set([district.id]), geometry, [territory]);
    expect(journey.title).toBe("City centre → Dennistoun via Duke Street");
    expect(journey.spineRoadNames).toEqual(["Duke Street"]);
    expect(journey.reason).toContain("pathway through this area");
  });
});
