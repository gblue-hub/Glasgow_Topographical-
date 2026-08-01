# Application architecture

## Boundaries

The repository has three explicit semantic layers:

1. **Spatial data** — the canonical dataset, spatial reference files,
   validation, topology, and browser geometry.
2. **Learning domain** — question generation, direction, scoring, mastery,
   scheduling, sessions, and assessment rules.
3. **Application** — React rendering, cloud persistence, map interaction,
   recovery, and development-only source editing.

UI components consume the domain layer; they do not redefine scoring,
question keys, or data classification.

## Data lifecycle

`content-source/glasgow-taxis.json` is the single editable content authority and
contains the current accepted data. The builder does not apply migration
ledgers, geocoding candidates, coordinate fixes, or old audit entries over
this file. It reads canonical coordinates exactly as authored and derives
only application metadata and road geometry references. The learning builder
adapts those records into compact backend contracts. The backend Docker image
builds them into `.content-build/course-content/` and serves them from
`/api/content/` beside the OSRM routing API. The React build contains no course
dataset files.

Generated files are outputs, not authoring surfaces. A generated-file edit is
discarded by the next build.

## Authentication and runtime persistence

Google authentication is mandatory. The application does not load course
content or learner state until Supabase has returned an authenticated session.
The authentication token is persisted by the Supabase client so a page refresh
does not force another login.

Supabase Postgres is the sole learner-state authority. The browser hydrates an
in-memory working set after login and writes every mutation directly to the
`learner_progress` table. No progress is stored in local storage or IndexedDB.
Rows are separated by meaning:

- attempts and mastery;
- guided-learning sessions and results;
- resumable route sessions, route attempts, and district-territory coverage;
- account appearance settings and personal, time-labelled map points. These are
  preserved when learning evidence is reset; the theme is also cached locally
  for immediate paint before cloud hydration. Sound defaults off and the
  motion preference defaults to the operating-system setting;
- mock/final sessions and submitted results;
- mock selection history; and
- user-authored study aids.

District polygons and their adjacency graph are generated together. Every
shared polygon seam must produce one `TerritoryStitch`: either a named link
crossing the seam, a named junction at the seam, or a pair of named boundary
approaches joined by routing infrastructure. Stitch road names are promoted
into both territories' target-road sets. This is a build-time invariant and a
runtime completion invariant, rather than a visual-map convention.

Every progress row is owned by `auth.uid()`. Postgres row-level security
allows authenticated learners to select, insert, update, or delete only their
own rows, and anonymous access is revoked. Deleting an authentication account
cascades to its progress.

Session restoration checks schema, content version, generator version,
question IDs, cursor position, and direction consistency. Incompatible
sessions are retired with a user-visible reason.

Route sessions additionally pin the OSRM extract and profile through a routing
version. Connector roads returned by OSRM are contextual route evidence; they
never create or mutate canonical exam associations.

The Career Map is a projection of existing evidence, not a second progress
ledger. Record, road, stitch, territory, rank, and competence-point states are
derived from attempts, mastery, route attempts, territory sign-off, and
readiness. Successful route attempts retain a simplified trace of at most 120
coordinates so the operational-city view can display learned fares without
persisting full OSRM responses. Layer rendering is zoom- and viewport-gated.

The daily learning UI adds transient shift briefing, map-tap, blind-recall,
confirmation, and debrief stages around the existing persisted question-stage
contract. Because those additions do not create a new resumable state, the
learning-session schema does not need to change. Skipping location or failing
blind recall marks the subsequent answer as assisted evidence.

Main-road (`middle_road`) records form the spine curriculum. Learning journeys
use each district territory's derived main-road approaches to frame outward
city-centre fares. During route work, the OSRM step sequence promotes every
matched main-road record into the ordered required-road set; only roads without
curriculum identity remain connectors. Personal timeline points are excluded
from scoring and question generation. They are compared with OSRM manoeuvre
locations only when rendering an optional stuck-state cue, producing a nearby
landmark, travel heading, and the next ordered left/right turns.

## Practice direction contract

Every required record has two record-level associations:

- `reverse` / `streets_to_category` — recognition;
- `forward` / `category_to_streets` — recall of the complete street set.

A focused Practice session declares exactly one direction. Direction is
persisted on the active session and result. Latest scores are indexed by
`section + direction`; a recognition result cannot replace a recall result.

## Assessment boundary

Mock Exam and Final Assessment share strict interaction rules but have
separate entry points, active sessions, result histories, and selection
strategies. Correctness is hidden until submission. The verified mock size is
100; timing, pass mark, and official selection rules remain unknown and must
not be invented.

## Coordinate-save transaction

The development endpoint serializes writes. It validates a stable record,
section, category, feature index, feature name, and coordinate pair before an
atomic source-file replacement. It then appends provenance and runs the full
data build. Generated-file changes are ignored by Vite's reload watcher, so
the current UI updates in place and keeps its active study state. The request
succeeds only if both persistence and regeneration succeed.

Direct canonical-source edits are watched in development. A valid edit
rebuilds and reloads the app; a failed build is surfaced through Vite.
