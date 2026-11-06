// tests/playback_cards.js - playback renders EVERY record kind, and populates every card at the cursor (2026-09-25).
//
// Andy: "Playback renders 7 of ~20 record kinds ... Playback should have all data in the log that a real mission
// generates so the reality of a playback is improved ... have playback populate all the cards with all the data
// collected during the run." The recorder now writes a full state snapshot every ten seconds, `ais` records, and the
// page's own card data as client:* records; playback resolves all of it at the cursor (cardsAt) and puts every other
// kind on the timeline instead of dropping it.
//
// DRIVEN: playback.html's own functions - EVERY top-level function and UPPERCASE const of the page, lifted by
// tests/lib/playback_world.js (2026-11-05: a named list of fourteen made every new helper a ReferenceError here) - and
// evaluated over a synthetic log holding ONE RECORD OF EVERY KIND the console writes.
//   1   every kind in the log is rendered: on the timeline, or as a stream the chart and cards draw from - N of N
//       (2026-11-05, KNOWINGLY CHANGED: `ais` is a STREAM now - no timeline row per record; 831 "AIS · N contact(s)" rows
//       buried one log's 70 operator commands - and the check says so)
//   2   cardsAt at the end of the run: every card populated from the LAST value before the cursor
//   3   cardsAt mid-run: the EARLIER nogo readout and wind, only the History rows so far, the AIS snapshot still fresh
//   4   an AIS snapshot older than AIS_STALE_S is not the traffic any more
//   5   summarize: a digest for the timeline that reads the record, not the bookkeeping
//   6   the DOM contract: applyAt writes every card id the markup declares, and render draws ROCs and AIS
//   7   a repeated state snapshot is a sample, not a row
//   8   an older log's /api/logevent `command` copies are NOT commands: no timeline row, not in the Cmds count
//   9   CMD_LABEL names every operator command the console logs (amend ... env), and stays one top-level object
//   10  loadLog: only the LATEST pick is loaded (two answered out of order); the first frame is drawn before the strip
//   11  the suite wrote nothing
//
//   node tests/playback_cards.js      # exit 0 = pass, 1 = fail
const fs = require("fs");
const path = require("path");
const PW = require("./lib/playback_world.js");

// crash guard: a death outside a check() is REPORTED, not silent (turn_geometry.js 30)
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const H = PW.source();          // static/playback.html, or the sidecar ASV_PLAYBACK names
// ⚠ THIS SUITE WRITES NOTHING: every fs write is counted, and the last line asserts none happened
let writes = 0;
for (const k of ["writeFileSync", "appendFileSync", "mkdirSync", "mkdtempSync", "renameSync", "rmSync", "unlinkSync", "writeFile", "appendFile"]) {
  const orig = fs[k];
  if (typeof orig === "function") fs[k] = function () { writes++; return orig.apply(this, arguments); };
}

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond); note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}
const grab = (name) => PW.grab(H, name);
// the page's own functions over a log: its parse, then its cards
function W(EVENTS) {
  const w = PW.world(EVENTS, { window: {} });
  return Object.assign({}, w.g(), { cardsAt: w.fn.cardsAt, summarize: w.fn.summarize, lastBefore: w.fn.lastBefore, fn: w.fn, w });
}

// ── the log: one record of every kind ───────────────────────────────────────────────
const t0 = 1790300000;
const state = (t, over) => ({ t, kind: "state", state: Object.assign({
  mode: "sim", run: "running", autonomy: "auto", behavior: "survey", note: "Survey started", wp_index: 3, wp_total: 40,
  home: { lat: 43.073, lon: -70.71 },
  status: { lat_deg: 43.0731, lon_deg: -70.7101, heading_deg: 100, sog_kn: 2.9, battery_v: 26.1, battery_pct: 88, env_set_kn: 0.31, env_set_deg: 120, crab_deg: -3 },
  env: { ok: true, enabled: true, age_s: 600, wind: { speed_kn: 6.9, dir_from_deg: 300 }, sea: { hs_m: 0.19, tp_s: 3.5, dir_from_deg: 300, derived: true } },
  water: { ok: true, offset_m: 1.086, name: "Seavey Island", data_kind: "observed", age_s: 300 },
  current: { ok: false, note: "gomofs does not cover this position" },
  comms: { mode: "none", ok: false, note: "no link reachable" },
  roc: { rocs: [{ id: "ship-1", name: "Mothership", kind: "ship", lat: 43.08, lon: -70.72 }] },
  supervisor: { holder: "8a29303b", tabs: 1, stale: false } }, over || {}) });
