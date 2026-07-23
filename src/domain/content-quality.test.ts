import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSectionQuestion, getAnswerFeatures } from "./questions";
import { normaliseRoadName } from "./road-names";
import type { CoverageLedger, LearningContent } from "./types";
const data = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../public/data/${name}`, import.meta.url), "utf8"),
  );
const content = data("learning-content.v1.json") as LearningContent;
const ledger = data("coverage-ledger.v1.json") as CoverageLedger;
const roads = data("referenced-roads.v1.geojson");
const recordsById = new Map(content.records.map((record) => [record.id, record]));
const recordsBySection = new Map<string, LearningContent["records"]>();
for (const record of content.records) {
  const records = recordsBySection.get(record.section.code) ?? [];
  records.push(record);
  recordsBySection.set(record.section.code, records);
}
describe("full section question bank", () => {
  it("generates unique, defensible options for every required question", () => {
    for (const association of ledger.associations.filter((item) => item.required)) {
      const record = recordsById.get(association.record_id)!;
      const section = recordsBySection.get(record.section.code)!;
      const question = generateSectionQuestion(
        record,
        association,
        section,
        roads,
        "validation",
      );
      const expectedOptionCount =
        question.direction === "category_to_streets" ? 8 : 4;
      if (
        question.options.length !== expectedOptionCount ||
        new Set(question.options.map((option) => option.id)).size !==
          expectedOptionCount ||
        new Set(question.options.map((option) => option.label)).size !==
          expectedOptionCount
      )
        throw new Error(
          `${association.id}: ${JSON.stringify(question.options)}`,
        );
      expect(question.answer_option_ids.length).toBeGreaterThan(0);
      if (question.direction === "streets_to_category")
        expect(question.answer_option_ids).toHaveLength(1);
      expect(
        question.answer_option_ids.every((id) =>
          question.options.some((option) => option.id === id),
        ),
      ).toBe(true);
      if (question.direction === "category_to_streets") {
        const keyedNames = new Set(
          question.options
            .filter((option) => question.answer_option_ids.includes(option.id))
            .map((option) => normaliseRoadName(option.label)),
        );
        const distractors = question.options.filter(
          (option) => !question.answer_option_ids.includes(option.id),
        );
        expect(
          distractors.some((option) => keyedNames.has(normaliseRoadName(option.label))),
          `${association.id} contains a distractor equivalent to a keyed road`,
        ).toBe(false);
        if (record.type === "middle_road")
          expect(
            distractors.some((option) => normaliseRoadName(option.label) === normaliseRoadName(record.exam_name)),
            `${association.id} contains its own prompt road as a distractor`,
          ).toBe(false);
      }
      if (record.type !== "district")
        expect(
          getAnswerFeatures(record).some((feature) =>
            ["place", "middle_road"].includes(feature.role),
          ),
        ).toBe(false);
    }
  }, 120000);
  it("preserves every atomic street answer and parent reference", () => {
    const associationsById = new Map(
      ledger.associations.map((association) => [association.id, association]),
    );
    const atomic = ledger.associations.filter(
      (association) => association.scope === "street",
    );
    expect(atomic.length).toBeGreaterThan(0);
    for (const association of atomic) {
      const record = recordsById.get(association.record_id)!;
      const feature = getAnswerFeatures(record).find(
        (candidate) => candidate.index === association.feature_index,
      );
      expect(feature?.exam_name).toBe(association.answer);
      expect(associationsById.get(association.parent_association_id!)?.scope).toBe(
        "record_set",
      );
      expect(association.required).toBe(false);
    }
  });
});
