# Pulsefield domain context

## Purpose

Pulsefield turns Apple Health records into private, explainable personal trends. It is a wellness interpretation layer, not a medical device and not a WHOOP replica.

## Canonical terms

### Observation

One source record as received from HealthKit or an import. An observation is never silently changed into a score. It retains its source, device, unit, timestamps, and source identifier.

### Feature

A reproducible value derived from one or more observations within a declared time window. Examples: time asleep, sleep efficiency, HRV SDNN baseline deviation, heart-rate coverage.

### Baseline

A personal reference distribution built from prior valid features. The current day is excluded from its own baseline. A baseline has a window, valid-count, center, scale, and model version.

### Score

A transparent composition of features and/or components. Every score records its inputs, weights, formula, missing-data policy, and confidence/state.

### Signal state

The interpretability state of a score: calibrating, insufficient_data, provisional, or scored. A score without a signal state is incomplete.

### Provenance

The evidence needed to trace a value back to its source records: source revision, device, record identifiers, query/import time, sample count, and transformation version.

### Sync

A native HealthKit adapter querying records since a stored cursor, normalizing them into observations, reconciling deletions and revisions, and advancing the cursor only after a successful write. A browser export import is a separate adapter.

### User context

Small, user-provided facts that change interpretation: sleep target, timezone, age range when needed for configuration, training goal, and known constraints. Context is not inferred from a score.

## Invariants

1. Missing data is missing or unknown, never zero.
2. A displayed score must link to its feature inputs and provenance.
3. Apple HRV remains SDNN; it must not be renamed or converted to WHOOP-style RMSSD.
4. Raw observations remain inspectable beside derived features.
5. Model changes create a new modelVersion; old results remain reproducible.
6. HealthKit authorization and data availability are separate states.
7. “Sync complete” means the query committed successfully, not that every HealthKit type exists.

## Product language

Use readiness proxy, sleep score, and cardio load. Avoid Recovery Score, Strain, diagnosis, illness detection, or claims of medical accuracy.