const EVENTS = [
  { t: t0 + 0, kind: "session_start", pid: 1, argv: ["--sim"] },
  { t: t0 + 1, kind: "connect", mode: "sim", host: null },
  state(t0 + 2),
  { t: t0 + 3, kind: "telemetry", run: "running", wp_index: 3, status: { lat_deg: 43.0732, lon_deg: -70.7102, heading_deg: 101, sog_kn: 3.0 } },
  { t: t0 + 4, kind: "client:nogo", text: "1300 zones · floor 2.0 m", cls: "", ready: true },
  { t: t0 + 5, kind: "client:history", what: "banner", text: "Nogo established (1300 nogo zone(s))" },
  { t: t0 + 6, kind: "command", path: "/api/cmd/arm", body: { on: true }, code: 200 },
  { t: t0 + 7, kind: "client:activity", activity: "surveying", detail: "on coverage line 1 of 7", behavior: "survey", line: 1 },
  { t: t0 + 8, kind: "client:guard", shown: true, cls: "guardbar blind", text: "GUARD BLIND 96.8 m off a keep-out" },
  { t: t0 + 9, kind: "client:lines", lines: [{ len_m: 100, plan_s: 60, actual_s: 30 }], turns: [], transits: [{ hop: 1, from: 2, to: 3, m: 653, plan_s: 211, sec: 20 }], runtime: "1:00 · 2:00 left · 33%", survey: "5m @ survey", approach: "1m @ high", wpt: "3 / 40" },
  { t: t0 + 10, kind: "ais", count: 2, vessels: [{ mmsi: 1, name: "TUG ONE", lat: 43.07, lon: -70.70, cog: 90, sog: 4.0 }, { mmsi: 2, name: "FERRY", lat: 43.06, lon: -70.71, cog: 270, sog: 8.5 }] },
  { t: t0 + 20, kind: "client:nogo", text: "1310 zones · floor 2.0 m · +10 chart", cls: "warn", ready: true },
  { t: t0 + 21, kind: "client:history", what: "cmd", text: "Arm" },
  state(t0 + 22, { env: { ok: true, enabled: true, age_s: 60, wind: { speed_kn: 8.0, dir_from_deg: 310 }, sea: { hs_m: 0.25, tp_s: 4.0, dir_from_deg: 310, derived: false } } }),
  { t: t0 + 30, kind: "spawn", lat: 43.073, lon: -70.71 },
  { t: t0 + 31, kind: "log_quiet", reason: "sim boat home and idle for 600 s", resumes: "when a mission is planned" },
  { t: t0 + 32, kind: "log_resume", reason: "mission planned" },
  { t: t0 + 33, kind: "supervisor_took", tab: "8a29303b", took_over: false },
  { t: t0 + 34, kind: "storage_ok", free_mb: 429336 },
  { t: t0 + 35, kind: "loop_fault", error: "ZeroDivisionError", where: "line 1" },
  { t: t0 + 36, kind: "loop_recovered", error: "ZeroDivisionError", count: 3 },
  { t: t0 + 37, kind: "logs_compressed", files: 4, raw_mb: 12.1 },
  { t: t0 + 38, kind: "ais_service_exit", code: 1, restart_in_s: 5 },
  { t: t0 + 39, kind: "client:page_stall", gap_ms: 5200, mode: "survey" },
  { t: t0 + 40, kind: "client:survey_lines", reason: "run end", lines: [{ len_m: 100, plan_s: 60, actual_s: 62 }], turns: [], total_len_m: 100 },
  { t: t0 + 41, kind: "client:guard_low", how: "helm", clearance_m: 2.1 },
  { t: t0 + 42, kind: "client:berth_grant", at: { lat: 43.073, lon: -70.71 } },
  { t: t0 + 43, kind: "disconnect", mode: "sim" },
  { t: t0 + 90, kind: "session_end" },
];
const kinds = [...new Set(EVENTS.map((e) => e.kind))];

