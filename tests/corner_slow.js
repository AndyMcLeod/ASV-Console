// tests/corner_slow.js - WHERE THE HULL ACTUALLY GOES AT A CORNER, and what to do about it.
//
// The planner checks a route as a POLYLINE (`legClear` walks every chord, and every chord
// is lawful water). The hull then ROUNDS every corner of it. Nothing measured the
// difference: `turnFlyable` asks the guard's projection about a GENERATED TURN, and no
// junction - the approach meeting the first coverage line, a hop between runs, a reversal
// the gate declined, a detour spliced in at Upload - ever gets that call.
//
// Measured on Andy's Honolulu plan of 2026-09-16 (415 waypoints, 5 m buffer, zero
// waypoints inside it): the hull leaves the commanded polyline by up to 2.88 m at the plan
// speed and 1.41 m at `low`, and TWELVE OF 413 VERTICES take her inside the operator's
// buffer at the plan speed against NONE at `low`. Andy's call, 2026-09-19, with those
// numbers in front of him: slow through the breaching corner rather than refuse it - the
// flyability is not in doubt, the speed is.
//
//   node tests/corner_slow.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ⚠ THE FIXTURES COME FROM THE VESSEL MODEL, NOT FROM THIS CODE. Checks 1-7 are seven
// corners flown through `asv_console.py`'s own SimVcu.tick - the thing the boat actually
// is - and the metres below are what that run printed. A round trip through flownTrack's
// own arithmetic would pass for any mutually-consistent pair of wrongs; this cannot. They
// span 30-165 degrees and all three speeds, because the disagreements that mattered were
// all at one end or the other.
//
// ⚠ AND THE TOLERANCE IS RECORDED, NOT CHOSEN. `TOL_M` is what the agreement measured
// across those seven plus seven whole recorded routes, rounded up one decimal - not a
// number picked to make the checks pass. If a change moves the walk, these go red.
//
// TEETH - thirty-six mutations RUN against a sidecar copy that is restored in a
// `finally` and confirmed with `git diff` at the end of the run. These are what the runs
// printed, not what was predicted of them; five predictions were wrong (10, 17, 22, 23, 7):
//
//   the leg advance taken on the POST-step position (the real defect)  -> 1, 5, 8
//   the pre-step range measured AFTER the step instead                 -> 1-8 and the
//                                                                         crash guard
//   steers straight at the waypoint, no look-ahead (projectRoute's law) -> 9
//   the cross-track integral dropped                                   -> 9
//   the trim RESET on a leg advance again (the vessel does not)        -> 17
//   the throttle changes instantly, no ramp                            -> 10
//   the corner window is the whole leg again (reach unbounded)         -> 11, 14, 15
//   cornerReachM's half turn becomes a quarter (the window halves)     -> 15
//   the window sized at the walk's own speed instead of the plan's     -> 23
//   the slow command arrives instantly (no link latency)               -> 24
//   the slowed walk re-tested only where pass 1 flagged                -> 26
//   the slowed walk never re-taken (no iteration)                      -> 26
//   the screen rejects everything (no corner tested exactly)           -> 11, 13, 14
//   the exact test uses no buffer at all                               -> 11, 13, 14
//   the second pass skipped: every flag reported as solved by slowing  -> 13
//   the walk steps at the guard's 0.5 s, not the vessel's tick         -> 1, 2
//   a corner charged to the vertex ahead only, not the one just passed -> 1-6, 10, 11,
//                                                                         13, 14
//   it stops yielding (blocks the main thread again)                   -> 22
//   asv.html: the call is DELETED at Upload                            -> 18, 20, 21
//   asv.html: the measured result is discarded                         -> 18
//   asv.html: the boat is NOT prepended (first corner unmeasured)      -> 18
//   asv.html: the governor ignores the set                             -> 19
//   asv.html: the governor stops checking the set is THIS route's      -> 25
//   asv.html: the unrouted upload leaves the last plan's corners armed -> 20
//   asv.html: the busy flag set but never cleared                      -> 21
//   asv.html: the Upload button ignores the busy flag                  -> 21
//   asv.html: the busy flag set AFTER the measurement, not before      -> 21
//
//   ...and eight more for the generated-turn half after it moved onto the LINE
//   (2026-09-22), every one of which was alive against the punch-gap version:
//   asv.html: the WHOLE move reverted - flag on the punch, read by gap  -> 19, 19b-19f,
//                                                                         speed_modes 5
//   asv.html: commitPattern writes the flag without the punched gate    -> 19f
//   asv.html: the committed line is pushed without slow_turn_out        -> 19, 19b-19d, 19f
//   asv.html: the governor reads turnSlowAt[gap] again                  -> 19, 19b-19e,
//                                                                         speed_modes 5
//   asv.html: deleteLineByIndex leaves the stale flag standing          -> 19e
//   asv.html: deleteLineByIndex clears the line BELOW the strike        -> 19e
//   asv.html: written one line off (slowOut[k-1])                       -> 19, 19b-19d, 19f
//   asv.html: read one line off (mission.lines[gap+1])                  -> 19, 19b-19d,
//                                                                         speed_modes 5
//
// ⚠ AND 19f IS THE ONLY THING THAT KILLS THE PUNCHED GATE - the mutation that lets a
// DRAWN pattern inherit the last punch's flags. The four end-to-end drives all commit a
// punched pattern, so every one of them stayed green; it took the un-punched case, which
// is the same rule `leads` follows one line above it in commitPattern.
//
// ⚠ ONE SURVIVED AND IT IS INERT BY DESIGN: making the screen PASS everything. The screen
// only skips model calls that cannot change the answer, so removing it gives identical
// verdicts more slowly. A mutation in the SAFE direction that changed a verdict would be
// the defect; this one changing nothing is the property holding. The opposite - the screen
// REJECTING everything - is the dangerous one, and three checks kill it.
//
// ⚠⚠ NINE DEFECTS CAME FROM AN ADVERSARIAL REVIEW RATHER THAN FROM THESE CHECKS, in two
// rounds, and THREE OF THEM WERE HOLES IN CHECKS THIS FILE CALLED RIGOROUS:
//
//   * CHECK 7 PASSED ON THE ABSENCE OF A MEASUREMENT. `devAt` returned a silent 0 when the
//     walk charged nothing to the vertex, and a 0.125 m fixture against a 0.35 m tolerance
//     accepts 0. The tell was in this very table: check 7 appeared in NO kill list while
//     every neighbour appeared in several. It returns NaN now, and it is in one.
//   * CHECK 15 COULD NOT SEE THE WINDOW HALVED. It bounded reach ABOVE by the cap, and a
//     halved window is still under it; `cornerReachM`'s 180 -> 90 left everything green.
//     It now also requires the window to be USED by a 165-degree corner.
//   * CHECK 8'S REGEXES WERE UNANCHORED - two strings existing somewhere in the file, not
//     an ordering. A version measuring the range AFTER the step would have passed it.
//
// The other six were in the code, five of them under-flagging: the trim reset (17), the
// boat's own first corner never measured (18), the window sized by the slower walk (23),
// the zero-latency throttle (24), the set outliving its route (25), and the slowed walk
// re-tested only where the first walk flagged (26). The worst by far is the trim, and the
// first write-up of it - in this file - called it INERT on a measurement that was a ROUND
// TRIP: a probe comparing this walk WITH the reset against this walk WITHOUT it, never
// against the vessel, and only on route-wide maxima at survey speed. Asked properly, over
// 280 corners of a leg-length x deflection x speed sweep, THE RESET UNDER-REPORTED THE
// HULL BY UP TO 3.935 m. Check 27 is the fixture class that sees it and 1-7 could not.
//
// ⚠ AND NONE OF THE NINE UNDER-FLAGGED ANYTHING ON THE REAL PLAN. A brute-force oracle -
// every flown step tested against the model, no window and no screen, 76,398 steps - finds
// exactly the same twelve vertices the shipped code returns, before the fixes and after.
// They were demonstrated on constructed geometry, which is what an adversarial reading is
// for and why it was run.
//
// ⚠ CHECK 26 IS A SOURCE CHECK AND SAYS SO. The property is "slowing one corner can create
// a breach at another", and the only place it has been OBSERVED is Andy's real Honolulu
// route, where the sweep adds route vertex 379. No synthetic fixture reproduces it, so what
// 26 pins is the mechanism, not the outcome. Check 18 has the same shape and the same
// stated limit: a contrived mutation that keeps its text and discards the result at runtime
// walks past it. Driving doUpload is tests/pause_resume.js's job, not this file's.
//
// ⚠ FOUR FIXTURES WERE WRONG BEFORE THE CODE WAS, AND SAY SO. Check 10 asserted a 2 m
// run-in could not deliver the low speed from survey; that ramp is 1.0 s, about 1.5 m, so
// it can. Checks 11-14's keep-out was hand-rolled as {w,e,s,n} where the real box is bbOf's
// {x0,y0,x1,y1}, so `inBB` rejected every point and the fixture tested nothing while
// printing FAIL. Check 23 first asserted a slowed corner's realized reach EQUALS the fast
// one's - the cap is shared, the reach is not, because a slower walk steps finer. And an
// attempt to buy back main-thread cost by stepping the exact test at legClear's rate lost
// route vertex 332's detection outright.
//
const fs = require("fs");
const path = require("path");

const { azTo, distTo, planeFrame } = require("../static/js/geodesy.js");
const { V, nogo, sea } = require("../static/js/state.js");
// THE REAL BOUNDING BOX, not one written out here: `blocked` rejects on inBB, and a
// hand-rolled {w,e,s,n} box is rejected for every point - which is a fixture that
// silently tests nothing. Building it with the shipped bbOf cannot drift from it.
const { bbOf } = require("../static/js/geometry.js");
const { flownTrack, cornerSlowPlan, TRACK_STEP_S, SPEED_RAMP_KN_S,
        SPEED_CMD_LATENCY_S } = require("../static/js/turns.js");
// ITER_CAP is module-private; read it out of the source so check 26 can assert on it.
const ITER_CAP = +(/const ITER_CAP = (\d+);/.exec(
  require("fs").readFileSync(require("path").join(__dirname, "..", "static", "js", "turns.js"), "utf8")) || [0, 0])[1];

const SRC = fs.readFileSync(path.join(__dirname, "..", "static", "js", "turns.js"), "utf8");

// --- crash guard: a throw outside a check() must still REPORT --------------------------
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

let ran = 0, fails = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? detail + " — " : "") + "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}

// The small-class boat, the suites' own hull: 3.0 kn at survey, 60 deg/s, 1 m approach,
// 3 m look-ahead. These are the vessel file's numbers and flownTrack reads them from V.
V.VESSEL = { maneuvering: { approach_m: 1.0, lookahead_m: 3.0, max_turn_rate_deg_s: 60 },
             autopilot: { xte_ki_deg: 0.4, xte_i_max_deg: 12.0 },
             hull: { loa_m: 1.9, beam_m: 0.75 } };
V.SPEED_KN = { low: 1.5, survey: 3.0, high: 6.0 };
V.MAX_TURN_RATE_DEG_S = 60;

const LAT0 = 42.1396, LON0 = -80.0902;            // Erie, the same frame direct_turn.js uses
const F = planeFrame({ lat: LAT0, lon: LON0 });
const M_LAT = 111320, MLON = M_LAT * Math.cos(LAT0 * Math.PI / 180);
const ll = (e, n) => ({ lat: LAT0 + n / M_LAT, lon: LON0 + e / MLON });
const kn = k => V.SPEED_KN[k] * 0.514444;

