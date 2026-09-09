const personalDataset = window.PULSEFIELD_PERSONAL_DATA || null;
function personalDataRows(dataset) {
  return dataset.days.map(item => ({
    date: item.date,
    recovery: item.readiness && item.readiness.value,
    sleep: item.sleepScore,
    load: item.cardioLoadRaw,
    hrv: item.hrvSdnnMs,
    rhr: item.restingHeartRateBpm,
    resp: item.respiratoryRate,
    hours: item.sleep ? item.sleep.asleepMin / 60 : null,
    active: item.activeEnergyKcal,
    exercise: item.exerciseMinutes,
    steps: item.steps,
    distance: item.walkingDistanceKm,
    sleepDetail: item.sleep,
    readiness: item.readiness,
    workoutCount: item.workoutCount,
    workoutMinutes: item.workoutMinutes,
    vo2Max: item.vo2Max,
    heartRateRecoveryBpm: item.heartRateRecoveryBpm,
    workouts: item.workouts || []
  }));
}
const initialDataset = personalDataset && personalDataset.days && personalDataset.days.length ? personalDataset : null;
const initialData = initialDataset ? personalDataRows(initialDataset) : demoData();
const state = {
  day: initialData.length - 1,
  data: initialData,
  dataset: initialDataset,
  source: initialDataset ? "personal" : "demo",
  context: loadContext(),
  trendRange: null,
  sync: initialDataset ? { status:"complete", label:"local export loaded", last:(initialDataset.metadata && initialDataset.metadata.latestAvailableDate) || "export" } : { status: "never", label: "not connected", last: "no sync yet" }
};
const $ = (s) => document.querySelector(s);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[character])); }

function demoData() {
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const rows = [[63,72,15.2,54,58,6.4,810,67],[71,81,9.4,59,56,7.3,540,42],[68,77,12.1,56,57,6.9,684,51],[75,88,7.8,62,54,7.9,477,29],[82,91,13.6,67,53,8.2,942,74],[79,86,10.2,65,54,7.7,608,46],[78,84,11.8,64,54,7.53,642,48]];
  return rows.map((r, i) => { const d = new Date(today); d.setDate(today.getDate() - 6 + i); return { date: d.toISOString().slice(0,10), recovery:r[0], sleep:r[1], load:r[2], hrv:r[3], rhr:r[4], hours:r[5], active:r[6], exercise:r[7] }; });
}
function day() { return state.data[state.day]; }
function fmtDate(s) { return new Intl.DateTimeFormat(undefined, { weekday:"long", month:"long", day:"numeric" }).format(new Date(`${s}T12:00:00`)); }
function shortDate(s) { return new Intl.DateTimeFormat(undefined, { weekday:"short" }).format(new Date(`${s}T12:00:00`)); }
function duration(h) { const m = Math.round(h * 60); return `${Math.floor(m/60)}h ${m%60}m`; }
function set(s, value) { const e = $(s); if (e) e.textContent = value; }
function loadContext() {
  try { return JSON.parse(localStorage.getItem("pulsefield-context")) || { goal:"awareness", sleepTarget:8, timezone:Intl.DateTimeFormat().resolvedOptions().timeZone }; }
  catch { return { goal:"awareness", sleepTarget:8, timezone:"UTC" }; }
}
function setSync(status, label, last) {
  state.sync = { status, label, last };
  const dot = $("#syncDot");
  if (dot) dot.className = "sync-dot " + (status === "complete" ? "complete" : status === "error" ? "error" : status === "ready" ? "ready" : "");
  set("#syncState", label); set("#syncLast", last);
}

function render() {
  const d = day();
  set("#dashboardDate", fmtDate(d.date)); set("#recoveryValue", Math.round(d.recovery)); set("#sleepValue", Math.round(d.sleep)); set("#loadValue", d.load.toFixed(1));
  set("#hrvValue", `${d.hrv} ms`); set("#rhrValue", `${d.rhr} bpm`); set("#sleepCopy", `${duration(d.hours)} asleep · 8h 58m in bed.`); set("#activeValue", `${d.active} kcal`); set("#exerciseValue", `${d.exercise} min`);
  const band = d.recovery >= 67 ? "GREEN" : d.recovery >= 34 ? "YELLOW" : "RED"; set("#recoveryBadge", band); set("#recoveryCopy", band === "GREEN" ? "Your system looks ready for a challenging day." : "A lighter day may help your system catch up.");
  $("#recoveryMeter").style.width = `${d.recovery}%`; $("#loadArc").style.width = `${clamp(d.load, 4, 100)}%`;
  renderChart(); renderInsights(d); renderSleep(); renderActivities(); renderMovement(); renderWildVisuals();
}

