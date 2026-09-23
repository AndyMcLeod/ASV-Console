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
// so the judgment is made once instead of twice at two different scales. A caller that
// passes nothing still gets 60, which is what the suites do and why they did not move.
//
// WHAT DID NOT COME, AND THE AUDIT'S "shared symbol" ROW IS STILL MISLEADING ABOUT IT.
// `punchOut` is not one function in two repos: WorldView's punchOut(pattern, opts) is a
// pure mission assembler with injected seams; this console's punchOut() takes no arguments
// at all and is the BUTTON HANDLER - it reads currentPattern(), writes #sp_hint, toggles
// #sp_punch, flips encShow, calls render() and showBanner(). One is UI and the other is
// algorithm. What corresponds to WorldView's is the ASSEMBLY INSIDE the handler, and
// separating those is its own job with its own decisions.
import { azTo, distTo } from "./geodesy.js";
import { blocked, legClear } from "./chart.js";
import { V } from "./state.js";
// THE RUNTIME GUARD'S OWN PROJECTION, borrowed at PLAN time - see turnFlyable.
import { projectRoute } from "./guard.js";
// THE SHARED TURN GEOMETRY. Four bodies, four wrappers below; the constants pass straight
// through because both consoles already agreed on every one of them.
import { TRACKING_MARGIN, ANTI_PARALLEL_DEG, SKEW_LIMIT_DEG, MAX_HALF_M, SPIRAL_MIN_LS_M,
         arcStepFor,
         minTurnRadiusM as coreMinTurnRadiusM, shortenSeg as coreShortenSeg,
         arcPts as coreArcPts, teardropTurn as coreTeardropTurn, racetrackTurn as coreRacetrackTurn,
         spiralTurn as coreSpiralTurn } from "./core_turns.js";
export { TRACKING_MARGIN, ANTI_PARALLEL_DEG, SKEW_LIMIT_DEG, MAX_HALF_M, SPIRAL_MIN_LS_M, arcStepFor };

// THIS CONSOLE'S ARC STEP, PINNED. The core scales the step with the radius (arcStepFor:
// 3 m at a 2 m radius, 12.5 m at 250 m) so a survey ship's turn does not emit 260
// waypoints to hold a 4 mm sagitta. The two are the SAME NUMBER below R = 60 m, which is
// every radius this console's semicircle branch can produce and every one its vessels'
// minimum radii reach - so pinning 3 costs nothing today and keeps the merge at
// 0.000e+0. Adopting the scaling is a separate decision with its own measurement.
export const ARC_STEP_M = 3;

// Shorten a survey segment by `m` meters at BOTH ends (settle on-line + leave room for
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
    // ⚠ 'inboard' SWEEPS THE SEMICIRCLE THE OTHER WAY ROUND A CENTER THAT DOES NOT MOVE,
    // AND THAT IS NOT A MIRRORED TURN - IT IS THE ARC FOR THE OPPOSITE TRANSITION
    // (established 2026-09-19, see turnJoinable). The center stays midway between the two
    // lines, so reversing the sweep keeps both endpoints and reverses BOTH tangents: the
    // shape enters on hF and leaves on hE, i.e. the boat is asked to reverse at the line
    // end, fly the arc backwards, and reverse again onto the next line. To sweep the other
    // way AND stay tangent, the center has to move to the far side of the line - and a
    // semicircle from there ends 2R on the wrong side of the next line, not on it. That is
    // the same geometric fact racetrackTurn's header states for its own shape below: there
    // is no inboard variant of a tangent reversal, and it is not an omission.
    //
    // The option is kept, and the ladder's join gate refuses what it returns, because it
    // is the only specimen of a non-joining shape the suites have to test that gate with.
    // ⚠ DO NOT "FIX" THIS BY MIRRORING THE SHAPE. Reversing the point order was measured
    // and is worse (10 bad joints on bak5 become 12); the shape is not reversed, it is the
    // wrong shape.
    side,
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

/** The EASED reversal - clothoid, arc, clothoid - see core_turns.js. `Ls` is the spiral
 *  length: a VESSEL property (how long the steering takes to reach the commanded rate)
 *  times the speed the turn is flown at. Zero or absent means the operator has not asked
 *  for easing, and the shape DECLINES rather than quietly degenerating into the plain
 *  semicircle the caller already has - two shapes that cannot be told apart is how a
 *  readout starts counting one of them as the other. */
