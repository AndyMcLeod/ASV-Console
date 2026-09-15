// tests/end_action.js - what does this run DO when it ends?
//
// Andy's report: with End of Plan = RTH the boat does come home at the end of a Go-To, a
// Transit or a Survey - the chain works - but until it fired, every readout said the run
// would LOITER. The vessel-status card read "goto · loiter" and the Mission card's End mode
// read LOITER, right up to the moment the boat turned for home. The one thing the operator
// wanted to confirm before the run ended was the one thing the console would not say.
//
// The cause is the same shape as the completion-field bug (see CLAUDE.md): `run_completion`
// is the literal completion the LINK was uploaded with, and for a Go-To / Transit / Hold
// that really is "loiter" - the run does station-keep at its endpoint. What happens NEXT is
// the console's end-of-plan RTH chain, which is a separate mechanism the readouts knew
// nothing about. So the readouts were each accurate about their own field and wrong about
// the boat.
//
// endAction() is the third value - what the operator actually asked: where does this run
// LEAVE THE BOAT? It is the only thing the two cards show now.
//
//   node tests/end_action.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// The rules it encodes, each of which is a way to get this wrong:
//   * The link holds at the last waypoint for BOTH "loiter" and "rth". "rth" only becomes
//     a return home because the CONSOLE chains one on seeing that hold. So the field never
//     decides on its own - the chain does.
//   * A run that never holds (repeat laps forever, complete stops) can never chain, so it
//     must not be advertised as an RTH however the setting reads.
//   * The chain needs a home, ARM and no E-STOP. Without them it cannot fire and the card
//     must not promise a return.
//   * Once the chain has been TRIED AND REFUSED (no route home), the boat stays at its
//     endpoint - retract the promise rather than keep displaying it.
//
// TEETH (verified by mutation, not assumed): drop the runHolds() guard from rthPending and
// 10 and 11 fail. Drop the `rc === "rth" -> "loiter"` fallback in endAction and 6 and 12
// fail. Read run_completion instead of the live setting in rthPending and 1, 2 and 12 fail.
// Drop the rthChainFailed guard and 9 fails. Drop the armed/estop guards and 7 and 8 fail.
// Drop the `behavior !== "rth"` guard and 5 fails. Re-arm the chain on every running frame
// (drop the !holding test) and 15 fails; re-arm only on idle -> running, the behaviour that
// produced the live bug, and 14 fails.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// check() turns a throw inside its own thunk into a failed check. Scenario SETUP is not
// inside one - building a world, eval-ing page code, awaiting a fetch - and a throw there
// would kill the process before a single FAIL line printed. "No FAIL lines" and "the
// process died" are indistinguishable to anything reading stdout, so a mutation that
// crashes this suite would score as SURVIVED. Report it instead, in the normal format.
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

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");
// the REAL vessel block, so a check leaning on a hull colour reads the shipped default
const { V } = require("../static/js/state.js");
// currentActivity now asks linePhase whether the boat is on a line's LEAD or its COVERAGE,
// and linePhase measures with the real geodesy. Given here rather than stubbed - a stub
// would let this suite pass against a page whose phase test had drifted from the one the
// boat is flown by. The fixtures below carry NO lead, so every line here is all coverage
// and the phase branches are never entered; they are driven in tests/survey_lead.js.
const { distTo, llEN } = require("../static/js/geodesy.js");
function fmtDist(m){ return Math.round(m) + " m"; }
// the page reads chart colours from CSS custom properties; there is no stylesheet here, so
// the fallback has to answer with SOMETHING - a boat drawn in "" is an invisible boat.
function getCSS(){ return "#39c0ff"; }

// a module-level `const NAME = ...;` pulled out verbatim - the REAL tuning value
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}
function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}

var S = null, rthChained = false, rthChainFailed = false, mission = { completion: "rth" };
// eslint-disable-next-line no-eval
// CHAINABLE_BEHAVIORS comes across VERBATIM with its helper - the real list, so a behaviour
// added to the page is tested here rather than in a copy of it that can drift.
eval(grabDecl("CHAINABLE_BEHAVIORS") + "\n" + grab("chainableRun") + "\n" +
     grab("runCompletion") + "\n" + grab("runHolds") + "\n" +
     grab("rthPending") + "\n" + grab("endAction") + "\n" + grab("rearmRthChain"));

