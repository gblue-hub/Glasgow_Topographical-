import { useId } from "react";
import type { TroubleSpot } from "../domain/trouble-spots";
import "./learning-enhancements.css";

type Props = {
  spots: TroubleSpot[];
  onStart: (associationIds: string[]) => void;
  onReview: () => void;
};

export function MistakeTestCard({ spots, onStart, onReview }: Props) {
  const titleId = useId();
  const associationIds = spots.map((spot) => spot.association.id);
  const recurring = spots.filter(
    (spot) => spot.kind === "recurring_slip",
  ).length;
  const notYetPassed = spots.filter(
    (spot) => spot.kind === "not_yet_secure",
  ).length;

  return (
    <section className="mistake-test-card" aria-labelledby={titleId}>
      <div className="mistake-test-card__mark" aria-hidden="true">
        ×
      </div>
      <div className="mistake-test-card__copy">
        <p className="learning-enhancement-eyebrow">PRACTISE WHAT COSTS YOU MARKS</p>
        <h2 id={titleId}>Mistake test</h2>
        {spots.length ? (
          <p>
            One standalone multiple-choice test containing every unique answer
            you have missed across all categories. Your correct answers are left
            out so you can spend the time on what is making you fail.
          </p>
        ) : (
          <p>
            Any answer you miss on a learning quiz will be saved here
            automatically, ready for a focused standalone test.
          </p>
        )}
        <dl className="mistake-test-card__summary">
          <div>
            <dd>{spots.length}</dd>
            <dt>{spots.length === 1 ? "answer to retest" : "answers to retest"}</dt>
          </div>
          <div>
            <dd>{recurring}</dd>
            <dt>missed more than once</dt>
          </div>
          <div>
            <dd>{notYetPassed}</dd>
            <dt>not yet passed</dt>
          </div>
        </dl>
      </div>
      <div className="mistake-test-card__actions">
        <button
          className="primary"
          type="button"
          disabled={!spots.length}
          onClick={() => onStart(associationIds)}
        >
          {spots.length
            ? `Test my ${spots.length} ${spots.length === 1 ? "mistake" : "mistakes"}`
            : "No mistakes to test"}
        </button>
        <button className="back" type="button" onClick={onReview}>
          Review mistake list
        </button>
      </div>
    </section>
  );
}
