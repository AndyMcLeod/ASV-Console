// tests/survey_window.js - A SURVEY'S START TIME AND DURATION (2026-11-19, the survey window, phase 1).
//
// Andy: "During survey planning, institute a start time and duration functionality. Using this feature, examine tide
// level at start and total change through the duration of the survey." His calls that day: conservative, whole
// lines, and the proposed defaults - the high water the highest predicted in the horizon, the duration the survey
// time only, the release a manual Continue.
//
// THE SAFETY SHAPE THIS SUITE HOLDS: the boat has no mid-route wait, so a start time is kept ONLY by the hold before
// the survey (3b) - Add to plan turns it on - and Upload never judges a survey from its start time (what it sends is
// flown at once). Punch Out cuts at the lowest water over the start's window, and the water NOW is nothing to that cut
// while the start is ahead: not to the cut level (punchWaterM), not to the punch's survival (applyWaterOffset), not to
// the hops between its lines (cardRouteLevel), not to its row's tide flag (surveyTideMoved). Upload asks of a survey
// sent before its start (uploadTideRisk's `early`), and refuses a hold whose point the falling tide leaves too tight
// while she waits (holdWaitRisk).
//
//   1   flightWindow: no start, no duration - the window as before, to the second; a start she waits for begins it,
//       for the longer of the flight and the duration; late and passed read from her arrival; capped at 24 h
//   2   punchWaterM: a start's read is the cut, above the water now; no read keeps the water now under it
//   3   punchLevelKey: the start and the duration in it; with neither, the key as before
//   4   applyWaterOffset: a cut for a start still ahead is not dropped by a fall in the water now; past it, it is
//   5   cardRouteLevel / surveyLegKos: the card's legs at its cut while it waits; Upload's (no card) at the lower
//   6   commitWaitsForStart: the hold goes on only for a start she will wait for
//   7   surveyTideMoved: no flag before its start; after it, as before
//   8   the start and duration fields: datetime-local <-> epoch, a half-typed time is no start; settings round trip
//   9   holdWaitRisk: refused when the wait's low leaves the disc under her hold radius AND a meter tighter than at
//       its cut; read over [arrival, start]; the water now when she is there soon; none without a start or a wait;
//       an error judged as no wait, logged
//   10  uploadTideRisk: a survey sent well before its start is `early`; Upload's question says so
//   11  the tide strip: its words, its curve, stale when the card moved, and a refresh asked twice reads twice, never
//       three times - on the promise, no timer
//   12  the wiring: the fields' handlers, Punch Out and ✎ read the strip, reset clears it, Add to plan's hold, Upload
//       asks the wait after the chart read and before anything is routed, and passes flightWindow no start
//
//   node tests/survey_window.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// NOTE: each world is a strict Function, as the page is a module.

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);
// ⚠ A PROMISE THAT NEVER SETTLES IS NOT A PASS: node exits 0 with nothing left to run, before the summary line - so a
// world whose read is never answered (a refresh that read three times for three asks, its third never released)
// passed in silence. Reported here, and the exit is a failure.
let finished = false;
process.on("beforeExit", () => {
  if (finished) return;
  console.log("  FAIL 0. the suite never finished - a promise it awaited never settled");
  console.log("\n1 CHECK(S) FAILED (never finished)");
  process.exit(1);
});

const fs = require("fs");
const path = require("path");
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const { distTo } = require("../static/js/geodesy.js");
const REMOTE_KM = fs.readFileSync(path.join(__dirname, "..", "static", "js", "chart.js"), "utf8")
  .match(/^export const WATER_REMOTE_KM = (\d+(?:\.\d+)?);/m)[1];

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond);
        note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  const m = H.match(new RegExp("^(?:const|let|var)\\s+" + name + "\\s*=[^;]*;", "m"));
  if (!m) throw new Error("test setup: declaration " + name + " not found (renamed?)");
  return m[0];
}
const decls = (...n) => n.map(grabDecl).join("\n") + "\n";
const fns = (...n) => n.map(grab).join("\n") + "\n";
const SPEEDS = "const roleSpeedMS = (r) => r === 'transit' ? 3.0 : r === 'turn' ? 1.0 : 1.5;\n";
const WHEN = fns("surgeWhen");

console.log("A survey's start time and duration:");

