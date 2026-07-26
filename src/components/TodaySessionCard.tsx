import { useId, type ReactNode } from "react";
import "./learning-enhancements.css";

export type TodaySessionCounts = {
  due: number;
  weak: number;
  new: number;
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
            Review what is fading, strengthen weak links, then add something
            new.
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
              <div className="today-session-card__count today-session-card__count--due">
                <dd>{nonNegative(counts.due).toLocaleString()}</dd>
                <dt>Reviews due</dt>
              </div>
              <div className="today-session-card__count today-session-card__count--weak">
                <dd>{nonNegative(counts.weak).toLocaleString()}</dd>
                <dt>Weak connections</dt>
              </div>
              <div className="today-session-card__count today-session-card__count--new">
                <dd>{nonNegative(counts.new).toLocaleString()}</dd>
                <dt>New connections</dt>
              </div>
            </dl>
          </div>
          <footer className="today-session-card__footer">
            <p>
              {focusLabel
                ? `New material is grouped around ${focusLabel}, so nearby connections are learned together.`
                : "Choices stay hidden until you are ready, then practice continues in exam format."}
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
