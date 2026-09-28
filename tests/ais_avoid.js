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
var edgeSearchAt = 0;                                   // when the deviation SEARCH last ran (2026-09-26)
var searchCount = 0;                                    // how many times the ladder asked for the search (check 23)
// THE AIS KEEP-OUTS (2026-09-25). clearanceGuard builds the contacts' model every frame and asks the
// return tick above every branch, so the names must exist or the guard is a bare ReferenceError. No
// contacts live in this world - the model is empty and every check here is the charted world it always
// was. `aisPolledAt` is a poll that is always fresh: an EMPTY model, never a STALE one, so the blind
// banner cannot land in a check that counts banners (tests/ais_avoid.js owns the stale case).
var aisVessels = [], aisPolledAt = 0, aisShow = false, aisAvoid = null;
var aisKoDrawn = [], aisKoNote = null, aisKoStale = false, aisKoBlindSaid = false, aisKoWantedAt = 0;
const { aisKeepouts, aisAvoidKeepouts, aisAvoidKeepout, AIS_KO_STALE_S } = require("../static/js/ais_keepout.js");
const { clearanceM } = require("../static/js/keepouts.js");
// The hold rung snapshots its own latches before writing them (2026-09-22), so a refusal
// can put them back. `slowLieu` is one of them and is READ before anything writes it.
var slowLieu = null;
var planIntent = { why: [] }, notes = [], banners = [], logged = [], violations = null;
var nogo = { ready: true, frame: null, ko: null, buffer: 5 };
var confirmAnswer = true, confirmAsked = 0, lastResume = null, lastContinue = null;

// The guard's own imports, REAL - the rungs are only worth driving against the real assess.
// The real assess, counting the frames that asked it to SEARCH for a deviation (check 23 reads the count).
const guardAssess = (p, v, d, ko, buf, o) => { if (o && o.edge) searchCount++; return G.assess(p, v, d, ko, buf, o); },
      groundVel = G.groundVel, restoreVel = G.restoreVel,
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
// RESUME FROM HERE AND THE WAY ROUND (2026-09-27): the chart's scale for the snap (IDENTIFY_PX at zoom 16
// and this latitude is ~24 m), the menu row and its key as stub elements a check can read back, and the
// helpers the held path calls on its way in. The router stub below records what it was ASKED (from, to,
// opts): the way round a contact is a statement about the MODEL the router was handed, and the router's
// own geometry with an explicit model is planner_guard_seam.js 7d's subject.
var center = { lat: 43.07, lon: -70.76 }, zoom = 16;
function ensureNogoCovers() { return Promise.resolve(); }
function heldOffWhy(h) { return "the point sits inside " + ((h && h.kind) || "a keep-out"); }
function takeDownBanner() {}
const CM = {};
function cmEl(kid) { const set = new Set();
  return { textContent: "", style: { display: "none" },
           classList: { toggle(c, on) { on ? set.add(c) : set.delete(c); return !!on; }, contains(c) { return set.has(c); },
                        add(c) { set.add(c); }, remove(c) { set.delete(c); } },
           querySelector() { return kid ? CM[kid] : null; } }; }
