// tests/line_stats.js - what the Lines card and the run-progress figure are a measure OF.
//
// Andy, 2026-09-04, with a running instance in front of him:
//
//   "the lines card link to data is broken. perhaps the link does not survive the manual
//    deletion of lines after a punchout and before 'add to plan'."
//
// and, a minute later:
//
//   "additionally under the vessel status card run time percentage is reading 0%. This may
//    be associated."
//
// ⚠⚠ IT IS ASSOCIATED, AND IT IS ONE CONDITION. Both quantities were reset in the same
// branch of `onState`:
//
//     if (prevRun !== "running" && prevRun !== "paused" && s.run === "running") { … }
//
// - the TRANSITION into running. But every commanded motion in this console goes through
// `Engine._run_route`, which sets `run = "running"` UNCONDITIONALLY. So a Go-To, an RTH, a
// transit or a routed re-approach issued while something is already running never leaves the
// running state; `prevRun` is still "running"; and nothing resets. Two consequences, and Andy
// reported both in the same breath:
//
//   * THE LINES CARD. `mission.lines` had been replaced by the new plan, but `lineActual` is
//     indexed by POSITION and the only self-heal fixed its LENGTH. Strike one line of ten and
//     commit nine, and nine old timings were re-attached to nine DIFFERENT lines. The card
//     kept showing numbers; they described a different survey. Striking one and adding
//     another changes the length not at all, and "healed" nothing while being just as wrong.
//   * THE PROGRESS FIGURE. `runTotalM` is captured once, because at Start the boat is short
//     of waypoint one and the route's own length would make the percentage negative. But
//     "once" was `runTotalM <= 0`, and the only thing that cleared it was that same
//     transition. The card then measured the NEW route against the OLD run's total,
//     remaining exceeded the total, and the percentage clamped to 0 and stayed there - on a
//     boat 1:51 into a run.
//
// THE FIX IS THE SAME IDEA TWICE: key each quantity on the thing it is a measure of. The
// per-line times belong to a LINE SET; the progress fraction belongs to a ROUTE. Neither
// belongs to a run STATE that a second command never changes.
//
//   node tests/line_stats.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - mutations RUN against a sidecar copy of the page; the checks each one turned red:
//   syncLineStats compares the LENGTH again, not the line set       -> 3, 4
//   syncLineStats is not called from accumLineTime                  -> 6
//   the line-set key drops the endpoints (counts lines only)        -> 3
//   resetLineStats does not stamp the key (so the next tick wipes)  -> 5
//   runTotalM is keyed on nothing (the reported 0%)                 -> 8, 9
//   the route signature drops its length                            -> 8, 9
//   routeRemainingM stops reporting the route's length              -> 7
//   resetRunTimer does not clear the key                            -> 10
// TEETH for 12-15 (review #23, the clock that spanned back-to-back runs) - 6 sidecar mutations, 6/6 caught:
//   the clock spans motions again (the old code)                    -> 15    a page opening mid-run restarts it -> 15
//   the job shares the motion's clock (one clock, as before)        -> 12, 13, 14
//   a new motion zeroes the job too                                 -> 13, 14
//   the motion's clock starts at the next frame, not the command    -> 13, 14
//   the tooltip never says the job                                  -> 14
//   ⚠ THE FIRST TWO ARE CAUGHT BY THE WIRING CHECK ALONE, which is a source grep: it sees the call go missing but
//   could not see it made unreachable. The behaviour those two describe is asserted where it can be - against a real
//   console - in tests/run_link_control.py 7c / 15g / 15h, which drive run_seq itself.
//
// ⚠ AND ONE MUTATION SURVIVES, RECORDED RATHER THAN PAPERED OVER: disabling the run-state
// reset with `if(false)` leaves check 11 green, because 11 is a WIRING check and a source
// grep cannot see reachability - the same limit tests/clearance_guard.js 15 records for its
// own half. The behaviour it guards is real and still needed (the transition is the only
// thing that zeroes `runElapsed` and `loggedLines`, which no key covers), but proving it
// would need the page running, and this suite deliberately does not.

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
// ASV_HTML lets a mutation run point this at a sidecar copy, so a killed runner can never leave the real page mutated
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8");