(async () => {
// ── 1. flightWindow ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const w = new Function("\"use strict\";\n" + SPEEDS + WHEN
    + decls("WATER_ETA_SLACK", "WATER_WINDOW_PAD_S", "WATER_WINDOW_MAX_H") + fns("flightWindow")
    + "return { flightWindow, WATER_ETA_SLACK, WATER_WINDOW_PAD_S };")();
  const now = Date.now() / 1000, vs = 1.5, vf = 3.0, pre = 9000, own = 5400;      // 50 min there, an hour's flight
  const old = (p, o) => ({ t0: now + p / vf, t1: now + (p + o) / vs * 1.5 + 3600 });
  const a = w.flightWindow(pre, own), b = w.flightWindow(pre, own, null, null), o = old(pre, own);
  const st = now + 3 * 3600;
  const s = w.flightWindow(pre, own, st, null), sd = w.flightWindow(pre, own, st, 4);
  const late = w.flightWindow(pre, own, now + 600, null), gone = w.flightWindow(pre, own, now - 600, null);
  const dLong = w.flightWindow(pre, own, null, 6), dShort = w.flightWindow(pre, own, null, 0.1);
  const cap = w.flightWindow(pre, own, st, 30);
  check("1. flightWindow: no start or duration - the window as before (to the second); a start she waits for begins "
        + "it there, for the longer of her flight and the duration, said by its time; a start she cannot reach is "
        + "late and one gone is passed, both read from her arrival; a duration longer than the flight stretches a "
        + "window with no start; one shorter never shortens it; 24 h at most",
        () => Math.abs(a.t0 - o.t0) < 1 && Math.abs(a.t1 - o.t1) < 1 && Math.abs(b.t1 - o.t1) < 1 && !a.start && !a.late
              && s.start && Math.abs(s.t0 - st) < 1e-6 && Math.abs(s.t1 - (st + own / vs * 1.5 + 3600)) < 1
              && /from its start/.test(s.when)
              && Math.abs(sd.t1 - (st + 4 * 3600 + 3600)) < 1
              && late.late && !late.start && Math.abs(late.t0 - o.t0) < 1 && gone.passed && !gone.start
              && Math.abs(gone.t0 - o.t0) < 1
              && Math.abs(dLong.t1 - (now + pre / vs * 1.5 + 6 * 3600 + 3600)) < 1 && Math.abs(dShort.t1 - o.t1) < 1
              && cap.hours === 24 && /first 24 h/.test(cap.when),
        () => JSON.stringify({ s: s.when, late: late.late, gone: gone.passed, cap: cap.hours }));
}

// ── 2. punchWaterM ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const w = new Function("\"use strict\";\n"
    + "let punchLevel = null, lvNow = null; const sea = {waterOffset: 0.2};\n"
    + "const punchLevelFor = () => lvNow;\n" + fns("punchWaterM", "punchStartT", "cutWaits")
    + "return { set lv(v){ punchLevel = v; lvNow = v; }, sea, punchWaterM, punchStartT, cutWaits };")();
  w.lv = { m: 1.4, read: true, start: true, startT: Date.now() / 1000 + 7200 };
  const startRead = w.punchWaterM(), startT = w.punchStartT();
  w.lv = { m: 1.4, read: true, start: false };
  const noStart = w.punchWaterM();
  // (the water now UNDER chart datum: a start with no read must still take it - chart datum alone would be higher)
  w.lv = { m: 0, read: false, start: true, startT: Date.now() / 1000 + 7200 };
  w.sea.waterOffset = -0.3;
  const startUnread = w.punchWaterM(), unreadT = w.punchStartT();
  w.sea.waterOffset = 0.2;
  w.lv = { m: -0.1, read: true, start: true, startT: 5 };
  const below = w.punchWaterM();
  check("2. punchWaterM: a read for a start she waits for IS the cut - +1.40 m over +0.20 m now; without the start the "
        + "water now stays under it; a start with no read keeps the water now under chart datum; the start is stamped "
        + "only on a read; cutWaits only while it is ahead",
        () => startRead === 1.4 && Math.abs(startT - (Date.now() / 1000 + 7200)) < 5 && noStart === 0.2
              && startUnread === -0.3 && unreadT === null && below === -0.1
              && w.cutWaits({ startT: Date.now() / 1000 + 60 }) && !w.cutWaits({ startT: Date.now() / 1000 - 60 })
              && !w.cutWaits({ startT: null }) && !w.cutWaits(null),
        () => [startRead, noStart, startUnread, below].join(", "));
}

// ── 3. punchLevelKey ────────────────────────────────────────────────────────────────────────────────────────────
{
  const w = new Function("\"use strict\";\n" + SPEEDS + "let patStartT = null, patDurH = null;\n" + fns("punchLevelKey")
    + "return { set st(v){ patStartT = v; }, set dur(v){ patDurH = v; }, punchLevelKey };")();
  const L = [[{ lat: 43, lon: -70.7 }, { lat: 43.001, lon: -70.7 }]];
  const plain = w.punchLevelKey(L);
  w.st = 1795000000; const withStart = w.punchLevelKey(L);
  w.dur = 3; const withBoth = w.punchLevelKey(L);
  w.st = null; const durOnly = w.punchLevelKey(L);
  check("3. punchLevelKey: with no start or duration the key as before (its lines and the survey speed); a start, a "
        + "duration, or both each give another key - a read over another window is no read for this one",
        () => plain === "43.0000,-70.7000,43.0010,-70.7000|1.50" && new Set([plain, withStart, withBoth, durOnly]).size === 4,
        () => [plain, withStart, withBoth, durOnly].join(" / "));
}

