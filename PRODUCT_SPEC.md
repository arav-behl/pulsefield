# Apple Watch WHOOP-Style Insights — Prototype Product Spec

**Status:** Prototype specification, v0.1  
**Date:** 2026-09-06  
**Prototype question:** Can we create useful, explainable Apple Watch versions of readiness, sleep quality, and training load without pretending they are WHOOP's exact scores?

## 1. Product thesis

Build a transparent Apple Health-native dashboard that turns Apple Watch data into three understandable signals:

1. **Readiness** — how far today's available signals are from the user's own recent baseline.
2. **Sleep score** — how much and how consistently the user slept relative to a target they control.
3. **Cardio load** — the cardiovascular work performed during workouts, calculated from heart-rate reserve and duration.

These should feel like the same category of product as WHOOP, but remain our own models. The product promise is:

> Personal training and sleep insights for Apple Watch, with every score explainable and every missing input visible.

The first prototype answers whether the model behaves sensibly under four synthetic situations: normal day, short sleep, hard training, and missing data.

## 2. Non-goals

- Reproducing WHOOP's private weights, filters, model versions, or exact score values.
- Calling an Apple SDNN value WHOOP RMSSD.
- Inferring muscular damage, soreness, stress, illness, or sleep disorders from HealthKit alone.
- Treating a score as medical advice or as a substitute for clinical measurement.
- Building a production HealthKit app in this iteration.

## 3. Design principles

1. **Personal baseline before population norms.** The product answers “different from your usual,” not “normal for everyone.”
2. **Explain every score.** Show the components, weights, baseline window, and data coverage.
3. **Missing is not zero.** A dead battery, charging period, denied permission, or absent sample is an unknown state.
4. **Source-aware calculations.** Preserve source, device, sample count, timestamp, and algorithm metadata.
5. **Separate measurement from interpretation.** Raw Apple Health trends remain visible beside derived scores.

## 4. Apple Health input contract

| Feature | HealthKit input | Prototype use | Quality gate |
|---|---|---|---|
| Heart rate | Heart-rate quantity samples | Workout cardio load; contextual trend | Workout duration and HR coverage must be visible |
| Resting heart rate | Resting-heart-rate quantity | Readiness component and baseline | Prefer Apple Watch source; preserve revisions |
| HRV | Heart-rate-variability SDNN quantity | Readiness component | Label SDNN in milliseconds; do not convert to RMSSD |
| Respiratory rate | Respiratory-rate quantity | Readiness context/component | Require a valid overnight value; wellness-only copy |
| Sleep | In-bed and asleep category intervals | Time asleep, time in bed, efficiency | Union and clip intervals; preserve unknown edges |
| Sleep stages | Core, deep, REM, unspecified | Stage-duration trends | Descriptive only; do not call a stage restorative |
| Wrist temperature | Sleeping wrist temperature | Contextual trend in v0 | Do not add to readiness weights initially |
| Blood oxygen | Oxygen-saturation quantity | Contextual trend when available | Model/region/permission gate; wellness-only |
| Workout | HKWorkout and associated samples | Duration, activity type, cardio load | Show source and HR coverage |

HealthKit availability is a runtime condition, not a promise that data exists. The production app must handle authorization, limited history, user edits/deletes, multiple sources, watch charging, and condensed samples.

## 5. Score architecture

The app should calculate raw features first, then scores, then confidence/state. Never make the score the primary stored fact.

~~~text
HealthKit samples
    -> nightly/workout feature extraction
    -> personal baseline + robust z-scores
    -> component scores
    -> weighted composite
    -> state + confidence + explanation
~~~

### 5.1 State machine

| State | Entry condition | UI behavior |
|---|---|---|
| Calibrating | Fewer than 14 valid baseline observations for a required metric | Show trends and history count; hide composite score |
| Insufficient data | Fewer than 3 readiness components, or no valid sleep episode for sleep score | Show individual inputs and the exact missing reason |
| Provisional | At least 3 components, but one component or coverage-quality gate is missing | Show score with “provisional” badge and component coverage |
| Scored | Four readiness components present, baselines mature, and coverage passes | Show composite score plus full explanation |

The state is part of the result. A number without its state is not a valid product output.

## 6. Personal baseline model

For each metric, use the previous 28 valid days or nights, excluding the current observation:

~~~text
baseline = median(previous 28 valid values)
scale = 1.4826 * MAD(previous 28 valid values)
z = clamp((current - baseline) / scale, -3, +3)
~~~

