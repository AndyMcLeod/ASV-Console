// tests/survey_select.js - THE SURVEY WINDOW'S SELECTION (2026-11-19, phase 2): Plan A, whole lines.
//
// Andy: "During survey planning, institute a start time and duration functionality ... allow all lines to be planned
// to the max high tide level", and his calls on the plan: "conservative, whole lines, proposed defaults". Phase 1 (the
// start, the duration, the tide strip, the hold) is tests/survey_window.js. This is phase 2: with a start or a duration
// on the card, Punch Out flies only the lines that fit its window - PLAN A - and DEFERS the rest whole:
//   - "tide": a line whose clip at the window's low does not cover its OUTLINE, its clip at the highest water predicted
//     over the next 24 h (every line at its most) - the tide would cut it short, so it is not flown in part;
//   - "time": a line that ends past the duration on the route the punch made, and every line after it.
// A deferred line is drawn (lavender, dashed), said on the summary, recorded on the survey, and NEVER flown: punchOut
// filters it out before the strike filter, the order, the turns and the joins. Nor is it a strike: strikes stay the
// operator's and come back with the line.
//
//   1-4   the pure parts: which drawn line a run lies on, cover / whole, the outline's depth window
//   5     deferForWindow: what it defers and why - and what it never asks the outline of
//   6     deferPastDuration: from the first line that ends past the duration, on the route's own meters and speeds
//   7     the words: the punch summary, the empty-punch refusal, the survey's record, row count and tip
//   8     the read: the horizon's high beside the window's low - only with a window - and the flight it is read over
//   9     the high stamped on the cut: the live cut and the clearing's hold carry it
//   10-12 THE REAL PUNCH over a real keep-out model: a shoal mid-line defers that line whole; no window and nothing is
//         deferred; the outline keeps the water Max depth would take at the high (deferHighDR)
//   13    STRIKES ARE NOT DEFERRALS: the window never touches a strike, and a line back from deferral keeps its own
//   14    THE OUTLINE NEVER REACHES THE PLAN: Add to plan's lines and waypoints have none of it, the record has it - and
//         every reader of the deferred lines is one that draws, says or records them (none routes, sends or flies)
//   15    the duration through punchNow: punched again without the lines past it, and Plan A inside it
//   16    the outline's clips are kept through a strike's re-punch, and asked again for a new high
//   17    the wiring: where the filter stands, the loop's order, what a press and a reset clear
//
//   node tests/survey_select.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// NOTE: the page's script is <script type="module">, which runs STRICT; these functions are evaluated strict here.

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);
// ⚠ A PROMISE THAT NEVER SETTLES IS NOT A PASS: node exits 0 with nothing left to run, before the summary line.
let __finished = false;
process.on("beforeExit", () => {
  if (__finished) return;
  console.log("  FAIL 0. the suite never finished - a promise it awaited never settled");
  console.log("\n1 CHECK(S) FAILED (never finished)");
  process.exit(1);
});

const fs = require("fs");
const path = require("path");
const G = require("../static/js/geodesy.js");
const U = require("../static/js/units.js");
const S = require("../static/js/state.js");
const T = require("../static/js/turns.js");
const GEOM = require("../static/js/geometry.js");
const GU = require("../static/js/guard.js");
const PS = require("../static/js/passage.js");
const C = require("../static/js/chart.js");

const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const APP = process.env.ASV_APP || path.join(__dirname, "..");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const PY = fs.readFileSync(path.join(APP, "asv_console.py"), "utf8").split("\r\n").join("\n");

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
function grabAt(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return { start, end: k + 1 };
}
function grab(name) { const r = grabAt(name); return H.slice(r.start, r.end); }
function decl(re) {
  const m = H.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}
async function safely(fn) { try { return { v: await fn() }; } catch (e) { return { err: e }; } }

// ── the plane ────────────────────────────────────────────────────────────────────────────────────────────────────
const O = { lat: 43.07, lon: -70.71 };
const FRAME = G.planeFrame(O);
const at = (x, y) => FRAME.fromEN(x, y);
const xy = (p) => FRAME.toEN(p);
function area(x0, x1, y0, y1, d1, d2) {
  const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => { const p = at(x, y); return [p.lon, p.lat]; });
  return { role: "depth_area", cls: "Depth_Area", props: { DRVAL1: d1, DRVAL2: d2 }, geometry: { type: "Polygon", coordinates: [ring] } };
}
// A SHOAL ACROSS THE MIDDLE OF LINE x = 20 (of five, x = 0 .. 40, n = 0 .. 200): 0.5 m charted, the hull's floor 1.0 m -
// shut at chart datum, open at +1.0 m. The lines beside it are 5 m off it, outside the 3 m buffer either way.
const SHOAL = () => area(15, 25, 80, 120, 0.5, 0.5);
// ... and water a meter under a 10 m Max depth across line x = 20's south end: inside the survey window at chart datum,
// over it at +1.0 m unless the outline's window rises with the water (deferHighDR).
const DEEP = () => area(15, 25, -20, 40, 9.4, 9.4);

// ── the pure parts' world ────────────────────────────────────────────────────────────────────────────────────────
const PURE = new Function("G", "\"use strict\";\nconst {distTo, toEN} = G;\n"
  + decl(/^const DEFER_EPS_M = [^;]*;/m) + "\n"
  + ["distToRunM", "srcLineOf", "runSpanM", "coversRuns", "wholeLine", "deferHighDR", "deferForWindow"].map(grab).join("\n")
  + "\nreturn {srcLineOf, runSpanM, coversRuns, wholeLine, deferHighDR, deferForWindow};")(G);

// ── the punch's world: the page's own punchOut over the console's real modules ───────────────────────────────────
const PAGE_FUNCS = ["punchOut", "lateKeeps", "currentPattern", "surveyPattern", "patSourceLines", "boundaryActive", "clipLine",
  "patStrikeKey", "strikeKeyChart", "punchSpeedSig", "activeStruck", "keptRuns", "distToRunM", "isStruckRun", "runMid",
  "extendLead", "runWithLeads", "patCoverSeg", "patCoverMid", "patIdentSeg", "trimEnd", "judgeJoin",
  "patClipBufM", "patClipKey", "bandWord", "makesWayKey", "slowestMakingWayKey", "setMsNow",
  "patLeadTotal", "leadMetres", "leadInM", "leadOutM", "easeLsM", "roleSpeed", "roleSpeedMS", "depthRange",
  "kindsSummary", "emptyPunchRefusal", "isStepKey", "spdTxt", "spdAtTxt", "slowestSelectableKey", "punchRefusal",
  "commitPattern", "resetPattern", "updatePatReadout", "flushRepunch", "punchNow",
  "dropStruckFromPunch", "strikeSelectedRun", "scheduleRepunch", "applyWaterOffset", "patternWaypoints",
  "liveCut", "punchWaterM", "punchLevelSay", "fmtLevel", "punchLevelKey", "punchLevelFor",
  "punchStartT", "cutWaits", "punchStartSay", "commitWaitsForStart", "surveyStartT", "surgeWhen",
  // THE WINDOW'S SELECTION - the subject
  "windowSelects", "punchHighNow", "srcLineOf", "runSpanM", "coversRuns", "wholeLine", "deferHighDR", "deferOutlineKo",
  "deferTimeKey", "deferForWindow", "deferPastDuration", "deferSay", "deferredRecord", "turnTimeFactor"];
