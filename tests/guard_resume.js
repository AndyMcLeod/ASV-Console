// tests/guard_resume.js - the guard stopped the survey, and the operator has to be able to
// say "carry on, slowly".
//
// Andy, 2026-09-09: "after a survey is punched out and uploaded, there can be nogo violation
// event that cause a hold and loiter. This should not happens because punch out should
// correct before the run. However, in the event this situation happens, institute a feature
// wherein on resume, the user should be provided an option to force the ASV survey to
// continue at slow speed."
//
// TWO THINGS WERE MISSING, AND THE SECOND IS THE EXPENSIVE ONE.
//
//   * The bar's only offer was PROCEED, which hands the throttle back to the governor and
//     the boat returns to the SURVEY speed. An operator looking at a charted feature they
//     can see has not decided to go past it at seven knots, so the real choice on offer was
//     "full speed" or "no survey".
//   * And once the HOLD rung has fired it is already too late for either: `hold` uploads a
//     one-waypoint plan over the survey (Engine._run_route), so the vessel's plan IS the
//     hold point and `wp_index` counts that. The rung's own comment said the survey "cannot
//     be resumed ... the console's only way back is to re-run from waypoint one". It was
//     right. The remainder now lives in `guardHeld`, captured in the frame before the hold
//     command goes out.
//
// And once the boat is station-keeping the ladder reads CLEAR by construction - the hold
// rung is only ever reached when the drift-only track is clear, which is the state that
// taking the way off produces - so the bar that named the hazard went out with it. The offer
// outlives the rung that caused it, or there is nothing on screen saying the run is over.
//
//   node tests/guard_resume.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 22 mutations against a SIDECAR (ASV_HTML), all 22 killed, 2026-09-09:
//   the survey is never captured at all (the CONTROL)             -> 5,6,8-15
//   the capture happens AFTER the hold, at the hold's own index   -> 5, 6
//   ...or is moved below the command outright                     -> 5, 6, 7, 10-13
//   a Go-To is captured as if it were a survey                    -> 7
//   a plan with nothing unflown is offered anyway                 -> 7
//   the offer outlives the situation it was taken about           -> 8
//   the resume uploads without pausing first                      -> 9, 15
//   ...or uploads the WHOLE survey instead of the remainder       -> 10-13
//   CONTROL: the backtrack is dropped from the resume             -> 10, 11, 12
//   the way back is taken without asking the chart                -> 12, 13
//   the drawn route is not re-pointed at the tail                 -> 13
//   a refused upload leaves her paused and drifting               -> 14
//   the override is recorded after the commands go out            -> 15
//   the LOW override suppresses the SLOWING as well as the stop   -> 16
//   CONTROL: ...or does not suppress the hold at all              -> 16
//   the guard keeps `slowed`, so its release restores survey spd  -> 17
//   the resume never takes the low-speed hold                     -> 12b
//   the governor re-asserts the role speed over the hold          -> 18
//   the resume says nothing about what it did                     -> 19
//   the drop throws the remainder away without asking             -> 20
//   the bar goes out the moment the boat stops                    -> 4
//   the offer is never rendered at all                            -> 3
//
// AND 8 MORE, 2026-09-21, all 8 killed - the hold's retry and the deviation's reply:
//   a hold the vessel HAS taken is re-sent anyway, on the clock    -> 8d
//   the refusal branch is dropped (the shipped defect)             -> 21
//   ...the branch stays, but guardEdgeAt is left ARMED             -> 21
//   ...the splice happens BEFORE the reply is read                 -> 21
//   ...the refusal is silent: no banner for the operator           -> 21
//   ...the budget is spent on a refusal too                        -> 21
//   TIMID: every reply is treated as a refusal                     -> 22
//   TIMID: the commit is dropped altogether                        -> 22
//
// ⚠ 8d IS HERE AND NOT IN clearance_guard.js FOR A REASON WORTH KEEPING. That suite's cmd
// stub only RECORDS - S.behavior never becomes "hold" in it - so the "ignores the vessel's
// answer" mutation SURVIVED there, and only reddened once the case was written in the world
// where the hold is modelled. A mutation that survives in one suite and dies in another is
// the suites telling you which one owns the behavior.
//
// ⚠ THREE OF THOSE SURVIVED THE FIRST SWEEP, AND ALL THREE ARE THE SAME MISTAKE IN THREE
// COSTUMES - a check that looked at the code rather than at what the code DID.
//
//   * 19 and 20 grepped the function bodies for the banner and the confirmation. Wrapping
//     each in `if(false)` left every string in place: the override went through silently
//     and the unflown remainder was thrown away without asking, and both checks stayed
//     green. They drive the functions now and read what was SAID and what was ASKED.
//   * 16 drove the rungs, but not the SAME rung twice. It set `guardLevel = "hold"` for the
//     overridden runs, which makes `escalated` false, so those runs sent nothing for a
//     reason unconnected to the override - and the CONTROL mutation (a LOW override that
//     suppresses the stop it is supposed to allow) walked straight through. Its own detail
//     line had been printing the evidence from the first run.
//
// ⚠ THE RUNGS ARE DRIVEN THROUGH THE REAL `assess`, on the fixture in tests/in_extremis.js -
// a pier 30 m north, the boat standing at it. 6 kn is `hold` there and 1.5 kn is `slow`, and
// both are pinned below so a change in guard.js cannot quietly turn this suite into a test
// of a rung it never reaches.
//
// NOTE: this suite evaluates page code SLOPPY - a direct eval, so the page's function declarations bind into this
// file. The page itself is <script type="module">, which runs STRICT: an assignment to an undeclared name passes
// here and throws in the page. tests/page_strict.js parses the page and its modules as strict modules; that runtime
// difference is not checked anywhere.

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
// The hold rung snapshots its own latches before writing them (2026-09-22), so a refusal
// can put them back. `slowLieu` is one of them and is READ before anything writes it.
var slowLieu = null;
var planIntent = { why: [] }, notes = [], banners = [], logged = [], violations = null;
var nogo = { ready: true, frame: null, ko: null, buffer: 5 };
var confirmAnswer = true, confirmAsked = 0, lastResume = null, lastContinue = null;

// The guard's own imports, REAL - the rungs are only worth driving against the real assess.
const guardAssess = G.assess, groundVel = G.groundVel, restoreVel = G.restoreVel,
      edgeText = G.edgeText, edgeCapM = G.edgeCapM, GUARD_HORIZON_S = G.HORIZON_S;
function escapeCourse() { return null; }        // the helm rung is in_extremis's suite

function fmtDist(m) { return Math.round(m) + " m"; }
function flashNote(m) { notes.push(m); }
function showBanner(t) { banners.push(t); }
function setViolations(v) { violations = v; }
function updateMissionCard() {}
function render() {}
function holdClearAt() { return 12.3; }
function guiConfirm() { confirmAsked++; return Promise.resolve(confirmAnswer); }
globalThis.window = globalThis;
globalThis.fetch = (p, o) => {
  try { logged.push(JSON.parse(o.body)); } catch (e) { /* not a logevent */ }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
};
// Commands are RECORDED, not stubbed to nothing, so a check can say WHAT was sent and in
// what order rather than only that something was. `refuse` drives the refusal branch.
var sent = [], refuse = null, lost = null;
function cmd(p, b) {
  sent.push({ p, speed: b && b.speed, route: b && b.route });
  // ⚠ THE HOLD IS MODELLED, NOT JUST RECORDED, AND THAT IS WHAT MAKES CHECK 6 REAL. On the
  // vessel `hold` uploads a one-waypoint plan over the survey, so `wp_index` becomes 0 and
  // describes the hold. With a stub that only records, moving markGuardHeld to AFTER the
  // command changes nothing the suite can see - the mutation survives and the check is
  // decoration. Here the index really moves, so a late capture really reads the wrong one.
  if (p === "/api/cmd/hold") window._wpIndex = 0;
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
  return Promise.resolve(lost && lost === p
    ? { ok: false, error: "no answer", sent: true, refused: false }
    : refuse && refuse === p
    ? { ok: false, error: "ARM before uploading a plan", sent: true, refused: true }
    : { ok: true, state: {} });
}

