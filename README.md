# Glasgow Taxi Learning Platform

One application, one data source, one build pipeline.

## Start here

Requirements: Node 22.12–22.x.

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite. Development startup validates and rebuilds
the learning data before the app opens.

Useful checks:

```powershell
npm test
npm run lint
npm run build
```

## The source of truth

The examinable dataset has one writable canonical source:

`content-source/glasgow-taxis.json`

Do not create an app-specific copy. The application never reads source JSON
directly. It reads reproducible contracts from the backend service:

```text
canonical source + spatial sources
                    ↓
        scripts/data/build-canonical.mjs
                    ↓
      .content-build/canonical/canonical-records.json
                    ↓
      scripts/app/build-learning-content.mjs
                    ↓
       .content-build/course-content
                    ↓
       backend /api/content/*
```

`npm run data:prepare` runs that complete chain.

### Editing coordinates in the app

The map editor is available only in local development. A successful save:

1. validates the record and feature identity;
2. atomically updates `content-source/glasgow-taxis.json`;
3. appends an audit entry to
   `content-source/coordinate-updates.jsonl`;
4. silently rebuilds canonical and browser data for the next load; and
5. reports success only after the rebuild completes.

The current map updates in place, so the learner stays on the same question,
record, and scroll position. A later refresh shows the rebuilt value. Editing
the canonical JSON directly while the dev server is running still triggers a
rebuild and browser reload. Invalid source JSON produces a visible Vite error
instead of silently serving stale data.

Production editing is intentionally disabled. The React frontend is a static
deployment, while course content and routing are served by the backend
container and learner progress is stored in Supabase.

## Product modes

- **Learn** — game-like taxi shifts organised around real journeys. A shift
  briefs the fare, explores its geography, asks the learner to place selected
  targets on a city map, requires blind recall before choices, and ends with a
  debrief. Adaptive review still maintains two independent tracks:
  independent tracks:
  - **Recognition:** streets → category.
  - **Recall:** category → every associated street.
- **Route Lab** — free route construction where learners place important
  curriculum roads and OSRM supplies non-tested connectors.
- **Knowledge Atlas** — read-only places, exact answers, district territory
  maps, and the street atlas.
- **Checkpoints** — territory route checkpoints plus a strict, resumable,
  rotating 100-question mock assessment, with
  an optional full-bank assessment for every required record-level association.
- **Progress** — a Career Map that clears its fog only from evidence: learned
  districts, stitch roads, successful fare traces, destinations, and personal
  points. Competence points and taxi ranks are awarded once for demonstrated
  skill, not for repeatedly opening or completing cards. Directional feedback
  and recurring slips remain available alongside it.
- **Settings** — persistent light/dark appearance, hard-confirmed learning-data
  deletion, opt-in sound, system/full/reduced motion, product-only
  premium/difficulty previews, and a personal Glasgow timeline whose points
  become Route Lab endpoints.

Practice directions are never mixed in one session. Results and latest scores
are stored separately by direction because recall is deliberately harder than
recognition. Mock results do not change learning mastery; the optional
full-bank assessment contributes explicit mastery evidence.

District territories are derived learning boundaries, not official
administrative polygons. Each combines its four examinable district streets
with nearby destinations, main-road approaches, neighbouring districts, and
OSRM route evidence. Completion requires factual mastery, target-road coverage,
and three distinct successful checkpoint fares. Checkpoints mix local joins
with cross-city work, validate learned start/end roads against OSRM steps, and
leave motorway or unnamed infrastructure as visible automatic connectors.

Daily shifts follow `explore → do → recall → confirm → debrief`. Multiple
choice is confirmation rather than the first learning act: a mismatched or
skipped blind recall is treated as assisted evidence and scheduled to return.
Question distractors favour nearby records of the same kind and a similar
answer shape, avoiding obviously unrelated choices.

The content build publishes the tessellated polygon itself and a road-backed
stitch for every shared district seam. A stitch records both districts, its
road links, its crossing or handover point, and the named entry road on each
side. Direct roads, named-road junctions, and paired boundary approaches are
kept distinct. The build fails if any touching pair has no stitch, and district
sign-off requires successful route evidence for every stitch-road name.

## Repository map

```text
src/          React UI, domain logic, and runtime service adapters
content-source/  editable canonical taxi JSON, spatial input, and edit audit
server/       local coordinate persistence and the backend Docker service
config/data/  active map aliases and road-binding policy
.content-build/  reproducible backend contracts and reports (Git-ignored)
scripts/      deterministic data builders and audits
public/       frontend-only static assets; no course datasets
tests/        data-pipeline tests (UI/domain tests live beside src)
docs/         current application architecture
```

This is intentionally a single-package application root: runtime source,
canonical content, build tooling, and their tests are versioned together.
Local backend contracts and reports live under `.content-build/` and are
excluded from source control. `.agents/` is reserved for assistant state only.

## Persistence

Google sign-in is required before the course opens. Learner progress is stored
in Supabase Postgres and protected by row-level security. The browser keeps
only an in-memory working copy while the app is open; it does not keep learner
progress in local storage or IndexedDB. An internet connection is therefore
required for learning and assessment activity.

The cloud progress record keeps attempts, mastery, learning sessions,
mock/final sessions, submitted results, question rotation history, and study
aids as independently addressable rows. Active learning and assessment
sessions are validated against the content and question-generator versions
before resume.

Cloud progress is distinct from source-data editing:

- changing source data changes future generated content;
- completing a quiz changes only the signed-in learner's progress; and
- mock results never alter learning mastery.

### Supabase and Google sign-in setup

1. Create a Supabase project and run every SQL file in
   `supabase/migrations/` in filename order. The latest migration adds route
   attempts, resumable route sessions, and territory progress.
2. Enable the Google provider in Supabase Authentication.
3. Create a Google web OAuth client and add the Supabase callback URL shown by
   the provider setup.
4. Add local and production URLs to the Supabase redirect allow list.
5. Copy `.env.example` to `.env.local` for local development and supply the
   Supabase project URL and publishable key.
6. In Render, set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` on the static web service before deploying.

The publishable key is intentionally used by the browser. Never place a
Supabase service-role key in Vite or Render build variables.

See [architecture.md](docs/architecture.md) for the current ownership
boundaries and data lifecycle.
