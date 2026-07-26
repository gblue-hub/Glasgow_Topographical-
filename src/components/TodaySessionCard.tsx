import { useId, type ReactNode } from "react";
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
  emptyState?: ReactNode;
};

const nonNegative = (value: number) => Math.max(0, value);

export function TodaySessionCard({
  counts,
  totalItemCount,
  estimatedMinutes,
  onStart,
  focusLabel,
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
            Read new material and previous misses together, then answer one
            mixed set of recognition and recall questions.
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
                <dt>New from one section</dt>
              </div>
              <div className="today-session-card__count today-session-card__count--promotion">
                <dd>{nonNegative(counts.promotion).toLocaleString()}</dd>
                <dt>Recall all streets</dt>
              </div>
            </dl>
          </div>
          <footer className="today-session-card__footer">
            <p>
              {focusLabel
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
