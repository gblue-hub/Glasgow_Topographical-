import { useMemo } from "react";
import type { LearningContent, LearningRecord } from "../domain/types";
import { answerSummary, explorerTypeLabel, filterExplorerRecords, type ExplorerType } from "../domain/explorer";
import {
  GEOGRAPHIC_SCOPES,
  geographicScopeLabels,
  type GeographicScope,
} from "../domain/geographic-knowledge";
import { getAnswerFeatures } from "../domain/questions";

export type ExplorerState = {
  query: string;
  sectionCode: string;
  type: ExplorerType;
  area: GeographicScope;
  page: number;
};

export function Explorer({ content, state, onStateChange, onOpenRecord }: { content: LearningContent; state: ExplorerState; onStateChange: (state: ExplorerState) => void; onOpenRecord: (record: LearningRecord) => void }) {
  const { query, sectionCode, type, area, page } = state;
  const filtered = useMemo(
    () =>
      filterExplorerRecords(
        content.records,
        query,
        sectionCode,
        type,
        area,
      ),
    [area, content.records, query, sectionCode, type],
  );
  const pageCount = Math.max(1, filtered.length);
  const currentPage = Math.min(page, pageCount);
  const activeIndex = currentPage - 1;
  const windowStart = Math.min(
    Math.max(0, activeIndex - 1),
    Math.max(0, filtered.length - 3),
  );
  const visible = [windowStart, windowStart + 1, windowStart + 2]
    .filter((index) => index < filtered.length)
    .map((index) => ({ record: filtered[index], index }));
  const update = (next: Partial<ExplorerState>, resetPage = false) => onStateChange({ ...state, ...next, ...(resetPage ? { page: 1 } : {}) });
  const clear = () => onStateChange({ query: "", sectionCode: "", type: "all", area: "all", page: 1 });
  const surprise = () => filtered.length && onOpenRecord(filtered[Math.floor(Math.random() * filtered.length)]);

  return <>
    <header className="page-head explorer-head">
      <div><p>ANSWER LIBRARY</p><h1>Explore the whole dataset.</h1><span>Read exact exam names and their associated streets without being tested or changing your mastery.</span></div>
      <button className="secondary" onClick={surprise} disabled={!filtered.length}>Surprise me</button>
    </header>
    <section className="explorer-tools" aria-label="Dataset filters">
      <label className="explorer-search"><span>Search names, streets or postcodes</span><input type="search" value={query} onChange={(event) => update({ query: event.target.value }, true)} placeholder="Try ‘Castle Street’ or ‘G4’…" autoComplete="off" /></label>
      <label><span>Section</span><select value={sectionCode} onChange={(event) => update({ sectionCode: event.target.value }, true)}><option value="">All sections</option>{content.sections.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.record_count})</option>)}</select></label>
      <label><span>Geographic area</span><select value={area} onChange={(event) => update({ area: event.target.value as GeographicScope }, true)}>{GEOGRAPHIC_SCOPES.map((scope) => <option key={scope} value={scope}>{geographicScopeLabels[scope]}</option>)}</select></label>
      <label><span>Answer type</span><select value={type} onChange={(event) => update({ type: event.target.value as ExplorerType }, true)}><option value="all">All types</option><option value="place">Places</option><option value="middle_road">Main roads</option><option value="district">Districts</option></select></label>
    </section>
    <div className="explorer-result-bar" aria-live="polite"><span><b>{filtered.length.toLocaleString()}</b> answers</span>{(query || sectionCode || type !== "all" || area !== "all") && <button className="link" onClick={clear}>Clear filters</button>}</div>
    {visible.length ? (
      <section className="answer-carousel" aria-roledescription="carousel" aria-label="Answer library">
        <div className="answer-carousel-head">
          <span aria-live="polite">
            Answer <b>{currentPage.toLocaleString()}</b> of {filtered.length.toLocaleString()}
          </span>
          <div>
            <button type="button" aria-label="Previous answer" disabled={currentPage === 1} onClick={() => update({ page: currentPage - 1 })}>←</button>
            <button type="button" aria-label="Next answer" disabled={currentPage === pageCount} onClick={() => update({ page: currentPage + 1 })}>→</button>
          </div>
        </div>
        <div className="answer-carousel-track">
          {visible.map(({ record, index }) => {
            const features = getAnswerFeatures(record);
            const position = index < activeIndex ? "previous" : index > activeIndex ? "next" : "current";
            return (
              <button
                type="button"
                className={`answer-carousel-card ${position}`}
                data-position={position}
                aria-current={position === "current" ? "true" : undefined}
                aria-label={position === "current" ? `Open ${record.exam_name}` : `${position === "previous" ? "Previous" : "Next"} answer: ${record.exam_name}`}
                key={record.id}
                onClick={() => position === "current" ? onOpenRecord(record) : update({ page: index + 1 })}
              >
                <span className={`type-mark ${record.type}`} aria-hidden="true" />
                <span className="answer-main"><small>{record.section.name} · {explorerTypeLabel(record.type)}</small><strong>{record.exam_name}</strong></span>
                <span className="answer-streets"><small>{features.length === 1 ? "ANSWER" : "ANSWERS"}</small><span>{answerSummary(record) || "No associated street published"}</span></span>
                <span className="answer-open" aria-hidden="true">{position === "current" ? "Open →" : "View"}</span>
              </button>
            );
          })}
        </div>
      </section>
    ) : <section className="explorer-empty"><h2>No matching answers</h2><p>Try a shorter name, another postcode, or clear the filters.</p></section>}
  </>;
}
