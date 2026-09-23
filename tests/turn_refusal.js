// tests/turn_refusal.js - Add to plan is refused while the punch holds a reversal with NO FLYABLE TURN (2026-09-16).
//
// THE GAP: when every rung of turnWithRetry refused a reversal (the lead give-way included), punchOut drew the pair red
// and bannered it - and nothing else. commitPattern's resetPattern cleared the red, the committed plan kept a straight
// leg between the two line ends, and Upload's routePlan found that leg clear and sent it: a 180 at zero radius beside
// the feature that had refused the turn, the wharf class tests/clearance_guard.js exists for. It happened on Andy's own
// console the evening it was found - a 74-line Honolulu plan (10 m spacing, no lead) went up twice with 17 of its 18
// refused reversals sent as single straight legs.
//
// ANDY'S CALL, 2026-09-16, asked to choose between refusing Add to plan and carrying the red into the plan to refuse
// Upload: REFUSE ADD TO PLAN - the pattern is still live there, so every remedy is one re-punch away, whereas a committed
// red pair cannot be fixed short of CLR PLAN. A RED HOP (no route found between runs) does NOT refuse: Upload routes every
// hop again with legPath and refuses the upload itself if that fails too.
//
// AND A PUNCH THE PAGE THROWS AWAY ITSELF (checks 14-14e), found on the live check of this very change: every change
// of the water level - a station update, a few centimeters - drops the punch, and that used to be all it did. One tide
// update and one click on the chart later, the refusal had lifted and Add to plan committed the pattern UN-punched:
// 23 lines through the piers with no turns at all. The drop is recorded (patDropped) and refused like the rest.
//
// DRIVEN: the page's own punchOut, punchRefusal, commitPattern, resetPattern and updatePatReadout, over the console's
// real modules (geodesy, units, state, turns, passage, chart) and a keep-out model the REAL chart.js buildKeepouts makes
// from an ENC-shaped dock feature - so the refusal comes from the real turn ladder, not from a fixture that says so.
// Stubbed: the DOM (a fake element per selector), the ENC fetch (the features are handed in), the chart-ink fold (no
// chart image here), and the banner / note / save sinks, which record what they were given.
//
// THE WORLD: five 200 m survey lines 10 m apart, running north-south, the small-class boat's own numbers (3 kn, 60 deg/s, so a
// 2.1 m turn radius), a 3 m buffer. A FINGER PIER sits between runs 3 and 4 at the north end, reaching 15 m down past
// their ends - so the turn from run 3 to run 4 has no water on any side, outboard or inboard, at either radius, while
// every other turn is clear. Moved 100 m east, the same pattern punches clean (the acceptance case).
//
//   node tests/turn_refusal.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ASV_HTML points this at a SIDECAR copy for a mutation run - every read of the page goes through it.
//
// TEETH - 40 sidecar mutations of the page were RUN across this suite and the five beside it (identify_layer,
// clearance_guard, survey_order, strike_run, min_depth_floor). 34 aim at what this suite drives: 33 caught, none by a
// crash, 1 inert. The check numbers are the ones that went red here:
//   commitPattern ignores the refusal -> 4, 8, 9, 14      asked BEFORE the pending re-punch settles -> 9
//   a refusal never disables the button -> 3, 14          the note under the button never shown -> 3
//   the tooltip never carries the refusal -> 3            a refused reversal not recorded -> 1-4, 9-11, 13
//   ... recorded as a hop -> 1-4, 9, 11, 13               its blocker not recorded -> 1, 2
//   the red list not rebuilt on each punch -> 6           patJoined never cleared at the start of a punch -> 8
//   patJoined set before the pair loop -> 8               an unfinished punch not refused -> 8
//   not keyed on the live punch -> 10, 14-14e             red hops counted as refusals -> 7
//   a red hop's blocker not recorded -> 7, 7b             the hop banner back to "would cross the obstacle" -> 7b
//   the lead offered as a fix -> 2, 11                    the low TURN speed offered whenever not low -> 2, 12
//   ... offered when already low -> 12                    a wider spacing offered on every plan -> 2, 12
//   the channel standoff never offered -> 12              the causes lose the keep-out's name -> 2
//   the red banner drops the refusal -> 13                the summary line says "Add to plan." while refused -> 13
//   Add to plan refuses EVERY punch -> 5, 6b, 7, 10, 14b-14e (and survey_order 7)
//   THE TIDE (14-14e): the drop not recorded -> 14, 14b, 14c, 14e     no readout when it happens -> 14
//   new runs do not clear it -> 14b      Reset does not clear it -> 14c      punchRefusal ignores it -> 14, 14b, 14c, 14e
//   a drop recorded with no punch on the chart -> 14d     a no-chart re-punch leaves it behind -> 14e
//   the drag hint still offering Add to plan while the drop refuses it -> 14
// INERT, AND SAID SO: resetPattern leaving patRed / patJoined behind survives - every reader keys on patClip, which
// the same reset nulls, and the next punch rebuilds both. The clearing stays as hygiene, not as coverage.
// ⚠ TWO CHECKS PASSED FOR THE WRONG REASON ON THE FIRST SWEEP, BOTH READING STATE LATE: 13 read the whole banner log
// after check 4's refused commit had posted the same text (the punch's banner could be dropped and 13 stayed green),
// and it read the hint after other commits had reset it. Both are captured straight after the punch now. And 8's first
// cut failed its FIRST punch - a world where patJoined starts false cannot tell "cleared on every punch" from "never
// set", so it punches clean first.
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
// ⚠ A HANG MUST REPORT TOO: an await on a promise nothing resolves empties the event loop and Node exits 0 in silence,
// which a mutation runner reading stdout scores as SURVIVED (tests/plan_save.js, 2026-09-14).
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
// The run-time guard, for `guardStandoffM` - the planner/guard seam reads the GUARD's own
// constants, so this suite must hand punchOut the real module rather than a stand-in.
const GU = require("../static/js/guard.js");
const PS = require("../static/js/passage.js");
const C = require("../static/js/chart.js");

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
// A throw in scenario SETUP is not inside a check, and a crash is not a catch: run setup through this and let the
// checks read the value (or the error) it hands back.
async function safely(fn) { try { return {v: await fn()}; } catch (e) { return {err: e}; } }