let fails = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!cond) fails++;
}

// A live /api/state, as the two cards see it. `completion` is the operator's END-OF-PLAN
// SETTING; `run_completion` is what the link was uploaded with for the run in progress.
function state(over) {
  return Object.assign({
    behavior: "goto", completion: "rth", run_completion: "loiter",
    home: { lat: 38.78965, lon: -75.16094 }, armed: true, estop: false, run: "running"
  }, over || {});
}
// endAction() reads the module globals the page sets, so drive it the way the page does.
function endWith(over, failed) {
  S = state(over); rthChainFailed = !!failed;
  return endAction();
}

console.log("End action — the card must name where the run leaves the boat:");

// 1-3. THE REPORTED CASE, in all three modes Andy named. Each of these runs is uploaded
// with completion "loiter" or "rth" and each ends with the console chaining a real,
// ENC-routed Return-to-Home. All three must read rth from the moment the run starts.
check("1. a Go-To under End of Plan = RTH ends at HOME, not at its point",
      endWith({ behavior: "goto", run_completion: "loiter" }) === "rth",
      "goto + setting rth -> rth (was loiter)");
check("2. a Transit under End of Plan = RTH ends at HOME",
      endWith({ behavior: "transit", run_completion: "loiter" }) === "rth",
      "transit + setting rth -> rth (was loiter)");
check("3. a Survey under End of Plan = RTH ends at HOME",
      endWith({ behavior: "survey", run_completion: "rth" }) === "rth");

// 4. The other settings are untouched - this must not turn every run into an RTH.
check("4. End of Plan = Loiter still loiters",
      endWith({ behavior: "goto", completion: "loiter", run_completion: "loiter" }) === "loiter");

// 5. The chained RTH is itself a run, and IT station-keeps at home. Without the
// behavior guard the card would read "rth · rth" and the chain would look un-fired.
check("5. the RTH run itself station-keeps at home — it does not chain another",
      endWith({ behavior: "rth", run_completion: "loiter" }) === "loiter" &&
      (S = state({ behavior: "rth" }), rthPending() === false),
      "behavior rth -> 'rth · loiter'");

// 5b. THE IN-EXTREMIS ESCAPE, the same guard extended to a second behaviour. Andy watched
// this live at Eastport, 2026-09-03: the clearance guard steered clear of a pier (behavior
// "escape"), held there, and - because the operator's STANDING setting was still End of
// Plan = RTH, which an emergency does not touch - the chain read that hold as "the plan is
// over" and sent the boat straight back toward the pier it had just been steered clear of.
// Nine seconds later. A second escape fired three seconds after THAT. The safety
// intervention was undoing itself, on repeat, entirely on its own telemetry.
check("5b. an escape hold likewise station-keeps at the escape point — it never chains a " +
      "return, however the standing setting reads",
      endWith({ behavior: "escape", run_completion: "loiter" }) === "loiter" &&
      (S = state({ behavior: "escape" }), rthPending() === false),
      "behavior escape -> 'loiter', not 'rth' — a Go-To-shaped escape used to promise " +
      "(and then fire) exactly the return it had just steered clear of");

// 5c. THE GUARD'S OTHER RUNG, and the one that actually put a boat on a pier. `escape` was
// excluded when the helm rung was found chaining; `hold` was not, and it is the SAME shape -
// the guard says "stop, you are standing into it", the boat holds, and the chain reads that
// hold as a finished plan. Measured at Eastport, 2026-09-03 (session 20260903-170505): NINE
// hold -> RTH chains in three minutes, every one of them answered within a second, every one
// of them aimed at a HOME with 1.47 m of clear water round it. The boat reached 1.74 m from
// that point at 6.07 kn.
//
// ⚠ SO THE QUESTION IS ASKED THE OTHER WAY ROUND NOW. A blacklist of behaviours that must
// not chain was one short twice; the whitelist names what a chain may fire FROM - a plan that
// ran to its end - and a new safety behaviour is excluded by default rather than by having
// been remembered.
check("5c. a guard HOLD is not a finished plan — the rung that says 'stop, you are standing "
      + "into it' must never be answered by a return to the thing it stopped for",
      endWith({ behavior: "hold", run_completion: "loiter" }) === "loiter" &&
      (S = state({ behavior: "hold" }), rthPending() === false),
      "nine of these in three minutes drove a boat at a pier with 1.47 m of clear water");