If MAD is zero, use a non-zero IQR-derived fallback. If there are fewer than 14 valid observations or no usable scale, return Calibrating. Keep the baseline count in the UI.

This is intentionally robust: one illness night, unusual workout, or edited sample should not move the baseline as much as a mean-based model would.

## 7. Sleep score

### Inputs

- In-bed intervals.
- Asleep intervals: Core, Deep, REM, and Unspecified.
- User-configured sleep target, defaulting to 8 hours only as a product setting—not as a medical claim.
- Sleep onset and wake time from the current and previous 7–14 valid nights.

### Feature calculations

~~~text
time_in_bed = duration(union(inBed intervals))
time_asleep = duration(union(asleep intervals))
sleep_efficiency = clamp(100 * time_asleep / time_in_bed, 0, 100)
sleep_sufficiency = clamp(100 * time_asleep / user_sleep_target, 0, 100)

timing_consistency =
  100 * (1 - clamp(
    mean(onset_MAD_minutes, wake_MAD_minutes) / 120,
    0,
    1
  ))
~~~

Clip stage intervals to the in-bed interval and union overlapping samples so time is not double-counted. Assign a sleep episode to the wake date. Missing detail at the beginning or end of an Apple Watch sleep episode is unknown, not awake.

### v0 weighting

~~~text
sleep_score =
  0.50 * sleep_sufficiency
  + 0.30 * sleep_efficiency
  + 0.20 * timing_consistency
~~~

Stage minutes are shown separately. v0 does not add a “restorative sleep” bonus or penalty. A stage percentage can be useful as a trend, but it is not a clinical sleep-quality measurement.

## 8. Readiness score

Readiness is a baseline-relative wellness proxy. Component scores are centered near 70 for a typical baseline day, not 50, so the dashboard does not make “usual” look mediocre.

~~~text
hrv_score  = clamp(70 + 10 * z_HRV_SDNN, 0, 100)
rhr_score  = clamp(70 - 10 * z_RHR, 0, 100)
rr_score   = clamp(70 - 10 * abs(z_respiratory_rate), 0, 100)

readiness =
  weighted_mean(
    sleep_score: 0.40,
    hrv_score:   0.30,
    rhr_score:   0.20,
    rr_score:    0.10
  )
~~~

The weights are ours, chosen for a conservative v0:

- Sleep gets 40% because it is directly relevant to readiness and can be explained with duration, efficiency, and timing.
- SDNN HRV gets 30% because it is sensitive to within-person changes, but remains context-dependent.
- Resting heart rate gets 20% as a complementary cardiovascular signal.
- Respiratory rate gets 10% as a low-weight contextual signal.

Temperature and SpO2 are displayed as context in v0. They are not silently added to the score because coverage, model/region availability, and user interpretation vary too much.

If one component is missing, renormalize only across the available weights and mark the result Provisional. Do not fill a missing component with baseline, zero, or a population average.

### Confidence

Confidence is separate from readiness:

~~~text
component_coverage = sum(weights for available components)
baseline_maturity = min(1, median(valid_baseline_count / 28))
confidence = 100 * (0.60 * component_coverage + 0.40 * baseline_maturity)
~~~

The UI should say, for example: “Readiness 78 — provisional; 3/4 inputs; 22 baseline nights.” Confidence does not mean medical accuracy. It means the score had enough of the product's defined inputs to be interpretable.

## 9. Cardio load

Cardio load is the transparent substitute for the cardiovascular part of a strain-style metric. It is not WHOOP Strain and does not include muscular load.

For each heart-rate interval inside a workout, with duration d in minutes:

~~~text
r = clamp((HR - HR_rest) / (HR_max - HR_rest), 0, 1)
interval_load = d * r * reserve_coefficient * exp(intensity_coefficient * r)
cardio_load_raw = sum(interval_load)
~~~

The default male reference uses `reserve_coefficient = 0.64` and `intensity_coefficient = 1.92`. The optional female reference uses `0.86` and `1.67`. The selected reference is explicit user context and is recorded in `metadata.cardioLoad`; it is a modeling choice, not a medical classification or an inference about identity.

Rules:

1. Prefer time-weighted heart-rate samples or intervals.
2. If only workout-average HR exists, calculate an approximate result and label it.
3. Use measured or user-configured HRmax. Do not silently replace it with 220 minus age.
4. Show raw load units, workout duration, HR coverage, and a 28-day personal percentile.
5. Do not map raw load to WHOOP's 0–21 scale in v0.

