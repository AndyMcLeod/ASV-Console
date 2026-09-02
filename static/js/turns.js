// static/js/turns.js - THE SHAPE OF A REVERSAL, in this console's language.
//
// Line-to-line turn geometry: the semicircle and the teardrop, the arc sampler under
// both, the radius floor they are built at, and the end-shortening that leaves room for
// them. No DOM, no fetch, no mission state - a geometry question in, a waypoint list out.
//
// ── THE BODIES MOVED TO asv_core ON 2026-08-20, AND THIS FILE IS THE SEAM ───────────
//
// They came out of asv.html the day before, which was the whole prerequisite: WorldView
// has had the same four shapes as clean exports in `mission.js` since it was ported FROM
// this page, and for three sessions the handoff recorded that nothing could be compared
// until ours came out of the script block. Measured the moment it could be, this file
// against `core_turns.js`, handed this console's flat frame, its flat metric, arcStepM 3
// and maxHalfM 60:
//
//     teardropTurn   0.000e+0 m over 3,240 cases, R and outboard exact, 0 shape or
//                    point-count mismatches - with all five outcomes exercised:
//                    954 semicircle, 201 teardrop, 1,080 degenerate, 441 skew, 564 nogo
//     arcPts         0.000e+0 m over 4,000, point counts identical
//     shortenSeg     0.000e+0 m over 6,000
//     minTurnRadiusM 7.105e-15 m - ONE ULP, from (rate*PI)/180 there against
//                    rate*(PI/180) here. Stated rather than rounded down to zero.
//
// ALL FOUR ARE WRAPPED RATHER THAN RE-EXPORTED, AND THAT IS A COST, STATED. minTurnRadiusM
// reads V.SPEED_KN and V.MAX_TURN_RATE_DEG_S where the core takes plain numbers;
// teardropTurn takes (ref, ko, buf) where the core takes a frame and an injected `clear`;
// arcPts and shortenSeg pin this console's arc step and its FLAT metric. Wrapping keeps
// every call site in asv.html and in the five suites exactly as it was, at the price of
// one closure per call. Same trade as chart.js.
//
// ⚠ THE METRIC IS PASSED, NOT TAKEN FROM THE FRAME, AND THAT IS LOAD-BEARING.
// Every other shared body in this estate reads `frame.distTo`, deliberately, because the
// two consoles do not mean the same quantity by it. shortenSeg must NOT: planeFrame's
// distTo is `trueDistTo` since Andy's "standardize" ruling, while line shortening has
// always used the module-level FLAT distTo, in the same flat plane the line is drawn in.
// A core that read frame.distTo would move every survey line end by up to 1.113 m -
// measured - and put the drawn length 0.131 % from the trimmed one. So it is an argument,
// where the choice is visible.
//
// ⚠ AND THE MERGE FOUND A DEFECT. teardropTurn's reversal-pair guard was a bare 60 m
// here: a hull-scale assumption, written when the boat was 4 m long. A 7.7 m USV at 122 m
// line spacing - ordinary deep-water multibeam spacing - got NO TURN AT ALL, and the
// banner told the operator the loop "would enter a keep-out ... it needs 61.0 m of radius
// there and has 14.4 m". Both halves false: nothing was blocked, and a 61 m semicircle is
// well inside what a boat with a 14.4 m minimum can hold. The advisory alongside it said
// WIDEN THE LINES, which makes it strictly worse. It is `maxHalfM` now, and punchOut
// passes Math.max(MAX_HALF_M, spacing * 1.6) - the same 1.6 its own reversal gate uses -
// so the judgement is made once instead of twice at two different scales. A caller that
// passes nothing still gets 60, which is what the suites do and why they did not move.
//
// WHAT DID NOT COME, AND THE AUDIT'S "shared symbol" ROW IS STILL MISLEADING ABOUT IT.
// `punchOut` is not one function in two repos: WorldView's punchOut(pattern, opts) is a
// pure mission assembler with injected seams; this console's punchOut() takes no arguments
// at all and is the BUTTON HANDLER - it reads currentPattern(), writes #sp_hint, toggles
// #sp_punch, flips encShow, calls render() and showBanner(). One is UI and the other is
// algorithm. What corresponds to WorldView's is the ASSEMBLY INSIDE the handler, and
// separating those is its own job with its own decisions.
import { distTo } from "./geodesy.js";
import { legClear } from "./chart.js";
import { V } from "./state.js";
// THE SHARED TURN GEOMETRY. Four bodies, four wrappers below; the constants pass straight
// through because both consoles already agreed on every one of them.
import { TRACKING_MARGIN, ANTI_PARALLEL_DEG, SKEW_LIMIT_DEG, MAX_HALF_M, arcStepFor,
         minTurnRadiusM as coreMinTurnRadiusM, shortenSeg as coreShortenSeg,
         arcPts as coreArcPts, teardropTurn as coreTeardropTurn, racetrackTurn as coreRacetrackTurn} from "./core_turns.js";
