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

function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}

var S = null, rthChained = false, rthChainFailed = false, mission = { completion: "rth" };
// eslint-disable-next-line no-eval
eval(grab("runCompletion") + "\n" + grab("runHolds") + "\n" +
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

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