export function spiralTurn(E, F, hE, hF, ref, ko, buf, minR, maxHalfM, Ls){
  return coreSpiralTurn(E, F, hE, hF, ref, {
    minR, Ls,
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
//   2. INBOARD  at the plan speed - INTENDED as the same semicircle swept the other way
//      round the E-F chord, back over water the plan has just surveyed and therefore knows
//      is clear: "turn AWAY from the dock". ⚠ IT IS NOT THAT SHAPE AND NEVER WAS - see
//      turnJoinable, which refuses every one of them. The rung is kept so the ladder still
//      ASKS, and so the suites have a non-joining shape to test the gate with; what
//      actually answers Andy's "turn away" are rungs 3 and 4, which reach `minR` and
//      `minRSlow` past the line end instead of half the line spacing.
//   3+4. Both sides again at the SLOW-SPEED radius - a tighter loop reaches less far
//      outboard, so water that refuses the turn at survey speed may not refuse it at
//      low. The caller is told (`slow`) and commands that speed for the turn.
//
// Only when every rung is refused is there genuinely no turn - and that is the case the
// caller must flag UNSAFE rather than ship, because it is the one where the boat
// improvises a loop of its own and nothing has said where.
// ⚠ AND SINCE 2026-09-19 THAT CASE IS COMMONER, ON PURPOSE. The inboard rungs used to
// answer it with a shape the hull cannot join (4 of 17 reversals in Andy's own bak5, 4 of
// 62 at Honolulu), so pairs that used to ship a cusped turn now go RED instead. That is
// the intended trade and it is only safe because `035878f1` made a refused reversal a
// visible plan defect: punchOut flags it UNSAFE, the card says so, and Add to plan refuses
// the pattern until the operator moves the line ends, strikes a run or widens the spacing.
// ⚠ EASING IS AN EXTRA RUNG AT THE TOP, NEVER A REPLACEMENT (2026-09-08). `easeLs > 0`
// puts the clothoid-arc-clothoid ahead of the plain arc; everything below it is untouched,
// so a plan whose water will not take the eased shape gets EXACTLY the turn it would have
// got with easing switched off. That is the same guarantee the lead give-way ladder has,
// and for the same reason: a comfort feature must not be able to cost a plan its turn.
// The eased shape refuses more often than the plain arc does - it needs a little more
// outboard water and a slightly tighter radius - so the fallback is not theoretical.
/**
 * NO TWO WAYPOINTS CLOSER THAN THE APPROACH RADIUS THAT CONSUMES THEM.
 *
 * ⚠ A ROUTE SAMPLED FINER THAN THE APPROACH RADIUS IS NOT A FINER ROUTE, IT IS A WORSE
 * ONE - and this is measured, not argued. Both the vessel and the guard's projection
 * advance to the next waypoint the moment they are within the approach radius of it, so a
 * cluster of vertices 0.20 m apart is consumed in a single integration step and the boat is
 * left steering at whatever lies a dozen vertices further round. It flies a CHORD across
 * the inside of its own turn.
 *
 * On Andy's plan, 2026-09-10, the same reversal walked through the guard's own integrator:
 *
 *     as emitted, 39 waypoints, min gap 0.20 m   -> track came within 1.42 m: ENTERS
 *     thinned to a 1 m floor, 15 waypoints       -> track came within 4.01 m: clear
 *
 * The drawn polyline is 3.75 m off the keep-out either way. Sampling it EIGHTEEN TIMES
 * FINER moved the flown track 2.6 m closer to the feature, into the buffer, and the guard
 * held a 645-waypoint survey eleven meters into line 1 of 17.
 *
 * The first and last points are not optional - they are where the shape meets the lines -
 * so when the last one crowds its neighbor it is the NEIGHBOR that goes.
 */
export function thinTrack(pts, minGapM, ref){
  if(!pts || pts.length < 3 || !(minGapM > 0)) return pts;
  const en = pts.map(q => ref.toEN(q));
  const keep = [0];
  for(let i = 1; i < pts.length - 1; i++){
    const q = en[keep[keep.length - 1]];
    if(Math.hypot(en[i].e - q.e, en[i].n - q.n) >= minGapM) keep.push(i);
  }
  const last = pts.length - 1;
  while(keep.length > 1){
    const q = en[keep[keep.length - 1]];
    if(Math.hypot(en[last].e - q.e, en[last].n - q.n) >= minGapM) break;
    keep.pop();
  }
  keep.push(last);
  return keep.map(i => pts[i]);
}

/** The waypoint spacing floor a shape is built to, for this hull. */
export function trackGapM(fly){
  if(fly === false) return 0;
  const o = fly || {};
  return o.approachM
    || (V.VESSEL && V.VESSEL.maneuvering && V.VESSEL.maneuvering.approach_m) || 1;
}

/**
 * CAN THE HULL ACTUALLY FLY THIS SHAPE, JUDGED BY THE RUNTIME GUARD'S OWN MODEL?
 *
 * ⚠ THE PUNCH AND THE GUARD USED TO ANSWER DIFFERENT QUESTIONS ABOUT THE SAME TURN, and
 * that is what stopped a survey dead at New Castle on 2026-09-10. The punch asks whether
 * the drawn POLYLINE clears the keep-outs (`legClear`, sampled every buf/3 meters). The
 * guard asks whether the boat, steering at its own turn rate toward the waypoint it is
 * actually being steered at, stays clear. Those are not the same question, and where they
 * disagree the boat gets a plan it is then stopped for flying.
 *
 * Measured on Andy's plan: a reversal whose every vertex sat 3.75-4.4 m off a keep-out at a
 * 3 m buffer - legal, clear by 0.75 m, and the punch was right to ship it. The guard's
 * projection over the same waypoints came within 2.9 m and called an entry. The survey held
 * eleven meters short of the end of line 1 of 17, the hold replaced the 645-waypoint plan
 * with a single waypoint, and there was no way back.
 *
 * ⚠⚠ AND THE REASON THE TWO DISAGREED IS THE ONE NOBODY WOULD GUESS: the eased turn's
 * VERTEX SPACING. `spiralTurn` emits its clothoids at `Ls / 8`, floored at 0.35 m - written
 * for a hull whose settle length is 15 m. This vessel's is 2.31 m (1.5 s at 3 kn), so the
 * spirals came out at 0.20-0.35 m per vertex, while the projection - and the VESSEL, whose
 * own approach radius is 1.0 m and arrival radius 2.0 m - advances to the next waypoint the
 * moment it is within the approach radius. Nine vertices are consumed in a single step and
 * the "turn" is flown as a chord across its own inside. **A route sampled finer than the
 * approach radius that consumes it is not a finer route, it is a different one.**
 *
 * So rather than guess a margin, ask the guard. Every candidate shape is projected exactly
 * as the runtime guard will project it - same integrator, same turn rate, same approach
 * radius, same keep-out model, same buffer - and a shape whose projected track enters is
 * refused, and the ladder falls to the next rung. The plain arc's vertices are 3 m apart,
 * are followable, and pass; so the plan that ships is the plan the guard will let fly.
 *
 * ⚠ THE HORIZON IS THE SHAPE'S OWN LENGTH, not the guard's 45 s. The guard looks 45 s
 * ahead because that is how far it can see; here the question is about a specific maneuver
 * from end to end, and a 45 s cap would silently stop checking a long turn half way round.
 *
 * ⚠ AND IT IS FLOWN IN STILL WATER. The set at plan time is not the set at run time - the
 * plan may be flown hours later, on the other half of the tide - so adding today's drift
 * would build a turn for a stream that will not be there. The guard adds the live set when
 * the boat is actually there, which is the right place for it; this check is about whether
 * the SHAPE is flyable at all.
 */
export function turnFlyable(E, F, pts, hE, ref, ko, buf, fly){
  if(fly === false) return true;                       // explicit opt-out, for geometry tests
  const o = fly || {};
  const kn = (V.SPEED_KN && V.SPEED_KN[o.spdKey]) || (V.SPEED_KN && V.SPEED_KN.survey) || 3.0;
  const twMs = kn * 0.514444;
  const rate = V.MAX_TURN_RATE_DEG_S || 20;
  const approachM = o.approachM
    || (V.VESSEL && V.VESSEL.maneuvering && V.VESSEL.maneuvering.approach_m) || 1;
  const track = [...(pts || []), F].map(q => ref.toEN(q));
  if(track.length < 2) return true;
  let len = distTo(E, (pts && pts[0]) || F);
  for(let i = 1; i < track.length; i++)
    len += Math.hypot(track[i].e - track[i-1].e, track[i].n - track[i-1].n);
  const horizonS = Math.max(10, len / twMs + 10);
  return !projectRoute(ref.toEN(E), hE, twMs, {e:0, n:0}, track, ko, buf,
                       {turnRateDegS: rate, approachM, horizonS});
}

/**
 * DOES THE SHAPE JOIN THE TWO LINES, OR IS THE BOAT ASKED TO REVERSE AT EACH END?
 *
 * ⚠ THIS IS THE CHECK NOTHING WAS DOING, AND A WHOLE CLASS OF UNFLYABLE REVERSAL SHIPPED
 * THROUGH THE GAP (2026-09-19). `turnFlyable` above asks whether the projected track
 * CLEARS the keep-outs; `legClear` asks whether each chord is lawful water. Neither asks
 * the question a generated turn exists to answer, which tests/turn_geometry.js has stated
 * as its first clause since the day it was written: does the turn LEAVE the line on `hE`
 * and ARRIVE on the next line's `hF`? In open water a 176° cusp clears everything and
 * projects clean, so both existing tests pass it.
 *
 * THE RUNG THAT SHIPPED THROUGH IT was `teardropTurn(..., 'inboard')` - rungs 5 and 6 of
 * the ladder below. Its semicircle branch reverses the SWEEP about a center that stays
 * midway between the two lines, which preserves the endpoints and reverses BOTH tangents:
 * the shape is the arc for the OPPOSITE transition, entering on hF and leaving on hE. See
 * the `side` note in teardropTurn's wrapper above for the geometry.
 *
 * MEASURED against Andy's own plans, 2026-09-19 - every shipped turn re-derived from the
 * stored lines and matched to its rung to the millimetre: `mission.json.bak5` 4 of 17
 * reversals on this rung, `bak1` 1, `bak4` 1, and the Honolulu route of 2026-09-16 4 of
 * 62. The in-extremis escape at 19:11:50 fired at route vertex 18 - the 4th arc vertex of
 * one of them - after the boat had been asked to reverse 165° at the join and had lost
 * half its way doing it (sog 1.98 -> 0.94 kn, recorded).
 *
 * THE TEST IS THE HULL'S OWN RATE, NOT AN ANGLE, because an angle alone cannot say whether
 * a corner is flyable - 165° over 60 m is a gentle swing and over 3 m is a pirouette. So:
 * the heading change at each join must be one the vessel can make while it runs the leg it
 * has to make it in, at `MAX_TURN_RATE_DEG_S` - the same vessel figure `minTurnRadiusM`
 * already builds every one of these shapes from.
 *
 * ⚠ THE JOINS ONLY, AND THAT IS DELIBERATE. The INTERIOR of every shape here is already
 * built at a radius the hull holds - minR for the teardrop, racetrack and spiral, and half
 * the lateral offset for the semicircle, which its own branch gate keeps at or above minR.
 * The joins were the one place nothing checked. Gating the interior on the same rule would
 * have almost no margin and would start refusing good turns: measured across the sweep
 * below, the racetrack's interior corners ask 58 deg/s of a 60 deg/s hull BY CONSTRUCTION
 * (they are cut at minR - that is what minR means), while its joins ask 22.
 *
 * MEASURED SEPARATION, 450 reversal geometries (5 headings x 6 lateral offsets x 5
 * along-track offsets) x 3 vessel profiles, worst JOIN demand of either end:
 *
 *            zboat_1800hs (60 deg/s)   drix08 (20 deg/s)   example_usv_4m (25 deg/s)
 *   eased              3 deg/s                 0 deg/s              1 deg/s
 *   arc outboard      11                       7                    9
 *   racetrack         22                       7                    9
 *   arc INBOARD      101  (all 150 over)     212  (all 50 over)   140  (all 100 over)
 *
 * Every legitimate shape asks at most 22 of a 60 deg/s hull - a 2.7x margin on the
 * tightest vessel - and every inboard semicircle exceeds the hull outright. Zero of the
 * 1,350 legitimate cases are refused by this gate.
 *
 * ⚠⚠ AND THE SPEED IS THE PLAN'S, NEVER THE RUNG'S. A SLOWED RUNG MAY NOT BUY A JOIN.
 * This is the hole the first cut of this gate had, and tests/direct_turn.js 10 found it:
 * with the turn judged at the rung's own speed, the SLOW inboard rung passed. The same
 * 175 deg reversal over the same 2.91 m is 93 deg/s at 3 kn and 46 deg/s at 1.5 kn, so
 * halving the speed halved the demand and the cusp shipped on rung 5 instead of rung 4.
 * That reasoning is wrong about the boat: a join is where the turn meets the SURVEY LINE,
 * and the hull arrives at it doing the speed it ran the line at. It cannot be at 1.5 kn on
 * arrival because a later rung would prefer it to be - deceleration is not instant, and
 * nothing has commanded it yet. So `turnWithRetry` passes this the LADDER's speed, not the
 * per-rung `f`. The interior of a slowed shape is still judged slow, correctly: by then the
 * boat really is doing that speed.
 */
export function turnJoinable(E, F, pts, hE, hF, fly){
  if(fly === false) return true;                       // explicit opt-out, for geometry tests
  const o = fly || {};
  const kn = (V.SPEED_KN && V.SPEED_KN[o.spdKey]) || (V.SPEED_KN && V.SPEED_KN.survey) || 3.0;
  const twMs = kn * 0.514444;
  const rate = V.MAX_TURN_RATE_DEG_S || 20;
  const chain = [E, ...(pts || []), F];
  if(chain.length < 2) return true;
  const dev = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  // Each join gets the leg it actually has to turn on: the first chord on the way out of
  // E, the last chord on the way in to F. A shape with a straight run-out is turning on
  // that run-out, which is exactly the water it has to do it in.
  const legs = [[dev(azTo(chain[0], chain[1]), hE), distTo(chain[0], chain[1])],
                [dev(hF, azTo(chain[chain.length-2], chain[chain.length-1])),
                 distTo(chain[chain.length-2], chain[chain.length-1])]];
  for(const [turnDeg, legM] of legs){
    // ⚠ CLAUSE 1, AND IT IS THE ONE THAT CATCHES THE MIRRORED SHAPE: A TURN MAY NOT BEGIN
    // BY SENDING THE BOAT BACK DOWN THE LINE IT HAS JUST RUN. Past a quarter turn the
    // shape is no longer joining this pair of lines at all - it is the arc for the
    // opposite transition - and no speed makes that true or false. THIS IS A SIGN CHANGE,
    // NOT A TUNED THRESHOLD: 90 deg is the boundary between leaving the line forwards and
    // leaving it backwards. Worst legitimate join MEASURED anywhere - the sweep in the
    // header and the suite fixtures both - is 45 deg: the racetrack at the SLOW radius,
    // whose corner is tight by construction (on the same pair, eased 0.8, arc outboard
    // 5.3, racetrack 28.1). Every mirrored semicircle is 175-176. So the rule sits 45 deg
    // above the worst shape it must pass and 85 below the one it must stop.
    if(turnDeg >= 90) return false;
    // ⚠ CLAUSE 2 IS PHYSICAL AND CANNOT STAND ALONE - that was the first cut of this gate.
    // A rate test scales with speed, so a rung that asks for a slower turn buys itself a
    // looser join, and an operator who sets the TURN speed to `low` (which the punch card
    // itself offers as an advisory) would buy it for the whole plan: the same 175 deg
    // reversal over 2.91 m is 93 deg/s at 3 kn and 46 deg/s at 1.5 kn. MEASURED with only
    // this clause: all 150 mirrored semicircles passed at low on the small-class boat.
    // It stays because it is the right question for a corner that is merely too tight for
    // the hull rather than facing the wrong way - clause 1 cannot see those.
    const secs = legM / twMs;
    if(!(secs > 0)) return false;                      // coincident points cannot be turned on
    if(turnDeg / secs > rate) return false;
  }
  return true;
}

export function turnWithRetry(E, F, hE, hF, ref, ko, buf, minR, maxHalfM, minRSlow, easeLs, fly){
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
  const tries = [];
  // ⚠ AN EASED TURN THE WAYPOINT SPACING CANNOT EXPRESS IS NOT AN EASED TURN. The whole
  // value of the clothoid is the curvature RAMP, and a ramp needs vertices to ramp across;
  // thinned to the approach radius, a 2.3 m settle length keeps two of them and what ships
  // is an arc wearing the word "eased". Four per spiral is the floor - below it the rung is
  // not offered at all and the plain arc takes the turn, which is what it would have had
  // before easing existed. Same rule as SPIRAL_MIN_LS_M, measured against the consumer
  // rather than against zero.
  const easeGap = trackGapM(fly);
  if(easeLs > 0 && (easeGap <= 0 || easeLs >= 4 * easeGap))
    tries.push({side: undefined, minR, slow: false, shape: 'eased'});
  tries.push({side: undefined, minR, slow: false, shape: 'arc'},
             {side: undefined, minR, slow: false, shape: 'racetrack'});
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
      : t.shape === 'eased'
      ? spiralTurn(E, F, hE, hF, ref, ko, buf, t.minR, maxHalfM, easeLs)
      : teardropTurn(E, F, hE, hF, ref, ko, buf, t.minR, maxHalfM, t.side);
    // ⚠ GEOMETRY IS NOT ENOUGH - the projected track has to clear it too. See turnFlyable.
    // A shape that fits on paper but that the hull flies THROUGH the keep-out is refused
    // here and the ladder carries on, which is how the fine-sampled eased shape hands over
    // to the plain arc instead of shipping a turn the runtime guard will stop the boat for.
    if(r.pts){
      const spdKey = t.slow ? "low" : ((fly && fly.spdKey) || "survey");
      const f = fly === false ? false : {...(fly || {}), spdKey};
      // THIN FIRST, THEN VERIFY WHAT WILL ACTUALLY SHIP. Checking the dense shape and
      // shipping the thinned one would be verifying a different route from the one the
      // boat is given - the fault this whole change exists to remove, one layer down.
      // ⚠ E AND F ARE IN THE CHAIN THAT IS THINNED, NOT OUTSIDE IT. The join is a corner
      // like any other: a first arc vertex 0.20 m off the line end is consumed in the same
      // step as the line end itself, and the boat leaves the line steering at a point half
      // way round the loop. Thinning only the interior leaves exactly that seam behind.
      const chain = thinTrack([E, ...r.pts, F], trackGapM(f), ref);
      const pts = chain.slice(1, -1);
      let ok = true;
      for(let j = 1; ok && j < chain.length; j++) ok = legClear(chain[j-1], chain[j], ref, ko, buf);
      // ⚠ JOINABLE BEFORE FLYABLE, AND BOTH ON THE THINNED CHAIN. turnJoinable asks whether
      // the shape meets the two survey lines at all; turnFlyable asks whether the water it
      // crosses is clear. A shape that fails the first is not a turn, wherever it is - so
      // asking the keep-out question about it would answer the wrong one, and in open water
      // it answers YES (measured: turnFlyable passed 120 of 120 cusped shapes).
      // ⚠ `fly`, NOT `f` - the ladder's speed, not this rung's. See turnJoinable's header:
      // a rung may not buy a join by slowing down, because the boat reaches the join at the
      // speed it ran the line at.
      if(ok && turnJoinable(E, F, pts, hE, hF, fly) && turnFlyable(E, F, pts, hE, ref, ko, buf, f))
        return {...r, pts, slow: t.slow, rung: i + 1};
      if(!first && t.shape !== 'eased') first = {why: "track", seg: [E, F]};
      continue;
    }
    // THE FIRST REFUSAL IS THE ONE WORTH REPORTING, not the last: rung 1 is the turn the
    // operator expected to see, and its `seg` names the feature that actually refused it.
    // Reporting rung 4's refusal would name whatever blocked a tighter inboard loop, which
    // is not the answer to "why is there no turn at the end of line 12".
    //
    // ⚠ AND THE EASED RUNG IS NEVER THE ONE REPORTED. When easing is on it is rung 1, and
    // its refusal is a comfort shape declining - the operator's question is still about the
    // turn they expected to see, which is the plain arc below it. Skipping it here keeps
    // "why is there no turn" answered by the same rung it was answered by before easing
    // existed, rather than by a keep-out that only the wider eased loop ever reached.
    if(!first && t.shape !== 'eased') first = r;
  }
  return {...first, rung: tries.length};
}


// ============================================================================
// WHERE THE HULL ACTUALLY GOES AT A CORNER - the call the junctions never got.
// ============================================================================
//
// `turnFlyable` above asks `projectRoute` whether a GENERATED TURN's track clears the
// keep-outs. Nothing asks that of a junction: the approach meeting the first coverage
// line, a hop between two runs, a reversal the gate declined, a detour `legPath` spliced
// in at Upload. Those corners are planned as a polyline and checked as a polyline
// (`legClear` passes every chord, because every chord is lawful water), and the hull then
// rounds them.
//
// MEASURED ON ANDY'S OWN PLANS, 2026-09-19, by flying the recorded uploads through the
// vessel model itself. On the Honolulu route of 2026-09-16 (415 waypoints, 5 m buffer,
// zero waypoints inside it) the hull leaves the commanded polyline by up to 2.88 m at the
// plan speed and 1.41 m at `low`; **12 of 413 vertices take her inside the operator's
// buffer at the plan speed and 0 of 413 do at `low`**, and all 12 are at joints over 90
// degrees. The coverage standoff (`guardStandoffM`) does not answer this: it floors at the
// buffer in calm water, and it is the coverage LINES only - turns and transits still
// answer to the plain buffer, which is every junction there is.
//
// ⚠ AND `projectRoute` RESTARTED AT EACH VERTEX CANNOT CARRY THIS, WHICH WAS THE FIRST
// DESIGN AND IS WHY THIS FUNCTION EXISTS INSTEAD. Two defects, both measured against the
// vessel model over seven route/speed cases on three recorded plans at two ports:
//
//   (1) IT STEERS AT THE WAYPOINT; THE BOAT STEERS AT A LOOK-AHEAD POINT ON THE LEG, and
//       trims the residue out with an integral. Those are different control laws and they
//       round a corner differently.
//   (2) RESTARTED CLEAN AT EACH VERTEX IT CANNOT SEE INHERITED CROSS-TRACK ERROR. On a
//       chain of short legs the boat arrives at a corner already off her line, and that
//       error dominates the corner's own.
//
// Measured against the vessel model over seven route/speed cases on three recorded plans
// at two ports, worst understatement of the hull's own departure: `projectRoute` restarted
// per vertex **2.20 m**; chained **1.42 m**; chained and steering the way the boat steers
// **3.32 m**; and with the LEG ADVANCE taken in the follower's own order - along-track and
// range measured BEFORE the step, not after - **0.34 m, on all seven**. The half-step was
// the whole outlier: the case that read 3.32 m reads 0.26 m once it is right. An earlier
// draft of this comment blamed that case on a corner "no simple model tracks". It was this
// bug, and the note is left here because the wrong reading survived two rounds of work.
//
// A MARGIN WAS TRIED INSTEAD AND IS NOT WHAT THIS USES. `minTurnRadiusM`'s TRACKING_MARGIN
// slack (minTurnRadiusM - v/omega) fits the Honolulu joints almost exactly - 0.58 m of
// understatement against 0.590 m of slack - and FAILS OUT OF SAMPLE on four of six
// route/speed cases, by up to 2.20 m against 1.179 m. A constant that fits the plan it was
// read off is not a bound. There is no fitted constant here: every term is the vessel's
// own, read from the same profile `asv_console.py`'s follower reads.
//
// WHAT THIS DOES NOT ANSWER, NAMED SO IT IS NOT MISTAKEN FOR ANSWERED: a corner the hull
// cannot hold at any speed. The 13:47 upload of 2026-09-18 carries a 157.2-degree reversal
// on a 7.09 m leg and a 253-degree turn on 14.64 m (route vertices 51 and 61, single join
// points from punchOut, flown at `high`). Slowing is not the answer to those; `junctionKnot`
// already names both, and they are the open `nKnotFold` item.

/** The vessel loop's own tick (asv_console.py TICK_HZ = 4.0). Not a tuned number: the
 *  follower integrates at this rate, so a track walked at it is the track it flies. */
export const TRACK_STEP_S = 0.25;

/**
 * THE THROTTLE'S RAMP, kn/s - and it is the ONE number here that is not in the vessel
 * profile, which is a cost and is stated rather than hidden. The governor ramps speed
 * changes at this rate (asv_console.py's tick: `clamp(target - sog, -1.5*dt, 1.5*dt)`),
 * and it matters because slowing for a corner is worth nothing if the leg into it is too
 * short for the way to come off: from survey to low is 1.0 s, about 1.2 m of run-in. A
 * corner whose run-in cannot deliver the lower speed is reported as one slowing does not
 * answer, rather than silently marked solved.
 */
export const SPEED_RAMP_KN_S = 1.5;

/**
 * HOW LATE THE SLOW COMMAND CAN BE, in seconds - and it is the console's own number, not
 * a guess. The page can only act on a leg change when it SEES one, and it sees `wp_index`
 * on a state frame that the server throttles to one per second. So the throttle target
 * cannot change on the tick the leg does; crediting the boat with a slow-down she has not
 * been told about yet is an error in the under-flagging direction, which is the one that
 * costs the buffer. Found in review.
 */
export const SPEED_CMD_LATENCY_S = 1.0;

/** The follower's terms, from the active vessel - the same fields asv_console.py reads.
 *  The fallbacks are the shipped small-class values and apply only if /api/vessel failed
 *  before first paint, exactly as minTurnRadiusM's `|| 3.0` does. */
function followerTerms(fly){
  const o = fly || {}, m = (V.VESSEL && V.VESSEL.maneuvering) || {}, a = (V.VESSEL && V.VESSEL.autopilot) || {};
  return {
    lookM:    +m.lookahead_m || 3.0,
    approachM: o.approachM || +m.approach_m || 1,
    kiDeg:    (a.xte_ki_deg    != null) ? +a.xte_ki_deg    : 0.4,
    iMaxDeg:  (a.xte_i_max_deg != null) ? +a.xte_i_max_deg : 12.0,
    rate:      V.MAX_TURN_RATE_DEG_S || 20,
  };
}

const D2R = Math.PI / 180;
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function turnTo(cur, tgt, step){
  const d = ((tgt - cur + 540) % 360) - 180;
  return (cur + clampN(d, -step, step) + 360) % 360;
}
/** Distance from an {e,n} point to the polyline EN[lo..hi], in meters. */
function polyOff(EN, P, lo, hi){
  let m = Infinity;
  for(let k = Math.max(0, lo); k < Math.min(EN.length - 1, hi); k++){
    const a = EN[k], b = EN[k+1], dx = b.e - a.e, dy = b.n - a.n, l2 = dx*dx + dy*dy;
    const t = l2 ? clampN(((P.e - a.e)*dx + (P.n - a.n)*dy) / l2, 0, 1) : 0;
    m = Math.min(m, Math.hypot(P.e - (a.e + t*dx), P.n - (a.n + t*dy)));
  }
  return m;
}
/** How many legs either side to measure a departure against. A corner's excursion can
 *  only reach the legs adjacent to it; four covers a whole generated arc, whose vertices
 *  are one approach-radius apart. */
const OFF_WINDOW = 4;

/**
 * HOW FAR FROM A VERTEX THE CORNER ITSELF EXTENDS - the distance the hull covers while
 * swinging through a half turn at its own rate, plus the radius at which it changes leg.
 * Derived, not chosen: past that the boat has finished turning and is running the leg, so
 * what she is doing there belongs to the leg and not to this corner. 5.6 m at survey on
 * the small-class boat, 10.3 m at high.
 *
 * ⚠ IT IS ALSO WHAT MAKES THE SCREEN WORK. Charging a whole leg to the vertex it ends at
 * put `reach` at 600 m on a long coverage line, so `blocked(V, ko, buf + reach)` was true
 * everywhere, nothing was ever screened out and the exact test walked every step of the
 * plan: 16 s over 415 waypoints, against 0.4 s once the window is the corner.
 */
function cornerReachM(twMs, rateDegS, approachM){
  return twMs * (180 / Math.max(1, rateDegS)) + approachM;
}

/**
 * WALK THE ROUTE THE WAY THE BOAT FLIES IT, once, carrying position and heading across
 * every vertex. Pure geometry - no keep-out model is consulted here at all, so this is
 * cheap enough to run over a whole plan (measured 4-101 ms for 92-579 waypoints).
 *
 * `speedAt(i)` gives the TARGET through-water speed in m/s for the leg INTO vertex i.
 * It is a target, not a speed: the walk ramps toward it at SPEED_RAMP_KN_S exactly as the
 * governor does, so a corner whose run-in is too short to slow down in is walked at the
 * speed she will really be doing there.
 *
 * Returns `{pts, corner}`: `pts` is the flown track as {e, n, i} (i = the vertex being
 * steered for), and `corner[i]` is {dev, reach, from, to} - the greatest departure from
 * the commanded polyline while rounding vertex i, the greatest distance from the vertex
 * itself, and the slice of `pts` that rounds it.
 */
export function flownTrack(route, ref, speedAt, fly, capMs){
  const t = followerTerms(fly);
  const EN = route.map(p => ref.toEN(p));
  const pts = [], corner = [];
  if(EN.length < 2) return {pts, corner};
  let e = EN[0].e, n = EN[0].n, h = azTo(route[0], route[1]);
  let k = 1, prev = EN[0], xi = 0, guard = 0;
  // She starts the plan already up to the first leg's speed; everything after is ramped.
  let twMs = speedAt(1, 0), traveled = 0;
  const rampMs = SPEED_RAMP_KN_S * 0.514444 * TRACK_STEP_S;
  // ⚠ THE TICK ORDER IS THE FOLLOWER'S, AND IT IS LOAD-BEARING. `along` and the range to
  // the waypoint are taken BEFORE the step and the leg advance is decided on those, which
  // is what asv_console.py's tick does. Deciding it on the post-step position instead
  // advances every leg half a step early - 0.39 m at survey, 0.77 m at high - and that
  // alone was the whole disagreement with the vessel model in the first cut of this
  // function: it under-reported the corner at route vertex 40 of Andy's Honolulu plan by
  // enough to miss a real buffer breach (4.91 m measured against a 5 m buffer).
  while(k < EN.length && guard < 2e6){
    guard++;
    const tgt = EN[k];
    const want = speedAt(k, traveled);
    twMs += clampN(want - twMs, -rampMs, rampMs);      // the governor's ramp, not a step
    const de = tgt.e - prev.e, dn = tgt.n - prev.n, segLen = Math.hypot(de, dn);
    const distB = Math.hypot(tgt.e - e, tgt.n - n);
    let desired, along;
    if(segLen < 1.0){
      // the follower's own degenerate-leg branch: aim at the waypoint
      desired = Math.atan2(tgt.e - e, tgt.n - n) / D2R; along = segLen;
    } else {
      // LINE FOLLOWING, not waypoint chasing: aim a look-ahead along the leg, and trim the
      // residual cross-track out with the same integral the vessel uses.
      const bx = de / segLen, by = dn / segLen;
      along     = (e - prev.e)*bx + (n - prev.n)*by;
      const xte = (e - prev.e)*by - (n - prev.n)*bx;
      const g = Math.min(segLen, Math.max(along, 0) + t.lookM);
      desired = Math.atan2((prev.e + bx*g) - e, (prev.n + by*g) - n) / D2R;
      xi = clampN(xi + t.kiDeg * xte * TRACK_STEP_S, -t.iMaxDeg, t.iMaxDeg);
      desired -= xi;
    }
    h = turnTo(h, desired, t.rate * TRACK_STEP_S);
    const a = h * D2R;
    traveled += twMs * TRACK_STEP_S;
    e += twMs * Math.sin(a) * TRACK_STEP_S;
    n += twMs * Math.cos(a) * TRACK_STEP_S;
    const i = k - 1;
    pts.push({e, n, i});
    // CHARGED TO BOTH NEIGHBORING VERTICES, so a corner is measured from both sides -
    // the run-in on the leg before it and the run-out on the leg after. A step outside
    // `cornerReachM` of a vertex is not part of that corner and is not charged to it.
    // ⚠ SIZED AT THE PLAN SPEED, NOT THE SPEED SHE HAPPENS TO BE DOING. Sizing it from the
    // instantaneous speed gave a SLOWED corner a smaller window than the breach it was
    // meant to catch - found in review, demonstrated at 4.06 m against a 3.843 m window,
    // so the second pass declared a corner answered that was not. The window must be the
    // largest either pass will need or the two passes are not asking the same question.
    const capM = cornerReachM(capMs || twMs, t.rate, t.approachM);
    for(const v of [i, k]){
      if(v < 1 || v > EN.length - 2) continue;
      const reach = Math.hypot(e - EN[v].e, n - EN[v].n);
      if(reach > capM) continue;
      const c = corner[v] || (corner[v] = {dev: 0, reach: 0, from: pts.length - 1, to: pts.length - 1});
      const off = polyOff(EN, {e, n}, v - OFF_WINDOW, v + OFF_WINDOW);
      if(off > c.dev) c.dev = off;
      if(reach > c.reach) c.reach = reach;
      if(pts.length - 1 < c.from) c.from = pts.length - 1;
      c.to = pts.length - 1;
    }
    if(along >= segLen - t.approachM || distB <= t.approachM){
      // ⚠ THE TRIM IS CARRIED ACROSS A LEG, BECAUSE THE VESSEL CARRIES IT. An earlier
      // version of this reset it to zero here and cited asv_console.py's "a new leg: the
      // old cross-track trim is not its trim" - but that line is in `amend_plan`, not in
      // the tick. The tick's own advance sets `_seg_start` and `_wp_index` and does not
      // touch `_xte_i` at all. ⚠ AND THE FIRST WRITE-UP OF THIS CALLED IT INERT ON A
      // MEASUREMENT THAT WAS A ROUND TRIP: it compared this walk WITH the reset against
      // this walk WITHOUT it, never against the vessel, and only on route-wide maxima at
      // survey speed. Against SimVcu over 280 corners the reset UNDER-REPORTS THE HULL
      // BY UP TO 3.935 m (8 m legs, 160 deg, high) - it is not inert, it is the largest
      // single error this function ever had. Check 27 is the fixture class that sees it.
      prev = tgt; k++;
    }
  }
  return {pts, corner};
}

/**
 * WHICH CORNERS TAKE THE HULL INSIDE THE OPERATOR'S BUFFER, AND WHICH OF THOSE SLOWING
 * ANSWERS. Two passes, because that is what the boat will do: the first walks the plan at
 * its own speed and finds the corners that breach; the second walks it again with those
 * corners slowed, and anything still breaching is a corner slowing does NOT answer - a
 * plan defect the operator has to be told about rather than quietly throttled at.
 *
 * ⚠ THE SCREEN IS THE TRIANGLE INEQUALITY, AND IT CAN ONLY OVER-FLAG. For any point P
 * within `reach` of vertex V, `clearance(P) >= clearance(V) - reach`. So a corner whose
 * `clearance(V) - reach` still clears the buffer cannot breach and is skipped without
 * touching the model again; everything else is tested exactly, point by point, with the
 * same `blocked()` every other keep-out question in this console is asked. Over-flagging
 * costs one unnecessary slow corner. Under-flagging would cost the buffer, so the screen
 * is written in the direction that cannot do it.
 *
 * Returns `{slow, unanswered, dev}` - vertex indices to fly at the low speed, vertex
 * indices that breach even there, and the per-vertex departure at the plan speed.
 */
/**
 * ⚠ IT YIELDS, AND THAT IS WHY IT IS ASYNC. MEASURED on the live console against Andy's
 * Honolulu plan and its real 995-zone model: this is about 2.5 s of work on top of an
 * Upload that already blocked the main thread for 2.8 s, and the page's own stall detector
 * fired at 7.9 s - a banner telling the operator the console had stopped responding, and a
 * `page_stall` record written on every Upload, on a console that already has 217 of them
 * open. None of the work is dropped; the thread is handed back between corners. doUpload
 * is already an async function that awaits guiConfirm and cmd(), so awaiting this changes
 * no verdict and no ordering - the plan still goes out after the answer is known, and the
 * operator still sees the banner before it does.
 */
/** How many corners to test between yields. A macrotask turnaround is about 4 ms, so this
 *  is large enough that the yields are not themselves the cost and small enough that no
 *  slice approaches the stall detector's threshold. */
/** ⚠ `fly.approachM` IS THE OPERATOR'S, NOT THE HULL'S DEFAULT. The radius at which the
 *  follower changes leg is what decides how wide a corner is cut, and it is a MISSION
 *  setting the server passes straight to the vessel - so the caller hands it in, the same
 *  way guardTrack and punchOut's flyability check both already do. Omitting it models a
 *  boat that is not the one being sent. */
const CORNERS_PER_SLICE = 40;
/** How many times the slowed walk may be re-taken after growing the set. Each pass can
 *  only ADD corners, so it settles; three is enough for every recorded plan (the Honolulu
 *  route settles on the second) and the leftovers of a fourth would be reported as
 *  unanswered, which is the conservative end. */
const ITER_CAP = 3;
const breathe = () => new Promise(r => setTimeout(r, 0));
export async function cornerSlowPlan(route, ref, ko, buf, planKey, lowKey, fly){
  const out = {slow: [], unanswered: [], dev: {}};
  if(!route || route.length < 3 || !ko) return out;
  const kn = k => (V.SPEED_KN && V.SPEED_KN[k]) || 3.0;
  const planMs = kn(planKey) * 0.514444, lowMs = kn(lowKey || "low") * 0.514444;
  const EN = route.map(p => ref.toEN(p));

  const breaches = (walk, i) => {
    const c = walk.corner[i];
    if(!c || !(c.dev > 0)) return false;
    // THE SCREEN, AND IT IS `blocked` RATHER THAN `clearanceM` FOR A MEASURED REASON.
    // Both answer the triangle inequality - nothing within `buf + reach` of the vertex
    // means nothing within `buf` of any point the corner reaches - but `blocked` rejects
    // on a bounding box and returns the moment it finds one thing, where `clearanceM`
    // walks every ring to the end to report a distance nobody reads. Measured on Andy's
    // Honolulu model (1044 zones): 18.9 s of screening became 0.4 s.
    if(!blocked(EN[i], ko, buf + c.reach)) return false;
    // ⚠ EVERY STEP OF THE CORNER, AND NOT `legClear`'s RATE - THAT WAS TRIED AND IT LOST
    // A REAL DETECTION. Stepping the exact test at `max(2, buf/2)` like legClear does moved
    // route vertex 332 of Andy's Honolulu plan from `unanswered` to `slow` - from "slowing
    // does not answer this" to "slowing does" - when at the low speed it still lies 4.91 m
    // off a keep-out inside a 5 m buffer. legClear's rate is for a straight LEG, where the
    // clearance varies slowly; a corner excursion is a tight arc whose closest approach is
    // a point, and two or three samples across it step over the apex. The main-thread cost
    // that rate was buying is answered by yielding instead - see this function's header.
    for(let j = c.from; j <= c.to; j++){
      const p = walk.pts[j];
      if(Math.hypot(p.e - EN[i].e, p.n - EN[i].n) > c.reach) continue;   // not this corner
      if(blocked(p, ko, buf)) return true;
    }
    return false;
  };

  const pass1 = flownTrack(route, ref, () => planMs, fly, planMs);
  const slow = new Set();
  for(let i = 1; i < route.length - 1; i++){
    const c = pass1.corner[i];
    out.dev[i] = c ? c.dev : 0;
    if(breaches(pass1, i)) slow.add(i);
    if(i % CORNERS_PER_SLICE === 0) await breathe();
  }
  if(!slow.size) return out;

  // THE SECOND PASS IS FLOWN THE WAY THE RUN WILL BE FLOWN: low on the leg INTO a flagged
  // corner and on the leg out of it (the throttle has a ramp, and a corner entered at the
  // plan speed is rounded at the plan speed whatever the governor says at the vertex).
  const slowLeg = i => slow.has(i) || slow.has(i - 1);
  // ⚠ THE SLOW COMMAND ARRIVES LATE, AND THE SECOND WALK HAS TO FLY IT LATE. The low
  // target is withheld for SPEED_CMD_LATENCY_S of travel into the leg, on top of the ramp -
  // the page does not know the leg changed until a state frame tells it.
  const lateM = lowMs * SPEED_CMD_LATENCY_S;
  const walkSlowed = () => {
    let legStart = null, lastK = -1;
    return flownTrack(route, ref, (i, traveled) => {
      if(i !== lastK){ lastK = i; legStart = traveled; }
      if(!slowLeg(i)) return planMs;
      return (traveled - legStart) < lateM ? planMs : lowMs;
    }, fly, planMs);
  };
  // ⚠⚠ AND IT IS ITERATED, OVER EVERY VERTEX, BECAUSE SLOWING MOVES THE BOAT. The slowed
  // walk is a different track and it carries that difference into every leg after, so it
  // can put the hull somewhere the first walk never did. Re-testing only the vertices the
  // first walk flagged meant a breach the SLOW-DOWN ITSELF created could never be found -
  // an under-flag, found in review.
  //
  // ⚠ AND SUCH A VERTEX IS NOT `unanswered`: slowing was never TRIED on it. A new breach
  // is a new corner to slow FOR, so the set grows and the walk repeats. Only a corner that
  // still breaches WHILE IT IS ITSELF BEING SLOWED has actually been answered and failed.
  // Bounded at ITER_CAP passes - each one can only add corners, so it settles - and if it
  // has not settled by then the leftovers are reported as unanswered, which is the
  // conservative end.
  let pass2 = walkSlowed(), yielded = 0;
  for(let pass = 0; pass < ITER_CAP; pass++){
    const added = [];
    for(let i = 1; i < route.length - 1; i++){
      if(!slow.has(i) && breaches(pass2, i)) added.push(i);
      if(++yielded % CORNERS_PER_SLICE === 0) await breathe();
    }
    if(!added.length) break;
    added.forEach(i => slow.add(i));
    pass2 = walkSlowed();
  }
  for(const i of [...slow].sort((a, b) => a - b)){
    if(breaches(pass2, i)) out.unanswered.push(i); else out.slow.push(i);
    if(++yielded % CORNERS_PER_SLICE === 0) await breathe();
  }
  return out;
}
