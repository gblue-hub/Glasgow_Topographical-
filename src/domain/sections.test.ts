import { describe, expect, it } from "vitest";
import {
  compareSectionCodes,
  formatSectionName,
  sectionCodeValue,
} from "./sections";

describe("section ordering", () => {
  it("uses spreadsheet-style base-26 values", () => {
    expect(sectionCodeValue("A")).toBe(1);
    expect(sectionCodeValue("Z")).toBe(26);
    expect(sectionCodeValue("AA")).toBe(27);
  });

  it("orders A to Z before double-letter sections", () => {
    const values = ["CC", "Z", "B", "AA", "A", "DD", "BB"];
    expect(values.map((code) => ({ code })).sort(compareSectionCodes).map((item) => item.code)).toEqual(["A", "B", "Z", "AA", "BB", "CC", "DD"]);
  });
});

describe("section display names", () => {
  it("turns source separators into readable text", () => {
    expect(formatSectionName("SHOPS_AND_SUPERMARKETS")).toBe(
      "SHOPS AND SUPERMARKETS",
    );
  });
});