// ── the world ────────────────────────────────────────────────────────────────────────────────────────────────────
const O = { lat: 21.3, lon: -157.87 };
const FRAME = G.planeFrame(O);
const at = (x, y) => FRAME.fromEN(x, y);
const xy = (p) => { const q = FRAME.toEN(p); return Math.round(q.e) + "," + Math.round(q.n); };
// A dock polygon exactly as the ENC extract hands one over: lon/lat rings, a role, no properties needed.
function dock(x0, x1, y0, y1) {
  const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => { const p = at(x, y); return [p.lon, p.lat]; });
  return { role: "dock", cls: "PONTON", props: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}
const FINGER = () => dock(24.5, 25.5, 185, 240);       // between runs 3 and 4, across their north ends
const FAR = () => dock(124.5, 125.5, 185, 240);         // the same pier, 100 m east of the pattern

const PAGE_FUNCS = ["punchOut", "currentPattern", "surveyPattern", "patSourceLines", "boundaryActive", "clipLine",
  "patStrikeKey", "activeStruck", "keptRuns", "runMid", "extendLead", "runWithLeads", "patCoverSeg", "patCoverMid",
  // patClipBufM IS THE PLANNER/GUARD SEAM (2026-09-19) and punchOut calls it twice - for the
  // clip standoff and from patClipKey. Missing from this list it is a bare ReferenceError
  // inside the punch, which surfaces as "0 runs, 0 turns built" rather than as a crash -
  // and it caught patClipKey the same way the day the strike/clip split landed.
  "patClipBufM", "patClipKey",
  "patLeadTotal", "leadMetres", "leadInM", "leadOutM", "easeLsM", "roleSpeed", "roleSpeedMS", "depthRange",
  "kindsSummary", "punchRefusal", "commitPattern", "resetPattern", "updatePatReadout", "flushRepunch", "punchNow",
  "dropStruckFromPunch", "strikeSelectedRun", "scheduleRepunch", "applyWaterOffset"];
const PAGE_DECLS = [/^const NO_LEAD = [^;]*;/m, /^const LEAD_GIVE = [^;]*;/m, /^const MAX_SURVEY_LINES = [^;]*;/m,
  /^const LEAD_MAX_M = [^;]*;/m, /^const REPUNCH_DELAY_MS = [^;]*;/m, /^const TIDE_REBUILD_M = [^;]*;/m];

