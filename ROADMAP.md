# Pulsefield end-to-end roadmap

## Release targets

### Personal MVB

Goal: import one real Apple Health export, inspect the normalized records, and trust the numbers enough to use the dashboard for a week.

Required:

- ZIP upload with local extraction.
- Canonical observations validated against schema.json.
- Sleep, HRV SDNN, resting heart rate, respiratory rate, activity, and workout normalization.
- Daily/nightly aggregation with timezone-aware sleep episodes.
- Readiness proxy, sleep score, and cardio load with formulas and missing-data states.
- Every score has an audit trail.
- Browser persistence and a delete/reset control.

Not required:

- Apple login.
- Native sync.
- Backend.
- AI interpretation.
- Population comparisons.

### Public beta

Goal: another Apple Watch user can understand and use it without the author present.

Required:

- Clear first-run onboarding.
- Import progress, unsupported-type report, and data-quality summary.
- Fixture-based tests for overlaps, revisions, timezone boundaries, missing data, and duplicate samples.
- Privacy documentation and a reproducible local-only demo.
- License, contribution guide, issue templates, screenshots, and a sample dataset.

### Native sync

Goal: after one-time HealthKit authorization, the user taps Sync and only new/deleted data is reconciled.

Required:

- SwiftUI companion with HealthKit entitlements and fine-grained read permissions.
- One adapter interface for anchored sample queries.
- Cursor persistence only after a successful normalized write.
- Deleted-object handling and idempotent upserts.
- Observer/background delivery as a wake-up signal, followed by anchored reconciliation.
- A bridge that passes canonical JSON to the web UI or writes to a shared local store.

## Build sequence

### 1. Make the real export path work

Implement ZIP detection and local extraction. Apple exports Health data in XML; the app should accept the ZIP, locate export.xml, and never upload it. Stream or worker-parse large files so the page stays responsive.

Acceptance test: a personal export produces a manifest containing file name, date range, record count, supported types, unsupported types, and parse warnings.

### 2. Make the schema executable

Normalize every supported HealthKit record into an observation with:

- stable ID and source record ID;
- kind, value, unit, start, end;
- source revision and device;
- quality and query/import metadata.

Validate the dataset before calculating features. Unknown fields can be preserved in adapter metadata, but the canonical fields cannot be ambiguous.

Acceptance test: the same XML imported twice produces the same IDs and no duplicate observations.

### 3. Build feature extraction before scores

Implement and test:

- unioned sleep intervals;
- sleep episode assignment by wake date and timezone;
- sleep duration, time in bed, efficiency, stage totals, and timing consistency;
- personal baselines using median and MAD;
- HRV SDNN, resting-heart-rate, and respiratory-rate deviations;
- workout heart-rate coverage and cardio load.

Acceptance test: every feature lists its input observation IDs, window, unit, algorithm version, and missing reason when unavailable.

### 4. Make the dashboard explain itself

Replace demo-only values with the canonical dataset. Add:

- import progress and sync state;
- calibration and insufficient-data states;
- “why this number?” drill-down;
- data coverage by metric;
- export normalized JSON;
- delete all local data.

Acceptance test: a user can select a score and trace it from score → components → features → observations → source metadata.

### 5. Run the personal MVB loop

Use the app for 7–14 days. Keep a short log:

- Did the data import successfully?
- Did the sleep episode dates look right?
- Did any values look obviously wrong?
- Did the explanation change what you did?
- Which metric did you return to?

Do not change weights every day. First fix incorrect data, then confusing explanations, then model behavior.

### 6. Build native sync only after import is trustworthy

Create a minimal SwiftUI companion, not a full social app. It should request HealthKit access, run anchored queries, store anchors securely, normalize records, and hand the canonical dataset to the existing calculation layer.

The website remains useful without the companion. That keeps the open-source project accessible and makes the native adapter replaceable.

### 7. Prepare the public repository

- Choose an OSI-approved license.
- Add a privacy threat model and data-flow diagram.
- Add a contribution guide and code of conduct.
- Add CI for schema validation, parser fixtures, model tests, and linting.
- Publish a synthetic dataset, not personal Health data.
- Add a one-minute demo GIF or screenshot.
- Add a “what this is not” section covering medical claims and WHOOP parity.

### 8. Launch with a narrow promise

Recommended launch message:

> Your Apple Health data, visualized privately in your browser. Every number shows its source and uncertainty.

Ask early users for exports and feedback on import correctness, not for more features. The first public success metric should be “time from export to useful insight,” not stars alone.

## Explicitly defer

- Accounts and cloud storage.
- Social leaderboards.
- AI health advice.
- Exact WHOOP score replication.
- Medical or illness detection.
- Dozens of metrics before the first three are trusted.
