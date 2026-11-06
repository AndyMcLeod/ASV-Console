// tests/auto_clear.js - CLEARING BLOCKED LINES after Punch Out, one strike at a time (2026-11-06).
//
// THE ASK (Andy, 2026-11-06): "Refusals block upload and start after punchout. Manual deletion of lines that violate path
// planning works in some instances, not so much in others ... auto delete lines one by one after punch out and before
// upload ... wait for the replan process to continue before deleting the next ... Alert when complete and the add to plan
// and upload are not blocked." He approved the plan that came back, with its defaults.
//
// WHY STRIKES "WORKED SOMETIMES" (measured in the lab on a copy of his S1, 326 runs, Castine): the punch was cut at the
// LIVE standoff - guardStandoffM of the live set, which swung 11.8-12.5 m in seconds - so three punches seconds apart with
// no strike gave 333, 332 and 331 runs and three different sets of reds; and ANY water-level change threw the punch away,
// strikes and all (the level was in patStrikeKey). With both held, one strike at a time converged: 11 blockers to 0 in 12
// strikes, 134 m (0.08%) of coverage; Update and Upload then went through. And Upload's own router (legPath) routes some
// hops the punch's could not (3 of his 5), so a red hop is only a blocker when legPath cannot route it either.
//
// WHAT IS DRIVEN: the page's own clearing - pickStrike, redBlocks, punchBlockers, the hold (takePunchHold,
// refreshPunchHold, punchCutNow), judgeRedHops, startClearing / runClearing / finishClearing / endClearing,
// clearingTick, uploadDryRun, patternWaypoints, renderClearRow, punchOutPressed - over the page's own punchOut,
// punchRefusal, commitPattern, strikeSelectedRun, applyWaterOffset and updatePatReadout, on the real modules (geodesy,
// units, state, turns, passage, chart, guard, surveys) and keep-out models the REAL chart.js builds from ENC-shaped
// features - turn_refusal.js's world, with the clearing in it. Stubbed: the DOM (a fake element per selector), the ENC
// fetch, the chart-ink fold, the sinks (banner, note, session log, action log), and - where a check says so - the route
// worker (planOffThread) and Upload's router (legPath), so a check can put a verdict where it needs one.
//
//   node tests/auto_clear.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ASV_HTML points this at a SIDECAR copy for a mutation run - every read of the page goes through it.
//
//   1-3    pickStrike (most blocked joins, then an end, then the shortest, then the lower index), redBlocks, holdStepUp
//   4-5    THE HOLD: the highest margin of the window rounded up, the level now; raised, never lowered; the water's step
//   6      the strike key names neither the standoff nor the water; the clip key names both
//   7-12   THE FINGER PIER, cleared from Punch Out: the hold cuts it, one run struck, ready, said, logged; the water
//          inside the hold keeps it, past the hold re-cuts it with the strike kept; commit records the CUT level
//   12b    a clearing started on a punch cut before the hold re-cuts it at the hold before the first strike
//   13-16  red hops put to Upload's router: refused / passed / asked (said as pending) / a stale answer never on new joins
//   17-20  the stop rules: the coverage cap (and Keep clearing), no progress, Stop, the pattern changing
//   21-22  the dry run of Upload: legs mapped to joins and to "outside"; a join only Upload refuses goes back to the strikes
//   23     the route worker's "hops" op answers with legPath's own verdicts
//   24-26  wiring: the buttons, the keys and the frame; the row's one button; runNear names the identity midpoint
//   27-35  what the first mutation run found unguarded: the strike cap; a re-cut, and each dry run's new blockers, start
//          the progress count again; a strike by hand stops it; a re-cut under the flash is judged again, not struck;
//          the banner when Upload is still blocked OUTSIDE the survey; the frame samples the margin; the row hides;
//          Punch Out with nothing blocked releases the hold
//   23b, 36-50  WHAT THE REVIEW FOUND (three refuters, before the merge): a way round past the read box is left to
//          Upload; a stop names what changed; the operator taking over stops a FINISHED clearing too; a stopped row
//          counts what stands now, Put them back forgets the count, the banner counts "in all"; Punch Out's own punch is
//          fenced ("punching", the old offer hidden at once, its tail not run after the gen moved); Upload's answer about
//          a replaced punch is not taken, and a pattern changed under it is named; Clear again always checks Upload's
//          route; Unblock does not reload the survey on the card and clears with nothing red; the reset and a pattern
//          change release the hold; a rebuild of the guard's model drops a held punch (and a move of the hold's step
//          still does without one); a leg along the survey's own lines is said; the words; Add to plan stops a
//          clearing; the cut is taken AFTER the chart read; the hops on the background lane, four a message
//
// TEETH (2026-11-06; 58 mutations of a SIDECAR copy of the page, run through ASV_HTML, the real page diffed unchanged
// after; predictions corrected by the runs). The first run killed 44. Of the 14 left, one did not apply as written (J5,
// its text corrected) and eleven were holes, each closed by a check above and killed on the re-run (S1 12b, C2 27, C8 28,
// E2 29, C7 30, F2 31, F3 32, T2 33, U2 34, O2 35, O3 7). Two mutants still live, and both are EQUIVALENT IN OUTCOME:
//   J1  judgeRedHops without `if(patRed !== red) return;` - the late answer lands on the replaced joins' OWN objects,
//       never the new ones (16 holds either way), and the cache key carries the model and both ends, so what is cached
//       is still true. The guard saves a redundant render.
//   C9  runClearing without its TOP-of-loop pattern check - a pattern changed during the re-punch is still caught before
//       any strike, by the check after the flash (C5, killed by 20) or by finishClearing's own; it costs one flash.
// Two mutants used to HANG the suite until its 240 s kill, not fail it - punchCutNow never held (H5) and punchOut
// ignoring the cut (X1): the clearing re-cut for ever. The page now stops after three re-cuts in a row (clr.recuts),
// saying so, and each is now killed in under a minute, by twenty-odd checks.
// THE REVIEW'S REPAIRS (2026-11-06): the run re-done on the repaired page - 83 mutations, the 58 above (eleven
// re-anchored where the repairs moved their text) and 25 new, one or more a repair. 78 killed on the first run; three
// were holes, closed by 36 (say(6) exact: K3), 39c (the row hidden at the press: U3) and 45b (a move of the hold's step
// with no rebuild: W2) and killed on the re-run - 81 of 83, J1 and C9 the two above. Five more, outside this page's
// sandbox, killed by their own suites: Q2 (12i), Q5 and Q6 (12j) in tests/survey_table.js - an Unblock offer for a
// leg that only ENDS in a survey, and after an Update - and Z1, Z2 (23b's question put to a mutated COPY of
// route_job.js) - a way round past the read box answered true.
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
// ⚠ A HANG MUST REPORT TOO: an await nothing resolves empties the event loop and Node exits 0 in silence.
let __finished = false;
process.on("beforeExit", () => {
  if (__finished) return;
  console.log("  FAIL 0. the suite stopped before finishing - something waited on an answer it was never given");
  console.log("\n1 CHECK(S) FAILED (stopped before finishing)");
  process.exitCode = 1;
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
const SV = require("../static/js/surveys.js");
const RJ = require("../static/js/route_job.js");

const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");

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
function decl(re) {
  const m = H.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}
async function safely(fn) { try { return {v: await fn()}; } catch (e) { return {err: e}; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(25); } return !!fn(); }

// ── the world: turn_refusal.js's, with the clearing in it ─────────────────────────────────────────────────────────────
const O = { lat: 21.3, lon: -157.87 };
const FRAME = G.planeFrame(O);
const at = (x, y) => FRAME.fromEN(x, y);
function dock(x0, x1, y0, y1) {
  const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => { const p = at(x, y); return [p.lon, p.lat]; });
  return { role: "dock", cls: "PONTON", props: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}
const FINGER = () => dock(24.5, 25.5, 100, 240);       // between runs 3 and 4, past TRIM_MAX_M: the turn 3-4 refused
// two cells split by a 6 km block of land: the hop between them has no way round inside the punch's search
// a 400 m square of land: a leg from its middle to the open water has no way out at all (legPath: null)
const ISLAND = () => ({ role: "land", props: {}, geometry: { type: "Polygon", coordinates: [
  [[-200, -200], [200, -200], [200, 200], [-200, 200], [-200, -200]].map(([x, y]) => { const p = at(x, y); return [p.lon, p.lat]; })] } });
const LAND = () => ({ role: "land", props: {}, geometry: { type: "Polygon", coordinates: [
  [[-3000, 1000], [3000, 1000], [3000, 2000], [-3000, 2000], [-3000, 1000]].map(([x, y]) => { const p = at(x, y); return [p.lon, p.lat]; })] } });

const PAGE_FUNCS = ["punchOut", "currentPattern", "surveyPattern", "patSourceLines", "boundaryActive", "clipLine",
  "patStrikeKey", "activeStruck", "keptRuns", "runMid", "extendLead", "runWithLeads", "patCoverSeg", "patCoverMid",
  "patIdentSeg", "trimEnd", "judgeJoin", "patClipBufM", "patClipKey", "bandWord",
  "makesWayKey", "slowestMakingWayKey", "setMsNow",
  "patLeadTotal", "leadMetres", "leadInM", "leadOutM", "easeLsM", "roleSpeed", "roleSpeedMS", "depthRange",
  "kindsSummary", "emptyPunchRefusal", "isStepKey", "spdTxt", "spdAtTxt", "slowestSelectableKey", "punchRefusal",
  "patternWaypoints", "commitPattern", "resetPattern", "updatePatReadout", "flushRepunch", "punchNow",
  "dropStruckFromPunch", "strikeSelectedRun", "scheduleRepunch", "applyWaterOffset",
  // THE CLEARING (2026-11-06)
  "punchCutNow", "notePunchMargin", "punchMarginMax", "holdStepUp", "takePunchHold", "refreshPunchHold",
  "judgeRedHops", "redBlocks", "punchBlockers", "patCoverLenM", "patCoverTotalM", "pickStrike", "uploadDryRun",
  "punchCutStale", "startClearing", "runClearing", "finishClearing", "endClearing", "stopClearingFor", "clearingTick",
  "renderClearRow", "punchOutPressed", "routeKoId",
  // the review's repairs (2026-11-06)
  "heldCutAfterRead", "releasePunchHold", "strikeKeyChange", "forgetClearingStrikes", "unblockSurvey",
  "surveysUploadBlocked", "noteSurveyUpdated"];
const PAGE_DECLS = [/^const NO_LEAD = [^;]*;/m, /^const LEAD_GIVE = [^;]*;/m, /^const MAX_SURVEY_LINES = [^;]*;/m,
  /^const LEAD_MAX_M = [^;]*;/m, /^const REPUNCH_DELAY_MS = [^;]*;/m, /^const TIDE_REBUILD_M = [^;]*;/m,
  /^const TRIM_MAX_M = [^;]*;/m, /^const JUDGE_RUN_M = [^;]*;/m, /^const SPEED_ROLES = [^;]*;/m,
  /^const _eqLL=[^;]*;/m,
  /^let punchHold = [^;]*;/m, /^const PUNCH_HOLD_STEP_M = [^;]*;/m, /^const PUNCH_HOLD_WINDOW_MS = [^;]*;/m,
  /^let punchMarginSeen = [^;]*;/m, /^const hopVerdicts = [^;]*;/m, /^let clr = [^;]*;/m,
  /^const CLEAR_CAP_STRIKES = [^;]*;/m, /^const CLEAR_CAP_FRAC = [^;]*;/m, /^const CLEAR_STALE_MAX = [^;]*;/m,
  /^const CLEAR_FLASH_MS = [^;]*;/m, /^const clearPause = [^;]*;/m, /^const HOP_ASK_CHUNK = [^;]*;/m,
  /^let runUnsafe = [^;]*;/m, /^let unblockDone = [^;]*;/m];

function makeWorld(opts) {
  const o = opts || {};
  const els = {};
  const fakeEl = (id) => ({ id, textContent: "", value: "", disabled: false, title: "", style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; }, focus() {} });
  const $ = (s) => els[s] || (els[s] = fakeEl(s));
  const document = { activeElement: null, createElement: (t) => fakeEl(t), createTextNode: (t) => ({ textContent: t }) };
  const log = { banners: [], notes: [], saves: 0, violations: [], client: [], actions: [], rows: [] };
  const HOOK = { planOffThread: null, legPath: null, asked: 0 };
  // eslint-disable-next-line no-new-func
  const SRV = { status: o.status || {} };                 // the SERVER state the page reads as `S` (S.status: the set)
  const W = new Function("G", "U", "ST", "S", "T", "PS", "C", "GU", "GEOM", "SV", "$", "document", "log", "HOOK", "CO",
    "\"use strict\";\n"
    + "const {azTo, distTo, atDA, llEN, fromEN, toEN} = G; const {fmtDist, fmtDur} = U; const {V, nogo, sea} = ST;\n"
    + "const {MAX_HALF_M, SKEW_LIMIT_DEG, minTurnRadiusM, shortenSeg, SPEED_CMD_LATENCY_S, easeOffered} = T;\n"
    + "const {turnWithRetry, joinBreaches} = T; const {acrossTrackM} = GEOM; const {slowLaw, slowLeadM} = CO;\n"
    + "const {channelLaneRoute, channelSpanKeepouts, channelTurnKeepouts, junctionKnot, pruneJunctionKnots,"
    + " regionOrder, routeAround, routePlan} = PS;\n"
    + "const {blocked, buildKeepouts, firstBlockAlong, legReasons, effectiveWaterOffset} = C;\n"
    + "const {surveyEntries} = SV;\n"
    + PAGE_DECLS.map(decl).join("\n") + "\n"
    + "let pat = {A:null, B:null, C:null, align:0}, patDrag = null, patMoveLast = null, patClip = null, patLead = [], patTrim = [];\n"
    + "let patUnsafe = [], patRed = [], patJoined = false, patDropped = null, patFunnel = null, patRoutes = [], patTransits = [];\n"
    + "let turnSlowAt = {};\n"
    + "let patStruck = [], patStruckKey = null, patSel = null, patClipMemo = null, patRepunchT = null;\n"
    + "let punchInFlight = null, punchBusy = false, encShow = false, boundary = [], boundaryClosed = false;\n"
    + "let surveyBounded = false;\n"
    + "let planKind = null, asv = null;\n"
    + "const mission = {lines: [], waypoints: [], surveys: [], approach_radius_m: 1, speeds: {}, speed: 'survey'};\n"
    // the chart read punchOut awaits: instant, unless a check puts something to happen DURING it (49)
    + "const applyNogoControls = () => {}; const ensureNogoArea = async () => { if(HOOK.ensure) await HOOK.ensure(); return true; };\n"
    + "const render = () => { log.rows.push($('#sp_clear').style.display === 'none' ? '' : ($('#sp_clear')._txt || {}).textContent || ''); };\n"
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
    // ✎ (Unblock loads the survey with it): recorded, and the survey is then the one on the card
    + "const editSurvey = async (id) => { log.edits = (log.edits || []).concat([id]); editingSv = id; };\n"
    + "const rebuildNogo = () => { nogo.builtOffset = sea.waterOffset; };\n"
    + "function aisMooredClipKeepouts(){ return {polys: [], stale: false, note: null}; }\n"
    + "function aisClipSig(){ return \"\"; }\n"
    // the sinks the clearing writes, recorded
    + "const logClient = (k, d) => log.client.push({k, d}); const recordAction = (kind, l) => log.actions.push({kind, l});\n"
    + "const routeKoIds = new Map(); let routeKoSeq = 0;\n"
    // the route worker and Upload's router: the real ones unless a check puts its own verdict in
    // ⚠ the "hops" job has NO page-thread answer (judgeRedHops hands `() => null`): the worker's own reply is emulated
    // here, as route_job.js gives it - legPath (this sandbox's, so a check's verdict goes in), then the read box
    + "const workerHops = (pairs) => pairs.map((p) => { const L = legPath(p[0], p[1], nogo.frame, nogo.ko, nogo.buffer);"
    + " return !L ? false : (PS.beyondChart([p[0], ...L], nogo.bbox, undefined, nogo.unread) ? null : true); });\n"
    + "const planOffThread = (job, here, adopt, L) => { (HOOK.lanes = HOOK.lanes || []).push({op: job.op, L, n: job.args.pairs ? job.args.pairs.length : null});"
    + " return HOOK.planOffThread ? HOOK.planOffThread(job, here)"
    + " : Promise.resolve(job.op === 'hops' ? workerHops(job.args.pairs) : here()); };\n"
    + "const legPath = (...a) => { HOOK.asked++; return HOOK.legPath ? HOOK.legPath(...a) : PS.legPath(...a); };\n"
    + "const transitStandoffM = () => nogo.buffer;\n"
    + PAGE_FUNCS.map(grab).join("\n")
    + "\nfunction model(){ const dr = depthRange();"
    + " return buildKeepouts(nogo.frame, nogo.enf, {min: Math.max(V.NOGO_MIN_DEPTH_M, dr.min), max: 0}, nogo.features); }"
    + "\nreturn { $, log, mission, HOOK, punchOut, punchNow, punchRefusal, commitPattern, updatePatReadout, resetPattern,"
    + " strikeSelectedRun, flushRepunch, patCoverMid, patCoverSeg, model, pickStrike, redBlocks, punchBlockers, holdStepUp,"
    + " takePunchHold, refreshPunchHold, punchCutNow, notePunchMargin, punchMarginMax, judgeRedHops, startClearing,"
    + " endClearing, clearingTick, uploadDryRun, patternWaypoints, renderClearRow, punchOutPressed, patStrikeKey, patClipKey,"
    + " patCoverLenM, patCoverTotalM, activeStruck, stopClearingFor,"
    + " strikeKeyChange, forgetClearingStrikes, unblockSurvey, surveysUploadBlocked, noteSurveyUpdated, releasePunchHold,"
    + " set runUnsafe(v){ runUnsafe = v; }, get editingSv(){ return editingSv; }, setSel: (s) => { patSel = s; },"
    + " get: () => ({pat, patClip, patRed, patJoined, patDropped, patTransits, patUnsafe, patRepunchT, patLead, patTrim,"
    + "               patStruck, patFunnel, punchHold, clr, punchMarginSeen}),"
    + " get clr(){ return clr; }, get punchHold(){ return punchHold; }, set punchHold(v){ punchHold = v; },"
    + " set asv(v){ asv = v; }, set editingSv(v){ editingSv = v; },"
    + " water: (m) => applyWaterOffset({ok: true, offset_m: m, stations: [{dist_km: 2}]}),"
    + " setPat: (A, B, Cc) => { pat = {A, B, C: Cc, align: 0}; },"
    + " setRed: (r, joined) => { patRed = r; patJoined = joined; } };")(
    G, U, S, SRV, T, PS, C, GU, GEOM, SV, $, document, log, HOOK, require("../static/js/coast.js"));
  W.SRV = SRV;
  S.V.SPEED_KN = { low: 1.5, survey: 3.0, high: 6.0 };
  S.V.MAX_TURN_RATE_DEG_S = 60;
  S.V.MIN_SURVEY_LINE_M = 0;
  S.V.NOGO_MIN_DEPTH_M = 1.0;
  S.sea.waterOffset = 0;
  Object.assign(S.nogo, { frame: FRAME, buffer: 3, enf: { land: true, depth: true, haz: true, area: false },
                          features: o.features || [FINGER()], band: "enc_harbor", note: "", ready: false, ko: null,
                          builtOffset: 0, bbox: null, unread: null });   // (23b's routeReply writes the shared nogo)
  if (o.ready) { S.nogo.ko = W.model(); S.nogo.ready = true; }
  if (o.hop) W.setPat(at(0, 0), at(45, 3000), at(10, 0));     // ten runs in two cells
  else W.setPat(at(0, 0), at(45, 200), at(10, 0));            // five lines, x = 0 .. 40
  return W;
}
const rowTxt = (w) => { const el = w.$("#sp_clear"); return el.style.display === "none" ? "" : ((el._txt || {}).textContent || ""); };
const kinds = (w) => w.log.client.map((x) => x.k);

(async () => {
  console.log("Clearing blocked lines after Punch Out, one strike at a time:");

  // ── 1-3. THE CHOOSER, THE PREDICATE, THE STEP ──────────────────────────────────────────────────────────────────────
  {
    const w = makeWorld();
    const len = (L) => (k) => L[k];
    const pk = (b, n, L) => { const p = w.pickStrike(b, n, len(L)); return p ? p.k : null; };
    const flat = [100, 100, 100, 100, 100, 100];
    check("1. pickStrike takes the run between TWO blocked joins first - one strike clears both - even over a shorter "
          + "run beside one",
          () => pk([{k: 1}, {k: 2}], 6, [100, 5, 100, 100, 100, 100]) === 2
                && pk([{k: 1}, {k: 2}], 6, flat) === 2,
          () => "joins 1-2 and 2-3 blocked: struck run index " + pk([{k: 1}, {k: 2}], 6, [100, 5, 100, 100, 100, 100]));
    check("1b. ... then a run at an END of the pattern (striking it makes no new join), then the SHORTEST, then the lower "
          + "index - and never a run with no coverage of its own; nothing blocked, nothing picked",
          () => pk([{k: 0}], 6, [100, 5, 100, 100, 100, 100]) === 0          // end beats the shorter inner run
                && pk([{k: 5 - 1}], 6, [100, 100, 100, 100, 5, 100]) === 5   // the far end too
                && pk([{k: 2}], 6, [100, 100, 80, 40, 100, 100]) === 3        // shortest of the pair
                && pk([{k: 2}], 6, flat) === 2                                // full tie: the lower index
                && pk([{k: 2}], 6, [100, 100, 0, 100, 100, 100]) === 3        // no coverage: never
                && pk([], 6, flat) === null && pk([{k: 2}], 6, [100, 100, 0, 0, 100, 100]) === null,
          () => [pk([{k: 0}], 6, [100, 5, 100, 100, 100, 100]), pk([{k: 4}], 6, [100, 100, 100, 100, 5, 100]),
                 pk([{k: 2}], 6, [100, 100, 80, 40, 100, 100]), pk([{k: 2}], 6, flat),
                 pk([{k: 2}], 6, [100, 100, 0, 100, 100, 100])].join(","));
    check("2. redBlocks: a reversal with no flyable turn always blocks; a hop only when Upload's router cannot route it "
          + "either - routed, never asked, unanswerable or still being asked, it does not",
          () => w.redBlocks({turn: true}) && w.redBlocks({turn: false, upload: false})
                && !w.redBlocks({turn: false, upload: true}) && !w.redBlocks({turn: false})
                && !w.redBlocks({turn: false, upload: null}) && !w.redBlocks({turn: false, upload: "pending"})
                && !w.redBlocks(null));
    check("3. the held standoff is rounded UP to 0.1 m and a value already on the step stays on it (floating point "
          + "included: 12.6 is not 12.7, 3 is not 3.1)",
          () => Math.abs(w.holdStepUp(12.51) - 12.6) < 1e-9 && Math.abs(w.holdStepUp(12.6) - 12.6) < 1e-9
                && Math.abs(w.holdStepUp(3) - 3) < 1e-9 && Math.abs(w.holdStepUp(11.79) - 11.8) < 1e-9
                && w.holdStepUp(0.3) < 0.31,
          () => [12.51, 12.6, 3, 11.79, 0.3].map((v) => w.holdStepUp(v).toFixed(3)).join(" "));
  }

  // ── 4-5. THE HOLD ─────────────────────────────────────────────────────────────────────────────────────────────────
  {
    // a set strong enough to widen the clip past the 3 m buffer: 0.25 kn -> 4.07 m, 0.2 kn -> 3.56 m, 0.3 kn -> 4.59 m
    const w = makeWorld({ status: { env_set_deg: 90, env_set_kn: 0.25 } });
    const live = () => GU.guardStandoffM(3, (w.SRV.status.env_set_kn || 0) * 0.514444);
    w.notePunchMargin(Date.now() - 130000);             // older than the window - must not count ...
    w.get().punchMarginSeen[w.get().punchMarginSeen.length - 1].bufM = 99;   // ... however high it read
    w.SRV.status.env_set_kn = 0.25; w.notePunchMargin(Date.now() - 1000);
    const top = live();
    w.SRV.status.env_set_kn = 0.2; w.notePunchMargin(Date.now());
    S.sea.waterOffset = 0.27;
    const h = w.takePunchHold(), hb = h.bufM;            // (h IS the hold, which 5 raises: its value now)
    check("4. the hold is the HIGHEST standoff the window read, rounded up - never below the live one at the moment it "
          + "is taken - with the level now; a reading older than the window does not count",
          () => Math.abs(h.bufM - w.holdStepUp(top)) < 1e-9 && h.bufM >= live() && h.bufM < 50
                && Math.abs(h.waterM - 0.27) < 1e-12 && w.punchCutNow().held === true
                && w.punchCutNow().bufM === h.bufM && w.punchCutNow().waterM === h.waterM,
          () => "window top " + top.toFixed(2) + " m -> held " + h.bufM.toFixed(2) + " m (live " + live().toFixed(2)
                + " m), water " + h.waterM);
    w.SRV.status.env_set_kn = 0.15;
    const why1 = w.refreshPunchHold(), b1 = w.punchHold.bufM;
    S.sea.waterOffset = 0.27 + 0.05;
    const why2 = w.refreshPunchHold();
    w.SRV.status.env_set_kn = 0.3;
    const why3 = w.refreshPunchHold(), b3 = w.punchHold.bufM;
    S.sea.waterOffset = 0.27 + 0.1;
    const why4 = w.refreshPunchHold();
    check("5. refreshed before every punch, the hold is NEVER lowered by a weaker set and never moved by water under "
          + "TIDE_REBUILD_M; a stronger set raises it, a 0.1 m move moves it - and each says what moved",
          () => why1 === null && b1 === hb && why2 === null && Math.abs(w.punchHold.waterM - 0.37) < 1e-9
                && /the current's standoff rose to 4\.6 m \(held now at 4\.6 m\)/.test(why3) && Math.abs(b3 - 4.6) < 1e-9
                && b3 >= live() && /the water level moved from \+0\.27 m to \+0\.37 m/.test(why4),
          () => [why1, why2, why3, why4].map(String).join(" | ") + " | held " + b3);
    S.sea.waterOffset = 0;
  }

  // ── 6. THE KEYS ───────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const w = makeWorld();
    const k0 = w.patStrikeKey();
    S.sea.waterOffset = 0.4;
    const k1 = w.patStrikeKey();
    S.sea.waterOffset = 0;
    const c = (b, wl) => w.patClipKey({bufM: b, waterM: wl});
    check("6. a strike stands at any water level and any set: the strike key names neither - and the clip memo's key "
          + "names both, so a clip cut at other inputs is never served",
          () => k0 && k0 === k1 && c(3, 0) !== c(3, 0.2) && c(3, 0) !== c(3.1, 0) && c(3, 0) === c(3, 0)
                && c(3, 0).startsWith(k0),
          () => "strike key moved with the water: " + (k0 !== k1));
  }

  // ── 7-12. THE FINGER PIER, CLEARED FROM PUNCH OUT ──────────────────────────────────────────────────────────────────
  {
    const w = makeWorld();
    const p7 = await safely(() => w.punchOutPressed());
    const g = w.get();
    const recut7 = w.log.rows.filter((r) => r.includes("Re-cutting the runs")).length;
    check("7. Punch Out cuts the punch at a HOLD (the cut on the funnel is the held one), finds the red reversal 3-4, and "
          + "starts clearing by itself - on the very punch it cut, never re-cutting it first",
          () => !p7.err && g.patFunnel && g.patFunnel.cut && g.patFunnel.cut.held === true
                && g.punchHold && g.patFunnel.cut.bufM === g.punchHold.bufM && recut7 === 0
                && kinds(w)[0] === "clear_start" && w.log.client[0].d.blocked === 1 && w.log.client[0].d.why === "Punch Out",
          () => (p7.err ? "threw: " + p7.err.message : "") + " cut " + JSON.stringify(g.patFunnel && g.patFunnel.cut)
                + "; " + recut7 + " re-cut(s); log " + kinds(w).join(","));
    const strikes = w.log.client.filter((x) => x.k === "clear_strike");
    check("8. it strikes ONE run - run 3, the lower of an equal pair beside the join - shown on its row before it goes, "
          + "and re-judges after the re-punch: nothing blocks, Add to plan is not refused, the strike is kept",
          () => strikes.length === 1 && strikes[0].d.run === 3 && g.clr.phase === "ready" && g.patClip.length === 4
                && w.punchRefusal() === null && w.activeStruck().length === 1
                && w.log.rows.some((r) => r.includes("CLEARING BLOCKED LINES - strike 1: run 3 (" + strikes[0].d.len_m
                                                     + " m) for the red turn 3–4, a dock / pier"))
                && (w.updatePatReadout(), w.$("#sp_add").disabled === false),
          () => strikes.map((x) => JSON.stringify(x.d)).join(" ") + " | phase " + g.clr.phase + ", "
                + (g.patClip || []).length + " runs, refusal " + JSON.stringify(w.punchRefusal()));
    const banner = w.log.banners[w.log.banners.length - 1] || "";
    check("9. done, it SAYS so: the banner and a note count the strikes and the coverage they cost, say Add to plan is "
          + "not blocked, and say why Upload's route was not checked (no position fix); the session log has the start, "
          + "each strike and the end; the action log has the strike",
          () => banner.startsWith("Cleared: 1 line(s) struck (" + strikes[0].d.len_m + " m, 20.00% of the coverage). Add to "
                                  + "plan is not blocked. Upload's route could not be checked from here (no position fix yet")
                && w.log.notes.some((n) => /^Cleared: 1 line\(s\) struck/.test(n))
                && kinds(w).join(",") === "clear_start,clear_strike,clear_done"
                && w.log.actions.some((a) => a.kind === "note"
                                        && a.l.startsWith("Clearing blocked lines: struck run 3 (" + strikes[0].d.len_m + " m)")),
          () => banner + " | " + kinds(w).join(","));
    check("10. ... and the row under the refusal shows it, ticked, with the held inputs",
          () => /^✓ Cleared: 1 line\(s\) struck .* Held: standoff 3\.0 m, water \+0\.00 m\.$/.test(rowTxt(w)),
          () => rowTxt(w));
    const clip0 = w.get().patClip;
    w.water(0.05);
    const kept = w.get().patClip === clip0 && !w.get().patDropped;
    w.clearingTick();
    const quiet = w.get().clr.phase === "ready";
    w.water(0.15);
    const dropped = w.get().patClip === null && /the water level moved/.test(w.get().patDropped || "")
                    && w.get().patStruck.length === 1;
    w.clearingTick();                                   // the frame: past the hold, so it clears again
    await until(() => w.get().clr.phase === "ready" || w.get().clr.phase === "stopped", 15000);
    const g11 = w.get();
    check("11. THE WATER: a move inside TIDE_REBUILD_M keeps the held punch (and the frame leaves it alone); a move past "
          + "it throws the punch away but NOT the strike, and the next frame re-cuts at the new level and judges it again",
          () => kept && quiet && dropped && g11.clr.phase === "ready" && g11.patClip && g11.patClip.length === 4
                && Math.abs(g11.patFunnel.cut.waterM - 0.15) < 1e-9 && g11.patFunnel.cut.held
                && Math.abs(g11.punchHold.waterM - 0.15) < 1e-9 && w.punchRefusal() === null
                && w.activeStruck().length === 1 && kinds(w).filter((k) => k === "clear_strike").length === 1,
          () => "kept " + kept + ", quiet " + quiet + ", dropped " + dropped + "; then " + g11.clr.phase + ", "
                + (g11.patClip || []).length + " runs cut at " + JSON.stringify(g11.patFunnel && g11.patFunnel.cut)
                + ", " + w.activeStruck().length + " struck, log " + kinds(w).join(","));
    w.water(0.2);                                       // live 0.20, the punch cut at 0.15: inside the hold
    const c12 = await safely(() => w.commitPattern());
    const sv = w.mission.surveys && w.mission.surveys[0];
    check("12. Add to plan after the clearing commits the four runs and records the level the runs were CUT at, not the "
          + "live one it was kept through",
          () => !c12.err && w.mission.lines.length === 4 && sv && sv.water_m === 0.15,
          () => (c12.err ? "threw " + c12.err.message + "; " : "") + w.mission.lines.length + " lines, water_m "
                + (sv && sv.water_m));
    S.sea.waterOffset = 0;
  }

  // ── 12b. A CLEARING STARTED ON A PUNCH CUT BEFORE THE HOLD ─────────────────────────────────────────────────────────
  // "Clear blocked lines" pressed on an ordinary punch (cut LIVE, no hold): the hold it takes is the window's highest,
  // and the punch on the card must be re-cut at it BEFORE anything is judged or struck - a strike picked on the live cut
  // is a strike picked on runs the held re-punch does not draw.
  {
    const w = makeWorld({ status: { env_set_deg: 90, env_set_kn: 0 } });
    w.SRV.status.env_set_kn = 0.4; w.notePunchMargin(Date.now() - 1000);   // a gust a second ago: the window's highest
    w.SRV.status.env_set_kn = 0;
    await safely(() => w.punchNow());
    const cut0 = w.get().patFunnel && w.get().patFunnel.cut;
    const r0 = w.log.rows.length;
    const p = await safely(() => w.startClearing("the operator"));
    const rows = w.log.rows.slice(r0);
    const recut = rows.findIndex((r) => r.includes("Re-cutting the runs at the held inputs"));
    const strike = rows.findIndex((r) => /CLEARING BLOCKED LINES - strike 1:/.test(r));
    const g = w.get(), cut = g.patFunnel && g.patFunnel.cut;
    check("12b. a clearing started on a punch cut BEFORE the hold (cut live, at 3.0 m) re-cuts it at the hold - the "
          + "window's highest, above the live margin - before the first strike is chosen",
          () => !p.err && cut0 && cut0.held === false && recut >= 0 && (strike < 0 || recut < strike)
                && cut && cut.held && g.punchHold && cut.bufM === g.punchHold.bufM && g.punchHold.bufM > cut0.bufM,
          () => (p.err ? "threw " + p.err.message + "; " : "") + "live cut " + JSON.stringify(cut0) + ", row " + recut
                + " re-cut, row " + strike + " strike 1; now cut " + JSON.stringify(cut) + ", phase " + g.clr.phase);
  }

  // ── 13-16. RED HOPS PUT TO UPLOAD'S ROUTER ─────────────────────────────────────────────────────────────────────────
  {
    const w = makeWorld({ features: [LAND()], hop: true, ready: true });
    w.HOOK.legPath = () => null;                        // Upload's router cannot route it either
    await safely(() => w.punchNow());
    const red = w.get().patRed.filter((r) => !r.turn);
    const ref = w.punchRefusal();
    w.updatePatReadout();
    check("13. a red hop Upload's router cannot route is REFUSED at Add to plan, as Upload would refuse it, saying what "
          + "is in the way and that striking a run is the fix - and it is a blocker",
          () => red.length === 1 && red[0].upload === false && ref && /^1 hop\(s\) between runs Upload cannot route/.test(ref.short)
                && /ADD TO PLAN REFUSED — 1 hop\(s\) between runs have NO ROUTE/.test(ref.text) && /crosses land/.test(ref.text)
                && /strike off one of the two runs beside each \(the row under this note does it one line at a time\)/.test(ref.text)
                && w.$("#sp_add").disabled === true && w.punchBlockers().length === 1,
          () => red.map((r) => r.run + ":" + r.upload).join(",") + " | " + (ref ? ref.short : "not refused"));
    const w2 = makeWorld({ features: [LAND()], hop: true, ready: true });
    w2.HOOK.legPath = (a, b) => [a, b];                 // Upload's router routes it
    await safely(() => w2.punchNow());
    const asked1 = w2.HOOK.asked;
    await safely(() => w2.punchNow());
    const red2 = w2.get().patRed.filter((r) => !r.turn);
    check("14. a red hop Upload's router DOES route passes (it is not a blocker), and the verdict is kept: the next punch "
          + "of the same hop over the same model asks nothing",
          () => red2.length === 1 && red2[0].upload === true && w2.punchRefusal() === null && !w2.punchBlockers().length
                && asked1 === 1 && w2.HOOK.asked === 1,
          () => red2.map((r) => r.run + ":" + r.upload).join(",") + "; legPath asked " + asked1 + " then " + w2.HOOK.asked);
    const w3 = makeWorld({ features: [LAND()], hop: true, ready: true });
    let release = null, during = null;
    w3.HOOK.planOffThread = (job, here) => new Promise((res) => { during = w3.punchRefusal(); release = () => res(job.op === "hops" ? job.args.pairs.map(() => false) : here()); });
    const p15 = w3.punchNow();
    await until(() => release, 5000);
    release();
    await p15;
    check("15. while the router is being asked, Add to plan waits and says so ('checking ... against Upload's router')",
          () => during && /^checking 1 red hop\(s\) against Upload's router$/.test(during.short)
                && w3.get().patRed.filter((r) => !r.turn)[0].upload === false,
          () => during ? during.short : "never asked");
    const w4 = makeWorld({ features: [LAND()], hop: true, ready: true });
    let rel4 = null;
    w4.HOOK.planOffThread = (job) => new Promise((res) => { rel4 = () => res(job.args.pairs.map(() => false)); });
    const p16 = w4.punchNow();
    await until(() => rel4, 5000);
    const fresh = w4.get().patRed.map((r) => ({...r, upload: undefined}));
    w4.setRed(fresh, true);                              // a newer punch rebuilt the joins while the router answered
    rel4();
    await p16;
    check("16. an answer about joins a newer punch has replaced never lands on the new ones (they are asked again)",
          () => w4.get().patRed === fresh && fresh.every((r) => r.upload === undefined),
          () => fresh.map((r) => String(r.upload)).join(","));
  }

  // ── 17-20. THE STOP RULES ──────────────────────────────────────────────────────────────────────────────────────────
  {
    // the hop between two cells cannot be cleared by striking: a strike beside it only moves it
    const w = makeWorld({ features: [LAND()], hop: true, ready: true });
    w.HOOK.legPath = () => null;
    await safely(() => w.punchOutPressed());
    const g = w.get();
    const n17 = w.log.client.filter((x) => x.k === "clear_strike").length;
    check("17. THE CAP: it strikes, and stops at the coverage cap (2%) rather than strike on - its strike kept, the row "
          + "saying so and offering Keep clearing; a note says it stopped",
          () => g.clr.phase === "capped" && n17 === 1 && w.activeStruck().length === 1
                && /^Stopped at the cap: 1 line\(s\) struck, .* of coverage - the most it strikes before asking/.test(rowTxt(w))
                && w.$("#sp_clear")._btn.textContent === "Keep clearing"
                && w.log.notes.some((n) => /^Clearing blocked lines stopped: 1 line\(s\) struck/.test(n)),
          () => g.clr.phase + ", " + n17 + " strike(s); row: " + rowTxt(w));
    const w2 = makeWorld({ features: [LAND()], hop: true, ready: true });
    w2.HOOK.legPath = () => null;
    await safely(() => w2.punchNow());
    w2.punchHold = null;
    const run2 = w2.startClearing("the operator");
    w2.clr.capFrac = 1; w2.clr.capN = 99;               // the cap out of the way: the no-progress rule alone
    await run2;
    const n18 = w2.log.client.filter((x) => x.k === "clear_strike").length;
    check("18. NO PROGRESS: with the cap out of the way it stops after " + 4 + " strikes in a row that did not reduce the "
          + "blocked joins, saying so - the strikes kept for Put them back",
          () => w2.clr.phase === "stopped" && n18 === 4 && w2.activeStruck().length === 4
                && /^Stopped: 4 strikes in a row did not reduce the blocked joins\. 4 line\(s\) struck so far, 1 join\(s\) still blocked\./.test(rowTxt(w2)),
          () => w2.clr.phase + ", " + n18 + " strikes; row: " + rowTxt(w2));
    const w3 = makeWorld({ features: [LAND()], hop: true, ready: true });
    w3.HOOK.legPath = () => null;
    await safely(() => w3.punchNow());
    const run3 = w3.startClearing("the operator");
    await sleep(100);                                    // inside the flash before the first strike
    const btn = w3.$("#sp_clear")._btn;
    const label = btn.textContent;
    btn.onclick();                                       // the row's Stop
    await run3; await sleep(1200);
    check("19. STOP, pressed while the first strike is being shown: nothing is struck, after it or ever",
          () => label === "Stop" && w3.clr.phase === "stopped" && w3.activeStruck().length === 0
                && !w3.log.client.some((x) => x.k === "clear_strike")
                && /^Stopped: you pressed Stop\./.test(rowTxt(w3)),
          () => label + " -> " + w3.clr.phase + ", struck " + w3.activeStruck().length + "; row " + rowTxt(w3));
    const w4 = makeWorld({ features: [LAND()], hop: true, ready: true });
    w4.HOOK.legPath = () => null;
    await safely(() => w4.punchNow());
    const run4 = w4.startClearing("the operator");
    await sleep(100);
    w4.setPat(at(0, 0), at(45, 2900), at(10, 0));       // the operator reshapes the pattern
    await run4;
    check("20. THE PATTERN CHANGING under a clearing stops it, saying why - the PATTERN, by name (strikeKeyChange) - with "
          + "nothing struck on the old one",
          () => w4.clr.phase === "stopped" && /^Stopped: the pattern was changed\.$/.test(w4.clr.say)
                && !w4.log.client.some((x) => x.k === "clear_strike"),
          () => w4.clr.phase + ": " + w4.clr.say);
  }

  // ── 21-22. THE DRY RUN OF UPLOAD ───────────────────────────────────────────────────────────────────────────────────
  {
    const w = makeWorld({ ready: true });
    await safely(() => w.punchNow());                    // the FINGER punch: five runs, joins 0, 1, 3 turned, 2 red
    const own = w.patternWaypoints();
    w.mission.waypoints.push({lat: at(-200, 0).lat, lon: at(-200, 0).lon});   // a free waypoint before the survey
    w.asv = at(-300, 0);
    const wpsSeen = [];
    // Upload's router refuses: the approach, the leg into this survey, and the leg into run 2's start (join 0 -> 1)
    const run2Start = own.wps.find((p, i) => own.pairOf[i] === 0 && !p.turn);
    w.HOOK.planOffThread = async (job) => {
      const wps = job.args.wps; wpsSeen.push(wps.length);
      const first = wps.findIndex((p) => p.sv === "S?");
      return {route: wps, unroutable: [[job.args.start, wps[0]], [wps[first - 1], wps[first]],
                                       [wps[first + 2], wps.find((p) => p.lat === run2Start.lat && p.lon === run2Start.lon)]]};
    };
    const d = await w.uploadDryRun();
    check("21. the dry run of Upload routes the WHOLE plan as it would stand (what was there, then this survey), and maps "
          + "each leg it refuses to this punch's join or to outside: the approach, the leg into the survey",
          () => d.unchecked === null && JSON.stringify(d.inside) === "[0]" && d.line === 0
                && d.outside.length === 2 && d.outside[0] === "the approach from the boat"
                && d.outside[1] === "the leg into this survey" && wpsSeen[0] === own.wps.length + 1,
          () => JSON.stringify(d) + "; routed " + wpsSeen[0] + " waypoints");
    // 22: a join the punch DID route that Upload's route refuses goes back to the strikes - then the route is clean
    const w2 = makeWorld({ ready: true });
    await safely(() => w2.punchNow());
    w2.asv = at(-300, 0);
    let calls = 0;
    w2.HOOK.planOffThread = async (job, here) => {
      if (job.op !== "route") return here();
      calls++;
      const wps = job.args.wps;
      if (calls > 1) return {route: wps, unroutable: []};
      // refuse the leg into run 2's start: join 0-1 (runs 1 and 2), which the punch turned
      const i = wps.findIndex((p, k) => k > 0 && !p.turn && wps[k - 1].turn);
      return {route: wps, unroutable: [[wps[i - 1], wps[i]]]};
    };
    w2.punchHold = null;
    const run22 = w2.startClearing("the operator");
    w2.clr.capFrac = 1;                                  // a 200 m run is 20% of this toy survey: the cap is 17's subject
    await safely(() => run22);
    const st = w2.log.client.filter((x) => x.k === "clear_strike").map((x) => x.d.run);
    check("22. a join Upload's route refuses that the punch HAD found a way round goes back to the strikes, and the "
          + "clearing ends ready only once Upload's route of the plan is clean",
          () => w2.clr.phase === "ready" && w2.log.client.some((x) => x.k === "clear_dry_refused")
                && st.length === 2 && st[0] === 3 && (st[1] === 1 || st[1] === 2) && calls === 2
                && /Add to plan and Upload are not blocked/.test(w2.clr.say),
          () => w2.clr.phase + "; strikes " + st.join(",") + "; route asked " + calls + "; " + w2.clr.say);
  }

  // ── 23. THE ROUTE WORKER'S "hops" ─────────────────────────────────────────────────────────────────────────────────
  {
    const w = makeWorld({ features: [ISLAND()] });
    const ko = w.model();
    // round the island (routed), out of its middle (no way), and a straight leg in open water - in that order
    const pairs = [[at(-300, 0), at(300, 0)], [at(0, 0), at(300, 0)], [at(-300, 0), at(-300, 50)]];
    const want = pairs.map(([a, b]) => !!PS.legPath(a, b, FRAME, ko, 3));
    const r = RJ.routeReply({id: 1, op: "hops", args: {pairs}, ko: {id: 7, n: RJ.koCount(ko)}, models: [{id: 7, ko}], keep: [],
                             state: {V: {}, nogo: {ready: true, buffer: 3, bbox: null, unread: null, ais: null},
                                     frameRef: O, laneUsed: false, lanePartial: false}});
    check("23. the route worker answers a 'hops' job with legPath's own verdict for each pair, in order - the question "
          + "Upload's routePlan puts to a leg between a plan's waypoints",
          () => r.ok === true && JSON.stringify(r.out) === JSON.stringify(want) && JSON.stringify(want) === "[true,false,true]",
          () => JSON.stringify(r.ok ? r.out : r.error) + " vs legPath " + JSON.stringify(want));
    // 23b (review 2026-11-06): a READ BOX 200 m either side of the line - the way round the island goes past it, the
    // straight leg stays more than CHART_EDGE_M inside
    const box = {W: at(-1000, 0).lon, E: at(1000, 0).lon, S: at(0, -200).lat, N: at(0, 200).lat};
    const r2 = RJ.routeReply({id: 2, op: "hops", args: {pairs}, ko: {id: 8, n: RJ.koCount(ko)}, models: [{id: 8, ko}], keep: [],
                              state: {V: {}, nogo: {ready: true, buffer: 3, bbox: box, unread: null, ais: null},
                                      frameRef: O, laneUsed: false, lanePartial: false}});
    S.nogo.bbox = null;                                    // the worker side here IS this process's nogo
    const round = PS.legPath(pairs[0][0], pairs[0][1], FRAME, ko, 3) || [];
    const reach = Math.max(...round.map((p) => Math.abs(FRAME.toEN(p).n)));
    check("23b. ... and a way round that LEAVES THE CHART AS READ answers null, not true - left to Upload, which reads the "
          + "chart wider before it routes - while no way at all, and a way that stays inside, answer as before",
          () => r2.ok === true && JSON.stringify(r2.out) === "[null,false,true]" && reach > 200,
          () => JSON.stringify(r2.ok ? r2.out : r2.error) + "; the way round reaches " + reach.toFixed(0) + " m off the line");
  }

  // ── 24-26. WIRING ─────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const keyH = H.slice(H.indexOf('window.addEventListener("keydown", e=>{'), H.indexOf('if(e.key !== "Escape") return;'));
    const onState = grab("onState");
    const up = grab("doUpload");
    const cm = grab("commitPattern");
    check("24. wired: Punch Out takes the hold and clears (punchOutPressed); a strike by hand, Put them back and Add to "
          + "plan stop a clearing first (Put them back forgetting its count too); every frame samples the standoff and "
          + "watches a finished clearing, right after the level is applied; Upload's refusal names Unblock, whose row "
          + "button Punch Outs the survey; Update tells the Unblock offer its survey is done",
          () => /\$\("#sp_punch"\)\.onclick = \(\) => \{ punchOutPressed\(\); \};/.test(H)
                && /if\(patSel\) stopClearingFor\("you struck a line by hand"\);\s*\n\s*if\(patSel && strikeSelectedRun\(\)\)/.test(keyH)
                && /b\.onclick = \(\)=>\{ stopClearingFor\("you put the struck runs back"\); if\(restoreStruckRuns\(\)\)\{ forgetClearingStrikes\(\); render\(\); \} \};/.test(H)
                && /const sp = currentPattern\(\); if\(!sp\) return;\s*\n[^\n]*\n\s*stopClearingFor\("you pressed Add to plan"\);/.test(cm)
                && /replaceSurvey\(mission, sv, nl, nw\);\s*\n[^\n]*\n\s*noteSurveyUpdated\(sv\);/.test(cm)
                && /applyWaterOffset\(water\);\s*\n\s*clearingTick\(\);/.test(onState)
                && /surveysUploadBlocked\(\)/.test(up) && /Unblock on/.test(up)
                && /else if\(act === "unblock"\) unblockSurvey\(id\)/.test(H));
    const w = makeWorld();
    await safely(() => w.punchNow());
    const run = w.startClearing("the operator");
    const b1 = w.$("#sp_clear")._btn;
    w.renderClearRow(); w.renderClearRow();
    const same = w.$("#sp_clear")._btn === b1 && w.$("#sp_clear").children.length === 2;
    await run;
    check("25. the row keeps ONE button for its life - a Stop rebuilt between mouse-down and mouse-up is a click lost - "
          + "and when there is nothing to press it is hidden, not left live",
          () => same && w.clr.phase === "ready" && w.$("#sp_clear")._btn === b1 && b1.style.display === "none"
                && b1.onclick === null,
          () => "same element " + same + "; after: " + w.clr.phase + ", display " + b1.style.display);
    // 26. runNear names a TRIMMED run by its identity midpoint (patCoverMid), which every matcher reads
    // eslint-disable-next-line no-new-func
    const R = new Function("G", "\"use strict\";\n"
      + "const {azTo, distTo, atDA} = G; const NO_LEAD = {in: 0, out: 0};\n"
      + "const A = G.planeFrame({lat: 43, lon: -70}); const P = (x, y) => A.fromEN(x, y);\n"
      + "let patClip = [[P(0, 0), P(0, 200)], [P(10, 200), P(10, 0)]], patLead = [], patTrim = [{in: 0, out: 40}, null];\n"
      + "const center = {lat: 43, lon: -70}, zoom = 20; const currentPattern = () => ({spacing: 10});\n"
      + "const originPx = () => ({x: 0, y: 0}); const worldPx = (lat, lon) => ({x: lon * 4e5, y: -lat * 4e5});\n"
      + "const distPtSegPx = G.distPtSegPx;\n"
      + grab("runMid") + "\n" + grab("patCoverSeg") + "\n" + grab("patIdentSeg") + "\n" + grab("patCoverMid") + "\n"
      + grab("runNear") + "\n"
      // a click ON run 1, half way up its drawn (trimmed) line
      + "const s = worldPx(P(0, 80).lat, P(0, 80).lon); const hit = runNear(s.x, s.y, 8);\n"
      + "return {hit, mid: patCoverMid(0), distTo};")(G);
    check("26. a click on a run whose end the turn-water trim pulled back selects it by the midpoint every matcher reads "
          + "(the trim put back) - so the readout keeps the selection and Delete strikes it",
          () => R.hit && R.distTo(R.hit, R.mid) < 1 && Math.abs(R.hit.length - 200) < 1,
          () => R.hit ? "selected " + R.distTo(R.hit, R.mid).toFixed(1) + " m from patCoverMid, length "
                        + R.hit.length.toFixed(0) + " m" : "nothing selected");
  }

  // ── 27-34. WHAT THE FIRST MUTATION RUN FOUND UNGUARDED ────────────────────────────────────────────────────────────
  {
    // 27. the strike-count cap on its own (17 is the coverage cap): an unclearable hop, the coverage cap out of the way
    const w = makeWorld({ features: [LAND()], hop: true, ready: true });
    w.HOOK.legPath = () => null;
    await safely(() => w.punchNow());
    const r27 = w.startClearing("the operator");
    w.clr.capFrac = 1; w.clr.capN = 2;
    await r27;
    const n27 = w.log.client.filter((x) => x.k === "clear_strike").length;
    check("27. THE STRIKE CAP: with the coverage cap out of the way it stops at the strike cap (here 2), before the "
          + "no-progress rule's 4, saying so",
          () => w.clr.phase === "capped" && n27 === 2 && /^Stopped at the cap: 2 line\(s\) struck/.test(rowTxt(w)),
          () => w.clr.phase + ", " + n27 + " strikes; row " + rowTxt(w));

    // 28. a re-cut is a new picture: the progress count starts again from it
    const w2 = makeWorld({ features: [LAND()], hop: true, ready: true });
    w2.HOOK.legPath = () => null;
    await safely(() => w2.punchNow());
    w2.punchHold = null;
    const r28 = w2.startClearing("the operator");
    w2.clr.capFrac = 1; w2.clr.capN = 99;
    const shown3 = await until(() => w2.clr.strikes.length === 2 && w2.clr.target, 20000);
    w2.water(0.15);                                       // past TIDE_REBUILD_M while strike 3 is shown: a re-cut
    await r28;
    S.sea.waterOffset = 0;
    const n28 = w2.log.client.filter((x) => x.k === "clear_strike").length;
    check("28. A RE-CUT STARTS THE COUNT AGAIN: the water moving past the hold while strike 3 is shown re-cuts the runs, and "
          + "the no-progress rule counts its 4 from the new cut - so it strikes on past 4 (where 18 stops), empties the "
          + "cell and ends with nothing blocked after 5",
          () => shown3 && w2.clr.phase === "ready" && n28 === 5 && !/did not reduce/.test(w2.clr.say),
          () => "shown " + !!shown3 + "; " + w2.clr.phase + ", " + n28 + " strikes: " + w2.clr.say);

    // 29. the operator taking the pattern over (a strike by hand) stops a running clearing, before it strikes
    const w3 = makeWorld({ features: [LAND()], hop: true, ready: true });
    w3.HOOK.legPath = () => null;
    await safely(() => w3.punchNow());
    const r29 = w3.startClearing("the operator");
    await until(() => w3.clr.target, 5000);
    w3.stopClearingFor("you struck a line by hand");
    await r29; await sleep(900);
    check("29. a strike BY HAND while a run is being shown stops the clearing, saying why, and the clearing strikes nothing",
          () => w3.clr.phase === "stopped" && /^Stopped: you struck a line by hand\./.test(w3.clr.say)
                && !w3.log.client.some((x) => x.k === "clear_strike"),
          () => w3.clr.phase + ": " + w3.clr.say);

    // 30. the punch re-cut at a raised hold while the run is shown: the run on the card is no longer the one judged
    const w4 = makeWorld();
    await safely(() => w4.punchNow());
    const r30 = w4.startClearing("the operator");
    await until(() => w4.clr.target, 5000);
    const t30 = Date.now();
    w4.punchHold.bufM = 5.7;                              // a re-punch elsewhere raised the hold (12b: no red at 5.7 m)
    await safely(() => w4.punchOut(w4.punchCutNow()));
    const ms30 = Date.now() - t30;
    await r30;
    const n30 = w4.log.client.filter((x) => x.k === "clear_strike").length;
    check("30. THE PUNCH CHANGING UNDER THE FLASH: re-cut while run 3 is shown, the run is judged again on the new cut - "
          + "where nothing blocks - and nothing is struck (not a strike of a midpoint the new runs do not have)",
          () => ms30 < 600 && w4.clr.phase === "ready" && n30 === 0 && w4.activeStruck().length === 0,
          () => "re-cut in " + ms30 + " ms; " + w4.clr.phase + ", " + n30 + " strike(s), " + w4.activeStruck().length
                + " held; " + w4.clr.say);

    // 31. Upload's route refusing one join a round, five rounds: each is cleared by its strike, so it is never "no progress"
    const w5 = makeWorld({ features: [LAND()], ready: true });   // the land a kilometer off: a chart, nothing in the way
    w5.setPat(at(0, 0), at(75, 200), at(10, 0));          // eight lines in open water: nothing red
    await safely(() => w5.punchNow());
    w5.asv = at(-300, 0);
    let rounds = 0;
    w5.HOOK.planOffThread = async (job, here) => {
      if (job.op !== "route") return here();
      const wps = job.args.wps;
      if (++rounds > 5) return {route: wps, unroutable: []};
      const i = wps.findIndex((p, k) => k > 0 && !p.turn && wps[k - 1].turn);    // the leg into the second run
      return {route: wps, unroutable: i > 0 ? [[wps[i - 1], wps[i]]] : []};
    };
    const r31 = w5.startClearing("the water or the current moved past the hold", {recheck: true});
    w5.clr.capFrac = 1; w5.clr.capN = 99;
    await safely(() => r31);
    const n31 = w5.log.client.filter((x) => x.k === "clear_strike").length;
    check("31. Upload's route refusing a NEW join each round, five rounds, each cleared by one strike, is progress every "
          + "time: it ends ready after 5 strikes - never 'no progress' (each dry run's new blockers start the count again)",
          () => w5.clr.phase === "ready" && n31 === 5 && rounds === 6,
          () => w5.clr.phase + ", " + n31 + " strikes, " + rounds + " routes: " + w5.clr.say);

    // 32. done, with Upload's route still refusing a leg OUTSIDE this survey: the banner says Upload is still blocked
    const w6 = makeWorld({ ready: true });
    await safely(() => w6.punchNow());
    w6.asv = at(-300, 0);
    w6.HOOK.planOffThread = async (job, here) => job.op !== "route" ? here()
      : {route: job.args.wps, unroutable: [[job.args.start, job.args.wps[0]]]};
    const r32 = w6.startClearing("the operator");
    w6.clr.capFrac = 1;
    await safely(() => r32);
    const b32 = w6.log.banners[w6.log.banners.length - 1] || "";
    check("32. done with Upload's route still refusing the APPROACH (outside the survey): Add to plan is not blocked, but "
          + "the banner says Upload WOULD STILL BE BLOCKED, by what, and that striking lines cannot fix it",
          () => w6.clr.phase === "ready" && /Add to plan is not blocked, but Upload WOULD STILL BE BLOCKED by 1 leg\(s\) outside it \(the approach from the boat\) - striking lines cannot fix those; reposition the boat or edit the plan\./.test(b32)
                && !/Add to plan and Upload are not blocked/.test(b32),
          () => w6.clr.phase + ": " + b32);

    // 33. every frame samples the margin: a gust a frame saw is what the hold is taken at
    const w7 = makeWorld({ status: { env_set_deg: 90, env_set_kn: 0.4 } });
    w7.clearingTick();
    w7.SRV.status.env_set_kn = 0;
    const h33 = w7.takePunchHold().bufM;
    const live33 = GU.guardStandoffM(3, 0.4 * 0.514444);
    check("33. THE FRAME SAMPLES THE MARGIN: a set a frame (clearingTick) saw a moment ago is in the window the hold is "
          + "taken from - the hold is that gust's standoff rounded up, not the slack of now",
          () => h33 >= live33 - 1e-9 && h33 > 3,
          () => "hold " + h33 + " vs the frame's " + live33.toFixed(2));

    // 34. the row is hidden once there is nothing to say: a finished clearing gone with its pattern
    const w8 = makeWorld();
    await safely(() => w8.punchOutPressed());
    const shown34 = rowTxt(w8) !== "";
    w8.endClearing(null);
    check("34. the row HIDES once there is nothing to say (the clearing gone with its pattern, nothing blocked): not "
          + "left up with a finished clearing's words",
          () => shown34 && w8.$("#sp_clear").style.display === "none",
          () => "shown " + shown34 + ", then display " + JSON.stringify(w8.$("#sp_clear").style.display) + ": " + rowTxt(w8));

    // 35. Punch Out with nothing blocking: the hold goes at once, and the punch is an ordinary one
    const w9 = makeWorld({ features: [LAND()], ready: true });
    w9.setPat(at(0, 0), at(75, 200), at(10, 0));
    const p35 = await safely(() => w9.punchOutPressed());
    const g35 = w9.get();
    const held35 = !!g35.punchHold, cutHeld35 = !!(g35.patFunnel && g35.patFunnel.cut && g35.patFunnel.cut.held);
    const next35 = w9.punchCutNow();
    w9.water(0.05);                                       // under TIDE_REBUILD_M: an ordinary punch is still dropped
    const dropped35 = w9.get().patClip === null && !!w9.get().patDropped;
    S.sea.waterOffset = 0;
    check("35. Punch Out with NOTHING blocking releases the hold at once: no clearing, no hold, the next punch cut at the "
          + "live inputs, and a water move drops it as it always did",
          () => !p35.err && !kinds(w9).includes("clear_start") && g35.patClip && !held35 && !cutHeld35 && next35 === null
                && dropped35,
          () => (p35.err ? "threw " + p35.err.message + "; " : "") + "hold " + held35 + ", cut held " + cutHeld35
                + ", next cut " + JSON.stringify(next35) + ", dropped " + dropped35 + "; log " + kinds(w9).join(","));
  }

  // ── 36-48. WHAT THE REVIEW FOUND (2026-11-06) ─────────────────────────────────────────────────────────────────────
  const starts = (w) => kinds(w).filter((k) => k === "clear_start").length;
  // the FIRST hops job held until the check lets it go (every later one, and every other job, answered at once: no route)
  const holdHops = (w) => { const h = {rel: null, n: 0}; w.HOOK.planOffThread = (job, here) => job.op !== "hops" ? Promise.resolve(here())
    : h.n++ ? Promise.resolve(job.args.pairs.map(() => false))
    : new Promise((res) => { h.rel = () => res(job.args.pairs.map(() => false)); }); return h; };
  {
    // 36. the words for a key that changed: each field group by name
    const w = makeWorld();
    const k = w.patStrikeKey(), f = k.split("|");
    const alt = (...ix) => { const g = f.slice(); for (const i of ix) g[i] += "x"; return g.join("|"); };
    const say = (...ix) => w.strikeKeyChange(k, alt(...ix));
    const theirs = / - the runs are cut anew and the strikes made on the old cut no longer apply$/;
    check("36. a clearing stopped by the key changing NAMES what changed - the pattern, a chart read, the buffer, the chart "
          + "image, an enforce box, the depth window - and a read the operator did not make says his strikes no longer apply",
          () => f.length === 13 && say(0) === "the pattern was changed" && say(4) === "the pattern was changed"
                && /^the chart was read again/.test(say(5)) && theirs.test(say(5))
                && say(6) === "the chart was read again - the runs are cut anew and the strikes made on the old cut no longer apply"
                && say(7) === "the buffer was changed" && /^the chart image was read again/.test(say(8)) && theirs.test(say(9))
                && say(10) === "an enforce box was changed" && say(11) === "the depth window was changed"
                && say(12) === "the depth window was changed" && say(0, 5) === "the pattern was changed and the chart was read again"
                && w.strikeKeyChange(k, null) === "the pattern was cleared"
                && w.strikeKeyChange(k, "a|b") === "the pattern or its settings changed",
          () => f.length + " fields: " + [0, 5, 7, 8, 10, 11].map((i) => say(i)).join(" / "));
  }
  {
    // 37. a FINISHED clearing is stopped by the operator taking over, and the next frame does not clear again
    const w = makeWorld();
    await safely(() => w.punchOutPressed());
    const ready = w.clr.phase === "ready";
    w.stopClearingFor("you struck a line by hand");
    const st = w.clr.phase, say = w.clr.say, n0 = starts(w);
    w.water(0.15); w.clearingTick(); await sleep(300);
    S.sea.waterOffset = 0;
    check("37. a FINISHED clearing is stopped by the operator taking over too (a strike by hand, Put them back): the next "
          + "frame past the hold does not clear it again - it would strike again the very runs he had put back",
          () => ready && st === "stopped" && /^Stopped: you struck a line by hand\.$/.test(say) && starts(w) === n0
                && w.clr.phase === "stopped",
          () => (ready ? "ready" : "never ready") + " -> " + st + " (" + say + "); then " + w.clr.phase + ", "
                + (starts(w) - n0) + " new start(s)");
  }
  {
    // 38. a stopped row counts what stands NOW; Put them back forgets the clearing's own count
    const w = makeWorld({ features: [LAND()], hop: true, ready: true });
    w.HOOK.legPath = () => null;
    await safely(() => w.punchNow());
    const r = w.startClearing("the operator");
    w.clr.capFrac = 1; w.clr.capN = 99;
    await r;
    const row1 = rowTxt(w);
    w.get().patStruck.splice(0, 2);                      // two of the four struck are back
    w.renderClearRow();
    const row2 = rowTxt(w);
    w.forgetClearingStrikes();
    check("38. a stopped clearing's row counts the lines struck NOW, not at the stop (two put back: 4 becomes 2), and Put "
          + "them back starts the clearing's own count and lost coverage again from none - the cap is not reached early",
          () => /4 line\(s\) struck so far, 1 join\(s\) still blocked\./.test(row1)
                && /2 line\(s\) struck so far/.test(row2) && w.clr.strikes.length === 0 && w.clr.lostM === 0,
          () => row1.slice(0, 120) + " | then: " + (row2.match(/\d+ line\(s\) struck so far/) || ["?"])[0]
                + "; count " + w.clr.strikes.length + ", lost " + w.clr.lostM);
    // 38b. the banner counts the lines struck in all when a strike by hand came before the clearing's
    const w2 = makeWorld();
    await safely(() => w2.punchNow());
    const m = w2.patCoverMid(0);
    w2.setSel({lat: m.lat, lon: m.lon, length: w2.patCoverLenM(0)});
    const handOk = w2.strikeSelectedRun();
    await safely(() => w2.flushRepunch());
    await safely(() => w2.startClearing("the operator", {}));
    w2.clr.capFrac = 1;
    await until(() => w2.clr.phase !== "running" && w2.clr.phase !== "checking", 15000);
    const b38 = w2.log.banners[w2.log.banners.length - 1] || "";
    check("38b. ... and done, the banner says how many are struck IN ALL when the operator struck some by hand first",
          () => handOk && w2.clr.phase === "ready" && /^Cleared: 1 line\(s\) struck \([^)]*\) - 2 struck in all\. /.test(b38),
          () => "hand strike " + handOk + "; " + w2.clr.phase + ": " + b38.slice(0, 140));
  }
  {
    // 39. while Punch Out's own punch runs: "punching", the row hidden, no clearing started under it
    const w = makeWorld({ features: [LAND()], hop: true, ready: true });
    const h = holdHops(w);
    const p = w.punchOutPressed();
    await until(() => h.rel, 5000);
    const ph = w.clr.phase, hidden = w.$("#sp_clear").style.display === "none";
    const under = await w.startClearing("the operator", {recheck: true});
    h.rel(); await safely(() => p);
    const first = w.log.client.find((x) => x.k === "clear_start");
    check("39. while Punch Out's own punch runs the clearing is 'punching': its row hidden (nothing on the card is the "
          + "punch it will judge), no clearing starts under it - and once the punch is in, the clearing starts on it",
          () => ph === "punching" && hidden && under === false && first && first.d.why === "Punch Out" && starts(w) === 1,
          () => "phase " + ph + ", hidden " + hidden + ", start under it " + under + "; then " + kinds(w).join(","));
    const w2 = makeWorld({ features: [LAND()], hop: true, ready: true });
    const h2 = holdHops(w2);
    const p2 = w2.punchOutPressed();
    await until(() => h2.rel, 5000);
    w2.endClearing(null);                                // the pattern went, or a fresh Punch Out, while it ran
    h2.rel(); await safely(() => p2); await sleep(200);
    check("39b. ... and anything that ends or starts a clearing while that punch runs makes what follows it not Punch "
          + "Out's to do: no clearing is started on its own",
          () => !kinds(w2).includes("clear_start") && w2.clr.phase === "idle",
          () => w2.clr.phase + "; log " + kinds(w2).join(","));
    // 39c. the row the moment Punch Out is pressed over a punch that has a blocker: the OLD punch's offer must go
    const w3 = makeWorld();
    await safely(() => w3.punchNow());                   // the finger punch: one red turn, so the row offers to clear it
    const before = rowTxt(w3), btnBefore = w3.$("#sp_clear")._btn.textContent;
    const p3 = w3.punchOutPressed();                     // ... and Punch Out pressed again: up to its own punch's await
    const during = rowTxt(w3), shown = w3.$("#sp_clear").style.display !== "none";
    await safely(() => p3);
    check("39c. Punch Out pressed over a punch the row offers to clear hides that offer at once - 'Clear blocked lines' "
          + "on the old punch is not left pressable under the new one",
          () => /^1 join\(s\) block Add to plan or Upload\./.test(before) && btnBefore === "Clear blocked lines"
                && !shown && during === "",
          () => "before: " + before + " [" + btnBefore + "]; during: " + (shown ? during : "hidden"));
  }
  {
    // 40. Upload's answer about a punch REPLACED while it ran is not taken for the new one
    const w = makeWorld({ ready: true });
    w.asv = at(-300, 0);
    let routes = 0, relR = null;
    w.HOOK.planOffThread = (job, here) => {
      if (job.op === "hops") return Promise.resolve(job.args.pairs.map(() => true));
      if (job.op !== "route") return Promise.resolve(here());
      routes++;
      if (routes === 1) return new Promise((res) => { relR = () => res({route: job.args.wps, unroutable: []}); });
      return Promise.resolve({route: job.args.wps, unroutable: []});
    };
    const p = w.punchOutPressed();
    await until(() => relR, 15000);
    const asked = w.get().patClip;
    await safely(() => w.punchOut(w.punchCutNow()));    // a re-punch under the same key while Upload's route ran
    const now = w.get().patClip;
    relR(); await safely(() => p);
    check("40. an answer from Upload's route about a punch REPLACED under the same pattern and settings (a speed change, "
          + "the other window) is not taken for the new one: it is judged and checked again, and ready on that one",
          () => asked && now && now !== asked && routes === 2 && w.clr.phase === "ready" && w.clr.verdictClip === w.get().patClip,
          () => "replaced " + (now !== asked) + "; route asked " + routes + "; " + w.clr.phase);
    const w2 = makeWorld({ ready: true });
    w2.asv = at(-300, 0);
    let relS = null;
    w2.HOOK.planOffThread = (job, here) => job.op === "route"
      ? new Promise((res) => { relS = () => res({route: job.args.wps, unroutable: []}); })
      : Promise.resolve(job.op === "hops" ? job.args.pairs.map(() => true) : here());
    const p2 = w2.punchOutPressed();
    await until(() => relS, 15000);
    w2.setPat(at(0, 0), at(45, 210), at(10, 0));         // the pattern changed while Upload's route was checked
    relS(); await safely(() => p2);
    check("40b. ... and a pattern CHANGED while it ran stops the clearing, naming the change",
          () => w2.clr.phase === "stopped" && /^Stopped: the pattern was changed\.$/.test(w2.clr.say),
          () => w2.clr.phase + ": " + w2.clr.say);
  }
  {
    // 41. Clear again with nothing blocked still runs the check of Upload's route
    const w = makeWorld();
    await safely(() => w.punchOutPressed());
    w.stopClearingFor("you put the struck runs back");
    const btn = w.$("#sp_clear")._btn, label = btn.textContent, n0 = starts(w);
    await safely(() => btn.onclick());
    check("41. 'Clear again' with nothing blocked still clears - it checks Upload's route and says so - not a button "
          + "that does nothing",
          () => label === "Clear again" && starts(w) === n0 + 1 && w.clr.phase === "ready",
          () => label + " -> " + (starts(w) - n0) + " start(s), " + w.clr.phase);
  }
  {
    // 42. Unblock: a survey already on the card is not loaded again; it clears with nothing red
    const open = () => { const w = makeWorld({ features: [LAND()], ready: true }); w.setPat(at(0, 0), at(75, 200), at(10, 0)); return w; };
    const w = open();
    w.editingSv = "S1";
    await safely(() => w.unblockSurvey("S1"));
    const st = w.log.client.find((x) => x.k === "clear_start");
    check("42. Unblock on the survey ALREADY on the card does not load it again (✎ resets the card, and every strike on "
          + "it) - and it clears with nothing red: the refusal it answers is Upload's, which only the check of its route finds",
          () => !(w.log.edits || []).length && st && st.d.why === "Unblock" && w.clr.phase === "ready",
          () => "loaded " + JSON.stringify(w.log.edits || []) + "; " + kinds(w).join(",") + "; " + w.clr.phase);
    const w2 = open();
    await safely(() => w2.unblockSurvey("S2"));
    check("42b. ... while Unblock on another survey loads it (✎) first, then the same",
          () => (w2.log.edits || []).join() === "S2" && w2.clr.phase === "ready",
          () => JSON.stringify(w2.log.edits || []) + "; " + w2.clr.phase);
  }
  {
    // 43-44. the hold goes with the pattern
    const w = makeWorld({ features: [LAND()], hop: true, ready: true });
    w.HOOK.legPath = () => null;
    await safely(() => w.punchOutPressed());
    const held = !!w.punchHold, ph = w.clr.phase;
    w.resetPattern();
    check("43. the pattern reset ends the clearing and RELEASES its hold - a hold left standing was taken up by the next "
          + "pattern's first strike by hand, cut at a margin and a level measured for another drawing",
          () => held && ph === "capped" && w.punchHold === null && w.clr.phase === "idle" && w.punchCutNow() === null,
          () => "held " + held + ", " + ph + " -> hold " + JSON.stringify(w.punchHold) + ", " + w.clr.phase);
    const w2 = makeWorld();
    await safely(() => w2.punchOutPressed());
    const cutHeld = w2.get().patFunnel.cut.held;
    w2.setPat(at(0, 0), at(45, 210), at(10, 0));
    w2.clearingTick();
    check("44. ... and so does the pattern changing under a finished clearing: the hold gone, and the punch on the card no "
          + "longer marked as cut at it",
          () => cutHeld === true && w2.punchHold === null && w2.clr.phase === "idle" && w2.get().patFunnel.cut.held === false,
          () => "cut held " + cutHeld + " -> hold " + JSON.stringify(w2.punchHold) + ", " + w2.clr.phase + ", cut held "
                + w2.get().patFunnel.cut.held);
  }
  {
    // 45. a water update that rebuilds the guard's model drops a held punch, even inside the hold's step
    const w = makeWorld();
    await safely(() => w.punchOutPressed());
    S.nogo.builtOffset = -0.05;                          // the guard's model built at another level than the hold's
    const clip0 = w.get().patClip;
    w.water(0.06);                                       // 0.06 m from the hold, 0.11 m from the model: it rebuilds
    const g = w.get(), rebuilt = Math.abs(S.nogo.builtOffset - 0.06) < 1e-9;
    S.sea.waterOffset = 0; S.nogo.builtOffset = 0;
    check("45. a water update that REBUILDS the guard's model drops a held punch even inside the hold's step: its hops and "
          + "Upload's route were judged on the model now gone",
          () => clip0 && rebuilt && g.patClip === null && /the water level moved/.test(g.patDropped || ""),
          () => "rebuilt " + rebuilt + ", clip " + (g.patClip ? "kept" : "dropped") + ": " + g.patDropped);
    // 45b. the other way round: a move past the HOLD's step that does not rebuild the model still drops it
    const w2 = makeWorld();
    await safely(() => w2.punchOutPressed());
    S.nogo.builtOffset = 0.08;                           // the model built nearer the new level than the hold is
    w2.water(0.12);                                      // 0.12 m from the hold, 0.04 m from the model: no rebuild
    const g2 = w2.get(), noRebuild = Math.abs(S.nogo.builtOffset - 0.08) < 1e-9;
    S.sea.waterOffset = 0; S.nogo.builtOffset = 0;
    check("45b. ... and a move of TIDE_REBUILD_M from the HOLD's level drops it even when the model does not rebuild",
          () => noRebuild && g2.patClip === null && /the water level moved/.test(g2.patDropped || ""),
          () => "no rebuild " + noRebuild + ", clip " + (g2.patClip ? "kept" : "dropped") + ": " + g2.patDropped);
  }
  {
    // 46. Upload refusing a leg ALONG this survey's own lines: said, and what to do
    const w = makeWorld({ ready: true });
    w.asv = at(-300, 0);
    w.HOOK.planOffThread = (job, here) => {
      if (job.op === "hops") return Promise.resolve(job.args.pairs.map(() => true));
      if (job.op !== "route") return Promise.resolve(here());
      const wps = job.args.wps, first = wps.findIndex((p) => p.sv === "S?");
      return Promise.resolve({route: wps, unroutable: [[wps[first], wps[first + 1]]]});   // run 1, start to end
    };
    await safely(() => w.punchOutPressed());
    const b46 = w.log.banners[w.log.banners.length - 1] || "";
    check("46. done with Upload's route refusing a leg ALONG one of this survey's lines: Upload WOULD STILL BE BLOCKED, "
          + "and the banner says by what and what to do - not 'a join striking a line beside has not cleared'",
          () => w.clr.phase === "ready" && /Upload WOULD STILL BE BLOCKED by 1 leg\(s\) along this survey's own lines - strike those lines by hand, or Punch Out again\./.test(b46)
                && !/join\(s\) of this survey/.test(b46),
          () => w.clr.phase + ": " + b46);
  }
  {
    // 47. the words: where the refusal sends him, a hop still being asked, the Upload refusal's Unblock, a clean finish
    const idf = grab("identifyAt"), up = grab("doUpload"), fin = grab("finishClearing");
    check("47. the words: a red hop's refusal points at the row under it; the chart's identify of a hop still being "
          + "asked says Add to plan waits; Upload's refusal offers Unblock for legs between a survey's own lines; a clean "
          + "finish says what was checked and that Upload reads the chart again",
          () => /r\.upload === "pending"\s*\n\s*\? "Upload's own router is being asked whether it can route it; Add to plan waits for the answer\."/.test(idf)
                && /the clearing row on the Survey card does it one line at a time/.test(idf)
                && /own lines: Unblock on /.test(up)
                && /"Add to plan and Upload are not blocked \(Upload's own route of the whole plan, on the chart as read now; Upload "\s*\n\s*\+ "reads the chart again before it sends\)"/.test(fin));
  }
  {
    // 48. Add to plan pressed while a clearing runs stops it first
    const w = makeWorld({ features: [LAND()], hop: true, ready: true });
    w.HOOK.legPath = () => null;
    await safely(() => w.punchNow());
    const run = w.startClearing("the operator");
    await until(() => w.clr.target, 5000);
    await safely(() => w.commitPattern());
    await run; await sleep(900);
    check("48. Add to plan pressed while a clearing runs stops it first, saying so - and nothing is struck after the press",
          () => w.clr.phase === "stopped" && /^Stopped: you pressed Add to plan\./.test(w.clr.say)
                && !kinds(w).includes("clear_strike") && !w.mission.lines.length,
          () => w.clr.phase + ": " + w.clr.say + "; " + kinds(w).join(","));
  }
  {
    // 49. the held cut is taken AFTER the chart read: a gust read while the chart was being read is in it
    const w = makeWorld({ status: { env_set_deg: 90, env_set_kn: 0 } });
    w.HOOK.ensure = async () => { w.SRV.status.env_set_kn = 0.4; w.notePunchMargin(Date.now()); await sleep(20); };
    await safely(() => w.punchOutPressed());
    const g = w.get(), cut = g.patFunnel && g.patFunnel.cut;
    // (at that margin the pier is no longer in the way - 30 - so nothing blocks and the hold is released at once; cut
    // before the read, at 3 m, the turn was red and a clearing started, only to re-cut it)
    check("49. Punch Out takes its held cut AFTER its chart read: a set that rose while the chart was read (here to 0.4 kn) "
          + "is in the cut - taken before the read, the punch was cut at the margin from before it, and said nothing",
          () => cut && cut.bufM > 4 && Math.abs(cut.setKn - 0.4) < 1e-9 && !kinds(w).includes("clear_start"),
          () => "cut " + JSON.stringify(cut) + "; log " + kinds(w).join(","));
  }
  {
    // 50. red hops go to the BACKGROUND lane, a few a message; so does the dry run of Upload
    const w = makeWorld({ ready: true });
    await safely(() => w.punchNow());
    const P2 = (x) => [at(x, 0), at(x, 50)];
    const fake = [0, 1, 2, 3, 4, 5].map((i) => { const [a, b] = P2(-400 - 10 * i); return {turn: false, run: i + 1, a, b, by: "land"}; });
    w.setRed(fake, true);
    w.HOOK.lanes = [];
    await safely(() => w.judgeRedHops());
    const hops = w.HOOK.lanes.filter((x) => x.op === "hops");
    w.asv = at(-300, 0);
    w.HOOK.lanes = [];
    await safely(() => w.uploadDryRun());
    const route = w.HOOK.lanes.filter((x) => x.op === "route");
    check("50. six red hops are put to Upload's router on the BACKGROUND lane ('est'), " + 4 + " a message - never one "
          + "long message on the command lane in front of a Go-To or an RTH - and the dry run of Upload goes there too",
          () => JSON.stringify(hops.map((x) => x.n)) === "[4,2]" && hops.every((x) => x.L === "est")
                && route.length === 1 && route[0].L === "est" && fake.every((r) => r.upload === true),
          () => "hops " + JSON.stringify(hops) + "; route " + JSON.stringify(route) + "; verdicts "
                + fake.map((r) => String(r.upload)).join(","));
  }

  __finished = true;
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
