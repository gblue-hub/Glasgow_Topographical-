import { useId, type ReactNode } from "react";
import type { LearningJourney } from "../domain/learning-journeys";
import "./learning-enhancements.css";

export type TodaySessionCounts = {
  recovery: number;
  maintenance: number;
  recognition: number;
  new: number;
  promotion: number;
};

export type TodaySessionCardProps = {
  counts: TodaySessionCounts;
  totalItemCount: number;
  estimatedMinutes: number;
  onStart: () => void;
  focusLabel?: string;
  journeys?: LearningJourney[];
  emptyState?: ReactNode;
};

const nonNegative = (value: number) => Math.max(0, value);

export function TodaySessionCard({
  counts,
  totalItemCount,
  estimatedMinutes,
  onStart,
  focusLabel,
  journeys = [],
  emptyState,
}: TodaySessionCardProps) {
  const titleId = useId();
  const itemCount = nonNegative(totalItemCount);
  const minutes = nonNegative(estimatedMinutes);
  const hasItems = itemCount > 0;

  return (
    <section className="today-session-card" aria-labelledby={titleId}>
      <header className="today-session-card__header">
        <div>
          <p className="learning-enhancement-eyebrow">NEXT LEARNING SESSION</p>
          <h2 id={titleId}>A short session built for you</h2>
          <p>
            Follow a purposeful city run, read its streets and destinations
            together, then retrieve the same connections from memory.
          </p>
        </div>
        <div
          className="today-session-card__duration"
          aria-label={`Estimated time ${minutes} minutes`}
        >
          <strong>{minutes}</strong>
          <span>min</span>
        </div>
      </header>

      {hasItems ? (
        <>
          <div className="today-session-card__plan">
            <div className="today-session-card__total">
              <strong>{itemCount.toLocaleString()}</strong>
              <span>
                {itemCount === 1 ? "connection" : "connections"} scheduled
              </span>
            </div>
            <dl className="today-session-card__counts">
              <div className="today-session-card__count today-session-card__count--recovery">
                <dd>{nonNegative(counts.recovery).toLocaleString()}</dd>
                <dt>Previous misses</dt>
              </div>
              <div className="today-session-card__count today-session-card__count--maintenance">
                <dd>{nonNegative(counts.maintenance).toLocaleString()}</dd>
                <dt>Older knowledge</dt>
              </div>
              <div className="today-session-card__count today-session-card__count--recognition">
                <dd>{nonNegative(counts.recognition).toLocaleString()}</dd>
                <dt>Identify the place</dt>
              </div>
              <div className="today-session-card__count today-session-card__count--new">
                <dd>{nonNegative(counts.new).toLocaleString()}</dd>
                <dt>New journey stops</dt>
              </div>
              <div className="today-session-card__count today-session-card__count--promotion">
                <dd>{nonNegative(counts.promotion).toLocaleString()}</dd>
                <dt>Recall all streets</dt>
              </div>
            </dl>
          </div>
          {!!journeys.length && (
            <div className="today-session-card__journeys" aria-label="Learning journeys">
              <p className="learning-enhancement-eyebrow">WHY THESE BELONG TOGETHER</p>
              {journeys.map((journey) => (
                <article key={journey.id}>
                  <span aria-hidden="true">A</span>
                  <div>
                    <h3>{journey.title}</h3>
                    <p>{journey.reason}</p>
                    {!!journey.spineRoadNames.length && (
                      <small>Working spine · {journey.spineRoadNames.join(" → ")}</small>
                    )}
                    {!!journey.roadNames.length && (
                      <small>Mapped corridor · {journey.roadNames.join(" · ")}</small>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          <footer className="today-session-card__footer">
            <p>
              {journeys.length
                ? "The study map follows the same anchor, streets, and destinations. You can later test the complete route against OSRM in Explore → Journeys."
                : focusLabel
                ? `New material stays within ${focusLabel}. It is read alongside previous misses before the mixed test begins.`
                : "The complete reading set comes first. Recognition and recall are then shuffled together."}
            </p>
            <button className="primary" type="button" onClick={onStart}>
              Start next session
            </button>
          </footer>
        </>
      ) : (
        <div className="today-session-card__empty" role="status">
          {emptyState ?? (
            <>
              <strong>You&apos;re caught up.</strong>
              <span>There are no scheduled connections waiting right now.</span>
            </>
          )}
        </div>
      )}
    </section>
  );
}