/** The same corner geometry gen_fixtures.py flew: a 60 m run-in, the corner, a run-out. */
function cornerRoute(inM, outM, deflDeg, runIn = 60) {
  const pts = [[0, 0], [0, runIn], [0, runIn + inM]];
  const h = deflDeg * Math.PI / 180, ex = Math.sin(h), ey = Math.cos(h);
  pts.push([pts[2][0] + ex * outM, pts[2][1] + ey * outM]);
  pts.push([pts[3][0] + ex * 80, pts[3][1] + ey * 80]);
  return pts.map(([e, n]) => ll(e, n));
}
const CORNER_I = 2;

// ── GROUND TRUTH, from asv_console.py's SimVcu.tick ─────────────────────────────────────
const TRUTH = [
  { label: "a 90 deg corner on open legs",    inM: 30, outM: 40, defl: 90,  key: "survey", dev: 0.786 },
  { label: "a 120 deg corner on open legs",   inM: 30, outM: 40, defl: 120, key: "survey", dev: 1.609 },
  { label: "a 165 deg reversal on open legs", inM: 30, outM: 40, defl: 165, key: "survey", dev: 2.705 },
  { label: "a 120 deg corner at low",         inM: 30, outM: 40, defl: 120, key: "low",    dev: 0.427 },
  { label: "a 120 deg corner at high",        inM: 30, outM: 40, defl: 120, key: "high",   dev: 4.309 },
  { label: "a 148 deg corner, short run-out", inM: 30, outM: 6,  defl: 148, key: "survey", dev: 2.354 },
  { label: "a 30 deg bend (barely a corner)", inM: 30, outM: 40, defl: 30,  key: "survey", dev: 0.125 },
];
const TOL_M = 0.35;
// ⚠ A SEPARATE, LARGER TOLERANCE FOR CHAINS, AND IT IS RECORDED NOT CHOSEN. On chained
// sharp corners the walk still trails the vessel further than on isolated ones - 0.768 m
// worst over 280 corners of a leg-length x deflection x speed sweep - because the walk
// carries no drift model and the errors compound along a chain. Quoting 0.35 here would
// be quoting the easy fixtures' number at the hard ones.
const TOL_CHAIN_M = 0.8;

// ⚠ NO SILENT ZERO. This returned 0 when the walk charged NOTHING to the vertex, and
// check 7's fixture (0.125 m against a 0.35 m tolerance) accepts 0 - so the check passed
// on the ABSENCE of a measurement. The tell was in this file's own TEETH table: check 7
// appeared in none of the kill lists while every neighbour appeared in several. NaN fails
// every comparison, so a corner that was never measured now reds instead of agreeing.
function devAt(route, key, i) {
  const w = flownTrack(route, F, () => kn(key), null, kn(key));
  return w.corner[i] ? w.corner[i].dev : NaN;
}

console.log("\n-- 1-7: the walk against the VESSEL MODEL (SimVcu.tick), tolerance " + TOL_M + " m --");
TRUTH.forEach((t, k) => {
  const route = cornerRoute(t.inM, t.outM, t.defl);
  const got = devAt(route, t.key, CORNER_I);
  check(String(k + 1) + ". " + t.label + " @" + t.key,
        () => Math.abs(got - t.dev) <= TOL_M,
        "hull " + t.dev.toFixed(3) + " m, walk " + got.toFixed(3) + " m, out by "
          + Math.abs(got - t.dev).toFixed(3));
});

console.log("\n-- 8-10: the three terms that had to be the follower's, not a projection's --");
// 8. THE TICK ORDER. The follower measures along-track and range BEFORE it steps and
// advances the leg on those. Advancing on the post-step position instead is half a step
// early - and that alone under-reported Honolulu's vertex 40 enough to miss a real breach.
check("8. the leg advance is decided on the PRE-step position (source)",
      // ⚠ ORDER, NOT MERE PRESENCE. Both halves were bare .test(SRC) over the whole file,
      // which asserts only that two strings exist somewhere - a version that measured distB
      // AFTER the step would have passed. Checks 18, 20 and 21 in this suite already
      // constrain order; this one now does too.
      () => /const distB = Math\.hypot\(tgt\.e - e, tgt\.n - n\);/.test(SRC)
         && /if\(along >= segLen - t\.approachM \|\| distB <= t\.approachM\)/.test(SRC)
         && SRC.indexOf("const distB = Math.hypot(tgt.e - e, tgt.n - n);")
            < SRC.indexOf("e += twMs * Math.sin(a) * TRACK_STEP_S;")
         && SRC.indexOf("e += twMs * Math.sin(a) * TRACK_STEP_S;")
            < SRC.indexOf("if(along >= segLen - t.approachM || distB <= t.approachM)"),
      "along and distB are both taken before the integration step");
