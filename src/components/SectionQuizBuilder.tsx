import { useMemo, useState } from "react";
import { buildSectionGroupPresets, normaliseSectionCodes } from "../domain/section-groups";
import type { Association, Section } from "../domain/types";

type LatestResult = {
  correct_count: number;
  question_count: number;
  percentage: number;
};

type SectionWithTotal = Section & {
  directionTotals: Record<Association["direction"], number>;
  latestResults: Partial<Record<Association["direction"], LatestResult>>;
};

type Props = {
  sections: SectionWithTotal[];
  onStartSingle: (sectionCode: string, direction: Association["direction"]) => void;
  onStartMultiple: (sectionCodes: string[], label: string, direction: Association["direction"]) => void;
};

export function SectionQuizBuilder({ sections, onStartSingle, onStartMultiple }: Props) {
  const [mode, setMode] = useState<"single" | "multiple">("single");
  const [direction, setDirection] = useState<Association["direction"]>("reverse");
  const [singleCode, setSingleCode] = useState(sections[0]?.code ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const presets = useMemo(() => buildSectionGroupPresets(sections), [sections]);
  const selectedSet = new Set(selected);
  const chosen = sections.filter((section) => selectedSet.has(section.code));
  const singleSection = sections.find((section) => section.code === singleCode) ?? sections[0];
  const questionCount = chosen.reduce((total, section) => total + section.directionTotals[direction], 0);
  const choose = (codes: string[]) => setSelected(normaliseSectionCodes(codes));
  const activePreset = presets.find((preset) =>
    preset.available && preset.sectionCodes.join("|") === selected.join("|"),
  );
  const trackLabel = direction === "reverse" ? "Recognition" : "Recall";
  const selectionLabel = `${trackLabel} · ${activePreset?.label ?? `Custom test · ${chosen.length} sections`}`;
  const remaining = sections.filter((section) => !selectedSet.has(section.code));

  return (
    <section className="section-builder panel" aria-labelledby="section-builder-title">
      <div className="section-builder-head">
        <div>
          <p className="eyebrow">SECTION QUIZZES</p>
          <h2 id="section-builder-title">Choose the quiz you want</h2>
          <p>Take one section on its own or combine several into a longer test.</p>
        </div>
        <div className="quiz-mode-tabs" role="tablist" aria-label="Section quiz type">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "single"}
            aria-controls="single-section-panel"
            id="single-section-tab"
            onClick={() => setMode("single")}
          >
            <span>Single</span>
            <small>One section</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "multiple"}
            aria-controls="multiple-sections-panel"
            id="multiple-sections-tab"
            onClick={() => setMode("multiple")}
          >
            <span>Multiple</span>
            <small>Combined test</small>
          </button>
        </div>
      </div>

      <div className="practice-track-picker" role="group" aria-label="Practice direction">
        <button
          type="button"
          className={direction === "reverse" ? "selected" : ""}
          aria-pressed={direction === "reverse"}
          onClick={() => setDirection("reverse")}
        >
          <span>1 · Recognition</span>
          <b>Streets → category</b>
          <small>Start here. Recognise the category from its grouped streets.</small>
        </button>
        <button
          type="button"
          className={direction === "forward" ? "selected" : ""}
          aria-pressed={direction === "forward"}
          onClick={() => setDirection("forward")}
        >
          <span>2 · Recall</span>
          <b>Category → all streets</b>
          <small>The harder track. Select every street associated with the category.</small>
        </button>
      </div>

      {mode === "single" ? (
        <div
          className="quiz-mode-panel single-section-panel"
          id="single-section-panel"
          role="tabpanel"
          aria-labelledby="single-section-tab"
        >
          <label className="section-select">
            <span>Section</span>
            <select
              value={singleSection?.code ?? ""}
              onChange={(event) => setSingleCode(event.target.value)}
            >
              {sections.map((section) => (
                <option value={section.code} key={section.code}>
                  {section.code} · {section.name}
                </option>
              ))}
            </select>
          </label>
          {singleSection && (
            <div className="section-choice-summary" aria-live="polite">
              <div className="section-choice-code" aria-hidden="true">{singleSection.code}</div>
              <div>
                <h3>{singleSection.name}</h3>
                <p>{singleSection.record_count} records · {singleSection.directionTotals[direction]} {trackLabel.toLowerCase()} questions</p>
              </div>
              <div className="section-choice-score">
                <small>Latest score</small>
                <b>{singleSection.latestResults[direction] ? `${singleSection.latestResults[direction]!.percentage.toFixed(0)}%` : "Not taken"}</b>
                {singleSection.latestResults[direction] && (
                  <span>{singleSection.latestResults[direction]!.correct_count}/{singleSection.latestResults[direction]!.question_count} correct</span>
                )}
              </div>
            </div>
          )}
          <button
            className="primary section-start"
            type="button"
            disabled={!singleSection}
            onClick={() => singleSection && onStartSingle(singleSection.code, direction)}
          >
            {singleSection?.latestResults[direction] ? `Retake ${trackLabel.toLowerCase()} quiz` : `Start ${trackLabel.toLowerCase()} quiz`}
          </button>
        </div>
      ) : (
        <div
          className="quiz-mode-panel multiple-sections-panel"
          id="multiple-sections-panel"
          role="tabpanel"
          aria-labelledby="multiple-sections-tab"
        >
          <label className="section-preset-select">
            <span>Quick selection</span>
            <select
              value={activePreset?.id ?? ""}
              onChange={(event) => {
                const preset = presets.find((item) => item.id === event.target.value);
                if (preset?.available) choose(preset.sectionCodes);
              }}
            >
              <option value="">Choose a regional preset…</option>
              {presets.map((preset) => (
                <option value={preset.id} disabled={!preset.available} key={preset.id}>
                  {preset.label}{preset.available ? "" : " (unavailable)"}
                </option>
              ))}
            </select>
          </label>
          <div className="custom-section-controls">
            <label>
              <span>Add a section</span>
              <select
                value=""
                disabled={!remaining.length}
                onChange={(event) => {
                  if (event.target.value) choose([...selected, event.target.value]);
                }}
              >
                <option value="">{remaining.length ? "Choose…" : "All sections selected"}</option>
                {remaining.map((section) => (
                  <option value={section.code} key={section.code}>
                    {section.code} · {section.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Remove a section</span>
              <select
                value=""
                disabled={!chosen.length}
                onChange={(event) => {
                  if (event.target.value) choose(selected.filter((code) => code !== event.target.value));
                }}
              >
                <option value="">{chosen.length ? "Choose…" : "None selected"}</option>
                {chosen.map((section) => (
                  <option value={section.code} key={section.code}>
                    {section.code} · {section.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="combined-selection-summary" aria-live="polite">
            <div>
              <b>{chosen.length}</b>
              <span>sections</span>
            </div>
            <div>
              <b>{questionCount.toLocaleString()}</b>
              <span>questions</span>
            </div>
            <p>{chosen.length ? chosen.map((section) => section.code).join(" · ") : "Choose a preset or add sections above."}</p>
          </div>
          <div className="section-builder-actions">
            <button className="link" type="button" onClick={() => choose([])} disabled={!selected.length}>Clear selection</button>
            <button
              className="primary"
              type="button"
              disabled={selected.length < 2}
              onClick={() => onStartMultiple(selected, selectionLabel, direction)}
            >
              {selected.length < 2 ? "Choose at least two sections" : `Start ${questionCount.toLocaleString()}-question quiz`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
