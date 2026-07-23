import { getAnswerFeatures } from "./questions";
import type { LearningRecord } from "./types";

export type ExplorerType = "all" | LearningRecord["type"];

const searchable = (record: LearningRecord) =>
  [
    record.exam_name,
    record.section.name,
    record.type.replace("_", " "),
    ...record.features.flatMap((feature) => [
      feature.exam_name,
      feature.map_name,
      feature.postcode,
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase();

export function filterExplorerRecords(
  records: LearningRecord[],
  query: string,
  sectionCode: string,
  type: ExplorerType,
) {
  const normalisedQuery = query.toLocaleLowerCase();
  const terms = normalisedQuery
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const finalTermNeedsSpace = /\s$/.test(normalisedQuery) && terms.length > 0;

  return records
    .filter(
      (record) =>
        (!sectionCode || record.section.code === sectionCode) &&
        (type === "all" || record.type === type) &&
        terms.every((term, index) => {
          const text = searchable(record);
          return finalTermNeedsSpace && index === terms.length - 1
            ? text.includes(`${term} `)
            : text.includes(term);
        }),
    )
    .sort((a, b) =>
      a.exam_name.localeCompare(b.exam_name, "en-GB", {
        sensitivity: "base",
      }),
    );
}

export const answerSummary = (record: LearningRecord) =>
  getAnswerFeatures(record)
    .map((feature) => feature.exam_name)
    .join(" · ");

export const explorerTypeLabel = (type: LearningRecord["type"]) =>
  ({ place: "Place", middle_road: "Main road", district: "District" })[type];
