# Pulsefield review rules

## Health data and privacy

- Raw Apple Health exports must remain local to the browser unless the user explicitly chooses an external sync path.
- Never add telemetry, advertising, third-party analytics, or secret-bearing code around health data without an explicit product decision and privacy review.
- Keep wellness language separate from medical claims. Do not present readiness, sleep, cardio load, HRV, respiratory rate, temperature, or oxygen saturation as a diagnosis or treatment recommendation.

## Data correctness

- Preserve source identifiers, source/device metadata, units, timestamps, time zones, and algorithm versions wherever data is normalized or derived.
- Missing, unavailable, unauthorized, sparse, or low-quality data must stay distinguishable from a numeric zero.
- Deduplicate and reconcile revisions/deletions deterministically. Do not silently average conflicting source measurements.
- Union overlapping sleep intervals and avoid double-counting stage or workout intervals.
- Keep Apple Health SDNN distinct from WHOOP RMSSD; never convert one into the other with a fixed multiplier.

## Product contract

- Every displayed score must be traceable to observations, features, a time window, a missing-data policy, and a formula or algorithm version.
- Do not claim parity with proprietary WHOOP Recovery, Strain, Sleep Performance, Sleep Need, or Sleep Stress metrics.
- Preserve the canonical flow: export or HealthKit adapter -> observations -> features -> scores -> explanations and UI.
- Keep demo fixtures clearly separated from imported personal data and do not use personal health data in committed fixtures.

## Front-end changes

- Keep the import path responsive for large Apple Health exports and avoid unnecessary copies of raw XML or ZIP contents.
- Validate untrusted imported content defensively and avoid unsafe HTML injection.
- Prefer accessible controls, visible import progress, and clear calibration/coverage states over opaque loading or score changes.
