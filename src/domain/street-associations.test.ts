import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildStreetAssociationIndex } from "./street-associations";
import type { LearningRecord } from "./types";

const feature = (index: number, role: string, exam_name: string) => ({
  index,
  role,
  exam_name,
  map_name: exam_name.toLocaleLowerCase("en-GB"),
  postcode: "",
  effective_coordinates: [-4.2, 55.86] as [number, number],
  road_link_id: role === "place" ? null : `${index}:${exam_name}`,
  spatial_status: role === "place" ? "not_a_road" : "aligned",
});

const place = (
  id: string,
  name: string,
  roads: string[],
  overrides?: LearningRecord["features"],
): LearningRecord => ({
  id,
  type: "place",
  exam_name: name,
  section: { code: "J", name: "PLACES" },
  review_state: "canonical",
  features: overrides ?? [
    feature(0, "place", name),
    ...roads.map((road, index) => feature(index + 1, "associated_road", road)),
  ],
});

describe("what else is on these streets", () => {
  it("matches abbreviations and the same corner in reverse feature order", () => {
    const records = [
      place("target", "Target", ["King St", "Queen Rd"]),
      place("reverse", "Reverse corner", ["Queen Road", "King Street"]),
      place("shared", "Shared street", ["King Street", "Other Avenue"]),
    ];
    const context = buildStreetAssociationIndex(records).connectionsFor("target");

    expect(context.related.map((item) => item.record.id)).toEqual(["reverse", "shared"]);
    expect(context.related[0]).toMatchObject({
      sameStreetSet: true,
      sharedStreetNames: ["King St", "Queen Rd"],
    });
    expect(context.related[1]).toMatchObject({
      sameStreetSet: false,
      sharedStreetNames: ["King St"],
    });
  });

  it("recovers a road saved in the nominal place/Street 1 slot", () => {
    const records = [
      place("target", "Target", ["Saltmarket", "High Street"]),
      place("misconfigured", "Saltmarket", [], [
        feature(0, "place", "Saltmarket"),
        feature(1, "associated_road", "Trongate"),
      ]),
    ];
    const context = buildStreetAssociationIndex(
      records,
      ["Saltmarket", "High Street", "Trongate"],
    ).connectionsFor("target");

    expect(context.related).toHaveLength(1);
    expect(context.related[0]).toMatchObject({
      record: { id: "misconfigured" },
      sharedStreetNames: ["Saltmarket"],
    });
  });

  it("does not treat ordinary place names as roads", () => {
    const records = [
      place("target", "Springburn Park", ["Broomfield Road"]),
      place("other", "Springburn Park", ["Balornock Road"]),
    ];
    expect(buildStreetAssociationIndex(records).connectionsFor("target").related).toEqual([]);
  });

  it("finds every published association on the Albion Street / Blackfriars Street corner", () => {
    const content = JSON.parse(
      readFileSync(
        new URL("../../.content-build/course-content/learning-content.json", import.meta.url),
        "utf8",
      ),
    ) as { records: LearningRecord[] };
    const roads = JSON.parse(
      readFileSync(
        new URL("../../.content-build/course-content/referenced-roads.geojson", import.meta.url),
        "utf8",
      ),
    ) as { features: Array<{ properties: { names: string[] } }> };
    const target = content.records.find(
      (record) => record.exam_name === "Italian Caffe Enoteca",
    )!;
    const context = buildStreetAssociationIndex(
      content.records,
      roads.features.flatMap((road) => road.properties.names),
    ).connectionsFor(target.id);
    const sameCorner = context.related
      .filter((item) => item.sameStreetSet)
      .map((item) => item.record.exam_name)
      .sort((left, right) => left.localeCompare(right, "en-GB"));

    expect(sameCorner).toEqual([
      "City Halls",
      "City Halls (Old Fruit Market)",
      "Old Fruit Market",
      "Six By Nico [Merchant City]",
    ]);
  });
});
