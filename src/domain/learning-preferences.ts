import type { LearningPreferences } from "./types";

export const learningTargetDate = (
  weeks: LearningPreferences["target_weeks"],
) => {
  const target = new Date();
  target.setHours(23, 59, 59, 999);
  target.setDate(target.getDate() + weeks * 7);
  return target.toISOString();
};

export function defaultLearningPreferences(): LearningPreferences {
  return {
    id: "learning-plan",
    target_weeks: 4,
    study_days_per_week: 6,
    target_date: learningTargetDate(4),
    updated_at: new Date().toISOString(),
  };
}