// ── 4. applyWaterOffset ─────────────────────────────────────────────────────────────────────────────────────────
{
  const w = new Function("\"use strict\";\n" + decls("TIDE_REBUILD_M")
    + "const sea = {waterOffset: 1.5}; const nogo = {features: [], builtOffset: null};\n"
    + "let patClip = null, patFunnel = null, patDropped = null; const effectiveWaterOffset = (wl) => wl.offset_m;\n"
    + "const updatePatReadout = () => {}; const rebuildNogo = () => {};\n" + fns("cutWaits", "applyWaterOffset")
    + "return { sea, set clip(v){ patClip = v; }, get clip(){ return patClip; }, set funnel(v){ patFunnel = v; },"
    + "  get dropped(){ return patDropped; }, applyWaterOffset };")();
  const run = (startT) => {
    w.sea.waterOffset = 1.5; w.clip = [[1, 2]]; w.funnel = { cut: { waterM: 1.45, startT } };
    w.applyWaterOffset({ offset_m: 0.2 });
    return w.clip !== null;
  };
  const ahead = run(Date.now() / 1000 + 3600), past = run(Date.now() / 1000 - 60), none = run(null);
  check("4. applyWaterOffset: a punch cut at +1.45 m for a start still ahead survives the water now falling to +0.20 m "
        + "(she is not flown in it); once its start is past - or with no start - the fall drops it, as before",
        () => ahead && !past && !none && /under the \+1\.45 m/.test(w.dropped),
        () => "ahead kept " + ahead + ", past kept " + past + ", none kept " + none);
}

// ── 5. cardRouteLevel / surveyLegKos ────────────────────────────────────────────────────────────────────────────
{
  const w = new Function("\"use strict\";\n"
    + "const sea = {waterOffset: 0.2}; let patFunnel = null; const nogo = {ko: {id: 'chart'}};\n"
    + "const koAtLevel = (m) => ({id: 'at ' + m}); const surveyById = (id) => ({id, water_m: 1.3});\n"
    + fns("cutWaits", "surveyRouteLevel", "cardRouteLevel", "surveyCutM", "surveyLegKos")
    + "return { set funnel(v){ patFunnel = v; }, cardRouteLevel, surveyLegKos };")();
  const fut = Date.now() / 1000 + 3600;
  w.funnel = { cut: { waterM: 1.4, startT: fut } };
  const waits = w.cardRouteLevel();
  w.funnel = { cut: { waterM: 1.4, startT: null } };
  const now = w.cardRouteLevel();
  w.funnel = { cut: { waterM: 1.4, startT: Date.now() / 1000 - 5 } };
  const past = w.cardRouteLevel();
  const wps = [{ sv: "S1" }, { sv: "S2" }];
  const card = w.surveyLegKos(wps, { sv: "S2", m: 1.4, waits: true });
  const cardNo = w.surveyLegKos(wps, { sv: "S2", m: 1.4, waits: false });
  const up = w.surveyLegKos(wps);
  check("5. the card's own legs: judged at its +1.40 m cut while it waits for its start, at the +0.20 m water now "
        + "without a start or once it is past; surveyLegKos the same for the card's survey that waits - and Upload's "
        + "(no card), and every other survey, at the lower, as before",
        () => waits === 1.4 && now === 0.2 && past === 0.2 && card.levels.S2 === 1.4 && card.levels.S1 === 0.2
              && cardNo.levels.S2 === 0.2 && up.levels.S1 === 0.2 && up.levels.S2 === 0.2,
        () => JSON.stringify({ waits, now, past, card: card.levels, cardNo: cardNo.levels, up: up.levels }));
}

// ── 6. commitWaitsForStart ──────────────────────────────────────────────────────────────────────────────────────
{
  const w = new Function("\"use strict\";\n" + "let patStartT = null, punchLevel = null, lvNow = null;\n"
    + "const punchLevelFor = () => lvNow;\n" + fns("commitWaitsForStart")
    + "return { set st(v){ patStartT = v; }, set lv(v){ punchLevel = v; lvNow = v; }, commitWaitsForStart };")();
  const fut = Date.now() / 1000 + 7200, out = {};
  w.st = null; out.none = w.commitWaitsForStart();
  w.st = Date.now() / 1000 - 60; out.passed = w.commitWaitsForStart();
  w.st = fut; w.lv = null; out.noRead = w.commitWaitsForStart();
  w.lv = { start: true }; out.waits = w.commitWaitsForStart();
  w.lv = { start: false, late: true }; out.late = w.commitWaitsForStart();
  check("6. Add to plan turns the HOLD on for a start she will wait for (the card's read says so), and with no read of "
        + "its own for any start still ahead; not for a start she cannot reach (read from her arrival, flown as she "
        + "gets there), one gone, or none",
        () => !out.none && !out.passed && out.noRead && out.waits && !out.late, () => JSON.stringify(out));
}

