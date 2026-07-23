# Application architecture

## Boundaries

The repository has three explicit semantic layers:

1. **Spatial data** — the canonical dataset, spatial reference files,
   validation, topology, and browser geometry.
2. **Learning domain** — question generation, direction, scoring, mastery,
   scheduling, sessions, and assessment rules.
3. **Application** — React rendering, local persistence, map interaction,
   recovery, and development-only source editing.

UI components consume the domain layer; they do not redefine scoring,
question keys, or data classification.

## Data lifecycle

`data/source/glasgow-taxis.json` is the single editable content authority and
contains the current accepted data. The builder does not apply migration
ledgers, geocoding candidates, coordinate fixes, or old audit entries over
this file. It reads canonical coordinates exactly as authored and derives
only application metadata and road geometry references. The learning builder
adapts those records into the compact contracts served from `public/data/`.

Generated files are outputs, not authoring surfaces. A generated-file edit is
discarded by the next build.

## Runtime persistence

IndexedDB is local learner state, not content authority. Stores are separated
by meaning:

- attempts and mastery;
- guided-learning sessions and results;
- mock/final sessions and submitted results;
- mock selection history; and
- user-authored study aids.

Session restoration checks schema, content version, generator version,
question IDs, cursor position, and direction consistency. Incompatible
sessions are retired with a user-visible reason.

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
