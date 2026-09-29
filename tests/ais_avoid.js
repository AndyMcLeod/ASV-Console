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
// ... and when it began, for the window the rungs below helm stand by in (heldResumeOwns), and the guard's own moves,
// counted, which the resume asks about before its upload, before its Start and after it (2026-09-28, FRIGGA).
var heldResumingAt = 0, guardMoved = 0, guardMovedHow = null;
// ... and when the hold rung last put a boat PAUSED on its own hold back on station (2026-09-29), paced by it
var holdBackAt = 0;
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
const { aisKeepouts, aisAvoidKeepouts, aisAvoidKeepout, aisRoundKeepout, convexHull, AIS_KO_STALE_S } = require("../static/js/ais_keepout.js");
const { clearanceM, blocked } = require("../static/js/keepouts.js");
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
      edgeText = G.edgeText, edgeCapM = G.edgeCapM, GUARD_HORIZON_S = G.HORIZON_S, GUARD_HOLD_S = G.HOLD_S;
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
// THE GUARD BETWEEN THE RESUME'S COMMANDS (2026-09-28, FRIGGA): `onReply(path)` runs after a command's reply has
// landed and before the page's await resumes - the moment the 4 Hz ladder ran at 21:19:45.801, 51 ms after the way
// round's upload. `replyState[path]` is the state a success answers with (the console's own reply carries it): the
// Start's `behavior` is what the vessel says it started.
var onReply = null, replyState = {};
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
    // THE VESSEL STAGES an upload to a paused or station-keeping boat until Start, and any other motion replaces it
    // (2026-09-29: the hold rung reads it - a Start with a plan staged APPLIES that plan, it does not resume the hold)
    if (r && r.ok && p === "/api/cmd/upload") S.plan_staged = S.run === "paused" || S.behavior === "hold";
    if (r && r.ok && ["/api/cmd/start", "/api/cmd/hold", "/api/cmd/escape", "/api/cmd/stop"].includes(p)) S.plan_staged = false;
    if (tickGuard) guardHeldOffer();
    if (onReply) onReply(p);
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
    : { ok: true, state: replyState[p] || {} }));
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
  grabDecl("HELD_RESUME_OWNS_MS"), grab("heldResumeOwns"), grab("guardMove"),   // a held resume in flight has her (2026-09-28)
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
  grab("sameContact"), grab("aisHerPoly"), grab("koRoundHer"), grab("tautRoundHer"),   // the tighter way round (2026-09-28)
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
  onReply = null; replyState = {};
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
  clock += 20000; aisPolledAt = clock; frame(); await settle();
  // (twenty seconds: at thirty the console routes ROUND a contact that stays - 2026-09-27, check 14; a minute until 2026-09-28)
  check("6. a contact stopped ON the line ahead holds her and never clears the line: twenty seconds on nothing has come back, the episode still stands",
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
// her, the survey continues from there; (3) no answer in 60 s - 30 s since 2026-09-28, at his word after FRIGGA -
// the console routes round her itself, as if
// she were a buoy or a dock, and carries on. A contact that clears the line first keeps the 100 m return
// (check 3). Never on a stale model, never while paused, not twice inside the operator's 30 s.
const PARKED = () => contact(30, 0, { sog: 0, cog: null, heading: 90 });   // 30 x 8 across the line: her hull is e = 15..45
const nearRe = /WORKBOAT/;
// THE WAY ROUND'S GEOMETRY (2026-09-28). A way round is uploaded or amended as [...via, rejoin, then the plan's own
// remainder] - the taut way round her in front of the rejoin point - so these read it from the END, and measure how
// close the way in comes to a point (her center) and to a polygon (her hull), every half meter along it.
const PARKED_C = { e: 30, n: 0 };                                                // her center
const parkedHull = () => aisKeepouts([PARKED()], ref, { now: clock, polledAt: clock, sweepS: 45 }).polys[0];
const rejoinOf = (rte, tail = 3) => rte[rte.length - 1 - tail];                 // tail: waypoints of the remainder after it
const viaOf = (rte, tail = 3) => rte.slice(0, Math.max(0, rte.length - 1 - tail));
function alongPts(pts, fn) {
  let m = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = ref.toEN(pts[i - 1]), b = ref.toEN(pts[i]), n = Math.max(1, Math.ceil(Math.hypot(b.e - a.e, b.n - a.n) / 0.5));
    for (let k = 0; k <= n; k++) { const t = k / n; m = Math.min(m, fn({ e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t })); }
  }
  return m;
}
const minDistTo = (pts, c) => alongPts(pts, (p) => Math.hypot(p.e - c.e, p.n - c.n));
const minClearTo = (pts, poly) => alongPts(pts, (p) => clearanceM(p, { polys: [poly], lines: [], points: [] }, 500));
const wayInOf = (rte, from, tail = 3) => [from, ...viaOf(rte, tail), rejoinOf(rte, tail)];
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
              && /right-click the line BEYOND her/.test(why23) && /routes round her itself in [5-7] s/.test(why23),
        () => why23);
}
{
  // 14. OPTION 3: THIRTY SECONDS ON, THE CONSOLE ROUTES ROUND HER (a minute until 2026-09-28)
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 20000; aisPolledAt = clock; frame(); await settle();
  const at20 = paths().slice();
  clock += 11000; aisPolledAt = clock; frame(); await settle();
  const up = sent.find(x => x.p === "/api/cmd/upload"), rte = (up && up.route) || [];
  const ask = pinCalls[pinCalls.length - 1];
  check("14. thirty seconds on with her still across the line, the console routes round her: pause, upload, LOW, Start - and nothing at twenty",
        () => at20.length === 0 && paths().indexOf("/api/cmd/pause") === 0
              && paths().indexOf("/api/cmd/pause") < paths().indexOf("/api/cmd/upload")
              && paths().indexOf("/api/cmd/upload") < paths().indexOf("/api/cmd/start"),
        () => "at 20 s: " + JSON.stringify(at20) + "; at 31 s: " + JSON.stringify(paths()));
  // A SHIP-LENGTH ROUND HER (Andy, 2026-09-27): the rejoin clears her hull by her own length, not by the standoff alone
  const rj14 = rejoinOf(rte), via14 = viaOf(rte), wayIn14 = wayInOf(rte, ll(0, 0));
  check("14b. ... the upload picks the line up at the first point BEYOND her that is clear of her maneuver ring by the standoff (e = 65: a ship-length about her center reaches e = 60, the 5 m walk's next step is 65 - it was e = 80 while her HULL was grown by her length and the standoff added outside that), the taut way round in front of it, then the remainder",
        () => rte.length >= 5 && via14.length >= 1 && distTo(rj14, ll(65, 0)) < 0.5 && distTo(rte[rte.length - 3], LINE_E.b) < 0.5 && distTo(rte[rte.length - 1], ll(-200, 60)) < 0.5,
        () => rte.length + " wpts; rejoin " + (rj14 ? distTo(rj14, ll(65, 0)).toFixed(1) + " m from (65, 0)" : "none") + ", via " + via14.length);
  const dC14 = minDistTo(wayIn14, PARKED_C), dH14 = minClearTo(wayIn14, parkedHull());
  check("14c. ... and the way in is the TAUT way round her ring: never nearer her center than her own length (30 m) and no more than a meter and a half beyond it, at least the standoff plus the buffer off her hull - with no call on the router's grid search",
        () => dC14 >= 30 - 0.05 && dC14 <= 31.5 && dH14 >= 6 - 0.05 && pinCalls.length === 0,
        () => "closest to her center " + dC14.toFixed(2) + " m, to her hull " + dH14.toFixed(2) + " m; router calls " + pinCalls.length);
  check("14d. ... with none of the operator's latches, the record spent, the episode closed, and it is said and recorded as ais_around with what was left under her",
        () => guardOverride === null && resumeSlow === false && guardHeld === null && aisAvoid === null && S.run === "running"
              && banners.some(b => /ROUTED ROUND/.test(b) && nearRe.test(b) && /65 m of coverage left under/.test(b))
              && banners.some(b => /did not clear the line within 30 s/.test(b))
              && logged.some(e => e.kind === "ais_around" && e.data.skip_m === 65 && e.data.line === 1 && e.data.skip_line === false && e.data.held_s >= 30
                                  && e.data.mmsi === 338111222 && e.data.round_m === 30 && e.data.std_m === 3),
        () => "override " + JSON.stringify(guardOverride) + ", resumeSlow " + resumeSlow + ", episode " + JSON.stringify(aisAvoid)
            + ", banners " + JSON.stringify(banners.filter(b => /ROUTED/.test(b))) + ", logged " + JSON.stringify(logged.filter(e => e.kind === "ais_around")));

  // 14e. THE CONTACT CLEARS FIRST: THE 100 m RETURN WINS, AND NO WAY ROUND FOLLOWS
  surveying(7, [CROSSING()]); frame(); nowHolding(); sent = []; logged = [];
  const her2 = (t) => { aisVessels = [contact(34, -60 + 3.087 * t, { sog: 6, cog: 0, heading: 0 })]; aisPolledAt = clock; };
  clock += 29000; her2(29); frame(); clock += 4100; her2(33.1); frame(); await settle();
  const returned = paths().includes("/api/cmd/upload"), afterReturn = sent.length;
  clock += 30000; her2(64); frame(); await settle();
  check("14e. a contact that CLEARS the line inside the operator's 30 s gets the 100 m return, and no way round follows it",
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

  // 14h. NO WAY ROUND: SAID, STILL HOLDING, TRIED AGAIN 30 s LATER - NOT EVERY FRAME. Charted walls on both
  // sides of her ring, so the taut way round cannot be certified and the router's own search is the one asked
  // (2026-09-28: the taut path comes first now) - and the router finds nothing either.
  const wall14N = [{ e: 5, n: 22 }, { e: 60, n: 22 }, { e: 60, n: 60 }, { e: 5, n: 60 }], wall14S = wall14N.map(p => ({ e: p.e, n: -p.n }));
  const WALLS14 = { polys: [{ ring: wall14N, bb: bbOf(wall14N), kind: "a dock / pier" }, { ring: wall14S, bb: bbOf(wall14S), kind: "a dock / pier" }],
                    lines: [], points: [], marks: [], sys: [], chans: [] };
  surveying(7, [PARKED()], { ko: WALLS14 }); frame(); nowHolding(); sent = []; banners = []; pinCalls = [];
  pinNext = { error: "no clear route to the target - every path crosses AIS: WORKBOAT", reason: {} };
  clock += 61000; aisPolledAt = clock; frame(); await settle();
  const said1 = banners.filter(b => /CANNOT RESUME FROM HERE/.test(b)).length, sent1 = paths().slice(), tries1 = pinCalls.length;
  clock += 20000; aisPolledAt = clock; frame(); await settle();
  const tries2 = pinCalls.length;
  clock += 11000; aisPolledAt = clock; frame(); await settle();
  const tries3 = pinCalls.length;
  pinNext = null;
  check("14h. no way round her: nothing is sent, she keeps holding with the offer and the episode standing, it is said, and the router is asked again 30 s later - a contact moves - not every frame",
        () => sent1.length === 0 && said1 === 1 && tries1 === 1 && !!guardHeld && !!aisAvoid && tries2 === 1 && tries3 === 2,
        () => "sent " + JSON.stringify(sent1) + ", said " + said1 + ", router asked " + tries1 + " / " + tries2 + " / " + tries3 + " times at 61 / 81 / 92 s");
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
              && rte3.length >= 5 && distTo(rejoinOf(rte3), ll(120, 0)) < 0.5 && distTo(rte3[rte3.length - 3], LINE_E.b) < 0.5
              && pinCalls.length === 0 && minDistTo(wayInOf(rte3, ll(0, 0)), PARKED_C) >= 30 - 0.05,   // taut round her, a ship-length off her center
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
  await resumeFromHere(ll(55, 2));                  // 10 m beyond her hull, inside a ship-length of her CENTER (e = 60)
  const inLenSent = paths().slice(), inLenSaid = banners.filter(b => /NEAR SIDE/.test(b));
  check("15d. a point on the NEAR side of her, on her, or within her own length of her is refused in words - she would only be stopped again - with the time left before the console acts; nothing is sent, the offer and the episode stand",
        () => nearSent.length === 0 && nearSaid.length === 1 && /routes round her itself in 20 s/.test(nearSaid[0])
              && onSent.length === 0 && onSaid.length === 2 && inLenSent.length === 0 && inLenSaid.length === 3
              && !!guardHeld && !!aisAvoid && pinCalls.length === 0,
        () => "near: sent " + JSON.stringify(nearSent) + ", " + JSON.stringify(nearSaid) + "; on her: said " + onSaid.length
            + "; within her length: sent " + JSON.stringify(inLenSent) + ", said " + inLenSaid.length);
  // 15e. THE ACCEPTANCE THAT PAIRS WITH IT (2026-09-28): 34 m from her center - past a ship-length and her standoff
  await resumeFromHere(ll(64, 2)); await settle();
  const up15e = sent.find(x => x.p === "/api/cmd/upload"), rte15e = (up15e && up15e.route) || [];
  check("15e. ... and a point just past a ship-length from her center (e = 64: 34 m from it) is ACCEPTED - the held path goes from there, taut round her",
        () => !!up15e && distTo(rejoinOf(rte15e), ll(64, 0)) < 0.5 && minDistTo(wayInOf(rte15e, ll(0, 0)), PARKED_C) >= 30 - 0.05 && guardHeld === null,
        () => "sent " + JSON.stringify(paths()) + "; upload " + rte15e.length + " wpts" + (rejoinOf(rte15e) ? ", rejoin " + distTo(rejoinOf(rte15e), ll(64, 0)).toFixed(1) + " m from (64,0)" : ""));
}

// ── 16. KLEOS (Andy's console, 2026-09-27 20:54:30): THE ESCAPE, AND THE HOLD 0.44 s LATER THAT CANCELLED IT ──
// His log: the helm rung escaped her from KLEOS at 20:54:30.299 and the hold rung held her at 20:54:30.741 - the
// next frame - reading "entry in 0 s under way, but on drift alone it is 0 s away and stays outside half the
// buffer": from INSIDE the buffer the track enters at once whatever the heading. The hold replaced the escape's
// plan with the point she stood on, 2.6 m off the contact, and she stayed there all evening. The lower rungs stand
// down while an escape is in flight; the offer stands once she is on station; the way round goes once the operator's
// 30 s are up.
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
  // she arrives on station: the offer stands, the bar says so, the episode is still open for the operator's 30 s
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
  check("16c. ... and once the operator's 30 s are up the way round goes from the escape point, rejoining line 1 past a ship-length about her center (e = 40: her center is at 6, her length 30, the standoff 3 - it was e = 55), taut round her from where the escape left her, the record spent, the episode closed",
        () => rte16.length >= 4 && distTo(rejoinOf(rte16), ll(40, 0)) < 0.5 && distTo(rte16[rte16.length - 3], LINE_E.b) < 0.5
              && minDistTo(wayInOf(rte16, ll(0, 60)), { e: 6, n: 0 }) >= 30 - 0.05 && guardHeld === null && aisAvoid === null,
        () => rte16.length + " wpts; rejoin " + (rejoinOf(rte16) ? distTo(rejoinOf(rte16), ll(40, 0)).toFixed(1) + " m from (40, 0)" : "none") + "; sent " + JSON.stringify(paths()));
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
        () => onHer.shown && !onHer.off && onHer.lbl === "Route round WORKBOAT" && onHer.key === "30 m round her" && !offHer,
        () => JSON.stringify(onHer) + "; off her shown " + offHer);
  // 17b. choosing it goes the held path NOW - ten seconds in, not thirty
  const r17b = await avoidContactAt(ll(30, 0)); await settle();
  const up17 = sent.find(x => x.p === "/api/cmd/upload"), rte17 = (up17 && up17.route) || [], ask17 = pinCalls[pinCalls.length - 1];
  check("17b. choosing it ten seconds in goes the held path NOW - pause, upload rejoining line 1 past a ship-length about her center (e = 65), LOW, Start, no amendment - the way in taut round her ring, the record spent, the episode closed, said 'at your word' and logged as manual",
        () => r17b === true && paths().indexOf("/api/cmd/pause") === 0 && paths().indexOf("/api/cmd/upload") < paths().indexOf("/api/cmd/start")
              && !paths().includes("/api/cmd/amend") && rte17.length >= 5 && distTo(rejoinOf(rte17), ll(65, 0)) < 0.5 && distTo(rte17[rte17.length - 3], LINE_E.b) < 0.5
              && pinCalls.length === 0 && minDistTo(wayInOf(rte17, ll(0, 0)), PARKED_C) >= 30 - 0.05
              && aisAvoid === null && guardHeld === null && S.run === "running"
              && banners.some(b => /ROUTED ROUND/.test(b) && nearRe.test(b) && /at your word, one ship-length off her/.test(b))
              && logged.some(e => e.kind === "ais_around" && e.data.manual === true && e.data.skip_m === 65 && e.data.line === 1),
        () => "returned " + r17b + "; sent " + JSON.stringify(paths()) + "; upload " + rte17.length + " wpts, rejoin "
            + (rejoinOf(rte17) ? distTo(rejoinOf(rte17), ll(65, 0)).toFixed(1) + " m of (65,0)" : "none") + "; router calls " + pinCalls.length + "; episode " + JSON.stringify(aisAvoid)
            + "; banners " + JSON.stringify(banners.filter(b => /ROUTED/.test(b))) + "; logged " + JSON.stringify(logged.filter(e => e.kind === "ais_around")));

  // 17c. THE BAR'S BUTTON: shown while she is held for a contact, the same way round when pressed, hidden on a clear frame
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 10000; aisPolledAt = clock; frame();
  const btnHeld = $("#gb_around").style.display;
  const r17c = aisAroundNow(); await settle();
  const up17c = sent.find(x => x.p === "/api/cmd/upload"), rte17c = (up17c && up17c.route) || [], sent17c = paths().slice();
  surveying(7, []); frame();                                // (surveying resets `sent`: the paths were read first)
  const btnClear = $("#gb_around").style.display;
  check("17c. the held bar carries ROUTE ROUND HER NOW while she is held for a contact - pressing it is the same way round, ten seconds in (pause, upload from e = 65, Start) - and a clear frame takes the button down",
        () => btnHeld !== "none" && r17c === true && sent17c.indexOf("/api/cmd/pause") === 0 && rte17c.length >= 5 && distTo(rejoinOf(rte17c), ll(65, 0)) < 0.5
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
  check("17e. on a survey still RUNNING the row AMENDS the plan round her - no pause, no upload: the taut way round, the remainder from e = 65 on line 1, then the rest of the plan, runRoute spliced behind the index, the ladder settling on the edge rung's clock, said and logged as ais_around running",
        () => why17e === "" && r17e === true && paths().length === 1 && paths()[0] === "/api/cmd/amend"
              && rte17e.length >= 5 && distTo(rejoinOf(rte17e), ll(65, 0)) < 0.5 && distTo(rte17e[rte17e.length - 3], LINE_E.b) < 0.5 && distTo(rte17e[rte17e.length - 1], ll(-200, 60)) < 0.5
              && pinCalls.length === 0 && minDistTo(wayInOf(rte17e, ll(0, 0)), PARKED_C) >= 30 - 0.05
              && runRoute.length === rte17e.length + 1 && distTo(runRoute[runRoute.length - 4], ll(65, 0)) < 0.5 && guardEdgeAt === clock
              && notes.length === 1 && /Routed round/.test(notes[0]) && nearRe.test(notes[0]) && /at your word/.test(notes[0]) && /rejoining line 1/.test(notes[0])
              && logged.some(e => e.kind === "ais_around" && e.data.running === true && e.data.manual === true && e.data.skip_m === 65 && e.data.mmsi === 338111222),
        () => "why '" + why17e + "', returned " + r17e + ", sent " + JSON.stringify(paths()) + ", amend " + rte17e.length + " wpts, rejoin "
            + (rejoinOf(rte17e) ? distTo(rejoinOf(rte17e), ll(65, 0)).toFixed(1) + " m of (65,0)" : "none") + ", router calls " + pinCalls.length + ", runRoute " + (runRoute && runRoute.length)
            + ", guardEdgeAt " + guardEdgeAt + " vs " + clock + ", notes " + JSON.stringify(notes.slice(-1)));

  // 17f. PAUSED on the line (a pause mark, no live line mark): amended the same way
  surveying(7, [PARKED()]); aisKeepoutsNow(); S.run = "paused"; runLineIdx = -1;
  pauseMark = { line: 0, along: 200, fwd: 1, at: ll(0, 0), t: clock };
  sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  const r17f = await avoidContactAt(ll(30, 0));
  const am17f = sent.find(x => x.p === "/api/cmd/amend"), rte17f = (am17f && am17f.route) || [], via17f = viaOf(rte17f);
  check("17f. PAUSED on the line (the pause mark, no live line mark) it is amended the same way - the way round IN FRONT of the rejoin: its waypoints, e = 65, then the rest, and the note counts them",
        () => r17f === true && paths().length === 1 && paths()[0] === "/api/cmd/amend" && via17f.length >= 1
              && distTo(rejoinOf(rte17f), ll(65, 0)) < 0.5 && distTo(rte17f[rte17f.length - 3], LINE_E.b) < 0.5
              && notes.some(n => new RegExp("via " + via17f.length + " waypoints? clear of her").test(n)),
        () => "returned " + r17f + ", sent " + JSON.stringify(paths()) + ", amend " + rte17f.length + " wpts, via " + via17f.length + ", notes " + JSON.stringify(notes.slice(-1)));

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
  const up17h = sent.find(x => x.p === "/api/cmd/upload"), rte17h = (up17h && up17h.route) || [];
  check("17h. held on a TURN (no line under her): the survey is banked with no mark, the bar says she was stopped on a turn instead of promising a line she is not on, and the way round picks the plan up at its NEXT waypoint routed round her - pause, upload route[idx..], LOW, Start, the way in asked with her ring as a fly-through - said and logged with no line",
        () => bankedTurn && /stopped on a TURN, not a coverage line/.test(whyTurn) && !/back down it/.test(whyTurn) && /routes round her itself in 20 s/.test(whyTurn)
              && r17h === true && paths().indexOf("/api/cmd/pause") === 0 && paths().includes("/api/cmd/start") && !paths().includes("/api/cmd/amend")
              && rte17h.length >= 4 && distTo(rejoinOf(rte17h, 2), LINE_E.b) < 0.5 && distTo(rte17h[rte17h.length - 1], ll(-200, 60)) < 0.5
              && pinCalls.length === 0 && minDistTo(wayInOf(rte17h, ll(0, 0), 2), PARKED_C) >= 30 - 0.05   // taut round her to the next waypoint
              && banners.some(b => /ROUTED ROUND/.test(b) && nearRe.test(b) && /stopped on a turn/.test(b) && /next waypoint/.test(b))
              && logged.some(e => e.kind === "ais_around" && e.data.line === null && e.data.manual === true && e.data.wpts === rte17h.length),
        () => "banked " + bankedTurn + "; bar '" + whyTurn.slice(-200) + "'; returned " + r17h + "; sent " + JSON.stringify(paths()) + "; upload " + rte17h.length
            + " wpts" + (rejoinOf(rte17h, 2) ? ", next waypoint " + distTo(rejoinOf(rte17h, 2), LINE_E.b).toFixed(1) + " m of L.b" : "") + "; banners " + JSON.stringify(banners.filter(b => /ROUTED/.test(b)).map(b => b.slice(0, 160)))
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

// ── 19. THE TIGHTER WAY ROUND (Andy, 2026-09-28: "why did the rejoin go 587m down the line" and "Too much distance
//        from the AIS target and a long failure to regain the survey line. Make the avoidance maneuver tighter and
//        recover the survey line sooner."). His 19:25 run: KLEOS on line 6; FRIGGA anchored 35 m off its far end;
//        the rejoin 375 m on, the way in 48-63 m off KLEOS. ─────────────────────────────────────────────────────────
{
  // 19. FRIGGA: a second contact, anchored 32 m off the line near its far end, in nobody's way
  const FRIGGA = () => contact(150, 32, { mmsi: 777000777, name: "FRIGGA", sog: 0, cog: null, heading: null, dim: null, length: null, beam: null });
  surveying(7, [PARKED(), FRIGGA()]); frame(); nowHolding();
  sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 10000; aisPolledAt = clock; frame();
  const herMmsi = aisAvoid && aisAvoid.mmsi;
  aisAroundNow(); await settle();
  const up19 = sent.find(x => x.p === "/api/cmd/upload"), rte19 = (up19 && up19.route) || [];
  const ev19 = logged.find(e => e.kind === "ais_around");
  check("19. a second contact anchored 32 m off the far end of the line (FRIGGA: her own ship-length ring would come within 1.2 m of it) does NOT push the rejoin past her: it is e = 65, a ship-length past the contact the survey is held for, and the episode names that one by MMSI",
        () => herMmsi === 338111222 && !!up19 && distTo(rejoinOf(rte19), ll(65, 0)) < 0.5 && !!ev19 && ev19.data.skip_m === 65 && ev19.data.mmsi === 338111222,
        () => "episode mmsi " + herMmsi + "; upload " + rte19.length + " wpts, rejoin " + (rejoinOf(rte19) ? distTo(rejoinOf(rte19), ll(65, 0)).toFixed(1) + " m from (65,0)" : "none")
            + "; logged " + JSON.stringify(ev19 && ev19.data));

  // 19b. two contacts ON the line: the second inside the hold horizon after the first -> the way round goes past both;
  //      the second beyond it -> the survey is picked up between them (the guard answers the second when she gets there)
  const SECOND = (e) => contact(e, 0, { mmsi: 888000888, name: "SECOND", sog: 0, cog: null, heading: 90, dim: null, length: null, beam: null });
  surveying(7, [PARKED(), SECOND(100)]); frame(); nowHolding(); sent = []; logged = []; pinCalls = [];
  clock += 10000; aisPolledAt = clock; frame();
  aisAroundNow(); await settle();
  const rte19b = ((sent.find(x => x.p === "/api/cmd/upload") || {}).route) || [];
  surveying(7, [PARKED(), SECOND(170)]); frame(); nowHolding(); sent = []; logged = []; pinCalls = [];
  clock += 10000; aisPolledAt = clock; frame();
  aisAroundNow(); await settle();
  const rte19b2 = ((sent.find(x => x.p === "/api/cmd/upload") || {}).route) || [];
  check("19b. a second hull ON the line 45 m past the first (inside the hold horizon at the survey speed, 72 m) - the way round goes past BOTH (e = 115, 5 m past her hull and the standoff); one 115 m past (beyond it) - the survey is picked up between them (e = 65)",
        () => distTo(rejoinOf(rte19b), ll(115, 0)) < 0.5 && distTo(rejoinOf(rte19b2), ll(65, 0)) < 0.5 && Math.abs(GUARD_HOLD_S * roleSpeedMS("survey") - 72.0) < 0.1,
        () => "second at 100: rejoin " + (rejoinOf(rte19b) ? JSON.stringify(ref.toEN(rejoinOf(rte19b))) : "none") + "; second at 170: rejoin "
            + (rejoinOf(rte19b2) ? JSON.stringify(ref.toEN(rejoinOf(rte19b2))) : "none") + "; run-out " + (GUARD_HOLD_S * roleSpeedMS("survey")).toFixed(1));

  // 19c. THE ROUTER FALLBACK: charted walls on both sides of her ring - neither taut side can be certified - so the
  //      router's own search is asked, with HER as the ship-length ring and nothing else grown
  const wallN = [{ e: 5, n: 22 }, { e: 60, n: 22 }, { e: 60, n: 60 }, { e: 5, n: 60 }], wallS = wallN.map(p => ({ e: p.e, n: -p.n }));
  const WALLS = { polys: [{ ring: wallN, bb: bbOf(wallN), kind: "a dock / pier" }, { ring: wallS, bb: bbOf(wallS), kind: "a dock / pier" }],
                  lines: [], points: [], marks: [], sys: [], chans: [] };
  surveying(7, [PARKED(), FRIGGA()], { ko: WALLS }); frame(); nowHolding(); sent = []; pinCalls = []; pinNext = null;
  clock += 10000; aisPolledAt = clock; frame();
  const held19c = !!aisAvoid;
  aisAroundNow(); await settle();
  const ask19c = pinCalls[pinCalls.length - 1];
  const polys19c = (ask19c && ask19c.opts && ask19c.opts.ko && ask19c.opts.ko.polys) || [];
  const herP = polys19c.find(p => p.mmsi === 338111222), friggaP = polys19c.find(p => p.mmsi === 777000777);
  check("19c. with charted walls on both sides of her ring the taut way round cannot be certified, so the router's own search is asked - at the standoff, as a fly-through, the model HER ship-length ring (30 m round her) plus FRIGGA as the guard's BARE hull and the walls",
        () => held19c && !!ask19c && ask19c.opts.standoffM === 3 && ask19c.opts.flyThrough === true && !!herP && herP.roundM === 30 && /30 m round her/.test(herP.kind)
              && !!friggaP && friggaP.roundM == null && !/round her/.test(friggaP.kind) && polys19c.filter(p => /pier/.test(p.kind)).length === 2,
        () => "held " + held19c + "; asked " + JSON.stringify(ask19c && { standoff: ask19c.opts.standoffM, kinds: polys19c.map(p => p.kind) }));

  // 19d. IN A SET: the standoff outgrows her length, and her hull (plus the buffer) is what the way round keeps its
  //      standoff from - the guard's own line - not her hull grown by her length AND the standoff
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; logged = []; pinCalls = [];
  clock += 10000; aisPolledAt = clock; frame();
  S = { ...S, status: { ...S.status, env_set_kn: 1.75, env_set_deg: 90 } };
  const std19d = patClipBufM();
  aisAroundNow(); await settle();
  const rte19d = ((sent.find(x => x.p === "/api/cmd/upload") || {}).route) || [];
  // Held 15 m off her hull - INSIDE the standoff - so the way in first moves straight away from her center, and is
  // measured from where that leaves her standoff: every point after it keeps the standoff plus the buffer off her hull.
  const via19d = viaOf(rte19d), out19d = via19d[0];
  const wayIn19d = [...via19d, rejoinOf(rte19d)], dH19d = minClearTo(wayIn19d, parkedHull()), dC19d = minDistTo(wayIn19d, PARKED_C);
  const hull19d = parkedHull(), clr0 = clearanceM(ref.toEN(ll(0, 0)), { polys: [hull19d], lines: [], points: [] }, 500);
  const clrOut = out19d ? clearanceM(ref.toEN(out19d), { polys: [hull19d], lines: [], points: [] }, 500) : -1;
  check("19d. in a 1.75 kn set (standoff 19.5 m) the rejoin is where her hull plus the buffer plus the standoff ends (e = 70: hull to 45, +3, +19.5 - it was e = 95 with her length added too); held 15 m off her hull, the way in first moves straight AWAY from her, and from there keeps at least the standoff plus the buffer off her HULL (22.5 m) and no more than 2 m beyond it",
        () => Math.abs(std19d - 19.5) < 0.1 && distTo(rejoinOf(rte19d), ll(70, 0)) < 0.5 && !!out19d && clrOut > clr0 + 5
              && dH19d >= 22.5 - 0.05 && dH19d <= 24.5
              && logged.some(e => e.kind === "ais_around" && e.data.std_m === 19.5 && e.data.skip_m === 70),
        () => "std " + std19d.toFixed(2) + "; rejoin " + (rejoinOf(rte19d) ? JSON.stringify(ref.toEN(rejoinOf(rte19d))) : "none") + "; held " + clr0.toFixed(1)
            + " m off her hull, moved out to " + clrOut.toFixed(1) + " m; from there off her hull " + dH19d.toFixed(2)
            + " m, off her center " + dC19d.toFixed(2) + " m; logged " + JSON.stringify((logged.find(e => e.kind === "ais_around") || {}).data));
  S = { ...S, status: { ...S.status, env_set_kn: 0 } };

  // 19f. WITHOUT AN MMSI she is the first contact the line AHEAD runs into - not merely the nearest one
  surveying(7, [PARKED(), contact(5, 18, { mmsi: 999000999, name: "BESIDE", sog: 0, cog: null, heading: null, dim: null, length: null, beam: null })]);
  frame(); nowHolding(); clock += 10000; aisPolledAt = clock; frame();
  const g19f = guardHeldOffer();
  const plan19f = g19f ? aisAroundPlan(g19f, aisKoDrawn, 3, null) : null;
  const nearestToBoat = aisNearestPoly(ref.toEN(ll(0, 0)), aisKoDrawn);
  check("19f. with no MMSI to go on, HER is the first contact the line ahead runs into (the WORKBOAT across it), not the nearest one to the boat (BESIDE, 7 m off her track), and the rejoin is past the WORKBOAT",
        () => !!plan19f && !!plan19f.her && plan19f.her.mmsi === 338111222 && !!nearestToBoat && nearestToBoat.mmsi === 999000999 && distTo(plan19f.to, ll(65, 0)) < 0.5,
        () => "her " + (plan19f && plan19f.her && plan19f.her.name) + ", nearest to the boat " + (nearestToBoat && nearestToBoat.name) + ", rejoin " + (plan19f && plan19f.to ? JSON.stringify(ref.toEN(plan19f.to)) : JSON.stringify(plan19f)));

  // 19g. THE MMSI NAMES HER (mutation R5): on a RUNNING survey the operator right-clicks the FAR contact of two on the
  //      line - the way round goes round the one they named, not the first one the line runs into
  const FARB = () => contact(150, 0, { mmsi: 555000555, name: "FARBOAT", sog: 0, cog: null, heading: 90, dim: null, length: null, beam: null });
  surveying(7, [PARKED(), FARB()]); aisKeepoutsNow(); sent = []; notes = []; logged = []; pinCalls = [];
  const r19g = await avoidContactAt(ll(150, 0));
  const am19g = sent.find(x => x.p === "/api/cmd/amend"), rte19g = (am19g && am19g.route) || [];
  const ev19g = logged.find(e => e.kind === "ais_around");
  check("19g. right-clicking the FAR of two contacts on the line routes round HER - the one named, found by her MMSI - rejoining past her (e = 175: her assumed 20 m length about her center at 150, the standoff, the next 5 m step), not past the near one the line runs into first",
        () => r19g === true && !!ev19g && ev19g.data.mmsi === 555000555 && ev19g.data.round_m === 20 && distTo(rejoinOf(rte19g), ll(175, 0)) < 0.5,
        () => "returned " + r19g + "; rejoin " + (rejoinOf(rte19g) ? JSON.stringify(ref.toEN(rejoinOf(rte19g))) : "none") + "; logged " + JSON.stringify(ev19g && ev19g.data));

  // 19h. THE SHORTER SIDE (mutation R13): her center 10 m NORTH of the line - the taut way passes SOUTH of her
  const NORTHOF = () => contact(30, 10, { sog: 0, cog: null, heading: 90 });
  surveying(7, [NORTHOF()]); aisKeepoutsNow(); sent = []; notes = []; logged = []; pinCalls = [];
  const r19h = await avoidContactAt(ll(30, 10));
  const am19h = sent.find(x => x.p === "/api/cmd/amend"), rte19h = (am19h && am19h.route) || [], via19h = viaOf(rte19h);
  check("19h. with her center 10 m north of the line the taut way round takes the SHORTER side - every waypoint of it south of the line - and still a ship-length off her center",
        () => r19h === true && via19h.length >= 1 && via19h.every(w => ref.toEN(w).n < 0)
              && minDistTo(wayInOf(rte19h, ll(0, 0)), { e: 30, n: 10 }) >= 30 - 0.05,
        () => "returned " + r19h + "; via n " + JSON.stringify(via19h.map(w => +ref.toEN(w).n.toFixed(1))));

  // 19i. THE HELD WAY IN IS JUDGED AT THE STANDOFF (mutation R15): held, then set 40 m north of the line in a 1.75 kn
  //      set - the straight run to the rejoin would pass her ring about 5 m off, clear of the 3 m buffer and well inside
  //      the 19.5 m standoff, so it is ROUTED round her and not flown straight
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; logged = []; pinCalls = [];
  clock += 10000; aisPolledAt = clock; frame();
  asv = ll(0, 40);
  S = { ...S, status: { ...S.status, env_set_kn: 1.75, env_set_deg: 90 } };
  aisAroundNow(); await settle();
  const rte19i = ((sent.find(x => x.p === "/api/cmd/upload") || {}).route) || [];
  const wayIn19i = wayInOf(rte19i, ll(0, 40)), dH19i = minClearTo(wayIn19i, parkedHull());
  check("19i. held, then 40 m north of the line in a 1.75 kn set: the straight run to the rejoin would pass her ring inside the standoff though outside the buffer - so it is ROUTED round her, the way in at least the standoff plus the buffer off her hull",
        () => distTo(rejoinOf(rte19i), ll(70, 0)) < 0.5 && viaOf(rte19i).length >= 1 && dH19i >= 22.5 - 0.05,
        () => "rejoin " + (rejoinOf(rte19i) ? JSON.stringify(ref.toEN(rejoinOf(rte19i))) : "none") + "; via " + viaOf(rte19i).length + "; off her hull " + dH19i.toFixed(2) + " m");
  S = { ...S, status: { ...S.status, env_set_kn: 0 } }; asv = ll(0, 0);
}

// ── 20. FRIGGA (Andy's console, 2026-09-28 21:19:45): THE GUARD'S HOLD BETWEEN THE WAY ROUND'S UPLOAD AND ITS START ──
// His log: held 48 m off FRIGGA in a 1.75 kn set; six seconds into the hold the clear branch read the station-keeping
// boat as clear and released the hold rung's latch ("Clear ahead again (43.3 m)"). The way round then paused her and
// uploaded the route round her (STAGED), and PAUSED she drifted toward FRIGGA: the ladder read a fresh HOLD 42 s out and
// the rung posted /api/cmd/hold 51 ms later, replacing the staged route round. The Start answered "Station-keep
// started", the page announced ROUTED ROUND and spent the held survey, and every later press resumed only the hold.
// Replayed with the guard ticking between the resume's commands (onReply).
const OWNS_MS = +H.match(/const HELD_RESUME_OWNS_MS = (\d+)/)[1];
// held for her, then station-keeping with a little way on AWAY from her - the station-keep's own motion. On his
// console the clear branch released the hold rung's latch here, at 21:19:04; since 2026-09-29 it does not (check 21),
// so these replays run with the latch KEPT - the console as it is now - and with the upload STAGED on the vessel,
// where the rung's only answer is a hold at her present position. Answers whether the latch was kept.
function heldAndKept() {
  surveying(7, [PARKED()]); frame(); nowHolding();
  const held = !!guardHeld && !!aisAvoid && guardActedAt > 0;
  S = { ...S, status: { ...S.status, sog_kn: 0.3, cog_deg: 270, heading_deg: 90 } };
  for (let k = 0; k < 6; k++) { clock += 1000; aisPolledAt = clock; frame(); }
  return held && guardActedAt > 0 && guardLevel !== "clear";
}
// paused, and set toward her at `kn`: 1 kn is a HOLD 23 s out (the rung's own reading at 21:19:45.801), 1.75 kn a HELM 13 s out
const pausedSetToward = (kn) => { S = { ...S, status: { ...S.status, sog_kn: kn, cog_deg: 90, heading_deg: 90, holding: false,
                                                                   env_set_kn: kn, env_set_deg: 90 } }; };
{
  const kept = heldAndKept();
  let midLevel = null, midBanners = null, midSent = null;
  onReply = (p) => {
    if (p !== "/api/cmd/upload") return;
    pausedSetToward(1.0);
    const b0 = banners.length, n0 = sent.length; frame();
    midLevel = clearance.level; midBanners = banners.slice(b0); midSent = sent.slice(n0).map(x => x.p);
  };
  sent = []; banners = []; notes = []; logged = [];
  clock += 30000 - 6000; aisPolledAt = clock; frame(); await settle();   // the operator's 30 s: the console's own way round
  onReply = null;
  const seq20 = paths();
  check("20. FRIGGA: held for her (the latch kept), the way round paused her and uploaded - STAGED - and PAUSED she drifted toward her; the ladder reads HOLD mid-resume, where a paused boat with a plan staged gets the rung's hold, and posts NOTHING: pause, upload, LOW, Start, the route round started and announced, the record spent",
        () => kept && midLevel === "hold" && midSent && midSent.length === 0
              && JSON.stringify(seq20) === JSON.stringify(["/api/cmd/pause", "/api/cmd/upload", "/api/cmd/speed", "/api/cmd/start"])
              && banners.some(b => /ROUTED ROUND/.test(b)) && guardHeld === null && aisAvoid === null,
        () => "latch kept " + kept + "; mid-resume level " + midLevel + ", sent then " + JSON.stringify(midSent)
            + "; sent " + JSON.stringify(seq20) + "; banners " + JSON.stringify(banners.map(b => b.slice(0, 70))));
  check("20a. ... and no '⚠ HOLD ... holding still answers it' banner from inside the resume - on his console it came a third of a second before ROUTED ROUND and read as the console holding her",
        () => midBanners !== null && !midBanners.some(b => /^⚠ HOLD/.test(b)),
        () => "mid-resume banners " + JSON.stringify(midBanners));
}
{
  // 20b. IN EXTREMIS MID-RESUME, at each of the resume's steps: the helm rung never stands by - it escapes - and the
  //      resume does not go on over it. After the pause: nothing is uploaded. After the upload: no LOW (it would slow
  //      the escape), no Start. After the LOW: no Start. After the Start: no ROUTED ROUND. Each time it says so, and
  //      the held survey and the episode stand.
  const got = [];
  for (const at of ["/api/cmd/pause", "/api/cmd/upload", "/api/cmd/speed", "/api/cmd/start"]) {
    const latchKept = heldAndKept();
    escFake = { hdg: 0, to: { e: 0, n: 60 }, m: 60, capped: false, clear: true, survived: 45, worst: 30, gain: 30 };
    const kept = guardHeld, ep = aisAvoid;
    let midSent = null;
    onReply = (p) => {
      if (p !== at || midSent) return;
      pausedSetToward(1.75);
      const n0 = sent.length; frame(); clock += 1600; frame(); midSent = sent.slice(n0).map(x => x.p);
    };
    sent = []; banners = []; notes = []; logged = [];
    clock += 30000 - 6000; aisPolledAt = clock; frame(); await settle();
    onReply = null;
    const after = paths().slice(paths().indexOf("/api/cmd/escape") + 1);
    got.push({ at, latchKept, esc: !!midSent && midSent.includes("/api/cmd/escape"), after,
               upload: paths().includes("/api/cmd/upload"), start: paths().includes("/api/cmd/start"),
               routed: banners.some(b => /ROUTED ROUND/.test(b)),
               said: banners.some(b => /THE WAY ROUND IS NOT RUNNING/.test(b) && /took the helm/.test(b) && /on the guard's escape/.test(b)),
               kept: guardHeld === kept && aisAvoid === ep,
               logged: logged.some(e => e.kind === "resume_not_running" && e.data.guard === "took the helm" && e.data.around === true) });
    escFake = null;
  }
  const want = { "/api/cmd/pause": [], "/api/cmd/upload": [], "/api/cmd/speed": [], "/api/cmd/start": [] };
  check("20b. in extremis mid-resume the helm rung escapes - it never stands by - and the resume sends NOTHING after the escape at any of its four steps (no upload after the pause, no LOW and no Start after the upload, no Start after the LOW), announces no way round, says why, and keeps the held survey and the episode",
        () => got.length === 4 && got.every(g => g.latchKept && g.esc && JSON.stringify(g.after) === JSON.stringify(want[g.at]) && !g.routed && g.said && g.kept && g.logged)
              && got[0].upload === false && got[3].start === true,
        () => got.map(g => g.at.replace("/api/cmd/", "") + ": latch kept " + g.latchKept + ", escaped " + g.esc + ", then " + JSON.stringify(g.after)
                           + ", routed " + g.routed + ", said " + g.said + ", kept " + g.kept + ", logged " + g.logged).join(" | "));
}
{
  // 20c. THE START'S OWN ANSWER (FRIGGA's "Station-keep started"): the vessel says it started its station-keep plan -
  //      no ROUTED ROUND, the record and the episode kept, and it says what happened
  surveying(7, [PARKED()]); frame(); nowHolding();
  clock += 10000; aisPolledAt = clock; frame();
  replyState["/api/cmd/start"] = { behavior: "hold", note: "Station-keep started (will loiter / station-keep at the end)." };
  const kept = guardHeld, ep = aisAvoid, route20c = runRoute;
  sent = []; banners = []; notes = []; logged = [];
  const r20c = aisAroundNow(); await settle();
  replyState = {};
  check("20c. the Start answers with the vessel's STATION-KEEP plan: no way round is announced - it says the way round is NOT RUNNING, why, and that the console tries again itself in 30 s - and the held survey, the episode and the logged record stand",
        () => r20c === true && paths().includes("/api/cmd/start") && !banners.some(b => /ROUTED ROUND/.test(b))
              && banners.some(b => /THE WAY ROUND IS NOT RUNNING/.test(b) && /answered Start with its station-keep plan/.test(b) && /tries again itself in 30 s/.test(b))
              && guardHeld === kept && aisAvoid === ep && runRoute === route20c && !logged.some(e => e.kind === "ais_around")
              && logged.some(e => e.kind === "resume_not_running" && /station-keep/.test(e.data.why)),
        () => "returned " + r20c + "; sent " + JSON.stringify(paths()) + "; banners " + JSON.stringify(banners.map(b => b.slice(0, 120)))
            + "; record " + (guardHeld === kept ? "kept" : "CHANGED") + ", episode " + (aisAvoid === ep ? "kept" : "CHANGED")
            + ", drawn route " + (runRoute === route20c ? "the held survey's" : "NOT the held survey's"));
  // 20d. ... the bar counts to the NEXT try, and the console does try again itself 30 s after the one that did not start
  renderGuardBar({ level: "blind" }, clearance);
  const why20d = $("#gb_why").textContent;
  clock += 20000; aisPolledAt = clock; sent = []; banners = []; frame(); await settle();
  const at20 = paths().slice();
  replyState["/api/cmd/start"] = { behavior: "survey" };
  clock += 11000; aisPolledAt = clock; frame(); await settle();
  replyState = {};
  check("20d. ... the bar counts to the NEXT try, not to 'now', and 30 s after the try that did not start the console tries again itself - nothing at 20 s, the way round at 31 s, the vessel starting the remainder ('survey'), announced and the record spent",
        () => /routes round her itself in 30 s/.test(why20d) && at20.length === 0
              && paths().indexOf("/api/cmd/pause") === 0 && paths().includes("/api/cmd/start")
              && banners.some(b => /ROUTED ROUND/.test(b)) && guardHeld === null && aisAvoid === null,
        () => "bar '" + why20d.slice(-80) + "'; at 20 s " + JSON.stringify(at20) + "; at 31 s " + JSON.stringify(paths())
            + "; banners " + JSON.stringify(banners.map(b => b.slice(0, 60))));
}
{
  // 20e. THE STAND-BY IS BOUNDED AND NEVER COVERS HELM
  const was = [heldResuming, heldResumingAt];
  heldResuming = true; heldResumingAt = clock;
  const hold0 = heldResumeOwns("hold", clock), helm0 = heldResumeOwns("helm", clock),
        slowLate = heldResumeOwns("slow", clock + OWNS_MS - 1), holdOver = heldResumeOwns("hold", clock + OWNS_MS);
  heldResuming = false;
  const notIn = heldResumeOwns("hold", clock);
  [heldResuming, heldResumingAt] = was;
  check("20e. the stand-by is bounded and never covers helm: a resume in flight has her below helm, never at helm, and not once HELD_RESUME_OWNS_MS (" + OWNS_MS / 1000 + " s) has run - a resume stalled on a dead link hands the ladder back",
        () => hold0 === true && helm0 === false && slowLate === true && holdOver === false && notIn === false && OWNS_MS === 10000,
        () => "hold " + hold0 + ", helm " + helm0 + ", slow at " + (OWNS_MS - 1) + " ms " + slowLate + ", hold at " + OWNS_MS + " ms " + holdOver + ", not resuming " + notIn);
}
{
  // 20f. THE 100 m RETURN THAT DID NOT START. It spends its episode before it calls the resume (aisReturnTick), so a
  //      Start that answered the station-keep plan would have left nothing to try again with: the episode is PUT BACK,
  //      its dwell to run again, and once the line has read clear for AIS_RETURN_DWELL_MS more the return goes again.
  surveying(7, [CROSSING()]); frame(); nowHolding();
  const her20f = (t) => { aisVessels = [contact(34, -60 + 3.087 * t, { sog: 6, cog: 0, heading: 0 })]; aisPolledAt = clock; };
  const kept = guardHeld, route0 = runRoute;
  clock += 30000; her20f(30); frame(); clock += 4100; her20f(34.1);
  replyState["/api/cmd/start"] = { behavior: "hold" };
  sent = []; banners = []; logged = [];
  frame(); await settle();
  replyState = {};
  // the episode as it was put back - read NOW, because the frames below move the same object's dwell on
  const first = paths().slice(), ep = aisAvoid ? { ...aisAvoid } : null, keptF = guardHeld === kept, routeF = runRoute === route0;
  const saidF = banners.some(b => /THE SURVEY IS NOT RUNNING/.test(b) && /tries again once the line reads clear again/.test(b));
  sent = []; banners = [];
  clock += 1000; her20f(35.1); frame(); clock += 4100; her20f(39.2); frame(); await settle();
  check("20f. a 100 m return whose Start answered the station-keep plan: NOT RUNNING said, the record kept, its spent episode PUT BACK with the dwell to run again - and 4 s of clear line later the return goes again and this time starts",
        () => first.includes("/api/cmd/start") && saidF && keptF && routeF && !!ep && ep.clearSince === 0
              && paths().includes("/api/cmd/upload") && paths().includes("/api/cmd/start")
              && banners.some(b => /SURVEY RESUMED/.test(b)) && guardHeld === null && aisAvoid === null,
        () => "first " + JSON.stringify(first) + ", said " + saidF + ", record kept " + keptF + ", drawn route kept " + routeF
            + ", episode " + JSON.stringify(ep) + "; again " + JSON.stringify(paths()) + ", banners " + JSON.stringify(banners.map(b => b.slice(0, 60))));
}
{
  // 20g. A RESUME STALLED PAST THE STAND-BY (a slow link): the ladder has her back and the hold rung holds her - and the
  //      resume does not Start over the guard's hold
  const latchKept = heldAndKept();
  const kept = guardHeld, ep = aisAvoid;
  let midSent = null;
  onReply = (p) => {
    if (p !== "/api/cmd/upload" || midSent) return;
    pausedSetToward(1.0);
    clock += OWNS_MS + 500;                       // the upload's round trip outlasted the stand-by
    const n0 = sent.length; frame(); midSent = sent.slice(n0).map(x => x.p);
  };
  sent = []; banners = []; logged = [];
  clock += 30000 - 6000; aisPolledAt = clock; frame(); await settle();
  onReply = null;
  check("20g. a resume stalled past the " + OWNS_MS / 1000 + " s stand-by: the hold rung has her back and HOLDS her - and the resume sends nothing more, no LOW and no Start: NOT RUNNING, 'held her again', station-keeping, the record and the episode kept",
        () => latchKept && midSent && midSent.includes("/api/cmd/hold")
              && JSON.stringify(paths()) === JSON.stringify(["/api/cmd/pause", "/api/cmd/upload", "/api/cmd/hold"])
              && banners.some(b => /THE WAY ROUND IS NOT RUNNING/.test(b) && /held her again/.test(b) && /She is station-keeping/.test(b))
              && guardHeld === kept && aisAvoid === ep,
        () => "latch kept " + latchKept + "; mid-resume sent " + JSON.stringify(midSent) + "; sent " + JSON.stringify(paths())
            + "; banners " + JSON.stringify(banners.map(b => b.slice(0, 110))));
}
{
  // 20h. THE UPLOAD'S ANSWER LOST WHILE THE HELM RUNG ESCAPED: the failed-upload path puts a paused boat back on
  //      station with a hold - which here would land on top of the escape just sent. It does not.
  const latchKept = heldAndKept();
  escFake = { hdg: 0, to: { e: 0, n: 60 }, m: 60, capped: false, clear: true, survived: 45, worst: 30, gain: 30 };
  const kept = guardHeld, ep = aisAvoid;
  let midSent = null;
  onReply = (p) => {
    if (p !== "/api/cmd/upload" || midSent) return;
    pausedSetToward(1.75);
    const n0 = sent.length; frame(); clock += 1600; frame(); midSent = sent.slice(n0).map(x => x.p);
  };
  lost = "/api/cmd/upload";
  sent = []; banners = []; logged = [];
  clock += 30000 - 6000; aisPolledAt = clock; frame(); await settle();
  onReply = null; lost = null; escFake = null;
  const after20h = paths().slice(paths().indexOf("/api/cmd/escape") + 1);
  check("20h. the upload's answer LOST while the helm rung escaped: the failed-upload path does not put her 'back on station' over the escape - nothing is sent after it, NOT RUNNING is said with the cause, the record and the episode kept",
        () => latchKept && midSent && midSent.includes("/api/cmd/escape") && after20h.length === 0
              && banners.some(b => /THE WAY ROUND IS NOT RUNNING/.test(b) && /took the helm while the remainder was being uploaded/.test(b))
              && guardHeld === kept && aisAvoid === ep,
        () => "latch kept " + latchKept + "; mid-resume sent " + JSON.stringify(midSent) + "; after the escape " + JSON.stringify(after20h)
            + "; banners " + JSON.stringify(banners.map(b => b.slice(0, 110))));
}

// ── 21. THE HOLD THE GUARD COMMANDED STANDS UNTIL SHE LEAVES IT (2026-09-29, the three open items) ────────────────
// His FRIGGA log again: the clear branch released the hold rung's record six seconds into the hold (a station-keeping
// boat reads clear) and put the throttle back to the transit speed; with the record gone, each Pause was answered by
// a fresh hold where the set had carried her - 48 m off her, then 41, 33, 25.
{
  // 21. item 1: station-keeping frames that read CLEAR release nothing
  surveying(7, [PARKED()]); frame(); nowHolding();
  const acted21 = guardActedAt, lvl21 = guardLevel;
  S = { ...S, status: { ...S.status, sog_kn: 0.3, cog_deg: 270, heading_deg: 90 } };
  sent = []; notes = [];
  for (let k = 0; k < 8; k++) { clock += 1000; aisPolledAt = clock; frame(); }
  const read21 = clearance.level, sent21 = paths().slice();
  check("21. held for her and station-keeping, the frames read CLEAR for 8 s and NOTHING is released - no 'Clear ahead again', no speed command, the hold rung's record and the ladder's level stand: the hold is the answer, not a cleared situation",
        () => acted21 > 0 && lvl21 === "hold" && read21 === "clear" && guardActedAt === acted21 && guardLevel === "hold"
              && !notes.some(n => /Clear ahead again/.test(n)) && sent21.length === 0,
        () => "acted " + acted21 + " -> " + guardActedAt + ", level " + lvl21 + " -> " + guardLevel + ", read " + read21
            + ", sent " + JSON.stringify(sent21) + ", notes " + JSON.stringify(notes));
  // 21a. CONTROL: the same frames with the record gone - as his console had it - DO release: the gate is what stops it
  guardActedAt = 0; notes = []; sent = [];
  for (let k = 0; k < 6; k++) { clock += 1000; aisPolledAt = clock; frame(); }
  check("21a. CONTROL: the same station-keeping frames with the record gone - as his console had it after 21:19:04 - DO release and say 'Clear ahead again': the gate on her own hold is what stops it, not the water",
        () => notes.some(n => /Clear ahead again/.test(n)) && guardLevel === "clear",
        () => "level " + guardLevel + ", notes " + JSON.stringify(notes));
}
{
  // 21b. item 3: PAUSED on the guard's hold, the set carrying her in - back on station at the hold's own point
  surveying(7, [PARKED()]); frame(); nowHolding();
  clock += 5000; aisPolledAt = clock; frame();
  S.run = "paused"; pausedSetToward(1.0);
  sent = []; notes = [];
  frame();
  const first21b = paths().slice(), lvl21b = clearance.level;
  frame(); clock += 1000; aisPolledAt = clock; frame();
  const again21b = paths().slice();
  check("21b. PAUSED on the guard's hold with the set carrying her toward her (the ladder reads HOLD): the rung RESUMES the hold she is paused on - /api/cmd/start, back to its own point - and does NOT post a fresh hold where the set has carried her; it says so, and asks once, not every frame",
        () => lvl21b === "hold" && JSON.stringify(first21b) === '["/api/cmd/start"]' && JSON.stringify(again21b) === '["/api/cmd/start"]'
              && notes.some(n => /BACK ON STATION/.test(n) && /not re-held where the set has carried her/.test(n)),
        () => "level " + lvl21b + ", first frame sent " + JSON.stringify(first21b) + ", two more " + JSON.stringify(again21b)
            + ", notes " + JSON.stringify(notes.map(n => n.slice(0, 90))));
  // 21c. ... with a plan STAGED a Start would apply it: the old answer, a hold at her present position, paced
  surveying(7, [PARKED()]); frame(); nowHolding(); clock += 5000; aisPolledAt = clock; frame();
  S.run = "paused"; pausedSetToward(1.0); S.plan_staged = true; sent = [];
  frame(); const staged21c = paths().slice(); frame(); const staged21c2 = paths().slice();
  check("21c. ... but with a plan STAGED on the vessel (a Start would apply it, not resume the hold) the rung holds her where she is, as it always did - and paced, not every frame",
        () => JSON.stringify(staged21c) === '["/api/cmd/hold"]' && JSON.stringify(staged21c2) === '["/api/cmd/hold"]',
        () => "first " + JSON.stringify(staged21c) + ", next frame " + JSON.stringify(staged21c2));
  // 21d. ... and a STOPPED boat is neither put back nor re-held
  surveying(7, [PARKED()]); frame(); nowHolding(); clock += 5000; aisPolledAt = clock; frame();
  S.run = "stopped"; pausedSetToward(1.0); sent = [];
  frame(); clock += 1000; aisPolledAt = clock; frame();
  check("21d. ... and a STOPPED boat drifting the same way is neither put back nor re-held: Stop ends the hold, and only the in-extremis rung acts on her then",
        () => clearance.level === "hold" && sent.length === 0,
        () => "level " + clearance.level + ", sent " + JSON.stringify(paths()));
}
{
  // 21e. item 1's other half: the resume that ends the hold ends its record
  surveying(7, [PARKED()]); frame(); nowHolding(); clock += 10000; aisPolledAt = clock; frame();
  const acted21e = guardActedAt, lvl21e = guardLevel;
  sent = [];
  aisAroundNow(); await settle();
  check("21e. the way round that ends the hold ends its record - the hold rung's latch and the ladder's level reset - so the new track is judged afresh: a HOLD on it is a first action, not 'the hold was not taken - re-sending'",
        () => acted21e > 0 && lvl21e !== "clear" && paths().includes("/api/cmd/start") && guardActedAt === 0 && holdWant === null && guardLevel === "clear",
        () => "before: acted " + acted21e + ", level " + lvl21e + "; after: sent " + JSON.stringify(paths()) + ", acted " + guardActedAt
            + ", holdWant " + JSON.stringify(holdWant) + ", level " + guardLevel);
}
{
  // 21f. item 1: the hold's speed - coming onto station is not a transit
  surveying(7, []);
  S = { ...S, behavior: "hold", status: { ...S.status, holding: false, sog_kn: 0.5, env_set_kn: 0 } };
  const roleCalm = speedRole(), keyCalm = roleSpeed(roleCalm);
  S = { ...S, status: { ...S.status, env_set_kn: 5.0, env_set_deg: 90 } };     // stronger than this world's LOW (4 kn)
  const keySet = roleSpeed(speedRole());
  S = { ...S, behavior: "goto", status: { ...S.status, env_set_kn: 0 } };
  const roleGoto = speedRole(), keyGoto = roleSpeed(roleGoto);
  check("21f. a HOLD coming onto station takes the HOLD role - the slowest speed that makes way: LOW in calm water, the next up in a set LOW cannot beat - never the transit speed, which a Go-To's transit keeps",
        () => roleCalm === "hold" && keyCalm === "low" && keySet === "survey" && roleGoto === "transit" && keyGoto === "high",
        () => "hold: role " + roleCalm + ", calm " + keyCalm + ", in a 5 kn set " + keySet + "; Go-To: role " + roleGoto + ", " + keyGoto);
}

Date.now = realNow;
console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
})().catch(__crash);