// ── 7. surveyTideMoved ──────────────────────────────────────────────────────────────────────────────────────────
{
  const w = new Function("\"use strict\";\n" + "const sea = {waterOffset: 0.2};\n" + decls("SURVEY_TIDE_FLAG_M")
    + fns("surveyStartT", "surveyTideMoved") + "return { surveyTideMoved };")();
  const ahead = w.surveyTideMoved({ water_m: 1.4, settings: { start_t: Date.now() / 1000 + 3600 } });
  const past = w.surveyTideMoved({ water_m: 1.4, settings: { start_t: Date.now() / 1000 - 3600 } });
  const none = w.surveyTideMoved({ water_m: 1.4 });
  check("7. a survey's row is not flagged for the water now under its cut while its start is ahead (it is cut for the "
        + "water from then); after its start, and with none, the fall is flagged as before",
        () => ahead === null && Math.abs(past + 1.2) < 1e-9 && Math.abs(none + 1.2) < 1e-9, () => [ahead, past, none].join(", "));
}

// ── 8. the fields, and the settings round trip ──────────────────────────────────────────────────────────────────
{
  const els = {};
  const $ = (q) => els[q] || (els[q] = { value: "", checked: false });
  const w = new Function("$", "\"use strict\";\n"
    + "let patStartT = null, patDurH = null, patReverse = false, boundary = [], boundaryClosed = false, boundDrag = null,"
    + " surveyBounded = false; const mission = {}; const LEAD_MAX_M = 2000;\n" + decls("WATER_WINDOW_MAX_H")
    // (a Plan B's lines and outline ride the settings too - the survey window phase 3: tests/survey_select.js)
    + "let patOnly = null, patOutlineM = null; const showPlanBNote = () => {}; let patOutlineLowM = null, patOnlySig = null, patPlanBSay = ''; const planBDrawingCheck = () => false;\n"
    + "const depthRange = () => ({max: 0}); const boundaryActive = () => false;\n"
    + "const updateLeadNote = () => {}; const updateEaseNote = () => {};\n"
    + fns("localInputOf", "epochOfLocalInput", "showSurveyWindow", "surveySettingsNow", "applySurveySettings")
    + "return { get st(){ return patStartT; }, set st(v){ patStartT = v; }, get dur(){ return patDurH; }, set dur(v){ patDurH = v; },"
    // (a Plan B's own: its lines, its outline, the level its Max depth is anchored at - 8b)
    + "  get pb(){ return {only: patOnly, outline: patOutlineM, low: patOutlineLowM, sig: patOnlySig, say: patPlanBSay}; },"
    + "  setPb: (o) => { patOnly = o.only; patOutlineM = o.outline; patOutlineLowM = o.low; patOnlySig = o.sig ?? null; patPlanBSay = o.say || ''; },"
    + "  localInputOf, epochOfLocalInput, surveySettingsNow, applySurveySettings };")($);
  const t = Math.round(new Date(2026, 10, 20, 14, 30).getTime() / 1000);
  const shown = w.localInputOf(t), back = w.epochOfLocalInput(shown);
  const half = [w.epochOfLocalInput(""), w.epochOfLocalInput("2026-11-20T"), w.epochOfLocalInput(undefined)];
  w.st = t; w.dur = 2.5;
  const rec = w.surveySettingsNow();
  w.st = null; w.dur = null;
  w.applySurveySettings(rec);
  const restored = [w.st, w.dur, $("#sp_start").value, $("#sp_dur").value];
  w.applySurveySettings({ lead_mode: "m" });
  const old = [w.st, w.dur, $("#sp_start").value, $("#sp_dur").value];
  w.applySurveySettings({ duration_h: 40 });
  check("8. the Start field holds this computer's time and reads back to the same second; blank or half typed is no "
        + "start; the survey's settings carry start_t and duration_h, ✎ puts both back on the card and in its fields, "
        + "a survey from before comes back with none, and a duration is at most 24 h",
        () => shown === "2026-11-20T14:30" && back === t && half.every((v) => v === null)
              && rec.start_t === t && rec.duration_h === 2.5
              && restored[0] === t && restored[1] === 2.5 && restored[2] === "2026-11-20T14:30" && restored[3] === "2.5"
              && old[0] === null && old[1] === null && old[2] === "" && old[3] === "" && w.dur === 24,
        () => JSON.stringify({ shown, back: back - t, rec: [rec.start_t, rec.duration_h], restored, old, cap: w.dur }));
  // 8b. A PLAN B'S SETTINGS THROUGH THE REAL PAIR (the phase 3 review, 2026-11-20: the round trip was pinned by source
  // text only, and breaking the outline's restore passed every suite). Its lines come back sorted, once each, never
  // negative; its outline and the level its Max depth is anchored at come back as they were; the drawing they are of
  // is to be pinned afresh (the card may hold another), and the search's word does not ride a record.
  w.setPb({ only: [3, 1], outline: 1.37, low: -0.2, sig: 12345, say: "Start Fri 07:16" });
  const recB = w.surveySettingsNow();
  w.setPb({ only: [9], outline: 0, low: 0, sig: 777, say: "another Plan B's word" });   // another Plan B on the card, pinned
  w.applySurveySettings({ ...recB, only: [3, 1, 1, -2, 2.5, "4"] });
  const backB = w.pb;
  w.applySurveySettings({ lead_mode: "m" });                 // a survey that is no Plan B: none of the three
  const noneB = w.pb;
  w.setPb({ only: null, outline: null, low: 0.4 });          // (an anchor with no Plan B is not recorded)
  const lone = w.surveySettingsNow();
  check("8b. a Plan B's lines, its outline and the level its Max depth is anchored at ride the survey's settings and "
        + "come back through the page's own pair - the lines sorted, once each, whole numbers from 0 - with the drawing "
        + "to be pinned again and no search word; a survey that is no Plan B has none of them, saved or put back",
        () => JSON.stringify(recB.only) === "[3,1]" && recB.outline_m === 1.37 && recB.outline_low_m === -0.2
              && JSON.stringify(backB.only) === "[1,3]" && backB.outline === 1.37 && backB.low === -0.2
              && backB.sig === null && backB.say === ""
              && noneB.only === null && noneB.outline === null && noneB.low === null
              && lone.only === null && lone.outline_low_m === null,
        () => JSON.stringify({ recB: [recB.only, recB.outline_m, recB.outline_low_m], backB, noneB, lone: [lone.only, lone.outline_low_m] }));
}