console.log("Playback renders every record kind, and populates every card at the cursor:");
let R = null, err = null;
try { R = W(EVENTS); } catch (e) { err = e; }
check("0. the page's own functions evaluate over the synthetic log", () => !err && !!R, () => err ? "THREW " + err.message : kinds.length + " kinds in the log");
if (!R) { console.log("\n1 CHECK(S) FAILED"); process.exit(1); }

// 1. EVERY KIND RENDERED. `state`, `telemetry` and `ais` are streams (the track, the cards, the targets layer);
// everything else must be on the timeline. "7 of ~20" was the gap. ⚠ KNOWINGLY CHANGED 2026-11-05: `ais` was a timeline
// row per record (831 of them buried 70 operator commands in one log); it is a stream now - drawn and carded through the
// target model (the AIS sensor holds the record's two contacts) - and it must NOT be on the timeline.
const STREAMS = ["telemetry", "state", "ais"];
const onTimeline = new Set(R.MARKS.map((m) => m.ev && m.ev.kind));
const rendered = kinds.filter((k) => onTimeline.has(k) || STREAMS.includes(k));
const missing = kinds.filter((k) => !rendered.includes(k));
const aisSensor = R.PB && R.PB.tgt && R.PB.tgt.ais;
check("1. every kind in the log is rendered - on the timeline, or as the track / card / target streams: " + rendered.length + " of " + kinds.length
      + "; the `ais` stream has no row per record and is in the target model",
      () => missing.length === 0 && R.FIXES.length === 3 && R.STATES.length === 2 && R.AIS.length === 1
            && !onTimeline.has("ais") && !!aisSensor && aisSensor.recs.length === 1 && Object.keys(aisSensor.tracks).length === 2
            && Object.keys(R.CLIENT).sort().join(",") === "activity,berth_grant,guard,guard_low,history,lines,nogo,page_stall,survey_lines",
      () => (missing.length ? "NOT rendered: " + missing.join(", ") : "all " + kinds.length) + "; fixes " + R.FIXES.length + ", states " + R.STATES.length
            + ", ais on the timeline " + onTimeline.has("ais") + ", ais tracks " + (aisSensor ? Object.keys(aisSensor.tracks).length : "none")
            + ", client kinds " + Object.keys(R.CLIENT).sort().join(","));

