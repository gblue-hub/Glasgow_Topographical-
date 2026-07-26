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

`data/source/glasgow-taxis.json`

Do not create an app-specific copy. The application never reads source JSON
directly. It reads reproducible browser artifacts in `public/data/`, built by:

```text
canonical source + spatial sources
                    ↓
        scripts/data/build-canonical.mjs
                    ↓
        .agents/generated/canonical-records.json
                    ↓
      scripts/app/build-learning-content.mjs
                    ↓
                 public/data
```

`npm run data:prepare` runs that complete chain.

### Editing coordinates in the app

The map editor is available only in local development. A successful save:

1. validates the record and feature identity;
2. atomically updates `data/source/glasgow-taxis.json`;
3. appends an audit entry to
   `.agents/coordinate-updates.jsonl`;
4. silently rebuilds canonical and browser data for the next load; and
5. reports success only after the rebuild completes.

The current map updates in place, so the learner stays on the same question,
record, and scroll position. A later refresh shows the rebuilt value. Editing
the canonical JSON directly while the dev server is running still triggers a
rebuild and browser reload. Invalid source JSON produces a visible Vite error
instead of silently serving stale data.

Production is intentionally read-only because it is a static deployment.

## Product modes

- **Learn** — guided course review and focused section quizzes with two
  independent tracks:
  - **Recognition:** streets → category.
  - **Recall:** category → every associated street.
- **Explore** — read-only answers, maps, roads, and journey material.
- **Mock Exam** — a strict, resumable, rotating 100-question assessment, with
  an optional full-bank assessment for every required record-level association.
- **Progress** — mastery totals, directional feedback, and recurring slips.

Practice directions are never mixed in one session. Results and latest scores
are stored separately by direction because recall is deliberately harder than
recognition. Mock results do not change learning mastery; the optional
full-bank assessment contributes explicit mastery evidence.

## Repository map

```text
src/          React UI and domain logic
server/       local-only coordinate persistence
data/
  source/     the single editable canonical taxi JSON and spatial inputs
  osrm/       routing service deployment inputs
config/data/  active map aliases and road-binding policy
.agents/
  coordinate-updates.jsonl  local coordinate-edit audit
  generated/  reproducible build intermediates (Git-ignored)
  reports/    reproducible validation evidence (Git-ignored)
  logs/       local assistant and diagnostic logs (Git-ignored)
scripts/      deterministic data builders and audits
public/data/  current browser artifacts (Git-ignored)
tests/        data-pipeline tests (UI/domain tests live beside src)
docs/         current application architecture
```

This is intentionally a single-package application root: runtime source,
canonical content, build tooling, and their tests are versioned together.
Local assistant state, diagnostic logs, generated reports, and build
intermediates live under `.agents/` and are excluded from source control.

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

1. Create a Supabase project and run
   `supabase/migrations/202607260001_learner_progress.sql` in its SQL editor.
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