CM["#cmResumeK"] = cmEl(null); CM["#cmResume"] = cmEl("#cmResumeK");   // both up front: the row's key is its child
// ROUTE ROUND HER (2026-09-27): the row over a contact, its label and its key
CM["#cmAvoidK"] = cmEl(null); CM["#cmAvoidLbl"] = cmEl(null); CM["#cmAvoid"] = cmEl("#cmAvoidK");

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
function planNogoRoute(from, to, opts) {
  pinCalls.push({ from, to, opts });
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
  if (CM[sel]) return CM[sel];
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
  grab("indexedRoute"), grab("lineMark"), grab("markGuardHeld"), grabDecl("HELD_GRACE_MS"), grab("guardHeldOffer"),
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
  grab("slowestMakingWayKey"), grab("slowKeyFor"), grab("setMsNow"), grab("makesWayKey"),   // the slow-down that makes way (2026-09-26)
  grab("guardOverrideOk"), grab("guardTrack"), grab("clearanceGuard"),
  // the AIS keep-outs and the return (2026-09-25) - asked every frame, above every branch
  grab("aisGuardWanted"), grab("aisKeepoutsNow"), grab("aisNearestKind"), grab("aisNearestPoly"), grab("aisAvoidOpen"),
  grabDecl("OVERRIDE_STALE_MS"), grab("guardHazardKey"), grab("releaseLow"), grabDecl("guardKeyLast"),   // the override's four endings and the latch's release (2026-09-28)
  "function __overrideStale(){ return OVERRIDE_STALE_MS; }",
  "function __keyLast(){ return guardKeyLast; }",
  grab("aisReturnTick"), grab("logClient"),
  // the way round a contact that stays, and the operator's point beyond her (2026-09-27)
  grabDecl("AIS_AROUND_AFTER_MS"), grabDecl("AIS_AROUND_STEP_M"), grab("koWithAis"), grab("aisAroundPlan"), grab("aisAroundTick"),
  // the way round ON DEMAND (2026-09-27): the held path split out of the tick, the bar's button, the row over a
  // contact, and the running plan amended round her - aisAroundTick calls aisAroundGo every minute, so the
  // bundle needs it or the automatic way round (14-14d) is a swallowed ReferenceError inside frame()
  grab("aisAroundGo"), grab("aisAroundNow"), grabDecl("aisAroundBusy"), grab("contactAt"), grab("avoidWhy"),
  grab("gateAvoidRow"), grab("avoidContactAt"), grab("aisAroundRunning"),
  grabDecl("IDENTIFY_PX"), grabDecl("LINE_MATCH_M"), grab("onLineM"), grab("cmGate"), grab("linkConnected"), grab("canCommand"),
  grab("resumeHereAt"), grab("legOfLine"), grab("alongAsRun"), grab("gateResumeHere"), grab("resumeFromHere"),
  grab("patClipBufM"), "const guardStandoffM = G.guardStandoffM;",
  grab("aisWanted"), grab("pollAIS"), grab("setAIS"),
  // the escape rung runs to its POST here (guard_resume stops at the refused search), so its helper
  grab("notTookSay"),
  "function __clearCap(){ return CLEAR_CAP_M; }",
  grabDecl("AIS_RETURN_BACK_M"), grabDecl("AIS_RETURN_DWELL_MS"),
  grab("renderGuardBar"), grab("renderHeldBar"), grab("lowLatched"),
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
  clock += 30000; aisPolledAt = clock; frame(); await settle();
  // (half a minute: at a full minute the console routes ROUND a contact that stays - 2026-09-27, check 14)
  check("6. a contact stopped ON the line ahead holds her and never clears the line: half a minute on nothing has come back, the episode still stands",
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
  const up6b = sent.find(x => x.p === "/api/cmd/upload"), rte6b = (up6b && up6b.route) || [];
  check("6b. ... and when the feed answers again with her off the line, the RETURN goes - 100 m back down the line, not the way round from where she left it",
        () => paths().includes("/api/cmd/upload") && paths().includes("/api/cmd/start") && aisAvoid === null
              && rte6b.length > 0 && distTo(rte6b[0], ll(-100, 0)) < 1,
        () => "sent " + JSON.stringify(paths()) + "; rejoin " + (rte6b[0] ? distTo(rte6b[0], ll(-100, 0)).toFixed(1) + " m from the 100 m point" : "none"));
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
  // Andy, 2026-09-27: "an avoidance maneuver of a radius equal to the length or the estimated length of the vessel"
  check("9d. ... and the model the escape searches is the AVOIDANCE model - her hull grown by her own length (30 m here), so the point it steers to is a ship-length clear of her",
        () => !!escKo && escKo.polys.length === 1 && escKo.polys[0].avoidM === 30 && /30 m round her/.test(escKo.polys[0].kind),
        () => escKo ? JSON.stringify(escKo.polys.map(q => [q.kind, q.avoidM])) : "escapeCourse never asked");
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

// ── 13-15. A CONTACT THAT STAYS: THE THREE ANSWERS (Andy, 2026-09-27) ────────────────────────
// KLEOS sat across line 8 at New Castle and the survey held for her; his pause then SPENT the banked
// survey, and "Resume from here" had nowhere to go. His three: (1) the same line where she left it -
// refused, she would meet the contact again; (2) the operator's point BEYOND the contact - routed round
// her, the survey continues from there; (3) no answer in 60 s - the console routes round her itself, as if
// she were a buoy or a dock, and carries on. A contact that clears the line first keeps the 100 m return
// (check 3). Never on a stale model, never while paused, not twice in a minute.
const PARKED = () => contact(30, 0, { sog: 0, cog: null, heading: 90 });   // 30 x 8 across the line: her hull is e = 15..45
const nearRe = /WORKBOAT/;
{
  // 13. THE OFFER SURVIVES A PAUSE, AND THE BAR SAYS THE CONSOLE WAITS
  surveying(7, [PARKED()]); frame(); nowHolding();
  const kept = guardHeld;
  S.run = "paused";
  const pausedOffer = guardHeldOffer();
  clock += 61000; aisPolledAt = clock; sent = []; frame(); await settle();
  renderGuardBar({ level: "blind" }, clearance);
  const pausedWhy = $("#gb_why").textContent;
  check("13. a PAUSED hold keeps the guard's offer - the survey she was holding is not what the pause changed - and neither return fires while she is paused; the bar says the console waits",
        () => !!kept && pausedOffer === kept && guardHeld === kept && sent.length === 0 && !!aisAvoid
              && /once you resume the hold/.test(pausedWhy),
        () => "offer " + (pausedOffer ? "stands" : "GONE") + ", sent " + JSON.stringify(paths()) + ", bar: " + pausedWhy);
  // 13c. ... AND THE RETURN WAITS TOO: she clears the line while the boat is paused - nothing; resume the hold - the return goes
  aisVessels = [contact(30, 90, { sog: 0, cog: null, heading: 90 })]; aisPolledAt = clock;   // moved 90 m north, off the line
  frame(); clock += 4100; aisPolledAt = clock; frame(); clock += 4100; aisPolledAt = clock; frame(); await settle();
  const whilePaused = paths().slice();
  S.run = "running";
  frame(); clock += 4100; aisPolledAt = clock; frame(); await settle();
  check("13c. ... and the 100 m return waits while she is paused too, however clear the line reads - and goes once the hold is resumed",
        () => whilePaused.length === 0 && paths().includes("/api/cmd/upload") && paths().includes("/api/cmd/start") && aisAvoid === null,
        () => "paused: sent " + JSON.stringify(whilePaused) + "; resumed: sent " + JSON.stringify(paths()));

  // 13b. THE BAR NAMES THE OTHER TWO ANSWERS WITH THE TIME LEFT
  surveying(7, [PARKED()]); frame(); nowHolding();
  clock += 23000; aisPolledAt = clock; frame();
  renderGuardBar({ level: "blind" }, clearance);
  const why23 = $("#gb_why").textContent;
  check("13b. ... running, the bar says what she is holding for, that the way back is the console's, that the operator may right-click the line BEYOND her, and how long before the console routes round her itself",
        () => /holding for AIS: WORKBOAT/.test(why23) && /resumes on its own/.test(why23) && /100 m back/.test(why23)
              && /right-click the line BEYOND her/.test(why23) && /routes round her itself in 3[5-7] s/.test(why23),
        () => why23);
}
{
  // 14. OPTION 3: A MINUTE ON, THE CONSOLE ROUTES ROUND HER
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 30000; aisPolledAt = clock; frame(); await settle();
  const at30 = paths().slice();
  clock += 31000; aisPolledAt = clock; frame(); await settle();
  const up = sent.find(x => x.p === "/api/cmd/upload"), rte = (up && up.route) || [];
  const ask = pinCalls[pinCalls.length - 1];
  check("14. sixty seconds on with her still across the line, the console routes round her: pause, upload, LOW, Start - and nothing at thirty",
        () => at30.length === 0 && paths().indexOf("/api/cmd/pause") === 0
              && paths().indexOf("/api/cmd/pause") < paths().indexOf("/api/cmd/upload")
              && paths().indexOf("/api/cmd/upload") < paths().indexOf("/api/cmd/start"),
        () => "at 30 s: " + JSON.stringify(at30) + "; at 61 s: " + JSON.stringify(paths()));
  // A SHIP-LENGTH ROUND HER (Andy, 2026-09-27): the rejoin clears her hull by her own length, not by the standoff alone
  check("14b. ... the upload picks the line up at the first point BEYOND her that is clear of her avoidance ring by the standoff with the rest of the line clear too (e = 80: her hull ends at 45, her length is 30, the standoff is 3), then flies the remainder",
        () => rte.length === 4 && distTo(rte[0], ll(80, 0)) < 0.5 && distTo(rte[1], LINE_E.b) < 0.5 && distTo(rte[3], ll(-200, 60)) < 0.5,
        () => rte.length + " wpts; first " + (rte[0] ? distTo(rte[0], ll(80, 0)).toFixed(1) + " m from (80, 0)" : "none"));
  check("14c. ... and the way in was asked of the router with HER in the model (koWithAis) as her avoidance ring - her length round her - at the standoff; the charted model alone would have sent her straight through her",
        () => !!ask && !!ask.opts && !!ask.opts.ko && ask.opts.ko.polys.length === 1 && nearRe.test(ask.opts.ko.polys[0].kind || "")
              && ask.opts.ko.polys[0].avoidM === 30 && /30 m round her/.test(ask.opts.ko.polys[0].kind)
              && ask.opts.standoffM === 3 && distTo(ask.from, ll(0, 0)) < 0.5 && distTo(ask.to, ll(80, 0)) < 0.5,
        () => "asked " + JSON.stringify(ask && { from: ask.from, to: ask.to, ko: ask.opts && ask.opts.ko && ask.opts.ko.polys.map(p => p.kind),
                                                  standoff: ask.opts && ask.opts.standoffM }));
  check("14d. ... with none of the operator's latches, the record spent, the episode closed, and it is said and recorded as ais_around with what was left under her",
        () => guardOverride === null && resumeSlow === false && guardHeld === null && aisAvoid === null && S.run === "running"
              && banners.some(b => /ROUTED ROUND/.test(b) && nearRe.test(b) && /80 m of coverage left under/.test(b))
              && logged.some(e => e.kind === "ais_around" && e.data.skip_m === 80 && e.data.line === 1 && e.data.skip_line === false && e.data.held_s >= 60),
        () => "override " + JSON.stringify(guardOverride) + ", resumeSlow " + resumeSlow + ", episode " + JSON.stringify(aisAvoid)
            + ", banners " + JSON.stringify(banners.filter(b => /ROUTED/.test(b))) + ", logged " + JSON.stringify(logged.filter(e => e.kind === "ais_around")));

  // 14e. THE CONTACT CLEARS FIRST: THE 100 m RETURN WINS, AND NO WAY ROUND FOLLOWS
  surveying(7, [CROSSING()]); frame(); nowHolding(); sent = []; logged = [];
  const her2 = (t) => { aisVessels = [contact(34, -60 + 3.087 * t, { sog: 6, cog: 0, heading: 0 })]; aisPolledAt = clock; };
  clock += 30000; her2(30); frame(); clock += 4100; her2(34.1); frame(); await settle();
  const returned = paths().includes("/api/cmd/upload"), afterReturn = sent.length;
  clock += 30000; her2(64); frame(); await settle();
  check("14e. a contact that CLEARS the line inside the minute gets the 100 m return, and no way round follows it",
        () => returned && sent.length === afterReturn && aisAvoid === null && !logged.some(e => e.kind === "ais_around"),
        () => "returned " + returned + ", later commands " + (sent.length - afterReturn) + ", episode " + JSON.stringify(aisAvoid));

  // 14f. STALE: NOTHING, HOWEVER LONG
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = [];
  clock += 61000; frame(); await settle();          // no poll answered for 61 s: the model is stale and EMPTY
  check("14f. a stale feed gets no way round either, however long she has held - an empty model is not a clear line (aisReturnTick's rule)",
        () => aisKoStale === true && sent.length === 0 && !!aisAvoid,
        () => "stale " + aisKoStale + ", sent " + JSON.stringify(paths()) + ", episode " + (aisAvoid ? "open" : "closed"));

  // 14g. SHE COVERS THE REST OF THE LINE: THAT LINE IS LEFT, THE PLAN PICKED UP AT ITS NEXT WAYPOINT
  const LONG = contact(115, 0, { sog: 0, cog: null, heading: 90, dim: { a: 100, b: 100, c: 4, d: 4 }, length: 200, beam: 8 });   // e = 15..215
  surveying(7, [LONG]); frame(); nowHolding(); sent = []; logged = []; banners = [];
  clock += 61000; aisPolledAt = clock; frame(); await settle();
  const up2 = sent.find(x => x.p === "/api/cmd/upload"), rte2 = (up2 && up2.route) || [];
  check("14g. a contact covering the rest of the line: that line is LEFT and the plan is picked up at the waypoint after its end - said, and recorded as skip_line",
        () => rte2.length === 2 && distTo(rte2[0], ll(200, 60)) < 0.5 && distTo(rte2[1], ll(-200, 60)) < 0.5
              && banners.some(b => /ROUTED ROUND/.test(b) && /is covered by/.test(b) && /picked up at its next waypoint/.test(b))
              && logged.some(e => e.kind === "ais_around" && e.data.skip_line === true),
        () => rte2.length + " wpts: " + JSON.stringify(rte2.map(p => { const q = llEN(p.lat, p.lon, ref); return [Math.round(q.e), Math.round(q.n)]; }))
            + "; " + JSON.stringify(banners.slice(-1)));

  // 14h. NO WAY ROUND: SAID, STILL HOLDING, TRIED AGAIN A MINUTE LATER - NOT EVERY FRAME
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; banners = []; pinCalls = [];
  pinNext = { error: "no clear route to the target - every path crosses AIS: WORKBOAT", reason: {} };
  clock += 61000; aisPolledAt = clock; frame(); await settle();
  const said1 = banners.filter(b => /CANNOT RESUME FROM HERE/.test(b)).length, sent1 = paths().slice(), tries1 = pinCalls.length;
  clock += 30000; aisPolledAt = clock; frame(); await settle();
  const tries2 = pinCalls.length;
  clock += 31000; aisPolledAt = clock; frame(); await settle();
  const tries3 = pinCalls.length;
  pinNext = null;
  check("14h. no way round her: nothing is sent, she keeps holding with the offer and the episode standing, it is said, and the router is asked again a minute later - a contact moves - not every frame",
        () => sent1.length === 0 && said1 === 1 && tries1 === 1 && !!guardHeld && !!aisAvoid && tries2 === 1 && tries3 === 2,
        () => "sent " + JSON.stringify(sent1) + ", said " + said1 + ", router asked " + tries1 + " / " + tries2 + " / " + tries3 + " times at 61 / 91 / 122 s");
}
{
  // 15. OPTION 2: THE OPERATOR'S POINT BEYOND HER
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 10000; aisPolledAt = clock; frame();
  gateResumeHere(ll(120, 3));
  const rowShown = $("#cmResume").style.display !== "none", rowOff = $("#cmResume").classList.contains("off"), key = $("#cmResumeK").textContent;
  check("15. while the guard holds the survey for her, Resume from here is SHOWN and LIVE on the chart menu - the operator's answer - with the point named",
        () => rowShown && !rowOff && key === "320 m along L1",
        () => "shown " + rowShown + ", off " + rowOff + ", key '" + key + "'");
  await resumeFromHere(ll(120, 3));                 // 3 m off the line, 75 m beyond her hull
  await settle();
  const up3 = sent.find(x => x.p === "/api/cmd/upload"), rte3 = (up3 && up3.route) || [], ask3 = pinCalls[pinCalls.length - 1];
  check("15b. a point BEYOND her goes the held path: pause, upload from that point, LOW, Start - not an amendment - with the way in asked of the router with her in the model, at the standoff",
        () => !paths().includes("/api/cmd/amend") && paths().indexOf("/api/cmd/pause") === 0
              && paths().indexOf("/api/cmd/upload") < paths().indexOf("/api/cmd/start")
              && rte3.length === 4 && distTo(rte3[0], ll(120, 0)) < 0.5 && distTo(rte3[1], LINE_E.b) < 0.5
              && !!ask3 && !!ask3.opts && !!ask3.opts.ko && ask3.opts.ko.polys.length === 1 && ask3.opts.standoffM === 3 && distTo(ask3.to, ll(120, 0)) < 0.5,
        () => "sent " + JSON.stringify(paths()) + "; upload " + rte3.length + " wpts from " + (rte3[0] ? distTo(rte3[0], ll(120, 0)).toFixed(1) + " m of (120,0)" : "none")
            + "; asked " + JSON.stringify(ask3 && { to: ask3.to, ko: ask3.opts && ask3.opts.ko && ask3.opts.ko.polys.length }));
  check("15c. ... with no latch (the governor has the throttle), the record spent, the episode closed, said and logged as a resume from a point on a held survey",
        () => guardOverride === null && resumeSlow === false && guardHeld === null && aisAvoid === null
              && notes.some(n => /Survey resumed from the point you chose on line 1 \(320 m along it\)/.test(n) && /transit speed/.test(n))
              && logged.some(e => e.kind === "resume" && e.data.from_point === true && e.data.held === true && e.data.along_m === 320 && nearRe.test(e.data.kind || "")),
        () => "override " + JSON.stringify(guardOverride) + ", resumeSlow " + resumeSlow + ", notes " + JSON.stringify(notes.slice(-1))
            + ", logged " + JSON.stringify(logged.filter(e => e.kind === "resume")));

  // 15d. OPTION 1: THE NEAR SIDE IS REFUSED
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; banners = []; pinCalls = [];
  clock += 10000; aisPolledAt = clock; frame();
  await resumeFromHere(ll(8, 2));                   // 7 m short of her hull: the line from there runs into her
  const nearSent = paths().slice(), nearSaid = banners.filter(b => /NEAR SIDE/.test(b));
  await resumeFromHere(ll(30, 2));                  // ON her
  const onSent = paths().slice(), onSaid = banners.filter(b => /NEAR SIDE/.test(b));
  await resumeFromHere(ll(60, 2));                  // 15 m beyond her hull, inside her LENGTH (the ring reaches e = 75)
  const inLenSent = paths().slice(), inLenSaid = banners.filter(b => /NEAR SIDE/.test(b));
  check("15d. a point on the NEAR side of her, on her, or within her own length of her is refused in words - she would only be stopped again - with the time left before the console acts; nothing is sent, the offer and the episode stand",
        () => nearSent.length === 0 && nearSaid.length === 1 && /routes round her itself in 50 s/.test(nearSaid[0])
              && onSent.length === 0 && onSaid.length === 2 && inLenSent.length === 0 && inLenSaid.length === 3
              && !!guardHeld && !!aisAvoid && pinCalls.length === 0,
        () => "near: sent " + JSON.stringify(nearSent) + ", " + JSON.stringify(nearSaid) + "; on her: said " + onSaid.length
            + "; within her length: sent " + JSON.stringify(inLenSent) + ", said " + inLenSaid.length);
}

// ── 16. KLEOS (Andy's console, 2026-09-27 20:54:30): THE ESCAPE, AND THE HOLD 0.44 s LATER THAT CANCELLED IT ──
// His log: the helm rung escaped her from KLEOS at 20:54:30.299 and the hold rung held her at 20:54:30.741 - the
// next frame - reading "entry in 0 s under way, but on drift alone it is 0 s away and stays outside half the
// buffer": from INSIDE the buffer the track enters at once whatever the heading. The hold replaced the escape's
// plan with the point she stood on, 2.6 m off the contact, and she stayed there all evening. The lower rungs stand
// down while an escape is in flight; the offer stands once she is on station; the way round goes at the minute.
{
  // the boat on line 1 at (0,0) heading east at 7 kn, INSIDE a 30 x 8 m hull parked with her center 6 m ahead
  // (hull e = -9..21). No set on this first frame: in extremis, and after the dwell the escape.
  surveying(7, [contact(6, 0, { sog: 0, cog: null, heading: 90 })]);
  escFake = { hdg: 0, to: { e: 0, n: 60 }, m: 60, capped: false, clear: true, survived: 45, worst: 30, gain: 30 };
  frame(); clock += 1600; frame();
  const escaped = paths().includes("/api/cmd/escape"), banked = !!guardHeld, episode = !!aisAvoid;
  // THE NEXT FRAME AS HIS CONSOLE SAW IT: the vessel reports "escape", not yet on station; the hull 2.6 m off her
  // side (inside the 3 m buffer, outside the 1.5 m near buffer), heading still into her, the set carrying her away.
  S = { ...S, behavior: "escape", status: { ...S.status, cog_deg: 180, heading_deg: 180, sog_kn: 3,
                                            env_set_deg: 0, env_set_kn: 1.0, holding: false } };
  asv = ll(0, 6.6);
  clock += 400; sent = []; const r16 = frame();
  const afterEsc = paths().slice(), lvl16 = clearance.level;
  check("16. an escape in flight is NOT cancelled by the hold rung on the next frame: inside her buffer the level reads hold, and nothing is sent - she keeps the helm the escape took, the survey and the episode stand",
        () => escaped && banked && episode && lvl16 === "hold" && afterEsc.length === 0 && !r16.raised && !!guardHeld && !!aisAvoid,
        () => "escaped " + escaped + ", banked " + banked + ", episode " + episode + "; next frame: level " + lvl16 + ", sent "
            + JSON.stringify(afterEsc) + (r16.raised ? ", RAISED " + r16.raised : "") + "; record " + (guardHeld ? "stands" : "GONE"));
  // 16a. a frame that reads SLOW during the escape (she is 86 m off her, heading into her at 7 kn: entry in ~24 s)
  // sends no speed command either - slowing an escape at HIGH is the opposite of it
  S = { ...S, status: { ...S.status, cog_deg: 180, heading_deg: 180, sog_kn: 7, env_set_kn: 0 } };
  asv = ll(0, 90); clock += 1000; frame();
  const slowLvl = clearance.level, slowSent = paths().slice();
  check("16a. ... nor does the SLOW rung touch the throttle while the escape is in flight: a frame reading slow sends no speed command",
        () => slowLvl === "slow" && !slowSent.some(p => p === "/api/cmd/speed") && slowSent.length === 0,
        () => "level " + slowLvl + ", sent " + JSON.stringify(slowSent));
  // six seconds on, still under way on the escape: still nothing from the lower rungs
  clock += 6000; asv = ll(0, 30); frame();
  const stillNothing = paths().length === 0;
  // she arrives on station: the offer stands, the bar says so, the episode is still open for the minute
  // (the set comes off with the arrival, so the standoff below is the 3 m buffer: in the 1 kn set it was 11.8 m)
  S = { ...S, status: { ...S.status, sog_kn: 0, cog_deg: null, holding: true, env_set_kn: 0 } }; asv = ll(0, 60);
  clock += 5000; aisPolledAt = clock; frame();
  const offer16 = guardHeldOffer();
  renderGuardBar({ level: "blind" }, clearance);
  const bar16 = $("#gb_rung").textContent + " " + $("#gb_why").textContent;
  check("16b. ... under way on the escape the lower rungs stay silent, and once she is on station the banked survey is OFFERED - SURVEY HELD, STEERED CLEAR, holding for her - with the episode open",
        () => stillNothing && !!offer16 && /SURVEY HELD/.test(bar16) && /STEERED CLEAR/.test(bar16) && /holding for AIS: WORKBOAT/.test(bar16) && !!aisAvoid,
        () => "later commands " + JSON.stringify(paths()) + "; offer " + (offer16 ? "stands" : "GONE") + "; bar: " + bar16.slice(0, 170));
  clock += 61000; aisPolledAt = clock; sent = []; frame(); await settle();
  const up16 = sent.find(x => x.p === "/api/cmd/upload"), rte16 = (up16 && up16.route) || [];
  check("16c. ... and at the minute the way round goes from the escape point, rejoining line 1 a ship-length beyond her (e = 55: her hull ends at 21, her length is 30, the standoff is 3), the record spent, the episode closed",
        () => rte16.length === 4 && distTo(rte16[0], ll(55, 0)) < 0.5 && distTo(rte16[1], LINE_E.b) < 0.5 && guardHeld === null && aisAvoid === null,
        () => rte16.length + " wpts; first " + (rte16[0] ? distTo(rte16[0], ll(55, 0)).toFixed(1) + " m from (55, 0)" : "none") + "; sent " + JSON.stringify(paths()));
  // 16d. THE RING ITSELF: her hull grown by her own length on every side - the guard's model stays the bare hull
  const q16 = aisKeepouts([contact(0, 0, { sog: 0, cog: null, heading: 90 })], ref, { now: clock, polledAt: clock, sweepS: 45 }).polys[0];
  const ring16 = aisAvoidKeepout(q16), M16 = { polys: [ring16], lines: [], points: [] };
  const assumed = aisAvoidKeepout(aisKeepouts([contact(0, 0, { sog: 0, cog: null, heading: 90, dim: null, length: null, beam: null })], ref,
                                              { now: clock, polledAt: clock }).polys[0]);
  check("16d. the avoidance keep-out is her hull grown by her own LENGTH on every side - 30 m for a 30 x 8 m hull, 20 m where the length is assumed: 29 m off her beam is inside it, 31 m is outside - and the guard's own keep-out is still the bare hull",
        () => ring16.avoidM === 30 && clearanceM({ e: 0, n: 4 + 29 }, M16, 100) === 0 && clearanceM({ e: 0, n: 4 + 31 }, M16, 100) > 0.5
              && clearanceM({ e: 15 + 29, n: 0 }, M16, 100) === 0
              && clearanceM({ e: 0, n: 4 + 29 }, { polys: [q16], lines: [], points: [] }, 100) > 28
              && assumed.avoidM === 20,
        () => "avoidM " + ring16.avoidM + "; 29 m off the beam: " + clearanceM({ e: 0, n: 33 }, M16, 100).toFixed(1) + " m (bare hull: "
            + clearanceM({ e: 0, n: 33 }, { polys: [q16], lines: [], points: [] }, 100).toFixed(1) + "), 31 m: " + clearanceM({ e: 0, n: 35 }, M16, 100).toFixed(1)
            + "; assumed " + assumed.avoidM);
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

// ── 17. ROUTE ROUND HER ON DEMAND (2026-09-27: "no button or right-click selection to initiate or manually
//        avoid an AIS target") - the row over a contact, the held bar's button, and the running plan amended ──
{
  // 17. THE ROW, while the guard holds the survey for her
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 10000; aisPolledAt = clock; frame();
  gateAvoidRow(ll(30, 0));                                  // ON her hull (e = 15..45)
  const onHer = { shown: $("#cmAvoid").style.display !== "none", off: $("#cmAvoid").classList.contains("off"),
                  lbl: $("#cmAvoidLbl").textContent, key: $("#cmAvoidK").textContent };
  gateAvoidRow(ll(300, 0));                                 // 255 m off her: not over a contact
  const offHer = $("#cmAvoid").style.display !== "none";
  check("17. right-click ON a contact while the guard holds the survey for her: the chart menu shows 'Route round WORKBOAT', live, her length in the key; off her the row is hidden, not grayed",
        () => onHer.shown && !onHer.off && onHer.lbl === "Route round WORKBOAT" && onHer.key === "30 m off her" && !offHer,
        () => JSON.stringify(onHer) + "; off her shown " + offHer);
  // 17b. choosing it goes the held path NOW - ten seconds in, not sixty
  const r17b = await avoidContactAt(ll(30, 0)); await settle();
  const up17 = sent.find(x => x.p === "/api/cmd/upload"), rte17 = (up17 && up17.route) || [], ask17 = pinCalls[pinCalls.length - 1];
  check("17b. choosing it ten seconds in goes the held path NOW - pause, upload rejoining line 1 a ship-length beyond her (e = 80), LOW, Start, no amendment - the way in routed with her ring in the model, the record spent, the episode closed, said 'at your word' and logged as manual",
        () => r17b === true && paths().indexOf("/api/cmd/pause") === 0 && paths().indexOf("/api/cmd/upload") < paths().indexOf("/api/cmd/start")
              && !paths().includes("/api/cmd/amend") && rte17.length === 4 && distTo(rte17[0], ll(80, 0)) < 0.5 && distTo(rte17[1], LINE_E.b) < 0.5
              && !!ask17 && !!ask17.opts.ko && ask17.opts.ko.polys.length === 1 && ask17.opts.ko.polys[0].avoidM === 30 && ask17.opts.standoffM === 3
              && ask17.opts.flyThrough === true            // a rejoin point is passed through, never held in (seam 7e)
              && aisAvoid === null && guardHeld === null && S.run === "running"
              && banners.some(b => /ROUTED ROUND/.test(b) && nearRe.test(b) && /at your word, one ship-length off her/.test(b))
              && logged.some(e => e.kind === "ais_around" && e.data.manual === true && e.data.skip_m === 80 && e.data.line === 1),
        () => "returned " + r17b + "; sent " + JSON.stringify(paths()) + "; upload " + rte17.length + " wpts from "
            + (rte17[0] ? distTo(rte17[0], ll(80, 0)).toFixed(1) + " m of (80,0)" : "none") + "; episode " + JSON.stringify(aisAvoid)
            + "; banners " + JSON.stringify(banners.filter(b => /ROUTED/.test(b))) + "; logged " + JSON.stringify(logged.filter(e => e.kind === "ais_around")));

  // 17c. THE BAR'S BUTTON: shown while she is held for a contact, the same way round when pressed, hidden on a clear frame
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 10000; aisPolledAt = clock; frame();
  const btnHeld = $("#gb_around").style.display;
  const r17c = aisAroundNow(); await settle();
  const up17c = sent.find(x => x.p === "/api/cmd/upload"), rte17c = (up17c && up17c.route) || [], sent17c = paths().slice();
  surveying(7, []); frame();                                // (surveying resets `sent`: the paths were read first)
  const btnClear = $("#gb_around").style.display;
  check("17c. the held bar carries ROUTE ROUND HER NOW while she is held for a contact - pressing it is the same way round, ten seconds in (pause, upload from e = 80, Start) - and a clear frame takes the button down",
        () => btnHeld !== "none" && r17c === true && sent17c.indexOf("/api/cmd/pause") === 0 && rte17c.length === 4 && distTo(rte17c[0], ll(80, 0)) < 0.5
              && sent17c.includes("/api/cmd/start") && btnClear === "none",
        () => "held: '" + btnHeld + "', pressed " + r17c + ", sent " + JSON.stringify(sent17c) + ", clear: '" + btnClear + "'");

  // 17d. A PAUSED HOLD: the press is refused in words, nothing is sent, the offer and the episode stand
  surveying(7, [PARKED()]); frame(); nowHolding(); S.run = "paused"; sent = []; notes = []; banners = [];
  clock += 10000; aisPolledAt = clock; frame();
  const r17d = aisAroundNow();
  check("17d. on a PAUSED hold the press is refused in words - press PAUSE again to resume the hold first - nothing is sent, and the offer and the episode stand",
        () => r17d === false && sent.length === 0 && notes.some(n => /Not routed round/.test(n) && /paused/.test(n)) && !!aisAvoid && !!guardHeldOffer(),
        () => "returned " + r17d + ", sent " + JSON.stringify(paths()) + ", notes " + JSON.stringify(notes.slice(-2)));

  // 17e. A SURVEY STILL RUNNING (not held): the row AMENDS the plan round her
  surveying(7, [PARKED()]); aisKeepoutsNow(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  const why17e = avoidWhy();
  const r17e = await avoidContactAt(ll(30, 0));
  const am17 = sent.find(x => x.p === "/api/cmd/amend"), rte17e = (am17 && am17.route) || [], ask17e = pinCalls[pinCalls.length - 1];
  check("17e. on a survey still RUNNING the row AMENDS the plan round her - no pause, no upload: the remainder from e = 80 on line 1 then the rest of the plan, the way in asked of the router with her ring at the standoff, runRoute spliced behind the index, the ladder settling on the edge rung's clock, said and logged as ais_around running",
        () => why17e === "" && r17e === true && paths().length === 1 && paths()[0] === "/api/cmd/amend"
              && rte17e.length === 4 && distTo(rte17e[0], ll(80, 0)) < 0.5 && distTo(rte17e[1], LINE_E.b) < 0.5 && distTo(rte17e[3], ll(-200, 60)) < 0.5
              && !!ask17e && !!ask17e.opts.ko && ask17e.opts.ko.polys.length === 1 && ask17e.opts.ko.polys[0].avoidM === 30 && ask17e.opts.standoffM === 3
              && ask17e.opts.flyThrough === true
              && distTo(ask17e.from, ll(0, 0)) < 0.5 && distTo(ask17e.to, ll(80, 0)) < 0.5
              && runRoute.length === 5 && distTo(runRoute[1], ll(80, 0)) < 0.5 && guardEdgeAt === clock
              && notes.length === 1 && /Routed round/.test(notes[0]) && nearRe.test(notes[0]) && /at your word/.test(notes[0]) && /rejoining line 1/.test(notes[0])
              && logged.some(e => e.kind === "ais_around" && e.data.running === true && e.data.manual === true && e.data.skip_m === 80),
        () => "why '" + why17e + "', returned " + r17e + ", sent " + JSON.stringify(paths()) + ", amend " + rte17e.length + " wpts from "
            + (rte17e[0] ? distTo(rte17e[0], ll(80, 0)).toFixed(1) + " m of (80,0)" : "none") + ", runRoute " + (runRoute && runRoute.length)
            + ", guardEdgeAt " + guardEdgeAt + " vs " + clock + ", notes " + JSON.stringify(notes.slice(-1)));

  // 17f. PAUSED on the line (a pause mark, no live line mark): amended the same way
  surveying(7, [PARKED()]); aisKeepoutsNow(); S.run = "paused"; runLineIdx = -1;
  pauseMark = { line: 0, along: 200, fwd: 1, at: ll(0, 0), t: clock };
  sent = []; notes = []; banners = []; logged = []; pinCalls = [];
  pinNext = { route: [ll(40, -60), ll(80, 0)], routed: true };   // the router detours south of her: one via waypoint, then the target
  const r17f = await avoidContactAt(ll(30, 0));
  pinNext = null;
  const am17f = sent.find(x => x.p === "/api/cmd/amend"), rte17f = (am17f && am17f.route) || [];
  check("17f. PAUSED on the line (the pause mark, no live line mark) it is amended the same way - and the router's detour goes IN FRONT of the rejoin: the via waypoint, e = 80, then the rest",
        () => r17f === true && paths().length === 1 && paths()[0] === "/api/cmd/amend" && rte17f.length === 5
              && distTo(rte17f[0], ll(40, -60)) < 0.5 && distTo(rte17f[1], ll(80, 0)) < 0.5 && distTo(rte17f[2], LINE_E.b) < 0.5
              && notes.some(n => /via 1 waypoint clear of her/.test(n)),
        () => "returned " + r17f + ", sent " + JSON.stringify(paths()) + ", amend " + rte17f.length + " wpts: " + JSON.stringify(rte17f.slice(0, 2).map(w => w && [Math.round(distTo(w, ll(40, -60))), Math.round(distTo(w, ll(80, 0)))])));

  // 17g. THE REFUSALS: paused off a line, disarmed, and no contact under the click
  surveying(7, [PARKED()]); aisKeepoutsNow(); S.run = "paused"; runLineIdx = -1; pauseMark = null; sent = []; notes = [];
  const r17g = await avoidContactAt(ll(30, 0));
  const offLine = r17g === false && sent.length === 0 && notes.some(n => /not on a coverage line/.test(n));
  surveying(7, [PARKED()]); aisKeepoutsNow(); S.armed = false;
  gateAvoidRow(ll(30, 0));
  const disarmed = $("#cmAvoid").style.display !== "none" && $("#cmAvoid").classList.contains("off") && $("#cmAvoidK").textContent === "arm first";
  surveying(7, []); aisKeepoutsNow();
  gateAvoidRow(ll(30, 0));
  const noContact = $("#cmAvoid").style.display === "none";
  sent = []; notes = [];
  const r17g2 = await avoidContactAt(ll(30, 0));
  check("17g. refused in words: paused OFF a coverage line (no pause mark) sends nothing; disarmed, the row is shown but off with 'arm first'; with no contact under the click the row is hidden and the handler sends nothing",
        () => offLine && disarmed && noContact && r17g2 === false && sent.length === 0,
        () => "off line " + offLine + ", disarmed " + disarmed + ", no contact " + noContact + " / " + r17g2 + " " + JSON.stringify(paths()));
  pauseMark = null; runLineIdx = 0;

  // 17h. STOPPED ON A TURN (the second live rehearsal, 23:17: held swinging onto line 8, 13.5 m off her, no line
  // under her - the way round refused "not stopped on a coverage line" while the bar promised "routes round her
  // itself now"). No line to walk beyond her: the plan is picked up at its NEXT waypoint, routed round her.
  surveying(7, [PARKED()]); runLineIdx = -1; frame(); nowHolding();
  sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 10000; aisPolledAt = clock; frame();
  const whyTurn = $("#gb_why").textContent, bankedTurn = !!guardHeld && !guardHeld.mark && !!aisAvoid;
  const r17h = aisAroundNow(); await settle();
  const up17h = sent.find(x => x.p === "/api/cmd/upload"), rte17h = (up17h && up17h.route) || [], ask17h = pinCalls[pinCalls.length - 1];
  check("17h. held on a TURN (no line under her): the survey is banked with no mark, the bar says she was stopped on a turn instead of promising a line she is not on, and the way round picks the plan up at its NEXT waypoint routed round her - pause, upload route[idx..], LOW, Start, the way in asked with her ring as a fly-through - said and logged with no line",
        () => bankedTurn && /stopped on a TURN, not a coverage line/.test(whyTurn) && !/back down it/.test(whyTurn) && /routes round her itself in 50 s/.test(whyTurn)
              && r17h === true && paths().indexOf("/api/cmd/pause") === 0 && paths().includes("/api/cmd/start") && !paths().includes("/api/cmd/amend")
              && rte17h.length === 3 && distTo(rte17h[0], LINE_E.b) < 0.5 && distTo(rte17h[2], ll(-200, 60)) < 0.5
              && !!ask17h && ask17h.opts.flyThrough === true && !!ask17h.opts.ko && ask17h.opts.ko.polys.length === 1 && distTo(ask17h.to, LINE_E.b) < 0.5
              && banners.some(b => /ROUTED ROUND/.test(b) && nearRe.test(b) && /stopped on a turn/.test(b) && /next waypoint/.test(b))
              && logged.some(e => e.kind === "ais_around" && e.data.line === null && e.data.manual === true && e.data.wpts === 3),
        () => "banked " + bankedTurn + "; bar '" + whyTurn.slice(-200) + "'; returned " + r17h + "; sent " + JSON.stringify(paths()) + "; upload " + rte17h.length
            + " wpts" + (rte17h[0] ? " from " + distTo(rte17h[0], LINE_E.b).toFixed(1) + " m of L.b" : "") + "; banners " + JSON.stringify(banners.filter(b => /ROUTED/.test(b)).map(b => b.slice(0, 160)))
            + "; logged " + JSON.stringify(logged.filter(e => e.kind === "ais_around")));
  runLineIdx = 0;
}

// ── 18. THE TREADMILL (Andy, 2026-09-28: "I have to acknowledge warning pop-ups many times why is that?" and
//        "There is no obvious way to increase speed again"). His 08:34 log: 58 presses in fifty minutes against
//        FRIGGA on his line - 21 PROCEEDs on a CLEAR frame spent on the next, the rest lapsing every 5 m of
//        progress, and the low speed with no control anywhere to end it. ─────────────────────────────────────
{
  // a contact parked on the line 120 m ahead: at 7 kn the entry is ~28 s (SLOW); at this world's 4 kn LOW, ~50 s (clear)
  const FAR = (o = {}) => contact(120, 0, { sog: 0, cog: null, heading: 90, ...o });
  const speed = (kn) => { S = { ...S, status: { ...S.status, sog_kn: kn, speed_key: kn < 5 ? "low" : "survey" } }; };
  // the PROCEED handler's record, as the page builds it (2026-09-28: it adopts the hazard the bar was showing, guardKeyLast)
  const press = () => { const k = __keyLast(); guardOverride = { t: Date.now(), level: clearance.level, clearM: clearance.m, key: k ? k.id : null, keyName: k ? k.name : null }; clearance.slowed = false; commandedSpeed = null; };
  const farKind = "AIS: WORKBOAT (30 x 8 m)", farId = "ais:338111222";   // the key is her IDENTITY; the kind is what the banner says
  // 18. a clear frame does not spend it
  surveying(7, [FAR()]); frame();
  const l18a = clearance.level, slowed18 = clearance.slowed;
  press(); banners = []; sent = [];
  speed(4); clock += 2000; aisPolledAt = clock; frame();
  const l18b = clearance.level, standsAfterClear = !!guardOverride;
  speed(7); clock += 2000; aisPolledAt = clock; frame();
  const l18c = clearance.level, standsAfterSlow = !!guardOverride, key18 = guardOverride && guardOverride.key;
  check("18. PROCEED against a contact on the line: the ladder chatters SLOW (7 kn) / CLEAR (slowed to 4 kn) / SLOW - and the override STANDS through the clear frame, adopting the hazard's name, so the slow rung does not slow her again and the operator is not asked again",
        () => l18a === "slow" && slowed18 && l18b === "clear" && standsAfterClear && l18c === "slow" && standsAfterSlow
              && key18 === farId && guardOverride.keyName === farKind && clearance.slowed === false && !sent.some(x => x.p === "/api/cmd/speed" && x.speed === "low"),
        () => "levels " + [l18a, l18b, l18c].join("/") + ", stands after clear " + standsAfterClear + ", after slow " + standsAfterSlow
            + ", key " + JSON.stringify(key18) + ", slowed again " + clearance.slowed + ", sent " + JSON.stringify(paths()));
  // 18b. a hazard that stays put is PASSED, not closed on: 60 m nearer, no lapse, no hold (the override covers the hold rung too)
  asv = ll(60, 0); clock += 2000; aisPolledAt = clock; banners = []; sent = []; frame();
  check("18b. sixty meters nearer the same parked contact - a hazard that stays put is passed, not 'closed on': no OVERRIDE LAPSED, the override stands, the hold rung stays quiet",
        () => !!guardOverride && !banners.some(b => /LAPSED/.test(b)) && !paths().includes("/api/cmd/hold") && (clearance.level === "hold" || clearance.level === "slow"),
        () => "level " + clearance.level + ", override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners) + ", sent " + JSON.stringify(paths()));
  // 18c. a DIFFERENT hazard ends it, said with both named
  aisVessels = [contact(120, 0, { name: "TUG", mmsi: 111222333, sog: 0, cog: null, heading: 90 })]; asv = ll(0, 0);
  clock += 2000; aisPolledAt = clock; banners = []; frame();
  check("18c. a DIFFERENT hazard ahead ends it, said with both named: 'OVERRIDE ENDED - a different hazard ahead: AIS: TUG ... You assessed AIS: WORKBOAT'",
        () => guardOverride === null && banners.some(b => /OVERRIDE ENDED/.test(b) && /AIS: TUG/.test(b) && /You assessed AIS: WORKBOAT/.test(b)),
        () => "override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners));
  // 18d. behind her: the RELEASE ends it (the counterfactual at the plan's speed clear, then the dwell) - quietly
  surveying(7, [FAR()]); frame(); press(); banners = []; notes = [];
  aisVessels = []; clock += 2000; aisPolledAt = clock; frame();
  const standsFirstClear = !!guardOverride;
  clock += 5000; aisPolledAt = clock; frame();
  check("18d. the contact gone: the override stands on the first clear frame (the dwell is not up), and the RELEASE ends it - 'Clear ahead again' - with no OVERRIDE banner: behind her",
        () => standsFirstClear && guardOverride === null && guardLevel === "clear" && notes.some(n => /Clear ahead again/.test(n)) && !banners.some(b => /OVERRIDE/.test(b)),
        () => "first clear frame " + standsFirstClear + ", after the dwell " + JSON.stringify(guardOverride) + ", guardLevel " + guardLevel + ", notes " + JSON.stringify(notes.slice(-2)) + ", banners " + JSON.stringify(banners));
  // 18d2. a press against clear water that meets no hazard within OVERRIDE_STALE_MS is dropped - never a standing permission
  surveying(7, []); frame(); press(); banners = [];
  clock += 30000; aisPolledAt = clock; frame();
  const stands30 = !!guardOverride;
  aisVessels = [FAR()]; clock += 20000; aisPolledAt = clock; frame();
  const staleGone = guardOverride === null, slowedAgain = clearance.slowed === true;
  surveying(7, []); frame(); press();
  aisVessels = [FAR()]; clock += 10000; aisPolledAt = clock; frame();
  check("18d2. pressed against clear water: it waits for a hazard 30 s on; a hazard first seen 50 s after the press finds it STALE and dropped (OVERRIDE_STALE_MS 45 s) - the rung slows her as if nothing was pressed; one seen 10 s after the press is adopted",
        () => stands30 && staleGone && slowedAgain && __overrideStale() === 45000 && !!guardOverride && guardOverride.key === farId && clearance.slowed === false,
        () => "30 s " + stands30 + ", stale gone " + staleGone + ", slowed again " + slowedAgain + ", adopted " + JSON.stringify(guardOverride) + ", slowed " + clearance.slowed);
  // 18e. a contact CLOSING on her keeps the 5 m give, said with her name. A workboat crossing the line 120 m ahead,
  //      northbound at 6 kn: her sweep reaches the line at e = 116..124, ~31 s ahead at 7 kn - SLOW, not yet a hold
  surveying(7, [contact(120, -60, { sog: 6, cog: 0, heading: 0 })]); frame();
  const l18e = clearance.level;
  press(); banners = []; sent = [];
  aisVessels = [contact(112, -60, { sog: 6, cog: 0, heading: 0 })]; clock += 2000; aisPolledAt = clock;
  const r18e = frame();   // 8 m nearer along the line
  check("18e. a workboat UNDER WAY closing on her: more than 5 m nearer than assessed lapses the override - 'OVERRIDE LAPSED - AIS: WORKBOAT ... is closing on her' - the one case the give is for",
        () => (l18e === "hold" || l18e === "slow") && guardOverride === null && banners.some(b => /OVERRIDE LAPSED/.test(b) && /is closing on her/.test(b) && nearRe.test(b)),
        () => "level " + l18e + " then " + clearance.level + " at " + (clearance.m != null ? clearance.m.toFixed(1) : "?") + " m, frame " + JSON.stringify(r18e.raised || "ok")
            + ", override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners) + ", sent " + JSON.stringify(paths()));
  // 18f. CONTINUE AT LOW: the counterfactual is asked whoever holds the throttle, the bar stays up with RELEASE LOW on it,
  //      and the release note does not promise a speed the latch will not give
  surveying(7, [FAR()]); frame(); banners = []; notes = []; sent = [];
  continueAtLow();
  const latched = resumeSlow === true && !!guardOverride && guardOverride.slow === true;
  speed(4); clock += 2000; aisPolledAt = clock; frame();
  clock += 5000; aisPolledAt = clock; frame();                       // past RELEASE_HOLD_MS: the dwell alone would release
  const bar18f = EL["#guardBar"].style.display, rel18f = EL["#gb_release"].style.display, rung18f = EL["#gb_rung"].textContent, why18f = EL["#gb_why"].textContent;
  const liedBack = notes.some(n => /speed back to (survey|high)/.test(n));
  check("18f. CONTINUE AT LOW: slowed to 4 kn the water reads clear, but the release asks the counterfactual at the PLAN's speed (7 kn: SLOW) whoever took the throttle - so nothing is released, the override stands, the bar stays up (re-drawn: 'not yet at the plan's speed') with RELEASE LOW on it, and no note says 'speed back to survey'",
        () => latched && !!guardOverride && guardLevel !== "clear" && bar18f === "block" && rel18f === "" && !liedBack && /not yet at the plan's speed/.test(why18f)
              && !notes.some(n => /Speed released/.test(n)) && resumeSlow === true,
        () => "latched " + latched + ", override " + JSON.stringify(guardOverride) + ", guardLevel " + guardLevel + ", bar " + bar18f + ", release btn '" + rel18f
            + "', rung '" + rung18f + "', notes " + JSON.stringify(notes.slice(-3)));
  // 18g. the contact gone: released at the plan's speed - but the note says she is STILL at low on the operator's
  //      authority, the bar shows the latch on its own with RELEASE LOW, and RELEASE LOW hands the throttle back
  aisVessels = []; notes = []; clock += 2000; aisPolledAt = clock; frame(); clock += 5000; aisPolledAt = clock; frame();
  const releasedNote = notes.find(n => /Clear ahead again/.test(n)) || "";
  const bar18g = EL["#guardBar"].style.display, rung18g = EL["#gb_rung"].textContent, why18g = EL["#gb_why"].textContent, rel18g = EL["#gb_release"].style.display;
  const stillLatched = resumeSlow === true && guardOverride === null;
  sent = []; logged = [];
  const freed = releaseLow("the test");
  const bar18g2 = EL["#guardBar"].style.display;
  check("18g. the contact gone and the plan's speed clear: released - the note reads 'still at LOW on your authority; RELEASE LOW ...', the bar stands on its own as LOW - OPERATOR'S AUTHORITY with RELEASE LOW; pressing it frees the latch, says so, logs it, and the bar goes down",
        () => /still at LOW on your authority/.test(releasedNote) && !/speed back to/.test(releasedNote) && stillLatched
              && bar18g === "block" && /LOW .* OPERATOR'S AUTHORITY/.test(rung18g) && /RELEASE LOW/.test(why18g) && rel18g === ""
              && freed === true && resumeSlow === false && notes.some(n => /Speed released/.test(n)) && bar18g2 === "none"
              && logged.some(e => e.kind === "guard_low" && e.data.how === "release"),
        () => "note '" + releasedNote.slice(0, 120) + "', latched " + stillLatched + ", bar " + bar18g + " '" + rung18g + "' / '" + why18g.slice(0, 80) + "', release btn '" + rel18g
            + "', freed " + freed + ", after " + bar18g2 + ", logged " + JSON.stringify(logged.filter(e => e.kind === "guard_low")));
  // 18h. CANCEL OVERRIDE releases the latch too (the handler is page-level: pinned in the source), and RELEASE LOW is wired
  const cancelSrc = H.slice(H.indexOf('$("#gb_cancel").onclick'), H.indexOf('$("#gb_cancel").onclick') + 500);
  check("18h. CANCEL OVERRIDE releases the low speed with the override (a canceled CONTINUE AT LOW used to leave her at 1.5 kn with no bar), and RELEASE LOW is a real button on the bar, wired",
        () => /releaseLow\("the override was canceled"\)/.test(cancelSrc) && /id="gb_release"/.test(H) && /\$\("#gb_release"\)\.onclick/.test(H),
        () => cancelSrc.slice(0, 160));

  // 18j. RELEASE LOW ends a CONTINUE AT LOW override too (review): released to the plan's speed, the hold rung is
  //      not left suppressed on a decision taken about the low speed
  surveying(7, [FAR()]); frame(); continueAtLow();
  const over18j = !!guardOverride && guardOverride.slow === true;
  releaseLow("the test");
  check("18j. RELEASE LOW ends the CONTINUE AT LOW override with the latch - the console has the situation again; PROCEED is the other decision",
        () => over18j && guardOverride === null && resumeSlow === false,
        () => "override before " + over18j + ", after " + JSON.stringify(guardOverride) + ", resumeSlow " + resumeSlow);
  // 18k. a contact under way closing on her lapses the override even with a charted feature ALSO in the track
  //      (review: `closing` used to need the charted model to read clear)
  const blk = [{ e: 150, n: -10 }, { e: 160, n: -10 }, { e: 160, n: 10 }, { e: 150, n: 10 }];
  const BLOCK = { polys: [{ ring: blk, bb: bbOf(blk), kind: "a dock / pier" }], lines: [], points: [], marks: [], sys: [], chans: [] };
  surveying(7, [contact(120, -60, { sog: 6, cog: 0, heading: 0 })], { ko: BLOCK }); frame();
  const l18k = clearance.level;
  press(); banners = [];
  aisVessels = [contact(112, -60, { sog: 6, cog: 0, heading: 0 })]; clock += 2000; aisPolledAt = clock; frame();
  check("18k. a pier 150 m ahead on the track AND a workboat under way whose sweep crosses the line nearer: the contact closing 8 m lapses the override (she is the nearest hazard), charted feature or no charted feature",
        () => (l18k === "slow" || l18k === "hold") && guardOverride === null && banners.some(b => /OVERRIDE LAPSED/.test(b) && /is closing on her/.test(b)),
        () => "level " + l18k + " then " + clearance.level + " at " + (clearance.m != null ? clearance.m.toFixed(1) : "?") + " m, override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners));
  // 18l. the key is her IDENTITY, not her description (review): a report reading 0.1 kn more is the same vessel
  surveying(7, [contact(120, -60, { sog: 6, cog: 0, heading: 0 })]); frame(); press(); banners = [];
  aisVessels = [contact(120, -60, { sog: 6.1, cog: 0, heading: 0 })]; clock += 2000; aisPolledAt = clock; frame();
  check("18l. the same workboat reporting 6.1 kn instead of 6.0: the SAME hazard - the override stands, no 'different hazard' banner (the key is her MMSI, her kind only names her)",
        () => !!guardOverride && guardOverride.key === farId && /6\.1 kn/.test(clearance.kind || aisNearestKind(nogo.frame.toEN(asv), aisKoDrawn) || "") && !banners.some(b => /OVERRIDE ENDED/.test(b)),
        () => "override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners));
  // 18m. the key names the hazard AHEAD, not the feature abeam (review): a pier beside the line while the contact
  //      is the hazard on the track - the override adopts the contact; pressing on the not-released clear frame
  //      adopts the hazard the bar was showing (guardKeyLast), so it is never 'stale'
  const pierRing = [{ e: -50, n: 12 }, { e: 400, n: 12 }, { e: 400, n: 60 }, { e: -50, n: 60 }];
  const PIER_ABEAM = { polys: [{ ring: pierRing, bb: bbOf(pierRing), kind: "a dock / pier" }], lines: [], points: [], marks: [], sys: [], chans: [] };
  surveying(7, [FAR()], { ko: PIER_ABEAM }); frame();
  const l18m = clearance.level, m18m = clearance.m;
  press();
  speed(4); clock += 2000; aisPolledAt = clock; frame();                  // clear at 4 kn, not at 7: not released, the bar up
  const keyOnClear = guardOverride && guardOverride.key;
  surveying(7, [FAR()], { ko: PIER_ABEAM }); frame(); speed(4); clock += 2000; aisPolledAt = clock; frame();   // a not-released clear frame
  press();                                                                 // pressed ON that frame: adopts what the bar shows
  const keyAtPress = guardOverride && guardOverride.key;
  clock += 50000; aisPolledAt = clock; speed(7); frame();                  // 50 s later, SLOW again: not stale, the same hazard
  check("18m. a pier 12 m abeam while the contact ahead is the hazard: the override is keyed on the CONTACT (the feature at the entry point), and a press on a not-released clear frame adopts the hazard the bar showed - 50 s later it is neither stale nor 'different'",
        () => l18m === "slow" && m18m < 20 && keyOnClear === farId && keyAtPress === farId && !!guardOverride && guardOverride.key === farId && !banners.some(b => /OVERRIDE ENDED/.test(b)),
        () => "level " + l18m + " at " + (m18m != null ? m18m.toFixed(1) : "?") + " m (the pier is nearest the boat), key after a clear frame " + JSON.stringify(keyOnClear)
            + ", key at a press on the not-released frame " + JSON.stringify(keyAtPress) + ", 50 s on " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners));

  // ── 18n-18t. THE REVIEW'S UNPINNED BEHAVIORS (2026-09-28) ──────────────────────────────────────────────────
  // 18n. RELEASE LOW is in reach at the HOLD rung too, and hidden when nothing is latched
  surveying(7, [PARKED()]); resumeSlow = true; frame();
  const relHold = EL["#gb_release"].style.display, rungHold = clearance.level;
  surveying(7, [PARKED()]); frame();
  const relNone = EL["#gb_release"].style.display;
  check("18n. the latch's release is on the bar at the HOLD rung (not only at SLOW), and off it when nothing is latched",
        () => rungHold === "hold" && relHold === "" && relNone === "none",
        () => "hold rung: " + rungHold + " release '" + relHold + "'; unlatched '" + relNone + "'");
  // 18o. the latch bar is not drawn while paused, nor while an escape holds the throttle; the guard's own slow-down is
  //      not released while the plan's speed would read SLOW (the pre-existing half of the counterfactual, pinned)
  surveying(7, []); resumeSlow = true; S = { ...S, run: "paused" }; frame();
  const barPaused = EL["#guardBar"].style.display;
  surveying(7, []); resumeSlow = true; escapeThrottle = true; frame();
  const barEsc = EL["#guardBar"].style.display;
  escapeThrottle = false;
  surveying(7, [FAR()]); frame();                                        // the GUARD slows her (clearance.slowed)
  const slowedByGuard = clearance.slowed === true;
  speed(4); clock += 2000; aisPolledAt = clock; frame(); clock += 5000; aisPolledAt = clock; frame();
  check("18o. the latch bar is not drawn on a paused boat nor under an escape; and the guard's OWN slow-down is not released while the plan's speed would read SLOW, the dwell notwithstanding",
        () => barPaused === "none" && barEsc === "none" && slowedByGuard && clearance.slowed === true && guardLevel === "slow",
        () => "paused " + barPaused + ", escape " + barEsc + ", slowed by the guard " + slowedByGuard + " still " + clearance.slowed + ", guardLevel " + guardLevel);
  // 18p. in extremis ends the override - driven, not a source pin: a workboat northbound at 6 kn 40 m south, her sweep
  //      already over the boat (check 9's fixture) reads HELM
  surveying(7, [FAR()]); frame();
  press();
  escFake = { hdg: 90, to: { e: 60, n: 0 }, m: 60, capped: false, clear: true, survived: 45, worst: 30, gain: 30 };
  aisVessels = [contact(0, -40, { sog: 6, cog: 0, heading: 0 })]; clock += 2000; aisPolledAt = clock; frame();
  check("18p. a frame in extremis ends the override (helm was never covered)",
        () => clearance.level === "helm" && guardOverride === null,
        () => "level " + clearance.level + ", override " + JSON.stringify(guardOverride));
  // 18q. `closing` needs the contact under way to be the NEAREST hazard: a workboat far off closing 8 m does not lapse an
  //      override on the parked contact ahead
  surveying(7, [FAR(), contact(300, -60, { mmsi: 555, name: "FAR TUG", sog: 6, cog: 0, heading: 0 })]); frame(); press(); banners = [];
  aisVessels = [FAR(), contact(292, -60, { mmsi: 555, name: "FAR TUG", sog: 6, cog: 0, heading: 0 })]; clock += 2000; aisPolledAt = clock; frame();
  check("18q. a contact under way 300 m off closing 8 m does not lapse an override on the PARKED contact ahead - only the nearest hazard closing counts",
        () => !!guardOverride && guardOverride.key === farId && !banners.some(b => /LAPSED/.test(b)),
        () => "override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners));
  // 18r. RELEASE LOW leaves a full PROCEED standing and resets the commanded speed
  surveying(7, [FAR()]); frame(); press(); resumeSlow = true; commandedSpeed = "low";
  releaseLow("the test");
  check("18r. RELEASE LOW ends only a LOW override: a full PROCEED stands, and the commanded speed is cleared for the governor to decide",
        () => !!guardOverride && !guardOverride.slow && resumeSlow === false && commandedSpeed === null,
        () => "override " + JSON.stringify(guardOverride) + ", commandedSpeed " + commandedSpeed);
  // 18s. the PROCEED and CONTINUE AT LOW handlers adopt the hazard the bar showed (source), and the key is judged at the
  //      entry point (source) - the fixture's press() copies the handler, so the handlers themselves are pinned here
  const proceedSrc = H.slice(H.indexOf('$("#gb_proceed").onclick'), H.indexOf('$("#gb_proceed").onclick') + 900);
  const contSrc = H.slice(H.indexOf("function continueAtLow(){"), H.indexOf("function continueAtLow(){") + 500);
  const keySrc = H.slice(H.indexOf("function guardHazardKey("), H.indexOf("function guardHazardKey(") + 400);
  check("18s. the real PROCEED and CONTINUE AT LOW handlers adopt guardKeyLast, and the hazard key is judged at the assessment's ENTRY point, not at the boat",
        () => /key: guardKeyLast \? guardKeyLast\.id : null/.test(proceedSrc) && /key: guardKeyLast \? guardKeyLast\.id : null/.test(contSrc)
              && /const at = \(a && a\.entry\) \? a\.entry : p;/.test(keySrc),
        () => "proceed " + /guardKeyLast/.test(proceedSrc) + ", continue " + /guardKeyLast/.test(contSrc) + ", entry " + /a\.entry/.test(keySrc));
  // 18t. the console's own return keeps an operator's LOW latch, and says so
  surveying(7, [PARKED()]); frame(); nowHolding(); resumeSlow = true; sent = []; banners = []; notes = []; logged = []; pinCalls = []; pinNext = null;
  clock += 10000; aisPolledAt = clock; frame();
  aisAroundNow(); await settle();
  check("18t. an operator's LOW latch standing before the hold survives the console's own way round - kept, and the banner says 'still at LOW on your authority'",
        () => resumeSlow === true && paths().includes("/api/cmd/start") && banners.some(b => /ROUTED ROUND/.test(b) && /still at LOW on your authority/.test(b)),
        () => "resumeSlow " + resumeSlow + ", sent " + JSON.stringify(paths()) + ", banners " + JSON.stringify(banners.filter(b => /ROUTED/.test(b)).map(b => b.slice(-140))));
  resumeSlow = false;
  const noRelease2 = releaseLow("nothing latched");
  check("18i. ... and with nothing latched RELEASE LOW does nothing and says so by answering false", () => noRelease2 === false, () => String(noRelease2));
}

Date.now = realNow;
console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
})().catch(__crash);
