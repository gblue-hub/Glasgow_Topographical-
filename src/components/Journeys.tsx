export function Journeys() {
  return (
    <>
      <header className="page-head journeys-head">
        <div>
          <p>JOURNEY LEARNING</p>
          <h1>Explore a route. Then make every decision.</h1>
          <span>
            Journey exploration and route quizzes will share one reviewed route
            contract, so practice never teaches an invented path.
          </span>
        </div>
      </header>
      <section className="journey-preview" aria-label="Journey modes awaiting reviewed content">
        <article>
          <span>01 · EXPLORE</span>
          <h2>Trace the complete journey</h2>
          <p>See the reviewed origin, destination, road sequence, junctions and alternatives on the map.</p>
        </article>
        <article>
          <span>02 · DECIDE</span>
          <h2>Choose each road and turn</h2>
          <p>Recall the next named road and junction decision without premature route or answer leakage.</p>
        </article>
        <article>
          <span>03 · REPAIR</span>
          <h2>Find the first wrong move</h2>
          <p>Diagnose a route deviation, correct it and reverse a reviewed journey in the other direction.</p>
        </article>
      </section>
      <section className="journey-gate">
        <span className="gate-icon" aria-hidden="true">⌁</span>
        <div>
          <p className="eyebrow">REVIEWED CONTENT REQUIRED</p>
          <h2>Journey exercises are not unlocked yet</h2>
          <p>
            A publishable journey needs a reviewed origin and destination,
            ordered road links, junction decisions, direction and accepted
            alternatives. No such learning contract is currently shipped.
          </p>
        </div>
        <dl>
          <div><dt>Reviewed journeys</dt><dd>0</dd></div>
          <div><dt>Quiz-ready decisions</dt><dd>0</dd></div>
          <div><dt>Release state</dt><dd>Blocked</dd></div>
        </dl>
      </section>
    </>
  );
}
