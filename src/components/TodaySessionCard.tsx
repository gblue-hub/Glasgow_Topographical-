import { useId, type ReactNode } from "react";
import type { LearningJourney } from "../domain/learning-journeys";
import type { DailyLearningPlan } from "../domain/daily-learning";
import type { KnowledgeArea } from "../domain/geographic-knowledge";
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
  homeBase?: DailyLearningPlan["homeBase"];
  corridor?: DailyLearningPlan["corridor"];
  availableCorridors?: DailyLearningPlan["availableCorridors"];
  onSelectCorridor?: (
    area: DailyLearningPlan["availableCorridors"][number]["area"],
  ) => void;
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
  homeBase,
  corridor,
  availableCorridors = [],
  onSelectCorridor,
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
            Learn the exact named associations, recall them mentally, then
            answer the same multiple-choice format used in the exam.
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
          {!!availableCorridors.length && (
            <CorridorPicker
              corridor={corridor}
              corridors={availableCorridors}
              onSelect={onSelectCorridor}
            />
          )}
          {homeBase && (
            <div className="today-session-card__home-patch">
              <span>HOME PATCH · {knowledgeAreaLabel(homeBase.area)}</span>
              <strong>{homeBase.phase === "home_region" ? `${homeBase.name} area associations` : "Next geographic group unlocked"}</strong>
              <small>{homeBase.phase === "home_region" ? `${homeBase.remainingRecords} unseen records remain in this area before learning moves outward.` : `Your home area has been introduced. New associations now continue through the next nearby group.`}</small>
            </div>
          )}
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
                <dt>New associations</dt>
              </div>
              <div className="today-session-card__count today-session-card__count--promotion">
                <dd>{nonNegative(counts.promotion).toLocaleString()}</dd>
                <dt>Recall all streets</dt>
              </div>
            </dl>
          </div>
          {!!journeys.length && (
            <div className="today-session-card__journeys" aria-label="Optional journey context">
              <p className="learning-enhancement-eyebrow">SUPPLEMENTAL · JOURNEY CONTEXT</p>
              {journeys.map((journey) => (
                <article key={journey.id}>
                  <span aria-hidden="true">A</span>
                  <div>
                    <h3>{journey.title}</h3>
                    <p>{journey.reason}</p>
                    {!!journey.spineRoadNames.length && (
                      <small>Area pathway · {journey.spineRoadNames.join(" → ")}</small>
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
                ? "These routes are optional context for understanding how streets connect. The learning session itself tests the named associations required by the exam."
                : focusLabel
                ? `New material stays within ${focusLabel}. It is read alongside previous misses before the mixed test begins.`
                : "The named associations come first. Recognition and recall questions are then shuffled together."}
            </p>
            <button className="primary" type="button" onClick={onStart}>
              Start next session
            </button>
          </footer>
        </>
      ) : (
        <div className="today-session-card__empty" role="status">
          {!!availableCorridors.length && (
            <CorridorPicker
              corridor={corridor}
              corridors={availableCorridors}
              onSelect={onSelectCorridor}
            />
          )}
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

const knowledgeAreaLabel = (area: KnowledgeArea) =>
  area.charAt(0).toUpperCase() + area.slice(1);

function CorridorPicker({
  corridor,
  corridors,
  onSelect,
}: {
  corridor: DailyLearningPlan["corridor"] | undefined;
  corridors: DailyLearningPlan["availableCorridors"];
  onSelect?: TodaySessionCardProps["onSelectCorridor"];
}) {
  return (
    <section className="today-session-card__corridor" aria-label="Learning corridor">
      <div>
        <p className="learning-enhancement-eyebrow">
          {corridor ? `${corridor.area.toUpperCase()} CORRIDOR` : "CHOOSE YOUR FIRST CORRIDOR"}
        </p>
        <strong>
          {corridor?.complete
            ? `${knowledgeAreaLabel(corridor.area)} complete`
            : corridor?.stageName ?? "Build Glasgow from the City Centre out"}
        </strong>
        <small>
          {corridor?.stageName
            ? `Stage ${corridor.stagePosition} of ${corridor.stageCount} · ${corridor.remainingRecords} records remain in this corridor.`
            : "Stay in one direction until every district and association on that path has been introduced."}
        </small>
        {!!corridor?.incomingRoadNames.length && (
          <span>
            {corridor.incomingKind === "stitch_road" ? "Stitch into this district" : "Main-road approach"} · {corridor.incomingRoadNames.join(" → ")}
          </span>
        )}
      </div>
      <div className="today-session-card__corridor-options">
        {corridors.map((item) => (
          <button
            type="button"
            key={item.area}
            className={corridor?.area === item.area ? "selected" : ""}
            aria-pressed={corridor?.area === item.area}
            disabled={
              item.complete ||
              !onSelect ||
              (!!corridor && !corridor.complete && item.area !== corridor.area)
            }
            onClick={() => onSelect?.(item.area)}
          >
            <strong>{knowledgeAreaLabel(item.area)}</strong>
            <small>
              {item.complete
                ? "Complete"
                : `${item.learnedRecords} / ${item.totalRecords}`}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}
