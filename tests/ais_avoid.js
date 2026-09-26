// tests/ais_avoid.js - AIS contacts are keep-outs the guard acts on, and the survey comes back on its
// own once the contact has cleared the line, 100 m back down it.
//
// Andy, 2026-09-25: "Treat AIS targets with dimensions as NOGO areas. They may be moving so the
// calculation must update with them. If the AIS target moves through a survey area it will not force
// a survey pattern reconfiguration. But the ASV will avoid the AIS target and return to the survey
// line once it is clear with a 100m backup over previously run line. AIS targets without dimensions
// are to be assumed 20m long and 8m wide." Then: "disregard the 20m perimeter buffer."
//
// THE RUNGS DO THE AVOIDING, AND ONLY THE RETURN IS NEW. With the contacts folded into the model the
// guard reads (koAll in clearanceGuard), the ladder slows, holds or takes the helm for a crossing
// workboat exactly as it does for a pier - and every one of those rungs is already driven by
// guard_resume.js, clearance_guard.js and in_extremis.js. What this suite owns:
//   * the contacts REACH the ladder, the readout and the escape's search, and reach NOTHING ELSE -
//     `nogo.ko` is untouched, so no pattern is ever reconfigured for a ship;
//   * the edge rung stands down near a contact (a dog-leg neither returns nor backs up);
//   * a hold or an escape caused by a contact opens an episode, and the console brings her back
//     itself once the contact is clear of the line for AIS_RETURN_DWELL_MS: pause, upload the
//     remainder behind a rejoin point AIS_RETURN_BACK_M back down the line, LOW, Start - with
//     NONE of the operator's latches (no override, no LOW hold);
//   * a charted hold, a Go-To, and a contact that STOPS on the line all keep today's offer to the
//     operator, and nothing comes back on its own;
//   * a stale feed is an EMPTY model that says so, never a quiet sea - and is a banner while it
//     matters;
//   * the contacts are polled whenever the console has authority, layer or no layer.
//
//   node tests/ais_avoid.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// THE WORLD BELOW IS tests/guard_resume.js's, COPIED (2026-09-25) WITH THREE EDITS: the real
// updateClearance in place of its stub, two more elements the AIS layer touches, and an escape stub
// that records the model it was handed. Every page suite declares its own world - see that file for
// why each symbol is where it is.
//
// TEETH - see the mutation sweep recorded in CLAUDE.md for this change; the check numbers below are
// the ones that went red for each mutation of static/asv.html and static/js/ais_keepout.js.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const fs = require("fs");
const path = require("path");

// ASV_HTML points this at a SIDECAR copy for a mutation run - every read of the page goes
// through it. Three suites in three commits were found reading a fixed path and scoring
// every mutation as SURVIVED; this one is born with the override.
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");

// THE REAL MODULES, not source text lifted out of the page.
const { distTo, fromEN, llEN, planeFrame } = require("../static/js/geodesy.js");
const { bbOf } = require("../static/js/geometry.js");
const { legClear } = require("../static/js/chart.js");
const G = require("../static/js/guard.js");

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

// ---- the page's world, as the guard and the resume read it -------------------------- //
// MUTABLE STATE AT MODULE SCOPE, deliberately: the eval'd page functions resolve these up
// the scope chain and write to the same bindings the checks read. Anything declared INSIDE
// the eval is invisible out here, which is how a check ends up reading a variable the
// subject never touched.
const V = { SPEED_KN: { low: 4.0, survey: 7.0, high: 14.0 },
            VESSEL: { hull: { loa_m: 7.71 } },
            MAX_TURN_RATE_DEG_S: 20 };
var mission = { lines: [], waypoints: [], speeds: { transit: "high", turn: "low", survey: "survey" },
                approach_radius_m: 2 };
var runLineIdx = -1, curTurn = -1, turnSeg = [], lastRunLine = -1, turnSlowAt = [];
var lineSwing = -1;   // the line she is swinging onto (2026-09-25) - read by currentActivity every frame
// speedGovernor also reads the JUNCTION corner set since 2026-09-19 - see speed_modes.js.
var cornerSlow = new Set();
var cornerSlowFor = -1;
// ⚠ ALL FOUR, because the edge rung drops the set when it deviates and dropCornerSlow
// reads every one of them. With two missing the call threw, and the throw took the rest of
// the rung's statement list with it - the splice landed, the budget never moved, and check 22
// read `edgeSpentM 0 over 0 deviation(s)`. A missing global in a world is a missing
// dependency, and the page declares these beside the other two.
var cornerUnanswered = [];
var cornerPlanKey = "survey";
var S = null, asv = null, runRoute = null, runUnsafe = [], pauseMark = null;
var resumeSlow = false, commandedSpeed = null, guardOverride = null, guardHeld = null;
// ⚠ MODULE SCOPE, NOT THE EVAL BUNDLE. A `let` inside the bundle makes a SECOND
// global that the fixtures below write and the subject never reads - which is how 12g once
// passed while reporting on a set nothing referred to. resumeHeldSurvey owns this record
// across its own pause/upload/speed/start, because a paused boat matches neither arm of
// guardHeldOffer and the record would otherwise be spent halfway through the resume.
var heldResuming = false;
// Whether the modelled guard ticks between the resume's commands. Off by default so the
// non-resume fixtures are unchanged; resumeFrom turns it on.
var tickGuard = false;
// The helm rung's claim on the throttle. speedGovernor stands down on it exactly as it does
// on `resumeSlow`, so the symbol has to exist here or the governor is a bare ReferenceError -
// which the crash guard reports as ONE failed check rather than as a crash. False in this
// world: no escape is commanded in it, so these checks are the evidence that an ordinary run
// still governs its own speed exactly as it always did.
var escapeThrottle = false;
var clearance = { m: null, kind: null, closing: false, slowed: false, prev: null, info: null };
var guardLevel = "clear", clearAlarmAt = 0, guardActedAt = 0, guardEscapeAt = 0;
// ⚠ OUT HERE, NOT IN THE BUNDLE, AND THAT IS THE WHOLE POINT. The bundle's `let`s live in
// the eval's own scope and nothing outside can touch them - a `holdWant = null` in a fixture
// would have created a SECOND, unread global and the reset would have been a silent no-op.
// Declared beside guardActedAt, the guard's reference resolves here and the fixtures can
// actually clear it between episodes.
var holdWant = null;
var guardEdgeAt = 0, edgeSpentM = 999, edgeCount = 0;   // 999: the deviation budget is spent
// THE AIS KEEP-OUTS (2026-09-25). clearanceGuard builds the contacts' model every frame and asks the
// return tick above every branch, so the names must exist or the guard is a bare ReferenceError. No
// contacts live in this world - the model is empty and every check here is the charted world it always
// was. `aisPolledAt` is a poll that is always fresh: an EMPTY model, never a STALE one, so the blind
// banner cannot land in a check that counts banners (tests/ais_avoid.js owns the stale case).
var aisVessels = [], aisPolledAt = 0, aisShow = false, aisAvoid = null;
var aisKoDrawn = [], aisKoNote = null, aisKoStale = false, aisKoBlindSaid = false, aisKoWantedAt = 0;
const { aisKeepouts, AIS_KO_STALE_S } = require("../static/js/ais_keepout.js");
const { clearanceM } = require("../static/js/keepouts.js");
// The hold rung snapshots its own latches before writing them (2026-09-22), so a refusal
// can put them back. `slowLieu` is one of them and is READ before anything writes it.
var slowLieu = null;
var planIntent = { why: [] }, notes = [], banners = [], logged = [], violations = null;
var nogo = { ready: true, frame: null, ko: null, buffer: 5 };
var confirmAnswer = true, confirmAsked = 0, lastResume = null, lastContinue = null;