// ── 9. holdWaitRisk ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const reads = [], logs = [];
  let clear = {}, readLow = 0.2, throwIn = false;
  const W = new Function("distTo", "reads", "logs", "env", "\"use strict\";\n" + SPEEDS + WHEN
    + decls("WAIT_NOW_S", "WATER_WINDOW_MAX_H")
    + "const WATER_REMOTE_KM = " + REMOTE_KM + "; let water = null; const sea = {waterOffset: 1.0};\n"
    + "let asv = {lat: 43.0, lon: -70.70}; const nogo = {ready: true, ko: {lvl: 'chart'}, frame: {toEN: (p) => p}, buffer: 3};\n"
    + "let surveys = []; const surveyById = (id) => surveys.find((s) => s.id === id) || null;\n"
    + "const fmtDist = (m) => Math.round(m) + ' m'; const holdRadiusM = () => 2;\n"
    + "const koAtLevel = (m) => ({lvl: (+m).toFixed(2)});\n"
    + "const holdClearM = (p, ko) => { if(env.throwIn) throw new Error('boom'); const v = env.clear[ko.lvl]; return v == null ? 50 : v; };\n"
    + "const logClient = (k, o) => logs.push([k, o]);\n"
    + "const waterAlongRead = async (line, t0, t1) => { reads.push({n: line.length, t0, t1});"
    + "  return {points: [{low_m: env.readLow, km: 4, kind: 'predicted', name: 'Stn'}]}; };\n"
    + fns("surveyStartT", "surveyCutM", "sectionLevel", "fmtLevel", "holdWaitRisk")
    + "return { set surveys(v){ surveys = v; }, set asv(v){ asv = v; }, sea, nogo, holdWaitRisk };");
  const env = { get clear() { return clear; }, get readLow() { return readLow; }, get throwIn() { return throwIn; } };
  const w = W(distTo, reads, logs, env);
  const P = { lat: 43.01, lon: -70.70, sv: "S2" };            // ~1.1 km off: arrival a few minutes out
  const hold = { part: [{ lat: 43.005, lon: -70.70 }, P], held: "S2", cut: 1 };
  const start = Date.now() / 1000 + 4 * 3600;
  const sv = (st) => [{ id: "S2", no: 2, water_m: 1.4, settings: st === undefined ? {} : { start_t: st } }];
  w.surveys = sv(start);
  clear = { "0.20": 0.5, "1.40": 12 };
  reads.length = 0;
  const refuse = await w.holdWaitRisk(hold);
  const rd = reads[0] || {};
  clear = { "0.20": 2.5, "1.40": 12 };
  const roomy = await w.holdWaitRisk(hold);
  clear = { "0.20": 0.5, "1.40": 1.0 };
  const tightAnyway = await w.holdWaitRisk(hold);
  clear = { "0.20": 0.5, "1.40": 12 };
  w.surveys = sv(undefined); const noStart = await w.holdWaitRisk(hold);
  w.surveys = sv(Date.now() / 1000 + 60); const noWait = await w.holdWaitRisk(hold);
  w.surveys = sv(start); w.nogo.ready = false; const noChart = await w.holdWaitRisk(hold); w.nogo.ready = true;
  readLow = 1.3; w.sea.waterOffset = 0.2; clear = { "0.20": 0.5, "1.30": 12, "1.40": 12 };
  const soon = await w.holdWaitRisk(hold);                     // she is there within WAIT_NOW_S: the water now counts
  w.asv = { lat: 42.80, lon: -70.70 };                         // ~23 km off at 3 m/s: two hours away
  const later = await w.holdWaitRisk(hold);
  w.asv = { lat: 43.0, lon: -70.70 }; readLow = 0.2; w.sea.waterOffset = 1.0;
  throwIn = true; logs.length = 0; const threw = await w.holdWaitRisk(hold); throwIn = false;
  check("9. holdWaitRisk: REFUSED where the lowest water while she waits leaves her hold point 0.5 m of clear water - "
        + "under her 2 m hold radius and 11.5 m tighter than at the +1.40 m it was cut at; read at the hold point alone "
        + "from her arrival to its start; not refused with room for her, nor where the point is as tight at its own "
        + "cut (the hold as it was); nothing without a start, a wait or a chart; the water now counts when she is "
        + "there soon, not hours ahead; an error is no refusal, and is logged",
        () => refuse && refuse.waitM === 0.5 && refuse.cutClearM === 12 && refuse.level === 0.2 && refuse.start === start
              && rd.n === 1 && Math.abs(rd.t1 - start) < 1e-6 && rd.t0 > Date.now() / 1000 && rd.t0 < start
              && roomy === null && tightAnyway === null && noStart === null && noWait === null && noChart === null
              && soon && soon.level === 0.2 && /the water now/.test(soon.say) && later === null
              && threw === null && logs.some((l) => l[0] === "upload_wait" && /boom/.test(l[1].error)),
        () => JSON.stringify({ refuse: refuse && [refuse.waitM, refuse.cutClearM, refuse.level], read: rd.n,
                               soon: soon && soon.level, later, logs: logs.length }));
}