function makeWorld(opts) {
  const o = opts || {};
  // A fake element per selector: what the page writes is what a check reads back.
  const els = {};
  const fakeEl = (id) => ({ id, textContent: "", value: "", disabled: false, title: "", style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; }, focus() {} });
  const $ = (s) => els[s] || (els[s] = fakeEl(s));
  const document = { activeElement: null, createElement: (t) => fakeEl(t), createTextNode: (t) => ({ textContent: t }) };
  const log = { banners: [], notes: [], saves: 0, violations: [] };
  const turnWithRetry = o.turnWithRetry ? o.turnWithRetry(T.turnWithRetry) : T.turnWithRetry;
  // eslint-disable-next-line no-new-func
  const W = new Function("G", "U", "S", "T", "PS", "C", "GU", "GEOM", "$", "document", "log", "turnWithRetry",
    "\"use strict\";\n"
    + "const {azTo, distTo, atDA, llEN, fromEN, toEN} = G; const {fmtDist, fmtDur} = U; const {V, nogo, sea} = S;\n"
    + "const {MAX_HALF_M, SKEW_LIMIT_DEG, minTurnRadiusM, shortenSeg} = T;\n"
    // ⚠ THE REVERSAL GATE MEASURES THE CROSSING (2026-09-23), so the punch calls
    // acrossTrackM. This suite RUNS punchOut, and without the symbol the call was a bare
    // ReferenceError that punchOut's OWN catch swallowed - reported as "5 runs, 0 turns
    // built", a wrong ANSWER rather than a crash. `no turns` has to be read as `something
    // threw` until proved otherwise.
    + "const {acrossTrackM} = GEOM;\n"
    + "const {channelLaneRoute, channelSpanKeepouts, channelTurnKeepouts, junctionKnot, pruneJunctionKnots,"
    + " regionOrder, routeAround} = PS;\n"
    + "const {blocked, buildKeepouts, firstBlockAlong, legReasons, effectiveWaterOffset} = C;\n"
    + PAGE_DECLS.map(decl).join("\n") + "\n"
    + "let pat = {A:null, B:null, C:null, align:0}, patDrag = null, patMoveLast = null, patClip = null, patLead = [];\n"
    + "let patUnsafe = [], patRed = [], patJoined = false, patDropped = null, patRoutes = [], patTransits = [];\n"
    + "let turnSlowAt = {};\n"
    + "let patStruck = [], patStruckKey = null, patSel = null, patClipMemo = null, patRepunchT = null;\n"
    + "let punchInFlight = null, punchBusy = false, encShow = false, boundary = [], boundaryClosed = false;\n"
    + "let planKind = null, asv = null;\n"
    + "const mission = {lines: [], waypoints: [], approach_radius_m: 1, speeds: {}, speed: 'survey'};\n"
    + "const applyNogoControls = () => {}; const ensureNogoArea = async () => true; const render = () => {};\n"
    + "const foldChartInk = () => {};             // no chart image in this world\n"
    // ⚠ AND THE CHART-READ STATE IT LEAVES BEHIND. patStrikeKey names the READ - its key
    // and its line/area counts - since 2026-09-22, so without this the key is a bare
    // ReferenceError inside the punch, which this world reports as "0 runs, 0 turns built"
    // rather than as a crash. Exactly the trap the note above patClipBufM records, and it
    // caught this the same day. Empty is the truthful value here: nothing is scanned.
    + "const chartInk = {key: null, lines: [], areas: [], detached: [], note: null, z: null, ms: 0, busy: false};\n"
    // The REAL guard bodies, not stubs: patClipBufM derives the clip standoff from the
    // guard's own constants, and a suite substituting its own would be testing a seam that
    // is closed only inside the test.
    + "const groundVel = GU.groundVel, guardStandoffM = GU.guardStandoffM;\n"
    + "const GUARD_HELM_S = GU.HELM_S;\n"
    + "const showBanner = (t) => log.banners.push(t); const flashNote = (t) => log.notes.push(t);\n"
    + "const setViolations = (r) => log.violations.push(r); const clearViolation = () => {};\n"
    + "const saveMission = () => { log.saves++; }; const recalcCommittedForSpeed = () => {};\n"
    + "const committedPatternInfo = () => null; const restoreStruckRuns = () => false;\n"
    + "const rebuildNogo = () => { nogo.builtOffset = sea.waterOffset; };   // the model's own rebuild is not under test\n"
    + PAGE_FUNCS.map(grab).join("\n")
    + "\nreturn { $, log, mission, punchOut, punchRefusal, commitPattern, updatePatReadout, resetPattern,"
    + " strikeSelectedRun, flushRepunch, patCoverMid,"
    + " get: () => ({pat, patClip, patRed, patJoined, patDropped, patTransits, patUnsafe, patRepunchT}),"
    + " water: (m) => applyWaterOffset({ok: true, offset_m: m, stations: [{dist_km: 2}]}),"
    + " setPat: (A, B, Cc) => { pat = {A, B, C: Cc, align: 0}; },"
    + " select: (m) => { patSel = m; },"
    + " clearClip: () => { patClip = null; },"
    + " setRed: (r, joined) => { patRed = r; patJoined = joined; },"
    + " pending: () => { patRepunchT = setTimeout(() => {}, 0); } };")(
    G, U, S, T, PS, C, GU, GEOM, $, document, log, turnWithRetry);
  // The vessel and the chart, as the page holds them.
  S.V.SPEED_KN = { low: 1.5, survey: 3.0, high: 6.0 };
  S.V.MAX_TURN_RATE_DEG_S = o.turnRate || 60;
  S.V.MIN_SURVEY_LINE_M = 0;
  S.V.NOGO_MIN_DEPTH_M = 1.0;
  Object.assign(S.nogo, { frame: FRAME, buffer: 3, enf: { land: true, depth: true, haz: true, area: false },
                          features: o.features || [FINGER()], band: "enc_harbor", note: "", ready: false });
  if (o.lead) { W.mission.lead_mode = "m"; W.mission.lead_in = o.lead; W.mission.lead_out = o.lead; }
  if (o.turnKey) W.mission.speeds = { turn: o.turnKey };
  W.setPat(at(0, 0), at(45, 200), at(10, 0));      // five lines, x = 0 .. 40
  return W;
}
// The remedies alone: the CAUSES may name the TURN speed (a turn the boat cannot track at it) without offering it.
const fixesOf = (r) => (r && r.text.includes("To fix: ")) ? r.text.split("To fix: ")[1].split(". Right-click")[0] : "none";
const turnsIn = (w) => w.get().patTransits.filter((t) => t && t.length).length;
const redOf = (list) => list.map((r) => (r.turn ? "TURN " : "HOP ") + r.run + "-" + (r.run + 1)
                                    + " " + r.why + (r.by ? " (" + r.by + ")" : "")).join("; ") || "none";
