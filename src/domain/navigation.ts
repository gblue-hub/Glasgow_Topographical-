export type AppView =
  | "overview"
  | "practice"
  | "mock"
  | "final"
  | "explore"
  | "explore-record"
  | "lesson"
  | "results"
  | "roads"
  | "journeys"
  | "trouble"
  | "feedback"
  | "mastery";

export type PrimaryArea = "learn" | "explore" | "mock" | "progress";

export const PRIMARY_NAVIGATION: ReadonlyArray<{
  id: PrimaryArea;
  label: string;
  view: AppView;
}> = [
  { id: "learn", label: "Learn", view: "overview" },
  { id: "explore", label: "Explore", view: "explore" },
  { id: "mock", label: "Mock Exam", view: "mock" },
  { id: "progress", label: "Progress", view: "mastery" },
];

export function primaryAreaForView(view: AppView): PrimaryArea {
  if (["explore", "explore-record", "roads", "journeys"].includes(view))
    return "explore";
  if (["mock", "final"].includes(view)) return "mock";
  if (["trouble", "feedback", "mastery"].includes(view)) return "progress";
  return "learn";
}