After at least 14 valid workout days, show a personal load band based on the user's own distribution: Low below the 50th percentile, Moderate from the 50th to 75th, High from the 75th to 90th, and Very high above the 90th. The labels describe the user's history, not universal training zones.

One-minute heart-rate recovery is a separate trend. Do not add it to cardio load until workouts and recovery protocols are stratified.

## 10. Data model

The production implementation should store or derive these records:

### DailyFeatures

- Local date and timezone.
- Sleep start/end, time in bed, time asleep, sleep score.
- HRV SDNN, RHR, respiratory rate, wrist temperature, SpO2.
- Component values, baselines, robust scales, z-scores, and valid-counts.
- Readiness score, state, confidence, and explanation.
- Source revision/device identifiers and sample counts.

### WorkoutFeatures

- Workout UUID, source/device, activity type, start/end, duration.
- HR sample count, observed span, coverage ratio, and gap flags.
- HRrest, HRmax, cardio_load_raw, approximation flag, personal percentile.
- One-minute HR recovery when available.

Keep raw HealthKit UUIDs and provenance long enough to reconcile deletions and source changes. Derived values should be reproducible from the current data and model version.

## 11. Prototype screens

1. **Today:** readiness score, state badge, confidence, three strongest contributors, and missing-input explanation.
2. **Sleep:** interval timeline, sleep score components, stage trend, target setting, and edge-coverage warning.
3. **Load:** recent workouts, raw cardio load, HR coverage, personal percentile, and recovery trend.
4. **Trends:** 28-day charts for HRV SDNN, RHR, respiratory rate, sleep, load, and baseline shifts.

Every composite score should have an “Why?” panel that shows the formula version, component values, weights, and data coverage.

## 12. Validation plan

### Phase A — synthetic behavior checks (1 day)

Use the included prototype runner to confirm:

- Better sleep and favorable baseline deviations increase readiness.
- A large RHR increase, HRV decrease, and respiratory deviation reduce readiness.
- A missing component produces Provisional, not a fake full-confidence score.
- Higher workout intensity or duration increases cardio load monotonically.

### Phase B — personal dogfood (2–4 weeks)

Log a one-minute morning label: readiness from 1–5, sleep quality from 1–5, soreness, and intended workout. Keep the model weights fixed during the first week. Inspect whether the score is stable, interpretable, and directionally useful.

### Phase C — outcome validation (4–8 weeks)

Compare scores against perceived exertion, completed workout quality, missed sessions, and sleep quality. If a user also has WHOOP, compare direction and timing as a reference—not as ground truth. Test each component with ablation: sleep only, sleep plus HRV, then the full model.

Do not optimize weights to match WHOOP scores unless the product goal explicitly changes to score imitation. For a health product, predicting useful personal outcomes is the stronger target.

### Minimum acceptance criteria

- No score is produced during calibration or insufficient-data states.
- Missingness never becomes zero sleep, zero load, or “excellent recovery.”
- Component explanations reconcile numerically to the displayed score.
- Re-running the same inputs with the same model version produces the same result.
- Users can see source, sample count, coverage, and baseline history.

## 13. Implementation sequence

1. **Prototype now (1–2 hours):** run synthetic scenarios and adjust weights only when a behavior rule fails.
2. **HealthKit ingestion (2–4 days):** authorization, queries, provenance, interval union, anchored updates, and deletion reconciliation.
3. **First UI (3–5 days):** Today, Sleep, Load, and Trends screens with explanations and coverage.
4. **Dogfood calibration (2–4 weeks):** collect self-reported labels before changing weights.

Do not start with a black-box optimizer. A small, stable, explainable model will produce better learning and make the eventual improvements scientifically traceable.

## 14. Decisions to revisit after v0

1. Whether sleep target should be fixed by the user or learned from longitudinal behavior.
2. Whether a daily load score should include non-workout heart-rate elevation.
3. Whether overnight heartbeat series are available often enough to support RMSSD as a separate Apple metric.
4. Whether temperature and SpO2 add predictive value beyond missingness and user context.
5. Whether the product should expose a normalized 0–100 load index after enough personal history.

## Bottom line

The first credible version is not “WHOOP, copied.” It is an Apple Watch-native model with comparable user-facing concepts, explicit assumptions, transparent weights, and visible uncertainty. The included prototype is the fastest way to find out whether those rules feel scientifically and product-wise coherent before building HealthKit infrastructure.
