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
          <p className="learning-enhancement-eyebrow">TODAY&apos;S LEARNING</p>
          <h2 id={titleId}>A short session built for you</h2>
          <p>
            Repair slips first, keep older knowledge alive, then build one
            section from identifying the place towards recalling every street.
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
                {itemCount === 1 ? "connection" : "connections"} today
              </span>
            </div>
            <dl className="today-session-card__counts">
              <div className="today-session-card__count today-session-card__count--recovery">
                <dd>{nonNegative(counts.recovery).toLocaleString()}</dd>
                <dt>Daily recovery</dt>
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
                ? `New material stays within ${focusLabel}. Each connection is located, linked to its exact wording, then retrieved.`
                : "Recovery and scheduled rotation come first. New material is taught before it appears in exam format."}
            </p>
            <button className="primary" type="button" onClick={onStart}>
              Start today&apos;s session
            </button>
          </footer>
        </>
      ) : (
        <div className="today-session-card__empty" role="status">
          {emptyState ?? (
            <>
              <strong>You&apos;re caught up for today.</strong>
              <span>There are no scheduled connections waiting right now.</span>
            </>
          )}
        </div>
      )}
    </section>
  );
}