check("5d. ... and the whitelist still lets a real plan end at home: survey, search, goto "
      + "and transit all chain, and nothing else does",
      ["survey", "search", "goto", "transit"].every(
        (b) => (S = state({ behavior: b }), rthPending() === true)) &&
      ["hold", "escape", "rth"].every(
        (b) => (S = state({ behavior: b }), rthPending() === false)),
      "a blacklist was one short twice; this is the same question asked the other way round");

// 6-9. THE CHAIN'S PRECONDITIONS. Each of these makes the chain unable to fire, so the
// promise has to be retracted - a card that says "rth" when the boat is going to sit at
// its last waypoint is worse than one that said loiter all along.
check("6. no home set — nothing to return to, so it is a loiter",
      endWith({ home: null, run_completion: "rth", behavior: "survey" }) === "loiter" &&
      endWith({ home: null }) === "loiter");
check("7. disarmed — the chain cannot command the boat",
      endWith({ armed: false }) === "loiter");
check("8. E-STOP — likewise",
      endWith({ estop: true }) === "loiter");
check("9. the chain was tried and REFUSED (no route home) — retract the promise",
      endWith({}, true) === "loiter",
      "rthChainFailed -> the boat stays at its endpoint, and the card says so");

// 10-11. A run that never HOLDS can never chain, whatever the setting says. The link stops
// at the last waypoint only for loiter/rth; repeat laps forever and complete shuts down.
// This is the guard most likely to be dropped as redundant - it is not.
check("10. a REPEAT run never reaches an end, so no RTH can chain",
      endWith({ behavior: "survey", run_completion: "repeat" }) === "repeat");
check("11. a COMPLETE run stops rather than holding, so no RTH can chain",
      endWith({ behavior: "survey", run_completion: "complete" }) === "complete");

// 12. The setting is LIVE and the run's field is frozen at upload. Change the selector to
// Loiter during a survey started under RTH and the chain (which reads the live setting)
// stops - so the run's own "rth" is now just a hold. Reading run_completion here would
// keep showing an RTH that is no longer going to happen: the exact drift that made the
// completion field two fields in the first place.
check("12. setting changed to Loiter mid-run — a run-field 'rth' is only a hold",
      endWith({ behavior: "survey", completion: "loiter", run_completion: "rth" }) === "loiter",
      "live setting decides, not the uploaded field");

// 13. And the whole thing with nothing in the way.
check("13. survey, setting rth, everything armed and homed — rth",
      endWith({ behavior: "survey", run_completion: "rth" }) === "rth" &&
      (S = state({ behavior: "survey", run_completion: "rth" }), rthPending() === true));

// 14-16. RE-ARMING THE ONE-SHOT. Found live: the chain fired for a Go-To, and a SECOND
// Go-To was then commanded while the boat was still running. `run` never left "running",
// so the idle -> running edge that used to re-arm the chain never fired, and the second
// run held at its endpoint indefinitely - with the card promising a return home the whole
// time. Being under way is the signal, not a run starting.
function rearm(over, chained) {
  const s = state(over); rthChained = !!chained; rthChainFailed = !!chained;
  rearmRthChain(s, s.status || {});
  return rthChained;
}
check("14. THE LIVE BUG: a new run commanded while under way re-arms the chain",
      rearm({ behavior: "goto", status: { holding: false } }, true) === false,
      "run never left 'running', so nothing else would have re-armed it");
check("15. ... but HOLDING does not — including the seconds doRTH spends routing",
      rearm({ behavior: "goto", status: { holding: true } }, true) === true,
      "the one-shot still stops the chain re-firing every telemetry frame");
check("16. ... and a stopped boat does not re-arm anything either",
      rearm({ run: "idle", status: { holding: false } }, true) === true);

