import { useMemo, useState } from "react";
import {
  practiceAssociationIds,
  type DirectionalFeedbackItem,
  type DirectionalPattern,
  type DirectionEvidence,
} from "../domain/directional-feedback";
import type { LearningRecord, Section } from "../domain/types";

type Props = {
  items: DirectionalFeedbackItem[];
  sections: Section[];
  onPractice: (associationIds: string[]) => void;
};

type Filter = "problems" | DirectionalPattern | "untested" | "all";

const directionLabels: Record<LearningRecord["type"], [string, string]> = {
  place: ["Place → streets", "Streets → place"],
  district: ["District → roads", "Roads → district"],
  middle_road: ["Middle road → end roads", "End roads → middle road"],
};

const statusLabels: Record<DirectionEvidence["status"], string> = {
  not_tried: "Not tested yet",
  last_wrong: "Latest first pass wrong",
  assisted_only: "Only right with help",
  recovered: "Latest right after a miss",
  correct_so_far: "Latest first pass right",
};

function patternLabel(item: DirectionalFeedbackItem) {
  const [forward, reverse] = directionLabels[item.record.type];
  switch (item.pattern) {
    case "both_latest_wrong": return "Latest result is wrong both ways";
    case "forward_latest_wrong": return `${forward} is the weak direction`;
    case "reverse_latest_wrong": return `${reverse} is the weak direction`;
    case "one_direction_unattempted": return "One direction still has no evidence";
    case "assisted_only": return "Independent recall is still missing";
    case "latest_correct_both": return item.fragile ? "Right both ways now, with recent misses" : "Latest result is right both ways";
    case "not_tested": return "Neither direction tested yet";
    default: return "Directional pair needs a data review";
  }
}

function DirectionTile({ label, evidence }: { label: string; evidence: DirectionEvidence }) {
  const statusClass = evidence.status === "last_wrong"
    ? "weak"
    : evidence.status === "not_tried" || evidence.status === "assisted_only"
      ? "gap"
      : "sound";
  return (
    <div className={`direction-tile ${statusClass}`}>
      <span>{label}</span>
      <b>{statusLabels[evidence.status]}</b>
      <div className="direction-numbers">
        <small>{evidence.correctAttempts} right · {evidence.incorrectAttempts} wrong</small>
        <small>Current streak {evidence.currentCorrectStreak}</small>
      </div>
      <div className="attempt-history" aria-label={`${label}: ${evidence.recentResults.length ? evidence.recentResults.map((result) => result.correct ? "right" : "wrong").join(", ") : "no decisive attempts"}`}>
        {evidence.recentResults.map((result, index) => (
          <i className={result.correct ? "hit" : "miss"} key={index} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}

export function DirectionalFeedback({ items, sections, onPractice }: Props) {
  const [query, setQuery] = useState("");
  const [sectionCode, setSectionCode] = useState("");
  const [filter, setFilter] = useState<Filter>("problems");
  const searched = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GB");
    return items.filter((item) =>
      (!sectionCode || item.record.section.code === sectionCode) &&
      (!needle || item.record.exam_name.toLocaleLowerCase("en-GB").includes(needle)),
    );
  }, [items, query, sectionCode]);
  const visible = searched.filter((item) => {
    if (filter === "all") return true;
    if (filter === "untested") return item.pattern === "not_tested" || item.pattern === "one_direction_unattempted";
    if (filter === "problems") return [
      "both_latest_wrong",
      "forward_latest_wrong",
      "reverse_latest_wrong",
      "one_direction_unattempted",
      "assisted_only",
    ].includes(item.pattern) || item.fragile;
    return item.pattern === filter;
  });
  const visiblePracticeIds = [...new Set(visible.flatMap(practiceAssociationIds))];
  const availableSections = sections.filter((section) =>
    items.some((item) => item.record.section.code === section.code),
  );
  return (
    <>
      <header className="page-head directional-head">
        <div>
          <p>DIRECTIONAL FEEDBACK</p>
          <h1>See which way each connection breaks down.</h1>
          <span>Latest first-pass recall is shown separately in both directions. “Right” here does not mean mastered.</span>
        </div>
        {!!visiblePracticeIds.length && (
          <button className="primary" onClick={() => onPractice(visiblePracticeIds)}>
            Practise {visiblePracticeIds.length} weak directions
          </button>
        )}
      </header>
      <section className="directional-controls" aria-label="Filter directional feedback">
        <label>
          <span>Find an entry</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search place, district or road…" />
        </label>
        <label>
          <span>Section</span>
          <select value={sectionCode} onChange={(event) => setSectionCode(event.target.value)}>
            <option value="">All sections</option>
            {availableSections.map((section) => <option value={section.code} key={section.code}>{section.name}</option>)}
          </select>
        </label>
        <label>
          <span>Evidence</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
            <option value="problems">Weak, fragile or missing</option>
            <option value="both_latest_wrong">Wrong both ways</option>
            <option value="forward_latest_wrong">Entry → answers weak</option>
            <option value="reverse_latest_wrong">Answers → entry weak</option>
            <option value="untested">Untested directions</option>
            <option value="assisted_only">Only right with help</option>
            <option value="latest_correct_both">Latest right both ways</option>
            <option value="all">All records</option>
          </select>
        </label>
      </section>
      <section className="stats" aria-label="Directional evidence summary">
        <article><span>Wrong both ways</span><b>{searched.filter((item) => item.pattern === "both_latest_wrong").length}</b></article>
        <article><span>Wrong one way</span><b>{searched.filter((item) => item.pattern === "forward_latest_wrong" || item.pattern === "reverse_latest_wrong").length}</b></article>
        <article><span>Missing a direction</span><b>{searched.filter((item) => item.pattern === "one_direction_unattempted").length}</b></article>
      </section>
      {!visible.length ? (
        <section className="panel trouble-empty">
          <h2>No records match this view</h2>
          <p>Change the evidence filter or complete section questions to add first-pass evidence.</p>
        </section>
      ) : (
        <section className="directional-list" aria-label={`${visible.length} directional feedback records`}>
          {visible.map((item) => {
            const [forwardLabel, reverseLabel] = directionLabels[item.record.type];
            const practiceIds = practiceAssociationIds(item);
            return (
              <article key={item.record.id}>
                <div className="directional-card-head">
                  <div>
                    <small>{item.record.section.code} · {item.record.section.name}</small>
                    <h2>{item.record.exam_name}</h2>
                    <p>{patternLabel(item)}</p>
                  </div>
                  {!!practiceIds.length && <button className="link" onClick={() => onPractice(practiceIds)}>Practise weak direction{practiceIds.length > 1 ? "s" : ""}</button>}
                </div>
                <div className="direction-pair">
                  <DirectionTile label={forwardLabel} evidence={item.forward} />
                  <DirectionTile label={reverseLabel} evidence={item.reverse} />
                </div>
                {!!item.confusionPairs.length && (
                  <div className="confusion-pairs">
                    <b>Repeated wrong-choice swaps</b>
                    {item.confusionPairs.map((pair) => (
                      <span key={pair.recordId}>
                        Chose <strong>{pair.examName}</strong> instead {pair.count} times
                      </span>
                    ))}
                  </div>
                )}
                {(item.forward.hasLegacyEvidence || item.reverse.hasLegacyEvidence) && (
                  <small className="legacy-evidence">Older history may include a correction round; new results separate it automatically.</small>
                )}
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