// 9. LOOK-AHEAD STEERING, not waypoint chasing, and the XTE trim with it.
check("9. it steers at a look-ahead point on the leg, and trims cross-track",
      () => /Math\.max\(along, 0\) \+ t\.lookM/.test(SRC) && /desired -= xi;/.test(SRC)
         && /xi = clampN\(xi \+ t\.kiDeg \* xte \* TRACK_STEP_S/.test(SRC),
      "lookahead_m and xte_ki_deg both reach the steering law");
// 10. THE RAMP. Slowing for a corner is worth nothing if the run-in is too short to slow
// in. A 2 m run-in cannot take 1.5 kn off the boat, so the corner is still rounded fast.
{
  // ⚠ THE NUMBERS ARE WHY THIS IS THE `high` CASE. survey -> low is 1.5 kn at 1.5 kn/s =
  // 1.0 s, about 1.5 m of run-in, so almost any leg delivers it and the ramp cannot be
  // seen. high -> low is 4.5 kn = 3.0 s, about 9.3 m - so a 6 m run-in genuinely cannot
  // take the way off and a 60 m one easily can. The first cut of this check used survey
  // and a 2 m leg, asserted the slow would NOT arrive, and was simply wrong about its own
  // arithmetic; the code was right.
  const dev = (inM, at) => flownTrack(cornerRoute(inM, 40, 165), F,
                                      i => (at && i >= CORNER_I ? kn("low") : kn("high")), null)
                             .corner[CORNER_I].dev;
  const sFast = dev(1.5, false), sAsked = dev(1.5, true);
  const lFast = dev(60, false), lAsked = dev(60, true);
  // MEASURED, not reasoned: the ramp stops delivering below about 6 m of run-in from
  // `high`, because she covers the leg more slowly as she slows and buys herself time. At
  // 1.5 m the corner is still 3.2 m against the 1.2 m a fully-slowed one costs.
  check("10. the throttle RAMPS: a 1.5 m run-in cannot deliver low from high, a 60 m one can",
        () => sAsked > 2.5 && lAsked < 1.5 && sFast > 5 && lFast > 5,
        "1.5 m run-in: " + sFast.toFixed(2) + " -> " + sAsked.toFixed(2)
          + " m (still fast);  60 m run-in: " + lFast.toFixed(2) + " -> " + lAsked.toFixed(2)
          + " m (ramp " + SPEED_RAMP_KN_S + " kn/s, step " + TRACK_STEP_S + " s)");
}

// ⚠ EVERYTHING FROM HERE IS INSIDE ONE ASYNC IIFE, and the summary with it.
// cornerSlowPlan hands the main thread back between corners (see its header), so it is
// async - and a CommonJS suite has no top-level await. Closing the IIFE before the
// summary would print a pass count taken before the awaited checks had run, which is the
// same class of lie as a check that evaluates nothing.
(async () => {
console.log("\n-- 11-14: cornerSlowPlan, and it must never under-flag --");
// A keep-out placed so the POLYLINE clears the buffer and the flown corner does not.
function boxKo(e0, n0, e1, n1) {
  const ring = [[e0, n0], [e1, n0], [e1, n1], [e0, n1]].map(([e, n]) => ({ e, n }));
  return { polys: [{ ring, bb: bbOf(ring) }],
           lines: [], points: [], marks: [], sys: [], chans: [] };
}
{
  const BUF = 5;
  // a 165 deg reversal: the hull departs 2.705 m OUTBOARD at survey, 1.1 m at low.
  const route = cornerRoute(30, 40, 165);
  const cE = 0, cN = 90;                                  // the corner vertex, in metres
  // ⚠ THE WALL POSITIONS ARE MEASURED OFF THE FLOWN TRACK, NOT DERIVED FROM `dev`. `dev` is
  // distance from the POLYLINE and the wall is a straight edge in the plane, so the two are
  // not the same quantity and reasoning from one to the other put this fixture wrong twice.
  // Max EASTING of the flown corner, probed: low 1.47 m, survey 2.93 m, high 5.86 m. A wall
  // whose near face is at E blocks whatever comes within BUF of it, so at BUF = 5:
  //     E < 6.47  breaches even at low        6.47 <= E < 7.93  survey breaches, low clears
  //     E >= 7.93 clears at the plan speed
  const ko = boxKo(7.2, cN - 40, 40, cN + 40);
  const plan = await cornerSlowPlan(route, F, ko, BUF, "survey", "low");
  check("11. ACCEPTS: a corner whose flown track enters the buffer is flagged to slow",
        () => plan.slow.includes(CORNER_I) && !plan.unanswered.includes(CORNER_I),
        "slow=[" + plan.slow + "] unanswered=[" + plan.unanswered + "]");

  // the same corner with the wall far enough out that even the fast corner clears it
  const far = await cornerSlowPlan(route, F, boxKo(20, cN - 40, 60, cN + 40), BUF, "survey", "low");
  check("12. REFUSES: the same corner with water to round it in is NOT flagged",
        () => far.slow.length === 0 && far.unanswered.length === 0,
        "nothing flagged when the corner has room — the paired acceptance for 11");

  // a wall so close that the POLYLINE itself is inside the buffer is not this function's
  // business (legPath refuses that upload), but a wall the low-speed corner still reaches
  // IS: it must come back as one slowing does not answer.
  const tight = await cornerSlowPlan(route, F, boxKo(6.0, cN - 40, 40, cN + 40), BUF, "survey", "low");
  check("13. UNANSWERED: a corner that breaches even at the low speed is named, not slowed",
        () => tight.unanswered.includes(CORNER_I) && !tight.slow.includes(CORNER_I),
        "slow=[" + tight.slow + "] unanswered=[" + tight.unanswered + "]");

  // 14. THE SCREEN CANNOT UNDER-FLAG. It is the triangle inequality - nothing within
  // buf+reach of the vertex means nothing within buf of the corner - so it may skip a
  // model call but may never skip a breach. Walk the wall inward one centimetre at a time
  // across the whole decision boundary and assert the flag only ever turns ON.
  let lastOff = null, monotone = true, flipped = 0;
  for (let d = 12.0; d >= 4.0; d -= 0.05) {
    const p = await cornerSlowPlan(route, F, boxKo(d, cN - 40, 40, cN + 40), BUF, "survey", "low");
    const on = p.slow.includes(CORNER_I) || p.unanswered.includes(CORNER_I);
    if (lastOff !== null && lastOff === true && on === false) { monotone = false; }
    if (lastOff !== null && lastOff !== on) flipped++;
    lastOff = on;
  }
  check("14. the screen is monotone: closing the wall can only ever turn the flag ON",
        () => monotone && flipped >= 1,
        "160 wall positions from 12.0 m to 4.0 m, " + flipped + " transition(s), no flag ever lost");

  // 14b. THE SPEED THE LEG IS COMMANDED AT (2026-09-24). `keyAt(i)` names the speed key for the leg INTO
  // each vertex. Same wall as 11 (survey breaches, low clears): told the corner's two legs are already LOW the
  // walk flags nothing - there is nothing to slow; told they are HIGH it flags the corner. With no keyAt it is
  // the call 11 made (planKey everywhere) and answers as 11 did - that is the legacy control.
  const cornerLegs = (key, rest) => (i) => (i === CORNER_I || i === CORNER_I + 1) ? key : rest;
  // At the SURVEY cap, as 11 is: planKey also sizes the corner window (cornerReachM), and this fixture's
  // out-leg runs into the wall, so a wider window drags the out-leg into vertex 2's corner. CORNER_I is
  // the question; vertex 3 sits inside the box and is unanswered whatever the speeds are.
  const legsLow = await cornerSlowPlan(route, F, ko, BUF, "survey", "low", undefined, cornerLegs("low", "survey"));
  const legsHigh = await cornerSlowPlan(route, F, ko, BUF, "survey", "low", undefined, cornerLegs("high", "survey"));
  const legsNone = await cornerSlowPlan(route, F, ko, BUF, "survey", "low", undefined, undefined);
  check("14b. keyAt: a corner whose legs the run commands at LOW is not flagged, the same corner at HIGH is, and "
        + "with no keyAt the walk is the one 11 made",
        () => !legsLow.slow.includes(CORNER_I) && !legsLow.unanswered.includes(CORNER_I)
              && (legsHigh.slow.includes(CORNER_I) || legsHigh.unanswered.includes(CORNER_I))
              && legsNone.slow.includes(CORNER_I) && !legsNone.unanswered.includes(CORNER_I),
        "low legs: slow=[" + legsLow.slow + "] un=[" + legsLow.unanswered + "]; high legs: slow=[" + legsHigh.slow
          + "] un=[" + legsHigh.unanswered + "]; no keyAt: slow=[" + legsNone.slow + "]");
  // 14c. THE PAGE'S OWN keyAt, driven: routeSpeedKeys reads the plan's turn points and the committed lines and
  // answers the governor's roles - transit onto the first line, survey along it, turn into and out of a join -
  // and doUpload hands it to cornerSlowPlan (the source pin, same style as 18 below).
  {
    const mission = { lines: [{ a: ll(0, 0), b: ll(0, 100) }, { a: ll(10, 100), b: ll(10, 0) }], waypoints: [] };
    const tpt = { ...ll(5, 105), turn: true };
    mission.waypoints = [ll(0, 0), ll(0, 100), tpt, ll(10, 100)];
    const LINE_MATCH_M = 5;
    const roleSpeed = (r) => r;
    // the page's own bodies, brace-matched out of the source. Read HERE: `H` below is declared later in this
    // same IIFE scope, so it is in its temporal dead zone at this point.
    const HH = fs.readFileSync(process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html"), "utf8");
    const grabFn = (name) => { const s = HH.indexOf("function " + name + "("); if (s < 0) throw new Error("no " + name);
      let k = HH.indexOf("{", s), d = 0; for (;;) { const c = HH[k]; if (c === "{") d++; else if (c === "}") { d--; if (!d) break; } k++; }
      return HH.slice(s, k + 1); };
    // eslint-disable-next-line no-new-func
    const keysOf = new Function("mission", "LINE_MATCH_M", "distTo", "roleSpeed", "llEN",
      grabFn("legIsLine") + "\n" + grabFn("lineOfLeg") + "\n" + grabFn("onLineM") + "\n" + grabFn("reversalScaleM") + "\n"
      + grabFn("isReversalGap") + "\n" + grabFn("routeSpeedKeys") + "\nreturn routeSpeedKeys;")(mission, LINE_MATCH_M, distTo,
      roleSpeed, require("../static/js/geodesy.js").llEN);
    const walk = [ll(-30, -20), ll(0, 0), ll(0, 100), { lat: tpt.lat, lon: tpt.lon }, ll(10, 100), ll(10, 0)];
    const keyAt = keysOf(walk);
    const got = [1, 2, 3, 4, 5].map(keyAt).join(",");
    check("14c. routeSpeedKeys: transit onto the line, survey along it, turn into and out of the join, survey down "
          + "the next line - and doUpload hands it to cornerSlowPlan",
          () => got === "transit,survey,turn,turn,survey" && HH.indexOf("routeSpeedKeys(walkRoute)") > 0
                && HH.indexOf("routeSpeedKeys(walkRoute)") < HH.indexOf("cs = {slow: raw.slow"),
          "keys " + got + "; wired=" + (HH.indexOf("routeSpeedKeys(walkRoute)") > 0));
    // 14d. A SLOW-RADIUS TURN IS LOW (2026-10-03). The governor flies the reversal out of a `slow_turn_out` line at
    // LOW whatever the turn role is; keyed at the turn role here, Upload judged at the turn speed a turn the punch had
    // certified at low - and the governor's LEAD, which reads this table, would lead to the turn speed and then cut to
    // LOW at the turn with no lead at all. The turn point belongs to the line whose end came before it.
    mission.lines[0].slow_turn_out = true;
    const gotSlow = [1, 2, 3, 4, 5].map(keysOf(walk)).join(",");
    mission.lines[0].slow_turn_out = false;
    // a plan of `n` lines `sp` m apart (line 1 STORED the other way round from how it is flown), a turn point between
    // each pair, and optionally a last line `hop` m east reached by two routed vias (commitPattern flags them `turn` too)
    const plan = (sp, hop, flip = true) => {
      const L = [], W = [], route = [ll(-30, -20)];
      for (let k = 0; k < 4; k++) {
        const e = k * sp, up = k % 2 === 0, a = ll(e, up ? 0 : 100), bb = ll(e, up ? 100 : 0);
        L.push(k === 1 && flip ? { a: bb, b: a } : { a, b: bb });
        W.push(a, bb); route.push(a, bb);
        if (k < 3) { const t = { ...ll(e + sp / 2, up ? 100 + sp / 2 : -sp / 2), turn: true }; W.push(t); route.push({ lat: t.lat, lon: t.lon }); }
      }
      if (hop) { const v1 = { ...ll(3 * sp + hop / 2, 120), turn: true }, v2 = { ...ll(3 * sp + hop - 10, 110), turn: true };
        const a = ll(3 * sp + hop, 100), bb = ll(3 * sp + hop, 0);
        L.push({ a, b: bb }); W.push(v1, v2, a, bb);
        route.push({ lat: v1.lat, lon: v1.lon }, { lat: v2.lat, lon: v2.lon }, a, bb); }
      return { L, W, route };
    };
    const keysWith = (pl, marked) => { mission.lines = pl.L.map((x, k) => ({ ...x, slow_turn_out: k === marked }));
      mission.waypoints = pl.W; const ka = keysOf(pl.route); return pl.route.slice(1).map((_, i) => ka(i + 1)).join(","); };
    // (the hop plan stores its lines in flight order: a stored-backwards line inflates the plan's median gap, and the
    // reversal scale with it, which is isReversalGap's business and not this check's)
    const p10 = plan(10), p4 = plan(4), pHop = plan(10, 300, false);
    const NONE = "transit,survey,turn,turn,survey,turn,turn,survey,turn,turn,survey";
    const k10 = [-1, 0, 1, 2].map((m) => keysWith(p10, m)), k4 = keysWith(p4, 1), kHop = keysWith(pHop, -1);
    check("14d. ... and a SLOW-RADIUS turn (the line before it marked slow_turn_out) is keyed LOW into and out of THAT "
          + "join only - the line before it named as lineOfLeg names it (a line flown against its stored direction, a 4 m "
          + "pattern where the first match is the line before) - and a routed HOP's vias are TRANSIT, as the governor flies "
          + "them, not turn points",
          () => gotSlow === "transit,survey,low,low,survey" && k10[0] === NONE
                && k10[1] === "transit,survey,low,low,survey,turn,turn,survey,turn,turn,survey"
                && k10[2] === "transit,survey,turn,turn,survey,low,low,survey,turn,turn,survey"
                && k10[3] === "transit,survey,turn,turn,survey,turn,turn,survey,low,low,survey"
                && k4 === "transit,survey,turn,turn,survey,low,low,survey,turn,turn,survey"
                && kHop === NONE + ",transit,transit,transit,survey",
          "10 m, line k marked: " + k10.slice(1).join(" | ") + "; 4 m, line 1 marked: " + k4 + "; a hop: " + kHop);
  }
}

console.log("\n-- 15-16: the corner window, and what it is for --");
// 15. A corner's window is the corner. Charging a whole leg to the vertex it ends at put
// `reach` at 600 m on a coverage line, so the screen could never reject and the exact test
// walked every step of the plan: 16 s over 415 waypoints against 0.4 s.
{
  const route = cornerRoute(30, 400, 90);          // a 400 m run-out
  const w = flownTrack(route, F, () => kn("survey"), null);
  const cap = kn("survey") * (180 / 60) + 1;       // cornerReachM for this hull/speed
  const w165 = flownTrack(cornerRoute(30, 40, 165), F, () => kn("survey"), null, kn("survey"));
  // ⚠ BOUNDED ABOVE **AND USED**. Bounding it above alone could not see `cornerReachM`'s
  // 180 changed to 90: a halved window is still under the cap, and every check in this file
  // stayed green through that mutation. A 165-degree corner swings most of a half turn, so
  // its excursion has to reach most of the way to the cap - which a halved one cannot.
  check("15. the corner's window is the CORNER: bounded by the half-turn distance, and USED",
        () => w.corner[CORNER_I].reach <= cap + 1e-6 && w.corner[CORNER_I].reach > 1
           && w165.corner[CORNER_I].reach <= cap + 1e-6
           && w165.corner[CORNER_I].reach > 0.8 * cap,
        "400 m run-out: reach " + w.corner[CORNER_I].reach.toFixed(2) + " m against a "
          + cap.toFixed(2) + " m cap;  a 165-degree corner uses "
          + w165.corner[CORNER_I].reach.toFixed(2) + " m of it");
}
// 16. Every term is the vessel's. The one exception is the throttle ramp, and it is named.
check("16. no fitted constant: every term is read from the vessel, and the one that is not says so",
      () => /m\.lookahead_m/.test(SRC) && /a\.xte_ki_deg/.test(SRC) && /a\.xte_i_max_deg/.test(SRC)
         && /m\.approach_m/.test(SRC) && /V\.MAX_TURN_RATE_DEG_S/.test(SRC)
         && /ONE number here that is not in the vessel/.test(SRC),
      "lookahead, xte trim, approach radius and turn rate all from V.VESSEL; the ramp is declared");

// 17. ⚠ THIS CHECK ASSERTED THE OPPOSITE UNTIL A REVIEW READ THE VESSEL PROPERLY, and
// that is worth more than the property it now holds. It said the walk dropped the trim on
// a leg advance "as the vessel drops it", citing asv_console.py's "a new leg: the old
// cross-track trim is not its trim". THAT LINE IS IN `amend_plan`. The tick's own advance
// sets `_seg_start` and `_wp_index` and never touches `_xte_i`, so the vessel CARRIES the
// trim and the walk now carries it too. The behaviour barely moves - measured 0.000 m over
// four zig-zag fixtures, because the integral has no standing drift to cancel - which is
// exactly why no measurement caught it and only reading the vessel did.
check("17. the cross-track trim is CARRIED across a leg, because the vessel carries it",
      () => /prev = tgt; k\+\+;$/m.test(SRC) && !/k\+\+; xi = 0;/.test(SRC),
      "the tick's advance does not touch _xte_i; the `amend_plan` line that says it does is a DIFFERENT leg change, and reading it as this one is what put the reset here");

console.log("\n-- 18-20: the wiring, because a model nothing calls protects nothing --");
// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes
// its mutants to a file this suite never reads and scores every one as SURVIVED (audited
// 2026-09-21: 21 of the 53 suites reading this page had no override).
const H = fs.readFileSync(process.env.ASV_HTML
                || path.join(__dirname, "..", "static", "asv.html"), "utf8");
// 18. COMPUTED AT UPLOAD, ON THE FINAL ROUTE. punchOut never sees the approach or
// legPath's detours, and the vessel never sees anything else - so this is the only
// point at which the thing being flown exists to be measured.
check("18. doUpload measures the final route, after legPath has routed it",
      () => /cornerSlowPlan\(walkRoute, nogo\.frame, nogo\.ko, nogo\.buffer \|\| 0, planKey, "low",/.test(H)
         && H.indexOf("cornerSlowPlan(walkRoute") > H.indexOf("const plan = routePlan(")
         // ⚠ AND THE BOAT IS IN THE WALK. routePlan drops seg[0], so plan.route[0] is the
         // first ROUTED point, not the vessel - the corner where her own heading meets the
         // approach went unmeasured until a review found it. She is prepended for the walk
         // and the indices come back shifted, because the SET is keyed by the `wp_index` the
         // vessel reports and that indexes the uploaded route, which does not contain her.
         && /const walkRoute = \[\{lat: asv\.lat, lon: asv\.lon\}, \.\.\.plan\.route\];/.test(H)
         && /slow: raw\.slow\.map\(i => i - 1\)\.filter\(i => i >= 0\)/.test(H)
         // ⚠ AND THE OPERATOR'S APPROACH RADIUS REACHES IT. That is the radius at which the
         // follower changes leg, so it is what decides how wide a corner is cut, and it is a
         // MISSION setting the server passes straight to the vessel. The same expression
         // guardTrack and punchOut's flyability check both already use - a second spelling of
         // it would be a number meant to agree with itself kept in three places.
         && /\{approachM: Math\.max\(0\.5, \+\(mission\.approach_radius_m\) \|\| 1\)\}/.test(H),
      "after routePlan, on plan.route, and carrying the mission's own approach radius");
// 19. READ BY THE GOVERNOR, on the leg INTO a flagged vertex and the leg out of it.
// ⚠ THE GENERATED-TURN HALF MOVED ONTO THE LINE (2026-09-22). It was keyed by PUNCH GAP
// and read by MISSION-LINE index - `turnSeg.from` IS a mission.lines index - so the two
// agreed only for one pattern on an empty plan, never re-punched, never reloaded, with no
// line struck off. Exactly the lesson THIS file's own `cornerSlowFor` was written for, one
// declaration below it: a set of indices may not outlive the thing it indexes. The junction
// half is unchanged, and the point of this check is still that the two sit BESIDE each other.
check("19. speedGovernor flies a flagged corner at the low speed, both legs of it - beside "
      + "the generated-turn rule, which now reads the committed LINE",
      () => /cornerSlow\.has\(wi\) \|\| cornerSlow\.has\(wi - 1\)/.test(H)
         && /\(\(role === "turn" && gap >= 0 && \(mission\.lines\[gap\] \|\| \{\}\)\.slow_turn_out\) \|\| atCorner\)/.test(H)
         && /slow_turn_out: !!\(slowOut && slowOut\[k\]\)/.test(H),
      "the junction rule sits beside the generated-turn one, not instead of it - and the "
        + "generated-turn flag is written onto the line it leaves, so it survives a reload "
        + "and a strike");
// 20. A STALE SET IS WORSE THAN NONE: its indices point into a route that is no longer
// being flown, so the boat would be slowed at the wrong waypoint. The degraded
// (no-chart) upload path must clear it rather than leave the last plan's corners armed.
check("20. the unrouted upload path clears the set rather than leaving a stale one armed",
      () => /cornerSlow = new Set\(\); cornerUnanswered = \[\]; cornerSlowFor = -1;/.test(H)
         && H.indexOf("cornerSlow = new Set(); cornerUnanswered = []; cornerSlowFor = -1;")
            < H.indexOf("cornerSlowPlan(walkRoute"),
      "the degraded branch drops it before the routed branch could set it");

// 19b-19e. AND THE SAME RULE DRIVEN END TO END, because 19 above is a SOURCE check and a
// re-base is one identifier. punchOut's own per-gap write and commitPattern's own model
// statements and push loop are sliced out of the page and EXECUTED, so moving `slowOut`
// back onto the punch, or off the line, changes what these checks see. Then the real
// speedGovernor is asked, on the real turnSeg, for the speed it would command.
//
// All four were measured red before the fix and green after, against a control (one
// pattern, empty plan, no reload, no strike) that was green BOTH times - so these are the
// defect, not a dead feature:
//     a second pattern   -> the flagged reversal flown at 3.0 kn, and pattern 1's FIRST
//                           reversal, which nobody measured, flown at 1.5
//     a page reload      -> every reversal at 3.0 kn, for ever, with no mark in the plan
//     a line struck off  -> the same physical reversal at 3.0 kn
{
  const GEO = require("../static/js/geodesy.js");
  const grabFn = (name) => {
    const s = H.indexOf("function " + name + "(");
    if (s < 0) throw new Error("anchor gone: function " + name);
    let k = H.indexOf("{", s), d = 0;
    for (;;) { const c = H[k]; if (c === "{") d++; else if (c === "}") { d--; if (!d) break; } k++; }
    return H.slice(s, k + 1);
  };
  const grabLet = (name) => {
    for (const kw of ["const ", "let "]) {
      for (const sp of [" =", "="]) {
        const i = H.indexOf(kw + name + sp);
        if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
      }
    }
    throw new Error("anchor gone: declaration " + name);
  };
  // commitPattern's OWN statements: the two model lines and the push loop, verbatim. The
  // `slowOut` each pushed line receives is whatever the page hands it.
  const cs = H.indexOf("  const leads = patClip ? patLead : null;");
  const ce = H.indexOf("\n  });", cs);
  if (cs < 0 || ce < 0) throw new Error("anchor gone: commitPattern's commit loop");
  const COMMIT = H.slice(cs, ce + 6);
  // punchOut's OWN per-gap write, verbatim, in a wrapper supplying exactly what punchOut does
  const PUNCH = "if(t.slow){ nTurnSlow++; turnSlowAt[k]=true; }";
  if (H.indexOf(PUNCH) < 0) throw new Error("anchor gone: punchOut's per-gap slow write");

  const PAGE = [
    grabLet("LINE_MATCH_M"), grabLet("_legLine"), grabLet("SPEED_ROLES"), grabLet("NO_LEAD"),
    grabLet("LINE_PART_OFFSET_M"), grabLet("_drawnLines"), grabLet("SPEED_RESEND_MS"),
    grabLet("speedWant"), grabLet("commandedSpeed"),
    grabLet("_eqLL"),
    grabFn("indexedRoute"), grabFn("lineSetKey"), grabFn("syncLineStats"), grabFn("turnZoneM"),
    grabFn("nearestEndpointM"), grabFn("linePartContinues"), grabFn("drawnLines"),
    grabFn("lineNo"), grabFn("lineCount"), grabFn("linePartTxt"), grabFn("reversalScaleM"),
    grabFn("isReversalGap"), grabFn("currentLegLine"), grabFn("lineOfLeg"), grabFn("accumLineTime"),
    grabFn("alongLineM"), grabFn("linePhase"), grabFn("currentActivity"), grabFn("speedRole"),
    grabFn("roleSpeed"), grabFn("roleSpeedMS"), grabFn("sendSpeed"), grabFn("commandSpeed"),
    grabFn("slowestMakingWayKey"), grabFn("setMsNow"), grabFn("makesWayKey"),   // the floor under every command (2026-09-26)
    grabFn("speedGovernor"),
    grabLet("govLead"), grabFn("leadSpeedKey"),   // the lead (2026-10-03): null at once with no slowdown block
    grabFn("legIsLine"), grabFn("routeSpeedKeys"), grabFn("runLegKeys"),   // ... and what it reads with one (19g-19i)
    grabFn("leadFor"), grabLet("viewLead"), grabLet("_legKeys"), grabFn("onLineM"),
    grabLet("guardEdgeAt"), grabLet("EDGE_REASSESS_MS"),    // the governor's raise rule: undeclared, a raise was a crash
    grabFn("deleteLineByIndex"),
    "function __commit(lines, patClip, patLead, transits){\n" + COMMIT + "\n}",
    "function __flagGap(k){ const t = {slow:true}; let nTurnSlow = 0; " + PUNCH
      + " return nTurnSlow; }",
  ].join("\n");

  // eslint-disable-next-line no-new-func
  const W = new Function("V", "window", "performance", "M_PER_DEG_LAT", "azTo", "distTo",
                         "toEN", "llEN", "alignDeg", "fmtDist",
                         "slowLaw", "leadWant", "groundVel", "SPEED_CMD_LATENCY_S",
    // ⚠ THE LAUNCH GRANT REACHES THE CLASSIFIER (R8, merged 2026-09-23): currentActivity()
    // returns role "depart" while a grant stands, so `grant` has to exist in this world or
    // speedRole() - which the governor checks here all go through - is a bare ReferenceError.
    // Null: no berth is latched, so the classifier answers exactly as it always did.
    "let grant = null;\n"
    + "let mission = null, asv = null, S = null, runRoute = null;\n"
    + "let runLineIdx = -1, turnSeg = [], curTurn = -1, lastRunLine = -1;\n"
    + "let lineActual = [], lineClock = null, lineStatsKey = null;\n"
    + "let turnSlowAt = {}, cornerSlow = new Set(), cornerSlowFor = -1;\n"
    + "let resumeSlow = false, escapeThrottle = false;\n"
    + "const clearance = {slowed: false}; const sent = [];\n"
    // commandSpeed reads what its command answered (2026-09-22): a want for a command this tab never sent is not a want. A stub returning undefined makes it throw.
    + "const cmd = (p, b) => { sent.push(b && b.speed); return Promise.resolve({ok:true, state:{}}); };\n"
    + "const showBanner = () => {}; const saveMission = () => {};\n"
    + "const supervising = () => true;\n"
    + PAGE + "\n"
    + "return {mission: () => mission, sent, deleteLineByIndex, speedGovernor, speedRole,\n"
    + "  setMission: (m) => { mission = m; },\n"
    + "  flag: (k) => __flagGap(k), clearFlags: () => { turnSlowAt = {}; },\n"
    + "  commit: (lines, leads, transits, punched) => __commit(lines, punched ? lines : null, leads, transits),\n"
    + "  reset: () => { runRoute = null; window._wpIndex = 0; runLineIdx = -1; turnSeg = [];\n"
    + "    curTurn = -1; lastRunLine = -1; lineActual = []; lineClock = null;\n"
    + "    lineStatsKey = null; _legLine = {key:'', line:-1}; commandedSpeed = null;\n"
    + "    speedWant = null; sent.length = 0; govLead = null;\n"
    + "    S = {run:'running', armed:true, estop:false, behavior:'survey',\n"
    + "         status:{holding:false, sog_kn:6, cog_deg:0, drifting:false}}; },\n"
    + "  tick: (pt, cog, wp) => { asv = {lat: pt.lat, lon: pt.lon, hdg: cog};\n"
    + "    S.status.cog_deg = cog; S.status.sog_kn = 6; window._wpIndex = wp; S.wp_index = wp;\n"
    + "    lineClock = performance.now()/1000 - 0.25; accumLineTime(); },\n"
    + "  setSog: (k) => { S.status.sog_kn = k; }, setBehavior: (b) => { S.behavior = b; }, lead: () => govLead,\n"
    + "  setSet: (kn, deg) => { S.status.env_set_kn = kn; S.status.env_set_deg = deg; },\n"
    + "  setCorners: (set, n) => { cornerSlow = new Set(set); cornerSlowFor = n; S.wp_total = n; },\n"
    + "  ran: () => lastRunLine, turnFrom: () => (curTurn >= 0 && turnSeg[curTurn]\n"
    + "    ? turnSeg[curTurn].from : null), eq: (a, b) => _eqLL(a, b)};")(
      V, { _wpIndex: 0 }, { now: () => Date.now() }, GEO.M_PER_DEG_LAT, GEO.azTo, GEO.distTo,
      GEO.toEN, GEO.llEN, GEO.alignDeg, (m) => Math.round(m) + " m",
      require("../static/js/coast.js").slowLaw, require("../static/js/coast.js").leadWant,
      require("../static/js/guard.js").groundVel, SPEED_CMD_LATENCY_S);

  const LAT0 = 21.3100, LON0 = -157.8700;                 // his own Honolulu water
  const MLON = GEO.M_PER_DEG_LAT * Math.cos(LAT0 * Math.PI / 180);
  const P = (dn, de) => ({ lat: LAT0 + dn / GEO.M_PER_DEG_LAT, lon: LON0 + de / MLON });
  // a boustrophedon block: n runs, 150 m long, 60 m apart, starting `north` m north
  const block = (n, north) => {
    const out = [];
    for (let k = 0; k < n; k++) {
      const y = north + k * 60;
      out.push(k % 2 ? [P(y, 150), P(y, 0)] : [P(y, 0), P(y, 150)]);
    }
    return out;
  };
  // ⚠ THE OPERATOR'S TURN SPEED IS `survey` HERE, so "low" can ONLY have come from the
  // slow-radius flag - not from the role, and not from a default.
  const blank = () => {
    W.setMission({ lines: [], waypoints: [], arrival_radius_m: 8, speed: "survey",
                   speeds: { transit: "high", turn: "survey", survey: "survey" } });
    W.clearFlags(); W.reset();
  };
  // PUNCH then COMMIT, as the page does: punchOut resets the map and flags the gaps whose
  // turn only fitted at the slow radius; `k` there indexes THIS pattern's runs.
  const punch = (runs, slowGaps) => { W.clearFlags(); for (const k of slowGaps) W.flag(k); };
  const commit = (runs, punched = true) => W.commit(runs, runs.map(() => ({ in: 0, out: 0 })),
    runs.map((l, k) => {
      if (k >= runs.length - 1) return null;
      const a = runs[k][1], b = runs[k + 1][0];
      return [{ lat: (a.lat + b.lat) / 2 + 0.00018, lon: (a.lon + b.lon) / 2 }];   // turn apex
    }), punched);
  const wpOf = (li) => {
    const L = W.mission().lines[li], Wp = W.mission().waypoints;
    for (let i = 1; i < Wp.length; i++) if (W.eq(Wp[i - 1], L.a) && W.eq(Wp[i], L.b)) return i;
    return -1;
  };
  // fly the full length of committed line `li`, then swing off its end into the reversal
  const flyInto = (li) => {
    const L = W.mission().lines[li], cog = GEO.azTo(L.a, L.b), wp = wpOf(li);
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      W.tick({ lat: L.a.lat + t * (L.b.lat - L.a.lat),
               lon: L.a.lon + t * (L.b.lon - L.a.lon) }, cog, wp);
    }
    for (let i = 0; i < 4; i++)              // off the line, on the turn leg, in the zone
      W.tick({ lat: L.b.lat + 0.00012 * (i + 1), lon: L.b.lon }, (cog + 90) % 360, wp + 1);
    return { from: W.turnFrom(), role: W.speedRole(), got: W.speedGovernor() };
  };

  // 19b. TWO PATTERNS ON ONE PLAN - the case every real survey is, and the one the punch-gap
  // index could not survive. Pattern 2's gap 0 is flagged; committed, that is the reversal
  // out of LINE 3. Read by punch gap, `turnSlowAt[0]` named line 0 instead: the flagged
  // reversal was flown fast and pattern 1's first one, which nobody measured, was slowed.
  blank(); commit(block(3, 0));                              // pattern 1, unflagged
  const p2 = block(3, 600); punch(p2, [0]); commit(p2);      // pattern 2, gap 0 flagged
  const nLines = W.mission().lines.length;
  W.reset(); const flagged = flyInto(3);                     // pattern 2's flagged reversal
  W.reset(); const unflagged = flyInto(0);                   // pattern 1's, never measured
  check("19b. the flag survives a SECOND pattern committed onto the plan: the reversal that "
        + "only fitted at the slow radius is the one flown slow",
        () => nLines === 6 && flagged.role === "turn" && flagged.got === "low"
              && unflagged.role === "turn" && unflagged.got === "survey",
        nLines + " committed lines; pattern 2's flagged reversal (out of line " + flagged.from
          + ") -> " + flagged.got + " (" + V.SPEED_KN[flagged.got] + " kn), pattern 1's "
          + "unmeasured one (out of line " + unflagged.from + ") -> " + unflagged.got
          + ". Keyed by punch gap these were survey and low - the wrong way round");

  // 19c. AND IT IS IN THE SAVED PLAN. `turnSlowAt` is a page-local `let`; a supervising page
  // opened mid-survey, or the same page reloaded, starts it empty and every reversal then
  // runs at the plan speed with nothing on screen to say so. On the line it goes to the
  // server with the mission.
  blank(); const six = block(6, 0); punch(six, [3]); commit(six);
  const saved = JSON.stringify(W.mission());
  W.setMission(JSON.parse(saved)); W.clearFlags(); W.reset();   // the reload
  const afterLoad = flyInto(3);
  check("19c. ... and it is PERSISTED with the plan, so a reload still flies it slow",
        () => /"slow_turn_out":true/.test(saved) && afterLoad.got === "low",
        "saved plan carries the mark: " + /"slow_turn_out":true/.test(saved)
          + "; after a reload with turnSlowAt empty the reversal out of line "
          + afterLoad.from + " commands " + afterLoad.got + " ("
          + V.SPEED_KN[afterLoad.got] + " kn)");

  // 19d. AND A STRIKE RE-INDEXES IT, which is the whole reason for putting it on the line:
  // the splice that moves the lines moves the flag with them. Struck line 0, the SAME
  // physical reversal is now out of line 2.
  blank(); const st = block(6, 0); punch(st, [3]); commit(st);
  W.deleteLineByIndex(0); W.reset();
  const afterStrike = flyInto(2);
  check("19d. ... and striking a line off re-indexes it: the same physical reversal is still "
        + "the one flown slow",
        () => W.mission().lines.length === 5 && afterStrike.got === "low",
        "5 lines left; the flagged reversal is now out of line " + afterStrike.from
          + " and commands " + afterStrike.got + ". Keyed by punch gap it stayed on gap 3, "
          + "which is a different reversal after the strike");

  // 19e. ...BUT IT IS CLEARED WHEN THE LINE IT TURNED INTO IS STRUCK. Re-indexing a
  // measurement is not re-taking it: with line 4 gone, line 3's flag describes a reversal
  // that no longer exists, and the new, wider one across the gap was never measured. It is
  // unflagged exactly as it would be today; what must not survive is a claim about a turn
  // that is not there. (Clearing DROPS a slow-down - the answer to wanting the new geometry
  // measured is to re-punch, the same answer striking a run has always had.)
  blank(); const gone = block(6, 0); punch(gone, [3]); commit(gone);
  W.deleteLineByIndex(4); W.reset();
  const afterGap = flyInto(3);
  check("19e. ... and it is CLEARED when the line that reversal turned INTO is struck - a "
        + "measurement re-indexed is not a measurement re-taken",
        () => W.mission().lines[3] && W.mission().lines[3].slow_turn_out === false
              && afterGap.got === "survey",
        "line 3's flag after striking line 4: "
          + JSON.stringify(W.mission().lines[3] && W.mission().lines[3].slow_turn_out)
          + "; the new wider reversal out of line 3 commands " + afterGap.got
          + " - unflagged, as an unmeasured turn is");
  // 19f. AND AN UN-PUNCHED PATTERN CARRIES NONE OF IT, for the same reason the leads
  // directly above it in commitPattern do not: `turnSlowAt` is parallel to `patClip` and to
  // nothing else. Drawn lines were never clipped and their reversals were never fitted, so
  // a flag left over from the last punch would be a measurement of somebody else's geometry
  // wearing this pattern's index - and it would SLOW the boat at a reversal nobody looked
  // at while leaving the measured one fast.
  blank();
  const pun = block(3, 0); punch(pun, [0, 1]); commit(pun);
  commit(block(3, 600), false);                            // drawn only: patClip is null
  const marks = W.mission().lines.map(L => !!L.slow_turn_out);
  check("19f. ... and an UN-PUNCHED pattern committed after a punched one carries no "
        + "slow-turn mark at all",
        () => marks.join(",") === "true,true,false,false,false,false",
        "slow_turn_out down the six committed lines: " + marks.join(",")
          + " - the punched pattern's two, then three drawn lines with none");
  // 19g-19i. THE LEAD, DRIVEN (Andy, 2026-10-03: "Lead + walk + sim"). A hull that sheds a commanded cut IN GEAR is
  // commanded a slower leg's speed where the cut must begin - her in-gear run from the speed she is doing plus
  // SPEED_CMD_LATENCY_S of travel - not on the frame she reaches it. The real speedGovernor and leadSpeedKey, on the
  // real committed plan, flown up line 0 toward the reversal at 7 kn with the TURN role at LOW.
  {
    const vSaved = V.VESSEL, kSaved = V.SPEED_KN;
    const drixM = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vessels", "drix08.json"), "utf8")).maneuvering;
    const C = require("../static/js/coast.js");
    const flyUp = (sogAt) => {
      const L = W.mission().lines[0], cog = GEO.azTo(L.a, L.b), wp = wpOf(0), len = GEO.distTo(L.a, L.b);
      const out = [];
      for (let s = 0; s <= len - 2; s += 2) {
        const t = s / len, pt = { lat: L.a.lat + t * (L.b.lat - L.a.lat), lon: L.a.lon + t * (L.b.lon - L.a.lon) };
        W.tick(pt, cog, wp); W.setSog(sogAt(len - s));
        out.push({ d: GEO.distTo(pt, L.b), got: W.speedGovernor(), lead: W.lead() });
      }
      return out;
    };
    try {
      V.SPEED_KN = { low: 4, survey: 7, high: 14 };
      V.VESSEL = { ...vSaved, maneuvering: { ...vSaved.maneuvering, slowdown: drixM.slowdown } };
      blank(); W.mission().speeds.turn = "low"; commit(block(3, 0)); W.reset();
      const run = flyUp(() => 7);
      const first = run.find((r) => r.got === "low");
      const want = C.slowLeadM(7 * 0.514444, 4 * 0.514444, C.slowLaw(drixM.slowdown), SPEED_CMD_LATENCY_S);
      check("19g. THE LEAD: on the DriX's hull the governor commands the reversal's LOW where her in-gear cut must "
            + "begin - within a step of slowRun + the command latency (46.3 m) before the line's end - and says so",
            () => first && first.d <= want && first.d > want - 2.1
                  && run.filter((r) => r.d > want).every((r) => r.got === "survey")
                  && first.lead && first.lead.key === "low" && first.lead.idx === wpOf(0) + 1,
            first ? "LOW first at " + first.d.toFixed(1) + " m before the end (lead " + want.toFixed(1) + " m); survey before; "
                    + "readout: slowing to " + first.lead.key + " for the leg to waypoint " + (first.lead.idx + 1)
                  : "never commanded LOW on the line: " + run.slice(-3).map((r) => r.got).join(","));
      // 19h. IT HOLDS ON THE WAY IN. As she slows her own lead shrinks; the latch keeps the target down.
      W.reset();
      const holding = flyUp((d) => (d > want ? 7 : Math.max(4.2, 4 + (d / want) * 3)));
      const after = holding.filter((r) => r.d <= want);
      check("19h. ... and HOLDS it all the way in as she slows - never raised back to survey (and so never a fresh dead "
            + "time) while the lead she would need stands at her leg's own speed",
            () => after.length > 5 && after.every((r) => r.got === "low"),
            after.length + " frames inside the lead, all " + [...new Set(after.map((r) => r.got))].join("/"));
      // 19i. ACCEPTANCE: no law, no lead - the small-class hull is commanded at the leg exactly as before; and off a
      // survey (a Go-To flies one role throughout) there is no lead either.
      V.VESSEL = vSaved; W.reset();
      const zb = flyUp(() => 7);
      V.VESSEL = { ...vSaved, maneuvering: { ...vSaved.maneuvering, slowdown: drixM.slowdown } };
      W.reset(); W.setBehavior("goto");
      const goto = flyUp(() => 7);
      check("19i. ... and a hull with NO measured slow-down is commanded at the leg, byte for byte - survey to the "
            + "line's end - and no run but a survey takes a lead",
            () => zb.every((r) => r.got === "survey" && r.lead === null) && goto.every((r) => r.lead === null),
            "no-law hull: " + [...new Set(zb.map((r) => r.got))].join("/") + " to " + zb[zb.length - 1].d.toFixed(0)
              + " m; a Go-To: " + [...new Set(goto.map((r) => r.got))].join("/") + ", no lead");
      // 19j. THE LATCH HOLDS IT WHEN A FIX JUMPS. Led 44 m out, the next fix lands 48 m out - past the 46.3 m lead (a GPS
      // jump; a route vertex moved) - and the latch keeps LOW, where a fresh look there at 7 kn would not lead.
      const atD = (d, sog) => { const L = W.mission().lines[0], len = GEO.distTo(L.a, L.b), t = (len - d) / len;
        W.tick({ lat: L.a.lat + t * (L.b.lat - L.a.lat), lon: L.a.lon + t * (L.b.lon - L.a.lon) }, GEO.azTo(L.a, L.b), wpOf(0));
        W.setSog(sog); return W.speedGovernor(); };
      W.reset(); W.mission().speeds.turn = "low";
      atD(60, 7); atD(44, 7); const held = atD(48, 7);
      W.reset(); const fresh = atD(48, 7);
      check("19j. ... and the LATCH holds it when a fix jumps: led 44 m out, a frame 48 m out - past the lead - keeps LOW, "
            + "where a fresh look at 48 m would not lead",
            () => held === "low" && fresh === "survey", "led, then a fix at 48 m: " + held + "; fresh at 48 m: " + fresh);
      // 19o. AND A RUN ALREADY AT LOW IS NOT RAISED ONLY TO BE CUT AGAIN (review): a stand-down drops the latch, and
      // governed again 30 m short of the LOW leg at 4 kn she needs no lead at her own speed - measured from the speed
      // her leg asks for (survey), she is held at LOW instead of sent up the ramp and cut with a fresh dead time.
      W.reset(); const atLowAgain = atD(30, 4);
      check("19o. ... and a run already at LOW near the LOW leg, governed afresh, is held at LOW - not raised to survey "
            + "and cut again",
            () => atLowAgain === "low", "governed afresh at 4 kn, 30 m short: " + atLowAgain);
      // 19k. A FLAGGED CORNER IS LED TO AS WELL. The turn role at SURVEY this time, so LOW can only come from Upload's
      // corner set laid over the table (runLegKeys): the vertex after the line's end flagged.
      W.reset(); blank(); commit(block(3, 0)); W.reset();
      W.setCorners([wpOf(0) + 1], W.mission().waypoints.length);
      const corner = flyUp(() => 7), cFirst = corner.find((r) => r.got === "low");
      W.setCorners([], -1); W.reset();
      const noCorner = flyUp(() => 7);
      check("19k. ... a CORNER Upload flagged is led to as well - the lead reads the corner set over the plan's table - and "
            + "with no corner flagged the same run is survey to the line's end",
            () => cFirst && cFirst.d <= want && cFirst.d > want - 2.1 && noCorner.every((r) => r.got === "survey"),
            (cFirst ? "LOW first at " + cFirst.d.toFixed(1) + " m" : "never LOW") + "; unflagged: "
              + [...new Set(noCorner.map((r) => r.got))].join("/"));
      // 19l. A FOLLOWING SET LENGTHENS IT - by the set carried for the cut's own time (found by mutation: a lead taken
      // from her ground speed and a lead that ignored the set both passed every check above).
      W.reset(); blank(); W.mission().speeds.turn = "low"; commit(block(3, 0)); W.reset();
      const cog0 = GEO.azTo(W.mission().lines[0].a, W.mission().lines[0].b);
      const setRun = (() => { const out = []; const L = W.mission().lines[0], len = GEO.distTo(L.a, L.b);
        for (let s2 = 0; s2 <= len - 2; s2 += 1) { const t = s2 / len;
          W.tick({ lat: L.a.lat + t * (L.b.lat - L.a.lat), lon: L.a.lon + t * (L.b.lon - L.a.lon) }, cog0, wpOf(0));
          W.setSog(8.75); W.setSet(1.75, cog0); out.push({ d: len - s2, got: W.speedGovernor() }); }
        return out; })();
      const sFirst = setRun.find((r) => r.got === "low");
      const wantSet = C.slowLeadM(7 * 0.514444, 4 * 0.514444, C.slowLaw(drixM.slowdown), SPEED_CMD_LATENCY_S, 1.75 * 0.514444);
      check("19l. ... and a FOLLOWING set lengthens it by the set carried for the cut's own time: 7 kn through the water "
            + "with 1.75 kn behind her leads LOW " + wantSet.toFixed(1) + " m out, not the calm " + want.toFixed(1) + " m - "
            + "measured from her way through the water, not her ground speed",
            () => sFirst && sFirst.d <= wantSet + 0.01 && sFirst.d > wantSet - 1.1,
            sFirst ? "LOW first at " + sFirst.d.toFixed(1) + " m" : "never LOW");
      // 19m. THE READOUT KNOWS IT: the command bar's agree test and the RUN block's reason name the lead, or every early
      // slow-down would read as a DISAGREEMENT between the vessel and the selectors (a readout: pinned in the source).
      // 19n. A LOW LEG TWO LEGS AHEAD: the lead is measured ALONG the route - her range to the next vertex, then down
      // the leg between. 30 m lines, the boat on the approach to line 0's start with the reversal after it at LOW: led
      // once 30 m + her range to the start is within 46.3 m, so 16.3 m short of the start, not 46.3.
      W.reset(); blank(); W.mission().speeds = { transit: "survey", turn: "low", survey: "survey" };
      commit([[P(0, 0), P(0, 30)], [P(60, 30), P(60, 0)], [P(120, 0), P(120, 30)]]); W.reset();
      const a0 = W.mission().waypoints[0];
      let twoFirst = null;
      for (let x = -100; x <= -2; x++) {
        W.tick(P(0, x), 90, 0); W.setSog(7);
        if (W.speedGovernor() === "low") { twoFirst = GEO.distTo(P(0, x), a0); break; }
      }
      check("19n. ... and a LOW leg TWO legs ahead is led to by her range ALONG the route: on the approach to a 30 m "
            + "line with a LOW reversal after it, LOW first 16.3 m short of the line's start (46.3 m less the 30 m leg)",
            () => twoFirst !== null && twoFirst <= want - 30 + 0.01 && twoFirst > want - 30 - 1.1,
            twoFirst !== null ? "LOW first " + twoFirst.toFixed(1) + " m short of the start" : "never LOW on the approach");
      check("19m. the command bar's agree test and the RUN block's 'for' row both name the lead - and a tab that is not "
            + "supervising works it out read-only (leadShown), or its card read DISAGREEMENT for every lead",
            () => /: \(shown && shown\.key\) \? shown\.key {5}\/\/ slowing ahead of a slower leg \(the lead\)/.test(H)
                  && /else if\(lsh && lsh\.key\)\n\s*\/\/ THE LEAD, SAID/.test(H.replace(/\r\n/g, "\n"))
                  && /function leadShown\(\)\{\n\s*if\(supervising\(\)\) return govLead;\n\s*viewLead = leadFor\(roleSpeed\(speedRole\(\)\), viewLead\);/
                       .test(H.replace(/\r\n/g, "\n")),
            "agree test and 'for' row read leadShown(); a view-only tab computes its own");
    } finally {
      V.VESSEL = vSaved; V.SPEED_KN = kSaved;
    }
  }
}

// 21. THE BUSY STATE, AND WHY IT ONLY NOW MATTERS. Measuring the corners is awaited
// BEFORE the plan is POSTed, and a yield in a hidden tab costs about a second - so there
// is now real time between the press and the send in which the PREVIOUS plan is still the
// staged one. Raised in review: nothing disabled the button or showed an in-progress
// state, so the operator could press Start in that window and run the old plan believing
// the new one had gone up. A flag set and never cleared would be worse than none, so this
// checks both ends - set before the first await, cleared in a `finally` that every exit
// passes through.
check("21. Upload is BUSY from the press until the plan is sent, and freed on every exit",
      () => /uploadBusy = true; applyCmdState\(S\);/.test(H)
         && /finally\{ uploadBusy = false; applyCmdState\(S\); \}/.test(H)
         && /\$\("#b_upload"\)\.disabled = !armed \|\| estop \|\| underWay \|\| uploadBusy;/.test(H)
         && H.indexOf("uploadBusy = true") < H.indexOf("await cornerSlowPlan("),
      "set before the first await, cleared in a finally, and the button reads it");

console.log("\n-- 22: and it hands the main thread back while it does all that --");
await (async () => {
  // a long zig-zag: more corners than CORNERS_PER_SLICE, in clear water so nothing is
  // flagged and the cost is the walk and the screen alone.
  const pts = [[0, 0], [0, 60]];
  let h = 0;
  for (let k = 0; k < 220; k++) {
    h += (k % 2 ? -100 : 100);
    const r = h * Math.PI / 180, p = pts[pts.length - 1];
    pts.push([p[0] + Math.sin(r) * 14, p[1] + Math.cos(r) * 14]);
  }
  const zig = pts.map(([e, n]) => ll(e, n));
  const CLEAR = { polys: [], lines: [], points: [], marks: [], sys: [], chans: [] };
  let ticks = 0, going = true;
  const beat = () => { ticks++; if (going) setTimeout(beat, 0); };
  setTimeout(beat, 0);
  await cornerSlowPlan(zig, F, CLEAR, 5, "survey", "low");
  going = false;
  check("22. the main thread is handed back DURING the measurement, not only at the end",
        () => ticks > 1,
        "a self-rescheduling timer fired " + ticks + " time(s) while " + (zig.length - 2)
          + " corners were measured; an async function that never yields scores exactly 1,"
          + " because the caller's own await is the only suspension point");
})();

console.log("\n-- 23-25: what the adversarial review found, each with its own check --");
await (async () => {
  // 23. THE WINDOW IS SIZED AT THE PLAN SPEED, IN BOTH PASSES. Sizing it from the speed
  // she happens to be doing gave a SLOWED corner a smaller window than the breach it was
  // meant to catch, so pass 2 called a corner answered that was not - demonstrated in
  // review at 4.06 m against a 3.843 m window. Measured here rather than grepped: the same
  // corner walked slow must still be CHARGED the fast corner's reach.
  const route = cornerRoute(30, 40, 165);
  const fast = flownTrack(route, F, () => kn("survey"), null, kn("survey"));
  const slowSized = flownTrack(route, F, () => kn("low"), null, kn("survey"));
  const slowUnsized = flownTrack(route, F, () => kn("low"), null);
  const CAP_M = kn("survey") * (180 / V.MAX_TURN_RATE_DEG_S) + 1;   // cornerReachM at the plan speed
  check("23. a slowed corner keeps the PLAN speed's window, not its own smaller one",
        // ⚠ THE CAP IS SHARED, THE REALIZED REACH IS NOT - a slower boat simply does not go
        // as far, so asserting the two reaches are EQUAL was wrong and this check said so on
        // its first run. What must hold is that the plan-speed cap charges strictly MORE of
        // the corner than the corner's own speed would, and that the cap reads capMs at all.
        () => slowSized.corner[CORNER_I].reach > slowUnsized.corner[CORNER_I].reach
           // both are bounded by the SHARED cap; they are not equal to each other, because a
           // slower walk steps finer (0.19 m against 0.39 m) and so samples nearer its edge.
           && slowSized.corner[CORNER_I].reach <= CAP_M && fast.corner[CORNER_I].reach <= CAP_M
           && /cornerReachM\(capMs \|\| twMs, t\.rate, t\.approachM\)/.test(SRC),
        "sized at the plan speed " + slowSized.corner[CORNER_I].reach.toFixed(2)
          + " m; sized at its own speed it would be only "
          + slowUnsized.corner[CORNER_I].reach.toFixed(2) + " m");

  // 24. THE SLOW COMMAND ARRIVES LATE. The page only learns the leg changed from a state
  // frame, and the server throttles those to one a second, so pass 2 may not fly the low
  // speed from the first tick of the leg. Crediting a slow-down she has not been told
  // about is an under-flag, which is the direction that costs the buffer.
  check("24. the command latency is the console's own state throttle, and pass 2 flies it",
        () => SPEED_CMD_LATENCY_S === 1.0
           && /const lateM = lowMs \* SPEED_CMD_LATENCY_S;/.test(SRC)
           // ⚠ "traveled", since the 2026-09-23 American-English sweep - the variable moved
           // with the prose. The property this pins is unchanged.
           // ... and `planMsAt(i)` since keyAt (2026-09-24): the leg's own commanded speed is what is withheld.
           && /\(traveled - legStart\) < lateM \? planMsAt\(i\) : lowMs/.test(SRC),
        "SPEED_CMD_LATENCY_S = " + SPEED_CMD_LATENCY_S + " s, withheld by distance traveled"
          + " into the leg rather than by tick count, so it holds at any speed");

  // 25. THE SET MAY NOT OUTLIVE THE ROUTE IT INDEXES. It is vertex numbers into ONE
  // uploaded route; against any other route those numbers name different water, and only
  // an Upload ever rebuilds it. Without the guard a set could survive a CLR PLAN or a plan
  // uploaded from another tab and slow the boat at waypoints nobody measured.
  check("25. the governor ignores the corner set unless it is THIS route's",
        () => /const sameRoute = cornerSlowFor >= 0 && \(S && S\.wp_total\) === cornerSlowFor;/.test(H)
           && /const atCorner = sameRoute && cornerSlow\.size > 0/.test(H)
           && /cornerSlowFor = plan\.route\.length;/.test(H),
        "keyed on the vessel's own wp_total, which is the cheapest thing the two agree on");

  // ⚠⚠ 25b. AND THE BANNER DESCRIBES THE PLAN IT MEASURED. The set is written PAST the
  // upload's reply, deliberately - a refused upload must not arm a set measured for a plan
  // the vessel never took - so the globals still hold the PREVIOUS plan while these banners
  // are built. Reading them here announced the last upload's corners: on the FIRST upload of
  // a session, nothing at all however many corners breach the buffer, and on every one after
  // it the wrong plan's waypoint numbers and speed key. Introduced by that same move.
  // ⚠ SOURCE-ANCHORED, AND THAT IS A REAL LIMIT. The banners are built into a string inside
  // doUpload, and the one suite that drives it uses the REAL cornerSlowPlan on two-point
  // fixtures where it returns an empty set - so there is no driven path to a non-empty banner
  // without new geometry. This pins WHICH VALUES the banner reads; it cannot prove what the
  // operator sees.
  // ⚠ AND NOTHING CAUGHT THE REGRESSION: this suite, pause_resume and command_result were
  // all green while the first upload banners nothing. pause_resume 1j asserts
  // `banners.length === 0` for an ordinary upload - it catches a banner APPEARING and is
  // blind to one going MISSING.
  check("25b. the upload's corner banners read the measurement just taken, not the globals "
        + "that still describe the previous plan",
        () => {
          const code = H.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
          const up = code.slice(code.indexOf("async function doUpload"),
                                code.indexOf("function stagedNote"));
          const reads = /const csUn = cs\.unanswered \|\| \[\], csSlow = cs\.slow \|\| \[\];/.test(up)
                     && /if\(csUn\.length\)/.test(up) && /else if\(csSlow\.length\)/.test(up)
                     && /\+ csKey \+ " the hull would round them/.test(up);
          // and the globals are NOT what the banner block reads any more
          const stale = /if\(cornerUnanswered\.length\)\s*\n?\s*showBanner/.test(up)
                     || /else if\(cornerSlow\.size\)\s*\n?\s*showBanner/.test(up);
          return reads && !stale;
        },
        "the set is written past the reply on purpose, so the globals describe the LAST plan "
          + "while these banners are built (source-anchored: see the note above)");
})();

// 26. THE SLOWED WALK IS SWEPT IN FULL, AND ITERATED. Pass 2 flies a different track and
// carries that difference into every leg after it, so it can put the hull somewhere the
// first walk never did. Re-testing only the vertices the first walk flagged - which is
// what it used to do - meant a breach the SLOW-DOWN ITSELF created could never be found.
// And such a vertex is not `unanswered`: slowing was never tried on it, so the set grows
// and the walk repeats. Observed on the real Honolulu route, where the sweep adds route
// vertex 379; no synthetic fixture reproduces it, so this pins the mechanism.
check("26. the slowed walk is re-tested over EVERY vertex, and re-taken when the set grows",
      () => /for\(let i = 1; i < route\.length - 1; i\+\+\)\{\s*\n\s*if\(!slow\.has\(i\) && breaches\(pass2, i\)\) added\.push\(i\);/.test(SRC)
         && /added\.forEach\(i => slow\.add\(i\)\);\s*\n\s*pass2 = walkSlowed\(\);/.test(SRC)
         && ITER_CAP > 1,
      "a new breach becomes a new corner to slow FOR, not a corner declared unanswerable; ITER_CAP = " + ITER_CAP);

console.log("\n-- 27: CHAINED corners, where a walk that loses its trim comes apart --");
// ⚠⚠ THIS IS THE FIXTURE CLASS 1-7 DID NOT HAVE, AND ITS ABSENCE HID A 3.9 m DEFECT.
// Checks 1-7 are ISOLATED corners: one turn, open legs, a clean 60 m run-in, nothing
// sharper than 165 degrees. Every one of them agreed to 0.000 m while the walk was
// throwing away the cross-track trim on each leg advance - because an isolated corner has
// no inherited error to lose. The defect only bites where the boat arrives at a corner
// ALREADY off her line, which needs a CHAIN of sharp corners on short legs, and it bites
// hardest at speed: measured against the vessel over 280 corners, the trim reset
// under-reported the hull by up to 3.935 m (8 m legs, 160 deg, high).
//
// ⚠ AND THE OLD JUSTIFICATION WAS A ROUND TRIP. The '0.000 m over four zig-zags' this
// file used to cite came from a probe that compared flownTrack WITH the reset against
// flownTrack WITHOUT it - the vessel was never in the comparison - and reduced each route
// to its single worst corner, which an early agreeing corner masks. A transform checked
// against itself passes for any mutually-inverse pair of wrongs.
const CHAINS = [
  { leg: 6,  defl: 160, key: "survey", vtx: 6, dev: 1.8084 },
  { leg: 6,  defl: 165, key: "high",   vtx: 4, dev: 4.0940 },
  { leg: 8,  defl: 160, key: "survey", vtx: 6, dev: 2.7580 },
  { leg: 8,  defl: 160, key: "high",   vtx: 6, dev: 5.7422 },
  { leg: 8,  defl: 165, key: "high",   vtx: 2, dev: 3.7363 },
  { leg: 12, defl: 160, key: "high",   vtx: 6, dev: 5.3058 },
  { leg: 12, defl: 165, key: "survey", vtx: 6, dev: 2.6496 },
];
function zigRoute(legM, defl, n, runIn) {
  const pts = [[0, 0], [0, runIn]]; let h = 0;
  for (let i = 0; i < n; i++) { h += (i % 2 ? -defl : defl);
    const r = h * Math.PI / 180, p = pts[pts.length - 1];
    pts.push([p[0] + Math.sin(r) * legM, p[1] + Math.cos(r) * legM]); }
  const r = h * Math.PI / 180, p = pts[pts.length - 1];
  pts.push([p[0] + Math.sin(r) * 80, p[1] + Math.cos(r) * 80]);
  return pts.map(([e, n]) => ll(e, n));
}
{
  let worst = 0, worstAt = null;
  for (const c of CHAINS) {
    const w = flownTrack(zigRoute(c.leg, c.defl, 6, 60), F, () => kn(c.key), null, kn(c.key));
    const got = w.corner[c.vtx] ? w.corner[c.vtx].dev : NaN;
    const gap = c.dev - got;                       // + = the walk UNDER-reports the hull
    if (!(gap <= worst)) { worst = gap; worstAt = c; }
  }
  check("27. a CHAIN of sharp corners tracks the vessel too, not just isolated ones",
        () => worst <= TOL_CHAIN_M,
        "worst UNDER-report over seven chains " + worst.toFixed(3) + " m"
          + (worstAt ? " (" + worstAt.leg + " m legs, " + worstAt.defl + " deg, "
                        + worstAt.key + ")" : "")
          + ";  with the trim reset the same seven read 3.166 m, and 3.935 m was the"
          + " worst over the full 280-corner sweep");
}

console.log("\n-- 28-30: a hull that slows IN GEAR, walked as she flies it (2026-10-03) --");
// ⚠ THE FIXTURES COME FROM THE VESSEL MODEL, AS 1-7 DO. A DriX corner flown through asv_console.py's own
// SimVcu.tick (its speed_step_kn), LOW commanded where the in-gear cut must begin, then the same route walked here.
// 300 m north at 7 kn, a corner of `defl` degrees, two legs at LOW: the speed at the leg advance past the corner and
// the hull's greatest departure inside the corner window, printed by the generator (scratch gen_ingear_fixture.py):
//                 with the lead                    without it (LOW only at the corner)
//      90 deg     4.183 kn  1.4765 m               7.000 kn   5.1151 m
//     120 deg     4.183 kn  4.1245 m               7.000 kn  10.6378 m
//     150 deg     4.183 kn  8.2900 m               7.000 kn  15.5020 m
await (async () => {
  const vSaved = V.VESSEL, kSaved = V.SPEED_KN, rSaved = V.MAX_TURN_RATE_DEG_S;
  const drix = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vessels", "drix08.json"), "utf8"));
  const KN = 0.514444;
  try {
    V.VESSEL = drix; V.SPEED_KN = { low: 4, survey: 7, high: 14 }; V.MAX_TURN_RATE_DEG_S = 20;
    const corner = (defl, runIn = 300) => { const h = defl * Math.PI / 180, P = [[0, 0], [0, runIn]];
      P.push([P[1][0] + 60 * Math.sin(h), P[1][1] + 60 * Math.cos(h)]);
      P.push([P[2][0] + 80 * Math.sin(h), P[2][1] + 80 * Math.cos(h)]);
      return P.map(([e, n]) => ll(e, n)); };
    const ms = (i) => (i === 1 ? 7 : 4) * KN;
    const SIM = [[90, 1.4765, 5.1151], [120, 4.1245, 10.6378], [150, 8.29, 15.502]];
    const rows = SIM.map(([defl, lead, none]) => {
      const r = corner(defl);
      const wl = flownTrack(r, F, ms, null, 7 * KN, ms), wn = flownTrack(r, F, ms, null, 7 * KN);
      return { defl, lead, none, gotL: wl.corner[1] ? wl.corner[1].dev : NaN, gotN: wn.corner[1] ? wn.corner[1].dev : NaN };
    });
    check("28. the walk takes her IN-GEAR law and the governor's LEAD, and agrees with SimVcu to " + TOL_M + " m at three "
          + "corners both ways - with the lead each corner flies 29-53% of the departure LOW commanded at the corner gives",
          () => rows.every((x) => Math.abs(x.gotL - x.lead) <= TOL_M && Math.abs(x.gotN - x.none) <= TOL_M
                                   && x.gotL < 0.6 * x.gotN),
          rows.map((x) => x.defl + " deg: " + x.gotL.toFixed(3) + " vs sim " + x.lead + " (no lead " + x.gotN.toFixed(3)
                          + " vs " + x.none + ")").join("; "));
    // 28b. A SLOWER LEG TWO LEGS AHEAD is led to from where the cut must begin, measured ALONG the route (the lead
    // counts the leg between), and after the slow legs she gains speed back on the engine's ramp, 1.5 kn/s.
    const KN2 = 0.514444, spd = (w, j) => Math.hypot(w.pts[j].e - w.pts[j - 1].e, w.pts[j].n - w.pts[j - 1].n) / TRACK_STEP_S / KN2;
    const r2 = [[0, 0], [0, 300], [0, 312], [0, 340], [0, 600]].map(([e, n]) => ll(e, n));     // UNEQUAL: 12 m then 28
    const ms2 = (i) => (i === 3 ? 4 : 7) * KN;
    const w2 = flownTrack(r2, F, ms2, null, 7 * KN, ms2);
    // measured where she CROSSES each vertex (the route runs due north) - the walk advances its leg one approach
    // radius early (6 m on the DriX), and the lead lands LOW at the vertex itself
    const nOf = (p) => p.n, cross = (n0) => { for (let j = 1; j < w2.pts.length; j++) if (nOf(w2.pts[j]) >= n0) return j; return -1; };
    const N = (m) => F.toEN(ll(0, m)).n;
    const at1 = spd(w2, cross(N(300))), at2 = spd(w2, cross(N(312))), j3 = cross(N(340));
    const up2 = spd(w2, j3 + 8);
    // where the law puts her at the vertex BEFORE the slow leg: the cut begins slowRun's water short of the slow leg
    // (312 m), so 300 m is 30.7 m into it - dead time 11.9 m, then 18.8 m of decay
    const CL = require("../static/js/coast.js"), lawD = CL.slowLaw(drix.maneuvering.slowdown);
    const x1 = CL.slowRun(7 * KN, 4 * KN, lawD).m - 12, dead = 7 * KN * lawD.lag;
    const want1 = x1 <= dead ? 7 : Math.sqrt(lawD.U ** 2 + ((7 * KN) ** 2 - lawD.U ** 2) * Math.exp(-2 * (x1 - dead) / lawD.Lg)) / KN;
    check("28b. a slower leg TWO legs ahead is led to ALONG the route (12 m and 28 m legs, so a wrong-leg sum shows) - at "
          + "the vertex before it she is where the law puts her 30.7 m into the cut, within a tick of LOW where it starts - "
          + "and after it she gains speed back on the engine's ramp (2 s: +3.0 kn)",
          () => Math.abs(at1 - want1) < 0.1 && at2 <= 4.05 && Math.abs(up2 - 7.0) < 0.01,      // 4.05: the cut starts within a tick
          "at the vertex before " + at1.toFixed(3) + " kn (the law: " + want1.toFixed(3) + "); at the slow leg " + at2.toFixed(3)
            + " kn; 2 s past it " + up2.toFixed(3) + " kn");
    // 28c. THE WALK'S LEAD LATCHES TOO. With a 4.5 kn leg between her and the LOW leg, the target of the leg she is on
    // drops to 4.5 on the way in, and the lead measured from it shrinks below the water left: unlatched it let go and
    // she met the LOW leg at 4.18 kn (found by mutation: 99 of 525 routes with a leg of another speed between moved,
    // by up to 3.07 m of corner).
    const rR = [[0, 0], [0, 300], [0, 320], [0, 345], [0, 600]].map(([e, n]) => ll(e, n));
    const msR = (i) => (i === 1 ? 7 : i === 2 ? 4.5 : 4) * KN;
    const wR = flownTrack(rR, F, msR, null, 7 * KN, msR);
    let atR = null, rises = 0;
    for (let j = 2; j < wR.pts.length; j++) {
      if (wR.pts[j].i < 2 && spd(wR, j) > spd(wR, j - 1) + 1e-9) rises++;
      if (atR === null && wR.pts[j].i >= 2) atR = spd(wR, j);
    }
    check("28c. ... and it LATCHES: with a 4.5 kn leg between her and the LOW leg (her own leg's target drops on the "
          + "way in, and the lead measured from it with it) she slows once, never gains way, and meets the LOW leg at LOW",
          () => rises === 0 && atR <= 4.0 + 1e-6,
          "speed-ups before the leg " + rises + "; at the LOW leg " + atR.toFixed(3) + " kn (unlatched: 4.184)");
    // 29. AND UPLOAD JUDGES A TURN AT THE SPEED THE LEAD DELIVERS. The 120 deg corner at the end of a 300 m survey line,
    // the legs after it keyed at the TURN role (LOW) as routeSpeedKeys keys a join, a wall 7.5 m past the corner across
    // the way she overshoots (BUF 5). With the lead she is at LOW when she rounds it (0.43 m past the vertex) and
    // nothing is flagged; walked in gear WITHOUT the lead she rounds it at 7 kn (5.15 m past) and the corner is flagged
    // to slow - a plan defect that was never there. With the wall at 3.5 m even LOW reaches it: named, as before.
    const r120 = corner(120), turnLow = (i) => (i === 1 ? "survey" : "low");
    const near = await cornerSlowPlan(r120, F, boxKo(-40, 307.5, 40, 347.5), 5, "survey", "low", undefined, turnLow);
    const close = await cornerSlowPlan(r120, F, boxKo(-40, 303.5, 40, 343.5), 5, "survey", "low", undefined, turnLow);
    check("29. Upload on the DriX's hull judges a turn at the speed the LEAD delivers - nothing flagged where she comes "
          + "down on the line before it - and still names a corner that breaches even at LOW",
          () => near.slow.length === 0 && near.unanswered.length === 0 && close.unanswered.includes(1),
          "wall 7.5 m out: slow=[" + near.slow + "] unanswered=[" + near.unanswered + "]; 3.5 m out: slow=["
            + close.slow + "] unanswered=[" + close.unanswered + "]");
    // 29c. AND UPLOAD'S IN-GEAR SECOND PASS, BY ITS VERDICTS (review: it was pinned only by a source regex). Every leg
    // keyed survey, so pass 1 flags the corner and pass 2 decides. After a 300 m line, slowing answers it (the lead
    // brings her down on the line); 20 m into the route she cannot shed 7 kn in gear and it is named - and with the wall
    // a meter and a half further out the same corner is answered. A walk that never slowed, or slowed everything, or
    // dropped the leg out of the corner, reads differently on one of the three.
    const corner2 = (legs, defl = 120) => { const Pp = [[0, 0]]; let nn = 0; for (const Lg of legs) { nn += Lg; Pp.push([0, nn]); }
      const h = defl * Math.PI / 180, ci = Pp.length - 1;
      Pp.push([Pp[ci][0] + 60 * Math.sin(h), Pp[ci][1] + 60 * Math.cos(h)]); Pp.push([Pp[ci + 1][0] + 80 * Math.sin(h), Pp[ci + 1][1] + 80 * Math.cos(h)]);
      return { r: Pp.map(([e, n]) => ll(e, n)), ci, cN: nn }; };
    const allSurvey = () => "survey";
    const cA = corner2([300]), cC = corner2([8, 12]);
    const vA = await cornerSlowPlan(cA.r, F, boxKo(-40, cA.cN + 7.5, 40, cA.cN + 47.5), 5, "survey", "low", undefined, allSurvey);
    const vC = await cornerSlowPlan(cC.r, F, boxKo(-40, cC.cN + 7.5, 40, cC.cN + 47.5), 5, "survey", "low", undefined, allSurvey);
    const vC9 = await cornerSlowPlan(cC.r, F, boxKo(-40, cC.cN + 9, 40, cC.cN + 49), 5, "survey", "low", undefined, allSurvey);
    check("29c. Upload's in-gear SECOND pass: a corner after a 300 m line is answered by slowing; the same corner 20 m "
          + "into the route, where 7 kn cannot be shed in gear, is named EVEN AT THE LOW SPEED; and with 1.5 m more water "
          + "it is answered",
          () => vA.slow.includes(cA.ci) && !vA.unanswered.length && vC.unanswered.includes(cC.ci) && !vC.slow.includes(cC.ci)
                && vC9.slow.includes(cC.ci) && !vC9.unanswered.length,
          "300 m line: slow=[" + vA.slow + "] un=[" + vA.unanswered + "]; 20 m in: slow=[" + vC.slow + "] un=["
            + vC.unanswered + "]; 20 m in, wall 9 m: slow=[" + vC9.slow + "] un=[" + vC9.unanswered + "]");
    // 29b. THE PUNCH'S JUDGE FLIES IT TOO: joinBreaches hands its `legMs` to the walk, so the join Punch Out judges is
    // the one Upload walks. The same corner and wall, the join legs at LOW: no breach with the targets, a breach without.
    const jMs = (i) => (i === 1 ? 7 : 4) * KN, wall = boxKo(-40, 307.5, 40, 347.5);
    const { joinBreaches } = require("../static/js/turns.js");
    const jLed = joinBreaches(r120, F, wall, 5, jMs, null, 7 * KN, jMs), jNot = joinBreaches(r120, F, wall, 5, jMs, null, 7 * KN);
    check("29b. ... and so does the PUNCH's judge: joinBreaches passes the join's targets to the walk - the corner clears "
          + "with them and breaches without",
          () => jLed.length === 0 && jNot.includes(1),
          "with targets [" + jLed + "]; without [" + jNot + "]");
    // 30. A SLOWED ARC IS WALKED SLOWED. A 180 deg arc of 3 m legs after a 100 m line, every arc leg at LOW, as
    // cornerSlowPlan's second pass flies a flagged turn. The old per-leg withholding put the plan speed back at the
    // start of every leg, and in gear each rise ended the cut and restarted the dead time: 7.00 kn round the arc.
    const R0 = 12, P = [[0, 0], [0, 100]], nSeg = Math.ceil(Math.PI * R0 / 3);
    for (let k = 1; k <= nSeg; k++) { const a = Math.PI * k / nSeg; P.push([R0 - R0 * Math.cos(a), 100 + R0 * Math.sin(a)]); }
    P.push([2 * R0, 20]);
    const arc = P.map(([e, n]) => ll(e, n));
    const lowA = (i) => (i >= 2 && i <= nSeg + 1) ? 4 * KN : 7 * KN;
    const apexKn = (w) => { let best = 1; for (let j = 1; j < w.pts.length; j++) if (w.pts[j].n > w.pts[best].n) best = j;
      const a = w.pts[best - 1], b = w.pts[best]; return Math.hypot(b.e - a.e, b.n - a.n) / TRACK_STEP_S / KN; };
    const lateM = 4 * KN * SPEED_CMD_LATENCY_S;
    let legStart = 0, lastK = -1;
    const perLeg = (i, traveled) => { if (i !== lastK) { lastK = i; legStart = traveled; }
      return (lowA(i) < 7 * KN && traveled - legStart >= lateM) ? 4 * KN : 7 * KN; };
    const led = apexKn(flownTrack(arc, F, lowA, null, 7 * KN, lowA)), old = apexKn(flownTrack(arc, F, perLeg, null, 7 * KN));
    check("30. a slowed ARC is walked slowed - LOW at the apex - where the old per-leg withholding, in gear, never slowed "
          + "her at all; and cornerSlowPlan's in-gear pass hands the walk its slowed targets with the lead",
          () => led <= 4.05 && old > 6.5 && /if\(law\) return flownTrack\(route, ref, slowMsAt, fly, planMs, slowMsAt\);/.test(SRC),
          "apex " + led.toFixed(2) + " kn with the lead; " + old.toFixed(2) + " kn withheld per leg");
  } finally {
    V.VESSEL = vSaved; V.SPEED_KN = kSaved; V.MAX_TURN_RATE_DEG_S = rSaved;
  }
})();

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
})();