// 16b. THE ACTUAL FIX, PINNED AT ITS OWN SITE. Every check above tests rthPending() and
// rearmRthChain() in isolation - the PREDICTORS. The chain that actually COMMANDS doRTH()
// is a separate, literal `if` inline in onState, deliberately duplicating the same
// conditions rather than calling rthPending() (it also gates on the one-shot `rthChained`,
// which is a firing-only concern rthPending() has no reason to know about). A predictor
// can be fixed and its subject left untouched - which is exactly the shape of bug this
// pins: the fire site needed its OWN "escape" exclusion, not just its predictive cousin's.
{
  const start = H.indexOf("function onState(");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  const onStateSrc = H.slice(start, k + 1);
  const fireBlock = onStateSrc.slice(onStateSrc.indexOf("End-of-Plan RTH"),
                                      onStateSrc.indexOf("reapproachIfSetOff"));
  // ⚠ NO THUNK: this file's check() reads `cond` directly rather than calling it (unlike
  // clearance_guard.js / in_extremis.js), so an `() => ...` wrapper here is a function
  // OBJECT - always truthy - and the check would be permanently green. Evaluated eagerly,
  // matching every other check in this file.
  const fires = /chainableRun\(s\.behavior\)/.test(fireBlock) && /doRTH\(\{chained:true\}\)/.test(fireBlock);
  check("16b. the LITERAL chain-fire condition in onState asks the WHITELIST, not just " +
        "rthPending() and not a blacklist of its own",
        fires,
        /chainableRun\(s\.behavior\)/.test(fireBlock)
          ? "chainableRun() - the same question rthPending() asks"
          : "MISSING — a guard hold or escape would still chain doRTH() here");
  // 16c. And the whitelist is a whitelist: naming the behaviours that MAY chain is what
  // makes a new safety behaviour excluded by default. A blacklist was one short twice.
  check("16c. the chainable set names plans that ended, and admits no guard command",
        ["survey", "search", "goto", "transit"].every((b) => chainableRun(b)) &&
        !chainableRun("hold") && !chainableRun("escape") && !chainableRun("rth") &&
        !chainableRun("") && !chainableRun(undefined),
        "an unknown or future behaviour is excluded until someone decides otherwise");
}

