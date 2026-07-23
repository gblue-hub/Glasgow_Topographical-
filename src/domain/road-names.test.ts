import { describe, expect, it } from "vitest";
import { normaliseRoadName } from "./road-names";

describe("taxi road shorthand normalisation", () => {
  it.each([
    ["Mosspark CR", "mosspark crescent"],
    ["PRT", "paisley road toll"],
    ["Dumbarton TERR", "dumbarton terrace"],
    ["Langside OV", "langside oval"],
    ["Paisley RD", "paisley road"],
    ["PRW", "paisley road west"],
    ["George PL", "george place"],
    ["Argyle ST", "argyle street"],
    ["Royal CT", "royal court"],
    ["Maxwell DR", "maxwell drive"],
    ["Pollokshaws AVE", "pollokshaws avenue"],
    ["Queens GDNS", "queens gardens"],
    ["George SQ", "george square"],
  ])("normalises %s", (input, expected) => {
    expect(normaliseRoadName(input)).toBe(expected);
  });

  it("distinguishes an initial Saint from terminal Street", () => {
    expect(normaliseRoadName("St Vincent St")).toBe("saint vincent street");
  });
});