export { TRACKING_MARGIN, ANTI_PARALLEL_DEG, SKEW_LIMIT_DEG, MAX_HALF_M, arcStepFor };

// THIS CONSOLE'S ARC STEP, PINNED. The core scales the step with the radius (arcStepFor:
// 3 m at a 2 m radius, 12.5 m at 250 m) so a survey ship's turn does not emit 260
// waypoints to hold a 4 mm sagitta. The two are the SAME NUMBER below R = 60 m, which is
// every radius this console's semicircle branch can produce and every one its vessels'
// minimum radii reach - so pinning 3 costs nothing today and keeps the merge at
// 0.000e+0. Adopting the scaling is a separate decision with its own measurement.
export const ARC_STEP_M = 3;

// Shorten a survey segment by `m` metres at BOTH ends (settle on-line + leave room for
// the turn). Leaves it untouched if that would make it too short. THE FLAT METRIC - see
// the header; this is the one place in the estate where the frame's is the wrong answer.
export function shortenSeg(a, b, m){ return coreShortenSeg(a, b, m, distTo); }

// Boat minimum turn radius (m) it can actually HOLD at a given speed, with a margin for
// line-following overshoot. Vessel-derived; V.SPEED_KN and V.MAX_TURN_RATE_DEG_S are
// populated by loadVessel() from /api/vessel (single source of truth = the active vessel
// file). The `|| 3.0` is only a fallback if that fetch fails before first paint.
export function minTurnRadiusM(speedKey){
  return coreMinTurnRadiusM(V.SPEED_KN[speedKey] || 3.0, V.MAX_TURN_RATE_DEG_S);
}

// Interior points of a circular arc, EXCLUDING both endpoints, at this console's 3 m
// spacing. `map(x,y)` takes frame coords to lat/lon.
export function arcPts(C, R, a0, sweep, minSeg, map){
  return coreArcPts(C, R, a0, sweep, minSeg, map, ARC_STEP_M);
}

// Line-to-line reversal turn: semicircle where half the line offset already clears the
// radius the boat can hold, teardrop at the boat's own minimum radius where it does not.
// Returns {pts, kind, R, outboard} with `pts` EXCLUDING E and F, or {why, seg?}.
//
// `maxHalfM` is OPTIONAL and defaults to the core's 60 - see the header. A caller that
// knows its line spacing should pass Math.max(MAX_HALF_M, spacing * 1.6); punchOut does.
export function teardropTurn(E, F, hE, hF, ref, ko, buf, minR, maxHalfM, side){
  return coreTeardropTurn(E, F, hE, hF, ref, {
    minR,
    // `seg` on refusal = the failing chord, so the caller can ask blockedInfo/
    // firstBlockAlong WHAT blocked it and name it (a "keep-out" the operator is staring
    // at can be open-looking water - a navigation channel).
    clear: (a, b) => legClear(a, b, ref, ko, buf),
    arcStepM: ARC_STEP_M,
    maxHalfM,
    side,          // 'inboard' sweeps a semicircle the other way; see turnWithRetry
  });
}

/** The racetrack reversal - see core_turns.js. Same call shape as `teardropTurn`, minus
 *  `side`: there is NO inboard variant and that is geometric, not an omission. The shape
 *  reaches exactly `minR` past the end of the line and no further; mirroring it would mean
 *  turning BACK before crossing, which from a standing exit heading is a bigger turn than
 *  the loop it replaces. When even `minR` of outboard water is foul, the inboard
 *  semicircle below is the rung that answers. */
export function racetrackTurn(E, F, hE, hF, ref, ko, buf, minR, maxHalfM){
  return coreRacetrackTurn(E, F, hE, hF, ref, {
    minR,
    clear: (a, b) => legClear(a, b, ref, ko, buf),
    arcStepM: ARC_STEP_M,
    maxHalfM,
  });
}