function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = "THREW: " + e.message; }
  let d = detail;
  if (typeof d === "function") { try { d = d(); } catch (e) { d = "(detail threw: " + e.message + ")"; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   [" + d + "]" : ""));
  if (!ok) fails++;
}

// ── THE PAGE'S OWN FUNCTIONS, in a scope that supplies what they read ────────────────
const { distTo } = require("../static/js/geodesy.js");
let mission = { lines: [], waypoints: [], arrival_radius_m: 2 };
let lineActual = [], lineClock = null, loggedLines = false;
let turnSeg = [], curTurn = -1, lastRunLine = -1, runLineIdx = -1;
let lineStatsKey = null;
let runElapsed = 0, runClock = null, runTotalM = 0, runTotalKey = null;
// review #23: the clock times the COMMANDED MOTION, and the job is kept beside it. Declared here, not beside the
// checks that use them, because resetRunTimer is evaluated above and reads them - a `let` further down would be in
// its temporal dead zone the moment check 10 calls it.
let runSeq = null, jobElapsed = 0, jobClock = null, runMotions = 0;
let clockNow = 0;                                   // the page reads performance.now()/1000; this scope supplies it
const performance = { now: () => clockNow * 1000 };
const { fmtMS } = require("../static/js/units.js");
let asv = { lat: 43.0, lon: -70.0 };
let runRoute = null, S = { run: "running" };
// routeRemainingM reads the vessel's reported waypoint index off `window`, which node does
// not have. A free variable there is a runtime error INSIDE the function, so the check goes
// red somewhere far from its cause - the same trap tests/nogo_readout.js records for
// planeFrame and chartInk.
global.window = { _wpIndex: 0 };
// eslint-disable-next-line no-eval
eval(grab("lineSetKey"));
// eslint-disable-next-line no-eval
eval(grab("syncLineStats"));
// eslint-disable-next-line no-eval
eval(grab("resetLineStats"));
// eslint-disable-next-line no-eval
eval(grab("resetRunTimer"));
// eslint-disable-next-line no-eval
eval(grab("indexedRoute") + "\n" + grab("routeRemainingM"));

const L = (a, b, c, d) => ({ a: { lat: a, lon: b }, b: { lat: c, lon: d } });
const PLAN10 = [];
for (let k = 0; k < 10; k++) PLAN10.push(L(43.000 + k * 0.001, -70.000, 43.000 + k * 0.001, -70.002));

console.log("What the Lines card and the progress figure are a measure OF:");

// ── 1-2. THE BASELINE ───────────────────────────────────────────────────────────────
check("1. a fresh plan starts every line at zero, and stamps the key it is measuring",
      () => {
        mission.lines = PLAN10.slice();
        resetLineStats();
        return lineActual.length === 10 && lineActual.every(v => v === 0)
            && lineStatsKey === lineSetKey();
      },
      () => "");
check("2. an untouched plan keeps its recorded times — the key must not churn",
      () => {
        lineActual[3] = 42;
        return syncLineStats() === false && lineActual[3] === 42;
      },
      "a key that changed every tick would be a stats reset every tick");

// ── 3-6. THE REPORTED FAULT ─────────────────────────────────────────────────────────
check("3. ⚠ STRIKING A LINE AND RE-COMMITTING ZEROES THE STATS — nine old timings must not " +
      "be re-attached to nine DIFFERENT lines",
      () => {
        mission.lines = PLAN10.filter((_, k) => k !== 4);      // strike line 5
        const changed = syncLineStats();
        return changed === true && lineActual.length === 9 && lineActual.every(v => v === 0);
      },
      () => "line 4's 42 s would otherwise have become line 5's");
check("4. ⚠ ... AND SO DOES A SWAP THAT LEAVES THE COUNT THE SAME, which is the case the old " +
      "length-only guard could not even see",
      () => {
        mission.lines = PLAN10.slice(0, 9);
        resetLineStats();
        lineActual[2] = 17;
        mission.lines = PLAN10.slice(1, 10);                   // same COUNT, different lines
        return syncLineStats() === true && lineActual.every(v => v === 0);
      },
      "strike one line and add another: the array length never moves");
check("5. resetLineStats STAMPS the key, so a re-run of the same plan is not wiped again on " +
      "the very next tick",
      () => {
        mission.lines = PLAN10.slice();
        resetLineStats();
        lineActual[1] = 7;
        return syncLineStats() === false && lineActual[1] === 7;
      },
      "a reset that did not stamp would zero the stats on every tick after it");
check("6. and the sync is WIRED into accumLineTime, which is the only thing that runs every " +
      "frame",
      () => {
        const acc = grab("accumLineTime");
        return /syncLineStats\(\);/.test(acc)
            && !/lineActual\.length!==mission\.lines\.length/.test(acc);
      },
      "a repair nothing calls is not a repair");

// ── 7-10. THE PROGRESS FIGURE ───────────────────────────────────────────────────────
const route = (n, stepDeg) => {
  const r = [];
  for (let k = 0; k < n; k++) r.push({ lat: 43.0 + k * stepDeg, lon: -70.0 });
  return r;
};
check("7. the route reports its own identity — a length and a total — so a caller can tell " +
      "one route from another",
      () => {
        runRoute = route(5, 0.001); asv = { lat: 43.0, lon: -70.0 };
        const rr = routeRemainingM();
        return rr && rr.n === 5 && rr.total > 0 && rr.remain > 0;
      },
      () => { runRoute = route(5, 0.001); const rr = routeRemainingM();
              return rr ? "n " + rr.n + ", total " + Math.round(rr.total) + " m" : "null"; });
check("8. ⚠ THE REPORTED 0%: a SECOND route commanded while the first is still running must " +
      "re-capture the total, or remaining exceeds it and the percentage clamps to zero",
      () => {
        const src = grab("updateRunTime");
        return /const sig = rr\.n \+ ":" \+ Math\.round\(rr\.total\);/.test(src)
            && /if\(sig !== runTotalKey\)\{ runTotalKey = sig; runTotalM = rr\.remain; \}/.test(src);
      },
      "Engine._run_route sets run=\"running\" unconditionally, so the transition never fires");
check("9. the signature carries the route's LENGTH as well as its distance — two different " +
      "routes can measure the same",
      () => /rr\.n \+ ":" \+ Math\.round\(rr\.total\)/.test(grab("updateRunTime")),
      "a 5-waypoint and a 9-waypoint route of equal length are not the same route");
check("10. and resetRunTimer clears the key, so a genuinely new run re-captures",
      () => {
        runTotalM = 500; runTotalKey = "5:500";
        resetRunTimer();
        return runTotalM === 0 && runTotalKey === null;
      },
      () => "");

// ── 11. THE ONE THAT SAYS WHY THE OLD CONDITION COULD NOT WORK ──────────────────────
check("11. the run-state reset is KEPT, but it is no longer the only thing that resets — a " +
      "run commanded inside a run never changes the state it watches",
      () => {
        const os = H.slice(H.indexOf("function onState"), H.indexOf("function onState") + 900);
        return /prevRun!=="running" && prevRun!=="paused" && s\.run==="running"/.test(os)
            && /resetLineStats\(\); resetRunTimer\(\)/.test(os);
      },
      "it still does the right thing at a real start; it was never sufficient on its own. " +
      "⚠ A WIRING CHECK: a source grep cannot see reachability, so an `if(false)` around " +
      "these calls survives it - see the header");

// ── 12-15. THE COMMANDED MOTION, NOT EVERYTHING SINCE THE BOAT LAST STOOD STILL (review #23) ─────────
// Andy: "`runElapsed` spans back-to-back runs" - 3:48 across two Go-Tos, while the other two numbers on that row
// measured the CURRENT route. The clock is keyed on the console's own motion counter now; the job total survives.
// eslint-disable-next-line no-eval
eval(grab("startNewMotion"));
// eslint-disable-next-line no-eval
eval(grab("accumRunTime"));
// the VALUE, bound in this scope: `const` inside an eval() belongs to the eval, and runTimeTip could not see it
// eslint-disable-next-line no-eval
const RUNTIME_TIP = eval(H.match(/^const RUNTIME_TIP = ([\s\S]*?);$/m)[1]);
// eslint-disable-next-line no-eval
eval(grab("runTimeTip"));

S = { run: "running" };
resetRunTimer();
clockNow = 0; accumRunTime();
clockNow = 10; accumRunTime();
S = { run: "paused" };
clockNow = 20; accumRunTime();                      // paused: neither clock moves
const atPause = [runElapsed, jobElapsed];
S = { run: "running" };
accumRunTime();
clockNow = 25; accumRunTime();
check("12. both clocks tick only while the boat is running, and both freeze on a pause",
      () => atPause[0] === 10 && atPause[1] === 10 && runElapsed === 15 && jobElapsed === 15,
      () => "at the pause " + atPause + ", after it " + [runElapsed, jobElapsed]);

runTotalM = 500; runTotalKey = "5:500";
startNewMotion();
const afterCmd = [runElapsed, jobElapsed, runMotions, runTotalM, runTotalKey];
clockNow = 30; accumRunTime();
check("13. a NEW commanded motion restarts the motion's clock and the percentage baseline — and the job keeps " +
      "counting, because the boat never stopped",
      () => afterCmd[0] === 0 && afterCmd[1] === 15 && afterCmd[2] === 2 && afterCmd[3] === 0 && afterCmd[4] === null &&
            runElapsed === 5 && jobElapsed === 20,
      () => "at the command " + afterCmd.slice(0, 3) + ", five seconds later " + [runElapsed, jobElapsed]);

const tipTwo = runTimeTip();
runMotions = 1;
const tipOne = runTimeTip();
check("14. the row's tooltip says BOTH as soon as there is more than one — the job is not thrown away, it is just " +
      "not the number on the row",
      () => /This commanded motion: 0:05\./.test(tipTwo) && /Since the boat last got under way: 0:20 over 2 /.test(tipTwo) &&
            tipOne === RUNTIME_TIP && !/commanded motion:/.test(tipOne),
      () => tipTwo.slice(0, 96));

check("15. and it is WIRED to the console's counter, not to the run state: onState starts a new motion when " +
      "s.run_seq moves, a page that opened mid-run adopts the number it finds, and the row writes the tooltip",
      () => {
        const os = H.slice(H.indexOf("function onState"), H.indexOf("function onState") + 1400);
        return /s\.run_seq!=null && s\.run_seq!==runSeq/.test(os) &&
               /if\(!freshRun && runSeq!=null\) startNewMotion\(\)/.test(os) &&
               /runSeq = s\.run_seq/.test(os) && /el\.title = runTimeTip\(\)/.test(grab("updateRunTime"));
      },
      "the page cannot tell a resume from a new command by `run` alone — it reads \"running\" through both");


// ── 16. THE ARRAY THE INDEX COUNTS INTO ─────────────────────────────────────────────
//
// The progress figure is a fraction of a ROUTE (checks 7-10). This is the other half of
// that sentence: WHICH route. `_wpIndex` is the vessel's own waypoint number and it counts
// into the UPLOADED route, whose length the vessel reports back as `wp_total`. `runRoute`
// is that array only on the page that uploaded it - nothing restores it, so a page loaded
// mid-run holds the drawn plan and nothing else, and the drawn plan is SHORTER whenever
// routePlan spliced a detour in. Measured on a 40-waypoint routed plan at waypoint 32,
// before and after an F5 at the same instant: "to end 1.62 km · ~26:12" became
// "349 m · ~5:40", with the top-bar pill still reading 32 / 40 beside it because that one
// takes the vessel's own numbers. Two counts on one screen, and the shorter one is the
// dangerous one.
check("16. ⚠ A PAGE THAT DID NOT UPLOAD THE ROUTE HAS NO PROGRESS TO REPORT — `_wpIndex` " +
      "counts into the UPLOADED route, so a reload that lost `runRoute` must not measure it " +
      "against the shorter drawn plan; a DEGRADED upload, where the two ARE one array, " +
      "still reads in full",
      () => {
        asv = { lat: 43.0, lon: -70.0 };
        runRoute = null; mission.waypoints = route(22, 0.001);   // mid-run reload: the drawn plan only
        S = { run: "running", wp_total: 40 };                    // ...while she flies a 40-waypoint route
        global.window._wpIndex = 32;
        const lost = routeRemainingM();
        S = { run: "running", wp_total: 22 };                    // no chart model: Upload sent the drawn plan itself
        global.window._wpIndex = 15;
        const degraded = routeRemainingM();
        runRoute = route(5, 0.001); global.window._wpIndex = 2;  // and the page that DID upload is untouched
        S = { run: "running", wp_total: 5 };
        const held = routeRemainingM();
        return lost === null
            && degraded && degraded.n === 22 && degraded.remain > 0
            && held && held.n === 5 && held.remain > 0;
      },
      () => {
        runRoute = null; mission.waypoints = route(22, 0.001);
        S = { run: "running", wp_total: 40 }; global.window._wpIndex = 32;
        const r = routeRemainingM();
        return r ? "it reported " + Math.round(r.remain) + " m over " + r.n
                   + " waypoints, while the boat has a 40-waypoint route still to fly"
                 : "nothing to report, which is the truthful reading";
      });

// 16b. AND THE VESSEL SAYING NOTHING IS NOT A DISAGREEMENT. Before the first frame arrives,
// and on any link that does not report a total, there is no number to disagree with - the
// drawn plan is all there is and it is what the operator is looking at. A fix that keyed on
// `runRoute` alone would blank the card for every page before its first telemetry frame.
check("16b. ... but a vessel that has reported no total is not a disagreement: the drawn " +
      "plan still reads",
      () => {
        asv = { lat: 43.0, lon: -70.0 };
        runRoute = null; mission.waypoints = route(8, 0.001);
        global.window._wpIndex = 3;
        S = null;                                    // no frame yet
        const noFrame = routeRemainingM();
        S = { run: "running" };                      // a link that reports no total
        const noTotal = routeRemainingM();
        return noFrame && noFrame.n === 8 && noTotal && noTotal.n === 8;
      },
      () => "before the first frame and on a link with no wp_total, the drawn plan is the " +
            "only route there is and reads in full");

console.log("");
console.log(fails ? (fails + " CHECK(S) FAILED of " + ran) : ("all " + ran + " checks pass"));
process.exit(fails ? 1 : 0);
