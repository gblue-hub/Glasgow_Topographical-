export type AppView =
  | "overview"
  | "practice"
  | "history"
  | "territories"
  | "mock"
  | "final"
  | "explore"
  | "explore-record"
  | "lesson"
  | "results"
  | "roads"
  | "journeys"
  | "areas"
  | "trouble"
  | "feedback"
  | "mastery"
  | "settings";

export type PrimaryArea = "learn" | "route_lab" | "atlas" | "checkpoints" | "progress" | "settings";

export const PRIMARY_NAVIGATION: ReadonlyArray<{
  id: PrimaryArea;
  label: string;
  view: AppView;
}> = [
  { id: "learn", label: "Learn", view: "overview" },
  { id: "route_lab", label: "Route Lab", view: "journeys" },
  { id: "atlas", label: "Knowledge Atlas", view: "explore" },
  { id: "checkpoints", label: "Checkpoints", view: "mock" },
  { id: "progress", label: "Progress", view: "mastery" },
  { id: "settings", label: "Settings", view: "settings" },
];

export function primaryAreaForView(view: AppView): PrimaryArea {
  if (view === "settings") return "settings";
  if (["explore", "explore-record", "roads", "journeys"].includes(view))
    return view === "journeys" ? "route_lab" : "atlas";
  if (["mock", "final"].includes(view)) return "checkpoints";
  if (["areas", "trouble", "feedback", "mastery"].includes(view))
    return "progress";
  return "learn";
}
