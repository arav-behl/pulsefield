# Pulsefield

**Your Apple Health data, explained privately.**

Pulsefield is an open-source, local-first companion for Apple Watch users who want to see the patterns hidden inside HealthKit: sleep, personal recovery signals, movement, and workout cardio load.

The project is intentionally schema-first. Every displayed number should be traceable to source observations, a time window, units, missing-data handling, provenance, and a versioned algorithm.

## What exists today

- A browser dashboard with synthetic demo data.
- A local Apple Health ZIP/XML/JSON import path that streams large exports in the browser.
- A canonical auditable dataset contract in schema.json.
- A domain glossary and sync contract in CONTEXT.md and SCHEMA.md.
- Transparent prototype formulas in PRODUCT_SPEC.md and prototype_healthkit_model.py.
- A context setup flow for goal, sleep target, and timezone.
- An audit panel that shows how a score is assembled.

Open index.html directly, or run:

    python3 -m http.server 8080

Then visit http://localhost:8080.

## The important platform constraint

A normal website cannot directly request Apple HealthKit data. The browser build therefore supports local export/import. The intended one-tap sync experience needs a small SwiftUI companion or native wrapper:

    HealthKit adapter -> canonical observations -> features -> scores -> dashboard

The native adapter should remember authorization, query only changes since its last successful cursor, reconcile deletions and revisions, and commit a canonical dataset before advancing that cursor.

## Product language

Pulsefield uses:

- readiness proxy for a personal baseline-relative wellness signal;
- sleep score for a transparent user-target-based heuristic;
- cardio load for heart-rate-based workout load.

It does not claim to reproduce WHOOP Recovery or Strain. WHOOP's complete weights and processing pipeline are proprietary, and Apple exposes SDNN HRV rather than WHOOP's overnight RMSSD. See RESEARCH.md for the source-backed comparison.

## Privacy and safety

- Raw data stays in the browser in this prototype.
- Missing data is never silently treated as zero.
- HealthKit authorization, data availability, and sync completion are separate states.
- Scores are wellness trends, not diagnoses or medical advice.

## Name

The working project name is **Pulsefield**: a field of personal signals that becomes more useful when you can see its shape over time. Before publishing, check GitHub, npm, domains, and trademarks.
