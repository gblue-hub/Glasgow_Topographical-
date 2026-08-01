import type { PersonalRouteHint as Hint } from "../domain/personal-route-hints";
import "./personal-route-hint.css";

const relationship = { lived: "a place you lived", worked: "a place you worked", notable: "a familiar landmark", other: "your saved point" } as const;

export function PersonalRouteHint({ hints }: { hints: Hint[] }) {
  if (!hints.length) return null;
  return <details className="personal-route-hint">
    <summary>Stuck? Ground the fare in somewhere familiar</summary>
    <p>This is a private orientation aid, not part of the answer.</p>
    {hints.map((hint) => <article key={hint.placeId}>
      <strong>{hint.placeName}</strong>
      <span>{relationship[hint.relationship]} · about {hint.distanceMetres}m {hint.side === "nearby" ? "from the route" : `on your ${hint.side}`} while heading {hint.heading} on {hint.roadName}</span>
      {!!hint.turns.length && <ol>{hint.turns.map((turn) => <li key={turn}>{turn}</li>)}</ol>}
    </article>)}
  </details>;
}