const redList = (w) => redOf(w.get().patRed);

(async () => {
  console.log("Add to plan and a reversal with no flyable turn:");

  // ── 1-4. THE REFUSAL, FROM A REAL PUNCH ──────────────────────────────────────────────────────────────────────────
  const red = makeWorld();
  const p1 = await safely(() => red.punchOut());
  const r1 = red.get();
  // What the PUNCH posted, before anything else can: check 4's commit posts the same refusal text, and a check that
  // read the whole log afterwards would be passed by the commit (mutation M20 walked through exactly that).
  const punchBanners = red.log.banners.slice(), punchHint = red.$("#sp_hint").textContent;
  check("1. a real punch past a finger pier: the turn from run 3 to run 4 is refused on every rung and recorded as a RED "
        + "REVERSAL with what refused it - and the other three turns are built",
        () => !p1.err && r1.patJoined && r1.patClip.length === 5 && r1.patRed.length === 1
              && r1.patRed[0].turn === true && r1.patRed[0].run === 3 && r1.patRed[0].why === "nogo"
              && r1.patRed[0].by === "a dock / pier" && turnsIn(red) === 3 && r1.patUnsafe.length === 1,
        () => (p1.err ? "punch threw: " + p1.err.message + "; " : "") + (r1.patClip || []).length + " runs, "
              + turnsIn(red) + " turns built; red: " + redList(red));

  const ref1 = red.punchRefusal();
  check("2. punchRefusal refuses it, names the pair and the pier, and offers only what can work: pull the line ends "
        + "back or strike a run - not the lead (tried at zero already), not the TURN speed or a wider spacing (a 10 m "
        + "pattern against a 2.1 m radius was never short of either)",
        () => ref1 && /^ADD TO PLAN REFUSED — 1 reversal\(s\) have NO FLYABLE TURN/.test(ref1.text)
              && /runs 3–4\)/.test(ref1.text) && /a dock \/ pier/.test(ref1.text)
              && /draw the box so those lines end short of what refused the turn/.test(ref1.text)
              && /strike off one of the two runs/.test(ref1.text)
              && !/lead/i.test(ref1.text) && !/TURN speed/.test(ref1.text) && !/widen/i.test(ref1.text)
              && ref1.short === "1 reversal(s) with no flyable turn (red)",
        () => ref1 ? ref1.text : "NOT REFUSED");

  red.updatePatReadout();
  const add = red.$("#sp_add"), note = red.$("#sp_refuse");
  check("3. the button is disabled with the reason as its tooltip, and the note under it carries the whole refusal "
        + "(that note is in the panel the controls window mirrors)",
        () => add.disabled === true && /^Refused: 1 reversal\(s\) with no flyable turn/.test(add.title)
              && note.textContent === (ref1 && ref1.text) && note.style.display === "",
        () => "disabled=" + add.disabled + "; title '" + add.title + "'; note shown=" + (note.style.display === ""));

  const c1 = await safely(() => red.commitPattern());
  const after1 = red.get();
  check("4. Add to plan over that punch changes NOTHING: no line, no waypoint, no save - the banner says why, a note "
        + "says it was not added, and the pattern is still there to fix",
        () => !c1.err && red.mission.lines.length === 0 && red.mission.waypoints.length === 0 && red.log.saves === 0
              && red.log.banners.includes(ref1.text) && red.log.notes.some((n) => /^Not added to the plan — 1 reversal/.test(n))
              && after1.pat.A && after1.patClip && after1.patClip.length === 5,
        () => (c1.err ? "commit threw: " + c1.err.message + "; " : "") + red.mission.lines.length + " lines, "
              + red.mission.waypoints.length + " waypoints, " + red.log.saves + " saves; notes: "
              + (red.log.notes.join(" | ") || "none"));

  // ── 5. THE ACCEPTANCE CASE ───────────────────────────────────────────────────────────────────────────────────────
  const clear = makeWorld({ features: [FAR()] });
  await safely(() => clear.punchOut());
  clear.updatePatReadout();
  const okRef = clear.punchRefusal();
  const clearAdd = { disabled: clear.$("#sp_add").disabled, title: clear.$("#sp_add").title,
                     note: clear.$("#sp_refuse").style.display, hint: clear.$("#sp_hint").textContent };
  const c5 = await safely(() => clear.commitPattern());
  const turnPts = clear.mission.waypoints.filter((p) => p.turn).length;
  check("5. the same pattern with the pier 100 m away: nothing red, the button enabled with its plain tooltip, and Add "
        + "to plan commits all five runs with their four turns",
        () => okRef === null && clearAdd.disabled === false
              && /^Add the pattern to the plan/.test(clearAdd.title) && clearAdd.note === "none"
              && !c5.err && clear.mission.lines.length === 5 && turnPts > 0 && clear.log.saves === 1,
        () => "refusal " + (okRef ? okRef.short : "none") + "; " + clear.mission.lines.length + " lines, "
              + clear.mission.waypoints.length + " waypoints (" + turnPts + " turn points)");

  // ── 6. A REMEDY THE REFUSAL OFFERS, AND THE RE-PUNCH THAT LIFTS IT ────────────────────────────────────────────────
  // Striking run 3 re-phases the serpentine: run 2 now turns onto run 4 at the SOUTH end, and run 4 onto run 5 at the
  // north end, clear of the finger. (Striking run 4 would not do: run 3 would reverse onto run 5 across the same pier.)
  const fix = makeWorld();
  await safely(() => fix.punchOut());
  fix.select({ ...fix.patCoverMid(2), length: 190 });
  const struck = fix.strikeSelectedRun();
  const f6 = await safely(() => fix.flushRepunch());
  const g6 = fix.get();
  check("6. striking one of the two runs and re-punching clears the red - the refusal is rebuilt from scratch on every "
        + "punch, so a fixed pair stops refusing - and Add to plan then commits the four runs left",
        () => struck && !f6.err && g6.patClip.length === 4 && g6.patRed.length === 0 && fix.punchRefusal() === null
              && (fix.updatePatReadout(), fix.$("#sp_add").disabled === false),
        () => (f6.err ? "re-punch threw: " + f6.err.message + "; " : "") + (g6.patClip || []).length
              + " runs after the strike; red: " + redList(fix));
  const c6 = await safely(() => fix.commitPattern());
  check("6b. ... and the commit goes through",
        () => !c6.err && fix.mission.lines.length === 4 && fix.mission.waypoints.some((p) => p.turn),
        () => fix.mission.lines.length + " lines committed");

  // ── 7. A RED HOP DOES NOT REFUSE ────────────────────────────────────────────────────────────────────────────────
  // Two cells split by a 6 km-wide block of land: the hop between them has no straight leg and no detour inside the
  // punch's search window. Upload's legPath searches wider, and refuses the upload itself if it cannot route it.
  const hop = makeWorld({ features: [{ role: "land", props: {}, geometry: { type: "Polygon", coordinates: [
    [[-3000, 1000], [3000, 1000], [3000, 2000], [-3000, 2000], [-3000, 1000]].map(([x, y]) => { const p = at(x, y); return [p.lon, p.lat]; })] } }] });
  hop.setPat(at(0, 0), at(45, 3000), at(10, 0));
  const p7 = await safely(() => hop.punchOut());
  const h7 = hop.get();
  hop.updatePatReadout();
  const enabled7 = hop.$("#sp_add").disabled === false;
  const c7 = await safely(() => hop.commitPattern());
  check("7. a punch whose only red is a HOP between two cells is NOT refused: it is recorded as a hop, the button stays "
        + "enabled, and Add to plan commits (Upload routes that hop again)",
        () => !p7.err && h7.patRed.length === 1 && h7.patRed[0].turn === false && h7.patRed[0].by === "land"
              && enabled7 && !c7.err && hop.mission.lines.length === 10,
        () => (p7.err ? "punch threw: " + p7.err.message + "; " : "") + (h7.patClip || []).length + " runs; red: "
              + redOf(h7.patRed) + "; button enabled: " + enabled7 + "; committed " + hop.mission.lines.length + " lines");
  check("7b. ... and the punch's own banner says what happens to the hop, instead of the old claim that the boat "
        + "would cross the obstacle",
        () => hop.log.banners.some((b) => /1 hop\(s\) between runs are blocked by land with no detour found here/.test(b)
                                          && /Upload routes every hop again/.test(b) && !/would cross/.test(b)),
        () => hop.log.banners.slice(-1)[0] || "no banner");

  // ── 8. A PUNCH THAT STOPS PART-WAY ──────────────────────────────────────────────────────────────────────────────
  // ⚠ AFTER A GOOD ONE. A world whose FIRST punch fails starts with patJoined false anyway, so it cannot tell "cleared
  // at the start of every punch" from "never set": the clean punch first is what makes the failure mean something.
  let calls = 0, failAt = -1;
  const half = makeWorld({ features: [FAR()],
    turnWithRetry: (real) => (...a) => { if (++calls === failAt) throw new Error("a turn that could not be built"); return real(...a); } });
  await safely(() => half.punchOut());
  const joinedFirst = half.get().patJoined, refFirst = half.punchRefusal();
  failAt = calls + 2;                                // the second turn of the NEXT punch throws
  await safely(() => half.punchOut());
  const ref8 = half.punchRefusal();
  const c8 = await safely(() => half.commitPattern());
  check("8. a clean punch, then one that throws half way through the joins: the second is refused as unfinished - on a "
        + "pattern with nothing red - and commits nothing",
        () => joinedFirst === true && refFirst === null && half.get().patJoined === false && half.get().patClip
              && ref8 && /stopped part-way/.test(ref8.text) && !c8.err && half.mission.waypoints.length === 0,
        () => "first punch joined=" + joinedFirst + "; second: " + (ref8 ? ref8.short : "NOT REFUSED") + ", "
              + half.get().patTransits.length + " of 4 joins built; " + half.mission.waypoints.length + " waypoints");
  failAt = -1;                                       // the next punch finishes
  await safely(() => half.punchOut());
  check("8b. ... and the next punch that finishes lifts it",
        () => half.get().patJoined === true && half.punchRefusal() === null,
        () => "joined=" + half.get().patJoined);

  // ── 9. ASKED AFTER THE PENDING RE-PUNCH, NOT BEFORE ───────────────────────────────────────────────────────────────
  // The button's state belongs to the LAST punch. With a re-punch pending, the plan Add to plan commits is the one that
  // re-punch produces - and here that one has the pier in it.
  const late = makeWorld({ features: [FAR()] });
  await safely(() => late.punchOut());
  late.updatePatReadout();
  const enabledBefore = late.$("#sp_add").disabled === false;
  S.nogo.features = [FINGER()];                     // the chart changed; a re-punch is due
  late.pending();
  const c9 = await safely(() => late.commitPattern());
  check("9. with the button enabled and a re-punch pending, Add to plan runs the re-punch FIRST, finds the red reversal "
        + "it produces, and commits nothing",
        () => enabledBefore && !c9.err && late.get().patRed.length === 1 && late.mission.waypoints.length === 0
              && late.log.notes.some((n) => /^Not added/.test(n)),
        () => "enabled before: " + enabledBefore + "; red after the flush: " + redList(late) + "; "
              + late.mission.waypoints.length + " waypoints");

  // ── 10. KEYED ON THE LIVE PUNCH ─────────────────────────────────────────────────────────────────────────────────
  const moved = makeWorld();
  await safely(() => moved.punchOut());
  const hadRed = moved.get().patRed.length, hint10 = moved.$("#sp_hint").textContent;
  moved.clearClip();                                 // what every corner move, setting change and chart change does
  const stillHeld = moved.get().patRed.length, ref10 = moved.punchRefusal();   // before the commit resets them
  const c10 = await safely(() => moved.commitPattern());
  check("10. once the punch is gone (a corner moved), a stale red list refuses nothing: the un-punched pattern commits "
        + "its five drawn lines as it always has",
        () => hadRed === 1 && stillHeld === 1 && ref10 === null
              && !c10.err && moved.mission.lines.length === 5 && !moved.mission.waypoints.some((p) => p.turn),
        () => "red before " + hadRed + ", still held " + stillHeld + ", refusal " + (ref10 ? ref10.short : "none") + "; committed "
              + moved.mission.lines.length + " lines; punch said: " + hint10.slice(0, 80));

  // ── 11. A LEAD NEVER GETS OFFERED ───────────────────────────────────────────────────────────────────────────────
  const lead = makeWorld({ lead: 20 });
  await safely(() => lead.punchOut());
  const ref11 = lead.punchRefusal();
  check("11. with a 20 m lead-in and lead-out the same pair is still refused (the give-way ladder tried it at zero) - "
        + "and the refusal does not tell the operator to shorten the lead",
        () => lead.get().patRed.length === 1 && lead.get().patRed[0].run === 3 && ref11 && !/lead/i.test(ref11.text),
        () => "red: " + redList(lead) + (ref11 ? "; mentions a lead: " + /lead/i.test(ref11.text) : "; NOT REFUSED"));

  // ── 12. THE CONDITIONAL REMEDIES ────────────────────────────────────────────────────────────────────────────────
  // Driven through punchRefusal's own arithmetic on the vessel model, with the red list as a punch would leave it.
  const track = makeWorld({ features: [FAR()] });
  await safely(() => track.punchOut());
  track.setRed([{ run: 2, turn: true, why: "track", by: null }], true);
  const t12 = track.punchRefusal();
  const slowTrack = makeWorld({ features: [FAR()], turnKey: "low" });
  await safely(() => slowTrack.punchOut());
  slowTrack.setRed([{ run: 2, turn: true, why: "track", by: null }], true);
  const s12 = slowTrack.punchRefusal();
  const tight = makeWorld({ features: [FAR()], turnRate: 5 });     // 24.7 m radius at 3 kn: every turn a teardrop
  await safely(() => tight.punchOut());
  tight.setRed([{ run: 2, turn: true, why: "nogo", by: "a dock / pier" }], true);
  const w12 = tight.punchRefusal();
  const chan = makeWorld({ features: [FAR()] });
  await safely(() => chan.punchOut());
  chan.setRed([{ run: 2, turn: true, why: "nogo", by: "a navigation channel" }], true);
  const n12 = chan.punchRefusal();
  check("12. a turn the boat could not TRACK offers the low TURN speed (unless it is already low); a teardrop plan "
        + "offers the spacing a semicircle needs; a turn a navigation channel refused offers the standoff - and none "
        + "of them is offered where it cannot help",
        () => t12 && /set the TURN speed to low/.test(fixesOf(t12)) && /1 where a loop fits on paper but the boat/.test(t12.text)
              && !/widen/.test(fixesOf(t12))
              && s12 && !/TURN speed/.test(fixesOf(s12))
              && w12 && /widen the spacing to 50 m/.test(fixesOf(w12)) && !/TURN speed/.test(fixesOf(w12))
              && n12 && /end the lines about 6 m short of the navigation channel/.test(fixesOf(n12))
              && !/navigation channel/.test(fixesOf(t12)),
        () => "track: " + fixesOf(t12) + " | low already: " + fixesOf(s12) + " | teardrop: " + fixesOf(w12)
              + " | channel: " + fixesOf(n12));

  // ── 13. THE PUNCH'S OWN WORDS ───────────────────────────────────────────────────────────────────────────────────
  const hint = punchHint;
  check("13. the red punch's banner IS the refusal, and its summary line counts the refused reversal apart and says "
        + "the pattern is not ready - never 'Add to plan.'",
        () => punchBanners.length === 1 && punchBanners[0].startsWith(ref1.text)
              && /, 1 reversal\(s\) with NO flyable turn \(red\)/.test(hint)
              && /NOT READY for the plan — the note under Add to plan says why\.$/.test(hint) && !/\. Add to plan\.$/.test(hint)
              && /\. Add to plan\.$/.test(clearAdd.hint),
        () => hint.slice(0, 40) + " ... " + hint.slice(-90));

  // ── 14. A PUNCH THE TIDE THROWS AWAY ─────────────────────────────────────────────────────────────────────────────
  // applyWaterOffset drops the punch on ANY change of level - a station update moves it a few centimeters - and until
  // 2026-09-16 it did only that: the next readout lifted the refusal and Add to plan committed the pattern UN-punched.
  // Found on the live check, where one tide update and one chart click turned a punch refused for 15 reversals into a
  // committed plan of 23 unclipped lines with no turns at all.
  S.sea.waterOffset = 0; S.nogo.builtOffset = 0;
  const tide = makeWorld({ features: [FAR()] });
  await safely(() => tide.punchOut());
  const cleanBefore = tide.punchRefusal() === null && tide.get().patClip !== null;
  tide.water(0.34);
  const g14 = tide.get(), ref14 = tide.punchRefusal();
  const btn14 = { disabled: tide.$("#sp_add").disabled, note: tide.$("#sp_refuse").textContent,
                  hint: tide.$("#sp_hint").textContent };
  const c14 = await safely(() => tide.commitPattern());
  check("14. a CLEAN punch the tide throws away (a station update, +0.34 m) is not swapped for the un-punched pattern: "
        + "the button and the note say so the moment it happens, and Add to plan commits nothing",
        () => cleanBefore && g14.patClip === null && /^the water level moved \(\+0\.00 m to \+0\.34 m\)$/.test(g14.patDropped)
              && ref14 && /UN-punched/.test(ref14.text) && /Punch Out again\.$/.test(ref14.text)
              && btn14.disabled === true && btn14.note === ref14.text
              && /or Punch Out again\.$/.test(btn14.hint) && !/Add to plan/.test(btn14.hint)
              && !c14.err && tide.mission.lines.length === 0 && tide.mission.waypoints.length === 0,
        () => "dropped: " + g14.patDropped + "; button disabled " + btn14.disabled + "; hint '"
              + btn14.hint.slice(-40) + "'; " + tide.mission.lines.length + " lines committed");
  await safely(() => tide.punchOut());
  const back = tide.get();
  tide.water(0.34);                                  // the same level again: nothing moved, nothing is dropped
  const kept = tide.get().patClip !== null;
  tide.clearClip();                                  // then the operator moves a corner
  const c14b = await safely(() => tide.commitPattern());
  check("14b. ... Punch Out again clears it, a reading at the same level drops nothing, and after an operator's own "
        + "change the un-punched pattern is theirs to add, as it always was",
        () => back.patClip && back.patDropped === null && kept && !c14b.err && tide.mission.lines.length === 5
              && !tide.mission.waypoints.some((p) => p.turn),
        () => "after the re-punch dropped=" + back.patDropped + "; same-level reading kept the punch: " + kept
              + "; committed " + tide.mission.lines.length + " lines");
  const rst = makeWorld({ features: [FAR()] });
  await safely(() => rst.punchOut());
  rst.water(0.5);
  const refR = rst.punchRefusal();
  rst.resetPattern();
  rst.setPat(at(0, 0), at(45, 200), at(10, 0));      // a new pattern, never punched
  const c14c = await safely(() => rst.commitPattern());
  check("14c. ... and Reset clears it too: a new pattern drawn after it is not refused for the old one's punch",
        () => refR && /\(\+0\.34 m to \+0\.50 m\)/.test(refR.text) && rst.get().patDropped === null
              && !c14c.err && rst.mission.lines.length === 5,
        () => "refused before the reset: " + (refR ? refR.short : "no") + "; committed after it: "
              + rst.mission.lines.length + " lines");
  const never = makeWorld({ features: [FAR()] });   // a pattern nobody punched
  never.water(0.62);
  const neverDropped = never.get().patDropped;
  const c14d = await safely(() => never.commitPattern());
  check("14d. a tide update with NO punch on the chart records nothing - there were no runs to throw away - and the "
        + "un-punched pattern still commits",
        () => neverDropped === null && !c14d.err && never.mission.lines.length === 5,
        () => "dropped=" + neverDropped + "; committed " + never.mission.lines.length + " lines");
  const bare = makeWorld({ features: [FAR()] });
  await safely(() => bare.punchOut());
  bare.water(0.7);
  const refBare = bare.punchRefusal();
  S.nogo.features = [];                              // the re-punch finds no chart at all
  await safely(() => bare.punchOut());
  const bareBanner = bare.log.banners.slice(-1)[0] || "";
  const c14e = await safely(() => bare.commitPattern());
  S.nogo.features = [FAR()];
  check("14e. ... and a re-punch that finds NO chart is that punch's own answer: its banner says the lines were not "
        + "trimmed, and the refusal the tide left behind is gone",
        () => refBare && /found no ENC coverage/.test(bareBanner) && bare.get().patDropped === null
              && !c14e.err && bare.mission.lines.length === 5,
        () => "refused after the tide: " + !!refBare + "; banner: " + bareBanner.slice(0, 60) + "; committed "
              + bare.mission.lines.length + " lines");
  S.sea.waterOffset = 0;

  __finished = true;
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
