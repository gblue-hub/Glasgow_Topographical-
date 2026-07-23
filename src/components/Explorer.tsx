import { useMemo } from "react";
import type { LearningContent, LearningRecord } from "../domain/types";
import { answerSummary, explorerTypeLabel, filterExplorerRecords, type ExplorerType } from "../domain/explorer";
import { getAnswerFeatures } from "../domain/questions";

const PAGE_SIZE = 30;

export type ExplorerState = {
  query: string;
  sectionCode: string;
  type: ExplorerType;
  page: number;
};

export function Explorer({ content, state, onStateChange, onOpenRecord }: { content: LearningContent; state: ExplorerState; onStateChange: (state: ExplorerState) => void; onOpenRecord: (record: LearningRecord) => void }) {
  const { query, sectionCode, type, page } = state;
  const filtered = useMemo(() => filterExplorerRecords(content.records, query, sectionCode, type), [content.records, query, sectionCode, type]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const update = (next: Partial<ExplorerState>, resetPage = false) => onStateChange({ ...state, ...next, ...(resetPage ? { page: 1 } : {}) });
  const clear = () => onStateChange({ query: "", sectionCode: "", type: "all", page: 1 });
  const surprise = () => filtered.length && onOpenRecord(filtered[Math.floor(Math.random() * filtered.length)]);

  return <>
    <header className="page-head explorer-head">
      <div><p>ANSWER LIBRARY</p><h1>Explore the whole dataset.</h1><span>Read exact exam names and their associated streets without being tested or changing your mastery.</span></div>
      <button className="secondary" onClick={surprise} disabled={!filtered.length}>Surprise me</button>
    </header>
    <section className="explorer-tools" aria-label="Dataset filters">
      <label className="explorer-search"><span>Search names, streets or postcodes</span><input type="search" value={query} onChange={(event) => update({ query: event.target.value }, true)} placeholder="Try ‘Castle Street’ or ‘G4’…" autoComplete="off" /></label>
      <label><span>Section</span><select value={sectionCode} onChange={(event) => update({ sectionCode: event.target.value }, true)}><option value="">All sections</option>{content.sections.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.record_count})</option>)}</select></label>
      <label><span>Answer type</span><select value={type} onChange={(event) => update({ type: event.target.value as ExplorerType }, true)}><option value="all">All types</option><option value="place">Places</option><option value="middle_road">Main roads</option><option value="district">Districts</option></select></label>
    </section>
    <div className="explorer-result-bar" aria-live="polite"><span><b>{filtered.length.toLocaleString()}</b> answers</span>{(query || sectionCode || type !== "all") && <button className="link" onClick={clear}>Clear filters</button>}</div>
    {visible.length ? <div className="answer-list">{visible.map((record) => {
      const features = getAnswerFeatures(record);
      return <button key={record.id} onClick={() => onOpenRecord(record)}><span className={`type-mark ${record.type}`} aria-hidden="true" /><span className="answer-main"><small>{record.section.name} · {explorerTypeLabel(record.type)}</small><strong>{record.exam_name}</strong></span><span className="answer-streets"><small>{features.length === 1 ? "ANSWER" : "ANSWERS"}</small><span>{answerSummary(record) || "No associated street published"}</span></span><span className="answer-open" aria-hidden="true">→</span></button>;
    })}</div> : <section className="explorer-empty"><h2>No matching answers</h2><p>Try a shorter name, another postcode, or clear the filters.</p></section>}
    {pageCount > 1 && <div className="pagination" role="navigation" aria-label="Explorer pages"><button disabled={page === 1} onClick={() => update({ page: page - 1 })}>← Previous</button><span>Page {page} of {pageCount}</span><button disabled={page === pageCount} onClick={() => update({ page: page + 1 })}>Next →</button></div>}
  </>;
}
