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
var S = null, asv = null, runRoute = null, runUnsafe = [], pauseMark = null;
var resumeSlow = false, commandedSpeed = null, guardOverride = null, guardHeld = null;
var clearance = { m: null, kind: null, closing: false, slowed: false, prev: null, info: null };
var guardLevel = "clear", clearAlarmAt = 0, guardActedAt = 0, guardEscapeAt = 0;
var guardEdgeAt = 0, edgeSpentM = 999, edgeCount = 0;   // 999: the deviation budget is spent
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
  return Promise.resolve({ json: () => Promise.resolve({}) });
};
// Commands are RECORDED, not stubbed to nothing, so a check can say WHAT was sent and in
// what order rather than only that something was. `refuse` drives the refusal branch.
var sent = [], refuse = null;
function cmd(p, b) {
  sent.push({ p, speed: b && b.speed, route: b && b.route });
  // ⚠ THE HOLD IS MODELLED, NOT JUST RECORDED, AND THAT IS WHAT MAKES CHECK 6 REAL. On the
  // vessel `hold` uploads a one-waypoint plan over the survey, so `wp_index` becomes 0 and
  // describes the hold. With a stub that only records, moving markGuardHeld to AFTER the
  // command changes nothing the suite can see - the mutation survives and the check is
  // decoration. Here the index really moves, so a late capture really reads the wrong one.
  if (p === "/api/cmd/hold") window._wpIndex = 0;
  return Promise.resolve(refuse && refuse === p ? { error: "ARM before uploading a plan" } : {});
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
  grab("lineMark"), grab("markGuardHeld"), grab("guardHeldOffer"),
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
  grabDecl("SPEED_RESEND_MS"), grabDecl("speedWant"), grab("commandSpeed"),
  grab("guardOverrideOk"), grab("guardTrack"), grab("clearanceGuard"),
  grab("renderGuardBar"), grab("renderHeldBar"),
  grab("continueAtLow"), grab("resumeHeldSurvey"), grab("dropHeldSurvey"),
  grab("logGuardLow"),
  grab("resumeBackM"), grab("resumePointOn"), grab("backtrackClear"), grab("alongLineM"),
  grab("roleSpeed"), grab("roleSpeedMS"), grab("linePhase"), grab("currentActivity"),
  grab("speedRole"), grab("speedGovernor"),
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
  resumeSlow = false; commandedSpeed = null; edgeSpentM = 999;
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

  check("8. the offer stands only while she is still holding under the guard's hold",
        () => !!kept && live === kept && stopped === null && cleared === null
              && /guardHeld=null; cmd\("\/api\/cmd\/hold"/.test(H),
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
    console.log(fails ? "\n" + fails + " CHECK(S) FAILED"
                      : "\nall checks passed (" + ran + ")");
    process.exit(fails ? 1 : 0);
  })();
}
}