// ── 10. uploadTideRisk's `early` ────────────────────────────────────────────────────────────────────────────────
{
  const W = new Function("distTo", "\"use strict\";\n"
    + "let mission = {surveys: []}, asv = {lat: 43.07, lon: -70.71}; const sea = {waterOffset: 1.0}; let water = null;\n"
    + SPEEDS + WHEN + "const fmtDist = (m) => Math.round(m) + ' m';\n"
    + decls("WATER_ETA_SLACK", "WATER_WINDOW_PAD_S", "WATER_WINDOW_MAX_H", "TIDE_REBUILD_M", "UPLOAD_EARLY_S")
    + "const WATER_REMOTE_KM = " + REMOTE_KM + ";\n"
    + "const waterAlongRead = async () => ({points: [{low_m: 0.1, km: 3, kind: 'predicted', name: 'Stn'}]});\n"
    + "const lineOfLeg = () => null;\n"
    + fns("sectionLevel", "fmtLevel", "flightWindow", "surveyStartT", "turnTimeFactor", "flightOwnM", "uploadTideRisk")
    + "return { set mission(v){ mission = v; }, uploadTideRisk };");
  const w = W(distTo);
  const wps = [{ lat: 43.08, lon: -70.71, sv: "S1" }, { lat: 43.081, lon: -70.71, sv: "S1" },
               { lat: 43.09, lon: -70.70, sv: "S2" }, { lat: 43.091, lon: -70.70, sv: "S2" }];
  const fut = Date.now() / 1000 + 3 * 3600;
  w.mission = { surveys: [{ id: "S1", no: 1, water_m: 1.4, settings: { start_t: fut } },
                          { id: "S2", no: 2, water_m: 1.4, settings: { start_t: Date.now() / 1000 + 60 } }] };
  const r = await w.uploadTideRisk(wps);
  const o1 = r && r.over.find((o) => o.s.id === "S1"), o2 = r && r.over.find((o) => o.s.id === "S2");
  const up = grab("doUpload");
  check("10. Upload asks of a survey cut for a later start and sent before it - its start said (`early`), the low "
        + "the one she flies it in NOW, never the start's - and not of one reached within UPLOAD_EARLY_S of its start; "
        + "the question names the start, and the log carries it",
        () => o1 && o1.early === fut && o1.low === 0.1 && o2 && o2.early === null
              && /o\.early \? " for its start, " \+ surgeWhen\(o\.early\) \+ " - sent now, she flies it before then"/.test(up)
              && /\.\.\.\(o\.early \? \{start_t: o\.early\} : \{\}\)/.test(up),
        () => JSON.stringify(r && r.over.map((o) => [o.s.id, o.early, o.low])));
}

