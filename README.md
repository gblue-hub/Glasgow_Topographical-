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
       data/generated/canonical-records.v1.json
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
   `data/decisions/coordinate-updates.v1.jsonl`;
4. silently rebuilds canonical and browser data for the next load; and
5. reports success only after the rebuild completes.

The current map updates in place, so the learner stays on the same question,
record, and scroll position. A later refresh shows the rebuilt value. Editing
the canonical JSON directly while the dev server is running still triggers a
rebuild and browser reload. Invalid source JSON produces a visible Vite error
instead of silently serving stale data.

Production is intentionally read-only because it is a static deployment.

## Product modes

- **Learn** — guided course review, correction rounds, maps, and mastery.
- **Practice** — focused section quizzes with two independent tracks:
  - **Recognition:** streets → category.
  - **Recall:** category → every associated street.
- **Mock Exam** — a strict, resumable, rotating 100-question assessment.
- **Final Assessment** — a strict, resumable test of every required
  record-level association.

Practice directions are never mixed in one session. Results and latest scores
are stored separately by direction because recall is deliberately harder than
recognition. Mock and Final results remain separate from learning mastery.

## Repository map

```text
src/          React UI and domain logic
server/       local-only coordinate persistence
data/
  source/     the single editable canonical taxi JSON and spatial inputs
  decisions/  coordinate audit and active map metadata
  generated/  reproducible intermediates (Git-ignored)
  reports/    reproducible validation evidence (Git-ignored)
scripts/      deterministic data builders and audits
public/data/  versioned browser artifacts
tests/        data-pipeline tests (UI/domain tests live beside src)
docs/         current application architecture
```

This is intentionally a single-package application root: runtime source,
canonical content, build tooling, and their tests are versioned together.
Internal agent instructions, rubrics, historical briefs, and superseded
contracts are isolated from the product tree and excluded from source control.

## Persistence

Learner progress is stored locally in IndexedDB through Dexie. The database
keeps attempts, mastery, learning sessions, mock/final sessions, submitted
results, and study aids in separate stores. Active learning and assessment
sessions are validated against the content and question-generator versions
before resume.

Browser progress is distinct from source-data editing:

- changing source data changes future generated content;
- completing a quiz changes only local learner progress; and
- mock results never alter learning mastery.

See [architecture.md](docs/architecture.md) for the current ownership
boundaries and data lifecycle.
