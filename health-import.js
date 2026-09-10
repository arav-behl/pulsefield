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
  const CARDIO_LOAD_PROFILES = {
    male: { id: "male", label: "male reference", reserveCoefficient: 0.64, intensityCoefficient: 1.92 },
    female: { id: "female", label: "female reference", reserveCoefficient: 0.86, intensityCoefficient: 1.67 }
  };

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
        return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : _;
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
    return [
      id,
      kind,
      start,
      end,
      value,
      unit,
      "observed",
      attributes.sourceName || "Apple Health export",
      attributes.sourceVersion || null,
      attributes.device || null,
      attributes.uuid || null,
      importedAt
    ];
  }

  function materializeObservation(row) {
    return {
      id: row[0],
      kind: row[1],
      start: row[2],
      end: row[3],
      value: row[4],
      unit: row[5],
      quality: row[6],
      provenance: {
        adapter: "health_export",
        source: row[7],
        sourceRevision: row[8],
        device: row[9],
        sourceRecordId: row[10],
        observedAt: row[2],
        importedAt: row[11],
        queryId: null
      }
    };
  }

  function observationIndex(property, length) {
    if (typeof property !== "string" || !/^(0|[1-9]\d*)$/.test(property)) return null;
    const index = Number(property);
    return Number.isSafeInteger(index) && index >= 0 && index < length ? index : null;
  }

  function lazyObservations(rows) {
    if (typeof Proxy === "undefined") return rows.map(materializeObservation);
    const target = [];
    target.length = rows.length;
    return new Proxy(target, {
      get: function (array, property, receiver) {
        const index = observationIndex(property, rows.length);
        if (index !== null) return materializeObservation(rows[index]);
        if (property === "toJSON") return function () { return rows.map(materializeObservation); };
        return Reflect.get(array, property, receiver);
      },
      has: function (array, property) {
        return observationIndex(property, rows.length) !== null || Reflect.has(array, property);
      },
      ownKeys: function (array) {
        return Array.from({ length: rows.length }, function (_, index) { return String(index); }).concat(Reflect.ownKeys(array));
      },
      getOwnPropertyDescriptor: function (array, property) {
        const index = observationIndex(property, rows.length);
        if (index !== null) return { configurable: true, enumerable: true, value: materializeObservation(rows[index]), writable: false };
        return Reflect.getOwnPropertyDescriptor(array, property);
      }
    });
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
      observations: [],
      bufferTruncations: 0
    };
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let bytesRead = 0;
    let lastReported = 0;

    function elementBoundary(text, startIndex, name) {
      const openEnd = text.indexOf(">", startIndex);
      if (openEnd < 0) return null;
      const nextRecord = text.indexOf("<Record ", startIndex + 1);
      const nextWorkout = text.indexOf("<Workout ", startIndex + 1);
      if ((nextRecord >= 0 && nextRecord < openEnd) || (nextWorkout >= 0 && nextWorkout < openEnd)) return null;
      if (text.charAt(openEnd - 1) === "/") return { openEnd: openEnd, end: openEnd + 1 };
      const closeTag = "</" + name + ">";
      const closeIndex = text.indexOf(closeTag, openEnd + 1);
      return closeIndex < 0 ? null : { openEnd: openEnd, end: closeIndex + closeTag.length };
    }

    function nextCompleteElement(text, fromIndex) {
      let recordIndex = text.indexOf("<Record ", fromIndex);
      let workoutIndex = text.indexOf("<Workout ", fromIndex);
      while (recordIndex >= 0 || workoutIndex >= 0) {
        const isRecord = recordIndex >= 0 && (workoutIndex < 0 || recordIndex < workoutIndex);
        const startIndex = isRecord ? recordIndex : workoutIndex;
        const boundary = elementBoundary(text, startIndex, isRecord ? "Record" : "Workout");
        if (boundary) return startIndex;
        if (isRecord) recordIndex = text.indexOf("<Record ", startIndex + 1);
        else workoutIndex = text.indexOf("<Workout ", startIndex + 1);
      }
      return -1;
    }

    function retainStalledSuffix(text) {
      const recordIndex = text.lastIndexOf("<Record ");
      const workoutIndex = text.lastIndexOf("<Workout ");
      const startIndex = Math.max(recordIndex, workoutIndex);
      if (startIndex >= 0 && text.length - startIndex <= 64 * 1024) return text.slice(startIndex);
      return text.slice(-512);
    }

    function consume() {
      let cursor = 0;
      while (true) {
        const recordIndex = buffer.indexOf("<Record ", cursor);
        const workoutIndex = buffer.indexOf("<Workout ", cursor);
        if (recordIndex < 0 && workoutIndex < 0) break;
        const isRecord = recordIndex >= 0 && (workoutIndex < 0 || recordIndex < workoutIndex);
        const startIndex = isRecord ? recordIndex : workoutIndex;
        const boundary = elementBoundary(buffer, startIndex, isRecord ? "Record" : "Workout");
        if (!boundary) break;
        if (isRecord) parseRecord(buffer.slice(startIndex, boundary.openEnd + 1), context);
        else parseWorkout(buffer.slice(startIndex, boundary.openEnd + 1), context);
        cursor = boundary.end;
      }
      if (cursor > 0) buffer = buffer.slice(cursor);
      if (cursor === 0 && buffer.length > 2 * 1024 * 1024) {
        const recoverableStart = nextCompleteElement(buffer, 1);
        if (recoverableStart > 0) {
          context.bufferTruncations += 1;
          buffer = buffer.slice(recoverableStart);
          consume();
          return;
        }
        const retained = retainStalledSuffix(buffer);
        if (retained.length < buffer.length) {
          context.bufferTruncations += 1;
          buffer = retained;
        }
      }
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
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error("ZIP64 archives are not supported here. Upload export.xml directly.");
    }
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
        previous.end = previous.endMs > epoch(previous.end) ? preserveTimestampOffset(previous.end, previous.endMs) : previous.end;
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

  function preserveTimestampOffset(original, timestampMs) {
    const suffixMatch = String(original || "").match(/(Z|[+-]\d{2}:\d{2})$/);
    if (!suffixMatch || suffixMatch[1] === "Z") return new Date(timestampMs).toISOString();
    const offset = suffixMatch[1];
    const sign = offset.charAt(0) === "-" ? -1 : 1;
    const offsetMinutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
    return new Date(timestampMs + offsetMinutes * 60000).toISOString().replace("Z", "") + offset;
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

  function cardioLoadProfile(value) {
    const key = String(value || "male").toLowerCase();
    return CARDIO_LOAD_PROFILES[key] || CARDIO_LOAD_PROFILES.male;
  }

  function cardioLoad(durationMin, heartRate, rest, maximum, profile) {
    if (durationMin <= 0 || heartRate === null || rest === null || maximum === null || maximum <= rest) return null;
    const reserve = Math.max(0, Math.min(1, (heartRate - rest) / (maximum - rest)));
    return durationMin * reserve * profile.reserveCoefficient * Math.exp(profile.intensityCoefficient * reserve);
  }

  function algorithm(name, formula, missingDataPolicy) {
    return { name: name, version: ALGORITHM_VERSION, formula: formula, missingDataPolicy: missingDataPolicy };
  }

  function createDayWindowFactory(timezone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const cache = new Map();
    function timezoneOffsetMs(date) {
      const parts = formatter.formatToParts(date).reduce(function (result, part) {
        if (part.type !== "literal") result[part.type] = part.value;
        return result;
      }, {});
      const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      return asUtc - date.getTime();
    }
    function zonedMidnight(date) {
      const guess = new Date(date + "T00:00:00.000Z");
      const firstOffset = timezoneOffsetMs(guess);
      const first = new Date(guess.getTime() - firstOffset);
      const secondOffset = timezoneOffsetMs(first);
      return new Date(guess.getTime() - secondOffset).toISOString();
    }
    return function (date) {
      if (!cache.has(date)) cache.set(date, { start: zonedMidnight(date), end: zonedMidnight(addDays(date, 1)), timezone: timezone });
      return cache.get(date);
    };
  }

  function buildFeature(features, date, kind, value, unit, inputs, windowForDate, formula, missingReason) {
    features.push({
      id: "feature-" + date + "-" + kind,
      kind: kind,
      window: windowForDate(date),
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
    const windowForDate = createDayWindowFactory(timezone);
    const selectedCardioProfile = cardioLoadProfile(settings.cardioLoadProfile);
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
        workout.cardioLoadProfile = selectedCardioProfile.id;
        workout.cardioLoadRaw = cardioLoad(workout.durationMin, workout.hrAvgBpm, rest, hrMax, selectedCardioProfile);
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
        buildFeature(features, entry.date, "sleep_score", round(sleepScore, 1), "score", sleepIds, windowForDate, "0.50*sufficiency + 0.30*efficiency + 0.20*timing_consistency when timing history exists");
      } else {
        buildFeature(features, entry.date, "sleep_score", null, "score", [], windowForDate, "0.50*sufficiency + 0.30*efficiency + 0.20*timing_consistency", "missing a valid in-bed and asleep interval");
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
        window: windowForDate(entry.date),
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
        window: windowForDate(entry.date),
        value: readinessValue,
        unit: "score",
        state: readinessState,
        confidence: confidence,
        components: readinessComponents,
        algorithm: readiness.algorithm
      });
      buildFeature(features, entry.date, "hrv_sdnn", hrv, "ms", sourceIds(raw, "hrvSdnnMs"), windowForDate, "daily mean of HealthKit HRV SDNN samples", hrv === null ? "no HRV SDNN observation" : null);
      buildFeature(features, entry.date, "resting_heart_rate", rhr, "bpm", sourceIds(raw, "restingHeartRateBpm"), windowForDate, "daily mean of resting heart rate samples", rhr === null ? "no resting heart rate observation" : null);
      buildFeature(features, entry.date, "respiratory_rate", resp, "breaths/min", sourceIds(raw, "respiratoryRate"), windowForDate, "daily mean of respiratory rate samples", resp === null ? "no respiratory rate observation" : null);
      buildFeature(features, entry.date, "cardio_load", day.cardioLoadRaw, "load units", workouts.map(function (workout) { return workout.id; }), windowForDate, "sum(duration * reserve * " + selectedCardioProfile.reserveCoefficient + " * exp(" + selectedCardioProfile.intensityCoefficient + " * reserve)) using " + selectedCardioProfile.label + " coefficients", day.cardioLoadRaw === null ? "no workout heart-rate coverage or no usable heart-rate maximum" : null);

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
      bufferTruncations: context.bufferTruncations,
      bufferTruncated: context.bufferTruncations > 0,
      hrMaxUsed: hrMax,
      hrMaxSource: configuredHrMax !== null ? "user context" : (hrMax === null ? null : "observed export peak"),
      cardioLoad: {
        profile: selectedCardioProfile.id,
        reference: selectedCardioProfile.label,
        reserveCoefficient: selectedCardioProfile.reserveCoefficient,
        intensityCoefficient: selectedCardioProfile.intensityCoefficient,
        note: "Reference coefficients are an explicit modeling choice, not a medical classification."
      }
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
      observations: lazyObservations(context.observations),
      features: features,
      scores: scores,
      sync: sync,
      metadata: metadata,
      days: days,
      workouts: context.workouts
    };
  }

  function validatedSleepOrNull(value, path) {
    if (value === null || value === undefined || !isObject(value)) return null;
    try {
      validateSleep(value, path);
      return value;
    } catch (error) {
      return null;
    }
  }

  function datasetFromRows(rows) {
    const sorted = rows.filter(function (row) { return row && row.date; }).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    const days = sorted.map(function (row, index) {
      return {
        date: row.date,
        hrvSdnnMs: row.hrvSdnnMs !== undefined ? row.hrvSdnnMs : row.hrv,
        restingHeartRateBpm: row.restingHeartRateBpm !== undefined ? row.restingHeartRateBpm : row.rhr,
        respiratoryRate: row.respiratoryRate !== undefined ? row.respiratoryRate : row.resp,
        activeEnergyKcal: row.activeEnergyKcal !== undefined ? row.activeEnergyKcal : row.active,
        steps: row.steps === undefined ? null : row.steps,
        walkingDistanceKm: row.walkingDistanceKm !== undefined ? row.walkingDistanceKm : row.distance,
        exerciseMinutes: row.exerciseMinutes !== undefined ? row.exerciseMinutes : row.exercise,
        sleepScore: row.sleepScore !== undefined ? row.sleepScore : (typeof row.sleep === "number" ? row.sleep : null),
        cardioLoadRaw: row.cardioLoadRaw !== undefined ? row.cardioLoadRaw : row.load,
        sleep: validatedSleepOrNull(row.sleep, "rows[" + index + "].sleep"),
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

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validationError(path, message) {
    throw new Error("Invalid Pulsefield JSON: " + path + " " + message);
  }

  function hasProperty(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function requireProperty(value, key, path) {
    if (!hasProperty(value, key)) validationError(path + "." + key, "is required.");
  }

  function requireObject(value, path) {
    if (!isObject(value)) validationError(path, "must be an object.");
    return value;
  }

  function requireArray(value, path) {
    if (!Array.isArray(value)) validationError(path, "must be an array.");
    return value;
  }

  function validateNullableNumber(value, path) {
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) validationError(path, "must be a finite number or null.");
  }

  function validateDate(value, path, allowNull) {
    if (allowNull && value === null) return;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + "T12:00:00Z"))) validationError(path, allowNull ? "must be an ISO date or null." : "must be an ISO date.");
  }

  function validateDateTime(value, path, allowNull) {
    if (allowNull && value === null) return;
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) validationError(path, allowNull ? "must be an ISO date-time or null." : "must be an ISO date-time.");
  }

  function validateWindow(value, path) {
    const window = requireObject(value, path);
    ["start", "end", "timezone"].forEach(key => requireProperty(window, key, path));
    validateDateTime(window.start, path + ".start");
    validateDateTime(window.end, path + ".end");
    if (typeof window.timezone !== "string" || !window.timezone) validationError(path + ".timezone", "must be a non-empty string.");
  }

  function validateAlgorithm(value, path) {
    const algorithm = requireObject(value, path);
    ["name", "version", "formula", "missingDataPolicy"].forEach(key => requireProperty(algorithm, key, path));
    ["name", "version", "formula", "missingDataPolicy"].forEach(key => {
      if (typeof algorithm[key] !== "string") validationError(path + "." + key, "must be a string.");
    });
  }

  function validateComponent(value, path, enforceBaselineZ) {
    const component = requireObject(value, path);
    ["kind", "value", "weight", "status", "inputs"].forEach(key => requireProperty(component, key, path));
    if (typeof component.kind !== "string" || !component.kind) validationError(path + ".kind", "must be a non-empty string.");
    validateNullableNumber(component.value, path + ".value");
    if (typeof component.weight !== "number" || !Number.isFinite(component.weight) || component.weight < 0) validationError(path + ".weight", "must be a non-negative finite number.");
    if (!["available", "missing", "estimated", "calibrating"].includes(component.status)) validationError(path + ".status", "has an unsupported value.");
    requireArray(component.inputs, path + ".inputs").forEach((input, index) => {
      if (typeof input !== "string") validationError(path + ".inputs[" + index + "]", "must be a string.");
    });
    if (hasProperty(component, "note") && typeof component.note !== "string") validationError(path + ".note", "must be a string.");
    if (hasProperty(component, "baselineCount") && (!Number.isInteger(component.baselineCount) || component.baselineCount < 0)) validationError(path + ".baselineCount", "must be a non-negative integer.");
    if (hasProperty(component, "z")) validateNullableNumber(component.z, path + ".z");
    if (enforceBaselineZ && ["hrv_sdnn", "resting_heart_rate", "respiratory_rate"].includes(component.kind) && component.status === "available" && !hasProperty(component, "z")) validationError(path + ".z", "is required for available physiological components.");
  }

  function validateObservation(value, path) {
    const observation = requireObject(value, path);
    ["id", "kind", "start", "end", "value", "unit", "provenance"].forEach(key => requireProperty(observation, key, path));
    ["id", "kind", "unit"].forEach(key => {
      if (typeof observation[key] !== "string" || !observation[key]) validationError(path + "." + key, "must be a non-empty string.");
    });
    validateDateTime(observation.start, path + ".start", false);
    validateDateTime(observation.end, path + ".end", true);
    const provenance = requireObject(observation.provenance, path + ".provenance");
    ["adapter", "source", "observedAt", "importedAt"].forEach(key => requireProperty(provenance, key, path + ".provenance"));
    if (!["healthkit", "health_export", "demo"].includes(provenance.adapter)) validationError(path + ".provenance.adapter", "has an unsupported value.");
    if (typeof provenance.source !== "string") validationError(path + ".provenance.source", "must be a string.");
    validateDateTime(provenance.observedAt, path + ".provenance.observedAt", false);
    validateDateTime(provenance.importedAt, path + ".provenance.importedAt", false);
  }

  function validateFeature(value, path) {
    const feature = requireObject(value, path);
    ["id", "kind", "window", "value", "unit", "inputs", "algorithm"].forEach(key => requireProperty(feature, key, path));
    ["id", "kind", "unit"].forEach(key => {
      if (typeof feature[key] !== "string" || !feature[key]) validationError(path + "." + key, "must be a non-empty string.");
    });
    validateWindow(feature.window, path + ".window");
    requireArray(feature.inputs, path + ".inputs").forEach((input, index) => {
      if (typeof input !== "string") validationError(path + ".inputs[" + index + "]", "must be a string.");
    });
    validateAlgorithm(feature.algorithm, path + ".algorithm");
    if (hasProperty(feature, "missingReason") && feature.missingReason !== null && typeof feature.missingReason !== "string") validationError(path + ".missingReason", "must be a string or null.");
  }

  function validateScore(value, path) {
    const score = requireObject(value, path);
    ["id", "kind", "window", "value", "unit", "state", "confidence", "components", "algorithm"].forEach(key => requireProperty(score, key, path));
    ["id", "kind", "unit"].forEach(key => {
      if (typeof score[key] !== "string" || !score[key]) validationError(path + "." + key, "must be a non-empty string.");
    });
    validateWindow(score.window, path + ".window");
    validateNullableNumber(score.value, path + ".value");
    if (!["calibrating", "insufficient_data", "provisional", "scored"].includes(score.state)) validationError(path + ".state", "has an unsupported value.");
    validateNullableNumber(score.confidence, path + ".confidence");
    requireArray(score.components, path + ".components").forEach((component, index) => validateComponent(component, path + ".components[" + index + "]", true));
    validateAlgorithm(score.algorithm, path + ".algorithm");
  }

  function validateSyncState(value, path) {
    const sync = requireObject(value, path);
    ["status", "adapter", "lastAttemptAt"].forEach(key => requireProperty(sync, key, path));
    if (!["never", "ready", "syncing", "complete", "partial", "error"].includes(sync.status)) validationError(path + ".status", "has an unsupported value.");
    if (!["healthkit", "health_export", "demo", "none"].includes(sync.adapter)) validationError(path + ".adapter", "has an unsupported value.");
    validateDateTime(sync.lastAttemptAt, path + ".lastAttemptAt", true);
    if (hasProperty(sync, "lastSuccessAt")) validateDateTime(sync.lastSuccessAt, path + ".lastSuccessAt", true);
    ["typesRead", "typesUnavailable"].forEach(key => {
      if (hasProperty(sync, key)) requireArray(sync[key], path + "." + key).forEach((item, index) => {
        if (typeof item !== "string") validationError(path + "." + key + "[" + index + "]", "must be a string.");
      });
    });
  }

  function validateSleep(value, path) {
    if (value === null) return;
    const sleep = requireObject(value, path);
    ["inBedMin", "asleepMin", "stages", "start", "end"].forEach(key => requireProperty(sleep, key, path));
    ["inBedMin", "asleepMin"].forEach(key => {
      if (typeof sleep[key] !== "number" || !Number.isFinite(sleep[key]) || sleep[key] < 0) validationError(path + "." + key, "must be a non-negative finite number.");
    });
    const stages = requireObject(sleep.stages, path + ".stages");
    ["deep", "rem", "core", "unspecified", "awake"].forEach(key => {
      requireProperty(stages, key, path + ".stages");
      validateNullableNumber(stages[key], path + ".stages." + key);
    });
    validateDateTime(sleep.start, path + ".start", true);
    validateDateTime(sleep.end, path + ".end", true);
  }

  function validateWorkout(value, path) {
    const workout = requireObject(value, path);
    ["id", "date", "start", "end", "activity", "durationMin"].forEach(key => requireProperty(workout, key, path));
    ["id", "activity"].forEach(key => {
      if (typeof workout[key] !== "string" || !workout[key]) validationError(path + "." + key, "must be a non-empty string.");
    });
    validateDate(workout.date, path + ".date");
    validateDateTime(workout.start, path + ".start", false);
    validateDateTime(workout.end, path + ".end", false);
    if (typeof workout.durationMin !== "number" || !Number.isFinite(workout.durationMin) || workout.durationMin < 0) validationError(path + ".durationMin", "must be a non-negative finite number.");
    ["energyKcal", "distanceKm", "hrAvgBpm", "cardioLoadRaw", "hrCoverage"].forEach(key => {
      if (hasProperty(workout, key)) validateNullableNumber(workout[key], path + "." + key);
    });
    if (hasProperty(workout, "hrSamples") && (!Number.isInteger(workout.hrSamples) || workout.hrSamples < 0)) validationError(path + ".hrSamples", "must be a non-negative integer.");
    if (hasProperty(workout, "cardioLoadProfile") && !["male", "female"].includes(workout.cardioLoadProfile)) validationError(path + ".cardioLoadProfile", "has an unsupported value.");
  }

  function validateImportedDataset(value) {
    const dataset = requireObject(value, "dataset");
    ["schemaVersion", "metadata", "days", "workouts"].forEach(key => requireProperty(dataset, key, "dataset"));
    if (typeof dataset.schemaVersion !== "string" || !dataset.schemaVersion) validationError("dataset.schemaVersion", "must be a non-empty string.");
    if (hasProperty(dataset, "datasetId") && (typeof dataset.datasetId !== "string" || !dataset.datasetId)) validationError("dataset.datasetId", "must be a non-empty string.");
    if (hasProperty(dataset, "timezone") && (typeof dataset.timezone !== "string" || !dataset.timezone)) validationError("dataset.timezone", "must be a non-empty string.");

    const metadata = requireObject(dataset.metadata, "dataset.metadata");
    ["recordCount", "recordTypes", "sourceBuckets", "dateRange", "workoutCount", "coverage"].forEach(key => requireProperty(metadata, key, "dataset.metadata"));
    if (!Number.isInteger(metadata.recordCount) || metadata.recordCount < 0) validationError("dataset.metadata.recordCount", "must be a non-negative integer.");
    requireObject(metadata.recordTypes, "dataset.metadata.recordTypes");
    requireObject(metadata.sourceBuckets, "dataset.metadata.sourceBuckets");
    const dateRange = requireObject(metadata.dateRange, "dataset.metadata.dateRange");
    ["start", "end"].forEach(key => requireProperty(dateRange, key, "dataset.metadata.dateRange"));
    validateDate(dateRange.start, "dataset.metadata.dateRange.start", true);
    validateDate(dateRange.end, "dataset.metadata.dateRange.end", true);
    if (!Number.isInteger(metadata.workoutCount) || metadata.workoutCount < 0) validationError("dataset.metadata.workoutCount", "must be a non-negative integer.");
    requireObject(metadata.coverage, "dataset.metadata.coverage");
    if (hasProperty(metadata, "cardioLoad")) {
      const cardioLoad = requireObject(metadata.cardioLoad, "dataset.metadata.cardioLoad");
      ["profile", "reference", "reserveCoefficient", "intensityCoefficient", "note"].forEach(key => requireProperty(cardioLoad, key, "dataset.metadata.cardioLoad"));
      if (!["male", "female"].includes(cardioLoad.profile)) validationError("dataset.metadata.cardioLoad.profile", "has an unsupported value.");
      ["reference", "note"].forEach(key => {
        if (typeof cardioLoad[key] !== "string" || !cardioLoad[key]) validationError("dataset.metadata.cardioLoad." + key, "must be a non-empty string.");
      });
      ["reserveCoefficient", "intensityCoefficient"].forEach(key => {
        if (typeof cardioLoad[key] !== "number" || !Number.isFinite(cardioLoad[key]) || cardioLoad[key] <= 0) validationError("dataset.metadata.cardioLoad." + key, "must be a positive finite number.");
      });
    }
    ["latestAvailableDate", "latestSleepDate", "latestVitalsDate", "latestWorkoutDate"].forEach(key => {
      if (hasProperty(metadata, key)) validateDate(metadata[key], "dataset.metadata." + key, true);
    });
    if (hasProperty(metadata, "parseWarnings") && (!Number.isInteger(metadata.parseWarnings) || metadata.parseWarnings < 0)) validationError("dataset.metadata.parseWarnings", "must be a non-negative integer.");

    const days = requireArray(dataset.days, "dataset.days");
    days.forEach((day, index) => {
      const path = "dataset.days[" + index + "]";
      const row = requireObject(day, path);
      ["date", "heartRateBpm", "heartRateSamples", "hrvSdnnMs", "restingHeartRateBpm", "respiratoryRate", "activeEnergyKcal", "basalEnergyKcal", "steps", "exerciseMinutes", "walkingDistanceKm", "vo2Max", "heartRateRecoveryBpm", "oxygenSaturation", "sleep", "sleepScore", "cardioLoadRaw", "workoutCount", "workoutMinutes", "workouts", "readiness"].forEach(key => requireProperty(row, key, path));
      validateDate(row.date, path + ".date", false);
      ["heartRateBpm", "hrvSdnnMs", "restingHeartRateBpm", "respiratoryRate", "activeEnergyKcal", "basalEnergyKcal", "steps", "exerciseMinutes", "walkingDistanceKm", "vo2Max", "heartRateRecoveryBpm", "oxygenSaturation", "sleepScore", "cardioLoadRaw", "workoutMinutes"].forEach(key => validateNullableNumber(row[key], path + "." + key));
      if (!Number.isInteger(row.heartRateSamples) || row.heartRateSamples < 0) validationError(path + ".heartRateSamples", "must be a non-negative integer.");
      if (!Number.isInteger(row.workoutCount) || row.workoutCount < 0) validationError(path + ".workoutCount", "must be a non-negative integer.");
      validateSleep(row.sleep, path + ".sleep");
      const readiness = requireObject(row.readiness, path + ".readiness");
      ["value", "state", "confidence", "components"].forEach(key => requireProperty(readiness, key, path + ".readiness"));
      validateNullableNumber(readiness.value, path + ".readiness.value");
      if (!["calibrating", "insufficient_data", "provisional", "scored"].includes(readiness.state)) validationError(path + ".readiness.state", "has an unsupported value.");
      validateNullableNumber(readiness.confidence, path + ".readiness.confidence");
      requireArray(readiness.components, path + ".readiness.components").forEach((component, componentIndex) => validateComponent(component, path + ".readiness.components[" + componentIndex + "]", false));
      if (hasProperty(readiness, "algorithm")) validateAlgorithm(readiness.algorithm, path + ".readiness.algorithm");
      requireArray(row.workouts, path + ".workouts").forEach((workout, workoutIndex) => validateWorkout(workout, path + ".workouts[" + workoutIndex + "]"));
    });

    requireArray(dataset.workouts, "dataset.workouts").forEach((workout, index) => validateWorkout(workout, "dataset.workouts[" + index + "]"));

    const canonicalFields = ["observations", "features", "scores", "sync"];
    const hasCanonicalFields = canonicalFields.some(key => hasProperty(dataset, key));
    if (hasCanonicalFields) {
      canonicalFields.forEach(key => requireProperty(dataset, key, "dataset"));
      requireArray(dataset.observations, "dataset.observations").forEach((observation, index) => validateObservation(observation, "dataset.observations[" + index + "]"));
      requireArray(dataset.features, "dataset.features").forEach((feature, index) => validateFeature(feature, "dataset.features[" + index + "]"));
      requireArray(dataset.scores, "dataset.scores").forEach((score, index) => validateScore(score, "dataset.scores[" + index + "]"));
      validateSyncState(dataset.sync, "dataset.sync");
    }
    return dataset;
  }

  async function load(file, options, onProgress) {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".json")) {
      onProgress && onProgress("Reading local JSON export…");
      const value = JSON.parse(await file.text());
      if (value && value.days && value.metadata) return validateImportedDataset(value);
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
