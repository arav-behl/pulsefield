# Pulsefield schema contract

The schema is the product's audit spine. The UI is allowed to be expressive; the data contract must stay boring, explicit, and versioned.

## Record flow

HealthKit or export -> adapter -> observations -> features -> scores -> explanation and UI

The canonical JSON shape is in schema.json. A number only becomes meaningful when its unit, time window, inputs, algorithm, missing-data policy, and provenance are available.

## Four layers

| Layer | Meaning | Example |
| --- | --- | --- |
| Observation | Source fact | Apple HRV SDNN: 64 ms, or a bounded workout record |
| Feature | Derived fact | Sleep efficiency: 91% |
| Score | Transparent composition | Readiness proxy: 78/100 |
| Sync state | What the app actually knows | Complete, 14 types read, cursor advanced |

## Why this shape matters

- A contributor can trace a dashboard number back to source records.
- A model update can use a new algorithm version without rewriting history.
- Missing inputs remain visible instead of becoming zeros.
- Calibrating, missing, and available score components remain distinct.
- A native HealthKit adapter and browser export adapter can produce the same canonical records.
- Users can export their normalized data without exporting a proprietary database or sending it to a server.

## Sync contract

The future Swift adapter should expose one deep interface:

    syncSince(cursor) -> {
      observations,
      deletedObservationIds,
      nextCursor,
      typesRead,
      typesUnavailable,
      status
    }

The implementation owns HealthKit authorization, anchored queries, deduplication, revisions, deletions, and cursor persistence. The rest of Pulsefield only sees canonical observations. The cursor advances after the normalized write succeeds.

Important distinction:

- authorized: the user granted read permission.
- available: HealthKit returned records of that type.
- complete: the sync transaction committed successfully.

These are not interchangeable.

## User context

Ask only for facts that materially improve interpretation:

1. What are you optimizing right now: sleep, training, energy, or general awareness?
2. What is your usual sleep target?
3. Which timezone should define a day and assign an overnight sleep episode?
4. Which disclosed cardio-load reference profile should estimate workout load: male or female reference coefficients?

Store answers as versioned user context. Never infer them from the score. The first question changes emphasis and copy; the second changes sleep sufficiency; the third prevents date-boundary errors; the fourth selects and records the cardio-load coefficient pair.

## First native release

The static site cannot access HealthKit directly. A real sync experience needs either:

1. a SwiftUI companion that reads HealthKit and writes canonical JSON to a shared app container, or
2. a native wrapper with a Swift bridge and a local web view.

The website should still work without the companion through the export adapter. That keeps the open-source project useful on the web and makes the native bridge replaceable.
