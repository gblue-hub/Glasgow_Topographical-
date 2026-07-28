import { knowledgeAreaLabels } from "../domain/geographic-knowledge";
import {
  orderedSessionHistory,
  replayAssociationIds,
} from "../domain/session-history";
import type {
  Association,
  Attempt,
  SessionResult,
} from "../domain/types";

type Props = {
  results: SessionResult[];
  attempts: Attempt[];
  associations: Association[];
  onReplay: (result: SessionResult, associationIds: string[]) => void;
};

const sourceLabel = (result: SessionResult) => {
  if (result.source_mode === "daily") return "Recommended learning";
  if (result.source_mode === "section") return "Section quiz";
  if (result.source_mode === "section_set") return "Combined quiz";
  if (result.source_mode === "trouble") return "Slips practice";
  if (result.source_mode === "feedback") return "Directional practice";
  return "Learning quiz";
};

export function SessionHistory({
  results,
  attempts,
  associations,
  onReplay,
}: Props) {
  const history = orderedSessionHistory(results);
  return (
    <>
      <header className="page-head">
        <div>
          <p>SESSION HISTORY</p>
          <h1>Return to an earlier learning session.</h1>
          <span>
            Replay the same question selection and order to see what has
            strengthened since you last met it.
          </span>
        </div>
      </header>
      {history.length ? (
        <section className="session-history-list" aria-label="Completed learning sessions">
          {history.map((result) => {
            const associationIds = replayAssociationIds(
              result,
              attempts,
              associations,
            );
            const replayable = associationIds.length > 0;
            return (
              <article className="session-history-card" key={result.session_id}>
                <div className="session-history-card__date">
                  <strong>
                    {new Date(result.completed_at).toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </strong>
                  <span>
                    {new Date(result.completed_at).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="session-history-card__main">
                  <small>
                    {sourceLabel(result)}
                    {result.focus_area
                      ? ` · ${knowledgeAreaLabels[result.focus_area]}`
                      : ""}
                  </small>
                  <h2>{result.selection_label || "Learning session"}</h2>
                  <span>
                    {result.question_count} questions ·{" "}
                    {result.incorrect_association_ids.length} first-pass{" "}
                    {result.incorrect_association_ids.length === 1
                      ? "miss"
                      : "misses"}
                  </span>
                </div>
                <div className="session-history-card__score">
                  <strong>{result.percentage.toFixed(0)}%</strong>
                  <span>
                    {result.correct_count}/{result.question_count}
                  </span>
                </div>
                <button
                  className="primary"
                  type="button"
                  disabled={!replayable}
                  onClick={() => onReplay(result, associationIds)}
                >
                  {replayable ? "Replay this session" : "Replay unavailable"}
                </button>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="panel session-history-empty" role="status">
          <h2>No completed sessions yet</h2>
          <p>
            Your recommended learning and practice quizzes will appear here
            after you complete them.
          </p>
        </section>
      )}
    </>
  );
}
