#!/usr/bin/env python3
"""Build a local, aggregate-only Pulsefield dataset from an Apple Health export.

The generated personal-data.js is intentionally gitignored. It contains
personal health summaries and is only for the local dashboard.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from statistics import median
from typing import Any
import xml.etree.ElementTree as ET


TRACKED = {
    "HKQuantityTypeIdentifierHeartRate": ("heart_rate", "bpm"),
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": ("hrv_sdnn", "ms"),
    "HKQuantityTypeIdentifierRestingHeartRate": ("resting_hr", "bpm"),
    "HKQuantityTypeIdentifierRespiratoryRate": ("respiratory_rate", "breaths/min"),
    "HKQuantityTypeIdentifierActiveEnergyBurned": ("active_energy", "kcal"),
    "HKQuantityTypeIdentifierBasalEnergyBurned": ("basal_energy", "kcal"),
    "HKQuantityTypeIdentifierStepCount": ("steps", "count"),
    "HKQuantityTypeIdentifierAppleExerciseTime": ("exercise_time", "min"),
    "HKQuantityTypeIdentifierDistanceWalkingRunning": ("walking_distance", "km"),
    "HKQuantityTypeIdentifierVO2Max": ("vo2_max", "mL/min·kg"),
    "HKQuantityTypeIdentifierHeartRateRecoveryOneMinute": ("hr_recovery", "bpm"),
    "HKQuantityTypeIdentifierOxygenSaturation": ("oxygen_saturation", "percent"),
    "HKQuantityTypeIdentifierAppleSleepingWristTemperature": ("wrist_temperature", "degC"),
}

SLEEP_TYPES = {
    "HKCategoryValueSleepAnalysisInBed": "in_bed",
    "HKCategoryValueSleepAnalysisAsleepCore": "core",
    "HKCategoryValueSleepAnalysisAsleepDeep": "deep",
    "HKCategoryValueSleepAnalysisAsleepREM": "rem",
    "HKCategoryValueSleepAnalysisAsleepUnspecified": "unspecified",
    "HKCategoryValueSleepAnalysisAwake": "awake",
}

CARDIO_LOAD_PROFILES = {
    "male": {"label": "male reference", "reserveCoefficient": 0.64, "intensityCoefficient": 1.92},
    "female": {"label": "female reference", "reserveCoefficient": 0.86, "intensityCoefficient": 1.67},
}


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.strip().replace(" ", "T", 1))
    except ValueError:
        return None


def day_key(value: datetime | None) -> str | None:
    return value.date().isoformat() if value else None


def number(value: str | None) -> float | None:
    try:
        return float(value) if value is not None else None
    except ValueError:
        return None


def convert(value: float, unit: str, target: str) -> float:
    unit = unit.lower()
    if target == "km":
        if unit in {"mi", "mile", "miles"}:
            return value * 1.609344
        if unit in {"m", "meter", "meters"}:
            return value / 1000
    if target == "percent" and value <= 1:
        return value * 100
    if target == "min" and unit in {"s", "sec", "second", "seconds"}:
        return value / 60
    return value


def add_stat(day: dict[str, Any], kind: str, value: float, unit: str) -> None:
    metric = day["metrics"].setdefault(
        kind,
        {"sum": 0.0, "count": 0, "min": None, "max": None, "unit": unit},
    )
    value = convert(value, unit, "km" if kind == "walking_distance" else unit)
    metric["sum"] += value
    metric["count"] += 1
    metric["min"] = value if metric["min"] is None else min(metric["min"], value)
    metric["max"] = value if metric["max"] is None else max(metric["max"], value)


def union_minutes(intervals: list[tuple[datetime, datetime]]) -> float:
    valid = sorted((start, end) for start, end in intervals if end > start)
    if not valid:
        return 0.0
    total = timedelta()
    start, end = valid[0]
    for next_start, next_end in valid[1:]:
        if next_start <= end:
            end = max(end, next_end)
        else:
            total += end - start
            start, end = next_start, next_end
    total += end - start
    return total.total_seconds() / 60


def metric_value(day: dict[str, Any], kind: str, mode: str = "mean") -> float | None:
    metric = day["metrics"].get(kind)
    if not metric:
        return None
    if mode == "sum":
        return metric["sum"]
    return metric["sum"] / metric["count"]


def robust_z(value: float | None, history: list[float]) -> float | None:
    if value is None or len(history) < 14:
        return None
    values = history[-28:]
    center = median(values)
    deviations = [abs(item - center) for item in values]
    scale = 1.4826 * median(deviations)
    if scale == 0:
        ordered = sorted(values)
        q1 = ordered[len(ordered) // 4]
        q3 = ordered[(len(ordered) * 3) // 4]
        scale = (q3 - q1) / 1.349
    if scale == 0:
        return None
    return max(-3, min(3, (value - center) / scale))


def cardio_load(duration_min: float, heart_rate: float | None, profile: dict[str, Any], rest: float = 58, maximum: float = 190) -> float | None:
    if heart_rate is None or duration_min <= 0 or maximum <= rest:
        return None
    reserve = max(0, min(1, (heart_rate - rest) / (maximum - rest)))
    return duration_min * reserve * profile["reserveCoefficient"] * math.exp(profile["intensityCoefficient"] * reserve)


def prepare_day() -> dict[str, Any]:
    return {"metrics": {}, "sleep_intervals": defaultdict(list), "workouts": []}


def parse_export(xml_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]], Counter, Counter]:
    days: dict[str, dict[str, Any]] = defaultdict(prepare_day)
    record_types = Counter()
    source_buckets = Counter()
    workouts: list[dict[str, Any]] = []
    first_date: str | None = None
    last_date: str | None = None
    record_count = 0

    for _, element in ET.iterparse(xml_path, events=("end",)):
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "Record":
            record_count += 1
            kind = element.attrib.get("type", "")
            record_types[kind] += 1
            start = parse_datetime(element.attrib.get("startDate"))
            end = parse_datetime(element.attrib.get("endDate")) or start
            record_date = day_key(end if "SleepAnalysis" in kind else start)
            if record_date:
                days[record_date]["date"] = record_date
                first_date = min(first_date, record_date) if first_date else record_date
                last_date = max(last_date, record_date) if last_date else record_date
            source = element.attrib.get("sourceName", "").lower()
            source_buckets["Apple Watch" if "watch" in source else "iPhone" if "iphone" in source else "Other"] += 1

            if kind == "HKCategoryTypeIdentifierSleepAnalysis":
                category = SLEEP_TYPES.get(element.attrib.get("value", ""))
                if category and start and end and record_date:
                    days[record_date]["sleep_intervals"][category].append((start, end))
            elif kind in TRACKED:
                value = number(element.attrib.get("value"))
                if value is not None and record_date:
                    metric_kind, unit = TRACKED[kind]
                    add_stat(days[record_date], metric_kind, value, element.attrib.get("unit", unit))
            element.clear()
        elif tag == "Workout":
            start = parse_datetime(element.attrib.get("startDate"))
            end = parse_datetime(element.attrib.get("endDate"))
            if not start or not end:
                element.clear()
                continue
            record_date = day_key(start)
            duration = number(element.attrib.get("duration")) or (end - start).total_seconds() / 60
            duration_unit = element.attrib.get("durationUnit", "min").lower()
            if duration_unit in {"s", "sec", "second", "seconds"}:
                duration /= 60
            energy = number(element.attrib.get("totalEnergyBurned"))
            distance = number(element.attrib.get("totalDistance"))
            distance_unit = element.attrib.get("totalDistanceUnit", "")
            if distance is not None:
                distance = convert(distance, distance_unit, "km")
            workout = {
                "date": record_date,
                "start": start.isoformat(),
                "end": end.isoformat(),
                "activity": element.attrib.get("workoutActivityType", "unknown").replace("HKWorkoutActivityType", ""),
                "durationMin": round(duration, 1),
                "energyKcal": round(energy, 1) if energy is not None else None,
                "distanceKm": round(distance, 2) if distance is not None else None,
                "source": "Apple Watch" if "watch" in element.attrib.get("sourceName", "").lower() else "Other",
                "_hr": [],
            }
            workouts.append(workout)
            if record_date:
                days[record_date]["date"] = record_date
                days[record_date]["workouts"].append(workout)
            element.clear()
        else:
            element.clear()

    meta = {
        "recordCount": record_count,
        "recordTypes": dict(record_types),
        "sourceBuckets": dict(source_buckets),
        "dateRange": {"start": first_date, "end": last_date},
        "workoutCount": len(workouts),
    }
    return meta, list(days.values()), record_types, source_buckets


def attach_workout_heart_rate(xml_path: Path, workouts: list[dict[str, Any]]) -> None:
    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for workout in workouts:
        by_date[workout["date"]].append(workout)
        workout["_start"] = datetime.fromisoformat(workout["start"])
        workout["_end"] = datetime.fromisoformat(workout["end"])

    for _, element in ET.iterparse(xml_path, events=("end",)):
        if element.tag.rsplit("}", 1)[-1] == "Record" and element.attrib.get("type") == "HKQuantityTypeIdentifierHeartRate":
            timestamp = parse_datetime(element.attrib.get("startDate"))
            value = number(element.attrib.get("value"))
            if timestamp and value is not None:
                for workout in by_date.get(day_key(timestamp), []):
                    if workout["_start"] <= timestamp <= workout["_end"]:
                        workout["_hr"].append(value)
                        break
            element.clear()
        elif element.tag.rsplit("}", 1)[-1] == "Record":
            element.clear()


def finish(meta: dict[str, Any], raw_days: list[dict[str, Any]], workouts: list[dict[str, Any]], cardio_profile: str = "male") -> dict[str, Any]:
    profile = CARDIO_LOAD_PROFILES.get(cardio_profile, CARDIO_LOAD_PROFILES["male"])
    by_date = {}
    for raw in raw_days:
        for interval_list in raw["sleep_intervals"].values():
            for start, end in interval_list:
                raw["sleep_intervals"]
        for workout in raw["workouts"]:
            hr_values = workout.pop("_hr", [])
            workout.pop("_start", None)
            workout.pop("_end", None)
            if hr_values:
                workout["hrAvgBpm"] = round(sum(hr_values) / len(hr_values), 1)
                workout["hrSamples"] = len(hr_values)
                workout["cardioLoadRaw"] = round(cardio_load(workout["durationMin"], workout["hrAvgBpm"], profile) or 0, 1)
                workout["cardioLoadProfile"] = cardio_profile
                workout["cardioLoadApproximate"] = True
            else:
                workout["hrAvgBpm"] = None
                workout["hrSamples"] = 0
                workout["cardioLoadRaw"] = None
                workout["cardioLoadApproximate"] = True
        by_date[raw.get("date") or ""] = raw

    if not by_date:
        meta.update({
            "coverage": {},
            "cardioLoad": {
                "profile": cardio_profile,
                "reference": profile["label"],
                "reserveCoefficient": profile["reserveCoefficient"],
                "intensityCoefficient": profile["intensityCoefficient"],
                "note": "Reference coefficients are an explicit modeling choice, not a medical classification.",
            },
        })
        return {"metadata": meta, "days": [], "workouts": []}
    start = date.fromisoformat(meta["dateRange"]["start"])
    end = date.fromisoformat(meta["dateRange"]["end"])
    dates = []
    current = start
    while current <= end:
        dates.append(current.isoformat())
        current += timedelta(days=1)

    output_days = []
    history = {"hrv_sdnn": [], "resting_hr": [], "respiratory_rate": [], "sleep_score": []}
    for current_date in dates:
        raw = by_date.get(current_date, prepare_day())
        metrics = raw["metrics"]
        sleep_intervals = raw["sleep_intervals"]
        in_bed = union_minutes(sleep_intervals["in_bed"])
        asleep_intervals = [interval for kind in ("core", "deep", "rem", "unspecified") for interval in sleep_intervals[kind]]
        asleep = union_minutes(asleep_intervals)
        stages = {kind: round(union_minutes(sleep_intervals[kind]), 1) for kind in ("deep", "rem", "core", "unspecified", "awake")}
        sleep = None
        if in_bed > 0 and asleep > 0:
            efficiency = min(100, 100 * asleep / in_bed)
            sufficiency = min(100, 100 * asleep / 480)
            sleep = {
                "inBedMin": round(in_bed, 1),
                "asleepMin": round(asleep, 1),
                "efficiency": round(efficiency, 1),
                "sufficiency": round(sufficiency, 1),
                "stages": stages,
                "start": min((start.isoformat() for start, _ in asleep_intervals), default=None),
                "end": max((end.isoformat() for _, end in asleep_intervals), default=None),
            }
            sleep["score"] = round(0.7 * sufficiency + 0.3 * efficiency, 1)

        def mean(kind: str) -> float | None:
            value = metric_value(raw, kind)
            return round(value, 2) if value is not None else None

        def total(kind: str) -> float | None:
            value = metric_value(raw, kind, "sum")
            return round(value, 2) if value is not None else None

        workout_rows = []
        daily_load = 0.0
        for workout in raw["workouts"]:
            clean = dict(workout)
            workout_rows.append(clean)
            if workout["cardioLoadRaw"] is not None:
                daily_load += workout["cardioLoadRaw"]

        day = {
            "date": current_date,
            "heartRateBpm": mean("heart_rate"),
            "heartRateSamples": metrics.get("heart_rate", {}).get("count", 0),
            "hrvSdnnMs": mean("hrv_sdnn"),
            "restingHeartRateBpm": mean("resting_hr"),
            "respiratoryRate": mean("respiratory_rate"),
            "activeEnergyKcal": total("active_energy"),
            "basalEnergyKcal": total("basal_energy"),
            "steps": total("steps"),
            "exerciseMinutes": total("exercise_time"),
            "walkingDistanceKm": total("walking_distance"),
            "vo2Max": mean("vo2_max"),
            "heartRateRecoveryBpm": mean("hr_recovery"),
            "oxygenSaturation": mean("oxygen_saturation"),
            "sleep": sleep,
            "sleepScore": sleep["score"] if sleep else None,
            "cardioLoadRaw": round(daily_load, 1) if daily_load else None,
            "workoutCount": len(workout_rows),
            "workoutMinutes": round(sum(item["durationMin"] for item in workout_rows), 1),
            "workouts": workout_rows,
        }

        components = []
        if sleep and sleep["score"] is not None:
            components.append(("sleep", sleep["score"], 0.4, [current_date + ":sleep"]))
        for kind, label, weight, inverse in (
            ("hrv_sdnn", "hrv_sdnn", 0.3, False),
            ("resting_hr", "resting_heart_rate", 0.2, True),
            ("respiratory_rate", "respiratory_rate", 0.1, True),
        ):
            value = day[{"hrv_sdnn": "hrvSdnnMs", "resting_hr": "restingHeartRateBpm", "respiratory_rate": "respiratoryRate"}[kind]]
            z = robust_z(value, history[kind])
            if z is not None:
                component_value = max(0, min(100, 70 + (-10 if inverse else 10) * (abs(z) if inverse else z)))
                components.append((label, component_value, weight, [current_date + ":" + kind]))

        available = sum(item[2] for item in components)
        readiness = None
        state = "insufficient_data"
        if len(components) >= 3:
            readiness = round(sum(value * weight for _, value, weight, _ in components) / available, 1)
            state = "scored" if len(components) == 4 else "provisional"
        elif components:
            state = "calibrating"
        day["readiness"] = {
            "value": readiness,
            "state": state,
            "confidence": round(100 * available, 1) if readiness is not None else None,
            "components": [
                {"kind": kind, "value": round(value, 1), "weight": weight, "status": "available", "inputs": inputs}
                for kind, value, weight, inputs in components
            ],
        }
        output_days.append(day)

        for kind, key in (("hrv_sdnn", "hrvSdnnMs"), ("resting_hr", "restingHeartRateBpm"), ("respiratory_rate", "respiratoryRate")):
            value = day[key]
            if value is not None:
                history[kind].append(value)
        if day["sleepScore"] is not None:
            history["sleep_score"].append(day["sleepScore"])

    clean_workouts = []
    for workout in workouts:
        clean = {key: value for key, value in workout.items() if not key.startswith("_")}
        clean_workouts.append(clean)
    latest = output_days[-1]
    meta.update({
        "latestAvailableDate": output_days[-1]["date"],
        "latestSleepDate": next((item["date"] for item in reversed(output_days) if item["sleep"]), None),
        "latestVitalsDate": next((item["date"] for item in reversed(output_days) if item["hrvSdnnMs"] or item["restingHeartRateBpm"]), None),
        "latestWorkoutDate": next((item["date"] for item in reversed(output_days) if item["workoutCount"]), None),
        "coverage": {
            "sleepDays": sum(1 for item in output_days if item["sleep"]),
            "hrvDays": sum(1 for item in output_days if item["hrvSdnnMs"] is not None),
            "restingHeartRateDays": sum(1 for item in output_days if item["restingHeartRateBpm"] is not None),
            "respiratoryRateDays": sum(1 for item in output_days if item["respiratoryRate"] is not None),
            "workoutDays": sum(1 for item in output_days if item["workoutCount"]),
        },
        "cardioLoad": {
            "profile": cardio_profile,
            "reference": profile["label"],
            "reserveCoefficient": profile["reserveCoefficient"],
            "intensityCoefficient": profile["intensityCoefficient"],
            "note": "Reference coefficients are an explicit modeling choice, not a medical classification.",
        },
    })
    return {"schemaVersion": "personal-summary-1.0.0", "metadata": meta, "days": output_days, "workouts": clean_workouts}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("export_dir", type=Path)
    parser.add_argument("--output", type=Path, default=Path("personal-data.js"))
    parser.add_argument("--cardio-load-profile", choices=sorted(CARDIO_LOAD_PROFILES), default="male")
    args = parser.parse_args()
    xml_path = args.export_dir / "export.xml"
    if not xml_path.exists():
        raise SystemExit("Expected export.xml in " + str(args.export_dir))
    meta, raw_days, _, _ = parse_export(xml_path)
    workouts = [workout for raw in raw_days for workout in raw["workouts"]]
    attach_workout_heart_rate(xml_path, workouts)
    dataset = finish(meta, raw_days, workouts, args.cardio_load_profile)
    payload = "window.PULSEFIELD_PERSONAL_DATA = " + json.dumps(dataset, ensure_ascii=False, separators=(",", ":")) + ";\n"
    args.output.write_text(payload, encoding="utf-8")
    report = {
        "metadata": dataset["metadata"],
        "latest": dataset["days"][-1] if dataset["days"] else None,
        "lastSevenDays": dataset["days"][-7:],
    }
    Path("health-analysis-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(dataset["metadata"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
