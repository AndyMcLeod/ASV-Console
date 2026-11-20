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
  "deferTimeKey", "deferForWindow", "deferPastDuration", "deferSay", "deferredRecord", "turnTimeFactor",
  // ... AND PLAN B (phase 3): the water each deferred line needs, a drawing's own lines
  "needRungs", "needFloorM", "clipGridN", "uncoveredSamples", "deferNeedM", "patSourceAll", "patOnlyIdx", "patSourceIdx",
  // ... and the phase 3 review's: the drawing a Plan B's line numbers are of
  "planBSig", "planBDrawingCheck"];
const PAGE_DECLS = [/^const NO_LEAD = [^;]*;/m, /^const LEAD_GIVE = [^;]*;/m, /^const MAX_SURVEY_LINES = [^;]*;/m,
  /^const LEAD_MAX_M = [^;]*;/m, /^const REPUNCH_DELAY_MS = [^;]*;/m, /^const TIDE_REBUILD_M = [^;]*;/m,
  /^const TRIM_MAX_M = [^;]*;/m, /^const JUDGE_RUN_M = [^;]*;/m, /^const SPEED_ROLES = [^;]*;/m,
  /^const PUNCH_SLICE = [^;]*;/m, /^const DEFER_EPS_M = [^;]*;/m, /^const DEFER_TIME_MAX = [^;]*;/m,
  /^const SURVEY_DEFERRED_MAX = [^;]*;/m, /^const NEED_STEP_M = [^;]*;/m];

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
    + "let patOnly = null, patOutlineM = null, patPlanBName = ''; const showPlanBNote = () => {};\n"
    + "let patOutlineLowM = null, patOnlySig = null, patPlanBSay = '';\n"
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
    // (the lines past the duration, as deferPastDuration leaves them for the drawing on the card: 15c)
    + " setTime: (ls) => { patDeferTime = {key: deferTimeKey(patSourceLines()), lines: new Set(ls)}; },"
    + " setPlanB: (only, outlineM, name, lowM) => { patOnly = only; patOutlineM = outlineM ?? null; patPlanBName = name || '';"
    + "   patOutlineLowM = lowM ?? null; patOnlySig = null; },"
    + " planB: () => ({only: patOnly, outlineM: patOutlineM, lowM: patOutlineLowM, name: patPlanBName, sig: patOnlySig}),"
    + " planBDrawingCheck, updatePatReadout,"
    + " all: () => patSourceAll(),"
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
    // (the phase 3 review: the ceiling is ANCHORED at the first plan's cut and moves with the water BOTH ways - under the
    //  anchor it comes down, so the same seabed is too deep at every level; never to 0, which would mean no ceiling)
    const d0 = PURE.deferHighDR({ min: 2.3, max: 0.2 }, 1.0, 0.0);
    check("3. the outline's depth window: the floor as it is, the ceiling moved WITH the water from the level it is "
          + "anchored at - up by a rise, down by a fall (so what is too deep to survey is the same seabed at every "
          + "level) - no ceiling stays none, and a ceiling is never lowered to none",
          () => a.min === 2.3 && Math.abs(a.max - 11.5) < 1e-9 && b.min === 2.3 && b.max === 0 && Math.abs(c.max - 9.7) < 1e-9
                && d0.max > 0 && d0.max <= 0.01,
          () => JSON.stringify([a, b, c, d0]));
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
                        + "-0.12 m; 2 past its 2.5 h duration (outlined at the high water ahead, +1.04 m Thu 14:00). "
                        + "Add to plan, then Plan B on its row plans them for a start that has the water"
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
          () => rec.length === 4 && rec.every((r) => Object.keys(r).join(",") === "i,a,b,why,need_m" && r.need_m === null
                                                   && Object.keys(r.a).join(",") === "lat,lon")
                && rec[1].i === 3 && rec[2].i === 3 && rec[1].why === "time"
                && Ww.surveyDeferredN(s) === 3 && Ww.surveyDeferredN({}) === 0
                && Ww.deferredWhy(s) === "1 not clear end to end at its window's low (drawn at the high water ahead, +1.04 m), 2 past its duration",
          () => JSON.stringify(rec[0]) + " | " + Ww.deferredWhy(s));
    // (phase 3) ... with the water the tide lines need, when the record has it
    const sn = { deferred: [{ i: 1, why: "tide", need_m: 0.45 }, { i: 1, why: "tide", need_m: 0.45 }, { i: 2, why: "tide", need_m: 0.7 }],
                 deferred_high_m: 1.0 };
    const s1n = { deferred: [{ i: 1, why: "tide", need_m: 0.45 }], deferred_high_m: 1.0 };
    // ... and the duration's lines' own, apart from the tide's (a time line's need is asked down from its cut: 15c)
    const stn = { deferred: [{ i: 1, why: "tide", need_m: 0.45 }, { i: 4, why: "time", need_m: -0.3 }, { i: 5, why: "time", need_m: 0.5 }],
                  deferred_high_m: 1.0 };
    const dn = { ...d, lines: [{ ...d.lines[0], needM: 0.45 }, { ...d.lines[1], needM: -0.3 }, { ...d.lines[2], needM: 0.5 }] };
    const d1 = { ...d, out: new Set([3]), lines: [{ ...d.lines[1], needM: 0.2 }] };
    check("7e. the row's tip says the water the lines need, the tide's and the duration's each - the range, or the one "
          + "level - and so does the punch summary",
          () => Ww.deferredWhy(sn) === "2 not clear end to end at its window's low (drawn at the high water ahead, +1.00 m), needing +0.45 m to +0.70 m"
                && Ww.deferredWhy(s1n) === "1 not clear end to end at its window's low (drawn at the high water ahead, +1.00 m), needing +0.45 m"
                && Ww.deferredWhy(stn) === "1 not clear end to end at its window's low (drawn at the high water ahead, +1.00 m), needing +0.45 m, "
                                           + "2 past its duration, needing -0.30 m to +0.50 m"
                && Ww.deferSay(dn).includes("1 not clear end to end at the window's low, -0.12 m - it needs +0.45 m; "
                                            + "2 past its 2.5 h duration - they need -0.30 m to +0.50 m (outlined")
                && Ww.deferSay(d1).includes("1 line DEFERRED - dashed on the chart, never flown: 1 past its 2.5 h duration - it needs +0.20 m (outlined"),
          () => Ww.deferredWhy(sn) + " | " + Ww.deferredWhy(s1n) + " | " + Ww.deferredWhy(stn) + " | " + Ww.deferSay(dn) + " | " + Ww.deferSay(d1));
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
      + "let patOnly = null, patOutlineM = null;\n"
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
    // (phase 3) ... and the same read's LOW, the floor a time line's need is asked down to: the number the series gave,
    // none when it gave none - a null is not chart datum
    const HI = { m: 1.37, t: st + 5 * 3600 };
    Wr.set({ st, dur: 2, series: { ok: true, high: HI, low: { m: -0.41, t: st } } });
    const lowNeg = await Wr.readPunchLevel(lines);
    Wr.set({ st, dur: 2, series: { ok: true, high: HI, low: { m: null, t: st } } });
    const lowNull = await Wr.readPunchLevel(lines);
    Wr.set({ st, dur: 2, series: { ok: true, high: HI } });
    const lowNone = await Wr.readPunchLevel(lines);
    asks.splice(0);
    check("8c. the read carries the horizon's LOW beside its high - the series' own - and none when the series gave "
          + "none, a null one or no window (never chart datum in its place)",
          () => win.horizonLow === 0.2 && lowNeg.horizonLow === -0.41 && lowNull.horizonLow === null && lowNull.high.m === 1.37
                && lowNone.horizonLow === null && bad.horizonLow === null && none.horizonLow === null,
          () => JSON.stringify([win.horizonLow, lowNeg.horizonLow, lowNull.horizonLow, lowNone.horizonLow, bad.horizonLow, none.horizonLow]));
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
    // (phase 3) ... and the read's low with it - the floor - so a clearing's every punch asks its time lines the same
    const wf = makeWorld();
    wf.setWin(null, 10); wf.setLevel({ ...READ, horizonLow: -0.3 });
    const withLow = wf.liveCut();
    const F = new Function("\"use strict\";\n" + grab("needFloorM") + "\nreturn needFloorM;")();
    check("9b. the cut's high carries the read's low (none when the read had none), and the floor a time line's need is "
          + "asked down to is the lower of chart datum and that low, never above the cut - chart datum with no low read",
          () => withLow.high.horizonLowM === -0.3 && own.high.horizonLowM === null
                && F(-0.3, 1) === -0.3 && F(0.4, 1) === 0 && F(null, 1) === 0 && F(undefined, 1) === 0 && F(NaN, 1) === 0
                && F(null, -0.2) === -0.2 && F(-0.5, -0.2) === -0.5 && F(-0.1, -0.2) === -0.2 && F(0.4, 0.3) === 0,
          () => JSON.stringify({ withLow: withLow.high, own: own.high,
                                 f: [F(-0.3, 1), F(0.4, 1), F(null, 1), F(NaN, 1), F(null, -0.2), F(-0.5, -0.2), F(-0.1, -0.2), F(0.4, 0.3)] }));
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
        // (phase 3: and the water it needs - the 0.5 m shoal under the 1.0 m floor: +0.50 m, the rung it first clears at)
        () => /· 1 line DEFERRED - dashed on the chart, never flown: 1 not clear end to end at the window's low, \+0\.00 m - it needs \+0\.50 m \(outlined at the high water ahead, \+1\.00 m /.test(hint10)
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
    // (phase 3: and PLAN B, which plans them again as a NEW survey - its drawing, a start - that Punch Out judges afresh)
    const ALLOWED = new Set(["punchOut", "drawPattern", "commitPattern", "resetPattern", "emptyPunchRefusal",
                             "drawDeferredSurveys", "surveyDeferredN", "deferredWhy", "planBLines", "planBNeeds", "planBFrom"]);
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
    // (phase 3) a line deferred for time, cut at chart datum with no lower water read, needs the cut: the floor its need
    // is asked down to IS the cut - and the survey records the outline's high even with no line deferred for the tide,
    // so a Plan B of its time lines is judged against the same outline
    const pc = await safely(() => wt.commitPattern());
    const rec = (wt.mission.surveys || [])[0] || {};
    check("15b. a line deferred past the duration, cut at chart datum with no lower water ahead, was asked no lower than "
          + "the level it was cut at: that level is recorded as the floor it is clear at, never as a need - and the "
          + "summary says so - and Add to plan records the outline's high water though no line was deferred for the tide",
          () => !pc.err && gt.patDefer.lines.every((x) => x.needM === 0 && x.needFloor === true) && rec.deferred && rec.deferred.length === 3
                && rec.deferred.every((r) => r.why === "time" && r.need_m === 0 && r.need_floor === true) && rec.deferred_high_m === 1.0
                && / h duration - they are clear down to \+0\.00 m, the lowest water asked \(outlined at the high water ahead/.test(hint),
          () => (pc.err ? "threw " + pc.err.message + "; " : "") + JSON.stringify(gt.patDefer.lines.map((x) => x.needM))
                + " | record high " + rec.deferred_high_m + " | " + hint.slice(0, 260));
  }

  // ── 15c. THE WATER A TIME LINE NEEDS: asked DOWN from the cut (the lab, 2026-11-19) ──────────────────────────────
  {
    // the cut at +1.00 m (the 0.5 m shoal under line x = 20 is open there: 1.5 m over a 1.0 m floor), the high +1.50 m,
    // the horizon's low -0.30 m; lines x = 20, 30, 40 past the duration. Line 20 is shut under +0.50 m; the others
    // stand clear of the shoal at any water, so they need the floor.
    // (cut for a start she waits for: without one a punch is never cut above the water now - punchWaterM)
    const st = Math.floor(Date.now() / 1000) + 3600;
    const FAR = () => area(900, 910, 900, 910, 0.5, 0.5);
    const RD = { ...READ, m: 1.0, say: "+1.00 m, the lowest predicted over its window", start: true, startT: st,
                 high: { m: 1.5, t: HIGH_T }, horizonLow: -0.3 };
    const punch = async (read, mk, time) => {
      const wx = makeWorld(mk);
      wx.setWin(st, 10); wx.setLevel(read); wx.setTime(time || [2, 3, 4]);
      wx.log.builds = 0;
      const p = await safely(() => wx.punchOut());
      const d = wx.get().patDefer;
      return { wx, p, d, needs: d ? d.lines.map((x) => [x.i, x.why, x.needM]) : null, builds: wx.log.builds,
               floors: d ? d.lines.map((x) => !!x.needFloor).join(",") : null, hint: wx.$("#sp_hint").textContent };
    };
    const lo = await punch(RD), none = await punch({ ...RD, horizonLow: null });
    const at0 = await punch({ ...RD, horizonLow: 0.4 });           // a low over chart datum: asked down to datum all the same
    check("15c. a line deferred past the duration is asked DOWN from the level it was cut at: the one over a 0.5 m shoal "
          + "needs +0.50 m - not the +1.00 m cut - and the ones clear of it need the floor: the horizon's low under chart "
          + "datum (-0.30 m), or chart datum with no low read or one above it; none is deferred for the tide, and the "
          + "summary says the need apart from the floor (a level a line was only asked AT is no need: marked so)",
          () => !lo.p.err && JSON.stringify(lo.needs) === JSON.stringify([[2, "time", 0.5], [3, "time", -0.3], [4, "time", -0.3]])
                && JSON.stringify(none.needs) === JSON.stringify([[2, "time", 0.5], [3, "time", 0], [4, "time", 0]])
                && JSON.stringify(at0.needs) === JSON.stringify(none.needs)
                && lo.floors === "false,true,true" && none.floors === "false,true,true"
                && /3 past its 10 h duration - 1 needs \+0\.50 m, 2 clear down to -0\.30 m, the lowest water asked/.test(lo.hint),
          () => (lo.p.err ? "threw " + lo.p.err.message + "; " : "") + JSON.stringify({ lo: lo.needs, none: none.needs, at0: at0.needs })
                + " | " + lo.hint.slice(0, 240));
    // the same punch again asks nothing over (the needs are kept with the outline's clips), a new floor asks again.
    // (`base`: the same punch with no line past the duration - the models the punch builds for itself)
    const base = await punch(RD, undefined, []);
    lo.wx.log.builds = 0;
    await safely(() => lo.wx.punchOut());
    const again = lo.wx.log.builds, same = lo.wx.get().patDefer.lines.map((x) => x.needM).join(",");
    lo.wx.setLevel({ ...RD, horizonLow: -0.6 });
    await safely(() => lo.wx.punchOut());
    const moved = lo.wx.get().patDefer.lines.map((x) => x.needM).join(",");
    check("15d. the time lines' needs are kept through a re-punch - no rung's model is built again - and a read with "
          + "another floor asks them again (the floor is in the key they are kept under)",
          () => base.d && base.d.lines.length === 0 && lo.builds > base.builds && same === "0.5,-0.3,-0.3"
                && again === base.builds && moved === "0.5,-0.6,-0.6",
          () => "no time lines " + base.builds + " builds, first punch " + lo.builds + ", again " + again + " (" + same
                + "); floor -0.60: " + moved);
    // a deeper shoal under the same cut: 0.2 m charted needs +0.80 m; one shut AT the cut's own level cannot be a time
    // line (it is not clear there) - so the top rung is never guessed
    const deep = await punch(RD, { features: [area(15, 25, 80, 120, 0.2, 0.2)] });
    // a cut under chart datum with no lower water read: the floor is the cut, and nothing is asked
    const NEG = { ...RD, m: -0.2, say: "-0.20 m", horizonLow: null };
    const neg = await punch(NEG, { features: [FAR()] }), neg0 = await punch(NEG, { features: [FAR()] }, []);
    check("15e. the need follows the chart - a 0.2 m shoal needs +0.80 m - and a cut under chart datum with no lower "
          + "water read needs the cut, with no model built to ask",
          () => deep.needs && deep.needs[0][2] === 0.8 && neg.needs && neg.needs.every((x) => x[2] === -0.2)
                && neg.needs.length === 3 && neg.builds === neg0.builds,
          () => JSON.stringify({ deep: deep.needs, neg: neg.needs, negBuilds: neg.builds, noTime: neg0.builds }));
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
    // (a punch builds two models of its own; a window's adds the outline's, and phase 3's need its rungs' - halved, so
    // a handful: 20 rungs from +0.05 to +1.00 m, 24 to +1.20 m)
    const needB = (b) => b >= 1 && b <= Math.ceil(Math.log2(24)) + 1;
    check("16. the outline's clips and the lines' needs are kept for the same inputs - a re-punch asks no outline, no need "
          + "and builds no model for either - and a new high is clipped and its needs found afresh, the rungs halved",
          () => memo1 && memo1 === memo2 && memo1.runs.size === 1 && memo1.needs && memo1.needs.size === 1
                && needB(b1 - 3) && b2 - b1 === 2 && memo3 !== memo2 && needB(b3 - b2 - 3) && wk.get().patDefer.out.size === 1,
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

  // ══ PLAN B (the survey window phase 3) ══════════════════════════════════════════════════════════════════════════
  const PB = new Function("G", "\"use strict\";\nconst {llEN, distTo} = G;\n"
    + decl(/^const NEED_STEP_M = [^;]*;/m) + "\n" + decl(/^const PLANB_SLOT_S = [^;]*;/m) + "\n"
    + ["needRungs", "clipGridN", "uncoveredSamples", "deferNeedM", "planBStart", "planBLines", "planBNeeds"].map(grab).join("\n")
    + "\nreturn {needRungs, clipGridN, uncoveredSamples, deferNeedM, planBStart, planBLines, planBNeeds};")(G);

  // ── 18. the ladder ───────────────────────────────────────────────────────────────────────────────────────────────
  {
    const r1 = PB.needRungs(0, 1.0), r2 = PB.needRungs(-0.12, 0.3), r3 = PB.needRungs(0.1, 0.3), r4 = PB.needRungs(0.5, 0.52);
    const step = (r) => r.slice(1, -1).every((v, k) => Math.abs(v - r[k] - 0.05) < 1e-9);
    check("18. the ladder a deferred line's need is found on: every 0.05 m strictly above the window's low and under the "
          + "outline's level, then the outline's level itself - a low on a rung starts at the next one, an outline under "
          + "a step above the low is the one rung",
          () => r1.length === 20 && r1[0] === 0.05 && r1[18] === 0.95 && r1[19] === 1.0 && step(r1) && step(r2)
                && r2.join(",") === "-0.1,-0.05,0,0.05,0.1,0.15,0.2,0.25,0.3"
                && r3[0] === 0.15 && r3[r3.length - 1] === 0.3 && r4.join(",") === "0.52",
          () => [r1.length, r2.join(","), r3.join(","), r4.join(",")].join(" | "));
  }

  // ── 19. the samples asked ────────────────────────────────────────────────────────────────────────────────────────
  {
    // 99 m, so a 6 m standoff's 2 m step is 50 samples whatever the plane rounds (clipLine's own arithmetic)
    const line = [at(0, 0), at(0, 99)], n = PB.clipGridN(line, O, 6), full = [[at(0, 0), at(0, 99)]];
    const u1 = PB.uncoveredSamples(line, n, [[at(0, 0), at(0, 40)]], full);
    const u2 = PB.uncoveredSamples(line, n, [[at(0, 0), at(0, 40)], [at(0, 60), at(0, 99)]], full);
    const u3 = PB.uncoveredSamples(line, n, full, full);
    const ew = [at(0, 0), at(99, 0)];
    const u4 = PB.uncoveredSamples(ew, PB.clipGridN(ew, O, 6), [[at(99, 0), at(50, 0)]], [[at(0, 0), at(99, 0)]]);
    const u5 = PB.uncoveredSamples(line, n, [[at(0, 0), at(0, 30)]], [[at(0, 0), at(0, 30)], [at(0, 70), at(0, 99)]]);
    check("19. a line's need is asked only of its outline's samples the low runs do not hold, on clipLine's own grid (2 m "
          + "at a 6 m standoff: 50 steps on 99 m) - a gap between two low runs, a run either way round, a line east-west, "
          + "an outline in two pieces - and a line the low holds whole asks none",
          () => n === 50 && PB.clipGridN([at(0, 0), at(0, 0.5)], O, 6) === 0 && PB.clipGridN([at(0, 0), at(0, 3)], O, 6) === 2
                && u1.length === 30 && u1[0] === 21 && u1[29] === 50
                && u2.join(",") === "21,22,23,24,25,26,27,28,29" && u3.length === 0
                && u4.length === 25 && u4[0] === 0 && u4[24] === 24 && u5.length === 16 && u5[0] === 35 && u5[15] === 50
                && /const n=Math\.max\(2, Math\.ceil\(L\/Math\.max\(2, buf\/3\)\)\);/.test(grab("clipLine")),
          () => [n, u1.length, u2.join(","), u4.length, u5.length + "@" + u5[0]].join(" | "));
  }

  // ── 20. the least rung ───────────────────────────────────────────────────────────────────────────────────────────
  {
    const R = PB.needRungs(0, 1.0), thr = { 1: 0.3, 2: 0.52, 3: 0.1 };
    const asked = new Set();
    const need = PB.deferNeedM([1, 2, 3], R, (L, k) => { asked.add(L); return L >= thr[k] - 1e-9; });
    const top = PB.deferNeedM([1], R, (L) => L >= 1.0 - 1e-9), first = PB.deferNeedM([1], R, () => true);
    // a verdict that is not monotone (clear at +0.25 and from +0.80): what it answers is a rung it found clear
    const odd = PB.deferNeedM([1], R, (L) => Math.abs(L - 0.25) < 1e-9 || L >= 0.8 - 1e-9);
    check("20. a line's need is the least rung at which EVERY one of its asked samples is clear - +0.55 m for samples "
          + "clear from +0.30, +0.52 and +0.10 - found by halving (a handful of rungs asked, not twenty); the outline's "
          + "own level when nothing under it is; and a rung it asked and found clear, never one it guessed",
          () => need === 0.55 && asked.size <= 6 && top === 1.0 && first === 0.05 && odd === 0.8,
          () => "need " + need + " (" + asked.size + " rungs asked); top " + top + "; odd " + odd);
  }

  // ── 21. the start ────────────────────────────────────────────────────────────────────────────────────────────────
  {
    // a tide rising 0.2 m a slot to +1.60 m at slot 8 and falling again; a flight of 700 s
    const T = 1795000000, LV = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.4, 1.2, 1.0, 0.8, 0.6, 0.4, 0.2, 0.0];
    const S6 = LV.map((m, k) => [T + k * 360, m]), LEN = 700;
    // THE SERVER'S OWN RULE, written here apart from the page (asv_console.py _water_slots): the low a punch reads for
    // a window [t, t + len] is the least slot from WATER_PRED_SLOT_S before it to WATER_PRED_SLOT_S after it
    const SLOT = +(/^WATER_PRED_SLOT_S = (\d+)/m.exec(PY) || [])[1];
    const serverLow = (t, len) => Math.min(...S6.filter((x) => x[0] >= t - SLOT && x[0] <= Math.ceil(t + len) + SLOT).map((x) => x[1]));
    const s04 = PB.planBStart(S6, [0.4], LEN, T), s06 = PB.planBStart(S6, [0.6], LEN, T);
    const s15 = PB.planBStart(S6, [1.5], LEN, T), part = PB.planBStart(S6, [0.3, 0.6, 1.5], LEN, T);
    // a start between slots takes the slot before it too
    const mid = PB.planBStart(S6, [0.25], LEN, T + 500);
    const short = PB.planBStart(S6, [0.4], 7000, T), none = PB.planBStart([[T, 1]], [0.4], 10, T);
    const inf = PB.planBStart(S6, [Infinity, Infinity], LEN, T);
    // a need that was only the floor a line was asked down to (-Infinity: planBNeeds') fits any water
    const fl = PB.planBStart(S6, [-Infinity, 0.4], LEN, T), flOnly = PB.planBStart(S6, [-Infinity], LEN, T);
    check("21. Plan B's start: the EARLIEST start whose flight's lowest water covers every line's need - by the "
          + "SERVER's rule, the slot before the start read too (+0.40 m: 1080 s, where a start at the 720 s slot would "
          + "be read from the +0.20 m slot before it and deferred again; +0.60 m: 1440 s); with no such start, the "
          + "earliest that covers the most of them (two of three, 1440 s) or, covering none, the most water (+1.20 m at "
          + "2520 s); a start between slots; none when no flight fits inside the series; a line that needs no water "
          + "found fits any start",
          () => SLOT === 360 && +decl(/^const PLANB_SLOT_S = [^;]*;/m).match(/= (\d+)/)[1] === SLOT
                && s04.t === T + 1080 && s04.all && s04.low === 0.4 && serverLow(s04.t, LEN) >= 0.4 && serverLow(T + 720, LEN) < 0.4
                && s06.t === T + 1440 && s06.all && serverLow(s06.t, LEN) >= 0.6 && serverLow(T + 1080, LEN) < 0.6
                && s15.t === T + 2520 && !s15.all && s15.fit === 0 && s15.low === 1.2 && serverLow(s15.t, LEN) === 1.2
                && part.t === T + 1440 && part.fit === 2 && part.of === 3 && !part.all
                && mid.t === T + 1080 && short === null && none === null && inf.t === T + 2520 && inf.fit === 0
                && fl.t === T + 1080 && fl.all && flOnly.t === T && flOnly.all,
          () => JSON.stringify([s04, s06, s15, part, mid, fl, flOnly].map((x) => x && [x.t - T, x.low, x.fit, x.all])) + " short " + short
                + " | server lows " + [serverLow(T + 720, LEN), serverLow(T + 1080, LEN), serverLow(T + 1440, LEN)].join("/"));
  }

  // ── 22. the lines and their needs from a survey's record ─────────────────────────────────────────────────────────
  {
    const r = (i, why, need) => ({ i, a: { lat: 1, lon: 1 }, b: { lat: 2, lon: 1 }, why, ...(need === undefined ? {} : { need_m: need }) });
    const s = { water_m: -0.1, deferred_high_m: 1.2,
                deferred: [r(5, "tide"), r(2, "tide", 0.4), r(2, "tide", 0.6), r(7, "time"), r(9, "time", 0.05), { i: "3" }, null, r(-1, "tide")] };
    const lines = PB.planBLines(s), needs = PB.planBNeeds(s, lines);
    const bare = PB.planBNeeds({ deferred: [r(4, "tide")] }, [4]);
    // (the phase 3 review) a need that is only the FLOOR a line was asked down to is no water it must have: any start
    // has it - unless another run of the same line has a real need
    const fl = PB.planBNeeds({ water_m: 1, deferred: [{ ...r(6, "time", -0.3), need_floor: true },
                                                      { ...r(8, "time", 0), need_floor: true }, r(8, "time", 0.5),
                                                      { ...r(9, "time", 0.2), need_floor: false }] }, [6, 8, 9]);
    check("22. a survey's deferred lines as the drawing's own numbers, once each and in order (a run's line that is not a "
          + "number is none); each line's need the most its runs record - and for a record from before phase 3, the "
          + "outline's level for a tide line and the level it was cut at for a time line; neither recorded, a need no "
          + "water meets",
          () => lines.join(",") === "2,5,7,9" && needs.join(",") === "0.6,1.2,-0.1,0.05" && bare[0] === Infinity
                && PB.planBLines({}).length === 0 && PB.planBLines(null).length === 0
                && fl[0] === -Infinity && fl[1] === 0.5 && fl[2] === 0.2,
          () => lines.join(",") + " -> " + needs.join(",") + "; bare " + bare + "; floor-marked " + fl.join(","));
  }

  // ── 23. A REAL PUNCH OF A PLAN B ─────────────────────────────────────────────────────────────────────────────────
  {
    // the drawing's lines 1-3 (x = 10, 20, 30), judged against a first plan's outline at +0.80 m - under the card's
    // read's own high (+1.00 m), so the outline used is the one given
    const wb = makeWorld();
    wb.setPlanB([1, 2, 3], 0.8, "Plan B of S1 North");
    wb.setLevel(READ);
    const pb = await safely(() => wb.punchOut());
    const g = wb.get(), d = g.patDefer, hint = wb.$("#sp_hint").textContent;
    check("23. a real punch of a Plan B flies only its own lines - three of the drawing's five - with no start or duration "
          + "on the card: its shoal line is deferred whole against the outline it was GIVEN (+0.80 m, not the +1.00 m "
          + "high ahead), needing +0.50 m, and said so",
          () => !pb.err && wb.lines().length === 3 && wb.all().length === 5 && g.patClip.length === 2
                && !g.patClip.some((s) => onX(s, 0) || onX(s, 40) || onX(s, 20))
                && d && d.pinned === true && d.highM === 0.8 && d.lines.length === 1 && d.lines[0].i === 1
                && d.lines[0].needM === 0.5
                && /1 not clear end to end at the window's low, \+0\.00 m - it needs \+0\.50 m \(outlined at its first plan's high water, \+0\.80 m\)/.test(hint),
          () => (pb.err ? "threw " + pb.err.message + "; " : "") + (g.patClip || []).length + " runs; "
                + JSON.stringify(d && { pinned: d.pinned, highM: d.highM, lines: d.lines.map((x) => [x.i, x.why, x.needM]) })
                + " | " + hint.slice(0, 300));
    const pc = await safely(() => wb.commitPattern());
    const rec = (wb.mission.surveys || [])[0] || {};
    check("23b. ... and Add to plan records it as the new survey's: named for its first plan, its deferred line by the "
          + "DRAWING's number (2, not Plan B's 1) with the water it needs, and the outline it was judged against",
          () => !pc.err && rec.name === "Plan B of S1 North" && wb.mission.lines.length === 2
                && rec.deferred && rec.deferred.length === 1 && rec.deferred[0].i === 2 && rec.deferred[0].need_m === 0.5
                && rec.deferred_high_m === 0.8,
          () => (pc.err ? "threw " + pc.err.message + "; " : "") + JSON.stringify({ name: rec.name, deferred: rec.deferred, hi: rec.deferred_high_m }));
    // a low at or over the outline: every line is clear end to end, none deferred, and it says why
    const st = Math.floor(Date.now() / 1000) + 3600;
    const wl = makeWorld();
    wl.setPlanB([1, 2, 3], 0.55);
    wl.setWin(st, null);
    wl.setLevel({ ...READ, m: 0.6, start: true, startT: st });
    const pl = await safely(() => wl.punchOut());
    const gl = wl.get(), hl = wl.$("#sp_hint").textContent;
    check("23c. a Plan B whose low stands at or over its outline flies every one of its lines whole and defers none - "
          + "and says the low is at or over the outline",
          () => !pl.err && gl.patClip.length === 3 && gl.patClip.filter((s) => onX(s, 20)).length === 1 && gl.patDefer
                && gl.patDefer.out.size === 0
                && /every line fits its window \(its low stands at or above the high water its first plan outlined these lines at\)/.test(hl),
          () => (pl.err ? "threw " + pl.err.message + "; " : "") + (gl.patClip || []).length + " runs | " + hl.slice(0, 260));
    // a deeper shoal needs more water: 0.2 m charted under the 1.0 m floor is +0.80 m
    const wd = makeWorld({ features: [area(15, 25, 80, 120, 0.2, 0.2)] });
    wd.setWin(null, 10); wd.setLevel(READ);
    await safely(() => wd.punchOut());
    const dd = wd.get().patDefer;
    check("23d. the need follows the chart: a 0.2 m shoal under the 1.0 m floor needs +0.80 m",
          () => dd && dd.lines.length === 1 && dd.lines[0].needM === 0.8,
          () => JSON.stringify(dd && dd.lines.map((x) => [x.i, x.needM])));
    // a Plan B naming a line the drawing no longer has (it was redrawn smaller) flies the ones it has
    const wn = makeWorld();
    wn.setPlanB([1, 3, 9]);
    check("23e. a Plan B naming a line its drawing does not have flies the ones it has",
          () => wn.lines().length === 2 && wn.all().length === 5 && onX(wn.lines()[0], 10) && onX(wn.lines()[1], 30),
          () => wn.lines().length + " of " + wn.all().length);
  }

  // ── 24. the read of a Plan B ─────────────────────────────────────────────────────────────────────────────────────
  {
    const asks = [];
    const Wr = new Function("asks", "G", "\"use strict\";\nconst {distTo} = G;\n"
      + "const surgeWhen = (t) => 'Thu';\n"
      + decl(/^const WATER_ETA_SLACK = [^;]*;/m) + "\n" + decl(/^const WATER_WINDOW_PAD_S = [^;]*;/m) + "\n"
      + decl(/^const WATER_WINDOW_MAX_H = [^;]*;/m) + "\n"
      + "let patStartT = null, patDurH = null, punchFlown = null, water = null, patOnly = null, patOutlineM = null;\n"
      + "const roleSpeedMS = (r) => (r === 'transit' ? 3.0 : 1.5); const punchPreM = () => 0;\n"
      + "const waterAlongRead = async (path, t0, t1) => { asks.push('along'); return {points: [{low_m: 0.2}]}; };\n"
      + "const waterSeriesRead = async () => { asks.push('series'); return {ok: true, high: {m: 1.3, t: 1}}; };\n"
      + "const sectionLevel = () => ({m: 0.2, say: 'the low', read: true});\n"
      + ["turnTimeFactor", "punchLevelKey", "punchFlightM", "punchDrawnM", "windowSelects", "punchOwnM", "flightWindow",
         "readPunchLevel", "horizonHigh"].map(grab).join("\n")
      + "\nreturn { readPunchLevel, windowSelects, set: (o) => { patOnly = o.only ?? null; patOutlineM = o.outline ?? null; } };")(asks, G);
    const lines = [[at(0, 0), at(0, 300)], [at(20, 300), at(20, 0)]];
    Wr.set({ only: [1, 3], outline: 0.8 });
    const pinned = await Wr.readPunchLevel(lines), aPinned = asks.splice(0).join(",");
    Wr.set({ only: [1, 3] });
    const own = await Wr.readPunchLevel(lines), aOwn = asks.splice(0).join(",");
    check("24. a Plan B always selects - its lines are whole or not flown, start or none - and its outline is the one it "
          + "was given, so its own high is not read; a Plan B given none reads its own",
          () => Wr.windowSelects() && aPinned === "along" && pinned.high == null && aOwn === "along,series" && own.high.m === 1.3,
          () => "given: " + aPinned + "; none given: " + aOwn);
  }

  // ── 25. the earliest start ───────────────────────────────────────────────────────────────────────────────────────
  {
    const Ws = new Function("G", "\"use strict\";\nconst {distTo} = G;\n"
      + decl(/^const PLANB_MARGIN_S = [^;]*;/m) + "\n"
      + "const mission = {waypoints: [], surveys: []}; let asv = null;\n"
      // survey 1.0 m/s, transit 2.0, turn 0.5: a leg inside a survey counts 2 s a meter (turnTimeFactor 2), a transit 0.5
      + "const roleSpeedMS = (r) => (r === 'transit' ? 2.0 : r === 'turn' ? 0.5 : 1.0);\n"
      + ["surveyStartT", "turnTimeFactor", "planFlownS", "planBEarliest"].map(grab).join("\n")
      + "\nreturn { planBEarliest, planFlownS, mission, setAsv: (p) => { asv = p; } };")(G);
    const B = [[at(0, 1000), at(0, 1200)]];
    const now = Date.now() / 1000, eNone = Ws.planBEarliest(B);        // no fix yet: from the plan alone
    Ws.setAsv(at(0, -2600));
    const e0 = Ws.planBEarliest(B);                                    // an empty plan: 3600 m of transit
    // THE PLAN AHEAD IS SURVEY LINES (the review's case): S1's leg is hers at the survey speed, turn-weighted - not at
    // the transit speed, which put the start before she could be through it
    Ws.setAsv(at(0, 0));
    Ws.mission.waypoints.push({ ...at(0, 0), sv: "S1" }, { ...at(0, 400), sv: "S1" }, { ...at(0, 600) });
    const flown = 400 * 2 / 1.0 + (200 + 400) / 2.0;                   // S1's own 400 m, then 200 m and 400 m of transit
    const eS = Ws.planBEarliest(B);
    // a survey in the plan that waits for a start 5 h on: Plan B begins after it, and the plan from it on
    const st = now + 5 * 3600;
    Ws.mission.surveys.push({ id: "S1", settings: { start_t: st } }, { id: "S2", settings: { start_t: now - 60 } });
    const e1 = Ws.planBEarliest(B);
    check("25. Plan B's earliest start is one she can be AT: the plan ahead as she flies it - a leg inside a survey at "
          + "the survey speed, weighted as a turn; any other at the transit speed (a plan of survey lines was timed at "
          + "the transit speed, and the start came before she could be through it) - and after any survey that waits "
          + "for a later start, that start and the plan from it on; plus PLANB_MARGIN_S; a start already passed waits "
          + "for nothing",
          () => Math.abs(eNone - (now + 600)) < 2 && Math.abs(e0 - (now + 3600 / 2.0 + 600)) < 3
                && Math.abs(eS - (now + flown + 600)) < 3 && flown === 1100 && Math.abs(e1 - (st + flown + 600)) < 3,
          () => "no fix " + (eNone - now).toFixed(0) + " s; empty plan " + (e0 - now).toFixed(0) + " s; survey lines ahead "
                + (eS - now).toFixed(0) + " s (the transit speed alone: 1100 s with the margin); after S1 " + (e1 - st).toFixed(0) + " s past its start");
  }

  // ── 26. planBFrom ────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const T0 = 1795000000;
    const mkB = () => new Function("G", "\"use strict\";\nconst {distTo} = G;\n"
      + decl(/^const WATER_WINDOW_MAX_H = [^;]*;/m) + "\n" + decl(/^const WATER_ETA_SLACK = [^;]*;/m) + "\n"
      + decl(/^const WATER_WINDOW_PAD_S = [^;]*;/m) + "\n" + decl(/^const PLANB_SLOT_S = [^;]*;/m) + "\n"
      + "const log = {notes: [], banners: [], reads: [], punched: 0, asked: 0, modes: [], strips: 0};\n"
      + "let pat = {A: null, B: null, C: null, align: 0}, mode = 'pan', editingSv = 'S9';\n"
      + "let patOnly = null, patOutlineM = null, patPlanBName = '', patStartT = 99, patDurH = 3;\n"
      + "let patOutlineLowM = null, patOnlySig = null, patPlanBSay = '', water = null, early = " + T0 + ";\n"
      + "let series = null, onRead = null, answer = true;\n"
      + "const els = {}; const $ = (q) => els[q] || (els[q] = {value: '', textContent: ''});\n"
      + "const drawn = [0, 1, 2, 3, 4].map((k) => [{lat: 43 + k * 1e-4, lon: -70.7}, {lat: 43 + k * 1e-4, lon: -70.69}]);\n"
      + "const P = {A: {lat: 43, lon: -70.7}, B: {lat: 43.0004, lon: -70.69}, C: null, align: 2};\n"
      + "const surveys = {S1: {id: 'S1', no: 1, name: 'North', pattern: P, settings: {start_t: 5, duration_h: 2, outline_m: null},"
      + "  water_m: 0, deferred_high_m: 1.1, deferred: [{i: 1, why: 'tide', need_m: 0.4}, {i: 3, why: 'tide', need_m: 0.6}]},"
      + "  S2: {id: 'S2', no: 2, name: '', pattern: P, settings: {}, deferred: null},"
      // (a survey that is ITSELF a Plan B: its outline and the level its Max depth is anchored at are its first plan's)
      + "  S3: {id: 'S3', no: 3, name: 'Plan B of S1', pattern: P, settings: {only: [1, 3], outline_m: 0.9, outline_low_m: -0.2},"
      + "  water_m: 0.5, deferred_high_m: 0.9, deferred: [{i: 3, why: 'tide', need_m: 0.7}]}};\n"
      + "const surveyById = (id) => surveys[id] || null; const surveyLabel = (s) => 'S' + s.no + (s.name ? ' ' + s.name : '');\n"
      + "const guiConfirm = async () => { log.asked++; return answer; };\n"
      + "const resetPattern = () => { pat = {A: null, B: null, C: null, align: pat.align}; editingSv = null; patOnly = null;"
      + "  patOutlineM = null; patPlanBName = ''; patStartT = null; patDurH = null; patOutlineLowM = null; patOnlySig = null;"
      + "  patPlanBSay = ''; };\n"
      + "const applySurveySettings = (st) => { patStartT = st.start_t ?? null; patDurH = st.duration_h ?? null; patOutlineM = st.outline_m ?? null;"
      + "  patOutlineLowM = st.outline_low_m ?? null; };\n"
      // (the card's Plan B line, which stands until Reset: what it shows of the search is kept)
      + "const showPlanBNote = () => { log.line = patPlanBSay; };\n"
      + "const showSurveyWindow = () => {}, saveMission = () => {}, updatePatReadout = () => {}, render = () => {};\n"
      + "const setMode = (m) => { log.modes.push(m); mode = m; };\n"
      + "const patSourceLines = () => pat.A ? (patOnly ? patOnly.map((i) => drawn[i]) : drawn) : [];\n"
      + "const patSourceIdx = () => patOnly;\n"
      + "const roleSpeedMS = () => 1.0; const punchOwnM = (lines) => lines.length * 600; const planBEarliest = () => early;\n"
      + "const waterSeriesRead = async (path, t0, t1) => { log.reads.push([path.length, t0, t1]); if(onRead) onRead(); return series; };\n"
      + "const surgeWhen = (t) => 'at ' + (t - " + T0 + ");\n"
      + "const flashNote = (t) => log.notes.push(t), showBanner = (t) => log.banners.push(t);\n"
      // (every finished punch ends in a banner of its own - what took the search's word away when it was a banner)
      + "const tideStripRefresh = () => { log.strips++; };\n"
      + "const punchOutPressed = async () => { log.punched++; showBanner('Chart-feature planning aid'); };\n"
      + ["fmtLevel", "planBLines", "planBNeeds", "planBStart", "planBFrom"].map(grab).join("\n")
      + "\nreturn { planBFrom, log, get st(){ return {pat, mode, editingSv, patOnly, patOutlineM, patPlanBName, patStartT, patDurH,"
      + "   patOutlineLowM, patPlanBSay}; }, setWater: (w) => { water = w; }, setEarly: (t) => { early = t; },"
      + " setSeries: (s) => { series = s; }, onRead: (f) => { onRead = f; }, answer: (a) => { answer = a; },"
      + " setStart: (t) => { patStartT = t; },"
      + " reset: () => resetPattern(), draw: () => { pat = {A: P.A, B: P.B, C: null, align: 0}; } };")(G);
    const KN = new Function("\"use strict\";\n" + decl(/^const WATER_ETA_SLACK = [^;]*;/m) + "\n"
      + decl(/^const WATER_WINDOW_PAD_S = [^;]*;/m) + "\nreturn {slack: WATER_ETA_SLACK, pad: WATER_WINDOW_PAD_S};")();
    const lenS = 2 * 600 / 1.0 * KN.slack + KN.pad;     // the stub's flight: two lines of 600 m at 1 m/s
    const fmt = (v) => (v >= 0 ? "+" : "") + v.toFixed(2) + " m";
    // a curve from +0.00 m rising to +1.20 m over six hours: the earliest flight whose low covers +0.60 m is some hours on
    const ser = Array.from({ length: 241 }, (_, k) => [T0 + k * 360, Math.round((0.6 - 0.6 * Math.cos(k * 360 / 44712 * 2 * Math.PI)) * 1000) / 1000]);
    const b1 = mkB();
    b1.setSeries({ ok: true, series: ser });
    const r1 = await safely(() => b1.planBFrom("S1"));
    const s1 = b1.st;
    // the start the search itself gives for its two needs (21 proves the search): planBFrom must set exactly it
    const want = PB.planBStart(ser, [0.4, 0.6], lenS, T0);
    check("26. Plan B from S1: its two deferred lines (the drawing's 1 and 3) onto the card as a NEW survey - not the "
          + "survey being edited - its outline S1's, no duration, named for S1; the water read along them from the "
          + "earliest start to 24 h on; the start the search finds for their needs; then Punch Out",
          () => !r1.err && s1.patOnly.join(",") === "1,3" && s1.patOutlineM === 1.1 && s1.editingSv === null && s1.patDurH === null
                && s1.patPlanBName === "Plan B of S1 North" && s1.mode === "survey" && s1.pat.A && s1.pat.align === 2
                && b1.log.reads.length === 1 && b1.log.reads[0][0] === 4 && b1.log.reads[0][1] === T0
                && b1.log.reads[0][2] === T0 + 24 * 3600 && want && want.all && s1.patStartT === Math.round(want.t)
                && b1.log.punched === 1 && b1.log.strips === 1 && s1.patOutlineLowM === 0
                && want.t > T0 && b1.log.notes.join(" ").includes("Plan B from S1 North: Start at " + Math.round(want.t - T0)
                     + ": the earliest in the next 24 h whose flight has the water its 2 line(s) need (up to +0.60 m). Punch Out judges them again.")
                && b1.log.line === s1.patPlanBSay && s1.patPlanBSay.startsWith("Start at " + Math.round(want.t - T0) + ":"),
          () => (r1.err ? "threw " + r1.err.message + "; " : "") + JSON.stringify({ ...s1, pat: !!s1.pat.A }) + " want "
                + (want && want.t - T0) + " | " + b1.log.notes.join(" / ") + " | len " + lenS);
    // no start gives both: the most of them, said in a banner, and the punch defers the rest
    const capped = ser.map(([t, m]) => [t, Math.min(m, 0.5)]);
    const b2 = mkB();
    b2.setSeries({ ok: true, series: capped });
    await safely(() => b2.planBFrom("S1"));
    const want2 = PB.planBStart(capped, [0.4, 0.6], lenS, T0);
    check("26b. no start in the 24 h gives every line its water: the start that gives the most of them, said on the "
          + "card's Plan B line - how many, the low, that Punch Out defers the rest, Plan B on its row for those - where "
          + "it OUTLIVES the punch's own banner (it was a banner, and the punch it started replaced it); still punched",
          () => want2 && !want2.all && want2.fit === 1 && b2.st.patStartT === Math.round(want2.t) && b2.log.punched === 1
                && b2.log.banners.join("|") === "Chart-feature planning aid"
                && b2.log.line === "NO START in the next 24 h gives all 2 line(s) the water they need (up to +0.60 m). Start at "
                     + Math.round(want2.t - T0) + " is the earliest that gives the most of them theirs (1 of 2, low " + fmt(want2.low)
                     + "); Punch Out defers the rest whole. Add to plan, then Plan B on its row plans those."
                && b2.log.notes.join(" ").includes(b2.log.line),
          () => b2.log.line + " | banners " + b2.log.banners.join(" / "));
    // the read failed: no start, said, still punched (its lines judged from her arrival)
    const b3 = mkB();
    b3.setSeries({ ok: false, note: "no station within 10 km" });
    await safely(() => b3.planBFrom("S1"));
    check("26c. the water could not be read: no start, said with why, and Punch Out judges its lines from her arrival",
          () => b3.st.patStartT === null && b3.st.patOnly.join(",") === "1,3" && b3.log.punched === 1
                && b3.log.line === "NO START: the water over the next 24 h could not be read (no station within 10 km). Punch Out "
                     + "judges its lines at the water from her arrival. Set a Start to try another.",
          () => b3.log.notes.join(" / "));
    // the card reset while it read, or a Start typed: nothing set, nothing punched
    const b4 = mkB();
    b4.setSeries({ ok: true, series: ser }); b4.onRead(() => b4.reset());
    await safely(() => b4.planBFrom("S1"));
    const b5 = mkB();
    b5.setSeries({ ok: true, series: ser }); b5.onRead(() => b5.setStart(T0 + 7));
    await safely(() => b5.planBFrom("S1"));
    check("26d. the card reset while the water was read, or a Start typed meanwhile: no start set over it and no punch - "
          + "the card is the operator's",
          () => b4.st.patStartT === null && b4.st.patOnly === null && b4.log.punched === 0
                && b5.st.patStartT === T0 + 7 && b5.st.patOnly.join(",") === "1,3" && b5.log.punched === 0,
          () => JSON.stringify([b4.st.patStartT, b5.st.patStartT - T0]) + " punched " + b4.log.punched + "/" + b5.log.punched);
    // a survey with nothing deferred, and a drawing being made: said / asked first
    const b6 = mkB();
    await safely(() => b6.planBFrom("S2"));
    const b7 = mkB();
    b7.draw(); b7.answer(false);
    await safely(() => b7.planBFrom("S1"));
    check("26e. a survey with nothing deferred is said and nothing loaded; a drawing on the card is asked about first, "
          + "and a No leaves it as it was",
          () => /S2 has no deferred lines to plan\./.test(b6.log.notes.join(" ")) && b6.st.patOnly === null && b6.log.punched === 0
                && b7.log.asked === 1 && b7.st.patOnly === null && b7.st.editingSv === "S9" && b7.log.punched === 0,
          () => b6.log.notes.join(" / ") + " | asked " + b7.log.asked);
    // ── the phase 3 review's cases ──
    // a read that ANSWERED, and a flight longer than what it read: said as that, never as a read that failed
    const b8 = mkB();
    b8.setSeries({ ok: true, series: ser.slice(0, 10) });              // 54 minutes of curve against a 1.5 h flight
    await safely(() => b8.planBFrom("S1"));
    // no start gives ANY line its water: its own words - the start with the most water, nothing to add
    const none3 = ser.map(([t, m]) => [t, Math.min(m, 0.3)]);
    const b9 = mkB();
    b9.setSeries({ ok: true, series: none3 });
    await safely(() => b9.planBFrom("S1"));
    const want9 = PB.planBStart(none3, [0.4, 0.6], lenS, T0);
    check("26f. a read that answered with a flight too long for any start to fit inside it says THAT - no start searched, "
          + "its flight in hours, a Duration as the way on - not 'could not be read (no answer)'; and a tide that gives NO "
          + "line its water says so in its own words: the start with the most water, nothing to add, no 'Add to plan'",
          () => b8.st.patStartT === null && b8.log.punched === 1
                && b8.log.line === "NO START SEARCHED: its flight with its margin, " + (lenS / 3600).toFixed(1) + " h, is longer than the 24 h the "
                     + "predictions are read over. Punch Out judges its lines at the water from her arrival; a Duration on the card keeps "
                     + "the lines that fit it and defers the rest whole."
                && want9 && want9.fit === 0 && b9.st.patStartT === Math.round(want9.t)
                && b9.log.line === "NO START in the next 24 h gives ANY of its 2 line(s) the water they need (+0.40 m to +0.60 m): the most "
                     + "any flight has is " + fmt(want9.low) + ", from at " + Math.round(want9.t - T0) + " - its Start, and Punch Out defers "
                     + "every line. Nothing can be added for these lines on this water: press Plan B on their survey's row again on a later tide."
                && !/Add to plan/.test(b9.log.line),
          () => b8.log.line + " || " + b9.log.line);
    // the search's water is the punch's: a lower manual water level, and chart datum for a point with no station in reach
    const bm = mkB();
    bm.setSeries({ ok: true, series: ser }); bm.setWater({ source: "manual", offset_m: 0.45 });
    await safely(() => bm.planBFrom("S1"));
    const wantM = PB.planBStart(ser.map(([t, m]) => [t, Math.min(m, 0.45)]), [0.4, 0.6], lenS, T0);
    const bf = mkB();
    bf.setSeries({ ok: true, series: ser, far: 1 });
    await safely(() => bf.planBFrom("S1"));
    const hi = mkB();
    hi.setSeries({ ok: true, series: ser }); hi.setWater({ source: "manual", offset_m: 2.0 });   // a HIGHER manual level caps nothing
    await safely(() => hi.planBFrom("S1"));
    check("26g. the search's water is held to the punch's own rule: a LOWER manual water level caps the curve (one of "
          + "the two lines fits, said with the cap), a point with no station in reach counts as chart datum (none fits), "
          + "and a higher manual level changes nothing",
          () => wantM && wantM.fit === 1 && bm.st.patStartT === Math.round(wantM.t)
                && bm.log.line.includes("(the search's water is held to +0.45 m, the manual water level, as the punch's is)")
                && /^NO START in the next 24 h gives ANY/.test(bf.log.line)
                && bf.log.line.includes("held to +0.00 m, chart datum: a point of its lines has no station in reach, as the punch's is")
                && hi.st.patStartT === Math.round(want.t) && !/held to/.test(hi.log.line),
          () => bm.log.line + " || " + bf.log.line.slice(0, 200));
    // THE FLIGHT decides: from 8 h on the water is over +0.60 m now and under it before the 1.5 h flight ends - so the
    // start waits for the next rise; a search judging only the start's own instant would take 8 h
    const bl = mkB();
    bl.setSeries({ ok: true, series: ser }); bl.setEarly(T0 + 8 * 3600);
    await safely(() => bl.planBFrom("S1"));
    const wantL = PB.planBStart(ser, [0.4, 0.6], lenS, T0 + 8 * 3600);
    const at8 = ser.find((x) => x[0] >= T0 + 8 * 3600)[1];
    check("26h. the start is judged over Plan B's whole flight as the punch reads it - its lines at the survey speed, "
          + "stretched, with the window's pad: water over the need at the earliest start and under it before the "
          + "flight ends waits for the next rise",
          () => at8 >= 0.6 && wantL && wantL.all && wantL.t > T0 + 14 * 3600 && bl.st.patStartT === Math.round(wantL.t)
                && bl.log.reads[0][1] === T0 + 8 * 3600,
          () => "water at 8 h " + at8 + "; start " + ((bl.st.patStartT - T0) / 3600).toFixed(2) + " h; search " + (wantL && ((wantL.t - T0) / 3600).toFixed(2)));
    // a Plan B OF a Plan B (Plan C): the outline and the anchor stay the FIRST plan's
    const bc = mkB();
    bc.setSeries({ ok: true, series: ser });
    await safely(() => bc.planBFrom("S3"));
    check("26i. Plan B on a Plan B's own row (Plan C) keeps its first plan's outline and the level its Max depth is "
          + "anchored at - not the Plan B's own cut",
          () => bc.st.patOnly.join(",") === "3" && bc.st.patOutlineM === 0.9 && bc.st.patOutlineLowM === -0.2
                && bc.st.patPlanBName === "Plan B of S3 Plan B of S1",
          () => JSON.stringify({ only: bc.st.patOnly, outline: bc.st.patOutlineM, low: bc.st.patOutlineLowM, name: bc.st.patPlanBName }));
  }

  // ── 27. the wiring ───────────────────────────────────────────────────────────────────────────────────────────────
  {
    const rp = grab("resetPattern"), cm = grab("commitPattern"), ws = grab("windowSelects"), sn = grab("surveySettingsNow");
    const ap = grab("applySurveySettings"), ps = grab("patSourceLines"), po = grab("punchOut");
    check("27. the wiring: Reset forgets a Plan B (its lines, outline and name); Add to plan names a new Plan B for its "
          + "first plan and records its deferred lines by the drawing's numbers; a Plan B always selects; its lines and "
          + "outline ride the survey's settings and come back sorted, once each, never negative; the card's lines are "
          + "the Plan B's own; punchOut judges it against the outline it was given",
          () => /patOnly = null; patOutlineM = null; patPlanBName = ""; patOutlineLowM = null; patOnlySig = null; patPlanBSay = ""; showPlanBNote\(\);/.test(rp)
                && /name: editing \? \(editing\.name \|\| ""\) : patOnly \? patPlanBName : "",/.test(cm)
                && /deferredRecord\(patDefer, patSourceIdx\(\)\)/.test(cm)
                && /return patOnly != null \|\| patStartT != null/.test(ws)
                && /only: patOnly \? \[\.\.\.patOnly\] : null, outline_m: patOutlineM/.test(sn)
                && /new Set\(st\.only\.filter\(i => Number\.isInteger\(i\) && i >= 0\)\)\]\.sort\(\(a, b\) => a - b\)/.test(ap)
                && /idx \? idx\.map\(i => all\[i\]\) : all/.test(ps)
                && /const hi = patOutlineM != null \? \{m: patOutlineM, pinned: true\}/.test(po)
                // (the phase 3 review) the channel rule asked of the WHOLE drawing; the anchor rides the settings and
                // goes back; Punch all / Backwards put no Plan B back on the empty card; the drawing is checked where the
                // card is read, at a press of Punch Out and at Add to plan
                && /channelSpanKeepouts\(patSourceAll\(\), ref, nogo\.features, ko\.marks\)/.test(po)
                && !/channelSpanKeepouts\(src,/.test(po)
                && /outline_low_m: patOnly \? patOutlineLowM : null\}/.test(sn)
                && /patOutlineLowM = patOnly && st\.outline_low_m != null && Number\.isFinite\(\+st\.outline_low_m\) \? \+st\.outline_low_m : null;/.test(ap)
                && /applySurveySettings\(\{\.\.\.keep, only: null, outline_m: null, outline_low_m: null\}\)/.test(grab("withCardKept"))
                && /^function updatePatReadout\(\)\{\r?\n\s*planBDrawingCheck\(\);/.test(grab("updatePatReadout"))
                && /const o = opts \|\| \{\};\r?\n\s*planBDrawingCheck\(\);/.test(grab("punchOutPressed"))
                && /if\(planBDrawingCheck\(\)\)\{ updatePatReadout\(\); render\(\); return; \}/.test(cm),
          () => "resetPattern / commitPattern / windowSelects / settings / patSourceLines / punchOut / withCardKept / the drawing check");
  }

  // ══ 28. THE PHASE 3 REVIEW (2026-11-20): seventeen findings confirmed, eleven defects - each with its check ═══════
  {
    const st = Math.floor(Date.now() / 1000) + 3600;
    const AT = (m) => ({ ...READ, m, say: (m >= 0 ? "+" : "") + m.toFixed(2) + " m", start: true, startT: st });
    const runsOn = (g, x) => (g.patClip || []).filter((sg) => onX(sg, x)).map(spanN);
    // ── 28a. THE CHANNEL RULE IS THE DRAWING'S ──
    // a diagonal fairway band 40 m deep: lines x = 30 and 40 cross it (out, in, out: they SPAN it); line x = 20 only
    // runs into it and ends inside (n 170..200). The first plan cuts it out of every line; its Plan B is line 20 alone.
    const band = [[-10, 245], [50, 95], [50, 135], [-10, 285], [-10, 245]];
    const FAIRWAY = () => ({ role: "fairway", cls: "Fairway_area", props: {},
      geometry: { type: "Polygon", coordinates: [band.map(([x, y]) => { const q = at(x, y); return [q.lon, q.lat]; })] } });
    const wa = makeWorld({ features: [SHOAL(), FAIRWAY()] });
    wa.setWin(null, 10); wa.setLevel(READ);
    await safely(() => wa.punchOut());
    const da = wa.get().patDefer, outA = da && da.lines[0] ? spanN(da.lines[0].runs[0]) : null;
    const wb = makeWorld({ features: [SHOAL(), FAIRWAY()] });
    wb.setPlanB([2], 1.0, "Plan B of S1", 0);
    wb.setWin(st, null); wb.setLevel(AT(0.5));
    const pb = await safely(() => wb.punchOut());
    const rb = runsOn(wb.get(), 20), hb = wb.$("#sp_hint").textContent;
    check("28a. a Plan B asks the channel rule of its whole DRAWING: a line that only ends in a fairway its drawing's "
          + "other lines span is cut out of it, as its first plan cut it and outlined it - asked of its own lines "
          + "alone it flew 35 m into the fairway (found by two reviewers, and run)",
          () => !pb.err && da && da.lines.length === 1 && da.lines[0].i === 2 && outA && outA[1] < 165
                && rb.length === 1 && rb[0][1] < 165 && Math.abs(rb[0][1] - outA[1]) < 8 && /1 channel\(s\) excluded/.test(hb),
          () => (pb.err ? "threw " + pb.err.message + "; " : "") + "first plan's outline " + JSON.stringify(outA && outA.map(Math.round))
                + "; Plan B flies x 20 over " + JSON.stringify(rb.map((r) => r.map(Math.round))) + " | " + (hb.match(/\d+ channel\(s\)[^,·]*/) || ["no channel said"])[0]);

    // ── 28b. A PLAN B'S MAX DEPTH IS ANCHORED WHERE ITS FIRST PLAN'S WAS ──
    // Max depth 10 m; line x = 20 has the shoal mid-line and 9.4 m water over its south end. First plan cut +0.00 m:
    // deferred whole, its outline the whole line. Its Plan B at +0.70 m: 9.4 + 0.7 is over 10 - the same seabed the
    // first plan surveyed. Anchored at the first plan's cut it is flown WHOLE; unanchored its south 45 m were lost.
    const mkD = () => makeWorld({ features: [SHOAL(), DEEP()], maxDepth: 10 });
    const w1 = mkD();
    w1.setWin(null, 10); w1.setLevel(READ);
    await safely(() => w1.punchOut());
    const d1 = w1.get().patDefer, out1 = d1 && d1.lines[0] ? d1.lines[0].runs.map(spanN) : null;
    const w2 = mkD();
    w2.setPlanB([2], 1.0, "Plan B of S1", 0);                   // anchored at the first plan's cut, +0.00 m
    w2.setWin(st, null); w2.setLevel(AT(0.7));
    const p2 = await safely(() => w2.punchOut());
    const r2 = runsOn(w2.get(), 20), d2 = w2.get().patDefer;
    const w3 = mkD();
    w3.setPlanB([2], 1.0, "Plan B of S1");                      // (no anchor: the record of a survey from before)
    w3.setWin(st, null); w3.setLevel(AT(0.7));
    await safely(() => w3.punchOut());
    const r3 = runsOn(w3.get(), 20);
    // ... and the SAME card punched again under another anchor is cut again (the anchor is in the key a clip is kept under)
    w2.setPlanB([2], 1.0, "Plan B of S1");
    await safely(() => w2.punchOut());
    const r2b = runsOn(w2.get(), 20);
    // ... and the OUTLINE is anchored there too: a 0.2 m shoal (needs +0.80 m) keeps the line deferred at +0.70 m, and
    // what is deferred - drawn dashed, recorded, judged next time - is the WHOLE line, its deep south end with it
    const w4 = makeWorld({ features: [area(15, 25, 80, 120, 0.2, 0.2), DEEP()], maxDepth: 10 });
    w4.setPlanB([2], 1.0, "Plan B of S1", 0);
    w4.setWin(st, null); w4.setLevel(AT(0.7));
    await safely(() => w4.punchOut());
    const x4 = (w4.get().patDefer || { lines: [] }).lines[0], out4 = x4 ? x4.runs.map(spanN) : null;
    check("28b. a Plan B's Max depth stays anchored at its first plan's cut: at more water than that plan had, the "
          + "deep stretch the tide lifted over the ceiling is still the line's - it is flown WHOLE, as it was outlined "
          + "and deferred, where the ceiling at Plan B's own low flew it in part with the rest in no record",
          () => !p2.err && out1 && out1.length === 1 && out1[0][0] < 3 && out1[0][1] > 197
                && r2.length === 1 && r2[0][0] < 10 && r2[0][1] > 190 && d2 && d2.out.size === 0
                && r3.length === 1 && r3[0][0] > 40 && r2b.length === 1 && r2b[0][0] > 40
                && x4 && x4.why === "tide" && x4.needM === 0.8 && out4.length === 1 && out4[0][0] < 3 && out4[0][1] > 197,
          () => (p2.err ? "threw " + p2.err.message + "; " : "") + "first plan's outline " + JSON.stringify(out1 && out1.map((r) => r.map(Math.round)))
                + "; Plan B anchored flies " + JSON.stringify(r2.map((r) => r.map(Math.round))) + "; unanchored "
                + JSON.stringify(r3.map((r) => r.map(Math.round))) + "; the same card under no anchor "
                + JSON.stringify(r2b.map((r) => r.map(Math.round))) + "; a line still deferred is outlined "
                + JSON.stringify(out4 && out4.map((r) => r.map(Math.round))) + " needing " + (x4 && x4.needM));

    // ── 28c. THE NEED IS ASKED OF EVERY PIECE ──
    // a "pier" (never water) across lines 20 and 30 at n 95..105, and a 0.5 m shoal on their NORTH pieces. Line 30 is
    // past the duration (a time line in two runs); line 20 is cut by the shoal at chart datum (a tide line whose
    // outline is in two pieces). Each needs the shoal's +0.50 m: asked of its first piece only it answered less.
    const PIER = (x0, x1) => area(x0, x1, 95, 105, -9, -9);
    const wt = makeWorld({ features: [PIER(25, 35), area(25, 35, 150, 170, 0.5, 0.5)] });
    wt.setWin(st, 10); wt.setLevel({ ...AT(1.0), high: { m: 1.5, t: HIGH_T }, horizonLow: -0.3 }); wt.setTime([3]);
    const pt = await safely(() => wt.punchOut());
    const xt = (wt.get().patDefer || { lines: [] }).lines[0];
    const wu = makeWorld({ features: [PIER(15, 25), area(15, 25, 150, 170, 0.5, 0.5)] });
    wu.setWin(null, 10); wu.setLevel(READ);
    const pu = await safely(() => wu.punchOut());
    const xu = (wu.get().patDefer || { lines: [] }).lines[0];
    check("28c. a need is asked of EVERY piece of a line: a time line a pier cuts in two with a shoal on its second "
          + "piece needs the shoal's +0.50 m (not the floor it is clear at on its first), and a tide line whose outline "
          + "is in two pieces with the shoal on the second needs it too (not the cut)",
          () => !pt.err && xt && xt.i === 3 && xt.why === "time" && xt.runs.length === 2 && xt.needM === 0.5 && !xt.needFloor
                && !pu.err && xu && xu.i === 2 && xu.why === "tide" && xu.runs.length === 2 && xu.needM === 0.5,
          () => JSON.stringify({ time: xt && [xt.i, xt.why, xt.runs.length, xt.needM, !!xt.needFloor],
                                 tide: xu && [xu.i, xu.why, xu.runs.length, xu.needM] })
                + (pt.err ? " threw " + pt.err.message : "") + (pu.err ? " threw " + pu.err.message : ""));

    // ── 28d. A PLAN B IS LINES OF ONE DRAWING ──
    const wd = makeWorld();
    wd.setPlanB([3, 4], 1.0, "Plan B of S1", 0);
    const pin1 = wd.planBDrawingCheck(), pin2 = wd.planBDrawingCheck(), before = wd.lines().map((l) => Math.round(xy(l[0]).e));
    wd.setPat(at(0, 0), at(45, 200), at(5, 0));                 // the Spacing halved: nine lines, and 3 and 4 are others
    const wouldFly = wd.lines().map((l) => Math.round(xy(l[0]).e));
    const ended = wd.planBDrawingCheck(), after = wd.planB(), all = wd.lines().length, again = wd.planBDrawingCheck();
    const said = wd.log.notes.join(" ");
    // ... and a drawing MOVED - the same number of lines, every one of them elsewhere - is another drawing too
    const wm = makeWorld();
    wm.setPlanB([3, 4], 1.0, "Plan B of S1", 0);
    wm.planBDrawingCheck();
    wm.setPat(at(100, 0), at(145, 200), at(110, 0));
    const movedN = wm.all().length, movedEnded = wm.planBDrawingCheck();
    // ... and where the card is read: its refresh, and Add to plan (which adds nothing on that press)
    const we = makeWorld();
    we.setPlanB([3, 4], 1.0, "Plan B of S1", 0);
    we.planBDrawingCheck();
    we.setPat(at(0, 0), at(45, 200), at(5, 0));
    await safely(() => we.commitPattern());
    check("28d. a geometry edit on a Plan B's card ENDS the Plan B, said: its line numbers were of the drawing as it "
          + "was (after a halved Spacing the same numbers were two lines its first plan already flies) - the card is an "
          + "ordinary survey of every line drawn, not named or recorded as Plan B, and Add to plan adds nothing on the "
          + "press that finds it; an unchanged drawing is left alone",
          () => pin1 === false && pin2 === false && before.join(",") === "30,40" && wouldFly.join(",") === "15,20"
                && ended === true && after.only === null && after.outlineM === null && after.lowM === null && after.name === ""
                && all === 9 && again === false && movedN === 5 && movedEnded === true && wm.planB().only === null
                && /no longer Plan B of S1/.test(said) && /Reset, then Plan B on their survey's row/.test(said)
                && we.planB().only === null && (we.mission.surveys || []).length === 0 && we.mission.lines.length === 0,
          () => JSON.stringify({ before, wouldFly, ended, after, all }) + " | " + said.slice(0, 160)
                + " | committed " + (we.mission.surveys || []).length);

    // ── 28e. THE WORDS WHEN NOTHING IS LEFT TO ADD ──
    const wn = makeWorld();
    wn.setPlanB([2], 1.0, "Plan B of S1", 0);
    wn.setWin(st, null); wn.setLevel(AT(0.2));                  // under the shoal line's +0.50 m: its only line is deferred
    await safely(() => wn.punchOut());
    const hn = wn.$("#sp_hint").textContent, refuse = wn.punchRefusal();
    // ... while a punch that leaves lines still points at Add to plan and Plan B
    const wk = makeWorld();
    wk.setWin(null, 10); wk.setLevel(READ);
    await safely(() => wk.punchOut());
    const hk = wk.$("#sp_hint").textContent;
    check("28e. a punch whose window deferred EVERY line does not send the operator to an Add to plan that is refused: "
          + "it says no line is left to add - and for a Plan B the refusal offers no 'clear its Start and Duration' "
          + "(a Plan B selects whole lines with neither on the card); a punch that leaves lines still points at Plan B",
          () => /NO LINE IS LEFT to add: it needs a start whose water covers what is said above/.test(hn) && !/Add to plan, then Plan B/.test(hn)
                && refuse && /Reset the card and press Plan B on their survey's row again on a later tide/.test(refuse.text)
                && !/clear its Start and Duration/.test(refuse.text)
                && /Add to plan, then Plan B on its row plans them for a start that has the water/.test(hk),
          () => hn.slice(-170) + " || " + (refuse && refuse.text.slice(-240)));
  }

  __finished = true;
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