// The guard's own imports, REAL - the rungs are only worth driving against the real assess.
const guardAssess = G.assess, groundVel = G.groundVel, restoreVel = G.restoreVel,
      edgeText = G.edgeText, edgeCapM = G.edgeCapM, GUARD_HORIZON_S = G.HORIZON_S;
// THE ESCAPE, STUBBED AND STEERABLE: it records the MODEL it was handed (the check that the contacts
// reach the helm rung) and answers whatever `escFake` says, so the rung can be driven past its search.
let escKo = null, escFake = null;
function escapeCourse(p, drift, ko) { escKo = ko; return escFake; }

function fmtDist(m) { return Math.round(m) + " m"; }
function flashNote(m) { notes.push(m); }
function showBanner(t) { banners.push(t); }
function setViolations(v) { violations = v; }
function updateMissionCard() {}
function render() {}
function holdClearAt() { return 12.3; }

// ⚠⚠ THE ROUTER, STUBBED AND STEERABLE. resumeHeldSurvey certifies the run-in with the same
// planner Go-To flies (2026-09-23): after an ESCAPE she is not beside her line any more, and
// the first leg of the remainder runs from wherever the escape left her back toward a waypoint
// chosen before any of it happened. Without this symbol the resume threw inside the handler -
// which 12a caught, because 12a exists for the identical fault one layer down (legClear
// dereferencing a frame that was not there).
//
// ⚠ THE DEFAULT MIRRORS THE REAL CONTRACT and the branches are driven by name, so a check
// that wants a refusal asks for one rather than building a geometry that happens to produce
// it. The real planNogoRoute returns `kr.route.slice(1)` - the start point EXCLUDED, the
// target LAST - and answers {degraded:true} with no model. Get that wrong here and the checks
// below would agree with a resume that prepends the wrong waypoints.
let pinNext = null, pinCalls = [];
function holdOpts() { return {}; }
function planNogoRoute(from, to) {
  pinCalls.push({ from, to });
  if (pinNext) return pinNext;
  if (!nogo.ready || !nogo.ko || !nogo.frame)
    return { route: [{ lat: to.lat, lon: to.lon }], direct: true, degraded: true };
  return { route: [{ lat: to.lat, lon: to.lon }], direct: true, routed: false };
}
function guiConfirm() { confirmAsked++; return Promise.resolve(confirmAnswer); }
globalThis.window = globalThis;
globalThis.fetch = (p, o) => {
  try { logged.push(JSON.parse(o.body)); } catch (e) { /* not a logevent */ }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
};
// Commands are RECORDED, not stubbed to nothing, so a check can say WHAT was sent and in
// what order rather than only that something was. `refuse` drives the refusal branch.
var sent = [], refuse = null, lost = null;
// ⚠ THE VESSEL'S SIDE OF A COMMAND LANDS AFTER THE REPLY, which is what makes the
// one-at-a-time gate measurable. The page awaits each command; the run state it then reads
// comes from a LATER telemetry frame. Applying it synchronously inside cmd() meant a second
// press could never see the live offer the first press had not yet spent - the harness was
// preventing the very race the gate exists for, and the mutation that removes the gate
// survived because of it. One guard tick per reply models the 4 Hz loop underneath.
function applyReply(p, pr) {
  return pr.then((r) => {
    if (p === "/api/cmd/pause") S.run = "paused";
    if (p === "/api/cmd/start") S.run = "running";
    if (tickGuard) guardHeldOffer();
    return r;
  });
}
function cmd(p, b) {
  sent.push({ p, speed: b && b.speed, route: b && b.route });
  // ⚠ THE HOLD IS MODELLED, NOT JUST RECORDED, AND THAT IS WHAT MAKES CHECK 6 REAL. On the
  // vessel `hold` uploads a one-waypoint plan over the survey, so `wp_index` becomes 0 and
  // describes the hold. With a stub that only records, moving markGuardHeld to AFTER the
  // command changes nothing the suite can see - the mutation survives and the check is
  // decoration. Here the index really moves, so a late capture really reads the wrong one.
  if (p === "/api/cmd/hold") window._wpIndex = 0;
  // ⚠⚠ AND THE PAUSE IS MODELLED TOO, for exactly the reason the hold is - and its absence
  // made check 15b decoration. On the vessel `pause` sets run to "paused", and
  // resumeHeldSurvey pauses FIRST (review #6). guardHeldOffer matches neither "hold" nor
  // "escape" on a paused boat, so the 4 Hz guard underneath the resume's four round trips
  // spent the very record the resume was handing back - after which its abort banners promise
  // "the remainder is still held" about nothing at all. With a stub that only RECORDED the
  // pause, `run` stayed "running" for the whole sequence and no check could see it.
  // ⚠⚠ AND THE VESSEL REPORTS IT ON A LATER FRAME, NOT ON THE CALL - so these land in
  // the `.then` below rather than here. Written synchronously they closed a window that is
  // open in the real console: between `heldResuming = true` and the pause actually taking
  // effect, `run` still reads "running" and a second press still sees a live offer. With a
  // synchronous model the one-at-a-time gate was UNTESTABLE - its mutation survived because
  // the harness had already made the thing it prevents impossible.
  // ⚠ AND THE GUARD DOES NOT STOP WHILE THE CONSOLE AWAITS. One tick per round trip is the
  // cheapest faithful model of a 4 Hz loop running under four awaited commands: it is what
  // turns "the offer stays up" from a statement about an untouched variable into a statement
  // about a variable something else had a chance to spend.
  // ⚠ THE SUCCESS FIXTURE USED TO BE A BARE {} - the one answer that has neither
  // `ok` nor `error`, and therefore the one this suite could not tell from a failure.
  // That is not a detail: it is WHY the page carried two failure-shaped tests for so
  // long. The fixtures agreed with the bug, so every mutation of it survived here.
  // cmd() answers {ok:true, state:{...}} on success and {ok:false, error, sent, refused}
  // on every failure; a stub that answers anything else is testing a console that does
  // not exist.
  // ⚠⚠ TWO SHAPES OF FAILURE, NOT ONE. Until 2026-09-22 this stub could only answer
  // {refused:true}, so every check in the file reading "a REFUSED command keeps X" was really
  // testing "a FAILED command keeps X" - and the page's asymmetry, which is the whole point
  // (`refused` is the vessel's answer; silence is not an answer), had no case anywhere. The
  // mutation that deletes the lost-reply arm of the edge rung survived a sweep because of it.
  // `lost` names the path whose reply never comes back.
  return applyReply(p, Promise.resolve(lost && lost === p
    ? { ok: false, error: "no answer", sent: true, refused: false }
    : refuse && refuse === p
    ? { ok: false, error: "ARM before uploading a plan", sent: true, refused: true }
    : { ok: true, state: {} }));
}

