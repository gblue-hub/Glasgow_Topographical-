import type { OsrmRoute } from "./journeys";
import type { PersonalPlace } from "./types";

export type PersonalRouteHint = {
  placeId: string;
  placeName: string;
  relationship: PersonalPlace["relationship"];
  distanceMetres: number;
  side: "left" | "right" | "nearby";
  heading: string;
  roadName: string;
  turns: string[];
};

const metresBetween = (left: [number, number], right: [number, number]) => {
  const latitude = ((left[1] + right[1]) / 2) * Math.PI / 180;
  return Math.hypot((left[0] - right[0]) * 111_320 * Math.cos(latitude), (left[1] - right[1]) * 110_540);
};

const heading = (from: [number, number], to: [number, number]) => {
  const angle = (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI + 360) % 360;
  return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(angle / 45) % 8];
};

const ordinal = (value: number) => value === 1 ? "first" : value === 2 ? "second" : value === 3 ? "third" : `${value}th`;

/** Derives optional human orientation cues; these never become exam answers. */
export function buildPersonalRouteHints(route: OsrmRoute, places: PersonalPlace[], maximumDistanceMetres = 1_200) {
  const positionedSteps = route.steps.flatMap((step, index) => step.coordinate ? [{ step, index, coordinate: step.coordinate }] : []);
  if (!positionedSteps.length) return [];
  return places.flatMap((place): PersonalRouteHint[] => {
    const closest = positionedSteps
      .map((candidate) => ({ ...candidate, distance: metresBetween(candidate.coordinate, place.coordinate) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!closest || closest.distance > maximumDistanceMetres) return [];
    const nextPosition = positionedSteps.find((candidate) => candidate.index > closest.index)?.coordinate ?? closest.coordinate;
    const routeVector = [nextPosition[0] - closest.coordinate[0], nextPosition[1] - closest.coordinate[1]];
    const placeVector = [place.coordinate[0] - closest.coordinate[0], place.coordinate[1] - closest.coordinate[1]];
    const cross = routeVector[0] * placeVector[1] - routeVector[1] * placeVector[0];
    const side = closest.distance < 60 ? "nearby" : cross >= 0 ? "left" : "right";
    const counts = { left: 0, right: 0 };
    const turns = route.steps.slice(closest.index + 1).flatMap((step) => {
      const side = step.modifier.includes("left") ? "left" : step.modifier.includes("right") ? "right" : null;
      if (!side || !step.displayName || step.displayName === "Unnamed connector") return [];
      counts[side] += 1;
      return [`Take the ${ordinal(counts[side])} ${step.modifier || side} onto ${step.displayName}.`];
    }).slice(0, 3);
    return [{
      placeId: place.id,
      placeName: place.name,
      relationship: place.relationship,
      distanceMetres: Math.round(closest.distance),
      side,
      heading: heading(closest.coordinate, nextPosition),
      roadName: closest.step.displayName,
      turns,
    }];
  }).sort((left, right) => left.distanceMetres - right.distanceMetres).slice(0, 2);
}