// THE TURN LADDER - what to try when the obvious turn is refused, and why it exists.
// Andy, 2026-08-31, after a DriX passed a wharf in Pago Pago at 0.6 m:
//
//   "During this sort of maneuver and when extreme close range is an issue, the turn
//    should be AWAY from the shoreline or dock or other feature rather than through it.
//    Speed MAY be modified temporarily to slow and reduce impact damage if a turn will
//    not resolve."
//
// ⚠ THE FAILURE THIS CLOSES IS NOT THAT THE TURN WAS UNSAFE - IT IS THAT THERE WAS NO
// TURN. Measured off the recorded track: at the WEST end of that block the console
// generated a 26-waypoint teardrop; at the EAST end, beside the pier, it generated 4 -
// the two line ends and nothing in between. teardropTurn had refused, and punchOut's
// fallback for a refused reversal is a STRAIGHT leg between those ends, which legClear
// passes because the straight line genuinely is clear. What ships is a 180 in ~26 m that
// the hull cannot track; the boat then loops on its own, uncommanded, OUTBOARD - into
// the very feature that refused the turn. The plan cleared the pier by 14.3 m; the boat
// passed it at 0.6 m.
//
// So refusing the turn is what put the boat on the pier: it removed the only geometry
// that was steering the boat away from it. This ladder does not give up while a shape
// remains, and each rung is one of the two things Andy named:
//
//   1. OUTBOARD at the plan speed - the normal turn, past the end of the line just run.
//   2. INBOARD  at the plan speed - the SAME semicircle swept the other way round the
//      E-F chord, back over water the plan has just surveyed and therefore knows is
//      clear. This is "turn AWAY from the dock", exactly.
//   3+4. Both sides again at the SLOW-SPEED radius - a tighter loop reaches less far
//      outboard, so water that refuses the turn at survey speed may not refuse it at
//      low. The caller is told (`slow`) and commands that speed for the turn.
//
// Only when every rung is refused is there genuinely no turn - and that is the case the
// caller must flag UNSAFE rather than ship, because it is the one where the boat
// improvises a loop of its own and nothing has said where.
export function turnWithRetry(E, F, hE, hF, ref, ko, buf, minR, maxHalfM, minRSlow){
  // ⚠ THE RACETRACK RUNGS SIT ABOVE THE INBOARD ONE, AND THAT ORDER IS THE FIX Andy
  // ASKED FOR (2026-09-01): *"the turns are implemented as inverted teardrop turns.
  // Consider a more direct, curvilinear format for this implementation."* What he was
  // looking at was rung 2 of the old ladder - an INBOARD semicircle, sweeping back across
  // 33 m of just-surveyed water, because the outboard sweep of a 15.75 m arc had been
  // refused. The hull's own radius at survey speed is 2.06 m. So before giving up on
  // outboard water and turning back over the survey, ask for the turn the boat can
  // actually fly: the racetrack needs `minR` of outboard room instead of half the line
  // spacing - 2.06 m instead of 15.75 m on that plan - and is 32% shorter.
  //
  // Rung 1 is untouched on purpose. A lazy half-circle is gentler on a towed body and on
  // the survey, it is what every un-obstructed turn in every existing plan already flies,
  // and nobody has reported a problem with those. This ladder only changes what happens
  // AFTER the gentle turn is refused.
  const tries = [{side: undefined, minR, slow: false, shape: 'arc'},
                 {side: undefined, minR, slow: false, shape: 'racetrack'}];
  // ⚠ A SLOWER ATTEMPT ONLY RESHAPES A TEARDROP, AND THE TEST IS WHAT ESTABLISHED THAT.
  // teardropTurn takes the SEMICIRCLE branch when half the line offset already clears the
  // radius the hull can hold, and that semicircle's radius is `half` -- fixed by the line
  // spacing, not by the speed. Slowing changes nothing about its shape, so on a
  // wide-spaced plan (the Pago Pago geometry: half 13 m, minR 10 m) rungs 3 and 4 fly the
  // IDENTICAL arc to rungs 1 and 2 and refuse for the identical reason. They are still
  // worth having -- below 2*minR every reversal is a teardrop, which is where the tight
  // plans and the tight water both are -- but "slow down and it will fit" is NOT true in
  // general, and an advisory that says so on a semicircle plan would be wrong. Widening
  // the spacing is the lever there; the run-time guard's slow-down is what reduces the
  // energy of a contact either way.
  //
  // The guard below is necessary but not sufficient, and that is deliberate: skipping the
  // rungs when they cannot differ would need this function to re-derive teardropTurn's
  // branch condition, and two copies of that rule is how they drift apart.
  // A tighter racetrack reaches less far outboard still, so it is worth asking before
  // the run gives up on outboard water altogether.
  if(minRSlow > 0 && minRSlow < minR)
    tries.push({side: undefined, minR: minRSlow, slow: true, shape: 'racetrack'});
  // Only now, with every outboard shape refused, turn back over the survey. This is the
  // rung the wharf incident bought and it stays - "turn AWAY from the dock" - but it is
  // no longer the FIRST thing tried once the gentle arc is gone.
  tries.push({side: 'inboard', minR, slow: false, shape: 'arc'});
  if(minRSlow > 0 && minRSlow < minR)
    tries.push({side: 'inboard', minR: minRSlow, slow: true, shape: 'arc'});
  let first = null;
  for(let i = 0; i < tries.length; i++){
    const t = tries[i];
    const r = t.shape === 'racetrack'
      ? racetrackTurn(E, F, hE, hF, ref, ko, buf, t.minR, maxHalfM)
      : teardropTurn(E, F, hE, hF, ref, ko, buf, t.minR, maxHalfM, t.side);
    if(r.pts) return {...r, slow: t.slow, rung: i + 1};
    // THE FIRST REFUSAL IS THE ONE WORTH REPORTING, not the last: rung 1 is the turn the
    // operator expected to see, and its `seg` names the feature that actually refused it.
    // Reporting rung 4's refusal would name whatever blocked a tighter inboard loop, which
    // is not the answer to "why is there no turn at the end of line 12".
    if(!first) first = r;
  }
  return {...first, rung: tries.length};
}