// A minimal DOM, only as wide as the guard bar. renderGuardBar writes text and display, and
// the checks read them back - which is the only way to tell "the offer is up" from "the code
// that would put it up exists".
const EL = {};
function $(sel) {
  if (sel === "#guardBar" || /^#(gb_|aisTip|aisBtn)/.test(sel))
    return EL[sel] || (EL[sel] = { textContent: "", className: "", style: { display: "" },
                                   classList: { toggle() {}, add() {}, remove() {} } });
  return null;
}

// eslint-disable-next-line no-eval
eval([
  grabDecl("RESUME_BACK_LENGTHS"),
  grabDecl("OVERRIDE_GIVE_M"),
  grabDecl("EDGE_REASSESS_MS"),
  grabDecl("GUARD_REASSESS_MS"),
  // ⚠ updateClearance IS THE ONE STUB IN THE BUNDLE, and it is in the bundle rather than at
  // module scope so it assigns to the SAME `clearance` the guard reads. A stub outside would
  // have written a different binding and every rung would have run on a null clearance.
  // THE REAL updateClearance HERE, NOT guard_resume's STUB: this suite is about the model the readout
  // measures against, so the contact has to reach `clearance.kind` through the page's own code.
  grab("updateClearance"), grabDecl("CLEAR_CAP_M"), grabDecl("CLEAR_CLOSING_MS"),
  // review #14: the guard and the governor act only in the SUPERVISING tab. This world is that tab - a view-only
  // one is tests/supervisor_page.js's subject, and it holds that they assess and alarm without commanding.
  "const supervising = () => true;",
  grab("indexedRoute"), grab("lineMark"), grab("markGuardHeld"), grab("guardHeldOffer"),
  // the DRAWN-LINE numbering every "line N" now goes through (review #18) - the page's own, not a stub
  grab("lineSetKey"),
  grabDecl("LINE_PART_OFFSET_M"), grabDecl("_drawnLines"), grab("linePartContinues"), grab("drawnLines"),
  grab("lineNo"), grab("lineCount"), grab("linePartTxt"),
  grabDecl("RELEASE_HOLD_MS"),
  "let clearHoldAt = 0;",
  grab("releaseSettled"),
  // ⚠ THE IN-EXTREMIS DWELL (2026-09-19). clearanceGuard calls helmSettled on EVERY
  // frame, above every branch, so a bundle without it is a bare ReferenceError on the first
  // frame of every scenario - which is how this suite failed when the dwell landed.
  grabDecl("HELM_DWELL_MS"),
  "let helmHoldAt = 0;",
  grab("helmSettled"),
  // ⚠ THE HOLD'S OWN RECORD (2026-09-21), and BOTH lines are needed. `holdWant` is READ
  // (`!!holdWant`) before anything assigns it, so without it the hold rung is a bare
  // ReferenceError - the same failure HELM_DWELL_MS caused above. SLOW_ANSWER_MS is the
  // subtler one: `!!holdWant` short-circuits on the FIRST frame of every scenario, so
  // omitting it leaves checks 5-7 green and reddens only the later ones, for a reason that
  // has nothing to do with what they test. (`slowLieu` above it is still an implicit global
  // here: the rung only ever ASSIGNS it in this world, never reads it.)
  grabDecl("SLOW_ANSWER_MS"),
  // ⚠ THE LAUNCH GRANT (2026-09-19): clearanceGuard calls grantNow() every frame, above
  // every branch. No berth is latched in this world, so it returns null and every check here
  // exercises the OPEN regime - which is exactly what this suite should be testing.
  "let grant = null, grantMemo = null, grantEndSay = null;",
  "let grantStop = null, grantLast = null, grantTrueAt = 0, grantTrueLevel = null;",
  "const logGrantEvent = () => {};",
  "const { berthClearM, berthNeedM, grantFilter, grantProved, grantedFeatures, inCorridor,"
  + " recessionGiveM } = require('../static/js/berth.js');",
  "const GRANT_STANDDOWN_MS = 20000, GUARD_HELM_S = 20;",   // OVERRIDE_GIVE_M is already grabbed above
  "let grantProofAt = 0, grantStallAt = 0;",
  grab("berthAt"), grab("grantMembers"), grab("grantNow"),
  // grantTick is asked every frame, above every branch - the symbol must exist even where no
  // berth is ever latched and it returns at its first line. Both ENDS are needed and they
  // are different functions: stopAtBerth keeps the grant (stall/clock), standDownEnd drops
  // it and holds the helm, and helmStoodDown is what clearanceGuard asks before an escape.
  grab("grantTick"), grab("stopAtBerth"), grab("standDownEnd"),
  grab("helmStoodDown"), grab("endGrant"),
  grabDecl("SPEED_RESEND_MS"), grabDecl("speedWant"), grab("commandSpeed"),
  grab("guardOverrideOk"), grab("guardTrack"), grab("clearanceGuard"),
  // the AIS keep-outs and the return (2026-09-25) - asked every frame, above every branch
  grab("aisGuardWanted"), grab("aisKeepoutsNow"), grab("aisNearestKind"), grab("aisAvoidOpen"),
  grab("aisReturnTick"), grab("logClient"),
  grab("aisWanted"), grab("pollAIS"), grab("setAIS"),
  // the escape rung runs to its POST here (guard_resume stops at the refused search), so its helper
  grab("notTookSay"),
  "function __clearCap(){ return CLEAR_CAP_M; }",
  grabDecl("AIS_RETURN_BACK_M"), grabDecl("AIS_RETURN_DWELL_MS"),
  grab("renderGuardBar"), grab("renderHeldBar"),
  // took() is the page's ONE test for "did the command land?", carried across verbatim.
  // sendSpeed is the one door a speed command reaches the wire by (2026-09-22).
  grab("took"), grab("sendSpeed"), grab("continueAtLow"), grab("resumeHeldSurvey"),
  grab("resumeHeldRun"),
  grab("dropHeldSurvey"),
  grab("logGuardLow"),
  grab("resumeBackM"), grab("resumePointOn"), grab("backtrackClear"), grab("alongLineM"),
  grab("roleSpeed"), grab("roleSpeedMS"), grab("linePhase"), grab("currentActivity"),
  grab("speedRole"), grab("speedGovernor"),
  // The one door the escape gives its claim back through (2026-09-22), carried across
  // verbatim so a change to that rule is a change HERE and not in a copy that drifts.
  grab("releaseEscapeClaim"),
  // ⚠ AND THE ONE DOOR THE CORNER SET LEAVES BY (2026-09-22). The edge rung calls it on both
  // arms - a lost reply and an accepted deviation - so a bundle without it is a bare
  // ReferenceError INSIDE the rung's `.then`, where the rung's own
  // `.catch(() => { guardEdgeAt = 0; })` swallows it whole. That is what check 22 was
  // reading: the amend went out, the throw ate the rest of the statement list, and the
  // budget, the arming and the saying all silently did not happen. A swallowed
  // ReferenceError reports as a wrong ANSWER, never as a crash.
  grab("dropCornerSlow"),
  "function __backLengths(){ return RESUME_BACK_LENGTHS; }",
].join("\n"));
var __clr = {};

// EVERY CALL INTO THE SUBJECT IS WRAPPED. A mutation that removes a guard makes the real
// function THROW, and an unguarded call would kill the run before a single FAIL line printed
// - which the mutation runner scores as SURVIVED, strictly worse than the check not existing.
function tryIt(fn) { try { return { v: fn() }; } catch (e) { return { raised: e.message }; } }

// ---- the water: tests/in_extremis.js's pier, 30 m north of the boat ------------------ //
const ref = planeFrame({ lat: 43.07, lon: -70.76 });
const ll = (e, n) => fromEN(e, n, ref);
function wall(n0) {
  const r = [{ e: -400, n: n0 }, { e: 400, n: n0 },
             { e: 400, n: n0 + 300 }, { e: -400, n: n0 + 300 }];
  return { polys: [{ ring: r, bb: bbOf(r), kind: "a dock / pier" }],
           lines: [], points: [], marks: [], sys: [], chans: [] };
}
const PIER = wall(30);
// A 400 m survey line running due EAST, 0 m north - the boat runs along it at the pier's foot.
const LINE_E = { a: ll(-200, 0), b: ll(200, 0) };

// ================================================================================================
// THE AIS WORLD - this suite's own additions to the copied world above.
// ================================================================================================
const { blockedInfo } = require("../static/js/keepouts.js");
var AIS_KEY = "asv_ais_show_v1";
var aisArea = null, aisState = "idle", aisSrc = null, aisSrcName = null, aisNote = "", aisBusy = false;
function aisCenter() { return asv ? { lat: asv.lat, lon: asv.lon } : { lat: 0, lon: 0 }; }
function renderAisTable() {}
function setAisTable() {}
function lsSet() {}
var planGen = 0;
function setPlanIntent(kind, _, route) { planIntent = { kind, why: [], route: route ? route.length : 0 }; }
// THE CLOCK IS OURS. Every dwell in the guard - the release, the helm, the AIS return - reads
// Date.now(), so a suite that slept through them would be a suite nobody runs.
const realNow = Date.now;
let clock = 1_700_000_000_000;
Date.now = () => clock;
// The open sea: no charted keep-out at all, so anything the ladder answers is a contact.
const OPEN = { polys: [], lines: [], points: [], marks: [], sys: [], chans: [] };
// A contact at frame (e, n): a 30 x 8 m workboat unless `o` says otherwise, reported this instant.
function contact(e, n, o = {}) {
  const p = ll(e, n);
  return { mmsi: 338111222, name: "WORKBOAT", lat: p.lat, lon: p.lon, sog: 0, cog: null, heading: null,
           age: 0, dim: { a: 15, b: 15, c: 4, d: 4 }, length: 30, beam: 8, ...o };
}
// Crossing the line from the south, northbound at 6 kn, her sweep reaching the line at e = 30..38:
// 7.5 s ahead of a boat doing 7 kn, 13 s at this world's 4 kn LOW - a hold on both counts.
const CROSSING = () => contact(34, -60, { sog: 6, cog: 0, heading: 0 });
// The boat at (0,0) on LINE_E, heading east at `sogKn`, open water, contacts as given.
function surveying(sogKn, vessels, o = {}) {
  mission = { lines: [LINE_E], waypoints: [LINE_E.a, LINE_E.b],
              speeds: { transit: "high", turn: "low", survey: "survey" }, approach_radius_m: 2 };
  S = { armed: true, estop: false, run: "running", behavior: o.behavior || "survey",
        status: { cog_deg: 90, sog_kn: sogKn, heading_deg: 90,
                  env_set_deg: 0, env_set_kn: 0, holding: false, drifting: false, speed_key: "survey" } };
  asv = ll(0, 0);
  runLineIdx = 0;
  runRoute = [ll(-200, 0), LINE_E.b, ll(200, 60), ll(-200, 60)];
  window._wpIndex = 1;
  nogo = { ready: true, frame: ref, ko: o.ko || OPEN, buffer: 3 };
  clearance = { m: null, kind: null, closing: false, slowed: false, prev: null, info: null };
  guardLevel = "clear"; guardOverride = null; guardHeld = null; guardActedAt = 0; holdWant = null;
  resumeSlow = false; commandedSpeed = null; edgeSpentM = 999; guardEdgeAt = 0; edgeCount = 0;
  refuse = null; lost = null; slowLieu = null; heldResuming = false; escapeThrottle = false;
  guardEscapeAt = 0;
  aisAvoid = null; aisVessels = vessels || []; aisPolledAt = o.polledAt != null ? o.polledAt : clock;
  aisKoBlindSaid = false; aisKoWantedAt = 0; aisShow = false; escKo = null; escFake = null;
  sent = []; notes = []; banners = []; logged = []; planIntent = { why: [] };
}
// The boat has taken the hold: station-keeping where she is, no way on.
function nowHolding() {
  S = { ...S, behavior: "hold", status: { ...S.status, sog_kn: 0, cog_deg: null, holding: true } };
}
const frame = () => tryIt(() => clearanceGuard());
const paths = () => sent.map(x => x.p);
// The return is asynchronous (four awaited commands): let it run to Start, or give up.
async function settle() {
  for (let i = 0; i < 40 && !paths().includes("/api/cmd/start") && heldResuming !== false || i < 3; i++)
    await new Promise(r => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}
const kindRe = /AIS: WORKBOAT \(30 x 8 m, 6\.0 kn\)/;

console.log("AIS contacts as keep-outs, and the way back:");

(async () => {
// ── 1. A CROSSING CONTACT HOLDS HER, THROUGH THE ORDINARY LADDER ───────────────────────
{
  surveying(7, [CROSSING()]);
  const r = frame();
  check("1. a workboat crossing the line 30 m ahead HOLDS the survey through the ordinary ladder - a hold is sent, the survey is banked",
        () => !r.raised && paths().includes("/api/cmd/hold") && clearance.level === "hold"
              && !!guardHeld && guardHeld.route.length === 4 && guardHeld.idx === 1,
        () => (r.raised ? "RAISED " + r.raised + "; " : "") + "level " + clearance.level + ", sent "
            + JSON.stringify(paths()) + ", banked " + (guardHeld ? guardHeld.route.length + " wpts from " + guardHeld.idx : "nothing"));
  check("1b. ... the banked mark is where she left the line: line 1, 200 m along it, running forward",
        () => guardHeld && guardHeld.mark && guardHeld.mark.line === 0 && guardHeld.mark.fwd === 1
              && Math.abs(guardHeld.mark.along - 200) < 1,
        () => guardHeld && guardHeld.mark ? "line " + guardHeld.mark.line + " along " + guardHeld.mark.along.toFixed(1) + " fwd " + guardHeld.mark.fwd : "no mark");
  check("1c. ... an AIS episode is opened, naming the contact and the rung, and it is recorded",
        () => !!aisAvoid && kindRe.test(aisAvoid.kind) && aisAvoid.rung === "hold" && aisAvoid.line === 0
              && logged.some(e => e.kind === "ais_avoid" && kindRe.test(e.data.kind) && e.data.line === 1),
        () => "episode " + JSON.stringify(aisAvoid) + "; logged " + JSON.stringify(logged.map(e => e.kind)));
  check("1d. ... the banner names HER, not 'a keep-out', on the frame the readout has not yet named her (she is 30 m off, the buffer is 3)",
        () => banners.some(b => /HOLD/.test(b) && kindRe.test(b)) && clearance.m > 20,
        () => "clearance " + (clearance.m == null ? "null" : clearance.m.toFixed(1)) + " m; banners: " + JSON.stringify(banners));
  check("1e. NO PATTERN RECONFIGURATION: the charted model is untouched by the contact - nogo.ko has no polygon in it",
        () => nogo.ko.polys.length === 0 && nogo.ko === OPEN,
        () => nogo.ko.polys.length + " polys in nogo.ko");
  check("1f. ... and no deviation was tried against her (the edge rung stands down near a contact)",
        () => !paths().includes("/api/cmd/amend"), () => JSON.stringify(paths()));

  // ── 2. HOLDING WHILE SHE IS STILL CROSSING: NOTHING COMES BACK ───────────────────────
  nowHolding(); sent = []; notes = []; banners = [];
  clock += 10000;                                   // 10 s on: her sweep still covers the line
  frame();
  check("2. holding while her sweep still covers the line: no return - nothing is sent, the episode stands",
        () => !paths().includes("/api/cmd/pause") && !paths().includes("/api/cmd/upload") && !!aisAvoid
              && aisAvoid.clearSince === 0,
        () => "sent " + JSON.stringify(paths()) + ", clearSince " + (aisAvoid && aisAvoid.clearSince));
  check("2b. ... and the held bar says what she is holding for and that the way back is the console's",
        () => { renderGuardBar({ level: "blind" }, clearance);
                return /SURVEY HELD/.test($("#gb_rung").textContent) && /holding for AIS: WORKBOAT/.test($("#gb_why").textContent)
                       && /resumes on its own/.test($("#gb_why").textContent) && /100 m back/.test($("#gb_why").textContent); },
        () => $("#gb_rung").textContent + " / " + $("#gb_why").textContent);

  // ── 3. SHE CLEARS THE LINE: THE DWELL, THEN THE RETURN ───────────────────────────────
  // THE FEED KEEPS ANSWERING and she keeps going: a fresh report each frame, 93 m north of where she
  // was 30 s ago, then on - the way a live feed reads, poll after poll.
  const her = (t) => { aisVessels = [contact(34, -60 + 3.087 * t, { sog: 6, cog: 0, heading: 0 })]; aisPolledAt = clock; };
  clock += 20000; her(30);                          // 30 s on: her sweep is past the line
  frame();
  const t30 = paths().slice();
  check("3. 30 s on, reported clear of the line: the dwell starts and nothing is sent yet",
        () => !!aisAvoid && aisAvoid.clearSince === clock && t30.length === 0,
        () => "clearSince " + (aisAvoid && aisAvoid.clearSince) + " (now " + clock + "), sent " + JSON.stringify(t30));
  clock += 2000; her(32); frame();
  const t32 = paths().slice();
  clock += 2100; her(34.1); frame();
  await settle();
  check("3b. clear for under AIS_RETURN_DWELL_MS: still nothing; clear for 4.1 s: the return goes - pause, upload, LOW, Start, in that order",
        () => t32.length === 0 && paths().indexOf("/api/cmd/pause") === 0
              && paths().indexOf("/api/cmd/pause") < paths().indexOf("/api/cmd/upload")
              && paths().indexOf("/api/cmd/upload") < paths().indexOf("/api/cmd/speed")
              && paths().indexOf("/api/cmd/speed") < paths().indexOf("/api/cmd/start")
              && sent.find(x => x.p === "/api/cmd/speed").speed === "low",
        () => "at 2 s: " + JSON.stringify(t32) + "; at 4.1 s: " + JSON.stringify(paths()));
  const up = sent.find(x => x.p === "/api/cmd/upload");
  const rte = (up && up.route) || [];
  check("3c. the upload rejoins the line AIS_RETURN_BACK_M (100 m) back down it from where she left - over water already run - then flies the remainder",
        () => rte.length === 4 && distTo(rte[0], ll(-100, 0)) < 1 && distTo(rte[0], guardHeld_at_mark()) > 99
              && distTo(rte[1], LINE_E.b) < 0.5 && distTo(rte[3], ll(-200, 60)) < 0.5,
        () => rte.length + " wpts; first " + (rte[0] ? distTo(rte[0], ll(-100, 0)).toFixed(1) + " m from the 100 m point, "
            + distTo(rte[0], ll(0, 0)).toFixed(1) + " m from where she left" : "none"));
  check("3d. ... with NONE of the operator's latches: no override, no LOW hold, the record spent, the episode closed",
        () => guardOverride === null && resumeSlow === false && guardHeld === null && aisAvoid === null && S.run === "running",
        () => "override " + JSON.stringify(guardOverride) + ", resumeSlow " + resumeSlow + ", guardHeld " + (guardHeld ? "kept" : "spent")
            + ", episode " + JSON.stringify(aisAvoid) + ", run " + S.run);
  check("3e. ... and it says so, and records it: the banner names the contact clear of the line, the log carries ais_return with the backtrack",
        () => banners.some(b => /SURVEY RESUMED/.test(b) && kindRe.test(b) && /over water already run/.test(b))
              && logged.some(e => e.kind === "ais_return" && e.data.back_m === 100 && e.data.line === 1 && e.data.held_s >= 34),
        () => "banners " + JSON.stringify(banners) + "; logged " + JSON.stringify(logged.filter(e => e.kind === "ais_return")));
  check("3f. ... and NOT at LOW for the rest of the run: the note says nothing about staying slow",
        () => !notes.some(n => /Speed stays low/.test(n)) && notes.some(n => /Survey resumed/.test(n) && kindRe.test(n)),
        () => JSON.stringify(notes));
}
function guardHeld_at_mark() { return ll(0, 0); }

// ── 4. THE OPERATOR'S OWN RESUME IS STILL THE OPERATOR'S (the CONTROL for 3c/3d) ─────────
{
  surveying(7, [CROSSING()]); frame(); nowHolding(); sent = [];
  clock += 60000; aisVessels = [];                  // she is long gone; the operator presses RESUME
  aisAvoid = null;                                  // ... before the console's own return fires
  await resumeHeldSurvey();
  const up = sent.find(x => x.p === "/api/cmd/upload");
  const rte = (up && up.route) || [];
  check("4. CONTROL: the operator's RESUME on the same hold backs 12 boat lengths (92.5 m here), latches LOW and records the override - the console's return is the different one",
        () => rte.length === 4 && Math.abs(distTo(rte[0], ll(0, 0)) - 12 * 7.71) < 1 && resumeSlow === true
              && !!guardOverride && guardOverride.slow === true,
        () => (rte[0] ? distTo(rte[0], ll(0, 0)).toFixed(1) + " m back" : "no upload") + ", resumeSlow " + resumeSlow
            + ", override " + JSON.stringify(guardOverride));
}

// ── 5. A CHARTED HOLD KEEPS TODAY'S OFFER: NOTHING COMES BACK ON ITS OWN ─────────────────
{
  surveying(6, [], { ko: PIER });                   // guard_resume's pier, 30 m north; no contacts
  S.status.cog_deg = 0; S.status.heading_deg = null;   // standing into it, no heading: the straight projection
  frame();
  const held = !!guardHeld;
  nowHolding(); sent = [];
  clock += 60000; frame(); clock += 5000; frame(); await settle();
  check("5. a hold for a charted feature opens no AIS episode, and a minute later nothing has been sent - the offer to the operator stands as it always has",
        () => held && aisAvoid === null && !!guardHeld && sent.length === 0,
        () => "banked " + held + ", episode " + JSON.stringify(aisAvoid) + ", sent " + JSON.stringify(paths()));
}

// ── 6. A CONTACT THAT STOPS ON THE LINE NEVER CLEARS IT ──────────────────────────────────
{
  const parked = contact(30, 0, { sog: 0, cog: null, heading: 90 });   // 30 x 8, sitting across the line 30 m ahead
  surveying(7, [parked]); frame();
  const heldFor = !!aisAvoid;
  nowHolding(); sent = [];
  // the feed keeps answering, and she keeps sitting there
  clock += 30000; aisPolledAt = clock; frame(); clock += 30000; aisPolledAt = clock; frame(); await settle();
  check("6. a contact stopped ON the line ahead holds her and never clears the line: a minute later nothing has come back, the episode still stands",
        () => heldFor && !!aisAvoid && aisAvoid.clearSince === 0 && sent.length === 0,
        () => "episode " + JSON.stringify(aisAvoid) + ", sent " + JSON.stringify(paths()));
  // THE FEED GOES QUIET WHILE SHE HOLDS. The model empties, and an empty model reads "clear of the
  // line" - which is a dead feed read as a quiet sea, the fault this console has met before. The first
  // draft of the return fired here; this check is why it does not.
  clock += 50000; frame(); clock += 4100; frame(); await settle();
  check("6c. the feed goes STALE while she holds for her: the return does NOT fire on an empty model - she keeps holding, and the blind banner says why",
        () => !!aisAvoid && aisAvoid.clearSince === 0 && sent.length === 0 && aisKoStale === true
              && banners.some(b => /AIS KEEP-OUTS BLIND/.test(b)),
        () => "episode " + JSON.stringify(aisAvoid) + ", sent " + JSON.stringify(paths()) + ", stale " + aisKoStale
            + ", banners " + JSON.stringify(banners.filter(b => /BLIND/.test(b))));
  aisVessels = [contact(30, 80, { sog: 0, cog: null, heading: 90 })];    // the feed is back, and she has moved off the line
  aisPolledAt = clock;
  frame(); clock += 4100; aisPolledAt = clock; frame(); await settle();
  check("6b. ... and when the feed answers again with her off the line, the return goes",
        () => paths().includes("/api/cmd/upload") && paths().includes("/api/cmd/start") && aisAvoid === null,
        () => "sent " + JSON.stringify(paths()));
}

// ── 7. NO DEVIATION AROUND A CONTACT (the charted twin DOES deviate) ─────────────────────
{
  // guard_resume's deviating() geometry: a corner two waypoints ahead that fouls a 60 x 40 m block.
  const FOUR = [{ e: -105, n: 0 }, { e: -105, n: 15 }, { e: -7, n: 15 }, { e: -7, n: 80 }];
  const block = (() => { const r = [{ e: 0, n: -20 }, { e: 60, n: -20 }, { e: 60, n: 20 }, { e: 0, n: 20 }];
    return { polys: [{ ring: r, bb: bbOf(r), kind: "a dock / pier" }], lines: [], points: [], marks: [], sys: [], chans: [] }; })();
  function deviating(ko, vessels) {
    surveying(7, vessels, { ko });
    mission.lines = []; runLineIdx = -1;
    asv = ll(-120, 0); runRoute = FOUR.map(w => ll(w.e, w.n)); window._wpIndex = 0;
    edgeSpentM = 0;                                  // the deviation budget is UNSPENT here
  }
  deviating(block, []); frame();
  const charted = clearance.level, chartedSent = paths().slice();
  // the same 60 x 40 m footprint as a contact: a 60 x 40 m hull, heading east, antenna amidships
  const hull = contact(30, 0, { sog: 0, cog: null, heading: 90, dim: { a: 30, b: 30, c: 20, d: 20 }, length: 60, beam: 40 });
  deviating(OPEN, [hull]); frame();
  check("7. the same block as a charted pier is DEVIATED around; as a contact it is not - the ladder answers with slow or hold instead",
        () => charted === "edge" && chartedSent.includes("/api/cmd/amend")
              && clearance.level !== "edge" && !paths().includes("/api/cmd/amend")
              && (clearance.level === "slow" || clearance.level === "hold"),
        () => "charted: " + charted + " " + JSON.stringify(chartedSent) + "; contact: " + clearance.level + " " + JSON.stringify(paths()));
}

// ── 8. A STALE FEED IS AN EMPTY MODEL THAT SAYS SO ───────────────────────────────────────
{
  surveying(7, [CROSSING()], { polledAt: clock - 50000 });
  frame();
  check("8. a poll 50 s old models NO contacts - the crossing workboat does not hold her - and the model says it is stale",
        () => !paths().includes("/api/cmd/hold") && clearance.level === "clear" && aisKoStale === true && aisKoDrawn.length === 0
              && /50 s old/.test(aisKoNote),
        () => "level " + clearance.level + ", sent " + JSON.stringify(paths()) + ", stale " + aisKoStale + ": " + aisKoNote);
  check("8b. ... not said on the first frame (the feed has AIS_KO_STALE_S to answer)",
        () => !banners.some(b => /AIS KEEP-OUTS BLIND/.test(b)), () => JSON.stringify(banners));
  clock += 41000; frame();
  check("8c. ... and after AIS_KO_STALE_S under way with no answer, it IS said - once - as a banner",
        () => banners.filter(b => /AIS KEEP-OUTS BLIND/.test(b)).length === 1 && (frame(), banners.filter(b => /AIS KEEP-OUTS BLIND/.test(b)).length === 1),
        () => JSON.stringify(banners));
  aisPolledAt = clock; frame();
  check("8d. ... and the feed's return is a note, and the contact is modelled again",
        () => notes.some(n => /AIS keep-outs restored/.test(n)) && aisKoDrawn.length === 1 && aisKoStale === false,
        () => JSON.stringify(notes) + "; modelled " + aisKoDrawn.length);
}

// ── 9. THE HELM: A CONTACT BEARING DOWN, AND THE MODEL THE ESCAPE SEARCHES ───────────────
{
  // northbound at 6 kn, 40 m south of the boat: her sweep already covers where the boat is.
  surveying(7, [contact(0, -40, { sog: 6, cog: 0, heading: 0 })]);
  escFake = { hdg: 90, to: { e: 60, n: 0 }, m: 60, capped: false, clear: true, survived: 45, worst: 30, gain: 30 };
  frame();
  const first = clearance.level;
  clock += 1600; const r9 = frame();                 // past HELM_DWELL_MS: the rung acts
  check("9. a contact bearing down reads IN EXTREMIS, and after the dwell the escape is commanded",
        () => first === "helm" && paths().includes("/api/cmd/escape") && !r9.raised,
        () => "first frame " + first + ", sent " + JSON.stringify(paths()) + (r9.raised ? "; RAISED " + r9.raised : ""));
  check("9b. ... the escape's search was handed the model WITH the contact in it (koAll), never the charted one alone",
        () => !!escKo && escKo.polys.some(q => kindRe.test(q.kind)),
        () => escKo ? escKo.polys.length + " polys: " + JSON.stringify(escKo.polys.map(q => q.kind)) : "escapeCourse never asked");
  check("9c. ... and the episode opens on the helm rung too, with the survey banked",
        () => !!aisAvoid && aisAvoid.rung === "helm" && !!guardHeld && notes.some(n => /Steered clear of AIS: WORKBOAT/.test(n)),
        () => "episode " + JSON.stringify(aisAvoid) + ", banked " + !!guardHeld + ", notes " + JSON.stringify(notes));
}

// ── 10. A GO-TO STOPPED FOR A CONTACT HAS NO SURVEY TO COME BACK TO ──────────────────────
{
  surveying(7, [CROSSING()], { behavior: "goto" }); frame();
  check("10. a Go-To held for a contact banks nothing and opens no episode - the boat holds and the operator re-commands, as before",
        () => paths().includes("/api/cmd/hold") && guardHeld === null && aisAvoid === null,
        () => "sent " + JSON.stringify(paths()) + ", banked " + !!guardHeld + ", episode " + JSON.stringify(aisAvoid));
}

// ── 11. THE READOUT MEASURES AGAINST THE CONTACTS TOO ────────────────────────────────────
{
  surveying(7, [contact(0, 14, { sog: 0, cog: null, heading: 90 })]);   // 30 x 8 heading east, her side 10 m north of the boat
  frame();
  const near = clearance.m;
  surveying(7, [contact(0, 6, { sog: 0, cog: null, heading: 90 })]);    // her side 2 m north: inside the buffer
  frame();
  check("11. the clearance readout measures to the contact's hull (10 m off her side reads 10 m), and inside the buffer names her",
        () => Math.abs(near - 10) < 0.1 && clearance.m < 3 && clearance.kind && /^AIS: WORKBOAT/.test(clearance.kind),
        () => "10 m case " + (near == null ? "null" : near.toFixed(2)) + " m; 2 m case " + (clearance.m == null ? "null" : clearance.m.toFixed(2)) + " m, kind " + clearance.kind);
  surveying(7, []); frame();
  check("11b. ... and with no contacts the readout is open water, as it always was",
        () => clearance.m === __clearCap() && clearance.kind === null, () => clearance.m + " m of " + __clearCap() + ", kind " + clearance.kind);
}

// ── 12. THE CONTACTS ARE POLLED WHENEVER THE CONSOLE HAS AUTHORITY, LAYER OR NO LAYER ─────
{
  surveying(7, []); aisShow = false;
  const armedOff = aisWanted();
  S.armed = false; const disarmed = aisWanted();
  S.armed = true; S.estop = true; const estopped = aisWanted();
  S.estop = false;
  check("12. the poll is wanted while armed with the layer OFF, and not once disarmed or e-stopped",
        () => armedOff === true && disarmed === false && estopped === false,
        () => "armed " + armedOff + ", disarmed " + disarmed + ", e-stopped " + estopped);
  const realFetch = globalThis.fetch;
  let reply = { ok: true, vessels: [CROSSING()], area: { mode: "sea" }, sources: { nmea: { state: "ok" } } };
  globalThis.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reply) });
  aisPolledAt = 0; aisVessels = [];
  await pollAIS();
  const polled = aisPolledAt, got = aisVessels.length;
  reply = { ok: false, vessels: [], note: "AIS service offline" };
  clock += 5000; await pollAIS();
  check("12b. an answered poll fills the contacts and moves the DR clock; an OFFLINE answer moves nothing, so the model goes stale rather than empty",
        () => polled === clock - 5000 && got === 1 && aisPolledAt === clock - 5000 && aisState === "offline",
        () => "polled at " + polled + " with " + got + " contact(s); after the offline answer clock " + aisPolledAt + ", state " + aisState);
  globalThis.fetch = realFetch;
  aisVessels = [CROSSING()];
  setAIS(false);
  const keptArmed = aisVessels.length;
  S.armed = false; setAIS(false);
  check("12c. turning the layer off keeps the contacts while the console is armed, and drops them once it is not",
        () => keptArmed === 1 && aisVessels.length === 0, () => "armed: " + keptArmed + " kept; disarmed: " + aisVessels.length);
}

Date.now = realNow;
console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
})().catch(__crash);
