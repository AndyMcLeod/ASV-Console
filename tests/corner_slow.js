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
// TEETH - twenty-four mutations RUN against a sidecar copy that is restored in a
// `finally` and confirmed with `git diff` at the end of the run. These are what the runs
// printed, not what was predicted of them - four predictions were wrong (10, 17, 22, 23):
//
//   the leg advance taken on the POST-step position (the real defect)  -> 1, 5, 8
//   steers straight at the waypoint, no look-ahead (projectRoute's law) -> 9
//   the cross-track integral dropped                                   -> 9
//   the trim RESET on a leg advance again (the vessel does not)        -> 17
//   the throttle changes instantly, no ramp                            -> 10
//   the corner window is the whole leg again (reach unbounded)         -> 11, 14, 15
//   the window sized at the walk's own speed instead of the plan's     -> 23
//   the slow command arrives instantly (no link latency)               -> 24
//   the screen rejects everything (no corner tested exactly)           -> 11, 13, 14
//   the exact test uses no buffer at all                               -> 11, 13, 14
//   the second pass skipped: every flag reported as solved by slowing  -> 13
//   the walk steps at the guard's 0.5 s, not the vessel's tick         -> 1, 2
//   a corner charged to the vertex ahead only, not the one just passed -> 1, 2, 3, 4, 5, 6,
//                                                                         10, 11, 13, 14
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
// ⚠ ONE SURVIVED AND IT IS INERT BY DESIGN, not a gap: making the screen PASS everything
// (no screening at all). The screen only skips model calls that cannot change the answer,
// so removing it gives identical verdicts more slowly. A mutation in the SAFE direction
// that changed a verdict would be the defect; this one changing nothing is the property
// holding. The opposite mutation - the screen REJECTING everything - is the dangerous one
// and three checks kill it.
//
// ⚠ AND THE LIMIT OF CHECK 18 IS STATED RATHER THAN PRETENDED AWAY. 18 pins the Upload
// call by SOURCE TEXT, because this suite cannot run doUpload. A mutation that keeps the
// text and discards the result at RUNTIME - `const raw = ({slow:[]}) || await ...` - walks
// straight past it, and did. The realistic regressions are caught (the call deleted, the
// result discarded, the boat not prepended, all above); a contrived one is not, and no
// source check could catch it. That is what tests/pause_resume.js's driven doUpload is
// for, and it is the reason this suite was not given the job.
//
// ⚠⚠ AND FIVE DEFECTS CAME FROM AN ADVERSARIAL REVIEW, NOT FROM THESE CHECKS - four of
// them under-flagging, which is the direction that costs the buffer. They are checks 17,
// 18's boat clause, 23, 24 and 25, and each says in its own comment what was wrong. The
// worst was 17: the walk reset the cross-track trim on a leg advance and cited a line of
// asv_console.py that is in `amend_plan`, not in the tick. Measurement could not have
// found it - the behaviour moves 0.000 m in calm water - only reading the vessel could.
// Against the real Honolulu route none of the five under-flagged anything: a brute-force
// oracle that tests EVERY flown step with no window and no screen finds exactly the same
// twelve vertices this returns. They were all demonstrated on constructed geometry, which
// is what an adversarial reading is for.
//
// ⚠ FOUR FIXTURES WERE WRONG BEFORE THE CODE WAS, AND SAY SO. Check 10 asserted a 2 m
// run-in could not deliver the low speed from survey; that ramp is 1.0 s, about 1.5 m, so
// it can. Checks 11-14's keep-out was hand-rolled as {w,e,s,n} where the real box is
// bbOf's {x0,y0,x1,y1}, so `inBB` rejected every point and the fixture tested nothing
// while printing FAIL. Check 23 first asserted a slowed corner's realized reach EQUALS the
// fast one's; the cap is shared but a slower walk steps finer and samples nearer its edge.
// And an attempt to buy back main-thread cost by stepping the exact test at legClear's
// rate lost route vertex 332's detection outright.
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

function devAt(route, key, i) {
  const w = flownTrack(route, F, () => kn(key), null);
  return w.corner[i] ? w.corner[i].dev : 0;
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
      () => /const distB = Math\.hypot\(tgt\.e - e, tgt\.n - n\);/.test(SRC)
         && /if\(along >= segLen - t\.approachM \|\| distB <= t\.approachM\)/.test(SRC),
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
}

console.log("\n-- 15-16: the corner window, and what it is for --");
// 15. A corner's window is the corner. Charging a whole leg to the vertex it ends at put
// `reach` at 600 m on a coverage line, so the screen could never reject and the exact test
// walked every step of the plan: 16 s over 415 waypoints against 0.4 s.
{
  const route = cornerRoute(30, 400, 90);          // a 400 m run-out
  const w = flownTrack(route, F, () => kn("survey"), null);
  const cap = kn("survey") * (180 / 60) + 1;       // cornerReachM for this hull/speed
  check("15. the corner's window is the CORNER: reach is bounded by the half-turn distance",
        () => w.corner[CORNER_I].reach <= cap + 1e-6 && w.corner[CORNER_I].reach > 1,
        "reach " + w.corner[CORNER_I].reach.toFixed(2) + " m against a "
          + cap.toFixed(2) + " m cap, on a 400 m run-out");
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
const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");
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
check("19. speedGovernor flies a flagged corner at the low speed, both legs of it",
      () => /cornerSlow\.has\(wi\) \|\| cornerSlow\.has\(wi - 1\)/.test(H)
         && /\(\(role === "turn" && gap >= 0 && turnSlowAt\[gap\]\) \|\| atCorner\)/.test(H),
      "the junction rule sits beside the generated-turn one, not instead of it");
// 20. A STALE SET IS WORSE THAN NONE: its indices point into a route that is no longer
// being flown, so the boat would be slowed at the wrong waypoint. The degraded
// (no-chart) upload path must clear it rather than leave the last plan's corners armed.
check("20. the unrouted upload path clears the set rather than leaving a stale one armed",
      () => /cornerSlow = new Set\(\); cornerUnanswered = \[\]; cornerSlowFor = -1;/.test(H)
         && H.indexOf("cornerSlow = new Set(); cornerUnanswered = []; cornerSlowFor = -1;")
            < H.indexOf("cornerSlowPlan(walkRoute"),
      "the degraded branch drops it before the routed branch could set it");

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
           && /\(travelled - legStart\) < lateM \? planMs : lowMs/.test(SRC),
        "SPEED_CMD_LATENCY_S = " + SPEED_CMD_LATENCY_S + " s, withheld by distance travelled"
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
})();

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
})();