function renderChart() {
  const w = 720, h = 190, path = (vals) => vals.map((v,i) => `${i ? "L" : "M"}${(i/6*w).toFixed(1)},${(h-v/100*h).toFixed(1)}`).join(" ");
  const series = [["recovery", state.data.map(d=>d.recovery), "#9fdda7"],["sleep", state.data.map(d=>d.sleep), "#c5b8f8"],["load", state.data.map(d=>Math.min(100, d.load)), "#f0c58c"]];
  const grid = [0,25,50,75,100].map(v=>`<line class="chart-grid-line" x1="0" y1="${h-v/100*h}" x2="${w}" y2="${h-v/100*h}"/>`).join("");
  const lines = series.map(([name, vals, color])=>`<path class="chart-line ${name}" d="${path(vals)}"/>${vals.map((v,i)=>`<circle class="chart-point" cx="${i/6*w}" cy="${h-v/100*h}" r="${i===state.day?5:3}" fill="${color}"/>`).join("")}`).join("");
  $("#trendChart").innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${grid}${lines}</svg>`;
  $("#chartLabels").innerHTML = state.data.map((d,i)=>`<span class="${i===state.day?'active':''}">${shortDate(d.date)}</span>`).join("");
}
function renderInsights(d) {
  const prev = state.data[Math.max(0,state.day-1)], delta = Math.round(d.hrv-prev.hrv);
  const items = [["↗",`HRV is ${delta>=0?'up':'down'} ${Math.abs(delta)} ms from yesterday`,"Trend beats a single reading."],["☾",`${duration(d.hours)} asleep last night`,d.sleep>=85?"You covered most of your sleep need.":"There is room to close the sleep gap."],["◌","Respiratory rate is holding steady","No meaningful overnight shift detected."]];
  $("#insightList").innerHTML = items.map(([icon,title,copy])=>`<div class="insight-item"><span class="insight-icon">${icon}</span><div><strong>${title}</strong><p>${copy}</p></div></div>`).join("");
}
function renderSleep() { const stages = ["core","core","deep","deep","rem","core","awake","core","rem","core","deep","core","core","rem","awake","core","rem","core","deep","core","core","rem","core","awake","core","rem","core","deep","core","core","rem","core","awake","core","rem","core","deep","core","core","rem","core","awake"]; $("#sleepTimeline").innerHTML = stages.map(s=>`<i class="${s}"></i>`).join(""); }
function renderActivities() { const rows = [["Running","Today","48 min","642 kcal"],["Outdoor walk","Yesterday","31 min","184 kcal"],["Strength training","Tue","42 min","291 kcal"]]; $("#activityTable").innerHTML = rows.map(([name,date,time,kcal])=>`<div class="activity-row"><div class="activity-name"><span class="activity-icon">✦</span>${name}</div><div class="activity-date">${date}</div><div class="activity-value"><span>time</span>${time}</div><div class="activity-value"><span>energy</span>${kcal}</div></div>`).join(""); }

function personalWindow() {
  const start = Math.max(0, state.day - 6);
  return state.data.slice(start, state.day + 1);
}
function valueOrDash(value, suffix) {
  return value === null || value === undefined || Number.isNaN(value) ? "—" : String(Math.round(value * 10) / 10) + (suffix || "");
}
function recentCoverage(days) {
  if (!days.length) return 0;
  const checks = days.flatMap(item => [item.sleep, item.hrv !== null && item.hrv !== undefined, item.rhr !== null && item.rhr !== undefined, item.resp !== null && item.resp !== undefined]);
  return Math.round(100 * checks.filter(Boolean).length / checks.length);
}
function render() {
  const d = day();
  const personal = state.source === "personal";
  const meta = state.dataset && state.dataset.metadata;
  const partial = personal && meta && d.date === meta.latestAvailableDate;
  set("#dashboardDate", fmtDate(d.date) + (partial ? " · partial export" : ""));
  set("#readoutContext", partial ? "Latest available day · partial export" : analysisReady(d) ? "Analysis-ready day · 3+ signals present" : "Historical day · partial signal");
  const dayPicker = $("#dayPicker");
  if (dayPicker && dayPicker.value !== d.date) dayPicker.value = d.date;
  set("#recoveryValue", d.recovery === null || d.recovery === undefined ? "—" : Math.round(d.recovery));
  set("#sleepValue", d.sleep === null || d.sleep === undefined ? "—" : Math.round(d.sleep));
  set("#loadValue", d.load === null || d.load === undefined ? "—" : d.load.toFixed(1));
  set("#hrvValue", valueOrDash(d.hrv, " ms"));
  set("#rhrValue", valueOrDash(d.rhr, " bpm"));
  set("#sleepCopy", d.hours === null || d.hours === undefined ? (personal ? "No recent asleep-stage record in this export." : "No sleep data selected.") : duration(d.hours) + " asleep · " + duration(d.sleepDetail.inBedMin / 60) + " in bed.");
  set("#activeValue", valueOrDash(d.active, " kcal"));
  set("#exerciseValue", valueOrDash(d.exercise, " min"));
  const band = d.recovery === null || d.recovery === undefined ? "NO DATA" : d.recovery >= 67 ? "GREEN" : d.recovery >= 34 ? "YELLOW" : "RED";
  set("#recoveryBadge", band);
  $("#recoveryBadge").className = "score-badge " + (band === "GREEN" ? "score-badge-green" : band === "YELLOW" ? "score-badge-amber" : "score-badge-lilac");
  set("#sleepBadge", d.sleep === null || d.sleep === undefined ? "coverage gap" : "last night");
  set("#loadBadge", d.load === null || d.load === undefined ? "no data" : "estimated");
  set("#recoveryCopy", d.recovery === null || d.recovery === undefined ? "Not scored: current data does not contain enough overnight inputs." : band === "GREEN" ? "Your system looks ready for a challenging day." : "A lighter day may help your system catch up.");
  set("#loadCopy", d.load === null || d.load === undefined ? "No workout heart-rate load calculated for this date." : "Estimated from workout duration and available heart-rate samples.");
  $("#recoveryMeter").style.width = d.recovery === null || d.recovery === undefined ? "0%" : d.recovery + "%";
  $("#loadArc").style.width = d.load === null || d.load === undefined ? "0%" : clamp(d.load, 4, 100) + "%";
  if (personal && meta) {
    set("#importStatus", "Personal export loaded locally · " + Number(meta.recordCount).toLocaleString() + " records · latest activity " + meta.latestAvailableDate);
    set("#syncTitle", "Local export loaded");
    set("#syncCopy", "This is a point-in-time Health export. The native companion can later replace this with anchored sync without changing the schema.");
    setSync("complete", "local export loaded", meta.latestAvailableDate);
    const recent = state.data.slice(-30);
    const coverage = recentCoverage(recent);
    set("#coverageScore", coverage + "%");
    $("#coverageBar").style.width = coverage + "%";
    const percent = predicate => recent.length ? Math.round(100 * recent.filter(predicate).length / recent.length) + "%" : "0%";
    set("#coverageSleep", percent(item => item.sleep !== null && item.sleep !== undefined));
    set("#coverageHeartRate", percent(item => item.hrv !== null || item.rhr !== null));
    set("#coverageWorkouts", percent(item => item.workoutCount > 0));
    set("#coverageCopy", coverage < 50 ? "Recent activity is present, but overnight and vital signals have a coverage gap in this export." : "Recent signals are broadly available.");
  }
  renderAudit(d); renderChart(); renderInsights(d); renderSleep(); renderActivities(); renderMovement(); renderWildVisuals(); bindTooltips();
}
function trendWindow() {
  if (!state.trendRange) return personalWindow();
  return state.data.filter(item => item.date >= state.trendRange.start && item.date <= state.trendRange.end);
}
function chartTooltip(item, name, rawValue) {
  if (name === "movement") return item.date + " · " + valueOrDash(item.steps, " steps") + " · " + valueOrDash(item.distance, " km");
  if (name === "recovery") return item.date + " · readiness " + valueOrDash(item.recovery) + " / 100 · HRV " + valueOrDash(item.hrv, " ms") + " · RHR " + valueOrDash(item.rhr, " bpm");
  if (name === "sleep") return item.date + " · sleep " + valueOrDash(item.sleep) + " · " + (item.hours === null || item.hours === undefined ? "no duration" : duration(item.hours) + " asleep");
  if (name === "load") return item.date + " · load " + valueOrDash(item.load, " units") + " · " + valueOrDash(item.workoutMinutes, " min exercise");
  return item.date + " · " + valueOrDash(rawValue);
}
function renderChart() {
  const visible = trendWindow();
  if (!visible.length) {
    set("#trendHeading", "No signal in selected range");
    $("#trendLegend").innerHTML = "";
    $("#trendChart").innerHTML = '<span class="timeline-empty">No loaded records fall inside this range.</span>';
    $("#chartLabels").innerHTML = "";
    set("#rangeStatus", "no loaded days");
    return;
  }
  const w = 720, h = 190, span = Math.max(1, visible.length - 1);
  const y = value => h - value / 100 * h;
  const path = values => {
    let output = "";
    let started = false, previousIndex = -2;
    values.forEach((value, index) => {
      if (value === null || value === undefined || Number.isNaN(value)) return;
      output += (!started || index !== previousIndex + 1 ? "M" : "L") + (index / span * w).toFixed(1) + "," + y(value).toFixed(1) + " ";
      started = true;
      previousIndex = index;
    });
    return output.trim();
  };
  const scoreSeries = [
    ["recovery", visible.map(item => item.recovery), "#9fdda7"],
    ["sleep", visible.map(item => item.sleep), "#c5b8f8"],
    ["load", visible.map(item => item.load === null || item.load === undefined ? null : Math.min(100, item.load)), "#f0c58c"]
  ];
  const movementValues = visible.map(item => item.steps === null || item.steps === undefined ? null : Math.min(100, item.steps / Math.max(1, medianValue(state.data.map(row => row.steps)) * 1.6) * 100));
  const hasScoreSignal = scoreSeries.some(([, values]) => values.some(value => value !== null && value !== undefined));
  const series = hasScoreSignal ? scoreSeries : [["movement", movementValues, "#9fdda7"]];
  set("#trendHeading", state.trendRange ? visible.length + " days of signal" : hasScoreSignal ? "Seven days of signal" : "Seven days of movement");
  const legend = hasScoreSignal ? '<span><i class="legend-recovery"></i>recovery</span><span><i class="legend-sleep"></i>sleep</span><span><i class="legend-load"></i>load</span>' : '<span><i class="legend-movement"></i>movement relative to baseline</span>';
  $("#trendLegend").innerHTML = legend;
  const grid = [0,25,50,75,100].map(value => '<line class="chart-grid-line" x1="0" y1="' + y(value) + '" x2="' + w + '" y2="' + y(value) + '"/>').join("");
  const lines = series.map(([name, values, color]) => {
    const circles = values.map((value, index) => value === null || value === undefined ? "" : '<circle class="chart-point" tabindex="0" data-tooltip="' + escapeHtml(chartTooltip(visible[index], name, value)) + '" cx="' + (index / span * w) + '" cy="' + y(value) + '" r="' + (visible[index].date === day().date ? 5 : 3) + '" fill="' + color + '"/>').join("");
    return '<path class="chart-line ' + name + '" d="' + path(values) + '"/>' + circles;
  }).join("");
  $("#trendChart").innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + grid + lines + "</svg>";
  $("#trendChart").setAttribute("aria-label", hasScoreSignal ? "Seven day recovery, sleep, and load trend chart" : "Seven day movement trend chart relative to long-term baseline");
  const labelStep = Math.max(1, Math.ceil(visible.length / 7));
  $("#chartLabels").innerHTML = visible.filter((item, index) => index === 0 || index === visible.length - 1 || index % labelStep === 0).map(item => '<span class="' + (item.date === day().date ? "active" : "") + '">' + shortDate(item.date) + "</span>").join("");
  const from = $("#trendFrom"), to = $("#trendTo");
  if (from) from.value = state.trendRange ? state.trendRange.start : visible[0].date;
  if (to) to.value = state.trendRange ? state.trendRange.end : visible[visible.length - 1].date;
  set("#rangeStatus", (state.trendRange ? visible.length + " days plotted" : "7-day context") + " · hover points for exact values");
}
function renderAudit(d) {
  const components = d.readiness && d.readiness.components ? d.readiness.components : [];
  const stateLabel = d.readiness && d.readiness.state ? d.readiness.state : "insufficient_data";
  const available = components.filter(component => component.status === "available" || (component.status === undefined && component.value !== null && component.value !== undefined)).length;
  set("#auditState", stateLabel + " · " + available + "/4 inputs" + (d.readiness && d.readiness.confidence !== null && d.readiness.confidence !== undefined ? " · " + Math.round(d.readiness.confidence) + "% confidence" : ""));
  set("#auditInputs", components.length ? components.map(component => component.kind.replaceAll("_", " ") + " " + valueOrDash(component.value) + (component.status && component.status !== "available" ? " (" + component.status + ")" : "")).join(" · ") : "No readiness inputs on this day");
  set("#auditValues", "sleep " + valueOrDash(d.sleep) + " · HRV " + valueOrDash(d.hrv, " ms") + " · RHR " + valueOrDash(d.rhr, " bpm"));
  set("#auditAlgorithm", d.recovery === null || d.recovery === undefined ? "readiness-proxy / v0.2 · not scored" : "readiness-proxy / v0.2");
}
function renderInsights(d) {
  const items = [];
  const previous = state.data[Math.max(0, state.day - 1)] || {};
  const hrvDelta = d.hrv !== null && d.hrv !== undefined && previous.hrv !== null && previous.hrv !== undefined ? Math.round(d.hrv - previous.hrv) : null;
  if (hrvDelta !== null) items.push(["↗", "HRV is " + (hrvDelta >= 0 ? "up " : "down ") + Math.abs(hrvDelta) + " ms from yesterday", "Trend beats a single reading."]);
  if (d.sleep === null || d.sleep === undefined) {
    const lastSleep = state.dataset && state.dataset.metadata && state.dataset.metadata.latestSleepDate;
    items.push(["◌", "Sleep coverage ends " + (lastSleep || "before this date"), "The dashboard will not infer recovery without overnight inputs."]);
  } else {
    items.push(["☾", duration(d.hours) + " asleep last night", d.sleep >= 85 ? "You covered most of your configured sleep target." : "There is room to close the sleep gap."]);
  }
  if (d.steps !== null && d.steps !== undefined) items.push(["↗", Number(d.steps).toLocaleString() + " steps recorded", valueOrDash(d.distance, " km") + " walking distance in the same window."]);
  if (d.workoutCount) items.push(["✦", d.workoutCount + " workout" + (d.workoutCount > 1 ? "s" : "") + " recorded", valueOrDash(d.workoutMinutes, " min") + " of activity; cardio load remains approximate without dense workout HR."]);
  if (state.dataset && state.dataset.workouts && state.dataset.workouts.length) {
    const mostCommon = Object.entries(state.dataset.workouts.reduce((counts, workout) => {
      const label = displayActivityName(workout.activity || "Other");
      counts[label] = (counts[label] || 0) + 1;
      return counts;
    }, {})).sort((a, b) => b[1] - a[1])[0];
    if (mostCommon) items.push(["⌁", escapeHtml(mostCommon[0]) + " is your dominant recorded movement", mostCommon[1].toLocaleString() + " of " + state.dataset.workouts.length.toLocaleString() + " workouts in the archive."]);
  }
  if (!items.length) items.push(["·", "No analyzable signal for this day", "Choose another date or import a newer Health export."]);
  $("#insightList").innerHTML = items.map(item => '<div class="insight-item"><span class="insight-icon">' + item[0] + '</span><div><strong>' + item[1] + "</strong><p>" + item[2] + "</p></div></div>").join("");
}
function renderSleep() {
  const d = day(), sleep = d.sleepDetail;
  if (!sleep) {
    $("#sleepTimeline").innerHTML = '<span class="timeline-empty">No recent sleep-stage records in this export.</span>';
    set("#sleepWindow", "coverage gap");
    set("#sleepDeepCardValue", "—"); set("#sleepRemCardValue", "—"); set("#sleepDeepValue", "—"); set("#sleepRemValue", "—"); set("#sleepCoreValue", "—"); set("#sleepAwakeValue", "—");
    return;
  }
  const total = Math.max(1, sleep.asleepMin + (sleep.stages.awake || 0));
  const stages = [];
  [["deep", sleep.stages.deep], ["rem", sleep.stages.rem], ["core", sleep.stages.core], ["awake", sleep.stages.awake]].forEach(([name, minutes]) => {
    for (let index = 0; index < Math.max(1, Math.round((minutes || 0) / total * 48)); index += 1) stages.push(name);
  });
  $("#sleepTimeline").innerHTML = stages.map(name => '<i class="' + name + '"></i>').join("");
  set("#sleepWindow", (sleep.start || "").slice(11,16) + " → " + (sleep.end || "").slice(11,16));
  set("#sleepDeepCardValue", duration((sleep.stages.deep || 0) / 60));
  set("#sleepRemCardValue", duration((sleep.stages.rem || 0) / 60));
  set("#sleepDeepValue", duration((sleep.stages.deep || 0) / 60));
  set("#sleepRemValue", duration((sleep.stages.rem || 0) / 60));
  set("#sleepCoreValue", duration((sleep.stages.core || 0) / 60));
  set("#sleepAwakeValue", duration((sleep.stages.awake || 0) / 60));
}
function renderActivities() {
  const rows = personalWindow().flatMap(item => item.workouts || []).sort((a,b) => b.start.localeCompare(a.start)).slice(0, 5);
  $("#activityTable").innerHTML = rows.length ? rows.map(row => '<div class="activity-row"><div class="activity-name"><span class="activity-icon">✦</span>' + escapeHtml(row.activity.replace("TraditionalStrengthTraining", "Strength training")) + '</div><div class="activity-date">' + escapeHtml(row.date) + '</div><div class="activity-value"><span>time</span>' + valueOrDash(row.durationMin, " min") + '</div><div class="activity-value"><span>cardio load</span>' + valueOrDash(row.cardioLoadRaw, "") + "</div></div>").join("") : '<div class="timeline-empty">No workouts in this seven-day window.</div>';
}

function medianValue(values) {
  const sorted = values.filter(value => value !== null && value !== undefined).sort((a,b) => a-b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function displayActivityName(name) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace("Traditional Strength Training", "Strength training");
}
function renderMovement() {
  const d = day();
  const personal = state.source === "personal";
  const recent = state.data.slice(Math.max(0, state.day - 29), state.day + 1);
  const medianSteps = medianValue(recent.map(item => item.steps));
  set("#stepsValue", valueOrDash(d.steps));
  set("#distanceValue", valueOrDash(d.distance, " km"));
  set("#energyValue", valueOrDash(d.active, " kcal"));
  set("#exerciseMinutesValue", valueOrDash(d.exercise, " min"));
  set("#stepsContext", medianSteps === null ? "no recent baseline" : "30d median " + Math.round(medianSteps).toLocaleString());
  set("#energyContext", d.date === (state.dataset && state.dataset.metadata && state.dataset.metadata.latestAvailableDate) ? "partial export day" : "daily total");
  set("#exerciseContext", d.workoutCount ? d.workoutCount + " logged workout" + (d.workoutCount > 1 ? "s" : "") : "no workout record");
  const latestVo2 = personal ? nextValue("vo2Max") : null;
  const latestRecovery = personal ? nextValue("heartRateRecoveryBpm") : null;
  set("#fitnessContext", latestVo2 === null && latestRecovery === null ? "VO₂ max and heart-rate recovery are not present in the latest window." : "Latest available fitness context: " + (latestVo2 === null ? "" : "VO₂ max " + valueOrDash(latestVo2, " mL/kg/min")) + (latestVo2 !== null && latestRecovery !== null ? " · " : "") + (latestRecovery === null ? "" : "1-min HR recovery " + valueOrDash(latestRecovery, " bpm")));
  const workouts = personal && state.dataset ? state.dataset.workouts || [] : state.data.flatMap(item => item.workouts || []);
  const totalMinutes = workouts.reduce((sum, row) => sum + (row.durationMin || 0), 0);
  const totalLoad = workouts.reduce((sum, row) => sum + (row.cardioLoadRaw || 0), 0);
  set("#totalWorkoutValue", workouts.length.toLocaleString());
  set("#totalWorkoutHours", (totalMinutes / 60).toFixed(1) + "h");
  set("#trainingLoadValue", Math.round(totalLoad).toLocaleString());
  const mix = {};
  workouts.forEach(row => { const label = displayActivityName(row.activity || "Other"); mix[label] = (mix[label] || 0) + 1; });
  const mixRows = Object.entries(mix).sort((a,b) => b[1] - a[1]).slice(0, 5);
  const maxCount = mixRows[0] ? mixRows[0][1] : 1;
  $("#workoutMix").innerHTML = mixRows.length ? mixRows.map(([label, count]) => '<div><span class="mix-label">' + escapeHtml(label) + '</span><span class="mix-count">' + count + '</span><div class="mix-bar"><i style="width:' + (count / maxCount * 100) + '%"></i></div></div>').join("") : '<span class="timeline-empty">No workout archive loaded.</span>';
  const range = state.dataset && state.dataset.metadata && state.dataset.metadata.dateRange;
  set("#trainingWindow", personal && range ? range.start + " → " + range.end : "demo");
}
function daysBetween(start, end) {
  if (!start || !end) return null;
  return Math.max(0, Math.round((new Date(end + "T12:00:00") - new Date(start + "T12:00:00")) / 86400000));
}
function latestGap(key) {
  let last = -1, largest = 0;
  state.data.forEach((item, index) => {
    const present = key === "sleep" ? Boolean(item.sleep) : item[key] !== null && item[key] !== undefined;
    if (present) {
      if (last >= 0) largest = Math.max(largest, index - last - 1);
      last = index;
    }
  });
  return largest;
}
function signalCount(item) {
  return [item.sleep, item.hrv, item.rhr, item.steps].filter(value => value !== null && value !== undefined).length;
}
function analysisReady(item) {
  return item.sleep !== null && item.sleep !== undefined && signalCount(item) >= 3;
}
function usableWindows(requireSleep) {
  const windows = [];
  let start = -1;
  state.data.forEach((item, index) => {
    const usable = signalCount(item) >= 3 && (!requireSleep || analysisReady(item));
    if (usable && start < 0) start = index;
    if ((!usable || index === state.data.length - 1) && start >= 0) {
      const end = usable && index === state.data.length - 1 ? index : index - 1;
      windows.push({ start, end, days: end - start + 1, items: state.data.slice(start, end + 1) });
      start = -1;
    }
  });
  return windows;
}
function renderWindowChart(selector, items, legendSelector) {
  const width = 520, height = 126, pad = 8, span = Math.max(1, items.length - 1);
  const baseline = medianValue(state.data.map(item => item.steps)) || 1;
  const stepValues = items.map(item => item.steps === null || item.steps === undefined ? null : Math.min(100, item.steps / Math.max(1, baseline * 1.6) * 100));
  const hasSleep = items.some(item => item.sleep !== null && item.sleep !== undefined);
  const hasHrv = items.some(item => item.hrv !== null && item.hrv !== undefined);
  const hrvBaseline = medianValue(state.data.map(item => item.hrv)) || 1;
  const secondaryValues = hasSleep ? items.map(item => item.sleep === null || item.sleep === undefined ? null : item.sleep) : items.map(item => item.hrv === null || item.hrv === undefined ? null : Math.min(100, item.hrv / Math.max(1, hrvBaseline * 1.6) * 100));
  const secondaryLabel = hasSleep ? "sleep score" : hasHrv ? "HRV relative" : "no overnight metric";
  const coverageValues = items.map(item => signalCount(item) / 4 * 100);
  const y = value => height - pad - value / 100 * (height - pad * 2);
  const path = values => {
    let output = "", started = false, previous = -2;
    values.forEach((value, index) => {
      if (value === null || value === undefined) return;
      output += (!started || index !== previous + 1 ? "M" : "L") + (pad + index / span * (width - pad * 2)).toFixed(1) + "," + y(value).toFixed(1) + " ";
      started = true; previous = index;
    });
    return output.trim();
  };
  const bars = coverageValues.map((value, index) => {
    const barWidth = Math.max(2, (width - pad * 2) / items.length - 1);
    const x = pad + index / span * (width - pad * 2) - barWidth / 2;
    return '<rect class="window-coverage-bar" tabindex="0" data-tooltip="' + escapeHtml(items[index].date + " · " + Math.round(value) + "% signal coverage") + '" x="' + x.toFixed(1) + '" y="' + y(value).toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + (height - pad - y(value)).toFixed(1) + '" rx="1"/>';
  }).join("");
  const points = items.flatMap((item, index) => {
    const x = (pad + index / span * (width - pad * 2)).toFixed(1);
    const step = stepValues[index] === null ? "" : '<circle class="window-point window-steps-point" tabindex="0" data-tooltip="' + escapeHtml(item.date + " · " + valueOrDash(item.steps, " steps")) + '" cx="' + x + '" cy="' + y(stepValues[index]).toFixed(1) + '" r="3"/>';
    const secondary = secondaryValues[index] === null ? "" : '<circle class="window-point window-sleep-point" tabindex="0" data-tooltip="' + escapeHtml(item.date + " · " + secondaryLabel + " " + (hasSleep ? valueOrDash(item.sleep) : valueOrDash(item.hrv, " ms"))) + '" cx="' + x + '" cy="' + y(secondaryValues[index]).toFixed(1) + '" r="3"/>';
    return [step, secondary];
  }).join("");
  $(selector).innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none"><line class="window-grid-line" x1="' + pad + '" y1="' + y(50) + '" x2="' + (width-pad) + '" y2="' + y(50) + '"/>' + bars + '<path class="window-line window-steps-line" d="' + path(stepValues) + '"/><path class="window-line window-sleep-line" d="' + path(secondaryValues) + '"/>' + points + '</svg>';
  if (legendSelector) $(legendSelector).innerHTML = '<span><i class="window-steps"></i>steps relative</span><span><i class="window-sleep"></i>' + secondaryLabel + '</span><span><i class="window-coverage"></i>signal coverage</span>';
}
function renderWindowStats(selector, window) {
  const steps = medianValue(window.items.map(item => item.steps));
  const sleep = medianValue(window.items.map(item => item.sleep));
  const hrv = medianValue(window.items.map(item => item.hrv));
  const rhr = medianValue(window.items.map(item => item.rhr));
  const avgCoverage = Math.round(window.items.reduce((sum, item) => sum + signalCount(item), 0) / window.items.length / 4 * 100);
  const stepsText = steps === null ? "—" : Math.round(steps).toLocaleString();
  set(selector, "Median " + stepsText + " steps · sleep " + valueOrDash(sleep) + " · HRV " + valueOrDash(hrv, " ms") + " · RHR " + valueOrDash(rhr, " bpm") + " · " + avgCoverage + "% signal coverage");
}
function renderHistoricalWindows() {
  const panel = $("#historicalWindows");
  if (!panel) return;
  if (state.source !== "personal") {
    panel.hidden = true;
    return;
  }
  const consistentWindows = usableWindows(false);
  const overnightWindows = usableWindows(true);
  const trendWindows = overnightWindows.filter(window => window.days >= 3);
  const lastGood = trendWindows.length ? trendWindows[trendWindows.length - 1] : overnightWindows[overnightWindows.length - 1];
  const best = [...consistentWindows].sort((a, b) => b.days - a.days || b.end - a.end)[0];
  if (!lastGood || !best) {
    panel.hidden = false;
    set("#historicalWindowMeta", "no usable window");
    set("#historicalWindowIntro", "There is not yet a continuous period with enough signal to compare.");
    return;
  }
  panel.hidden = false;
  const recent = state.data.slice(-30).filter(analysisReady).length;
  set("#historicalWindowMeta", recent + "/30 recent days analysis-ready");
  set("#historicalWindowIntro", "Recent days are incomplete, so the dashboard is preserving the last analysis-ready overnight window and the longest consistent signal window. An analysis-ready day has sleep plus at least 2 of HRV, resting heart rate, and steps; a consistent signal day has any 3 of those 4 signals.");
  set("#lastGoodWindowRange", state.data[lastGood.start].date + " → " + state.data[lastGood.end].date);
  set("#lastGoodWindowDays", lastGood.days + (lastGood.days === 1 ? " day" : " days"));
  set("#bestWindowRange", state.data[best.start].date + " → " + state.data[best.end].date);
  set("#bestWindowDays", best.days + (best.days === 1 ? " day" : " days"));
  renderWindowChart("#lastGoodWindowChart", lastGood.items, "#lastGoodWindowLegend");
  renderWindowChart("#bestWindowChart", best.items, "#bestWindowLegend");
  renderWindowStats("#lastGoodWindowStats", lastGood);
  renderWindowStats("#bestWindowStats", best);
}
function renderWildVisuals() {
  renderSignalStory(); renderHistoricalWindows(); renderRhythmChart(); renderCoverageMap(); renderActivityHeatmap(); renderSpectrum();
}
function renderSignalStory() {
  const meta = state.dataset && state.dataset.metadata;
  const recent = state.data.slice(-30);
  const recentSteps = medianValue(recent.map(item => item.steps));
  const historicalSteps = medianValue(state.data.map(item => item.steps));
  const change = recentSteps !== null && historicalSteps ? Math.round((recentSteps / historicalSteps - 1) * 100) : null;
  const sleepGap = meta ? daysBetween(meta.latestSleepDate, meta.latestAvailableDate) : null;
  const workoutDays = recent.filter(item => item.workoutCount > 0).length;
  set("#movementDelta", change === null ? "—" : (change > 0 ? "+" : "") + change + "%");
  set("#sleepGapDays", sleepGap === null ? "—" : sleepGap);
  set("#activeDays30", workoutDays);
  if (state.source !== "personal") {
    set("#primaryInsight", "Your personal signal will appear here.");
    set("#primaryInsightDetail", "Import an Apple Health export to turn this page into a living readout.");
    return;
  }
  if (sleepGap !== null && sleepGap > 30) {
    set("#primaryInsight", "Your movement signal is alive. Your overnight signal went quiet.");
    set("#primaryInsightDetail", "Recent steps sit " + Math.abs(change || 0) + "% " + ((change || 0) < 0 ? "below" : "around") + " your long-term median, but usable sleep stages stop on " + meta.latestSleepDate + ". A fresh export or native sync would unlock recovery analysis; the historical windows below preserve the strongest comparable trends we do have.");
  } else if (change !== null && change < -15) {
    set("#primaryInsight", "Your recent movement rhythm is " + Math.abs(change) + "% below your usual.");
    set("#primaryInsightDetail", "That is a personal trend, not a health judgment. The useful next question is whether the change came from fewer steps, less exercise time, or a different training mix.");
  } else {
    set("#primaryInsight", "Your recent movement rhythm is holding close to your baseline.");
    set("#primaryInsightDetail", "The next layer is to connect this activity rhythm to overnight data, so the dashboard can explain change instead of only displaying it.");
  }
}
function renderRhythmChart() {
  const items = state.data.slice(-90);
  const values = items.map(item => item.steps);
  const baseline = medianValue(state.data.map(item => item.steps)) || 1;
  const present = values.filter(value => value !== null && value !== undefined);
  const max = Math.max(baseline * 1.5, ...(present.length ? present : [1]), 1000);
  const w = 760, h = 225, pad = 12;
  const point = (value, index) => ({ x: pad + index / Math.max(1, items.length - 1) * (w - pad * 2), y: h - pad - value / max * (h - pad * 2) });
  let path = "", area = "", started = false, previousIndex = -2;
  values.forEach((value, index) => {
    if (value === null || value === undefined) { path = path ? path + " " : path; return; }
    const p = point(value, index);
    path += (!started || index !== previousIndex + 1 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1) + " ";
    started = true;
    previousIndex = index;
  });
  const first = values.findIndex(value => value !== null && value !== undefined);
  const last = values.length - 1 - [...values].reverse().findIndex(value => value !== null && value !== undefined);
  if (first >= 0 && last >= first) {
    const firstPoint = point(values[first], first), lastPoint = point(values[last], last);
    area = path + "L" + lastPoint.x.toFixed(1) + "," + (h - pad) + "L" + firstPoint.x.toFixed(1) + "," + (h - pad) + "Z";
  }
  const baselineY = h - pad - baseline / max * (h - pad * 2);
  const grid = [0.25,0.5,0.75].map(fraction => '<line class="rhythm-grid" x1="' + pad + '" y1="' + (pad + fraction * (h - pad * 2)) + '" x2="' + (w - pad) + '" y2="' + (pad + fraction * (h - pad * 2)) + '"/>').join("");
  const points = values.map((value, index) => value === null || value === undefined ? "" : '<circle class="rhythm-point" tabindex="0" data-tooltip="' + escapeHtml(items[index].date + " · " + valueOrDash(value, " steps")) + '" cx="' + point(value,index).x + '" cy="' + point(value,index).y + '" r="2.6"/>').join("");
  $("#rhythmChart").innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + grid + '<path class="rhythm-area" d="' + area + '"/><line class="rhythm-median" x1="' + pad + '" y1="' + baselineY + '" x2="' + (w - pad) + '" y2="' + baselineY + '"/><path class="rhythm-line" d="' + path + '"/>' + points + '</svg>';
  const recent = medianValue(state.data.slice(-30).map(item => item.steps));
  const delta = recent && baseline ? Math.round((recent / baseline - 1) * 100) : null;
  set("#rhythmSummary", delta === null ? "not enough steps" : (delta > 0 ? "+" : "") + delta + "% vs baseline");
}
function renderCoverageMap() {
  const buckets = {};
  state.data.forEach(item => {
    const month = item.date.slice(0, 7);
    if (!buckets[month]) buckets[month] = { total:0, sleep:0, vitals:0, workout:0 };
    const bucket = buckets[month]; bucket.total += 1;
    if (item.sleep) bucket.sleep += 1;
    if (item.hrv !== null || item.rhr !== null || item.resp !== null) bucket.vitals += 1;
    if (item.workoutCount > 0) bucket.workout += 1;
  });
  const months = Object.keys(buckets).sort().slice(-48);
  const lane = (label, key, klass) => '<div class="coverage-lane"><span>' + label + '</span><div class="coverage-cells">' + months.map(month => { const bucket=buckets[month], ratio=bucket[key]/bucket.total; const level=ratio===0?0:ratio<.34?1:ratio<.67?2:3; return '<i class="coverage-cell ' + klass + ' level-' + level + '" tabindex="0" data-tooltip="' + escapeHtml(month + ': ' + Math.round(ratio*100) + '%') + '"></i>'; }).join("") + "</div></div>";
  $("#coverageTimeline").innerHTML = lane("sleep","sleep","sleep") + lane("vitals","vitals","vitals") + lane("workouts","workout","workout");
  const sleepGap = state.dataset && state.dataset.metadata ? state.dataset.metadata.latestSleepDate : null;
  set("#gapNote", sleepGap ? "Sleep has usable stage data on " + ((state.dataset.metadata.coverage && state.dataset.metadata.coverage.sleepDays) || 0) + " days. The longest quiet stretch is " + latestGap("sleep") + " days, so recovery is currently an evidence gap, not a low score." : "Import personal data to map coverage.");
}
function renderActivityHeatmap() {
  const items = state.data.slice(-365);
  const steps = items.map(item => item.steps).filter(value => value !== null && value !== undefined);
  const max = Math.max(1, medianValue(steps) * 2.2);
  const html = items.map(item => {
    const value = item.steps;
    const ratio = value === null || value === undefined ? 0 : Math.min(1, value / max);
    const level = value === null || value === undefined ? 0 : ratio < .25 ? 1 : ratio < .5 ? 2 : ratio < .8 ? 3 : 4;
    return '<i class="heat-cell level-' + level + '" tabindex="0" data-tooltip="' + escapeHtml(item.date + ': ' + (value === null || value === undefined ? "no step data" : Math.round(value).toLocaleString() + " steps")) + '"></i>';
  }).join("");
  $("#activityHeatmap").innerHTML = html;
  set("#heatmapSummary", steps.length + " days with step data · " + Math.round(medianValue(steps)).toLocaleString() + " median steps");
}
function renderSpectrum() {
  const workouts = (state.dataset && state.dataset.workouts ? state.dataset.workouts : []).filter(row => row.cardioLoadRaw !== null && row.cardioLoadRaw !== undefined);
  const w = 760, h = 255, padX = 42, padY = 20, maxDuration = Math.max(60, ...workouts.map(row => row.durationMin || 0)), maxLoad = Math.max(60, ...workouts.map(row => row.cardioLoadRaw || 0));
  const x = value => padX + Math.min(1, value / maxDuration) * (w - padX - 12);
  const y = value => h - padY - Math.min(1, value / maxLoad) * (h - padY - 20);
  const grid = [0.25,0.5,0.75].map(f => '<line class="spectrum-grid" x1="' + padX + '" y1="' + (20 + f * (h - 40)) + '" x2="' + (w - 12) + '" y2="' + (20 + f * (h - 40)) + '"/>').join("");
  const dots = workouts.map(row => {
    const name = row.activity || "";
    const color = /Running|HIIT|HighIntensity/i.test(name) ? "#9fdda7" : /Tennis|Badminton|Squash/i.test(name) ? "#c5b8f8" : /Strength/i.test(name) ? "#f0c58c" : "#7ba99d";
    return '<circle class="spectrum-dot" tabindex="0" data-tooltip="' + escapeHtml(row.date + ' · ' + displayActivityName(name) + " · " + row.durationMin + " min · " + row.cardioLoadRaw + " load · HR " + valueOrDash(row.hrAvgBpm, " bpm")) + '" cx="' + x(row.durationMin || 0) + '" cy="' + y(row.cardioLoadRaw || 0) + '" r="3" fill="' + color + '"><title>' + escapeHtml(displayActivityName(name) + " · " + row.durationMin + " min · " + row.cardioLoadRaw + " load") + "</title></circle>";
  }).join("");
  $("#spectrumChart").innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + grid + '<line class="spectrum-grid" x1="' + padX + '" y1="' + (h-padY) + '" x2="' + (w-12) + '" y2="' + (h-padY) + '"/><text class="spectrum-axis" x="' + padX + '" y="' + (h-3) + '">short</text><text class="spectrum-axis" x="' + (w-45) + '" y="' + (h-3) + '">long</text><text class="spectrum-axis" x="3" y="25">high</text><text class="spectrum-axis" x="3" y="' + (h-25) + '">low</text>' + dots + "</svg>";
}
function nextValue(key) {
  for (let index = state.data.length - 1; index >= 0; index -= 1) {
    if (state.data[index][key] !== null && state.data[index][key] !== undefined) return state.data[index][key];
  }
  return null;
}

const briefLink = $("#briefLink");
if (briefLink) briefLink.addEventListener("click", () => {
  const target = $("#rhythmChart");
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
});

function selectDay(date) {
  const index = state.data.findIndex(item => item.date === date);
  if (index < 0) return;
  state.day = index;
  state.trendRange = null;
  render();
}
function selectWindow(window) {
  if (!window) return;
  state.day = window.end;
  state.trendRange = { start: state.data[window.start].date, end: state.data[window.end].date };
  render();
  $("#dashboardDate").scrollIntoView({ behavior: "smooth", block: "center" });
}
function latestAnalysisWindow() {
  const windows = usableWindows(true).filter(window => window.days >= 3);
  return windows.length ? windows[windows.length - 1] : usableWindows(true).slice(-1)[0];
}
function applyTrendRange() {
  const start = $("#trendFrom").value, end = $("#trendTo").value;
  if (!start || !end || start > end) {
    set("#rangeStatus", "choose a valid date range");
    return;
  }
  const rows = state.data.filter(item => item.date >= start && item.date <= end);
  if (!rows.length) {
    set("#rangeStatus", "no loaded days in range");
    return;
  }
  state.trendRange = { start, end };
  state.day = state.data.findIndex(item => item.date === rows[rows.length - 1].date);
  render();
}
function clearTrendRange() {
  state.trendRange = null;
  render();
}
function bindTooltips() {
  const tooltip = $("#chartTooltip");
  if (!tooltip) return;
  const move = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX || rect.left + rect.width / 2;
    const y = event.clientY || rect.top;
    tooltip.style.left = Math.min(window.innerWidth - tooltip.offsetWidth - 12, x + 14) + "px";
    tooltip.style.top = Math.max(12, y - tooltip.offsetHeight - 14) + "px";
  };
  document.querySelectorAll("[data-tooltip]").forEach(element => {
    if (element.dataset.tooltipBound) return;
    element.dataset.tooltipBound = "true";
    const show = event => { tooltip.textContent = element.dataset.tooltip; tooltip.hidden = false; move.call(element, event); };
    const hide = () => { tooltip.hidden = true; };
    element.addEventListener("pointerenter", show);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", hide);
    element.addEventListener("focus", show);
    element.addEventListener("blur", hide);
  });
}

function openFile() { $("#fileInput").click(); }
function syncHealth() {
  setSync("ready", "native bridge required", "preview only");
  set("#syncTitle", "The sync seam is ready");
  set("#syncCopy", "A browser page cannot request HealthKit directly. The native companion will use this same button to query since the last cursor, normalize records, and commit an auditable dataset.");
  set("#importStatus", "Sync preview · use a Health export in this browser build");
}
function openProfile() {
  const dialog = $("#profileDialog");
  if (!dialog) return;
  const context = state.context;
  $("#goalInput").value = context.goal;
  $("#sleepTargetInput").value = context.sleepTarget;
  $("#timezoneInput").value = context.timezone;
  dialog.showModal();
}
function saveProfile(event) {
  if (event.submitter && event.submitter.value !== "save") return;
  state.context = { goal: $("#goalInput").value, sleepTarget: Number($("#sleepTargetInput").value), timezone: $("#timezoneInput").value };
  localStorage.setItem("pulsefield-context", JSON.stringify(state.context));
  set("#importStatus", "Context saved · " + state.context.goal + " · " + state.context.sleepTarget + "h sleep target");
}
function setupTimezones() {
  const input = $("#timezoneInput");
  if (!input) return;
  const current = state.context.timezone || "UTC";
  ["UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"].forEach(zone => {
    const option = document.createElement("option");
    option.value = zone; option.textContent = zone;
    input.appendChild(option);
  });
  input.value = current;
  if (input.value !== current) input.value = "UTC";
}
function setupDateControls() {
  const first = state.data[0] && state.data[0].date, last = state.data[state.data.length - 1] && state.data[state.data.length - 1].date;
  ["#dayPicker", "#trendFrom", "#trendTo"].forEach(selector => {
    const input = $(selector);
    if (!input) return;
    input.min = first || "";
    input.max = last || "";
  });
}
$("#importButton").addEventListener("click", openFile); $("#heroImportButton").addEventListener("click", openFile); $("#syncButton").addEventListener("click", syncHealth); $("#profileButton").addEventListener("click", openProfile);
$("#demoButton").addEventListener("click", ()=>{ state.dataset = null; state.data = demoData(); state.day = state.data.length - 1; state.source = "demo"; state.trendRange = null; setSync("never", "not connected", "demo mode"); setupDateControls(); set("#importStatus", "Demo mode · no personal data leaves your browser"); render(); });
$("#previousDay").addEventListener("click", ()=>{ state.day = Math.max(0, state.day-1); state.trendRange = null; render(); }); $("#nextDay").addEventListener("click", ()=>{ state.day = Math.min(state.data.length - 1, state.day+1); state.trendRange = null; render(); });
$("#dayPicker").addEventListener("change", event => selectDay(event.target.value));
$("#jumpUsableButton").addEventListener("click", () => selectWindow(latestAnalysisWindow()));
$("#applyTrendRange").addEventListener("click", applyTrendRange);
$("#clearTrendRange").addEventListener("click", clearTrendRange);
$("#lastGoodWindowButton").addEventListener("click", () => selectWindow(latestAnalysisWindow()));
$("#bestWindowButton").addEventListener("click", () => { const best = [...usableWindows(false)].sort((a, b) => b.days - a.days || b.end - a.end)[0]; selectWindow(best); });
$("#profileForm").addEventListener("submit", saveProfile);
$("#auditButton").addEventListener("click", ()=>{ $("#auditPanel").hidden = false; $("#auditPanel").scrollIntoView({ behavior:"smooth", block:"center" }); });
$("#closeAudit").addEventListener("click", ()=>{ $("#auditPanel").hidden = true; });
$("#fileInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    set("#importStatus", "Opening " + file.name + " locally…");
    const dataset = await window.PulsefieldHealthImport.load(file, state.context, (message) => set("#importStatus", message));
    if (!dataset.days.length) throw new Error("No supported HealthKit records found");
    state.dataset = dataset;
    state.data = personalDataRows(dataset);
    state.day = state.data.length - 1;
    state.source = "personal";
    state.trendRange = null;
    setupDateControls();
    set("#importStatus", "Imported " + file.name + " · " + Number(dataset.metadata.recordCount).toLocaleString() + " records processed locally");
    render();
  } catch (error) {
    setSync("error", "import failed", "local only");
    set("#importStatus", "Could not read this export: " + error.message);
  } finally {
    event.target.value = "";
  }
});

setupTimezones();
setupDateControls();
render();

render();