// 2. THE CARDS AT THE END OF THE RUN: the LAST value before the cursor, for each.
const cEnd = R.cardsAt(t0 + 89);
check("2. cardsAt at the end of the run: wind, sea, set, water, current, comms, supervisor from the LAST state snapshot; "
      + "nogo, intent, guard, lines and run-time from the LAST client records; history newest first; the ROC on the chart",
      () => cEnd.wind === "8 kn @ 310° · 1 min" && cEnd.sea === "0.25 m / 4s @ 310°" && cEnd.set === "0.31 kn @ 120° · crab -3°"
            && cEnd.water === "+1.09 m · Seavey Island · 5 min" && /^-- \(gomofs/.test(cEnd.current) && cEnd.comms === "NONE · -- · no link reachable"
            && cEnd.super === "tab 8a29303b · 1 tab(s)" && cEnd.nogo === "1310 zones · floor 2.0 m · +10 chart" && cEnd.nogoCls === "warn"
            && cEnd.intent === "SURVEYING — on coverage line 1 of 7" && cEnd.guard === "GUARD BLIND 96.8 m off a keep-out"
            && cEnd.lines.length === 1 && cEnd.lines[0].actual_s === 62 && cEnd.runtime === "—"
            && cEnd.history.length === 2 && cEnd.history[0].text === "Arm" && cEnd.history[1].text.startsWith("Nogo established")
            && cEnd.roc.length === 1 && cEnd.roc[0].name === "Mothership",
      () => JSON.stringify({ wind: cEnd.wind, sea: cEnd.sea, set: cEnd.set, water: cEnd.water, current: cEnd.current, comms: cEnd.comms,
                             sup: cEnd.super, nogo: cEnd.nogo, intent: cEnd.intent, guard: cEnd.guard, lines: cEnd.lines.length,
                             runtime: cEnd.runtime, hist: cEnd.history.map((h) => h.text), roc: cEnd.roc.length }).slice(0, 400));

// 3. MID-RUN: the earlier values, and only the history so far. The AIS snapshot (t0+10) is 5 s old here: fresh.
const cMid = R.cardsAt(t0 + 15);
check("3. cardsAt mid-run: the EARLIER nogo readout and wind, only the History rows so far, the LINES tick's run-time and "
      + "its transit (none at the end, where the run-end table has none), and the AIS snapshot still fresh",
      () => cMid.wind === "6.9 kn @ 300° · 10 min" && cMid.nogo === "1300 zones · floor 2.0 m" && cMid.nogoCls === ""
            && cMid.history.length === 1 && cMid.history[0].text.startsWith("Nogo established")
            && cMid.runtime === "1:00 · 2:00 left · 33%" && cMid.survey === "5m @ survey"
            && cMid.transits.length === 1 && cMid.transits[0].sec === 20 && cEnd.transits.length === 0
            && Array.isArray(cMid.ais) && cMid.ais.length === 2 && cMid.ais[0].name === "TUG ONE",
      () => JSON.stringify({ wind: cMid.wind, nogo: cMid.nogo, hist: cMid.history.length, runtime: cMid.runtime, ais: cMid.ais && cMid.ais.length }));

// 4. STALE TRAFFIC IS NOT TRAFFIC. At t0+89 the only snapshot is 79 s old: the card says no traffic, the chart draws none.
check("4. an AIS snapshot older than AIS_STALE_S is not the traffic any more (null, not the last one)",
      () => cEnd.ais === null && R.cardsAt(t0 + 10 + 60).ais !== null && R.cardsAt(t0 + 10 + 61).ais === null,
      () => "at +89 s: " + JSON.stringify(cEnd.ais) + "; at exactly 60 s: shown; at 61 s: null");

// 5. THE DIGEST. A record's own fields, its text or detail when it has one, never the bookkeeping.
const dSpawn = R.summarize(EVENTS.find((e) => e.kind === "spawn"));
const dHist = R.summarize(EVENTS.find((e) => e.kind === "client:history"));
const dAct = R.summarize(EVENTS.find((e) => e.kind === "client:activity"));
const dStall = R.summarize(EVENTS.find((e) => e.kind === "client:page_stall"));
check("5. summarize: a spawn reads its lat/lon, a history row its text, an activity its activity and detail, a stall its gap",
      () => /lat=43\.073/.test(dSpawn) && /lon=-70\.71/.test(dSpawn) && !/\bkind=|\bt=|\biso=/.test(dSpawn)
            && dHist.startsWith("Nogo established") && dAct === "surveying — on coverage line 1 of 7" && /gap_ms=5200/.test(dStall),
      () => JSON.stringify([dSpawn, dHist, dAct, dStall]));

// 6. THE DOM CONTRACT: the markup declares each card id, applyAt writes each, render draws the ROCs and the AIS.
const IDS = ["m_wind", "m_sea", "m_set", "m_current", "m_water", "m_nogo", "m_comms", "m_runtime", "m_survey", "m_approach", "m_super",
             "m_intent", "m_guard", "l_table", "a_list", "h_list",
             // 2026-11-05, the mission record: the guard's rung, the Environment, Session and Vessel rows
             "m_glevel", "e_wind", "e_sea", "e_set", "e_forcing", "e_current", "e_water", "e_density", "e_buoys",
             "s_vessel", "s_port", "s_mode", "s_build", "s_tz", "s_prev", "v_cog", "v_spd", "v_att", "v_hold", "a_sensors",
             // review 2026-11-05: what the Targets card cannot show is SAID in the card, not over the chart
             "a_notice"];
const applySrc = grab("applyAt"), renderSrc = grab("render");
const noMarkup = IDS.filter((id) => !H.includes('id="' + id + '"'));
const noWrite = IDS.filter((id) => !applySrc.includes('$("#' + id + '")'));
check("6. the DOM contract: every card id is in the markup and written by applyAt; render draws ROC markers and every sensor's "
      + "contacts (cards.targets); the notices - no traffic record, the AVOIDING fallback, a BLIND model - are the card's, not "
      + "text over the chart",
      () => noMarkup.length === 0 && noWrite.length === 0 && /cards\.roc/.test(renderSrc) && /cards\.targets/.test(renderSrc)
            && !/no traffic record/.test(renderSrc) && /targetNotices\(c\)/.test(applySrc)
            && /c\.transits/.test(applySrc)
            && /cardsAt\(absT\)/.test(renderSrc),
      () => "missing markup: " + (noMarkup.join(",") || "none") + "; not written: " + (noWrite.join(",") || "none"));

// 7. THE CADENCE DOES NOT FLOOD THE TIMELINE. The two state snapshots in this log say the same thing (only the env
// differs): one row, not two. A third with a new note would be a row again.
const stateRows = R.MARKS.filter((m) => m.cls === "state" && m.ev && m.ev.kind === "state");
const R7 = W(EVENTS.concat([state(t0 + 50, { note: "Return-to-Home: following the ENC route", behavior: "rth" })]));
const stateRows7 = R7.MARKS.filter((m) => m.cls === "state" && m.ev && m.ev.kind === "state");
check("7. a state snapshot that repeats the last one's autonomy, note and behavior is a sample, not a timeline row - one row "
      + "for the two here, a second row when the note changes",
      () => stateRows.length === 1 && stateRows7.length === 2 && /Return-to-Home/.test(stateRows7[1].det),
      () => stateRows.length + " row(s) for 2 identical snapshots; " + stateRows7.length + " with a changed third");

// 8. THE LOGEVENT COPY IS NOT A COMMAND. Until 2026-11-05 every page post was written twice - its client:* record and a
// `command` of /api/logevent with the same body: 777 of one log's 847 "commands". The older recordings still hold the
// copies; playback skips them, so neither the timeline nor the Cmds pill counts them. A real command beside them stays.
const ev8 = EVENTS.concat([
  { t: t0 + 44, kind: "command", path: "/api/logevent", body: { kind: "nogo", text: "x" }, code: 200 },
  { t: t0 + 45, kind: "command", path: "/api/logevent", body: { kind: "history", text: "y" }, code: 200 },
  { t: t0 + 46, kind: "command", path: "/api/cmd/stop", body: {}, code: 200 },
]);
const R8 = W(ev8);
const cmdRows8 = R8.MARKS.filter((m) => m.cls.startsWith("cmd"));
check("8. an older log's /api/logevent `command` copies get no timeline row and are not counted as commands; a real command beside them is",
      () => !R8.MARKS.some((m) => m.ev && m.ev.path === "/api/logevent") && cmdRows8.length === 2
            && cmdRows8.some((m) => m.lab === "STOP") && cmdRows8.some((m) => m.lab === "ARM"),
      () => "command rows: " + cmdRows8.map((m) => m.lab).join(",") + "; logevent rows " + R8.MARKS.filter((m) => m.ev && m.ev.path === "/api/logevent").length);

// 9. EVERY OPERATOR COMMAND HAS ITS NAME, and CMD_LABEL stays the one top-level object the console's other readers expect.
const NEW_CMDS = { "/api/cmd/amend": "AMEND", "/api/cmd/reapproach": "RE-APPROACH", "/api/cmd/escape": "ESCAPE", "/api/cmd/hold_clear": "HOLD CLEAR",
                   "/api/cmd/speed": "SPEED", "/api/cmd/reset": "RESET", "/api/cmd/spawn": "SPAWN", "/api/vessel": "VESSEL", "/api/ports": "PORT",
                   "/api/cmd/energy": "ENERGY", "/api/ais/test": "AIS TEST", "/api/ais/radius": "AIS RADIUS", "/api/env": "ENV CFG" };
const ev9 = Object.keys(NEW_CMDS).map((p, i) => ({ t: t0 + 50 + i, kind: "command", path: p, body: p === "/api/cmd/amend" ? { route: [{ lat: 43, lon: -70 }], note: "AIS way round" } : {}, code: 200 }));
const R9 = W(EVENTS.concat(ev9));
const labs9 = ev9.map((e) => (R9.MARKS.find((m) => m.ev === e) || {}).lab);
const bad9 = Object.keys(NEW_CMDS).filter((p, i) => labs9[i] !== NEW_CMDS[p]);
const amendRow = R9.MARKS.find((m) => m.ev === ev9[0]);
check("9. CMD_LABEL names all 13 commands the mission record added (amend ... env) - an amend row says its route and note - and is still "
      + "a top-level `const CMD_LABEL = {` ... `\\n};`",
      () => bad9.length === 0 && /^const CMD_LABEL = \{[\s\S]*?\n\};/m.test(H) && /1 wpts/.test(amendRow.det) && /AIS way round/.test(amendRow.det),
      () => (bad9.length ? "unnamed or misnamed: " + bad9.map((p) => p + "=" + labs9[Object.keys(NEW_CMDS).indexOf(p)]).join(", ") : "all named") + "; amend det " + (amendRow && amendRow.det));

// 10. ONLY THE LATEST PICK IS LOADED, AND THE FIRST FRAME IS DRAWN BEFORE THE STRIP (review 2026-11-05). loadLog itself,
// with the page's own parseSession, over a fetch the suite answers in the order it chooses; the DOM-bound steps are
// stubs that record their call.
(async () => {
  const FN = PW.functions(H), CN = PW.consts(H), have = new Set(FN.map((f) => f.name));
  const STUBS = ["stopPlay", "showEmpty", "hideEmpty", "buildEventList", "buildRunList", "fitToData", "applyAt", "stripShow", "render", "updateMeta", "seek"]
    .filter((n) => have.has(n));
  // eslint-disable-next-line no-new-func
  const mkLoader = new Function("INJ", `"use strict";
    let FIXES = [], STATES = [], MARKS = [], AIS = [], CLIENT = {}, PB = null, T0 = 0, T1 = 0, DUR = 0;
    let pt = 0, playing = false, draggingScrub = false, zoom = 14, center = {lat: 0, lon: 0}, follow = true,
        showTrack = true, showPlan = true, showTgt = true, showKo = true, showEnv = true;
    let EVENTS = [], loadGen = 0, loadedName = null;
    const window = {}, $ = () => null, fetch = INJ.fetch;
    ${CN.map((c) => c.text).join("\n")}
    ${FN.map((f) => f.text).join("\n")}
    ${STUBS.map((n) => n + " = (...a) => { INJ.calls.push([" + JSON.stringify(n) + "].concat(a)); };").join("\n")}
    return { loadLog, get: () => ({ loadedName, n: EVENTS.length, argv: (EVENTS[0] || {}).argv }) };`);
  const LOGS = {
    big: [{ t: 100, kind: "session_start", argv: ["big"] }, { t: 101, kind: "connect", mode: "sim" }, { t: 102, kind: "disconnect" }, { t: 103, kind: "session_end" }],
    small: [{ t: 200, kind: "session_start", argv: ["small"] }, { t: 201, kind: "connect", mode: "sim" }],
  };
  const pend = {}, calls = [];
  const fetchStub = (url) => new Promise((res) => {
    const f = decodeURIComponent(String(url).split("file=")[1]);
    pend[f] = () => res({ text: async () => LOGS[f].map((e) => JSON.stringify(e)).join("\n") });
  });
  let got = null, err = null;
  try {
    const L = mkLoader({ fetch: fetchStub, calls });
    const pBig = L.loadLog("big"), pSmall = L.loadLog("small");
    pend.small(); await pSmall;                   // the second pick answers first...
    pend.big(); await pBig;                       // ...and the 80 MB one after it
    got = L.get();
  } catch (e) { err = e; }
  const seq = calls.map((c) => c[0]), metas = calls.filter((c) => c[0] === "updateMeta").map((c) => c[1]);
  check("10. only the LATEST pick is loaded: a large recording picked, then a small one, answered in the other order - the small one's "
        + "records under its own name, the large one dropped when it lands (no second load, no deep link pairing its records with the "
        + "small one's name); and the first frame (applyAt) is drawn BEFORE the strip is shown, whose axis the frame's clock text sets",
        () => !err && got.loadedName === "small" && got.n === 2 && got.argv[0] === "small" && JSON.stringify(metas) === '["small"]'
              && seq.indexOf("applyAt") >= 0 && seq.indexOf("applyAt") < seq.indexOf("stripShow") && seq.indexOf("stripShow") < seq.indexOf("render"),
        () => err ? "THREW " + err.message : JSON.stringify({ got, metas, seq }));

  check("11. the suite wrote nothing (every fs write function counted)", () => writes === 0, () => writes + " write call(s)");

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