const PAGE_DECLS = [/^const NO_LEAD = [^;]*;/m, /^const LEAD_GIVE = [^;]*;/m, /^const MAX_SURVEY_LINES = [^;]*;/m,
  /^const LEAD_MAX_M = [^;]*;/m, /^const REPUNCH_DELAY_MS = [^;]*;/m, /^const TIDE_REBUILD_M = [^;]*;/m,
  /^const TRIM_MAX_M = [^;]*;/m, /^const JUDGE_RUN_M = [^;]*;/m, /^const SPEED_ROLES = [^;]*;/m,
  /^const PUNCH_SLICE = [^;]*;/m, /^const DEFER_EPS_M = [^;]*;/m, /^const DEFER_TIME_MAX = [^;]*;/m,
  /^const SURVEY_DEFERRED_MAX = [^;]*;/m];

function makeWorld(opts) {
  const o = opts || {};
  const els = {};
  const fakeEl = (id) => ({ id, textContent: "", value: "", disabled: false, title: "", style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; }, focus() {} });
  const $ = (s) => els[s] || (els[s] = fakeEl(s));
  const document = { activeElement: null, createElement: (t) => fakeEl(t), createTextNode: (t) => ({ textContent: t }) };
  const log = { banners: [], notes: [], saves: 0, violations: [], clips: 0 };
  // eslint-disable-next-line no-new-func
  const W = new Function("G", "U", "S", "T", "PS", "C", "GU", "GEOM", "$", "document", "log", "CO",
    "\"use strict\";\n"
    + "const {azTo, distTo, atDA, llEN, fromEN, toEN} = G; const {fmtDist, fmtDur} = U; const {V, nogo, sea} = S;\n"
    + "const {MAX_HALF_M, SKEW_LIMIT_DEG, minTurnRadiusM, shortenSeg, SPEED_CMD_LATENCY_S, easeOffered} = T;\n"
    + "const turnWithRetry = T.turnWithRetry, joinBreaches = T.joinBreaches;\n"
    + "const {acrossTrackM} = GEOM; const {slowLaw, slowLeadM} = CO;\n"
    + "const {channelLaneRoute, channelSpanKeepouts, channelTurnKeepouts, junctionKnot, pruneJunctionKnots,"
    + " regionOrder, routeAround} = PS;\n"
    + "const {blocked, firstBlockAlong, legReasons, effectiveWaterOffset} = C;\n"
    // (the model builder counted: 16 asks how often the outline's model was built)
    + "const buildKeepouts = (...a) => { log.builds = (log.builds || 0) + 1; return C.buildKeepouts(...a); };\n"
    + "const punchYield = () => new Promise((r) => setImmediate(r));\n"
    + PAGE_DECLS.map(decl).join("\n") + "\n"
    + "let pat = {A:null, B:null, C:null, align:0}, patDrag = null, patMoveLast = null, patClip = null, patLead = [], patTrim = [];\n"
    + "let patUnsafe = [], patRed = [], patJoined = false, patDropped = null, patFunnel = null, patRoutes = [], patTransits = [];\n"
    + "let turnSlowAt = {};\n"
    + "let patStruck = [], patStruckKey = null, patSel = null, patClipMemo = null, patRepunchT = null;\n"
    + "let punchInFlight = null, punchBusy = false, encShow = false, boundary = [], boundaryClosed = false;\n"
    + "let surveyBounded = false;\n"
    + "let planKind = null, asv = null;\n"
    + "const mission = {lines: [], waypoints: [], approach_radius_m: 1, speeds: {}, speed: 'survey'};\n"
    + "const applyNogoControls = () => {}; const ensureNogoArea = async () => true; const render = () => {};\n"
    + "const foldChartInk = () => {};\n"
    + "const chartInk = {key: null, lines: [], areas: [], detached: [], note: null, z: null, ms: 0, busy: false};\n"
    + "const groundVel = GU.groundVel, guardStandoffM = GU.guardStandoffM;\n"
    + "const GUARD_HELM_S = GU.HELM_S;\n"
    + "const showBanner = (t) => log.banners.push(t); const flashNote = (t) => log.notes.push(t);\n"
    + "const setViolations = (r) => log.violations.push(r); const clearViolation = () => {};\n"
    + "const saveMission = () => { log.saves++; }; const recalcCommittedForSpeed = () => {};\n"
    + "const committedPatternInfo = () => null; const restoreStruckRuns = () => false;\n"
    + "let editingSv = null, cardSv = null; const renderSurveyTable = () => {}; const cardSurveyId = () => null;\n"
    + "let patReverse = false; const runBackwards = (o) => o.slice().reverse().map(s => [s[1], s[0]]);\n"
    + "const surveySettingsNow = () => null; const replaceSurvey = () => {}; const surveyById = () => null;\n"
    + "const surveyLabel = () => '';\n"
    + "const refreshPunchHold = () => null, punchCutNow = () => null, judgeRedHops = async () => {};\n"
    + "const heldCutAfterRead = () => null, releasePunchHold = () => {}, endClearing = () => {};\n"
    + "const stopClearingFor = () => {}, noteSurveyUpdated = () => {};\n"
    + "const renderClearRow = () => {};\n"
    + "let patStartT = null, patDurH = null, tideStrip = null; const renderTideStrip = () => {};\n"
    + "let patDefer = null, patDeferTime = null, patDeferMemo = null;\n"
    // THE CARD'S READ: set by a check (setLevel) for the card's own lines - the low it is cut at and the horizon's high
    + "let punchLevel = null; const refreshPunchLevel = async () => punchLevel, settlePunchLevel = async () => {};\n"
    + "const punchFlightOutgrewRead = async () => false, PUNCH_FLIGHT_REREAD = 2;\n"
    + "const rebuildNogo = () => { nogo.builtOffset = sea.waterOffset; };\n"
    // (a moored ship where a check puts one - log.ais - in the punch's own plane: 10c)
    + "function aisMooredClipKeepouts(){ return {polys: log.ais || [], stale: false, note: null}; }\n"
    + "function aisClipSig(){ return String((log.ais || []).length); }\n"
    + PAGE_FUNCS.map(grab).join("\n")
    + "\nreturn { $, log, mission, punchOut, punchNow, punchRefusal, commitPattern, resetPattern, liveCut, punchHighNow,"
    + " strikeSelectedRun, flushRepunch, patCoverMid, deferPastDuration, roleSpeedMS, turnTimeFactor, srcLineOf,"
    + " get: () => ({pat, patClip, patRed, patJoined, patTransits, patUnsafe, patLead, patDefer, patDeferTime,"
    + "              patDeferMemo, patStruck, patFunnel}),"
    + " lines: () => patSourceLines(),"
    + " setPat: (A, B, Cc) => { pat = {A, B, C: Cc, align: 0}; },"
    + " setWin: (st, dur) => { patStartT = st; patDurH = dur; },"
    + " setLevel: (v) => { punchLevel = v ? {...v, key: punchLevelKey(patSourceLines()), at: Date.now()} : null; },"
    + " select: (m) => { patSel = m; } };")(
    G, U, S, T, PS, C, GU, GEOM, $, document, log, require("../static/js/coast.js"));
  S.V.SPEED_KN = { low: 1.5, survey: 3.0, high: 6.0 };
  S.V.MAX_TURN_RATE_DEG_S = 60;
  S.V.MIN_SURVEY_LINE_M = 0;
  S.V.NOGO_MIN_DEPTH_M = 1.0;
  S.sea.waterOffset = 0;
  Object.assign(S.nogo, { frame: FRAME, buffer: 3, enf: { land: true, depth: true, haz: true, area: false },
                          features: o.features || [SHOAL()], band: "enc_harbor", note: "", ready: false });
  W.$("#sp_maxdepth").value = o.maxDepth ? String(o.maxDepth) : "";
  W.setPat(at(0, 0), at(45, 200), at(10, 0));      // five lines, x = 0 .. 40, n = 0 .. 200
  return W;
}
const HIGH_T = Math.floor(Date.now() / 1000) + 6 * 3600;
// The card's read with a window: cut at chart datum, the horizon's high +1.00 m six hours on.
const READ = { m: 0, say: "+0.00 m, the lowest predicted over its flight", read: true, failed: false, hours: 3, start: false,
               high: { m: 1.0, t: HIGH_T }, highWhy: null };
