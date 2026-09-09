(function () {
  "use strict";

  const TRACKED_TYPES = {
    HKQuantityTypeIdentifierHeartRate: { field: "heartRateBpm", kind: "heart_rate", unit: "bpm", aggregate: "mean" },
    HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { field: "hrvSdnnMs", kind: "hrv_sdnn", unit: "ms", aggregate: "mean" },
    HKQuantityTypeIdentifierRestingHeartRate: { field: "restingHeartRateBpm", kind: "resting_hr", unit: "bpm", aggregate: "mean" },
    HKQuantityTypeIdentifierRespiratoryRate: { field: "respiratoryRate", kind: "respiratory_rate", unit: "breaths/min", aggregate: "mean" },
    HKQuantityTypeIdentifierActiveEnergyBurned: { field: "activeEnergyKcal", kind: "active_energy", unit: "kcal", aggregate: "sum" },
    HKQuantityTypeIdentifierBasalEnergyBurned: { field: "basalEnergyKcal", kind: "basal_energy", unit: "kcal", aggregate: "sum" },
    HKQuantityTypeIdentifierStepCount: { field: "steps", kind: "steps", unit: "count", aggregate: "sum" },
    HKQuantityTypeIdentifierAppleExerciseTime: { field: "exerciseMinutes", kind: "exercise_time", unit: "min", aggregate: "sum" },
    HKQuantityTypeIdentifierDistanceWalkingRunning: { field: "walkingDistanceKm", kind: "walking_distance", unit: "km", aggregate: "sum" },
    HKQuantityTypeIdentifierVO2Max: { field: "vo2Max", kind: "vo2_max", unit: "mL/min·kg", aggregate: "mean" },
    HKQuantityTypeIdentifierHeartRateRecoveryOneMinute: { field: "heartRateRecoveryBpm", kind: "hr_recovery", unit: "bpm", aggregate: "mean" },
    HKQuantityTypeIdentifierOxygenSaturation: { field: "oxygenSaturation", kind: "oxygen_saturation", unit: "percent", aggregate: "mean" },
    HKQuantityTypeIdentifierAppleSleepingWristTemperature: { field: "wristTemperatureC", kind: "wrist_temperature", unit: "degC", aggregate: "mean" },
    HKQuantityTypeIdentifierFlightsClimbed: { field: "flightsClimbed", kind: "flights_climbed", unit: "count", aggregate: "sum" },
    HKQuantityTypeIdentifierAppleStandTime: { field: "standMinutes", kind: "stand_time", unit: "min", aggregate: "sum" },
    HKQuantityTypeIdentifierTimeInDaylight: { field: "daylightMinutes", kind: "daylight_time", unit: "min", aggregate: "sum" },
    HKQuantityTypeIdentifierWalkingHeartRateAverage: { field: "walkingHeartRateBpm", kind: "walking_hr", unit: "bpm", aggregate: "mean" }
  };

  const SLEEP_VALUES = {
    HKCategoryValueSleepAnalysisInBed: "inBed",
    HKCategoryValueSleepAnalysisAsleep: "unspecified",
    HKCategoryValueSleepAnalysisAsleepUnspecified: "unspecified",
    HKCategoryValueSleepAnalysisAsleepCore: "core",
    HKCategoryValueSleepAnalysisAsleepDeep: "deep",
    HKCategoryValueSleepAnalysisAsleepREM: "rem",
    HKCategoryValueSleepAnalysisAwake: "awake"
  };

  const ALL_SUPPORTED_TYPES = Object.keys(TRACKED_TYPES).concat(["HKCategoryTypeIdentifierSleepAnalysis", "HKWorkout"]);
  const ALGORITHM_VERSION = "health-export/v0.2";

  function finiteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function decodeXmlEntities(value) {
    return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, function (_, entity) {
      const lower = entity.toLowerCase();
      if (lower === "amp") return "&";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "quot") return "\"";
      if (lower === "apos") return "'";
      if (lower === "nbsp") return "\u00a0";
      if (lower.charAt(0) === "#") {
        const value = lower.charAt(1) === "x" ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
        return Number.isFinite(value) ? String.fromCodePoint(value) : _;
      }
      return _;
    });
  }

  function parseAttributes(tag) {
    const attributes = {};
    String(tag || "").replace(/\s+([A-Za-z_:][\w:.-]*)="([^"]*)"/g, function (_, key, value) {
      attributes[key] = decodeXmlEntities(value);
      return _;
    });
    return attributes;
  }

  function parseAppleDate(value) {
    if (!value) return null;
    const raw = String(value).trim();
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+([+-]\d{4}|Z)$/);
    if (match) {
      const offset = match[3] === "Z" ? "Z" : match[3].slice(0, 3) + ":" + match[3].slice(3);
      const iso = match[1] + "T" + match[2] + offset;
      return Number.isNaN(Date.parse(iso)) ? null : iso;
    }
    const parsed = new Date(raw.replace(" ", "T"));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  function epoch(iso) {
    const value = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(value) ? value : null;
  }

  function localDate(iso) {
    return iso ? iso.slice(0, 10) : null;
  }

  function addDays(dateString, amount) {
    const date = new Date(dateString + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }

  function dateList(start, end) {
    const dates = [];
    if (!start || !end) return dates;
    let current = start;
    while (current <= end) {
      dates.push(current);
      current = addDays(current, 1);
    }
    return dates;
  }

  function stableHash(value) {
    let primary = 2166136261;
    let secondary = 2246822519;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      primary ^= code;
      primary = Math.imul(primary, 16777619);
      secondary ^= code + index;
      secondary = Math.imul(secondary, 3266489917);
    }
    return (primary >>> 0).toString(16).padStart(8, "0") + (secondary >>> 0).toString(16).padStart(8, "0");
  }

  function sourceBucket(sourceName) {
    const source = String(sourceName || "").toLowerCase();
    if (source.indexOf("watch") >= 0) return "Apple Watch";
    if (source.indexOf("iphone") >= 0) return "iPhone";
    return "Other";
  }

  function normalizeValue(type, value, unit) {
    const lower = String(unit || "").toLowerCase();
    if (type === "HKQuantityTypeIdentifierDistanceWalkingRunning") {
      if (lower === "mi" || lower === "mile" || lower === "miles") return value * 1.609344;
      if (lower === "m" || lower === "meter" || lower === "meters") return value / 1000;
    }
    if (type === "HKQuantityTypeIdentifierAppleExerciseTime" || type === "HKQuantityTypeIdentifierAppleStandTime" || type === "HKQuantityTypeIdentifierTimeInDaylight") {
      if (lower === "s" || lower === "sec" || lower === "second" || lower === "seconds") return value / 60;
    }
    if (type === "HKQuantityTypeIdentifierOxygenSaturation" && value <= 1) return value * 100;
    if ((type === "HKQuantityTypeIdentifierActiveEnergyBurned" || type === "HKQuantityTypeIdentifierBasalEnergyBurned") && lower === "kj") return value / 4.184;
    return value;
  }

  function newRawDay(date) {
    return {
      date: date,
      metrics: {},
      sleepIntervals: { inBed: [], unspecified: [], core: [], deep: [], rem: [], awake: [] },
      workouts: []
    };
  }

  function ensureRawDay(context, date) {
    if (!date) return null;
    if (!context.days.has(date)) context.days.set(date, newRawDay(date));
    return context.days.get(date);
  }

  function addMetric(rawDay, definition, value, id) {
    const bucket = rawDay.metrics[definition.field] || {
      sum: 0,
      count: 0,
      min: null,
      max: null,
      ids: []
    };
    bucket.sum += value;
    bucket.count += 1;
    bucket.min = bucket.min === null ? value : Math.min(bucket.min, value);
    bucket.max = bucket.max === null ? value : Math.max(bucket.max, value);
    if (bucket.ids.length < 50) bucket.ids.push(id);
    rawDay.metrics[definition.field] = bucket;
  }

  function metricValue(rawDay, field, aggregate) {
    const bucket = rawDay && rawDay.metrics[field];
    if (!bucket || !bucket.count) return null;
    return aggregate === "sum" ? bucket.sum : bucket.sum / bucket.count;
  }

  function sourceIds(rawDay, field) {
    const bucket = rawDay && rawDay.metrics[field];
    return bucket ? bucket.ids.slice() : [];
  }

  function observationId(attributes, type, start, end, value, ordinal) {
    const sourceId = attributes.uuid || "";
    const identity = [sourceId, type, start, end, value, attributes.unit || "", attributes.sourceName || "", attributes.sourceVersion || "", attributes.device || "", sourceId ? "" : ordinal].join("\u001f");
    return "obs-" + stableHash(identity);
  }

  function makeObservation(attributes, id, kind, start, end, value, unit, importedAt) {
    return {
      id: id,
      kind: kind,
      start: start,
      end: end,
      value: value,
      unit: unit,
      quality: "observed",
      provenance: {
        adapter: "health_export",
        source: attributes.sourceName || "Apple Health export",
        sourceRevision: attributes.sourceVersion || null,
        device: attributes.device || null,
        sourceRecordId: attributes.uuid || null,
        observedAt: start,
        importedAt: importedAt,
        queryId: null
      }
    };
  }

  function parseRecord(tag, context) {
    const attributes = parseAttributes(tag);
    const type = attributes.type || "";
    context.recordCount += 1;
    context.recordTypes[type] = (context.recordTypes[type] || 0) + 1;
    context.sourceBuckets[sourceBucket(attributes.sourceName)] = (context.sourceBuckets[sourceBucket(attributes.sourceName)] || 0) + 1;

    const definition = TRACKED_TYPES[type];
    const sleepKind = type === "HKCategoryTypeIdentifierSleepAnalysis" ? SLEEP_VALUES[attributes.value] : null;
    if (!definition && !sleepKind) return;

    const start = parseAppleDate(attributes.startDate);
    const end = parseAppleDate(attributes.endDate) || start;
    if (!start) {
      context.warningCount += 1;
      return;
    }
    const id = observationId(attributes, type, start, end, attributes.value || "", context.recordCount);
    const rawDay = ensureRawDay(context, sleepKind ? localDate(end || start) : localDate(start));
    if (!rawDay) return;

    if (sleepKind) {
      const startMs = epoch(start);
      const endMs = epoch(end);
      if (startMs === null || endMs === null || endMs <= startMs) {
        context.warningCount += 1;
        return;
      }
      rawDay.sleepIntervals[sleepKind].push({ start: start, end: end, startMs: startMs, endMs: endMs, id: id });
      context.observations.push(makeObservation(attributes, id, "sleep_" + sleepKind, start, end, attributes.value, "category", context.importedAt));
      context.retainedObservationCount += 1;
      return;
    }

    const rawValue = finiteNumber(attributes.value);
    if (rawValue === null) {
      context.warningCount += 1;
      return;
    }
    const value = normalizeValue(type, rawValue, attributes.unit || definition.unit);
    const observation = makeObservation(attributes, id, definition.kind, start, end, value, definition.unit, context.importedAt);
    context.observations.push(observation);
    context.retainedObservationCount += 1;
    addMetric(rawDay, definition, value, id);
    if (type === "HKQuantityTypeIdentifierHeartRate") {
      const timestamp = epoch(start);
      if (timestamp !== null) context.hrSamples.push({ ms: timestamp, value: value });
    }
  }

  function parseWorkout(tag, context) {
    const attributes = parseAttributes(tag);
    context.recordCount += 1;
    context.recordTypes.HKWorkout = (context.recordTypes.HKWorkout || 0) + 1;
    context.sourceBuckets[sourceBucket(attributes.sourceName)] = (context.sourceBuckets[sourceBucket(attributes.sourceName)] || 0) + 1;
    const start = parseAppleDate(attributes.startDate);
    const end = parseAppleDate(attributes.endDate);
    if (!start || !end || epoch(end) <= epoch(start)) {
      context.warningCount += 1;
      return;
    }
    const durationValue = finiteNumber(attributes.duration);
    const durationUnit = String(attributes.durationUnit || "min").toLowerCase();
    const durationMin = durationValue === null ? (epoch(end) - epoch(start)) / 60000 : (durationUnit === "s" || durationUnit === "sec" || durationUnit === "seconds" ? durationValue / 60 : durationValue);
    const energyValue = finiteNumber(attributes.totalEnergyBurned);
    const distanceValue = finiteNumber(attributes.totalDistance);
    const distance = distanceValue === null ? null : normalizeValue("HKQuantityTypeIdentifierDistanceWalkingRunning", distanceValue, attributes.totalDistanceUnit || "");
    const id = "workout-" + stableHash([attributes.uuid || "", attributes.workoutActivityType || "", start, end, durationMin, attributes.uuid ? "" : context.recordCount].join("\u001f"));
    const workout = {
      id: id,
      date: localDate(start),
      start: start,
      end: end,
      activity: String(attributes.workoutActivityType || "unknown").replace("HKWorkoutActivityType", ""),
      durationMin: Math.round(durationMin * 10) / 10,
      energyKcal: energyValue === null ? null : Math.round(energyValue * 10) / 10,
      distanceKm: distance === null ? null : Math.round(distance * 100) / 100,
      source: sourceBucket(attributes.sourceName),
      hrAvgBpm: null,
      hrSamples: 0,
      hrCoverage: 0,
      cardioLoadRaw: null,
      cardioLoadApproximate: true,
      hrMaxSource: null
    };
    context.observations.push(makeObservation(attributes, id, "workout", start, end, {
      activity: workout.activity,
      durationMin: workout.durationMin,
      energyKcal: workout.energyKcal,
      distanceKm: workout.distanceKm
    }, "workout", context.importedAt));
    context.retainedObservationCount += 1;
    context.workouts.push(workout);
    const rawDay = ensureRawDay(context, workout.date);
    if (rawDay) rawDay.workouts.push(workout);
  }

  async function scanXml(stream, totalBytes, onProgress) {
    const context = {
      importedAt: new Date().toISOString(),
      recordCount: 0,
      retainedObservationCount: 0,
      warningCount: 0,
      recordTypes: {},
      sourceBuckets: {},
      days: new Map(),
      workouts: [],
      hrSamples: [],
      observations: []
    };
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let bytesRead = 0;
    let lastReported = 0;

    function consume() {
      let cursor = 0;
      while (true) {
        const recordIndex = buffer.indexOf("<Record ", cursor);
        const workoutIndex = buffer.indexOf("<Workout ", cursor);
        if (recordIndex < 0 && workoutIndex < 0) break;
        const isRecord = recordIndex >= 0 && (workoutIndex < 0 || recordIndex < workoutIndex);
        const startIndex = isRecord ? recordIndex : workoutIndex;
        if (isRecord) {
          const endIndex = buffer.indexOf("/>", startIndex);
          if (endIndex < 0) break;
          parseRecord(buffer.slice(startIndex, endIndex + 2), context);
          cursor = endIndex + 2;
        } else {
          const openEnd = buffer.indexOf(">", startIndex);
          if (openEnd < 0) break;
          if (buffer.charAt(openEnd - 1) === "/") {
            parseWorkout(buffer.slice(startIndex, openEnd + 1), context);
            cursor = openEnd + 1;
          } else {
            const closeIndex = buffer.indexOf("</Workout>", openEnd + 1);
            if (closeIndex < 0) break;
            parseWorkout(buffer.slice(startIndex, openEnd + 1), context);
            cursor = closeIndex + "</Workout>".length;
          }
        }
      }
      if (cursor > 0) buffer = buffer.slice(cursor);
      if (cursor === 0 && buffer.length > 2 * 1024 * 1024) buffer = buffer.slice(-512);
    }

    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytesRead += result.value.byteLength;
      buffer += decoder.decode(result.value, { stream: true });
      consume();
      if (onProgress && (bytesRead - lastReported > 8 * 1024 * 1024 || bytesRead === totalBytes)) {
        lastReported = bytesRead;
        const percent = totalBytes ? Math.min(100, Math.round(bytesRead / totalBytes * 100)) : 0;
        onProgress("Parsing local export · " + percent + "% · " + context.recordCount.toLocaleString() + " records");
      }
    }
    buffer += decoder.decode();
    consume();
    return context;
  }

  async function findZipEntry(file) {
    const tailLength = Math.min(file.size, 65557);
    const tailStart = file.size - tailLength;
    const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let endOffset = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (view.getUint32(index, true) === 0x06054b50) {
        endOffset = index;
        break;
      }
    }
    if (endOffset < 0) throw new Error("ZIP end directory was not found");
    const entryCount = view.getUint16(endOffset + 10, true);
    const centralSize = view.getUint32(endOffset + 12, true);
    const centralOffset = view.getUint32(endOffset + 16, true);
    const central = new Uint8Array(await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
    const centralView = new DataView(central.buffer, central.byteOffset, central.byteLength);
    const decoder = new TextDecoder();
    let offset = 0;
    let fallback = null;
    for (let index = 0; index < entryCount && offset + 46 <= central.length; index += 1) {
      if (centralView.getUint32(offset, true) !== 0x02014b50) break;
      const compression = centralView.getUint16(offset + 10, true);
      const compressedSize = centralView.getUint32(offset + 20, true);
      const uncompressedSize = centralView.getUint32(offset + 24, true);
      const nameLength = centralView.getUint16(offset + 28, true);
      const extraLength = centralView.getUint16(offset + 30, true);
      const commentLength = centralView.getUint16(offset + 32, true);
      const localOffset = centralView.getUint32(offset + 42, true);
      const name = decoder.decode(central.slice(offset + 46, offset + 46 + nameLength));
      const entry = { name: name, compression: compression, compressedSize: compressedSize, uncompressedSize: uncompressedSize, localOffset: localOffset };
      if (name.toLowerCase().endsWith("export.xml")) return entry;
      if (!fallback && name.toLowerCase().endsWith(".xml")) fallback = entry;
      offset += 46 + nameLength + extraLength + commentLength;
    }
    if (fallback) return fallback;
    throw new Error("The ZIP does not contain export.xml");
  }

  async function openXmlSource(file) {
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".zip")) return { stream: file.stream(), totalBytes: file.size, name: file.name };
    const entry = await findZipEntry(file);
    const localHeader = new Uint8Array(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
    const localView = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
    if (localView.getUint32(0, true) !== 0x04034b50) throw new Error("The ZIP entry header is invalid");
    const nameLength = localView.getUint16(26, true);
    const extraLength = localView.getUint16(28, true);
    const dataStart = entry.localOffset + 30 + nameLength + extraLength;
    const compressed = file.slice(dataStart, dataStart + entry.compressedSize);
    if (entry.compression === 0) return { stream: compressed.stream(), totalBytes: entry.uncompressedSize, name: entry.name };
    if (entry.compression !== 8) throw new Error("This ZIP uses an unsupported compression method");
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot decompress ZIP files locally. Upload export.xml instead.");
    return {
      stream: compressed.stream().pipeThrough(new DecompressionStream("deflate-raw")),
      totalBytes: entry.uncompressedSize,
      name: entry.name
    };
  }

  function mergedIntervals(intervals) {
    const sorted = intervals.slice().sort(function (a, b) { return a.startMs - b.startMs; });
    const merged = [];
    sorted.forEach(function (interval) {
      const previous = merged[merged.length - 1];
      if (previous && interval.startMs <= previous.endMs) {
        previous.endMs = Math.max(previous.endMs, interval.endMs);
        previous.end = previous.endMs > epoch(previous.end) ? new Date(previous.endMs).toISOString() : previous.end;
        previous.ids = previous.ids.concat(interval.id ? [interval.id] : []);
      } else {
        merged.push({ start: interval.start, end: interval.end, startMs: interval.startMs, endMs: interval.endMs, ids: interval.id ? [interval.id] : [] });
      }
    });
    return merged;
  }

  function intervalMinutes(intervals) {
    return mergedIntervals(intervals).reduce(function (total, interval) {
      return total + (interval.endMs - interval.startMs) / 60000;
    }, 0);
  }

  function intervalBounds(intervals) {
    const merged = mergedIntervals(intervals);
    if (!merged.length) return { start: null, end: null };
    return { start: merged[0].start, end: merged[merged.length - 1].end };
  }

  function uncoveredIntervals(intervals, covered) {
    const blockers = mergedIntervals(covered || []);
    const uncovered = [];
    mergedIntervals(intervals).forEach(function (interval) {
      let cursor = interval.startMs;
      blockers.forEach(function (blocker) {
        if (blocker.endMs <= cursor || blocker.startMs >= interval.endMs) return;
        if (blocker.startMs > cursor) {
          uncovered.push({ startMs: cursor, endMs: Math.min(blocker.startMs, interval.endMs) });
        }
        cursor = Math.max(cursor, blocker.endMs);
      });
      if (cursor < interval.endMs) uncovered.push({ startMs: cursor, endMs: interval.endMs });
    });
    return uncovered;
  }

  function allocatedStageMinutes(sleepIntervals) {
    const minutes = { deep: 0, rem: 0, core: 0, unspecified: 0, awake: 0 };
    let covered = [];
    ["deep", "rem", "core", "unspecified"].forEach(function (kind) {
      const allocated = uncoveredIntervals(sleepIntervals[kind] || [], covered);
      minutes[kind] = intervalMinutes(allocated);
      covered = covered.concat(allocated);
    });
    minutes.awake = intervalMinutes(uncoveredIntervals(sleepIntervals.awake || [], covered));
    return minutes;
  }

  function median(values) {
    const sorted = values.filter(function (value) { return value !== null && value !== undefined && Number.isFinite(value); }).slice().sort(function (a, b) { return a - b; });
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function robustZ(value, history) {
    if (value === null || value === undefined || history.length < 14) return null;
    const values = history.slice(-28);
    const center = median(values);
    const deviations = values.map(function (item) { return Math.abs(item - center); });
    let scale = 1.4826 * median(deviations);
    if (!scale) {
      const ordered = values.slice().sort(function (a, b) { return a - b; });
      const q1 = ordered[Math.floor((ordered.length - 1) * 0.25)];
      const q3 = ordered[Math.floor((ordered.length - 1) * 0.75)];
      scale = (q3 - q1) / 1.349;
    }
    if (!scale) return null;
    return Math.max(-3, Math.min(3, (value - center) / scale));
  }

  function round(value, digits) {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    const factor = Math.pow(10, digits || 1);
    return Math.round(value * factor) / factor;
  }

  function timeOfDayMinutes(iso) {
    const match = String(iso || "").match(/T(\d{2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function nearestHeartRateRest(rawDay, days, index, lastRhr) {
    const current = metricValue(rawDay, "restingHeartRateBpm", "mean");
    if (current !== null) return current;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = days[cursor] && metricValue(days[cursor].raw, "restingHeartRateBpm", "mean");
      if (previous !== null) return previous;
    }
    return lastRhr;
  }

  function lowerBound(samples, target) {
    let low = 0;
    let high = samples.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (samples[middle].ms < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function cardioLoad(durationMin, heartRate, rest, maximum) {
    if (durationMin <= 0 || heartRate === null || rest === null || maximum === null || maximum <= rest) return null;
    const reserve = Math.max(0, Math.min(1, (heartRate - rest) / (maximum - rest)));
    return durationMin * reserve * 0.64 * Math.exp(1.92 * reserve);
  }

  function algorithm(name, formula, missingDataPolicy) {
    return { name: name, version: ALGORITHM_VERSION, formula: formula, missingDataPolicy: missingDataPolicy };
  }

  function timezoneOffsetMs(date, timezone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).formatToParts(date).reduce(function (result, part) {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return asUtc - date.getTime();
  }

  function zonedMidnight(date, timezone) {
    const guess = new Date(date + "T00:00:00.000Z");
    const firstOffset = timezoneOffsetMs(guess, timezone);
    const first = new Date(guess.getTime() - firstOffset);
    const secondOffset = timezoneOffsetMs(first, timezone);
    return new Date(guess.getTime() - secondOffset).toISOString();
  }

  function dayWindow(date, timezone) {
    return { start: zonedMidnight(date, timezone), end: zonedMidnight(addDays(date, 1), timezone), timezone: timezone };
  }

  function buildFeature(features, date, kind, value, unit, inputs, timezone, formula, missingReason) {
    features.push({
      id: "feature-" + date + "-" + kind,
      kind: kind,
      window: dayWindow(date, timezone),
      value: value,
      unit: unit,
      inputs: inputs || [],
      algorithm: algorithm("pulsefield-" + kind, formula, "return null and show the missing reason when required inputs are absent"),
      missingReason: missingReason || null
    });
  }

  function buildDataset(context, options) {
    const settings = options || {};
    const timezone = settings.timezone || "UTC";
    const sleepTargetMin = Math.max(240, Number(settings.sleepTarget || 8) * 60);
    const datesWithData = Array.from(context.days.keys()).sort();
    const firstDate = datesWithData[0] || null;
    const lastDate = datesWithData[datesWithData.length - 1] || null;
    const dates = dateList(firstDate, lastDate);
    context.hrSamples.sort(function (a, b) { return a.ms - b.ms; });
    let observedPeakHr = null;
    context.hrSamples.forEach(function (sample) { observedPeakHr = observedPeakHr === null ? sample.value : Math.max(observedPeakHr, sample.value); });
    const configuredHrMax = finiteNumber(settings.hrMax);
    const hrMax = configuredHrMax !== null ? configuredHrMax : observedPeakHr;
    const days = [];
    const features = [];
    const scores = [];
    const histories = { hrvSdnnMs: [], restingHeartRateBpm: [], respiratoryRate: [], sleepOnset: [], sleepWake: [] };
    let lastRhr = null;

    const preparedDays = dates.map(function (date) {
      return { date: date, raw: context.days.get(date) || newRawDay(date) };
    });

    preparedDays.forEach(function (entry, index) {
      const raw = entry.raw;
      const rest = nearestHeartRateRest(raw, preparedDays, index, lastRhr);
      const workouts = raw.workouts || [];
      let dailyLoad = 0;
      let hasLoad = false;
      workouts.forEach(function (workout) {
        const startMs = epoch(workout.start);
        const endMs = epoch(workout.end);
        const firstSample = lowerBound(context.hrSamples, startMs);
        const values = [];
        for (let cursor = firstSample; cursor < context.hrSamples.length && context.hrSamples[cursor].ms <= endMs; cursor += 1) values.push(context.hrSamples[cursor]);
        workout.hrSamples = values.length;
        workout.hrAvgBpm = values.length ? round(values.reduce(function (sum, sample) { return sum + sample.value; }, 0) / values.length, 1) : null;
        workout.hrCoverage = values.length > 1 ? round(Math.min(1, (values[values.length - 1].ms - values[0].ms) / Math.max(1, endMs - startMs)), 2) : 0;
        workout.cardioLoadRaw = cardioLoad(workout.durationMin, workout.hrAvgBpm, rest, hrMax);
        workout.hrMaxSource = configuredHrMax !== null ? "user context" : (hrMax === null ? null : "observed export peak");
        if (workout.cardioLoadRaw !== null) {
          dailyLoad += workout.cardioLoadRaw;
          hasLoad = true;
        }
      });

      const inBedIntervals = raw.sleepIntervals.inBed || [];
      const asleepIntervals = ["unspecified", "core", "deep", "rem"].reduce(function (all, kind) {
        return all.concat(raw.sleepIntervals[kind] || []);
      }, []);
      const inBedMin = intervalMinutes(inBedIntervals);
      const asleepMin = intervalMinutes(asleepIntervals);
      const stageMinutes = allocatedStageMinutes(raw.sleepIntervals);
      const asleepBounds = intervalBounds(asleepIntervals);
      const inBedBounds = intervalBounds(inBedIntervals);
      let sleepDetail = null;
      let sleepScore = null;
      if (inBedMin > 0 && asleepMin > 0) {
        const efficiency = Math.min(100, asleepMin / inBedMin * 100);
        const sufficiency = Math.min(100, asleepMin / sleepTargetMin * 100);
        const onset = timeOfDayMinutes(inBedBounds.start || asleepBounds.start);
        const wake = timeOfDayMinutes(inBedBounds.end || asleepBounds.end);
        const parts = [{ value: sufficiency, weight: 0.5 }, { value: efficiency, weight: 0.3 }];
        let timingConsistency = null;
        if (histories.sleepOnset.length >= 3 && histories.sleepWake.length >= 3 && onset !== null && wake !== null) {
          const onsetMedian = median(histories.sleepOnset.slice(-14));
          const wakeMedian = median(histories.sleepWake.slice(-14));
          const onsetDeviation = Math.abs(onset - onsetMedian);
          const wakeDeviation = Math.abs(wake - wakeMedian);
          timingConsistency = Math.max(0, 100 * (1 - Math.min(1, ((onsetDeviation + wakeDeviation) / 2) / 120)));
          parts.push({ value: timingConsistency, weight: 0.2 });
        }
        const totalWeight = parts.reduce(function (sum, part) { return sum + part.weight; }, 0);
        sleepScore = parts.reduce(function (sum, part) { return sum + part.value * part.weight; }, 0) / totalWeight;
        const sleepIds = asleepIntervals.slice(0, 100).map(function (interval) { return interval.id; });
        sleepDetail = {
          inBedMin: round(inBedMin, 1),
          asleepMin: round(asleepMin, 1),
          efficiency: round(efficiency, 1),
          sufficiency: round(sufficiency, 1),
          timingConsistency: round(timingConsistency, 1),
          stages: {
            deep: round(stageMinutes.deep, 1),
            rem: round(stageMinutes.rem, 1),
            core: round(stageMinutes.core, 1),
            unspecified: round(stageMinutes.unspecified, 1),
            awake: round(stageMinutes.awake, 1)
          },
          start: (inBedBounds.start || asleepBounds.start),
          end: (inBedBounds.end || asleepBounds.end),
          inputCount: asleepIntervals.length + inBedIntervals.length,
          inputIds: sleepIds
        };
        buildFeature(features, entry.date, "sleep_score", round(sleepScore, 1), "score", sleepIds, timezone, "0.50*sufficiency + 0.30*efficiency + 0.20*timing_consistency when timing history exists");
      } else {
        buildFeature(features, entry.date, "sleep_score", null, "score", [], timezone, "0.50*sufficiency + 0.30*efficiency + 0.20*timing_consistency", "missing a valid in-bed and asleep interval");
      }

      const hrv = round(metricValue(raw, "hrvSdnnMs", "mean"), 2);
      const rhr = round(metricValue(raw, "restingHeartRateBpm", "mean"), 2);
      const resp = round(metricValue(raw, "respiratoryRate", "mean"), 2);
      const steps = round(metricValue(raw, "steps", "sum"), 1);
      const active = round(metricValue(raw, "activeEnergyKcal", "sum"), 2);
      const exercise = round(metricValue(raw, "exerciseMinutes", "sum"), 2);
      const distance = round(metricValue(raw, "walkingDistanceKm", "sum"), 2);
      const heartRate = round(metricValue(raw, "heartRateBpm", "mean"), 2);
      const basal = round(metricValue(raw, "basalEnergyKcal", "sum"), 2);
      const vo2Max = round(metricValue(raw, "vo2Max", "mean"), 2);
      const hrRecovery = round(metricValue(raw, "heartRateRecoveryBpm", "mean"), 2);
      const oxygen = round(metricValue(raw, "oxygenSaturation", "mean"), 2);
      const readinessComponents = [];
      const sleepComponent = {
        kind: "sleep",
        value: sleepScore === null ? null : round(sleepScore, 1),
        weight: 0.4,
        status: sleepScore === null ? "missing" : "available",
        inputs: sleepDetail ? sleepDetail.inputIds : []
      };
      readinessComponents.push(sleepComponent);

      function physiologicalComponent(kind, value, weight, direction, field, label) {
        const history = histories[field];
        const z = robustZ(value, history);
        if (value === null) return { kind: label, value: null, weight: weight, status: "missing", inputs: sourceIds(raw, field), note: "no current observation" };
        if (z === null) return { kind: label, value: null, weight: weight, status: "calibrating", inputs: sourceIds(raw, field), note: "need 14 prior valid observations" };
        const componentValue = Math.max(0, Math.min(100, 70 + direction * 10 * (field === "respiratoryRate" ? Math.abs(z) : z)));
        return { kind: label, value: round(componentValue, 1), weight: weight, status: "available", inputs: sourceIds(raw, field), baselineCount: history.slice(-28).length, z: round(z, 3) };
      }

      readinessComponents.push(physiologicalComponent("hrv", hrv, 0.3, 1, "hrvSdnnMs", "hrv_sdnn"));
      readinessComponents.push(physiologicalComponent("rhr", rhr, 0.2, -1, "restingHeartRateBpm", "resting_heart_rate"));
      readinessComponents.push(physiologicalComponent("resp", resp, 0.1, -1, "respiratoryRate", "respiratory_rate"));
      const availableComponents = readinessComponents.filter(function (component) { return component.status === "available"; });
      const hasCalibrationGap = readinessComponents.some(function (component) { return component.status === "calibrating"; });
      const availableWeight = availableComponents.reduce(function (sum, component) { return sum + component.weight; }, 0);
      const baselineCounts = [histories.hrvSdnnMs, histories.restingHeartRateBpm, histories.respiratoryRate].map(function (history) { return Math.min(1, history.length / 28); });
      const baselineMaturity = median(baselineCounts);
      const readinessState = hasCalibrationGap ? "calibrating" : availableComponents.length >= 4 ? "scored" : availableComponents.length >= 3 ? "provisional" : "insufficient_data";
      const readinessValue = readinessState === "calibrating" || availableComponents.length < 3 ? null : round(availableComponents.reduce(function (sum, component) { return sum + component.value * component.weight; }, 0) / availableWeight, 1);
      const confidence = readinessValue === null ? null : round(100 * (0.6 * availableWeight + 0.4 * (baselineMaturity || 0)), 1);
      const readiness = {
        value: readinessValue,
        state: readinessState,
        confidence: confidence,
        components: readinessComponents,
        window: dayWindow(entry.date, timezone),
        algorithm: algorithm("readiness-proxy", "weighted mean of sleep, HRV SDNN, resting heart rate, and respiratory-rate components", "missing components are excluded and the result is marked provisional; calibration blocks the composite")
      };

      const day = {
        date: entry.date,
        heartRateBpm: heartRate,
        heartRateSamples: raw.metrics.heartRateBpm ? raw.metrics.heartRateBpm.count : 0,
        hrvSdnnMs: hrv,
        restingHeartRateBpm: rhr,
        respiratoryRate: resp,
        activeEnergyKcal: active,
        basalEnergyKcal: basal,
        steps: steps,
        exerciseMinutes: exercise,
        walkingDistanceKm: distance,
        vo2Max: vo2Max,
        heartRateRecoveryBpm: hrRecovery,
        oxygenSaturation: oxygen,
        sleep: sleepDetail,
        sleepScore: round(sleepScore, 1),
        cardioLoadRaw: hasLoad ? round(dailyLoad, 1) : null,
        workoutCount: workouts.length,
        workoutMinutes: round(workouts.reduce(function (sum, workout) { return sum + workout.durationMin; }, 0), 1) || 0,
        workouts: workouts,
        readiness: readiness
      };
      days.push(day);
      scores.push({
        id: "score-" + entry.date + "-readiness",
        kind: "readiness_proxy",
        window: dayWindow(entry.date, timezone),
        value: readinessValue,
        unit: "score",
        state: readinessState,
        confidence: confidence,
        components: readinessComponents,
        algorithm: readiness.algorithm
      });
      buildFeature(features, entry.date, "hrv_sdnn", hrv, "ms", sourceIds(raw, "hrvSdnnMs"), timezone, "daily mean of HealthKit HRV SDNN samples", hrv === null ? "no HRV SDNN observation" : null);
      buildFeature(features, entry.date, "resting_heart_rate", rhr, "bpm", sourceIds(raw, "restingHeartRateBpm"), timezone, "daily mean of resting heart rate samples", rhr === null ? "no resting heart rate observation" : null);
      buildFeature(features, entry.date, "respiratory_rate", resp, "breaths/min", sourceIds(raw, "respiratoryRate"), timezone, "daily mean of respiratory rate samples", resp === null ? "no respiratory rate observation" : null);
      buildFeature(features, entry.date, "cardio_load", day.cardioLoadRaw, "load units", workouts.map(function (workout) { return workout.id; }), timezone, "sum(duration * reserve * 0.64 * exp(1.92 * reserve)) across workouts", day.cardioLoadRaw === null ? "no workout heart-rate coverage or no usable heart-rate maximum" : null);

      if (hrv !== null) histories.hrvSdnnMs.push(hrv);
      if (rhr !== null) {
        histories.restingHeartRateBpm.push(rhr);
        lastRhr = rhr;
      }
      if (resp !== null) histories.respiratoryRate.push(resp);
      if (sleepDetail) {
        const onset = timeOfDayMinutes(sleepDetail.start);
        const wake = timeOfDayMinutes(sleepDetail.end);
        if (onset !== null) histories.sleepOnset.push(onset);
        if (wake !== null) histories.sleepWake.push(wake);
      }
    });

    const metadata = {
      recordCount: context.recordCount,
      retainedObservationCount: context.retainedObservationCount,
      recordTypes: context.recordTypes,
      sourceBuckets: context.sourceBuckets,
      dateRange: { start: firstDate, end: lastDate },
      workoutCount: context.workouts.length,
      latestAvailableDate: lastDate,
      latestSleepDate: days.slice().reverse().find(function (item) { return item.sleep; }) ? days.slice().reverse().find(function (item) { return item.sleep; }).date : null,
      latestVitalsDate: days.slice().reverse().find(function (item) { return item.hrvSdnnMs !== null || item.restingHeartRateBpm !== null || item.respiratoryRate !== null; }) ? days.slice().reverse().find(function (item) { return item.hrvSdnnMs !== null || item.restingHeartRateBpm !== null || item.respiratoryRate !== null; }).date : null,
      latestWorkoutDate: days.slice().reverse().find(function (item) { return item.workoutCount > 0; }) ? days.slice().reverse().find(function (item) { return item.workoutCount > 0; }).date : null,
      coverage: {
        sleepDays: days.filter(function (item) { return item.sleep; }).length,
        hrvDays: days.filter(function (item) { return item.hrvSdnnMs !== null; }).length,
        restingHeartRateDays: days.filter(function (item) { return item.restingHeartRateBpm !== null; }).length,
        respiratoryRateDays: days.filter(function (item) { return item.respiratoryRate !== null; }).length,
        workoutDays: days.filter(function (item) { return item.workoutCount > 0; }).length,
        stepsDays: days.filter(function (item) { return item.steps !== null; }).length
      },
      unsupportedTypes: Object.keys(context.recordTypes).filter(function (type) { return ALL_SUPPORTED_TYPES.indexOf(type) < 0; }).sort(),
      parseWarnings: context.warningCount,
      hrMaxUsed: hrMax,
      hrMaxSource: configuredHrMax !== null ? "user context" : (hrMax === null ? null : "observed export peak")
    };
    const importedAt = context.importedAt;
    const sync = {
      status: "complete",
      adapter: "health_export",
      lastAttemptAt: importedAt,
      lastSuccessAt: importedAt,
      cursor: null,
      typesRead: Object.keys(context.recordTypes).filter(function (type) { return ALL_SUPPORTED_TYPES.indexOf(type) >= 0; }).sort(),
      typesUnavailable: ALL_SUPPORTED_TYPES.filter(function (type) { return !context.recordTypes[type]; }),
      error: null
    };
    const datasetId = "health-export-" + stableHash([firstDate, lastDate, context.recordCount, context.retainedObservationCount].join("|"));
    return {
      schemaVersion: "1.0.0",
      datasetId: datasetId,
      timezone: timezone,
      observations: context.observations,
      features: features,
      scores: scores,
      sync: sync,
      metadata: metadata,
      days: days,
      workouts: context.workouts
    };
  }

  function datasetFromRows(rows) {
    const sorted = rows.filter(function (row) { return row && row.date; }).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    const days = sorted.map(function (row) {
      return {
        date: row.date,
        hrvSdnnMs: row.hrvSdnnMs !== undefined ? row.hrvSdnnMs : row.hrv,
        restingHeartRateBpm: row.restingHeartRateBpm !== undefined ? row.restingHeartRateBpm : row.rhr,
        respiratoryRate: row.respiratoryRate !== undefined ? row.respiratoryRate : row.resp,
        activeEnergyKcal: row.activeEnergyKcal !== undefined ? row.activeEnergyKcal : row.active,
        steps: row.steps === undefined ? null : row.steps,
        walkingDistanceKm: row.walkingDistanceKm !== undefined ? row.walkingDistanceKm : row.distance,
        exerciseMinutes: row.exerciseMinutes !== undefined ? row.exerciseMinutes : row.exercise,
        sleepScore: row.sleepScore !== undefined ? row.sleepScore : row.sleep,
        cardioLoadRaw: row.cardioLoadRaw !== undefined ? row.cardioLoadRaw : row.load,
        sleep: row.sleep || null,
        workoutCount: row.workoutCount || 0,
        workoutMinutes: row.workoutMinutes || 0,
        workouts: row.workouts || [],
        readiness: row.readiness || { value: row.recovery === undefined ? null : row.recovery, state: row.recovery === undefined ? "insufficient_data" : "provisional", confidence: null, components: [] }
      };
    });
    return {
      schemaVersion: "1.0.0",
      datasetId: "json-" + stableHash(JSON.stringify(sorted.slice(0, 3)) + sorted.length),
      timezone: "UTC",
      observations: [],
      features: [],
      scores: [],
      sync: { status: "complete", adapter: "health_export", lastAttemptAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), cursor: null, typesRead: [], typesUnavailable: [], error: null },
      metadata: {
        recordCount: sorted.length,
        retainedObservationCount: 0,
        recordTypes: {},
        sourceBuckets: {},
        dateRange: { start: days[0] ? days[0].date : null, end: days[days.length - 1] ? days[days.length - 1].date : null },
        workoutCount: days.reduce(function (sum, day) { return sum + day.workoutCount; }, 0),
        latestAvailableDate: days[days.length - 1] ? days[days.length - 1].date : null,
        latestSleepDate: null,
        latestVitalsDate: null,
        latestWorkoutDate: null,
        coverage: {},
        unsupportedTypes: [],
        parseWarnings: 0
      },
      days: days,
      workouts: days.reduce(function (all, day) { return all.concat(day.workouts || []); }, [])
    };
  }

  async function load(file, options, onProgress) {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".json")) {
      onProgress && onProgress("Reading local JSON export…");
      const value = JSON.parse(await file.text());
      if (value && value.days && value.metadata) return value;
      if (Array.isArray(value)) return datasetFromRows(value);
      throw new Error("JSON must contain Pulsefield days or an array of daily records");
    }
    onProgress && onProgress(lowerName.endsWith(".zip") ? "Opening Apple Health ZIP locally…" : "Opening Apple Health XML locally…");
    const source = await openXmlSource(file);
    const parsed = await scanXml(source.stream, source.totalBytes, onProgress);
    if (!parsed.recordCount && !parsed.workouts.length) throw new Error("No Apple Health records or workouts were found");
    return buildDataset(parsed, options || {});
  }

  window.PulsefieldHealthImport = { load: load };
}());
