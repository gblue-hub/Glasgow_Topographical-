import { useMemo } from "react";
import type { LearningContent, LearningRecord } from "../domain/types";
import { answerSummary, explorerTypeLabel, filterExplorerRecords, type ExplorerType } from "../domain/explorer";
import {
  GEOGRAPHIC_SCOPES,
  geographicScopeLabels,
  type GeographicScope,
} from "../domain/geographic-knowledge";
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
  const currentRecord = filtered[activeIndex];
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
    <div className="explorer-result-bar" aria-live="polite"><span><b>{filtered.length.toLocaleString()}</b> answers in this group</span>{(query || sectionCode || type !== "all" || area !== "all") && <button className="link" onClick={clear}>Clear filters</button>}</div>
    {currentRecord ? (
      <section className="explorer-launch" aria-label="Selected answer group">
        <div>
          <span className={`type-mark ${currentRecord.type}`} aria-hidden="true" />
          <p>READY TO BROWSE</p>
          <h2>{filtered.length.toLocaleString()} {filtered.length === 1 ? "answer" : "answers"}</h2>
          <span>
            Starts with <b>{currentRecord.exam_name}</b> · {explorerTypeLabel(currentRecord.type)}
          </span>
          <small>{answerSummary(currentRecord) || "No associated street published"}</small>
        </div>
        <button className="primary explorer-open-viewer" type="button" onClick={() => onOpenRecord(currentRecord)}>
          Open full-screen viewer <span aria-hidden="true">→</span>
        </button>
      </section>
    ) : <section className="explorer-empty"><h2>No matching answers</h2><p>Try a shorter name, another postcode, or clear the filters.</p></section>}
  </>;
}