// ── 11. the tide strip ──────────────────────────────────────────────────────────────────────────────────────────
{
  const els = {};
  const $ = (q) => els[q] || (els[q] = { innerHTML: "", textContent: "", style: {}, value: "" });
  const reads = [];
  let release = [];
  const W = new Function("$", "reads", "release", "distTo", "\"use strict\";\n" + SPEEDS + WHEN
    + "const WATER_REMOTE_KM = " + REMOTE_KM + "; const fmtDist = (m) => Math.round(m / 1000) + ' km';\n"
    + decls("WATER_ETA_SLACK", "WATER_WINDOW_PAD_S", "WATER_WINDOW_MAX_H", "WATER_SAMPLE_M", "WATER_ALONG_MAX_PTS")
    + "let patStartT = null, patDurH = null, patClip = null, patFunnel = null, lines = [];\n"
    + "const patSourceLines = () => lines; const punchPreM = () => 0; const punchFlightM = () => 3600;\n"
    // (the strip's window is the punch's own: punchOwnM, the drawing up to its duration - phase 2, 2026-11-19)
    + "let punchFlown = null; const punchDrawnM = () => 3600;\n"
    + "const waterSeriesRead = (line, t0, t1) => new Promise((res) => { reads.push({t0, t1}); release.push(res); });\n"
    + fns("fmtLevel", "flightWindow", "punchLevelKey", "punchOwnM", "tideStripReadOnce", "tideStripRefresh", "tideStripSvg",
          "tideStripSay", "renderTideStrip")
    + decls("WATER_SERIES_TIMEOUT_MS")
    + "let tideStrip = null; let tideStripBusy = null, tideStripAgain = false, tideStripDrawn = null;\n"
    + "return { set lines(v){ lines = v; }, set st(v){ patStartT = v; }, get strip(){ return tideStrip; },"
    + "  get busy(){ return tideStripBusy; }, tideStripRefresh, tideStripSay, tideStripSvg, renderTideStrip };");
  const w = W($, reads, release, distTo);
  const L = [[{ lat: 43, lon: -70.7 }, { lat: 43.01, lon: -70.7 }]];
  w.lines = L;
  const t0 = Date.now() / 1000 + 3 * 3600;
  w.st = t0;
  const p1 = w.tideStripRefresh(), p2 = w.tideStripRefresh(), p3 = w.tideStripRefresh();
  const busyNote = $("#sp_tide_note").textContent;
  const ser = [];
  for (let e = t0 - 360; e <= t0 + 3 * 3600 + 360; e += 360) ser.push([e, +(1.2 - 0.0001 * (e - t0)).toFixed(3)]);
  const R = { ok: true, series: ser, start: { t: t0, m: 1.2 }, end: { t: t0 + 3 * 3600, m: 0.12 },
              low: { t: ser[ser.length - 1][0], m: ser[ser.length - 1][1] }, high: { t: ser[0][0], m: ser[0][1] },
              kind: "predicted", points: 4, counted: 3, far: 1, unread: 0 };
  release[0](R);
  await new Promise((r) => setImmediate(r));
  const readsAfterFirst = reads.length;
  release[1] && release[1](R);
  await p1; await p2; await p3;
  const note = $("#sp_tide_note").textContent, svg = $("#sp_tide").innerHTML;
  w.lines = [[{ lat: 43.1, lon: -70.7 }, { lat: 43.11, lon: -70.7 }]];
  w.renderTideStrip();
  const stale = $("#sp_tide_note").textContent, faint = $("#sp_tide").style.opacity;
  const src = grab("tideStripRefresh") + grab("renderTideStrip") + grab("tideStripReadOnce");
  check("11. THE TIDE STRIP: three refreshes asked while one is out read TWICE - the one out, then the card as it "
        + "stands - never three times, and every caller's promise settles; its words say the start, the end, the "
        + "change, the low and the high, and the points it could not draw; the curve is an inline SVG polyline over "
        + "every slot with its low marked; a strip read for another drawing says so and is drawn faint; no timer "
        + "anywhere in it",
        () => reads.length === 2 && readsAfterFirst === 2 && /reading/.test(busyNote) && reads[0].t0 === t0
              && /^Start .* \+1\.20 m → end .* \+0\.12 m \(falls 1\.08 m\); low \+0\.0\d m .*, high \+1\.2\d m/.test(note)
              && /1 of its 4 points have no station within/.test(note)
              && /; its end is 1 h past the survey's own time, a margin;/.test(note)
              && /<svg [^>]*>/.test(svg) && (svg.match(/<polyline points="([^"]+)"/) || [, ""])[1].split(" ").length === ser.length
              && /<circle /.test(svg) && /Read for another drawing/.test(stale) && faint === "0.45"
              && !/setTimeout|setInterval/.test(src),
        () => JSON.stringify({ reads: reads.length, note: note.slice(0, 160), stale: stale.slice(-60), faint }));
  const late = w.tideStripSay(R, { late: true, startT: t0, arrive: t0 + 1800 });
  const gone = w.tideStripSay(R, { passed: true, startT: t0 - 7200 });
  const lake = w.tideStripSay({ ...R, kind: "observed", far: 0 }, null);
  // (a window the 24 h cap cut short has no margin left in it to say; nor has the observed level's flat line)
  const capped = w.tideStripSay(R, { start: true, t0, t1: t0 + 30 * 3600, hours: 24 });
  const lakeWin = w.tideStripSay({ ...R, kind: "observed", far: 0 }, { start: true, t0, t1: t0 + 4 * 3600, hours: 4 });
  check("11b. the strip's note says a start she cannot keep (read from her arrival), one passed, and the Great Lakes' "
        + "observed level standing for the window; a window the 24 h cap cut, or the observed level, claims no margin",
        () => /no sooner than .* after its start .*: read from her arrival/.test(late) && /has passed: read from her arrival/.test(gone)
              && /^Observed \+1\.20 m \(no tide is predicted here/.test(lake)
              && !/a margin/.test(capped) && !/a margin/.test(lakeWin),
        () => [late.slice(-80), gone.slice(-50), lake.slice(0, 50)].join(" | "));
}

// ── 12. the wiring ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const up = grab("doUpload"), cm = grab("commitPattern"), ed = grab("editSurvey"), rs = grab("resetPattern");
  const swc = grab("surveyWindowChanged"), utr = grab("uploadTideRisk"), rph = grab("judgeRedHops"), urp = grab("updatePatReadout");
  const iInk = up.indexOf("await inkYield();"), iWait = up.indexOf("await holdWaitRisk(hold)"), iPlan = up.indexOf("planInsideChart(");
  check("12. THE WIRING: Start and Duration call surveyWindowChanged, which drops the punch and reads the strip; "
        + "↻, Punch Out and ✎ read it; Reset clears the start, the duration and the strip; the readout redraws it; "
        + "Add to plan turns the hold on for a start she waits for; Upload asks holdWaitRisk after the chart read and "
        + "before it routes, its refusal returning before anything is sent; Upload's tide check passes flightWindow NO "
        + "start; the punch's hops are judged at cardRouteLevel; the server's series is read with trust_km",
        () => /\$\("#sp_start"\)\.onchange = surveyWindowChanged;/.test(H) && /\$\("#sp_dur"\)\.onchange = surveyWindowChanged;/.test(H)
              && /\$\("#sp_tide_ref"\)\.onclick = \(\) => \{ tideStripRefresh\(\); \};/.test(H)
              && /patClip = null; updatePatReadout\(\); render\(\);\s*\n\s*tideStripRefresh\(\);/.test(swc)
              && /\$\("#sp_punch"\)\.onclick = \(\) => \{ punchOutPressed\(\); tideStripRefresh\(\); \};/.test(H)
              && /saveMission\(\); updatePatReadout\(\); render\(\);\s*\n\s*tideStripRefresh\(\);/.test(ed)
              && /patStartT = null; patDurH = null; tideStrip = null;/.test(rs) && /renderTideStrip\(\);/.test(urp)
              && /hold: !!\(editing && editing\.hold\) \|\| startsLater,/.test(cm) && /const startsLater = commitWaitsForStart\(\);/.test(cm)
              && iInk > 0 && iWait > iInk && iPlan > iWait
              && /if\(wait\)\{[\s\S]*?render\(\); return;\s*\n\s*\}/.test(up.slice(iWait, iPlan))
              && /flightWindow\(cum\[i0 \+ 1\], flightOwnM\(wps\.slice\(i0, i1 \+ 1\), \(a, b\) => !!lineOfLeg\(a, b\)\)\);/.test(utr)
              && /const lv = cardRouteLevel\(\), buf/.test(rph)
              && /"&trust_km=" \+ WATER_REMOTE_KM/.test(grab("waterSeriesRead")),
        () => "ink " + iInk + ", wait " + iWait + ", plan " + iPlan);
}

finished = true;
console.log("\n" + (fails ? fails + " CHECK(S) FAILED (" + ran + " ran)" : "all checks passed (" + ran + ")"));
process.exit(fails ? 1 : 0);
})();
