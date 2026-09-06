#!/usr/bin/env python3
"""
THROWAWAY PROTOTYPE — Apple Watch WHOOP-style insight model.

Question answered:
    Do the proposed readiness, sleep, cardio-load, and data-state rules behave
    sensibly before we connect real HealthKit data?

Run:
    python3 prototype_healthkit_model.py

This file uses synthetic data only, keeps everything in memory, and is not
production code.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import exp
from statistics import median
from typing import Optional


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def mad(values: list[float], center: Optional[float] = None) -> float:
    middle = median(values) if center is None else center
    return median([abs(value - middle) for value in values])


def robust_z(value: Optional[float], history: list[float]) -> Optional[float]:
    if value is None or len(history) < 14:
        return None
    center = median(history[-28:])
    scale = 1.4826 * mad(history[-28:], center)
    if scale == 0:
        ordered = sorted(history[-28:])
        q1 = ordered[len(ordered) // 4]
        q3 = ordered[(len(ordered) * 3) // 4]
        scale = (q3 - q1) / 1.349
    if scale == 0:
        return None
    return clamp((value - center) / scale, -3, 3)


def sleep_score(
    time_asleep_hours: float,
    time_in_bed_hours: float,
    target_hours: float,
    timing_consistency: float,
) -> dict[str, float]:
    efficiency = clamp(100 * time_asleep_hours / time_in_bed_hours, 0, 100)
    sufficiency = clamp(100 * time_asleep_hours / target_hours, 0, 100)
    score = 0.50 * sufficiency + 0.30 * efficiency + 0.20 * timing_consistency
    return {
        "sleep_sufficiency": round(sufficiency, 1),
        "sleep_efficiency": round(efficiency, 1),
        "timing_consistency": round(timing_consistency, 1),
        "sleep_score": round(score, 1),
    }


def readiness_score(
    sleep: Optional[float],
    hrv_z: Optional[float],
    rhr_z: Optional[float],
    respiratory_z: Optional[float],
    baseline_counts: list[int],
) -> dict[str, object]:
    components: dict[str, tuple[float, float]] = {}
    if sleep is not None:
        components["sleep"] = (sleep, 0.40)
    if hrv_z is not None:
        components["hrv_sdnn"] = (clamp(70 + 10 * hrv_z, 0, 100), 0.30)
    if rhr_z is not None:
        components["resting_hr"] = (clamp(70 - 10 * rhr_z, 0, 100), 0.20)
    if respiratory_z is not None:
        components["respiratory_rate"] = (
            clamp(70 - 10 * abs(respiratory_z), 0, 100),
            0.10,
        )

    available_weight = sum(weight for _, weight in components.values())
    if any(count < 14 for count in baseline_counts):
        state = "CALIBRATING"
        score = None
    elif len(components) < 3:
        state = "INSUFFICIENT_DATA"
        score = None
    else:
        score = sum(value * weight for value, weight in components.values())
        score /= available_weight
        state = "SCORED" if len(components) == 4 else "PROVISIONAL"

    component_coverage = available_weight
    baseline_maturity = min(1.0, median(baseline_counts) / 28)
    confidence = 100 * (0.60 * component_coverage + 0.40 * baseline_maturity)

    return {
        "state": state,
        "readiness": None if score is None else round(score, 1),
        "confidence": round(confidence, 1),
        "coverage": "{}/4 inputs".format(len(components)),
        "components": {
            name: round(value, 1) for name, (value, _) in components.items()
        },
    }


def cardio_load(
    hr_intervals: list[tuple[float, float]],
    hr_rest: float,
    hr_max: float,
) -> dict[str, object]:
    raw = 0.0
    duration = 0.0
    for heart_rate, minutes in hr_intervals:
        reserve = clamp((heart_rate - hr_rest) / (hr_max - hr_rest), 0, 1)
        raw += minutes * reserve * 0.64 * exp(1.92 * reserve)
        duration += minutes
    return {
        "cardio_load_raw": round(raw, 1),
        "duration_minutes": round(duration, 1),
        "hr_coverage": "100%",
        "approximate": False,
    }


@dataclass
class Scenario:
    name: str
    hrv_sdnn: Optional[float]
    resting_hr: Optional[float]
    respiratory_rate: Optional[float]
    asleep_hours: float
    in_bed_hours: float
    timing_consistency: float
    workout: list[tuple[float, float]]


def make_history(center: float, step: float = 0.0) -> list[float]:
    values = []
    for index in range(28):
        wobble = ((index % 5) - 2) * step
        values.append(center + wobble)
    return values


def run_scenario(
    scenario: Scenario,
    histories: dict[str, list[float]],
) -> None:
    sleep = sleep_score(
        scenario.asleep_hours,
        scenario.in_bed_hours,
        target_hours=8.0,
        timing_consistency=scenario.timing_consistency,
    )
    hrv_z = robust_z(scenario.hrv_sdnn, histories["hrv_sdnn"])
    rhr_z = robust_z(scenario.resting_hr, histories["resting_hr"])
    respiratory_z = robust_z(
        scenario.respiratory_rate,
        histories["respiratory_rate"],
    )
    readiness = readiness_score(
        sleep=sleep["sleep_score"],
        hrv_z=hrv_z,
        rhr_z=rhr_z,
        respiratory_z=respiratory_z,
        baseline_counts=[
            len(histories["hrv_sdnn"]),
            len(histories["resting_hr"]),
            len(histories["respiratory_rate"]),
        ],
    )
    load = cardio_load(scenario.workout, hr_rest=58, hr_max=190)

    print("\n=== {} ===".format(scenario.name))
    print("Sleep:      {}".format(sleep))
    print("Readiness:  {}".format(readiness))
    print("Cardio:     {}".format(load))
    print("Z-scores:   HRV={} RHR={} RR={}".format(hrv_z, rhr_z, respiratory_z))


def main() -> None:
    histories = {
        "hrv_sdnn": make_history(60, step=1.5),
        "resting_hr": make_history(58, step=0.35),
        "respiratory_rate": make_history(15, step=0.08),
    }
    scenarios = [
        Scenario(
            "steady baseline day",
            hrv_sdnn=61,
            resting_hr=58,
            respiratory_rate=15.0,
            asleep_hours=7.7,
            in_bed_hours=8.1,
            timing_consistency=86,
            workout=[(125, 35), (145, 20)],
        ),
        Scenario(
            "short sleep plus elevated resting HR",
            hrv_sdnn=45,
            resting_hr=64,
            respiratory_rate=15.8,
            asleep_hours=5.4,
            in_bed_hours=6.3,
            timing_consistency=52,
            workout=[(115, 20)],
        ),
        Scenario(
            "hard workout with good sleep",
            hrv_sdnn=55,
            resting_hr=60,
            respiratory_rate=15.3,
            asleep_hours=8.0,
            in_bed_hours=8.4,
            timing_consistency=88,
            workout=[(135, 30), (165, 25), (180, 10)],
        ),
        Scenario(
            "missing respiratory rate",
            hrv_sdnn=60,
            resting_hr=58,
            respiratory_rate=None,
            asleep_hours=7.5,
            in_bed_hours=8.0,
            timing_consistency=80,
            workout=[],
        ),
    ]
    for scenario in scenarios:
        run_scenario(scenario, histories)

    print("\n=== calibration period ===")
    run_scenario(scenarios[0], {key: values[:7] for key, values in histories.items()})


if __name__ == "__main__":
    main()
