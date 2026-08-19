import { useMemo, useState } from "react";
import type { AreaQuizGroup } from "../domain/area-quiz-groups";
import type { DistrictQuizGroup } from "../domain/district-quiz-groups";
import type { GeographicScope } from "../domain/geographic-knowledge";
import { buildSectionGroupPresets, normaliseSectionCodes } from "../domain/section-groups";
import { compareSectionCodes } from "../domain/sections";
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
  areaGroups?: AreaQuizGroup[];
  districtGroups?: DistrictQuizGroup[];
  onStartSingle: (sectionCode: string, direction: Association["direction"]) => void;
  onStartMultiple: (sectionCodes: string[], label: string, direction: Association["direction"]) => void;
  onStartArea?: (
    area: GeographicScope,
    label: string,
    direction: Association["direction"],
  ) => void;
  onStartDistrict?: (
    districtId: string,
    label: string,
    direction: Association["direction"],
  ) => void;
};

export function SectionQuizBuilder({ sections, areaGroups = [], districtGroups = [], onStartSingle, onStartMultiple, onStartArea, onStartDistrict }: Props) {
  const [mode, setMode] = useState<"single" | "multiple" | "area" | "district">("single");
  const [direction, setDirection] = useState<Association["direction"]>("reverse");
  const [singleCode, setSingleCode] = useState(sections[0]?.code ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedArea, setSelectedArea] = useState<GeographicScope>("all");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const presets = useMemo(() => buildSectionGroupPresets(sections), [sections]);
  const orderedSections = useMemo(
    () => [...sections].sort(compareSectionCodes),
    [sections],
  );
  const selectedSet = new Set(selected);
  const chosen = orderedSections.filter((section) => selectedSet.has(section.code));
  const singleSection = sections.find((section) => section.code === singleCode) ?? sections[0];
  const questionCount = chosen.reduce((total, section) => total + section.directionTotals[direction], 0);
  const choose = (codes: string[]) => setSelected(normaliseSectionCodes(codes));
  const activePreset = presets.find((preset) =>
    preset.available && preset.sectionCodes.join("|") === selected.join("|"),
  );
  const trackLabel =
    direction === "reverse" ? "Identify the place" : "Recall all streets";
  const areaGroup =
    areaGroups.find((group) => group.id === selectedArea) ?? areaGroups[0];
  const districtGroup =
    districtGroups.find((group) => group.id === selectedDistrict) ?? districtGroups[0];
  const selectionLabel = `${trackLabel} · ${activePreset?.label ?? `Custom test · ${chosen.length} sections`}`;
  const toggleSection = (sectionCode: string, checked: boolean) =>
    choose(
      checked
        ? [...selected, sectionCode]
        : selected.filter((code) => code !== sectionCode),
    );

  return (
    <section className="section-builder panel" aria-labelledby="section-builder-title">
      <div className="section-builder-head">
        <div>
          <p className="eyebrow">SECTION QUIZZES</p>
          <h2 id="section-builder-title">Choose the quiz you want</h2>
          <p>Test one section, combine several, or practise a whole Glasgow area.</p>
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
          <button
            type="button"
            role="tab"
            aria-selected={mode === "area"}
            aria-controls="area-quiz-panel"
            id="area-quiz-tab"
            onClick={() => setMode("area")}
          >
            <span>Area</span>
            <small>All categories</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "district"}
            aria-controls="district-quiz-panel"
            id="district-quiz-tab"
            onClick={() => setMode("district")}
          >
            <span>District</span>
            <small>One locality</small>
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
          <span>1 · Easier</span>
          <b>Identify the place</b>
          <small>See its grouped streets and identify the place or category.</small>
        </button>
        <button
          type="button"
          className={direction === "forward" ? "selected" : ""}
          aria-pressed={direction === "forward"}
          onClick={() => setDirection("forward")}
        >
          <span>2 · Harder</span>
          <b>Recall all streets</b>
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
                <p>{singleSection.record_count} records · {singleSection.directionTotals[direction]} questions · {trackLabel.toLowerCase()}</p>
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
      ) : mode === "multiple" ? (
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
              <option value="">Choose a quick group…</option>
              {presets.map((preset) => (
                <option value={preset.id} disabled={!preset.available} key={preset.id}>
                  {preset.label}{preset.available ? "" : " (unavailable)"}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="section-checklist">
            <legend>Add or remove sections</legend>
            {orderedSections.map((section) => {
              const checked = selectedSet.has(section.code);
              return (
                <label className={checked ? "selected" : ""} key={section.code}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      toggleSection(section.code, event.target.checked)
                    }
                  />
                  <span>
                    <b>{section.code}</b>
                    <span>{section.name}</span>
                    <small>
                      {section.record_count} records ·{" "}
                      {section.directionTotals[direction]}{" "}
                      questions · {trackLabel.toLowerCase()}
                    </small>
                  </span>
                </label>
              );
            })}
          </fieldset>
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
      ) : mode === "area" ? (
        <div
          className="quiz-mode-panel area-quiz-panel"
          id="area-quiz-panel"
          role="tabpanel"
          aria-labelledby="area-quiz-tab"
        >
          <div className="area-quiz-intro">
            <div>
              <p className="eyebrow">QUICK AREA SELECTION</p>
              <h3>Test everything inside one boundary</h3>
            </div>
            <p>
              Every category and required connection inside the shared area
              polygon is included. City Centre remains its own boundary.
            </p>
          </div>
          <div className="area-quiz-grid" role="group" aria-label="Quiz area">
            {areaGroups.map((group) => (
              <button
                type="button"
                className={group.id === areaGroup?.id ? "selected" : ""}
                aria-pressed={group.id === areaGroup?.id}
                onClick={() => setSelectedArea(group.id)}
                key={group.id}
              >
                <span>{group.label}</span>
                <b>
                  {group.directionTotals[direction].toLocaleString()} questions
                </b>
                <small>{group.recordCount.toLocaleString()} records · all categories</small>
              </button>
            ))}
          </div>
          {areaGroup && (
            <div className="area-quiz-summary" aria-live="polite">
              <div>
                <span>Selected boundary</span>
                <strong>{areaGroup.label}</strong>
              </div>
              <div>
                <span>{trackLabel}</span>
                <strong>
                  {areaGroup.directionTotals[direction].toLocaleString()} questions
                </strong>
              </div>
              <button
                type="button"
                className="primary"
                disabled={
                  !onStartArea || !areaGroup.directionTotals[direction]
                }
                onClick={() =>
                  onStartArea?.(
                    areaGroup.id,
                    `${trackLabel} · ${areaGroup.label} · all categories`,
                    direction,
                  )
                }
              >
                Start {areaGroup.label} quiz
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          className="quiz-mode-panel district-quiz-panel"
          id="district-quiz-panel"
          role="tabpanel"
          aria-labelledby="district-quiz-tab"
        >
          <div className="area-quiz-intro">
            <div>
              <p className="eyebrow">DISTRICT DEEP DIVE</p>
              <h3>Test everything assigned to one district</h3>
            </div>
            <p>
              Includes the district, places, main roads, and every other
              category spatially owned by that district—not only its four roads.
            </p>
          </div>
          {districtGroup ? (
            <>
              <label className="section-select district-select">
                <span>District</span>
                <select
                  value={districtGroup.id}
                  onChange={(event) => setSelectedDistrict(event.target.value)}
                >
                  {(["north", "east", "south", "west"] as const).map((area) => {
                    const groups = districtGroups.filter((group) => group.area === area);
                    return groups.length ? (
                      <optgroup label={groups[0].areaLabel} key={area}>
                        {groups.map((group) => (
                          <option value={group.id} key={group.id}>
                            {group.label} · {group.directionTotals[direction]} questions
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
              </label>
              <div className="area-quiz-summary" aria-live="polite">
                <div>
                  <span>Selected district</span>
                  <strong>{districtGroup.label} · {districtGroup.areaLabel}</strong>
                </div>
                <div>
                  <span>Full local coverage</span>
                  <strong>{districtGroup.recordCount} records across {districtGroup.categoryCount} categories</strong>
                </div>
                <button
                  type="button"
                  className="primary"
                  disabled={!onStartDistrict || !districtGroup.directionTotals[direction]}
                  onClick={() => onStartDistrict?.(
                    districtGroup.id,
                    `${trackLabel} · ${districtGroup.label} · all local categories`,
                    direction,
                  )}
                >
                  Start {districtGroup.label} quiz
                </button>
              </div>
            </>
          ) : (
            <p className="district-quiz-empty">District data is still loading.</p>
          )}
        </div>
      )}
    </section>
  );
}
