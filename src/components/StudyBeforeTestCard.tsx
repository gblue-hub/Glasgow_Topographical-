import { useId, type ReactNode } from "react";
import { getAnswerFeatures } from "../domain/questions";
import { formatSectionName } from "../domain/sections";
import type { LearningRecord } from "../domain/types";
import "./learning-enhancements.css";

export type StudyBeforeTestCardProps = {
  record: LearningRecord;
  onReady: () => void;
  mapSlot?: ReactNode;
  instructions?: ReactNode;
  readyLabel?: string;
  eyebrow?: string;
};

const answerLead = (record: LearningRecord, answerCount: number) => {
  if (record.type === "middle_road") return "This road runs between:";
  if (record.type === "district") return "Roads associated with this district:";
  return answerCount === 1
    ? "Road associated with this place:"
    : "Roads associated with this place:";
};

export function StudyBeforeTestCard({
  record,
  onReady,
  mapSlot,
  instructions,
  readyLabel = "I'm ready — continue",
  eyebrow = "STUDY BEFORE TESTING",
}: StudyBeforeTestCardProps) {
  const titleId = useId();
  const answers = getAnswerFeatures(record);

  return (
    <section
      className={`study-before-test-card${mapSlot ? " study-before-test-card--with-map" : ""}`}
      aria-labelledby={titleId}
    >
      {mapSlot && (
        <div className="study-before-test-card__map" aria-label="Study map">
          {mapSlot}
        </div>
      )}
      <article className="study-before-test-card__copy">
        <header>
          <p className="learning-enhancement-eyebrow">{eyebrow}</p>
          <span>{formatSectionName(record.section.name)} · Exam wording</span>
          <h2 id={titleId} tabIndex={-1}>{record.exam_name}</h2>
        </header>

        <div className="study-before-test-card__answers">
          <h3>{answerLead(record, answers.length)}</h3>
          {answers.length ? (
            <ol>
              {answers.map((answer) => (
                <li key={answer.index}>
                  <span>{answer.exam_name}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>No associated answer is published for this entry.</p>
          )}
        </div>

        <div className="study-before-test-card__instructions">
          {instructions ?? (
            <>
              <h3>How to study this</h3>
              <p>
                Look at the exam wording and answers together. Use the map to
                notice how they connect, then continue when the relationship
                feels familiar.
              </p>
            </>
          )}
        </div>

        <button className="primary" type="button" onClick={onReady}>
          {readyLabel}
        </button>
      </article>
    </section>
  );
}
