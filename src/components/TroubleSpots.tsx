import { useMemo, useState } from "react";
import type { TroubleKind, TroubleSpot } from "../domain/trouble-spots";
import type { Section } from "../domain/types";

type Props = {
  spots: TroubleSpot[];
  sections: Section[];
  onPractice: (associationIds: string[]) => void;
};

const labels: Record<TroubleKind, { title: string; description: string }> = {
  recurring_slip: {
    title: "Recurring slips",
    description: "You know these, but they have escaped you more than once.",
  },
  one_off_slip: {
    title: "One-off slips",
    description: "Mostly correct so far, with one recorded miss.",
  },
  not_yet_secure: {
    title: "Not yet secure",
    description: "Attempted, but not answered correctly yet.",
  },
};

export function TroubleSpots({ spots, sections, onPractice }: Props) {
  const [sectionCode, setSectionCode] = useState("");
  const availableSections = useMemo(
    () => sections.filter((section) => spots.some((spot) => spot.association.section_code === section.code)),
    [sections, spots],
  );
  const visible = sectionCode
    ? spots.filter((spot) => spot.association.section_code === sectionCode)
    : spots;
  const fragile = visible;
  return (
    <>
      <header className="page-head trouble-head">
        <div>
          <p>SLIPS</p>
          <h1>Catch the small mistakes costing you marks.</h1>
          <span>
            Correct answers still count. This view isolates only the exact
            associations that have slipped.
          </span>
        </div>
        {!!fragile.length && (
          <button
            className="primary"
            onClick={() => onPractice(fragile.map((spot) => spot.association.id))}
          >
            Practise {fragile.length} stragglers
          </button>
        )}
      </header>
      <section className="slips-filter" aria-label="Filter slips by section">
        <div>
          <label htmlFor="slips-section">Section</label>
          <select
            id="slips-section"
            value={sectionCode}
            onChange={(event) => setSectionCode(event.target.value)}
          >
            <option value="">All sections with slips</option>
            {availableSections.map((section) => (
              <option value={section.code} key={section.code}>
                {section.name}
              </option>
            ))}
          </select>
        </div>
        <p>
          {sectionCode
            ? `${visible.length} recorded problem associations in this section.`
            : `${visible.length} recorded problem associations across the course.`}
        </p>
      </section>
      <section className="stats" aria-label="Trouble spot summary">
        <article>
          <span>Recurring slips</span>
          <b>{visible.filter((spot) => spot.kind === "recurring_slip").length}</b>
        </article>
        <article>
          <span>One-off slips</span>
          <b>{visible.filter((spot) => spot.kind === "one_off_slip").length}</b>
        </article>
        <article>
          <span>Not yet secure</span>
          <b>{visible.filter((spot) => spot.kind === "not_yet_secure").length}</b>
        </article>
      </section>
      {!visible.length ? (
        <section className="panel trouble-empty">
          <h2>No recorded trouble spots yet</h2>
          <p>Mistakes from section tests will appear here automatically.</p>
        </section>
      ) : (
        (Object.keys(labels) as TroubleKind[]).map((kind) => {
          const matching = visible.filter((spot) => spot.kind === kind);
          if (!matching.length) return null;
          return (
            <section className="trouble-group" key={kind}>
              <div className="trouble-group-head">
                <div>
                  <h2>{labels[kind].title}</h2>
                  <p>{labels[kind].description}</p>
                </div>
                <button
                  className="link"
                  onClick={() => onPractice(matching.map((spot) => spot.association.id))}
                >
                  Practise this group
                </button>
              </div>
              <div className="trouble-list">
                {matching.map((spot) => (
                  <article key={spot.association.id}>
                    <div className="trouble-copy">
                      <small>{spot.association.section_code} · {spot.association.scope === "street" ? "Single street association" : spot.association.direction === "forward" ? "Entry to streets" : "Streets to entry"}</small>
                      <h3>{spot.association.prompt}</h3>
                      <p>Exact answer: <b>{spot.association.answer}</b></p>
                    </div>
                    <div className="attempt-history" aria-label="Five most recent results">
                      {spot.recentResults.map((correct, index) => (
                        <i className={correct ? "hit" : "miss"} key={index} title={correct ? "Correct" : "Incorrect"} />
                      ))}
                    </div>
                    <div className="trouble-counts">
                      <span><b>{spot.correctAttempts}</b> right</span>
                      <span><b>{spot.incorrectAttempts}</b> wrong</span>
                    </div>
                    <button
                      className="link"
                      onClick={() => onPractice([spot.association.id])}
                    >
                      Practise this
                    </button>
                  </article>
                ))}
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
