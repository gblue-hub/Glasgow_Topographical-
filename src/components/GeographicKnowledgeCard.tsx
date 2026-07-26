import {
  KNOWLEDGE_AREAS,
  type GeographicKnowledgeSummary,
} from "../domain/geographic-knowledge";
import "./geographic-knowledge.css";

type Props = {
  summary: GeographicKnowledgeSummary;
  onOpenInsights: () => void;
};

function recommendationReason(
  recommendation: NonNullable<GeographicKnowledgeSummary["recommendation"]>,
) {
  if (recommendation.recentSlips)
    return `${recommendation.recentSlips} recent slip${recommendation.recentSlips === 1 ? "" : "s"}`;
  if (recommendation.due)
    return `${recommendation.due} review${recommendation.due === 1 ? "" : "s"} due`;
  if (recommendation.learning)
    return `${recommendation.learning} currently learning`;
  return `${recommendation.unseen} still unseen`;
}

export function GeographicKnowledgeCard({
  summary,
  onOpenInsights,
}: Props) {
  const recommendation = summary.recommendation;
  if (!recommendation) return null;

  return (
    <section className="knowledge-snapshot" aria-labelledby="knowledge-snapshot-title">
      <div className="knowledge-snapshot__recommendation">
        <p>KNOWLEDGE BY AREA</p>
        <h2 id="knowledge-snapshot-title">
          Focus next on {recommendation.topicLabel.toLocaleLowerCase("en-GB")}{" "}
          in the {recommendation.areaLabel}.
        </h2>
        <span>
          {recommendation.securePercentage}% secure ·{" "}
          {recommendationReason(recommendation)}
        </span>
        <button className="link" type="button" onClick={onOpenInsights}>
          Explore the knowledge map →
        </button>
      </div>
      <div
        className="knowledge-snapshot__areas"
        aria-label="Overall mastery by area"
      >
        {KNOWLEDGE_AREAS.map((area) => {
          const cell = summary.areaTotals[area];
          return (
            <div key={area}>
              <span>{cell.areaLabel}</span>
              <strong>{cell.securePercentage}%</strong>
              <i>
                <b style={{ width: `${cell.securePercentage}%` }} />
              </i>
            </div>
          );
        })}
      </div>
    </section>
  );
}