// A minimal DOM, only as wide as the guard bar. renderGuardBar writes text and display, and
// the checks read them back - which is the only way to tell "the offer is up" from "the code
// that would put it up exists".
const EL = {};
function $(sel) {
  if (sel === "#guardBar" || /^#gb_/.test(sel))
    return EL[sel] || (EL[sel] = { textContent: "", className: "", style: { display: "" } });
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
  "function updateClearance(){ clearance = {...clearance, ...__clr}; return clearance; }",
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
  grabDecl("SPEED_RESEND_MS"), grabDecl("speedWant"), grab("commandSpeed"),
  grab("guardOverrideOk"), grab("guardTrack"), grab("clearanceGuard"),
  grab("renderGuardBar"), grab("renderHeldBar"),
  // took() is the page's ONE test for "did the command land?", carried across verbatim.
  // sendSpeed is the one door a speed command reaches the wire by (2026-09-22).
  grab("took"), grab("sendSpeed"), grab("continueAtLow"), grab("resumeHeldSurvey"),
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

// The boat standing INTO the pier at a given speed, on a survey, with a route left to fly.
// ⚠ NO HEADING IS PUBLISHED, WHICH IS WHY THE STRAIGHT-LINE PROJECTION IS THE MODEL HERE -
// guardTrack answers null without one, and that is the regime in_extremis pinned its levels
// in. A route-following projection is a different question and has its own suite.
function standingIn(sogKn) {
  mission = { lines: [LINE_E], waypoints: [LINE_E.a, LINE_E.b],
              speeds: { transit: "high", turn: "low", survey: "survey" }, approach_radius_m: 2 };
  S = { armed: true, estop: false, run: "running", behavior: "survey",
        status: { cog_deg: 0, sog_kn: sogKn, heading_deg: null,
                  env_set_deg: 0, env_set_kn: 0, holding: false, drifting: false } };
  asv = ll(0, 0);
  runLineIdx = 0;
  runRoute = [ll(-200, 0), LINE_E.b, ll(200, 60), ll(-200, 60)];
  window._wpIndex = 1;                                    // one leg flown, three to go
  nogo = { ready: true, frame: ref, ko: PIER, buffer: 5 };
  __clr = { m: 25, kind: "a dock / pier", info: { kind: "a dock / pier" } };
  clearance = { m: 25, kind: "a dock / pier", closing: true, slowed: false, prev: null,
                info: { kind: "a dock / pier" } };
  guardLevel = "clear"; guardOverride = null; guardHeld = null;
  // ⚠ THE HOLD RUNG'S PER-EPISODE RECORD GOES BACK TOO. The page clears both where it clears
  // guardOverride; a fixture that did not would start its episode with the hold already
  // "acted" and the rung would command nothing - the harness leaking, not the subject.
  guardActedAt = 0; holdWant = null;
  resumeSlow = false; commandedSpeed = null; edgeSpentM = 999;
  guardEdgeAt = 0; edgeCount = 0; refuse = null;
  sent = []; notes = []; banners = []; logged = []; planIntent = { why: [] };
}

// ── THE OTHER WATER: a pier east of e = 0, and a route with a corner that fouls it ────
// ⚠ A SECOND FIXTURE, BECAUSE standingIn CANNOT REACH THE EDGE RUNG AT ALL. It publishes no
// heading (guardTrack answers null) and it spends the whole deviation budget on purpose
// (edgeSpentM = 999), which is how the rung stayed undriven by every suite that had the
// bundle to drive it: tests/track_edge.js owns the deviation but only greps the page's text.
// The geometry is track_edge check 27's - four waypoints, and the corner that must move is
// the THIRD, not the leg the boat is on.
const PIER_E = (() => {
  const r = [{ e: 0, n: -20 }, { e: 60, n: -20 }, { e: 60, n: 20 }, { e: 0, n: 20 }];
  return { polys: [{ ring: r, bb: bbOf(r), kind: "a dock / pier" }],
           lines: [], points: [], marks: [], sys: [], chans: [] };
})();
const FOUR = [{ e: -105, n: 0 }, { e: -105, n: 15 }, { e: -7, n: 15 }, { e: -7, n: 80 }];
function deviating() {
  mission = { lines: [], waypoints: [], speeds: { transit: "high", turn: "low", survey: "survey" },
              approach_radius_m: 2 };
  S = { armed: true, estop: false, run: "running", behavior: "survey",
        status: { cog_deg: 90, sog_kn: 7.0, heading_deg: 90,
                  env_set_deg: 0, env_set_kn: 0, holding: false, drifting: false } };
  asv = ll(-120, 0);
  runLineIdx = -1;
  runRoute = FOUR.map(w => ll(w.e, w.n));
  window._wpIndex = 0;
  nogo = { ready: true, frame: ref, ko: PIER_E, buffer: 5 };
  __clr = { m: 30, kind: "a dock / pier", info: { kind: "a dock / pier" } };
  clearance = { m: 30, kind: "a dock / pier", closing: true, slowed: false, prev: null,
                info: { kind: "a dock / pier" } };
  guardLevel = "clear"; guardOverride = null; guardHeld = null;
  guardActedAt = 0; holdWant = null;
  resumeSlow = false; commandedSpeed = null;
  edgeSpentM = 0; edgeCount = 0; guardEdgeAt = 0; refuse = null;   // the budget is UNSPENT here
  sent = []; notes = []; banners = []; logged = []; planIntent = { why: [] };
}

console.log("The guard stopped the survey, and the operator has to be able to carry on slowly:");

// ── 1-2. THE OFFER EXISTS, AND IT IS THE FIRST ONE ─────────────────────────────────
// The cautious answer goes before the full-speed one. An operator reaching for the only
// button on a bar is not choosing between them.
{
  const low = H.indexOf('id="gb_low"'), pro = H.indexOf('id="gb_proceed"');
  check("1. the guard bar carries a LOW-SPEED offer, ahead of the full-speed PROCEED",
        () => low > 0 && pro > low,
        () => "gb_low at " + low + ", gb_proceed at " + pro + " - PROCEED restores the "
            + "SURVEY speed, and past a feature the operator can see that is not what "
            + "\"keep going\" means");
  const title = (H.slice(low, H.indexOf("</button>", low)).match(/title="([^"]*)"/) || [])[1] || "";
  check("2. ... and it says what it stops doing, and what it does not stop doing",
        () => /stops STOPPING/.test(title) && /LOW speed/.test(title)
              && /watching/.test(title) && /helm in extremis/.test(title),
        () => "\"" + title.slice(0, 90) + "...\" - an override whose label does not bound "
            + "itself is read as switching the guard off");
}

// ── 3-4. THE BAR, DRIVEN ───────────────────────────────────────────────────────────
{
  standingIn(6);
  const shown = (lvl) => { renderGuardBar({ level: lvl, why: "x" }, clearance);
                           return { bar: EL["#guardBar"].style.display,
                                    low: EL["#gb_low"].style.display,
                                    text: EL["#gb_low"].textContent }; };
  const atSlow = shown("slow"), atHold = shown("hold"), atEdge = shown("edge");
  S.armed = false; const unarmed = shown("hold"); S.armed = true;
  check("3. the offer stands at the two rungs that impede the boat, and nowhere else",
        () => atSlow.low === "" && atHold.low === "" && atEdge.low === "none"
              && unarmed.low === "none",
        () => "slow " + (atSlow.low || "shown") + " / hold " + (atHold.low || "shown")
            + " / edge " + atEdge.low + " / unarmed " + unarmed.low + " - a deviation IS "
            + "forward progress, so offering it there teaches the operator to press it out "
            + "of habit before the one that matters");

  // ⚠ THE STATE THE BAR USED TO MISS ENTIRELY. Once she is station-keeping the ladder reads
  // CLEAR - the hold rung is only reached when the drift-only track is clear, which is what
  // stopping produces - so the bar went out and nothing said the survey was over.
  guardHeld = { route: runRoute.slice(), idx: 1, mark: { line: 0 }, at: null,
                kind: "a dock / pier", clearM: 25.0, t: Date.now() };
  S.behavior = "hold"; S.status.holding = true;
  renderGuardBar(null, clearance);
  const held = { bar: EL["#guardBar"].style.display, low: EL["#gb_low"].textContent,
                 rung: EL["#gb_rung"].textContent, why: EL["#gb_why"].textContent,
                 drop: EL["#gb_drop"].style.display };
  check("4. a survey the guard has already stopped keeps the bar up, and says how much is left",
        () => held.bar === "block" && /RESUME SURVEY AT LOW/.test(held.low)
              && /SURVEY HELD/.test(held.rung) && /3 waypoints unflown/.test(held.why)
              && /a dock \/ pier/.test(held.why) && held.drop === "",
        () => "\"" + held.rung + " - " + held.why + "\" - a bar that only said \"holding\" "
            + "would be asking the operator to choose between re-running the lot and "
            + "abandoning it without telling them which");
  guardHeld = null;
}

// ── 5-7. THE CAPTURE, DRIVEN THROUGH THE REAL RUNG ─────────────────────────────────
// ⚠ DRIVEN, BECAUSE READING THE RUNG'S TEXT PROVES NOTHING ABOUT ORDER. The whole value of
// the capture is that it happens in the frame BEFORE the hold command, while `_wpIndex`
// still counts the survey; a check that greps for `markGuardHeld(c)` passes just as happily
// with the call after the command.
{
  standingIn(6);
  const r = tryIt(() => clearanceGuard());
  const paths = sent.map(x => x.p);
  check("5. the HOLD rung fires on this fixture, and keeps the survey before it stops it",
        () => !r.raised && paths.includes("/api/cmd/hold") && !!guardHeld
              && guardHeld.route.length === 4 && guardHeld.idx === 1,
        () => (r.raised ? "RAISED " + r.raised + " - " : "")
            + "sent " + JSON.stringify(paths) + "; kept " + (guardHeld ? guardHeld.route.length
            + " waypoints from index " + guardHeld.idx : "NOTHING") + ". The hold uploads a "
            + "one-waypoint plan over the survey, so what is not kept here is gone");

  // The index is the fact that matters: after the hold, `wp_index` is 0 of 1 and describes
  // the hold point. A capture taken a moment later says the survey had nothing flown.
  check("6. ... at the index the SURVEY was at, not the one the hold leaves behind",
        () => guardHeld.idx === 1 && guardHeld.route[0] !== undefined
              && distTo(guardHeld.route[1], LINE_E.b) < 0.5
              && !!guardHeld.mark && guardHeld.mark.line === 0,
        () => "index " + guardHeld.idx + " of " + guardHeld.route.length + ", on line "
            + (guardHeld.mark ? guardHeld.mark.line + 1 : "--") + " - captured after the "
            + "command, the same code reads index 0 of the hold and offers to re-run the "
            + "whole survey");

  standingIn(6); S.behavior = "goto";
  tryIt(() => clearanceGuard());
  const afterGoto = guardHeld;
  standingIn(6); window._wpIndex = 4;             // the last waypoint is flown
  tryIt(() => clearanceGuard());
  const afterDone = guardHeld;
  check("7. and nothing is kept for a run that is not a survey, or one with nothing unflown",
        () => afterGoto === null && afterDone === null,
        "a held Go-To is re-commanded in one click, and offering to \"resume\" a survey with "
        + "no remainder would upload an empty plan");
}

// ── 8. THE OFFER IS ABOUT THE BOAT IN FRONT OF THE OPERATOR ────────────────────────
{
  standingIn(6); tryIt(() => clearanceGuard());
  const kept = guardHeld;
  S.behavior = "hold"; S.status.holding = true;
  const live = guardHeldOffer();
  S.run = "stopped";
  const stopped = guardHeldOffer();
  const cleared = guardHeld;
  // and a behavior change is the other way the situation stops being this one: an RTH, a
  // Go-To or an escape is a different command, and the survey it captured is not what the
  // boat is doing any more.
  standingIn(6); tryIt(() => clearanceGuard());
  S.behavior = "hold"; S.status.holding = true;
  const held2 = guardHeldOffer();
  S.behavior = "rth";                       // still running, but a different command
  const onRth = guardHeldOffer();
  // ...and the console has to be able to COMMAND before it offers to
  standingIn(6); tryIt(() => clearanceGuard());
  S.behavior = "hold"; S.status.holding = true;
  S.armed = false;  const unarmed = guardHeldOffer(), survivesUnarmed = guardHeld;
  S.armed = true; S.estop = true;  const stopped2 = guardHeldOffer();
  S.estop = false;
  check("8b0. an RTH or Go-To is a different command, and clears the offer with it",
        !!held2 && onRth === null,
        "behavior 'hold' -> offer stands; behavior 'rth' -> " + (onRth ? "STILL THERE" : "cleared")
        + ". Only the guard's own hold is the situation this offer is about");
  check("8b1. ... and a disarmed or e-stopped console is not offered a resume it cannot send",
        unarmed === null && stopped2 === null && !!survivesUnarmed,
        "disarmed -> " + (unarmed ? "OFFERED" : "withheld") + ", e-stopped -> "
        + (stopped2 ? "OFFERED" : "withheld") + "; the capture itself survives ("
        + (survivesUnarmed ? "yes" : "NO") + ") because disarming is not the situation changing");

  // The #b_hold handler, sliced from its own line to the end of its arrow body, so the
  // check below can ask WHERE its statements sit relative to the gate.
  const BHOLD = H.slice(H.indexOf('$("#b_hold").onclick'),
                        H.indexOf("// (Go-To and Set Home are rows"));
  check("8. the offer stands only while she is still holding under the guard's hold",
        () => !!kept && live === kept && stopped === null && cleared === null
              // ⚠ ANCHORED ON THE PROPERTY, NOT THE ORDER. This matched
              // `guardHeld=null; cmd("/api/cmd/hold"` - the clear immediately BEFORE the
              // post - which stopped being true on 2026-09-22 when the handler moved its
              // clears PAST the reply (a refused Hold must not wipe the plan she is still
              // flying). What this check is about is that the operator's OWN Hold clears
              // the offer BY NAME, because the state cannot tell it from the guard's.
              // ⚠ The clear is CONDITIONAL now - `if(guardHeld === was.held) guardHeld = null;`
              // - so that an accepted Hold cannot erase an offer a command made during its
              // own round trip. The property is unchanged: this button clears the offer BY
              // NAME, past the gate.
              // ⚠⚠ THE GATE MUST EXIST BEFORE ITS POSITION MEANS ANYTHING. Written as
              // `... > BHOLD.indexOf("took(r)")` this passed for the very revert it exists to
              // catch: delete the gate and the token goes with it, indexOf answers -1, and
              // every real offset beats -1. A check whose failure mode is "the thing I am
              // looking for is absent" must say so, not treat absence as a free pass.
              && /guardHeld\s*=\s*null/.test(BHOLD) && /cmd\("\/api\/cmd\/hold"/.test(BHOLD)
              && BHOLD.indexOf("took(r)") >= 0
              && BHOLD.search(/guardHeld\s*=\s*null/) > BHOLD.indexOf("took(r)"),
        "Stop, Start, Upload, RTH, Go-To and a spawn all change run/behavior/holding, so "
        + "each clears this by not matching rather than by remembering to. The operator's "
        + "OWN Hold looks identical from here, so that button clears it by name");
}

// ── 8b-8c. THE TWO WAYS THE CAPTURE WAS BEING THROWN AWAY (both live, 2026-09-10) ──────
{
  standingIn(6); tryIt(() => clearanceGuard());
  const kept = guardHeld;

  // ⚠ THE ARRIVAL GAP. A hold command uploads a one-waypoint plan and STARTS it; the vessel
  // reports `holding` only once it has ARRIVED. Andy's log: commanded 12:39:00, station-
  // keeping at 12:39:05 - five seconds in which behavior is "hold" and holding is false. The
  // offer used to demand `holding`, so the very next telemetry frame spent the record.
  S.behavior = "hold"; S.status.holding = false; S.run = "running";
  const inGap = guardHeldOffer();
  const stillThere = guardHeld;
  S.status.holding = true;
  const arrived = guardHeldOffer();
  check("8b. the offer survives the ARRIVAL GAP, where behavior is hold and holding is not yet",
        !!kept && inGap === kept && stillThere === kept && arrived === kept,
        "commanded -> " + (inGap ? "offer stands" : "OFFER GONE") + "; arrived -> "
        + (arrived ? "offer stands" : "OFFER GONE") + ". Five seconds of `holding === false` "
        + "is the state the offer is most needed in, not a state to discard it in");

  // ⚠ AND THE SECOND FIRING. The hold rung fired three times in five seconds as the
  // clearance closed (25.4 -> 24.0 -> 21.3 m). By the third, behavior was already "hold", so
  // markGuardHeld returned early - after the `guardHeld = null` on its own first line had
  // already spent what the FIRST call captured.
  const before = guardHeld;
  tryIt(() => markGuardHeld({m: 21.3, kind: "a dock / pier"}));
  check("8c. ... and a second hold firing does not spend what the first one captured",
        guardHeld === before && !!guardHeld && guardHeld.route.length === 4,
        "markGuardHeld called again with behavior already 'hold' -> "
        + (guardHeld ? guardHeld.route.length + " waypoints still held" : "NOTHING HELD")
        + ". A function that gives up has to leave what it found alone");

  // ⚠ 8d IS THE ACCEPTANCE HALF OF THE HOLD RETRY (2026-09-21), and it belongs HERE rather
  // than beside its sibling in clearance_guard.js because that world's cmd stub only RECORDS
  // - S.behavior never becomes "hold" there, so every frame in it is the refused case and a
  // retry that ignored the vessel's answer would survive its mutation run untouched. It did.
  // Here the hold is MODELLED, so this is the only place the console can be caught re-uploading
  // a hold over the boat's own hold plan, once a second, for as long as she lies there.
  {
    standingIn(6);
    const first = tryIt(() => clearanceGuard());
    const sentFirst = sent.map(x => x.p).filter(p => p === "/api/cmd/hold").length;
    // the vessel takes it, and says so - the same predicate the offer above trusts
    S = { ...S, behavior: "hold" };
    sent = [];
    // far past SLOW_ANSWER_MS: if the retry were judged on the clock alone it would fire here
    const realNow = Date.now;
    Date.now = () => realNow() + 60000;
    tryIt(() => clearanceGuard());
    tryIt(() => clearanceGuard());
    Date.now = realNow;
    const after = sent.map(x => x.p).filter(p => p === "/api/cmd/hold").length;
    check("8d. ... and a hold the vessel HAS taken is not re-sent - the retry reads her answer, "
          + "not the clock",
          () => !first.raised && sentFirst === 1 && after === 0,
          () => "first frame sent " + sentFirst + " hold(s); two further frames a minute later, "
              + "with behavior already 'hold', sent " + after
              + ". A retry gated on the deadline alone would upload a fresh one-waypoint plan "
              + "over the boat's own hold plan for as long as she lay there");
  }
}

// ── 9-15. THE RESUME, DRIVEN ───────────────────────────────────────────────────────
async function resumeFrom(opts) {
  opts = opts || {};
  standingIn(6);
  tryIt(() => clearanceGuard());                  // the real rung makes the real capture
  S.behavior = "hold"; S.status.holding = true; S.run = "running";
  asv = ll(0, 0);
  if (opts.ko) nogo = { ...nogo, ko: opts.ko };
  if (opts.noModel) nogo = { ...nogo, ready: false, frame: null, ko: null };
  refuse = opts.refuse || null;
  sent = []; notes = []; banners = []; logged = []; planIntent = { why: [] };
  const ov = [];
  const before = sent.length;
  // ⚠ WRAPPED, BECAUSE THE FAULT 12a TESTS FOR IS A THROW. legClear dereferences the frame,
  // so the no-model mutation raises inside the subject - and an unwrapped await here kills
  // the run before a single FAIL line prints, which a runner reading stdout scores as
  // SURVIVED. A harness that cannot survive the fault it tests for cannot report it.
  let raised = null;
  try { await resumeHeldSurvey(); } catch(e) { raised = e.message; }
  refuse = null;
  const up = sent.find(x => x.p === "/api/cmd/upload");
  return { paths: sent.map(x => x.p), sent, up, notes, banners, logged, ov, before, raised };
}
(async () => {
  const back = 12 * 7.71;                                     // 92.5 m on this hull
  const r = await resumeFrom();

  // ⚠ THE PAUSE IS THE SAFETY HALF. `upload_plan` clears `_holding` and sets the speed to
  // the TRANSIT role while `_running` is still true from the hold - so an upload to a
  // station-keeping boat releases her, at the fastest role, before the Start that was
  // meant to release her is ever sent.
  check("9. she is PAUSED before the remainder is uploaded, and started after it",
        () => r.paths.indexOf("/api/cmd/pause") === 0
              && r.paths.indexOf("/api/cmd/pause") < r.paths.indexOf("/api/cmd/upload")
              && r.paths.indexOf("/api/cmd/upload") < r.paths.indexOf("/api/cmd/speed")
              && r.paths.indexOf("/api/cmd/speed") < r.paths.indexOf("/api/cmd/start")
              && r.sent.find(x => x.p === "/api/cmd/speed").speed === "low",
        () => JSON.stringify(r.paths) + ", the speed being '"
            + (r.sent.find(x => x.p === "/api/cmd/speed") || {}).speed + "'. Without the "
            + "pause she takes off at the transit speed the moment the upload lands");

  const rte = (r.up && r.up.route) || [];
  check("10. it uploads the REMAINDER, not the survey",
        () => rte.length === 4 && distTo(rte[1], LINE_E.b) < 0.5,
        () => "uploaded " + rte.length + " waypoints - the 3 she had left plus the rejoin "
            + "point. Uploading all 4 of the original would re-run the flown part; "
            + "uploading nothing at all is the state this feature exists to end");

  check("11. ... with the rejoin point first, twelve boat lengths back down her line",
        () => rte.length === 4 && Math.abs(alongLineM(LINE_E, rte[0]) - (200 - back)) < 0.5
              && __backLengths() === 12,
        () => "she was 200.0 m along a 400 m line and rejoins at "
            + alongLineM(LINE_E, rte[0]).toFixed(1) + " m - " + back.toFixed(1)
            + " m back over water she has already surveyed, so the new coverage overlaps "
            + "the old before it reaches the hole the hold left");

  // A wall right across the water she would back through. Real keep-outs, real legClear.
  const foulKo = { polys: [PIER.polys[0],
                   // WEST of her, because west is the way back: she is at e=0, 200 m along
                   // a line that starts at e=-200, and rejoins at e=-92.5.
                   (() => { const q = [{ e: -130, n: -30 }, { e: -80, n: -30 },
                                       { e: -80, n: 30 }, { e: -130, n: 30 }];
                            return { ring: q, bb: bbOf(q), kind: "land" }; })()],
                   lines: [], points: [], marks: [], sys: [], chans: [] };
  const foul = await resumeFrom({ ko: foulKo });
  const foulRte = (foul.up && foul.up.route) || [];
  check("12. a foul way back gives up the BACKTRACK, and never the resume",
        () => foul.paths.includes("/api/cmd/start") && foulRte.length === 3
              && foul.notes.join(" ").includes("WITHOUT the backtrack"),
        () => "with a keep-out across the way back she uploaded " + foulRte.length
            + " waypoints (the remainder, no rejoin point) and said \""
            + (foul.notes[0] || "") + "\" - the survey resumes either way; it is the "
            + "backtrack that is given up");

  // ⚠ AND "NO CHART" IS NOT "CLEAR". legClear dereferences the frame in its first line, so
  // a resume pressed while the model is being rebuilt - a port change, a fresh extract -
  // used to throw inside the handler and the button did nothing at all, silently, on a
  // safety path. The answer where there is no model is the same as where the water is foul.
  const blind = await resumeFrom({ noModel: true });
  check("12a. no keep-out model is not a clear way back either — and never a throw",
        () => !blind.raised && blind.paths.includes("/api/cmd/start")
              && ((blind.up && blind.up.route) || []).length === 3
              && blind.notes.join(" ").includes("could not be certified"),
        () => (blind.raised ? "RAISED \"" + blind.raised + "\" - " : "")
            + "with the model unloaded she sent " + JSON.stringify(blind.paths) + " and said \""
            + (blind.notes[0] || "") + "\" - the console cannot certify water it has no chart "
            + "for, and a resume is not the moment to start assuming");

  check("12b. ... and she is held at LOW either way, backtrack or no",
        () => resumeSlow === true
              && foul.sent.some(x => x.p === "/api/cmd/speed" && x.speed === "low")
              && r.sent.some(x => x.p === "/api/cmd/speed" && x.speed === "low"),
        "a resume past a hazard the console wanted to stop for is cautious whether or not "
        + "there was a line to back down");

  check("13. the drawn route is re-pointed at what was actually uploaded",
        () => runRoute.length === 3 && runUnsafe.length === 0,
        () => "runRoute is " + runRoute.length + " waypoints - the upload restarted "
            + "`wp_index` at zero, so a drawn route still holding the whole survey would "
            + "index every card and every derived figure into the wrong leg");

  const bad = await resumeFrom({ refuse: "/api/cmd/upload" });
  check("14. a refused upload puts her back on station rather than leaving her drifting",
        () => bad.paths.includes("/api/cmd/hold")
              && bad.paths.indexOf("/api/cmd/hold") > bad.paths.indexOf("/api/cmd/upload")
              && !bad.paths.includes("/api/cmd/start")
              && guardOverride === null && resumeSlow === false && !!guardHeld
              && bad.banners.join(" ").includes("COULD NOT RESUME"),
        () => "sent " + JSON.stringify(bad.paths) + " - she is paused beside the very "
            + "feature the console stopped her off, and a paused boat does not "
            + "station-keep, it drifts. The offer stays up: " + (guardHeld ? "yes" : "NO"));

  // ⚠ BEFORE THE FIRST COMMAND, or the guard re-holds her inside a frame and the button
  // reads as broken rather than as refused.
  const ok = await resumeFrom();
  lastResume = ok;
  check("15. the override is recorded before anything is commanded",
        () => !!guardOverride && guardOverride.slow === true
              && H.indexOf("guardOverride = {t: Date.now(), level: \"hold\"")
                 < H.indexOf('await cmd("/api/cmd/pause")'),
        () => "override " + JSON.stringify(guardOverride) + " - the hazard has not moved, "
            + "and the guard runs on every telemetry frame");

  // 15b. EACH STEP HAS TO LAND BEFORE THE NEXT GOES (review #6). The resume sent Start after a
  // LOW it never checked: refused, she resumed beside the feature at whatever speed the upload
  // left, the banner said LOW, and the override stopped the guard from holding her.
  // TEETH, sidecar ASV_HTML: resumeHeldSurvey ignores a refused LOW -> 15b (killed).
  const noLow = await resumeFrom({ refuse: "/api/cmd/speed" });
  check("15b. a resume whose LOW is refused does NOT start - she is put back on station, the offer stays",
        () => !noLow.paths.includes("/api/cmd/start")
              && noLow.paths.lastIndexOf("/api/cmd/hold") > noLow.paths.indexOf("/api/cmd/speed")
              && noLow.banners.some(b => /COULD NOT RESUME/.test(b)) && !!guardHeld,
        () => JSON.stringify(noLow.paths) + "; offer still up: " + !!guardHeld);
  finish();
})();

// ⚠ EVERYTHING BELOW RUNS AFTER THE DRIVEN BLOCK, WHICH IS ASYNC. A hoisted declaration,
// called from that block's tail - because a suite that prints its verdict while its driven
// checks are still pending has not reached one.
function finish() {

// ── 16-17. WHAT THE FORCE ACTUALLY SUPPRESSES ──────────────────────────────────────
// Two overrides, one record. A full PROCEED suppresses both rungs that impede the boat; a
// CONTINUE AT LOW suppresses only the one that STOPS it - "keep surveying, slowly" is not
// "keep surveying at survey speed", and the console must not read it as such.
{
  // ⚠ guardLevel STAYS "clear" IN ALL SIX RUNS, AND THE FIRST CUT DID NOT. Setting it to
  // "hold" for the overridden runs made `escalated` false, so those runs sent nothing for a
  // reason that had nothing to do with the override - and the CONTROL mutation (a LOW
  // override that suppresses the hold as well) walked straight through a green check. The
  // detail line had been printing the evidence all along: `none` acted, `low` and `full`
  // were both empty, and they were not the same experiment.
  const drive = (over, sogKn) => {
    standingIn(sogKn);
    guardOverride = over ? { t: Date.now(), level: "hold", clearM: 25, slow: over === "low" }
                         : null;
    guardLevel = "clear";
    tryIt(() => clearanceGuard());
    return sent.map(x => x.p + (x.speed ? ":" + x.speed : ""));
  };
  const holdNone = drive(null, 6),  holdLow = drive("low", 6),  holdFull = drive("full", 6);
  const slowNone = drive(null, 1.5), slowLow = drive("low", 1.5), slowFull = drive("full", 1.5);
  check("16. a LOW override stops the STOPPING, and a full PROCEED stops the slowing too",
        () => holdNone.includes("/api/cmd/hold")
              && !holdLow.includes("/api/cmd/hold") && !holdFull.includes("/api/cmd/hold")
              && slowNone.includes("/api/cmd/speed:low")
              && slowLow.includes("/api/cmd/speed:low")
              && !slowFull.includes("/api/cmd/speed:low"),
        () => "hold rung: none " + JSON.stringify(holdNone) + " / low "
            + JSON.stringify(holdLow) + " / full " + JSON.stringify(holdFull)
            + "  |  slow rung: none " + JSON.stringify(slowNone) + " / low "
            + JSON.stringify(slowLow) + " / full " + JSON.stringify(slowFull));

  // ⚠ THE LOW IS THE OPERATOR'S, NOT THE GUARD'S. Left as `clearance.slowed`, the guard's
  // own release restores the SURVEY speed the moment the water reads clear - undoing the
  // instruction without the operator touching anything.
  standingIn(6);
  clearance.slowed = true; guardLevel = "slow";
  tryIt(() => continueAtLow());
  lastContinue = { banners: banners.slice(), logged: logged.slice(), why: planIntent.why.slice() };
  check("17. the throttle passes from the safety ladder to the operator, not back to the role",
        () => clearance.slowed === false && resumeSlow === true
              && !!guardOverride && guardOverride.slow === true
              && sent.some(x => x.p === "/api/cmd/speed" && x.speed === "low"),
        () => "slowed=" + clearance.slowed + ", resumeSlow=" + resumeSlow
            + " - two flags meaning \"low\", and only one of them survives the guard "
            + "reading clear. It has to be the operator's");
}

// ── 18. LOW UNTIL THE OPERATOR SAYS OTHERWISE ──────────────────────────────────────
{
  standingIn(6);
  S.status.holding = false; S.behavior = "survey"; runLineIdx = 0; curTurn = -1;
  clearance.slowed = false; commandedSpeed = null; resumeSlow = false; sent = [];
  const governed = speedGovernor();
  const freeSent = sent.filter(x => x.p === "/api/cmd/speed").length;
  resumeSlow = true; commandedSpeed = null; sent = [];
  const held = speedGovernor();
  const heldSent = sent.filter(x => x.p === "/api/cmd/speed").length;
  check("18. the governor stands down while the low-speed hold is set",
        () => governed !== null && freeSent === 1 && held === null && heldSent === 0,
        () => "ordinary frame -> commands '" + governed + "' (" + freeSent + " sent); with "
            + "the hold set -> " + held + " (" + heldSent + " sent). It is the same flag the "
            + "pause resume takes, released the same one way - a manual role-speed change "
            + "(tests/pause_resume.js 14)");
  resumeSlow = false;

  // ⚠⚠ 18a. AND IT STANDS DOWN WHEN THE PAGE CANNOT SAY WHICH LINE SHE IS ON. `indexedRoute()`
  // answers null on a page loaded mid-run - it never held `runRoute` and cannot get it back.
  // Every READOUT prints that as "--" or as a row saying so; the SPEED path must not print
  // it as a number, and left alone it would, by the quietest route on the page:
  // currentLegLine answers -1, so `runLineIdx` and `curTurn` stay -1, and currentActivity
  // falls through to "between coverage regions", whose role is TRANSIT. The governor would
  // command 6.0 kn on coverage lines being surveyed at 3.0, and through reversals the
  // planner fitted at the 1.5 kn turn radius - with `turnSlowAt` unreachable because the
  // role never equals "turn". "Cannot say" must never resolve as the fastest speed.
  {
    S.status.holding = false; S.behavior = "survey"; runLineIdx = 0; curTurn = -1;
    clearance.slowed = false; resumeSlow = false; escapeThrottle = false;
    const drawn = runRoute.slice();
    commandedSpeed = null; sent = [];
    const held = speedGovernor();                       // the page that DID upload
    const heldSent = sent.filter(x => x.p === "/api/cmd/speed").length;
    runRoute = null;                                    // ...and the same frame after a reload
    mission.waypoints = drawn.slice(0, 2);              // a shorter drawn plan
    S = { ...S, wp_total: drawn.length + 12 };          // ...against a route she is flying
    commandedSpeed = null; sent = [];
    const lost = speedGovernor();
    const lostSent = sent.filter(x => x.p === "/api/cmd/speed").length;
    runRoute = drawn;
    check("18a. the governor stands down on a page that does not hold the route the vessel's "
          + "index counts into - it does not fall through to the TRANSIT speed",
          () => held !== null && heldSent === 1 && lost === null && lostSent === 0,
          () => "the uploading page commands '" + held + "' (" + heldSent + " sent); the "
              + "same frame on a reloaded page -> " + lost + " (" + lostSent + " sent). "
              + "Without the stand-down it commands the TRANSIT role, because currentLegLine "
              + "answers -1 and currentActivity reads that as 'between coverage regions'");
  }

  // ⚠⚠ 18b. AND IT STANDS DOWN FOR THE ESCAPE TOO, WHICH IS THE SAME CLAIM POINTING UP.
  // The helm rung commands HIGH for steerage authority to beat the set, then sets
  // `clearance.slowed = false` and nulls `commandedSpeed` - and onState runs
  // `clearanceGuard(); accumLineTime(); speedGovernor();` in that order, so on the SAME frame
  // every one of the governor's stand-downs passed and it commanded the ROLE speed
  // microseconds later. With the shipped defaults that is 6.0 kn followed by 3.0 kn; and
  // because `speedWant` was overwritten, speedReconcile then RE-SENT the wrong speed every
  // second for the whole escape. On the next frame `behavior` is "escape", whose activity
  // role is "transit", so it never recovered - the escape was flown at half the speed the
  // rung exists to provide, against exactly the set the rung exists to beat.
  //
  // ⚠ SETTING `commandedSpeed = "high"` INSTEAD WOULD NOT FIX IT, and that is why the fix is
  // a stand-down rather than a value: the governor's test is `want !== commandedSpeed`, and
  // `want` is the role speed - still different, so it would still fire.
  clearance.slowed = false; commandedSpeed = null; resumeSlow = false;
  escapeThrottle = true; sent = [];
  const duringEscape = speedGovernor();
  const escSent = sent.filter(x => x.p === "/api/cmd/speed");
  escapeThrottle = false;
  check("18b. ... and it stands down during an ESCAPE, so the helm rung's HIGH is not taken "
        + "back by the role speed on the very frame that commanded it",
        () => duringEscape === null && escSent.length === 0,
        () => "with the escape's claim set -> " + duringEscape + " (" + escSent.length
            + " speed command(s) sent: " + JSON.stringify(escSent.map(x => x.speed))
            + "). Ungated it commands the role speed here, which on the shipped defaults is "
            + "3.0 kn over the top of a 6.0 kn escape");

  // ⚠⚠ 18c. AND THE STAND-DOWN HAS TO END, WHICH IS THE HALF 18b CANNOT SEE. 18b passes
  // just as happily if the claim is never handed back at all - and until 2026-09-22 it never
  // was. `escapeThrottle` outlived its EPISODE and lasted the rest of the RUN: its only
  // clearers were a Stop, a fresh Start and a speed set by hand, so an operator recovering
  // from an escape by Go-To or RTH got no governor at all.
  //
  // ⚠ AND IT IS NOT ONLY THE ROLE SPEED THAT STOPS. `if(escapeThrottle) return null;` sits
  // above EVERY decision this function makes, so the flagged-corner slow-down and the
  // slow-radius turn rule stop firing with it - the two rules that exist precisely because
  // the hull cannot track those geometries at speed. Measured against this governor: with a
  // flagged corner ahead, the control commands `low` and the claim commands nothing.
  //
  // ⚠ THE PAIR IS THE CHECK. `escSent.length === 0` in 18b is also what an empty fixture
  // looks like; the send below is what makes it evidence that the GATE was the reason.
  clearance.slowed = false; commandedSpeed = null; resumeSlow = false;
  escapeThrottle = true; sent = [];
  const stillGagged = speedGovernor();
  const relSaid = releaseEscapeClaim("Go-To replaced it");
  const afterRelease = speedGovernor();
  const relSent = sent.filter(x => x.p === "/api/cmd/speed");
  check("18c. ... and the claim ENDS when the operator commands her somewhere: the governor "
        + "bids again on the next frame, and the speed actually goes out",
        () => stillGagged === null && relSaid === true && escapeThrottle === false
              && afterRelease !== null && relSent.length === 1,
        () => "gagged -> " + stillGagged + "; released -> " + afterRelease + " with "
            + relSent.length + " speed command(s) " + JSON.stringify(relSent.map(x => x.speed))
            + ". Both halves are needed: the gag alone is indistinguishable from a fixture "
            + "that never sends anything");

  // ⚠ 18d. AND THE HELPER IS SILENT WHEN THERE IS NOTHING TO RELEASE - asserted on the
  // NOTE, because the flag half of this CANNOT FAIL: `escapeThrottle` is already false, so
  // "correctly refused" and "nothing happened" are the same observation on it. The note is
  // the only thing that changes. Without the guard line the console flashes "the escape's
  // high-speed hold is over" at an operator who never had one, on every speed change.
  const n0 = notes.length;
  const noClaim = releaseEscapeClaim("there was no claim");
  check("18d. ... and releasing a claim that was never made says NOTHING - the flag half of "
        + "this check cannot fail, so it is the note that is asserted",
        () => noClaim === false && notes.length === n0,
        () => "returned " + noClaim + " and flashed " + (notes.length - n0) + " note(s); a "
            + "helper without its guard would announce a hand-back that never happened");
}

// ── 19-20. SAID OUT LOUD, BOTH WAYS ROUND ──────────────────────────────────────────
// ⚠ DRIVEN, AND THE FIRST CUT WAS NOT. Both of these grepped the function bodies, and a
// mutation that made the branch dead - `if(false) showBanner(...)`, `if(false && !await
// guiConfirm(...))` - left every string they looked for exactly in place and both went
// green: the override was silent and the remainder was thrown away unasked, and the suite
// said it was fine. So: read what was actually SAID, and what was actually ASKED.
{
  const ev = (r, how) => (r.logged || []).some(
    e => e.kind === "guard_low" && e.data && e.data.how === how);
  check("19. an operator overriding a safety intervention is announced and recorded, both ways",
        () => /CONTINUING AT LOW SPEED/.test(lastContinue.banners.join(" "))
              && ev(lastContinue, "slow_continue")
              && lastContinue.why.some(w => /CONTINUING AT LOW SPEED/.test(w.s))
              && /SURVEY RESUMED AT LOW SPEED/.test(lastResume.banners.join(" "))
              && ev(lastResume, "held_resume")
              && lastResume.notes.some(n => /resumed at LOW/.test(n)),
        () => "carrying on: " + lastContinue.banners.length + " banner(s), "
            + lastContinue.logged.length + " event(s); resuming: "
            + lastResume.banners.length + " banner(s), " + lastResume.logged.length
            + " event(s). A recording that does not say the guard was overridden cannot be "
            + "read afterwards");

  const drop = async (answer) => {
    standingIn(6); tryIt(() => clearanceGuard());
    S.behavior = "hold"; S.status.holding = true;
    confirmAnswer = answer; confirmAsked = 0; notes = [];
    await dropHeldSurvey();
    return { asked: confirmAsked, kept: !!guardHeld, notes };
  };
  (async () => {
    const said = H.slice(H.indexOf("async function dropHeldSurvey"), H.indexOf("async function dropHeldSurvey") + 800);
    const no = await drop(false), yes = await drop(true);
    check("20. dropping the remainder asks first, and says what it costs",
          () => no.asked === 1 && no.kept === true
                && yes.asked === 1 && yes.kept === false
                && /run again from/.test(said),
          () => "declined -> asked " + no.asked + " time(s), remainder "
              + (no.kept ? "kept" : "GONE") + "; accepted -> asked " + yes.asked
              + " time(s), remainder " + (yes.kept ? "STILL THERE" : "gone") + ". The plan "
              + "is already gone from the vessel, so this is not a dismiss - it is the "
              + "survey having to be re-planned and run from waypoint one");

    // ── 21-22. A DEVIATION THE VESSEL REFUSED CLAIMS NOTHING ───────────────────────────
    //
    // Review #7, 2026-09-21. The edge rung commanded /api/cmd/amend and then spliced runRoute,
    // spent the budget, wrote "DEVIATED" to the Intent card and flashed the operator - without
    // reading the reply. `amend` is refused by six gates (not armed, e-stopped, not running a
    // plan, station-keeping, an empty amendment, a plan with no unflown remainder) and answers
    // {ok:false, error} on a dropped link, so an operator Pause or flaky Wi-Fi all land there.
    // Accepted, refused and LOST produced byte-identical console state. Two consequences, and
    // the second is the dangerous one: guardTrack projects along runRoute, so from then on the
    // whole ladder assessed a track the boat was not flying (driven at the pier face: console
    // CLEAR at 11 m off while the plan she was actually holding read hold); and `guardEdgeAt`
    // stood the slow and hold rungs down under an amendment that never arrived.
    //
    // ⚠ THE COMMIT NOW LANDS ON A MICROTASK, so both cases await before reading runRoute. Any
    // future driven check of this rung must do the same.
    const deviate = async (refusal, lostPath) => {
      deviating();
      const before = runRoute.slice();
      refuse = refusal || null;
      lost = lostPath || null;
      tryIt(() => clearanceGuard());
      await Promise.resolve(); await Promise.resolve();
      refuse = null; lost = null;
      return { before, paths: sent.map(x => x.p), route: runRoute.slice(),
               spent: edgeSpentM, count: edgeCount, edgeAt: guardEdgeAt,
               why: planIntent.why.map(w => w.s), notes: notes.slice() };
    };
    const no2 = await deviate("/api/cmd/amend");
    // ...and the gate really is gone: spend the budget so the rung below is the one that acts,
    // and the very next frame must stop her rather than returning on a stale `settling`.
    edgeSpentM = 999; guardLevel = "clear"; sent = []; notes = [];
    asv = ll(-18, 15); window._wpIndex = 2;
    tryIt(() => clearanceGuard());
    const after = sent.map(x => x.p);
    check("21. a REFUSED deviation claims NOTHING - the drawn route is not spliced, the budget "
          + "is not spent, and the rung it stood down runs on the very next frame",
          () => no2.paths.includes("/api/cmd/amend")
                && no2.route.length === no2.before.length
                && no2.route.every((w, i) => w === no2.before[i])
                && no2.spent === 0 && no2.count === 0 && no2.edgeAt === 0
                && !no2.why.some(s => /DEVIATED/.test(s))
                && /REFUSED/.test(no2.notes.join(" "))
                && after.includes("/api/cmd/hold"),
          () => "tried " + JSON.stringify(no2.paths) + "; runRoute " + no2.route.length
              + " wpts (was " + no2.before.length + "), edgeSpentM " + no2.spent
              + ", guardEdgeAt " + no2.edgeAt + ", Intent " + JSON.stringify(no2.why)
              + ", said \"" + (no2.notes[0] || "") + "\"; next frame sent "
              + JSON.stringify(after) + ". A deviation the vessel refused must not move the "
              + "chart, must not spend the budget, and must not stand the slow and hold rungs "
              + "down - the console read CLEAR at 11 m off a pier face doing exactly that");
    // -- 14b-14c. THE HELD RESUME IS AN UPLOAD, AND THE CORNER SET CANNOT SURVIVE ONE --------
  // `hold` already uploaded a one-waypoint plan over the survey; this uploads the REMAINDER
  // over that. The vessel's waypoint numbering restarts at one both times, so every index in
  // the set names a corner of a plan that no longer exists - and `cornerSlowFor`, keyed on a
  // length, goes quiet by ITSELF here because a remainder is shorter than the survey it came
  // from. That silence is why this was invisible: the promise made at upload lapses with
  // nothing on screen, and the next Upload re-arms the whole mechanism as though it never had.
  {
    const armCorners = () => { cornerSlow = new Set([2, 3]); cornerUnanswered = [5];
                               cornerSlowFor = 99; cornerPlanKey = "survey"; };
    armCorners();
    const okR = await resumeFrom();
    const okSet = { slow: cornerSlow.size, un: cornerUnanswered.length, key: cornerSlowFor };
    check("14b. resuming the held remainder drops the corner set, and TELLS the operator it "
          + "has lapsed",
          () => okSet.slow === 0 && okSet.un === 0 && okSet.key === -1
                && /CORNER SLOWING HAS LAPSED/.test(okR.banners.join(" ")),
          () => "2 slowing + 1 unanswered before -> " + okSet.slow + " + " + okSet.un
              + ", key " + okSet.key + "; "
              + okR.banners.filter(b => /CORNER/.test(b)).length + " lapse banner(s). The "
              + "length key would fall silent here on its own - a remainder is shorter - so "
              + "without this the promise lapses with nothing said and the next Upload arms "
              + "it again as though it never had");

    // ⚠ AND THE PAIR. A REFUSED upload leaves her holding the plan the set was measured on,
    // so dropping it there throws a live measurement away for nothing - and an unconditional
    // drop at the top of resumeHeldSurvey passes 14b exactly as the right one does.
    armCorners();
    const noR = await resumeFrom({ refuse: "/api/cmd/upload" });
    const noSet = { slow: cornerSlow.size, un: cornerUnanswered.length, key: cornerSlowFor };
    check("14c. ... and a REFUSED upload keeps it - she never left the plan it measured",
          () => noSet.slow === 2 && noSet.un === 1 && noSet.key === 99
                && !/CORNER SLOWING HAS LAPSED/.test(noR.banners.join(" ")),
          () => "after a refusal: " + noSet.slow + " slowing + " + noSet.un + " unanswered, "
              + "key " + noSet.key + ", "
              + noR.banners.filter(b => /CORNER/.test(b)).length + " lapse banner(s). She is "
              + "put back on station on the very plan those corners index");
    cornerSlow = new Set(); cornerUnanswered = []; cornerSlowFor = -1;
  }

  // -- 22b-22c. AND THE RUNG'S OWN CORNER SET, WHICH THE SWEEP FOUND UNCOVERED -------------
  // ⚠⚠ 21 AND 22 BOTH RAN WITH AN EMPTY SET. They drive this rung harder than anything
  // else in the suite, and neither could see the drop, so the mutation that simply deletes it
  // - the exact defect the batch was written to fix - SURVIVED a sweep that reported seven
  // kills. A check cannot observe a state its fixture never enters.
  //
  // ⚠ AND THE LENGTH KEY WOULD NOT HAVE SAVED IT. A deviation that BENDS adds a waypoint,
  // so the key falls silent; one that MOVES a corner replaces a waypoint and the length does
  // not change, so the key stays TRUE and the set stays ARMED against a corner that has
  // physically moved by up to edgeCapM(buf). Both of those are driven here - the accepted
  // deviation below is a MOVE, which is the case "do nothing" gets wrong.
  {
    const armCorners = () => { cornerSlow = new Set([2, 3]); cornerUnanswered = [5];
                               cornerSlowFor = 99; cornerPlanKey = "survey"; };
    armCorners();
    const okD = await deviate(null);
    const okSet = { slow: cornerSlow.size, un: cornerUnanswered.length, key: cornerSlowFor };
    check("22b. an accepted deviation drops the corner set with the route it re-shaped, and "
          + "says the promise has lapsed",
          () => okSet.slow === 0 && okSet.un === 0 && okSet.key === -1
                && /CORNER SLOWING HAS LAPSED/.test(okD.notes.concat(banners).join(" ")),
          () => "2 slowing + 1 unanswered before -> " + okSet.slow + " + " + okSet.un
              + ", key " + okSet.key + ". The via point is a corner cornerSlowPlan never "
              + "walked and the corners either side of it have new geometry - a mapped flag "
              + "stale in VALUE where it is right in position");

    armCorners();
    const noD = await deviate("/api/cmd/amend");
    const noSet = { slow: cornerSlow.size, un: cornerUnanswered.length, key: cornerSlowFor };
    check("22c. ... and a REFUSED one keeps it - the plan the corners index is the plan she "
          + "is still flying",
          () => noSet.slow === 2 && noSet.un === 1 && noSet.key === 99
                && !/CORNER SLOWING HAS LAPSED/.test(noD.notes.concat(banners).join(" ")),
          () => "after a refusal: " + noSet.slow + " slowing + " + noSet.un + " unanswered, "
              + "key " + noSet.key + ". Check 21 already holds that a refusal claims nothing "
              + "else either - this is the same rule for the one piece of state it was "
              + "silently still claiming");

    // ⚠ AND THE THIRD ANSWER, WHICH IS THE ONE THE ASYMMETRY EXISTS FOR. `amend` answers
    // {ok:false, refused:false} when the reply never comes back, and she MAY have taken it.
    // 21 and 22c both drive a refusal, so between them they say "a failure keeps the set" -
    // which is the wrong rule stated in a form that looks right. On a MOVE amendment the
    // length key does not change either, so nothing downstream would catch it.
    armCorners();
    const lostD = await deviate(null, "/api/cmd/amend");
    const lostSet = { slow: cornerSlow.size, un: cornerUnanswered.length, key: cornerSlowFor };
    check("22d. ... and a LOST reply drops it, because she may have taken the deviation",
          () => lostSet.slow === 0 && lostSet.un === 0 && lostSet.key === -1
                && /NOT ACKNOWLEDGED/.test(lostD.notes.join(" ")),
          () => "after a lost reply: " + lostSet.slow + " slowing + " + lostSet.un
              + " unanswered, key " + lostSet.key + "; said \""
              + (lostD.notes[0] || "") + "\". A refusal is the vessel's answer and silence "
              + "is not one - the console cannot say which route she is flying");

    cornerSlow = new Set(); cornerUnanswered = []; cornerSlowFor = -1;
  }

  const yes2 = await deviate(null);
    check("22. ... and an ACCEPTED one still does its whole job - the corner moves, the budget "
          + "is spent, and both the operator and the Intent card are told",
          () => yes2.paths.includes("/api/cmd/amend")
                && yes2.route.length === yes2.before.length
                && yes2.route.some((w, i) => w !== yes2.before[i])
                && yes2.spent > 0 && yes2.count === 1 && yes2.edgeAt > 0
                && yes2.why.some(s => /^DEVIATED/.test(s))
                && /DEVIATED/.test(yes2.notes.join(" "))
                && !/REFUSED/.test(yes2.notes.join(" ")),
          () => "sent " + JSON.stringify(yes2.paths) + ", edgeSpentM " + yes2.spent
              + " over " + yes2.count + " deviation(s), guardEdgeAt "
              + (yes2.edgeAt ? "armed" : "NOT ARMED") + ", said \"" + (yes2.notes[0] || "")
              + "\". Andy asked for this rung on 2026-09-04 - \"forcing slight deviations to "
              + "prevent holds when there is still plenty of available water\" - and a console "
              + "made timid about a deviation the vessel ACCEPTED is the wrong fix");

    console.log(fails ? "\n" + fails + " CHECK(S) FAILED"
                      : "\nall checks passed (" + ran + ")");
    process.exit(fails ? 1 : 0);
  })();
}
}