const onX = (seg, x) => Math.abs(xy(seg[0]).e - x) < 1 && Math.abs(xy(seg[1]).e - x) < 1;
const spanN = (seg) => { const a = xy(seg[0]).n, b = xy(seg[1]).n; return [Math.min(a, b), Math.max(a, b)]; };

(async () => {
  console.log("The survey window's selection - Plan A, whole lines:");
  const L3 = [[at(0, 0), at(0, 100)], [at(10, 0), at(10, 100)], [at(20, 0), at(20, 100)]];

  // ── 1. which drawn line a run lies on ────────────────────────────────────────────────────────────────────────────
  check("1. a run is put to the drawn line it lies ON - each of three parallel lines' pieces to its own, a run either "
        + "way round, a short one at a line's end - and to none (-1) with no lines",
        () => PURE.srcLineOf([at(0, 10), at(0, 30)], L3) === 0 && PURE.srcLineOf([at(20, 90), at(20, 60)], L3) === 2
              && PURE.srcLineOf([at(10, 99), at(10, 100)], L3) === 1 && PURE.srcLineOf([at(10, 0), at(10, 1)], []) === -1,
        () => [PURE.srcLineOf([at(0, 10), at(0, 30)], L3), PURE.srcLineOf([at(20, 90), at(20, 60)], L3)].join(","));

  // ── 2. cover and whole ───────────────────────────────────────────────────────────────────────────────────────────
  {
    const line = L3[0], full = [[at(0, 0), at(0, 100)]];
    const short4 = [[at(0, 0), at(0, 99.6)]], short6 = [[at(0, 0), at(0, 99.4)]];
    const gap = [[at(0, 0), at(0, 40)], [at(0, 45), at(0, 100)]];
    check("2. the low covers the outline only when every outline run lies inside one low run, to half a meter (under "
          + "the clip's 2 m step): 0.4 m short covers, 0.6 m short does not, two low runs with a gap do not cover one, a "
          + "run either way round reads the same - and a line is WHOLE only as one run end to end",
          () => PURE.coversRuns(full, full, line) && PURE.coversRuns(short4, full, line) && !PURE.coversRuns(short6, full, line)
                && !PURE.coversRuns(gap, full, line) && PURE.coversRuns(full, gap, line)
                && !PURE.coversRuns([[at(0, 0), at(0, 40)]], gap, line)        // (EVERY outline run, not one of them)
                && PURE.coversRuns([[at(0, 100), at(0, 0)]], full, line)
                && PURE.wholeLine(full, line) && PURE.wholeLine([[at(0, 100), at(0, 0)]], line)
                && !PURE.wholeLine(short6, line) && !PURE.wholeLine(gap, line) && !PURE.wholeLine([], line),
          () => "span of 99.4: " + PURE.runSpanM(short6[0], line).map((v) => v.toFixed(2)).join("-"));
  }

  // ── 3-4. the outline's depth window ──────────────────────────────────────────────────────────────────────────────
  {
    const a = PURE.deferHighDR({ min: 2.3, max: 10 }, 0, 1.5), b = PURE.deferHighDR({ min: 2.3, max: 0 }, 0, 1.5);
    const c = PURE.deferHighDR({ min: 2.3, max: 10 }, 0.5, 0.2);
    check("3. the outline's depth window: the floor as it is, the ceiling raised by the rise (so what is too deep to "
          + "survey is the same water at both levels), no ceiling stays none, and a 'high' under the low never lowers it",
          () => a.min === 2.3 && Math.abs(a.max - 11.5) < 1e-9 && b.min === 2.3 && b.max === 0 && c.max === 10,
          () => JSON.stringify([a, b, c]));
  }

  // ── 5. deferForWindow ───────────────────────────────────────────────────────────────────────────────────────────
  {
    // four lines: 0 whole at the low; 1 cut short by the tide (the outline longer); 2 cut by a pier the same at both;
    // 3 shut at the low, open at the high
    const src = [[at(0, 0), at(0, 100)], [at(10, 0), at(10, 100)], [at(20, 0), at(20, 100)], [at(30, 0), at(30, 100)]];
    const clipped = [[at(0, 0), at(0, 100)], [at(10, 0), at(10, 60)], [at(20, 0), at(20, 40)], [at(20, 55), at(20, 100)]];
    const outline = { 1: [[at(10, 0), at(10, 100)]], 2: [[at(20, 0), at(20, 40)], [at(20, 55), at(20, 100)]],
                      3: [[at(30, 0), at(30, 100)]] };
    const asked = [];
    const clipHigh = (i) => { asked.push(i); return outline[i] || []; };
    const d = PURE.deferForWindow(src, clipped, { lowM: 0, highM: 1.0, highT: HIGH_T, clipHigh, durH: 3 });
    const why = d.lines.map((x) => x.i + ":" + x.why).join(" ");
    check("5. deferForWindow defers WHOLE the line the tide cuts short at the low (its outline drawn) and the line the "
          + "low shuts but the high opens; keeps the line a pier cuts the same at both levels; never asks the outline of "
          + "a line the low left whole; and puts each run to its line",
          () => why === "1:tide 3:tide" && d.out.size === 2 && d.out.has(1) && d.out.has(3) && !d.out.has(2)
                && asked.join(",") === "1,2,3" && d.lines[0].runs === outline[1] && d.tide === true
                && d.of.join(",") === "0,1,2,2" && d.highM === 1.0 && d.highT === HIGH_T,
          () => why + "; outline asked of " + asked.join(",") + "; of " + d.of.join(","));
    const asked2 = [];
    const flat = PURE.deferForWindow(src, clipped, { lowM: 0.5, highM: 0.503, clipHigh: (i) => { asked2.push(i); return outline[i] || []; } });
    const none = PURE.deferForWindow(src, clipped, { lowM: 0, highM: NaN, highWhy: "the read failed", clipHigh: (i) => { asked2.push(i); return []; } });
    check("5b. no outline to judge by - the high not read, or no higher than the low - defers nothing for the tide and "
          + "asks no outline at all, and says which (`tide` false, the high or why kept)",
          () => flat.out.size === 0 && none.out.size === 0 && asked2.length === 0 && flat.tide === false && none.tide === false
                && flat.highM === 0.503 && none.highM === null && none.highWhy === "the read failed",
          () => "asked " + asked2.length + "; " + JSON.stringify([flat.tide, none.tide, none.highWhy]));
    const t = PURE.deferForWindow(src, clipped, { lowM: 0, highM: 1.0, clipHigh, timeLines: new Set([1, 2, 3]), durH: 3 });
    // line 3 again, with no high read: nothing of it at the low, so the duration is not what keeps it off the route,
    // and a "past its duration" count for it would name a cause it does not have
    const t0 = PURE.deferForWindow(src, clipped, { lowM: 0, highM: NaN, clipHigh, timeLines: new Set([2, 3]), durH: 3 });
    check("5c. the lines past the duration are deferred \"time\" with their runs at the low - a line both the tide and "
          + "the time defer is listed ONCE, for the tide, and a time line the low left nothing of is not listed",
          () => t.lines.map((x) => x.i + ":" + x.why).join(" ") === "1:tide 2:time 3:tide"
                && t.lines[1].runs.length === 2 && t.durH === 3
                && t0.lines.map((x) => x.i + ":" + x.why).join(" ") === "2:time" && t0.out.size === 1 && !t0.out.has(3),
          () => t.lines.map((x) => x.i + ":" + x.why + "/" + x.runs.length).join(" ") + " | no high: "
                + t0.lines.map((x) => x.i + ":" + x.why + "/" + x.runs.length).join(" "));
  }

  // ── 6. deferPastDuration ──────────────────────────────────────────────────────────────────────────────────────────
  {
    // its own world: five 200 m runs 10 m apart, a 10 m hop between each (no turn points), the speeds as the page's
    const Wd = new Function("G", "\"use strict\";\nconst {distTo, toEN} = G;\n"
      + "let patClip = null, patTransits = [], patLead = [], patDurH = null, patDeferTime = null, patStartT = null;\n"
      + "let turnKn = 1.5; const roleSpeedMS = (r) => (r === 'turn' ? turnKn : 3.0) * 0.514444;\n"
      + "let src = []; const patSourceLines = () => src;\n"
      + "const punchLevelKey = (lines) => lines.length + '|' + roleSpeedMS('survey').toFixed(2) + '|' + patDurH;\n"
      + ["distToRunM", "srcLineOf", "turnTimeFactor", "deferTimeKey", "deferPastDuration"].map(grab).join("\n")
      + "\nreturn { deferPastDuration, set: (o) => { patClip = o.clip; patTransits = o.transits || []; src = o.src;"
      + " patDurH = o.durH; if('turnKn' in o) turnKn = o.turnKn; }, get time(){ return patDeferTime; },"
      + " reset: () => { patDeferTime = null; } };")(G);
    const src = [0, 10, 20, 30, 40].map((x) => [at(x, 0), at(x, 200)]);
    const clip = src.map((l, k) => (k % 2 ? [l[1], l[0]] : l));                  // a lawnmower
    const vs = 3.0 * 0.514444, f = 3.0 / 1.5;                                     // joins at the turn speed: x2
    // line 0 200, hop 20 (10 x 2), line 1 200 (420), hop 20, line 2 200 (640): a cap at 600 m ends inside line 2
    Wd.set({ clip, src, durH: 600 / vs / 3600 });
    const grew = Wd.deferPastDuration(), first = [...Wd.time.lines].sort().join(",");
    const again = Wd.deferPastDuration();
    // a cap at 630 m: line 2 ends at 640 with the joins at the slow turn speed - past it - and at 620 with them at the
    // line's speed - inside it
    Wd.reset(); Wd.set({ clip, src, durH: 630 / vs / 3600 });
    const g630 = Wd.deferPastDuration(), at630 = [...Wd.time.lines].sort().join(",");
    Wd.reset(); Wd.set({ clip, src, durH: 630 / vs / 3600, turnKn: 3.0 });
    const g630s = Wd.deferPastDuration(), at630s = [...Wd.time.lines].sort().join(",");
    Wd.reset(); Wd.set({ clip, src, durH: null, turnKn: 1.5 });
    const noDur = Wd.deferPastDuration();
    check("6. the duration measured on the route the punch made: from the first line that ENDS past it (its lines at the "
          + "survey speed, its joins at the turn speed), it and every line after it are deferred, whole - a second "
          + "measure of the same route adds nothing; the joins' speed moves it; no duration defers nothing",
          () => grew === true && first === "2,3,4" && again === false && g630 === true && at630 === "2,3,4"
                && g630s === true && at630s === "3,4" && noDur === false && f === 2,
          () => "600 m: " + first + " (again " + again + "); 630 m at a slow turn: " + at630 + ", at the line speed: " + at630s);
    // a turn speed change keys a fresh set, and a set keeps what it had for the same key
    Wd.reset(); Wd.set({ clip, src, durH: 600 / vs / 3600, turnKn: 1.5 }); Wd.deferPastDuration();
    const k1 = Wd.time.key;
    Wd.set({ clip: clip.slice(0, 2), src, durH: 600 / vs / 3600, turnKn: 1.5 });
    const kept = Wd.deferPastDuration(), stillDeferred = [...Wd.time.lines].sort().join(",");
    Wd.set({ clip, src, durH: 600 / vs / 3600, turnKn: 1.0 });
    Wd.deferPastDuration();
    const k2 = Wd.time.key;
    check("6b. the lines deferred for the duration are kept for their key - a route of the lines left that fits adds "
          + "nothing and drops none - and a new turn speed keys a set of its own",
          () => kept === false && stillDeferred === "2,3,4" && k1 !== k2,
          () => "kept " + kept + ", deferred " + stillDeferred + "; keys differ: " + (k1 !== k2));
  }

  // ── 7. the words ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const Ww = new Function("\"use strict\";\n"
      + "const surgeWhen = (t) => 'Thu 14:00';\n"
      + decl(/^const SURVEY_DEFERRED_MAX = [^;]*;/m) + "\n"
      + ["fmtLevel", "deferSay", "emptyPunchRefusal", "deferredRecord", "surveyDeferredN", "deferredWhy"].map(grab).join("\n")
      + "\nreturn {deferSay, emptyPunchRefusal, deferredRecord, surveyDeferredN, deferredWhy};")();
    const d = { out: new Set([1, 3, 4]), tide: true, lowM: -0.12, highM: 1.04, highT: HIGH_T, durH: 2.5,
                lines: [{ i: 1, why: "tide", runs: [[{ lat: 1, lon: 2 }, { lat: 1.001, lon: 2 }]] },
                        { i: 3, why: "time", runs: [[{ lat: 3, lon: 2 }, { lat: 3.001, lon: 2 }], [{ lat: 3.002, lon: 2 }, { lat: 3.003, lon: 2 }]] },
                        { i: 4, why: "time", runs: [[{ lat: 4, lon: 2 }, { lat: 4.001, lon: 2 }]] }] };
    const say = Ww.deferSay(d);
    const fit = Ww.deferSay({ out: new Set(), lines: [], tide: true, lowM: 0, highM: 1.0, highT: HIGH_T });
    const unread = Ww.deferSay({ out: new Set(), lines: [], tide: false, lowM: 0, highM: null, highWhy: "the read failed" });
    check("7. the punch summary says how many lines were deferred and why, each by count - the window's low and the "
          + "high it outlined at, the duration - that they are dashed and never flown; a window every line fits says so; "
          + "a high it could not read says lines the tide cuts are flown in part; no window, nothing",
          () => say === " · 3 lines DEFERRED - dashed on the chart, never flown: 1 not clear end to end at the window's low, "
                        + "-0.12 m; 2 past its 2.5 h duration (outlined at the high water ahead, +1.04 m Thu 14:00)"
                && fit === " · every line fits its window (outlined at the high water ahead, +1.00 m Thu 14:00)"
                && /could not be read - the read failed: none is deferred for the tide, and a line the tide cuts short is flown in part/.test(unread)
                && Ww.deferSay(null) === "",
          () => say + " || " + unread);
    const ref = Ww.emptyPunchRefusal({ drawn: 5, clipped: 5, struck: 0, slivers: 0, short: 0, minLine: 0, chans: 0,
                                       deferred: { lines: 5, tide: 2, time: 3, lowM: -0.12, durH: 2.5 } });
    check("7b. a punch whose window deferred every line is refused at Add to plan naming the deferral - by the tide and "
          + "by the time, with the window's low and its duration - and the fixes that are the operator's: a start nearer "
          + "high water, a longer duration, or no window",
          () => /^ADD TO PLAN REFUSED — Punch Out left no survey line: 2 line\(s\) deferred: not clear end to end at its window's low, -0\.12 m; 3 line\(s\) deferred: past its 2\.5 h duration\. /.test(ref.text)
                && /To fix: set a start nearer high water, or lengthen its Duration, or clear its Start and Duration/.test(ref.text),
          () => ref.text);
    const rec = Ww.deferredRecord(d);
    const s = { deferred: rec, deferred_high_m: 1.04 };
    check("7c. the survey's record of them: a run each, the drawn line it lies on and why, plain positions - so the row "
          + "counts LINES (three, not four runs) and its tip says why",
          () => rec.length === 4 && rec.every((r) => Object.keys(r).join(",") === "i,a,b,why" && Object.keys(r.a).join(",") === "lat,lon")
                && rec[1].i === 3 && rec[2].i === 3 && rec[1].why === "time"
                && Ww.surveyDeferredN(s) === 3 && Ww.surveyDeferredN({}) === 0
                && Ww.deferredWhy(s) === "1 not clear end to end at its window's low (drawn at the high water ahead, +1.04 m), 2 past its duration",
          () => JSON.stringify(rec[0]) + " | " + Ww.deferredWhy(s));
  }

  // 7d. the plan's surveys' deferred lines on the chart - but not the survey on the card, whose own punch draws its own
  {
    const moves = [];
    const ctx = { save() {}, restore() {}, setLineDash() {}, beginPath() {}, stroke() {}, lineTo() {},
                  moveTo(x, y) { moves.push(x); }, strokeStyle: "", globalAlpha: 1, lineWidth: 1 };
    const Wdr = new Function("ctx", "\"use strict\";\n" + decl(/^const DEFER_INK = [^;]*;/m) + "\n"
      + "let editingSv = 'S2'; const mission = {surveys: [\n"
      + "  {id: 'S1', deferred: [{i: 0, a: {lat: 1, lon: 1}, b: {lat: 2, lon: 1}, why: 'tide'}]},\n"
      + "  {id: 'S2', deferred: [{i: 0, a: {lat: 5, lon: 5}, b: {lat: 6, lon: 5}, why: 'time'}]},\n"
      + "  {id: 'S3', deferred: null}, {id: 'S4'}]};\n"
      + grab("drawDeferredSurveys") + "\nreturn drawDeferredSurveys;")(ctx);
    Wdr((lat, lon) => ({ x: lon * 10, y: lat * 10 }));
    check("7d. the plan's surveys' deferred lines are drawn on the chart - every survey's but the one on the card (✎), "
          + "whose punch draws its own - and a survey with none draws nothing",
          () => moves.length === 1 && moves[0] === 10,
          () => "segments drawn at x " + moves.join(","));
  }

  // ── 8. the read ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const asks = [];
    const Wr = new Function("asks", "G", "\"use strict\";\nconst {distTo} = G;\n"
      + "const surgeWhen = (t) => 'Thu';\n"
      + decl(/^const WATER_ETA_SLACK = [^;]*;/m) + "\n" + decl(/^const WATER_WINDOW_PAD_S = [^;]*;/m) + "\n"
      + decl(/^const WATER_WINDOW_MAX_H = [^;]*;/m) + "\n"
      + "let patStartT = null, patDurH = null, punchFlown = null, water = null, series = null;\n"
      + "const roleSpeedMS = (r) => (r === 'transit' ? 3.0 : 1.5);\n"
      + "const punchPreM = () => 0;\n"
      + "const waterAlongRead = async (path, t0, t1) => { asks.push(['along', t0, t1]); return {points: [{low_m: 0.2}]}; };\n"
      + "const waterSeriesRead = async (line, t0, t1) => { asks.push(['series', t0, t1]); if(series instanceof Error) throw series; return series; };\n"
      + "const sectionLevel = (r, wl, hours, when) => ({m: 0.2, say: 'the low', read: true});\n"
      + ["turnTimeFactor", "punchLevelKey", "punchFlightM", "punchDrawnM", "windowSelects", "punchOwnM", "flightWindow",
         "readPunchLevel", "horizonHigh"].map(grab).join("\n")
      + "\nreturn { readPunchLevel, punchOwnM, punchFlightM, punchLevelKey, set: (o) => { patStartT = o.st ?? null; patDurH = o.dur ?? null;"
      + " series = o.series ?? null; punchFlown = o.flown ?? null; } };")(asks, G);
    const lines = [[at(0, 0), at(0, 1800)], [at(20, 1800), at(20, 0)]];     // 3600 m of line, 20 m between
    Wr.set({});
    const none = await Wr.readPunchLevel(lines), asksNone = asks.splice(0);
    const st = Date.now() / 1000 + 3 * 3600;
    Wr.set({ st, dur: 2, series: { ok: true, high: { m: 1.37, t: st + 5 * 3600 }, low: { m: 0.2, t: st } } });
    const win = await Wr.readPunchLevel(lines), asksWin = asks.splice(0);
    Wr.set({ st, dur: 2, series: { ok: false, note: "no station within 10 km" } });
    const bad = await Wr.readPunchLevel(lines);
    asks.splice(0);
    Wr.set({ st, dur: 2, series: new Error("socket hang up") });
    const tr = await safely(() => Wr.readPunchLevel(lines)), threw = tr.v || { highWhy: "THE READ THREW: " + (tr.err && tr.err.message) };
    asks.splice(0);
    const ser = asksWin.find((a) => a[0] === "series"), along = asksWin.find((a) => a[0] === "along");
    check("8. with a window the level read asks the HORIZON'S HIGH beside the window's low - the series from the window's "
          + "start to 24 h on - and carries it; without one it asks the low alone and carries none; a high not read is "
          + "said, and a read that threw is a high not read, never a punch that fails",
          () => asksNone.length === 1 && asksNone[0][0] === "along" && none.high == null && none.highWhy == null
                && ser && along && Math.abs(ser[1] - st) < 1e-6 && Math.abs(ser[2] - (st + 24 * 3600)) < 1e-6
                && Math.abs(along[1] - st) < 1e-6 && win.high.m === 1.37 && win.high.t === st + 5 * 3600 && win.m === 0.2
                && bad.high == null && bad.highWhy === "no station within 10 km" && !tr.err && threw.high == null
                && /socket hang up/.test(threw.highWhy || ""),
          () => JSON.stringify({ none: asksNone.map((a) => a[0]), win: asksWin.map((a) => a[0]), high: win.high, bad: bad.highWhy, threw: threw.highWhy }));
    // the flight the window is read over: with a duration the drawing counts up to it - its later lines are deferred
    const vs = 1.5, drawn = 3600 + 20 * 1;          // the turn factor here: survey 1.5 / turn 1.5 = 1
    Wr.set({});
    const noDur = Wr.punchOwnM(lines);
    Wr.set({ dur: 0.25 });
    const capped = Wr.punchOwnM(lines);
    Wr.set({ dur: 2 });
    const roomy = Wr.punchOwnM(lines);
    Wr.set({ dur: 0.25 });
    Wr.set({ dur: 0.25, flown: { key: Wr.punchLevelKey(lines), m: 2000 } });
    const flown = Wr.punchOwnM(lines);
    check("8b. the flight the water is read over: without a duration, the drawing's (punchFlightM, as before); with one, "
          + "the drawing up to the duration's meters at the survey speed - the lines past it are deferred, not flown - "
          + "never more than the drawing, and the route the punch made when it was measured longer",
          // (to half a meter: the drawing is measured over the ground, 1.8 km lines off a plane)
          () => Math.abs(noDur - drawn) < 0.5 && Math.abs(capped - 0.25 * 3600 * vs) < 1e-6 && Math.abs(roomy - drawn) < 0.5
                && flown === 2000,
          () => [noDur, capped, roomy, flown].map((v) => v.toFixed(0)).join(" / "));
  }

  // ── 9. the high on the cut ───────────────────────────────────────────────────────────────────────────────────────
  {
    const w = makeWorld();
    const noWin = w.liveCut();
    w.setWin(null, 10); w.setLevel(READ);
    const own = w.liveCut();
    w.setPat(at(0, 0), at(45, 210), at(10, 0));      // the drawing moved after the read
    const moved = w.punchHighNow();
    check("9. the live cut carries the outline's high: none with no window, the card's own read's high with one, and a "
          + "read for other lines is said as not read for these - and the clearing's hold takes and hands back the same",
          () => noWin.high === null && own.high && own.high.m === 1.0 && own.high.t === HIGH_T && own.waterM === 0
                && moved && moved.m == null && /not read for these lines/.test(moved.why)
                && /high: punchHighNow\(\)\};/.test(grab("takePunchHold")) && /high: punchHold\.high \|\| null\} : null;/.test(grab("punchCutNow")),
          () => JSON.stringify({ noWin: noWin.high, own: own.high, moved }));
  }

  // ── 10-12. THE REAL PUNCH ────────────────────────────────────────────────────────────────────────────────────────
  const w = makeWorld();
  w.setWin(null, 10); w.setLevel(READ);
  const p10 = await safely(() => w.punchOut());
  const g10 = w.get(), hint10 = w.$("#sp_hint").textContent;
  const on20 = (g10.patClip || []).filter((s) => onX(s, 20));
  const d10 = g10.patDefer;
  check("10. a real punch with a window: the line the shoal cuts at chart datum - open at the +1.00 m high water ahead - "
        + "is DEFERRED WHOLE, its outline the whole line; the four clear lines are Plan A, none of them on it",
        () => !p10.err && g10.patClip && g10.patClip.length === 4 && on20.length === 0 && d10 && d10.out.size === 1
              && d10.lines.length === 1 && d10.lines[0].why === "tide" && d10.lines[0].runs.length === 1
              && onX(d10.lines[0].runs[0], 20) && spanN(d10.lines[0].runs[0])[0] < 0.5 && spanN(d10.lines[0].runs[0])[1] > 199.5,
        () => (p10.err ? "punch threw: " + p10.err.message + "; " : "") + (g10.patClip || []).length + " runs ("
              + on20.length + " on x 20); deferred " + JSON.stringify(d10 && d10.lines.map((x) => [x.i, x.why, x.runs.map(spanN)])));
  check("10b. ... said: the summary counts it with its why and the levels, and the funnel records it (the runs the "
        + "chart left, before the window took its line)",
        () => /· 1 line DEFERRED - dashed on the chart, never flown: 1 not clear end to end at the window's low, \+0\.00 m \(outlined at the high water ahead, \+1\.00 m /.test(hint10)
              && g10.patFunnel.clipped === 6 && g10.patFunnel.deferred && g10.patFunnel.deferred.tide === 1
              && g10.patFunnel.deferred.time === 0 && g10.patFunnel.deferred.lines === 1,
        () => hint10.slice(0, 400) + " | funnel " + JSON.stringify(g10.patFunnel && { clipped: g10.patFunnel.clipped, deferred: g10.patFunnel.deferred }));

  // 10c. A SHIP AT HER BERTH ON LINE x = 0 cuts it the same at every water: the outline is cut round her too (the
  // channels and moored ships the coverage is cut round are the outline's), so the line is flown in its two parts and
  // NOT deferred - a ship is not the tide.
  {
    const R = [{ e: -4, n: 50 }, { e: 4, n: 50 }, { e: 4, n: 80 }, { e: -4, n: 80 }];
    const ship = { ring: R, bb: { x0: -4, y0: 50, x1: 4, y1: 80 }, kind: "AIS: X (30 x 8 m, moored)", mmsi: 1 };
    const wa = makeWorld();
    wa.log.ais = [ship];
    wa.setWin(null, 10); wa.setLevel(READ);
    const pa = await safely(() => wa.punchOut());
    const ga = wa.get();
    check("10c. a ship at her berth across another line cuts it the same at both levels - the outline is cut round her "
          + "as the coverage is - so that line is flown in its two parts and only the shoal's line is deferred",
          () => !pa.err && ga.patClip.filter((s) => onX(s, 0)).length === 2 && ga.patDefer.out.size === 1
                && ga.patDefer.lines[0].i === 2,
          () => (pa.err ? "threw " + pa.err.message + "; " : "") + ga.patClip.filter((s) => onX(s, 0)).length
                + " runs on x 0; deferred " + JSON.stringify(ga.patDefer && ga.patDefer.lines.map((x) => [x.i, x.why])));
  }

  const w11 = makeWorld();
  w11.setLevel(READ);                         // (a read, but no window on the card)
  const p11 = await safely(() => w11.punchOut());
  const g11 = w11.get();
  const on20b = (g11.patClip || []).filter((s) => onX(s, 20));
  check("11. NO WINDOW, NOTHING SELECTED: the same punch with no start or duration flies the cut line in part, as "
        + "before - its two runs either side of the shoal - and defers nothing, never asking the outline",
        () => !p11.err && g11.patDefer === null && on20b.length === 2 && g11.patClip.length === 6 && w11.log.builds === 2
              && !/DEFERRED|fits its window/.test(w11.$("#sp_hint").textContent),
        () => (p11.err ? "threw " + p11.err.message + "; " : "") + g11.patClip.length + " runs, " + on20b.length
              + " on x 20; models built " + w11.log.builds);

  const w12 = makeWorld({ features: [SHOAL(), DEEP()], maxDepth: 10 });
  w12.setWin(null, 10); w12.setLevel(READ);
  const p12 = await safely(() => w12.punchOut());
  const d12 = w12.get().patDefer;
  const o12 = d12 && d12.lines[0] && d12.lines[0].runs;
  check("12. under a 10 m Max depth, water a meter under it at chart datum stays in the outline at +1.00 m: the deferred "
        + "line is drawn end to end - the coverage ceiling rises with the water (deferHighDR), so the outline is the "
        + "line at its most, not shortened by the water's own rise",
        () => !p12.err && d12 && d12.lines.length === 1 && o12.length === 1 && spanN(o12[0])[0] < 0.5 && spanN(o12[0])[1] > 199.5,
        () => (p12.err ? "threw " + p12.err.message + "; " : "") + "outline " + JSON.stringify(o12 && o12.map(spanN)));

  // ── 13. STRIKES ARE NOT DEFERRALS ────────────────────────────────────────────────────────────────────────────────
  {
    const ws = makeWorld();
    ws.setWin(null, 10); ws.setLevel(READ);
    await safely(() => ws.punchOut());
    const k0 = ws.get().patClip.findIndex((s) => onX(s, 0));
    ws.select(ws.patCoverMid(k0));
    ws.strikeSelectedRun();
    await safely(() => ws.flushRepunch());
    const afterStrike = ws.get();
    const struck0 = afterStrike.patStruck.slice();
    ws.setWin(null, null); ws.setLevel(READ);
    await safely(() => ws.punchOut());
    const back = ws.get();
    check("13. the window never touches a strike: a run struck with a line deferred stays the one strike, and with the "
          + "window cleared the deferred line comes back (in part, as the tide cuts it) while the struck run stays struck",
          () => struck0.length === 1 && afterStrike.patClip.length === 3 && !afterStrike.patClip.some((s) => onX(s, 0))
                && afterStrike.patDefer.out.size === 1 && back.patStruck.length === 1 && back.patStruck[0] === struck0[0]
                && back.patDefer === null && back.patClip.filter((s) => onX(s, 20)).length === 2
                && !back.patClip.some((s) => onX(s, 0)),
          () => "struck " + struck0.length + "; after the strike " + afterStrike.patClip.length + " runs; window cleared: "
                + back.patClip.length + " runs, " + back.patClip.filter((s) => onX(s, 20)).length + " on x 20, strikes "
                + back.patStruck.length);
  }

  // ── 14. THE OUTLINE NEVER REACHES THE PLAN ───────────────────────────────────────────────────────────────────────
  {
    const wc = makeWorld();
    wc.setWin(null, 10); wc.setLevel(READ);
    await safely(() => wc.punchOut());
    const refused = wc.punchRefusal();
    const pc = await safely(() => wc.commitPattern());
    const m = wc.mission, outline = [at(20, 0), at(20, 200)];
    const near = (p) => G.distTo(p, outline[0]) >= 0 && Math.abs(xy(p).e - 20) < 1 && xy(p).n > -0.5 && xy(p).n < 200.5;
    const rec = (m.surveys || [])[0] || {};
    check("14. Add to plan: the plan's lines are Plan A's four and none of its lines or waypoints lies on the deferred "
          + "line - and the survey's record carries the deferred line (its run, its drawn line, why) and the high water "
          + "its outline was cut at",
          () => !pc.err && refused === null && m.lines.length === 4 && !m.lines.some((l) => near(l.a) && near(l.b))
                && !m.waypoints.some(near) && Array.isArray(rec.deferred) && rec.deferred.length === 1
                && rec.deferred[0].i === 2 && rec.deferred[0].why === "tide" && near(rec.deferred[0].a) && near(rec.deferred[0].b)
                && rec.deferred_high_m === 1.0,
          () => (pc.err ? "commit threw: " + pc.err.message + "; " : "") + (refused ? "refused: " + refused.short + "; " : "")
                + m.lines.length + " lines, " + m.waypoints.filter(near).length + " waypoints on x 20; record "
                + JSON.stringify(rec.deferred) + " high " + rec.deferred_high_m);
    // ... and BY CONSTRUCTION: every place the page names the deferred lines is one that draws, says or records them
    const ALLOWED = new Set(["punchOut", "drawPattern", "commitPattern", "resetPattern", "emptyPunchRefusal",
                             "drawDeferredSurveys", "surveyDeferredN", "deferredWhy"]);
    const FN = /\n(?:async )?function ([A-Za-z0-9_$]+)\(/g;
    const fns = [];
    for (let mm; (mm = FN.exec(H));) { const r = grabAt(mm[1]); if (r.start === mm.index + 1 || r.start === mm.index + 7) fns.push({ name: mm[1], ...r }); }
    const READS = /\bpatDefer\b|\.deferred\b|deferred_high_m\b/g;
    const outside = [], where = new Set();
    for (let mm; (mm = READS.exec(H));) {
      const f = fns.find((x) => x.start <= mm.index && mm.index < x.end);
      if (f) { where.add(f.name); if (!ALLOWED.has(f.name)) outside.push(f.name); continue; }
      const lineStart = H.lastIndexOf("\n", mm.index) + 1, ln = H.slice(lineStart, H.indexOf("\n", mm.index));
      if (!/^let patDefer = null;$/.test(ln) && !/^\s*\/\//.test(ln) && !/^\s*\/?\*/.test(ln)) outside.push("top level: " + ln.trim().slice(0, 60));
    }
    const pyHits = PY.split("\n").filter((l) => /deferred/.test(l) && !/^\s*#/.test(l));
    const pyFn = PY.slice(PY.indexOf("def _check_survey_deferred("), PY.indexOf("def _check_survey_settings("));
    check("14b. ... and by construction: the page names the deferred lines ONLY where it punches, draws, says, records or "
          + "resets them - never in Upload, the route, the plan's waypoints or the flight - and the server only checks them",
          () => outside.length === 0 && ["punchOut", "drawPattern", "commitPattern", "drawDeferredSurveys"].every((n) => where.has(n))
                && pyHits.every((l) => pyFn.includes(l) || /^SURVEY_DEFERRED_MAX = /.test(l) || /_check_survey_deferred\(sid, s\)/.test(l)),
          () => "named in " + [...where].join(", ") + (outside.length ? "; OUTSIDE: " + outside.join(", ") : "")
                + "; server lines " + pyHits.length);
  }

  // ── 15. the duration through punchNow ────────────────────────────────────────────────────────────────────────────
  {
    // measure the route a no-window punch makes, then give it a duration that ends inside its third line
    // (a chart with nothing near the lines - an empty one is no chart, and the punch leaves the lines un-punched)
    const FAR = () => area(900, 910, 900, 910, 0.5, 0.5);
    const wm = makeWorld({ features: [FAR()] });
    await safely(() => wm.punchOut());
    const g = wm.get(), f = wm.turnTimeFactor(), vs = wm.roleSpeedMS("survey");
    const ends = [];
    let M = 0;
    for (let k = 0; k < g.patClip.length; k++) {
      M += G.distTo(g.patClip[k][0], g.patClip[k][1]); ends.push(M);
      if (k + 1 < g.patClip.length) { let p = g.patClip[k][1];
        for (const v of g.patTransits[k] || []) { M += G.distTo(p, v) * f; p = v; }
        M += G.distTo(p, g.patClip[k + 1][0]) * f; }
    }
    const capM = (ends[1] + ends[2]) / 2;
    const wt = makeWorld({ features: [FAR()] });
    wt.setWin(null, capM / vs / 3600); wt.setLevel(READ);
    const pt = await safely(() => wt.punchNow());
    const gt = wt.get(), hint = wt.$("#sp_hint").textContent;
    let Mt = 0;
    for (let k = 0; k < gt.patClip.length; k++) {
      Mt += G.distTo(gt.patClip[k][0], gt.patClip[k][1]);
      if (k + 1 < gt.patClip.length) { let p = gt.patClip[k][1];
        for (const v of gt.patTransits[k] || []) { Mt += G.distTo(p, v) * f; p = v; }
        Mt += G.distTo(p, gt.patClip[k + 1][0]) * f; }
    }
    const times = gt.patDefer ? gt.patDefer.lines.filter((x) => x.why === "time").map((x) => x.i).sort().join(",") : "none";
    check("15. a duration that ends inside the third line flown: punchNow defers it and the two after it, punches again "
          + "without them, and Plan A - the first two - flies inside the duration; the summary says so",
          () => !pt.err && gt.patClip.length === 2 && gt.patDefer && gt.patDefer.out.size === 3 && times.split(",").length === 3
                && Mt <= capM + 1e-6 && gt.patDeferTime && gt.patDeferTime.lines.size === 3
                // (the duration said as typed, to the hundredth - not the float a suite computes)
                && hint.includes("3 lines DEFERRED - dashed on the chart, never flown: 3 past its "
                                 + +(capM / vs / 3600).toFixed(2) + " h duration"),
          () => (pt.err ? "threw " + pt.err.message + "; " : "") + "route ends " + ends.map((v) => v.toFixed(0)).join("/")
                + ", cap " + capM.toFixed(0) + "; Plan A " + gt.patClip.length + " runs, " + Mt.toFixed(0) + " m; time-deferred "
                + times + "; " + hint.slice(0, 220));
  }

  // ── 16. the outline's clips kept through a strike's re-punch ─────────────────────────────────────────────────────
  {
    const wk = makeWorld();
    wk.setWin(null, 10); wk.setLevel(READ);
    await safely(() => wk.punchOut());
    const memo1 = wk.get().patDeferMemo, b1 = wk.log.builds;
    await safely(() => wk.punchOut());
    const memo2 = wk.get().patDeferMemo, b2 = wk.log.builds;
    wk.setLevel({ ...READ, high: { m: 1.2, t: HIGH_T } });
    await safely(() => wk.punchOut());
    const memo3 = wk.get().patDeferMemo, b3 = wk.log.builds;
    check("16. the outline's clips are kept for the same inputs - a re-punch asks no outline and builds no model for it "
          + "- and a new high is clipped afresh",
          () => memo1 && memo1 === memo2 && memo1.runs.size === 1 && b1 === 3 && b2 - b1 === 2 && memo3 !== memo2
                && b3 - b2 === 3 && wk.get().patDefer.out.size === 1,
          () => "models built " + b1 + " / +" + (b2 - b1) + " / +" + (b3 - b2) + "; memo lines " + (memo1 && memo1.runs.size));
  }

  // ── 17. the wiring ───────────────────────────────────────────────────────────────────────────────────────────────
  {
    const po = grab("punchOut"), pn = grab("punchNow"), pp = grab("punchOutPressed"), rp = grab("resetPattern");
    const iMemo = po.indexOf("patClipMemo = clipKey ? {key: clipKey"), iSel = po.indexOf("patDefer = deferForWindow(src, clipped,");
    const iFilter = po.indexOf("clipped = clipped.filter((s, j) => !patDefer.out.has(of[j]));");
    const iTurn = po.indexOf("const turnExcl = "), iRuns = po.indexOf("const runs = keptRuns(clipped);");
    check("17. the wiring: the selection stands after the clip and before the turn water and the strike filter, inside "
          + "`if(windowSelects())`; punchNow defers past the duration before it measures the flight for the water, at "
          + "most DEFER_TIME_MAX times; a press of Punch Out measures the duration afresh; Reset forgets it all; the "
          + "strip and the level read the flight the window is read over (punchOwnM)",
          () => iMemo > 0 && iSel > iMemo && iFilter > iSel && iTurn > iFilter && iRuns > iTurn
                && /if\(windowSelects\(\)\)\{[\s\S]*?patDefer = deferForWindow/.test(po)
                && /if\(res !== "stopped" && timed < DEFER_TIME_MAX && deferPastDuration\(\)\)\{ timed\+\+; i--; continue; \}\s*\n\s*if\(res !== "stopped" && grew < PUNCH_FLIGHT_REREAD && await punchFlightOutgrewRead\(\)\)/.test(pn)
                && /endClearing\(null\); releasePunchHold\(\);\s*\n\s*patDeferTime = null;/.test(pp)
                && /patDefer = null; patDeferTime = null; patDeferMemo = null;/.test(rp)
                && /flightWindow\(punchPreM\(lines\), punchOwnM\(lines\), patStartT, patDurH\)/.test(grab("tideStripReadOnce"))
                && /const ownM = punchOwnM\(lines\);/.test(grab("readPunchLevel"))
                && /patClip=null; patDropped=null; patDefer=null;/.test(po),
          () => [iMemo, iSel, iFilter, iTurn, iRuns].join(" < "));
  }

  __finished = true;
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