// --- INTENT: the reasoning travels WITH the plan it describes -------------------------
// Andy, running in Pago Pago: "Path planning seems odd but workable. is it possible to
// generate a path planning tool that continuously updates status and reasoning for current
// and immediate future intentions". The reasoning already existed - routed vs direct, the
// detour count, the Rule 9 lane and whether it was partial, legs with no clear detour - and
// was spent on ONE banner at commit time, so a track that looked odd could not be
// interrogated afterwards.
//
// THE INVARIANT THESE CHECKS EXIST FOR: the rationale is CAPTURED AT COMMIT and never
// re-derived. A re-derivation would describe whatever the console holds NOW rather than the
// route being flown - the fault the lane flag had before it travelled with its own route.
{
  eval(grab("setPlanIntent") + "\n" + grab("wptRole"));
  var planIntent = null;
  const R = (n) => Array.from({length: n}, (_, i) => ({lat: 38.7 + i * 1e-3, lon: -75.1}));

  // 17. A ROUTED plan says so, and quotes the count the operator can check on the chart.
  let pi = setPlanIntent("goto", {routed: true, lane: false}, R(212));
  check("17. a routed plan records THAT it was routed, and via how many waypoints",
        pi.kind === "goto" && pi.why.some(w => /routed clear/.test(w.s) && /212/.test(w.s)),
        pi.why.map(w => w.s.slice(0, 40)).join(" | "));

  // 18. ... and its ACCEPTANCE PAIR: a direct plan must not claim to have been routed.
  // Without this, 17 would pass for a console that said "routed" every single time.
  pi = setPlanIntent("goto", {routed: false, lane: false}, R(2));
  check("18. a DIRECT plan says the straight line was already clear - it claims no detour",
        pi.why.some(w => /direct/.test(w.s)) && !pi.why.some(w => /routed clear/.test(w.s)),
        pi.why.map(w => w.s.slice(0, 44)).join(" | "));

  // 19. A PARTIAL lane must read differently from a full one - the distinction that matters
  // on the water: a route that rode the lane over part of itself and sat on a channel
  // centreline, the head-on position, for the rest.
  const full = setPlanIntent("transit", {routed: true, lane: true, partial: false}, R(9));
  const part = setPlanIntent("transit", {routed: true, lane: true, partial: true}, R(9));
  check("19. a PARTIAL Rule 9 lane reads as partial, and a full one does not",
        full.why.some(w => /riding the Rule 9/.test(w.s)) &&
        !full.why.some(w => /PARTIAL/.test(w.s)) &&
        part.why.some(w => /PARTIAL/.test(w.s)),
        "full: " + full.why[1].s.slice(0, 30) + " | partial: " + part.why[1].s.slice(0, 30));

  // 20. UNROUTABLE LEGS ARE THE LOUD CASE - not safe to run, and the count must reach the
  // card rather than living only as a red line on the chart.
  pi = setPlanIntent("survey", {routed: true, unroutable: [[{}, {}], [{}, {}]]}, R(40));
  check("20. legs with no clear detour are counted and flagged unsafe",
        pi.unsafe === 2 && pi.why.some(w => w.t === "bad" && /NO clear detour/.test(w.s)),
        "unsafe=" + pi.unsafe);

  // 21. NO CHART IS NOT A CLEAN ROUTE. A degraded plan drove direct because the keep-out
  // model was not loaded; that must never read as "the straight line was clear".
  pi = setPlanIntent("goto", {degraded: true, routed: false}, R(2));
  check("21. a plan built with no nogo model WARNS rather than reporting a clear direct run",
        pi.why.some(w => w.t === "warn" && /not loaded/.test(w.s)) &&
        !pi.why.some(w => /already clear/.test(w.s)),
        pi.why[0].s.slice(0, 58));

  // 22. WAYPOINT ROLES ARE LABELLED ONLY FROM WHAT IS KNOWN. A confident label that is
  // wrong on the one occasion it matters is worse than a vague one that is always true.
  const route = R(4);
  mission = { completion: "rth", waypoints: [route[1]] };
  check("22. a waypoint matching the committed plan is named as one",
        wptRole(1, route) === "a plan waypoint", wptRole(1, route));
  check("22b. the final waypoint is the target",
        wptRole(route.length - 1, route) === "the target", wptRole(route.length - 1, route));
  check("22c. anything else is honestly 'generated', not guessed at",
        /generated/.test(wptRole(2, route)), wptRole(2, route));

  // 23. THE RATIONALE IS DROPPED WITH THE ROUTE IT DESCRIBES. Stale reasoning explaining a
  // plan that is no longer being flown is worse than none at all.
  // the DECLARATION is not a clear site - excluded, or this counts the page's own
  // `let runRoute = null;` and the check could never be satisfied
  const clears = (H.match(/(?<!let |var |const )runRoute\s*=\s*null;/g) || []).length;
  const paired = (H.match(/(?<!let |var |const )runRoute\s*=\s*null;\s*planIntent\s*=\s*null;/g) || []).length;
  check("23. every place the route is cleared drops its reasoning too",
        clears > 0 && clears === paired,
        paired + " of " + clears + " clear sites also clear planIntent");

  // 23b. ... and every committed route captures it, so no behaviour can ship a route the
  // card is unable to explain.
  const commits = (H.match(/runRoute\s*=\s*plan\.route/g) || []).length;
  const tagged = (H.match(/setPlanIntent\(/g) || []).length - 1;   // less the definition
  check("23b. every committed route captures its reasoning",
        commits > 0 && tagged >= commits,
        tagged + " setPlanIntent call(s) for " + commits + " route commits");
}


// --- ACTIVITY: surveying is not the same thing as being on a survey ------------------
// Andy, 2026-08-28: "When transiting between home and survey and also between lines, the
// ASV is not surveying. It is transiting. This may be confusing later on as we add sonar
// data that is collected continuously. But its a paradigm to follow."
//
// The console reported `behavior` - the MODE the run is in - which stays "survey" for the
// whole run, so the card said SURVEY while the boat was still an hour from the first line.
// SURVEYING now means ON A COVERAGE LINE and nothing else does. These checks pin that,
// because the distinction is what any continuously-collected data must be segmented by:
// sonar cannot tell coverage from transit by looking at itself.
{
  eval(grab("alongLineM") + "\n" + grab("linePhase") + "\n" + grab("currentActivity") + "\n" +
       // the DRAWN-LINE numbering "line N of M" now goes through (review #18) - the page's own, not a stub
       [grabDecl("LINE_PART_OFFSET_M"), grabDecl("_drawnLines"), grab("lineSetKey"), grab("linePartContinues"),
        grab("drawnLines"), grab("lineNo"), grab("lineCount"), grab("linePartTxt")].join("\n"));
  var runLineIdx = -1, curTurn = -1, turnSeg = [], lastRunLine = -1;
  // A real position rather than null: currentActivity asks linePhase where on the line the
  // boat is, and a null boat would answer "coverage" for the trivial reason that it cannot
  // measure. These lines carry no lead, so the answer is coverage on the real reason.
  var asv = { lat: 43.0718, lon: -70.7626 };
  // Four real lines, 50 m apart and alternating end for end: "line N of M" is the DRAWN line now (review #18),
  // which is read off the geometry, so a placeholder line with no ends is no longer a plan the page could hold.
  const __ln = (k) => { const lat = 43.0718 + k * 0.00045, w = { lat, lon: -70.7650 }, e = { lat, lon: -70.7600 };
                        return k % 2 ? { a: e, b: w } : { a: w, b: e }; };
  mission = { completion: "rth", lines: [__ln(0), __ln(1), __ln(2), __ln(3)] };
  const act = (over, set) => {
    Object.assign({runLineIdx:-1, curTurn:-1, lastRunLine:-1}, set || {});
    runLineIdx = (set && set.runLineIdx !== undefined) ? set.runLineIdx : -1;
    curTurn    = (set && set.curTurn    !== undefined) ? set.curTurn    : -1;
    lastRunLine= (set && set.lastRunLine!== undefined) ? set.lastRunLine: -1;
    turnSeg    = (set && set.turnSeg) || [];
    S = Object.assign({behavior:"survey", run:"running", status:{}}, over || {});
    return currentActivity();
  };

  // 24. ON A COVERAGE LINE is the ONLY thing that counts as surveying.
  let a = act({}, {runLineIdx: 2});
  check("24. on a coverage line, the activity is SURVEYING and it says which line",
        a.activity === "surveying" && a.surveying === true && /line 3 of 4/.test(a.detail),
        a.activity + " - " + a.detail);

  // 25. THE REPORTED CASE. Same run, same behaviour "survey", boat on its way to line 1:
  // this used to read SURVEY and must now read TRANSITING.
  a = act({}, {});
  check("25. the approach to the survey area is TRANSITING, not surveying",
        a.activity === "transiting" && a.surveying === false && /approach/.test(a.detail),
        a.activity + " - " + a.detail);

  // 26. ... and the other half he named: between lines.
  a = act({}, {curTurn: 0, turnSeg: [{from: 1, to: -1, sec: 4}], lastRunLine: 1});
  check("26. the reversal between two lines is TRANSITING, not surveying",
        a.activity === "transiting" && a.surveying === false && /turning between lines/.test(a.detail),
        a.activity + " - " + a.detail);

  // 27. A hop between separated coverage regions is transiting too, and reads differently
  // from the initial approach - the operator can tell "not started yet" from "moving on".
  a = act({}, {lastRunLine: 2});
  check("27. a hop between coverage regions is TRANSITING, and distinguishable from the approach",
        a.activity === "transiting" && /between coverage regions/.test(a.detail),
        a.detail);

  // 28. The other behaviours are transits by definition - an RTH is never coverage.
  a = act({behavior: "rth"}, {});
  const g = act({behavior: "goto"}, {});
  check("28. Go-To and Return-to-Home are TRANSITING - never surveying",
        a.activity === "transiting" && !a.surveying &&
        g.activity === "transiting" && !g.surveying,
        "rth: " + a.detail + " | goto: " + g.detail);

  // 29. Holding and idle are neither - a station-keeping boat is not acquiring coverage,
  // and neither is a stopped one. Without this the binary would quietly call them transits.
  const h = act({status: {holding: true}}, {runLineIdx: 2});
  const i2 = act({run: "stopped"}, {});
  check("29. holding and stopped are their own states, and neither is surveying",
        h.activity === "holding" && !h.surveying &&
        i2.activity === "idle" && !i2.surveying,
        "holding: " + h.detail + " | stopped: " + i2.detail);

  // 29b. HOLDING WINS OVER AN ON-LINE INDEX. A boat that stopped on a line is not
  // surveying it - the check above sets runLineIdx while holding to prove the order.
  check("29b. holding on a line is still holding, not surveying",
        h.activity === "holding",
        "runLineIdx was 2 and it still reported " + h.activity);

  // 30. THE PARADIGM IS ONE ANSWER, NOT TWO. Everything downstream - the cards today, the
  // sonar segmentation later - must key off this single function, or two parts of the
  // system will disagree about which pings are coverage.
  const usesIt = (H.match(/currentActivity\(\)/g) || []).length;
  check("30. the cards and the log all read the ONE classifier rather than re-deriving it",
        usesIt >= 3 && !/behavior\s*===\s*"survey"\s*\?\s*"surveying"/.test(H),
        usesIt + " call sites of currentActivity()");

  // 30b. ... and a change of activity reaches the SESSION LOG, so a recorded run can be
  // segmented later without re-deriving the classification from the track.
  check("30b. activity transitions are logged, change-only, for later segmentation",
        /kind:"activity"/.test(H) && /if\(key === lastActivity\) return;/.test(H),
        "logged as an aux stream, only when it changes");
}


// --- THE VESSEL GLYPH: an isosceles triangle down the line of travel -----------------
// Andy, 2026-08-28: "it will be an isosceles triangle with the sharp end pointed toward
// the line of travel. Color will be the common color of the given ASV."
{
  // ONE eval: a const inside a direct eval is lexical to it, so the function must be
  // compiled in the same call as the constants it closes over.
  // glyphOutline is a DEPENDENCY of drawVesselGlyph (it picks the edge from the fill's
  // luminance), so it has to be compiled in the same call or the glyph throws.
  eval([grabDecl("GLYPH_FWD"), grab("glyphOutline"), grab("drawVesselGlyph"),
        grab("hullColor"), grab("hullColor2")].join(String.fromCharCode(10)));
  // the consts live inside that eval, so parse their values for the checks here
  const _g = grabDecl("GLYPH_FWD").match(/[\d.]+/g).map(Number);  const GLYPH_FWD=_g[0], GLYPH_AFT=_g[1], GLYPH_HALF=_g[2];
  // a canvas that records what was asked of it, so the SHAPE can be asserted
  function recorder(){
    const ops = [], pts = [];
    let tx = 0, ty = 0, rot = 0;
    return {ops, pts, fills: [],
      save(){}, restore(){}, beginPath(){ ops.push("begin"); }, closePath(){},
      translate(x,y){ tx = x; ty = y; }, rotate(r){ rot = r; },
      moveTo(x,y){ pts.push([x,y]); }, lineTo(x,y){ pts.push([x,y]); },
      fill(){ this.fills.push(this.fillStyle); }, stroke(){ ops.push("stroke"); },
      get _rot(){ return rot; }, get _t(){ return [tx,ty]; }};
  }
  // 31. ISOSCELES, and pointed: the apex is further from the centre than the base corners,
  // and the two base corners are the same distance from the centreline (that IS isosceles).
  {
    const g = recorder(); drawVesselGlyph(g, 100, 200, 0, "#ffd400", null);
    const tri = g.pts.slice(0, 3);
    const [apex, r1, r2] = tri;
    const legA = Math.hypot(apex[0]-r1[0], apex[1]-r1[1]);
    const legB = Math.hypot(apex[0]-r2[0], apex[1]-r2[1]);
    const base = Math.hypot(r1[0]-r2[0], r1[1]-r2[1]);
    check("31. the glyph is an ISOSCELES triangle - two equal sides, a different base",
          Math.abs(legA - legB) < 1e-9 && Math.abs(legA - base) > 1e-6,
          "legs " + legA.toFixed(2) + "/" + legB.toFixed(2) + ", base " + base.toFixed(2));
    check("31b. ... and it is POINTED, not squat: the apex reaches further than it is wide",
          GLYPH_FWD + GLYPH_AFT > 2 * GLYPH_HALF,
          "length " + (GLYPH_FWD+GLYPH_AFT) + " vs width " + (2*GLYPH_HALF));
    // the apex must be the FORWARD vertex - at rotation 0 that is -y (north, up)
    check("31c. the sharp end leads: the apex is the forward vertex, the base is astern",
          apex[1] < 0 && r1[1] > 0 && r2[1] > 0,
          "apex y=" + apex[1] + ", base y=" + r1[1]);
  }
  // 32. IT POINTS DOWN THE LINE OF TRAVEL. The canvas is rotated by the course in radians;
  // 90 deg true must be a quarter turn, not a degree value handed to rotate() raw.
  {
    const g = recorder(); drawVesselGlyph(g, 0, 0, 90, "#fff", null);
    check("32. the glyph is rotated by the COURSE, in radians",
          Math.abs(g._rot - Math.PI/2) < 1e-9,
          "course 90 deg -> " + g._rot.toFixed(4) + " rad (want " + (Math.PI/2).toFixed(4) + ")");
  }
  // 33. THE LIVERY: one colour fills once, two colours fill twice - the second is the aft
  // band. Its acceptance pair is the single-colour case, or "always two fills" would pass.
  {
    const one = recorder(); drawVesselGlyph(one, 0, 0, 0, "#ffd400", null);
    const two = recorder(); drawVesselGlyph(two, 0, 0, 0, "#ffd400", "#101010");
    check("33. a plain hull fills once; a two-tone livery fills twice, second colour aft",
          one.fills.length === 1 && one.fills[0] === "#ffd400" &&
          two.fills.length === 2 && two.fills[1] === "#101010",
          "plain " + JSON.stringify(one.fills) + " | livery " + JSON.stringify(two.fills));
    // the aft band's vertices must all lie behind the apex, or the "livery" would cover
    // the pointed end and destroy the one thing the shape exists to show
    const band = two.pts.slice(3, 7);
    check("33b. the aft band stays ASTERN - it never reaches the pointed end",
          band.every(p => p[1] > -GLYPH_FWD / 2),
          "band ys: " + band.map(p => p[1].toFixed(1)).join(","));
  }
  // 34. THE COLOUR IS THE VESSEL'S, NOT THE PAGE'S. A table of ids here would be exactly
  // the hardcoded-vessel-constant this console spent a refactor removing.
  {
    // THE SHIPPED DEFAULT, read before anything here touches it: null, so a profile
    // written before hull colours existed is drawn exactly as it was.
    const shipped = [V.HULL_COLOR, V.HULL_COLOR2];
    check("34. the V default is null - an older vessel profile is unchanged",
          shipped[0] === null && shipped[1] === null,
          "state.js ships " + JSON.stringify(shipped));
    // A SENTINEL, NOT A REAL HULL COLOUR. Asserting that V="#d0342c" yields "#d0342c"
    // passes just as well for a function that returns "#d0342c" unconditionally - which
    // is exactly the mutation that survived the first version of this check. A colour no
    // vessel file contains can only come from V.
    V.HULL_COLOR = "#123456"; V.HULL_COLOR2 = "#654321";
    check("34b. the hull colour FOLLOWS the vessel block - it is not baked into the page",
          hullColor() === "#123456" && hullColor2() === "#654321",
          hullColor() + " / " + hullColor2());
    V.HULL_COLOR = null; V.HULL_COLOR2 = null;
    check("34c. ... and with none named it falls back to the chart colour, not to a hull's",
          hullColor() === getCSS("--asv") && hullColor2() === null,
          "fallback = " + hullColor() + " (chart --asv), livery " + hullColor2());
    V.HULL_COLOR = shipped[0]; V.HULL_COLOR2 = shipped[1];
    check("34d. the page holds no per-vessel colour table",
          !/zboat_1800hs\s*:\s*["'#]/.test(H) && !/drix08\s*:\s*["'#]/.test(H),
          "colours belong to vessels/<id>.json");
  }
  // 35. The shipped hulls carry the colours Andy named: yellow for the small launch, red
  // for the DriX. Read from the FILES, so a colour changed there is a failure here.
  {
    const vess = f => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vessels", f), "utf8"));
    const zb = (vess("zboat_1800hs.json").display || {}).hull_color || "";
    const dx = (vess("drix08.json").display || {}).hull_color || "";
    const yellowish = /^#f{0,1}f?d|^#ff[cd]/i.test(zb) || zb.toLowerCase() === "#ffd400";
    check("35. the shipped hulls carry their own colours (small launch yellow, DriX red)",
          yellowish && /^#d0342c$/i.test(dx),
          "zboat " + zb + ", drix " + dx);
  }
}


console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
