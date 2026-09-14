// static/js/guard.js - what is AHEAD of the boat, and what to do about it.
//
// Andy, 2026-09-02, after watching a DriX trace a station-keeping loop through a pier at
// Eastport:
//
//   "A vessel must consider what is ahead of it and modify trajectory or speed or final
//    target to ENSURE nogo areas are never entered."
//
// and then, asked directly:
//
//   "console should take the helm in extremis."
//
// ⚠ THIS REVERSES A STANDING RULE, DELIBERATELY AND ONLY AT THE LAST RUNG. After the Pago
// Pago wharf the console was given the throttle and explicitly NOT the helm: it slowed, it
// never steered, and the RC transmitter stayed master. That was right for the fault it
// answered. It is not sufficient for this one, and the reason is measurable rather than
// arguable - see below.
//
// ⚠⚠ "STOP THE BOAT" IS NOT A SAFE ANSWER NEAR A STRUCTURE, AND THAT IS WHY THERE IS A
// FOURTH RUNG. The tidal stream advects the hull: a vessel lying stopped in a 2 kn stream
// makes 2.00 kn over the ground with no force on it at all (measured, tests/currents.py
// checks A and E). So taking the way off a boat that is being set down onto a pier does not
// hold it off the pier - it hands it to the tide with no steerage. Slowing is the right
// FIRST answer because it buys time and shortens the stopping distance; it is the wrong
// LAST one.
//
// THE LADDER, and each rung is a different question:
//
//   clear   nothing within the look-ahead. Say the number, command nothing.
//   edge    entry is predicted, and a SLIGHT DEVIATION of the track answers it with water
//           to spare. Keep going, a few metres over.
//   slow    entry is predicted, no small deviation answers it, and taking the way off
//           WOULD avoid it. Buy time.
//   hold    the same, but close enough that slowing is no longer enough on its own.
//   helm    entry is predicted AND the drift-only track enters too - so no amount of
//           slowing or stopping helps, because it is the water that is carrying us in.
//           This is in extremis, and it is the only rung that steers.
//
// The test that separates `hold` from `helm` is the whole design: project the track a
// SECOND time with the engines notionally stopped, using drift alone. If that projection
// is clear, stopping works and the console has no business steering. If it is not, stopping
// is the one thing that certainly fails.
//
// ⚠⚠ THE PROJECTION FOLLOWS THE PLAN, AND UNTIL 2026-09-04 IT DID NOT. That single fact
// made this ladder fire on correct plans, in dead calm, with no set on the boat at all.
// Andy, with two of them:
//
//   "A keep out triggered during the start of a survey forced a drift-only track. The
//    punch out should have kept the run clear. In another situation a GOTO run was put
//    into holding because of entering a no go zone."
//
// He is right that the punch-out kept the run clear, and that is exactly the trouble. The
// old look-ahead was a STRAIGHT extrapolation of the present ground velocity for up to 45
// seconds - a manoeuvre nobody intends to make - while every planner in this console clips
// or routes to the buffer edge and then TURNS. So a plan is correct precisely when it
// grazes the buffer, and the guard alarmed 40-60 m before that same edge. The two rules
// could not both be satisfied, and the plan lost. Measured (a pier, buffer 5 m, no wind,
// no stream, a survey line clipLine had trimmed exactly as it should):
//
//     4.0 kn survey line:  SLOW at 90 m of clearance,  HOLD with 33 m still to run
//     4.0 kn Go-To turn:   first alarm 90 m short of the turn, HOLD 39 m short of it
//     6.0 kn Go-To turn:   first alarm 136 m short of the turn, HOLD 59 m short of it
//
// And a false HOLD near a structure is not a harmless pause. `hold` takes the way off, and
// a hull lying stopped in a 2 kn stream makes 2.00 kn over the ground (tests/currents.py A
// and E) - so the console answered a correct plan by handing the boat to the tide with no
// steerage, beside the very feature it was worried about. That is the "drift-only track" in
// the report. It also destroys the run: a hold replaces the vessel's plan with a
// single-waypoint route, and there is no resume.
//
// `projectRoute` is the fix, and it is NOT "trust the plan". It starts at the boat's ACTUAL
// position and heading, steers toward the waypoint it is actually being steered toward at
// the hull's own turn rate, and adds the drift as advection at every step. A boat holding
// its track reads clear because it IS clear; a boat being set off one still reads the
// entry, because the set is in the integration. What it no longer does is invent a
// straight-ahead manoeuvre at a boat that is about to turn.
//
// ⚠ AND IT APPLIES ONLY WHILE A ROUTE IS BEING FOLLOWED. A station-keeping boat is not
// being steered anywhere, so it has no route to project along and falls back to the
// straight-and-drift projection unchanged - which is the Eastport pier loop, the case this
// whole file was written for. The seam is deliberate: nothing about the case that earned
// the helm rung has changed.
//
// ⚠ NOTHING HERE COMMANDS ANYTHING. This module answers "what is ahead and what does it
// warrant"; the caller decides and commands. That separation is what lets the numbers be
// shown on the card, and tested, without a boat moving - the same split the clearance
// readout already has.

import { blocked, clearanceM } from "./keepouts.js";

/** How far ahead to look, in seconds of ground track. */
export const HORIZON_S = 45;
/** Sampling step along the projection. Fine enough not to step over a pile. */
export const STEP_S = 0.5;
/**
 * Below this predicted time-to-entry, slowing is no longer a sufficient answer on its own
 * and the boat is told to take the way off.
 *
 * Not a stopping distance - it is a decision margin. A vessel needs time to answer the
 * throttle, and a rung that only fires when the entry is already unavoidable is decoration.
 */
export const HOLD_S = 20;
/** Candidate escape headings, every this many degrees. 24 of them at 15°. */
export const ESCAPE_STEP_DEG = 15;
/** From inside the buffer, how close an escape track may pass the feature itself (m). */
export const ESCAPE_HARD_M = 0.5;
/**
 * Candidate deviation bearings, every this many degrees.
 *
 * ⚠ COARSER THAN THE ESCAPE SEARCH'S 15°, AND THE REASON IS MEASURED. `blocked` costs about
 * 800 µs against a real harbour extract - New Castle NH carries 34,579 ring vertices, and
 * one shoreline polygon alone has 7,034 - so a projection is ~9 ms and a full sweep at 15°
 * over two bases and six radii measured **1,060 ms of frozen tab**. The escape search can
 * afford 24 headings because it walks a straight line once each; this one walks a whole
 * route per candidate. 45° with the RADIUS also swept covers the plane well enough to find
 * an answer, and the answer is then verified exactly rather than trusted.
 */
export const EDGE_DEG_STEP = 45;
/**
 * Candidate screening runs at this multiple of the projection step, over a horizon just
 * long enough to cover the trouble that was found. The WINNER is then re-projected at the
 * full step and the full horizon, so nothing is ever offered on the strength of the coarse
 * pass - the screen only decides what is worth looking at properly.
 */
export const EDGE_SCREEN_STEP_MULT = 4;
export const EDGE_SCREEN_MIN_S = 15;
/**
 * Turn rate the ROUTE projection swings the boat at, when the caller does not supply the
 * hull's own. Deliberately a fallback and not a default worth relying on - a projection
 * that turns faster than the hull can is a projection that clears keep-outs the boat will
 * not clear, so the page passes `V.MAX_TURN_RATE_DEG_S` and this is what remains if a
 * vessel file has never said.
 */
export const PROJECT_TURN_RATE_DEG_S = 20;
/** Waypoint capture radius the projection advances at, mirroring the vessel's own. */
export const PROJECT_APPROACH_M = 2.0;

/**
 * HOW FAR THE CONSOLE MAY MOVE THE OPERATOR'S TRACK ON ITS OWN AUTHORITY.
 *
 * Anchored to the buffer because the buffer IS the operator's stated standoff: someone who
 * asked for 5 m of water is not surprised by a 15 m dog-leg, and someone working to 20 m is
 * not helped by one. The floor is there because a small buffer must not shrink the console's
 * room to answer with - under about 15 m a deviation stops being able to absorb any real
 * set. It is a POLICY number, like NARROW_MAX_M and COAST_ARRIVE_MS: COLREGS has nothing to
 * say about it and neither does the hull.
 *
 * ⚠ IT IS ALSO THE PER-EPISODE BUDGET, not just the per-deviation cap. A persistent set can
 * ask for an edge every few seconds, and without a budget the console would walk the plan
 * sideways indefinitely, one defensible metre at a time. Past the budget it stops edging and
 * the ordinary rungs answer, which is the console admitting the situation is bigger than a
 * deviation.
 */
export const edgeCapM = (buf) => Math.max(3 * (buf || 0), 15);
/** Search granularity for the deviation - the smallest one that answers is the one taken. */
export const edgeStepM = (buf) => Math.max(1, (buf || 0) / 2);
/**
 * The water a deviation must move INTO, over and above the buffer.
 *
 * Andy's condition, and it is the whole gate: *"when there is still plenty of available
 * water away from the nogo"*. Without it the search would happily answer a tight pass with
 * a slightly different tight pass, which is not an answer at all - it is the same situation
 * moved three metres and the operator no longer being told about it.
 */
export const edgeMarginM = (buf) => Math.max(2, (buf || 0) / 2);

const D2R = Math.PI / 180;

/** Swing `hdg` toward `want` by at most `maxDeg`, the way a hull with a rudder does. */
function turnToward(hdg, want, maxDeg) {
  let d = ((want - hdg + 540) % 360) - 180;
  if (d > maxDeg) d = maxDeg;
  else if (d < -maxDeg) d = -maxDeg;
  return (hdg + d + 360) % 360;
}

/** Ground velocity in m/s east/north from course over ground and speed over ground. */
export function groundVel(cogDeg, sogKn) {
  if (cogDeg == null || sogKn == null) return null;
  const v = sogKn * 0.514444, a = cogDeg * D2R;
  return { e: v * Math.sin(a), n: v * Math.cos(a) };
}

/**
 * Seconds until a straight projection from `p` at `vel` first enters the buffer, or null
 * if it does not within `horizonS`.
 *
 * ⚠ A POINT ALREADY INSIDE RETURNS 0, NOT NULL. "We are in it" and "we will never be in it"
 * must not be the same answer - the first is the alarm the whole file exists for.
 */
export function timeToEntry(p, vel, ko, buf, horizonS = HORIZON_S, stepS = STEP_S) {
  if (!p || !vel || !ko) return null;
  const speed = Math.hypot(vel.e, vel.n);
  if (blocked(p, ko, buf)) return 0;
  // A boat that is not moving over the ground cannot arrive anywhere. It is not clear
  // BECAUSE it is safe; it is clear because nothing is happening - and if the water starts
  // moving, the next tick's projection will say so.
  if (speed < 0.02) return null;
  for (let t = stepS; t <= horizonS; t += stepS) {
    if (blocked({ e: p.e + vel.e * t, n: p.n + vel.n * t }, ko, buf)) return t;
  }
  return null;
}

/**
 * WHERE THE BOAT ACTUALLY GOES NEXT, given the route it is being steered along.
 *
 * `timeToEntry` above answers the same question for a boat under no command - it flies the
 * present ground velocity forward in a straight line. That is the right model for a vessel
 * station-keeping, drifting, or on the RC transmitter, and it is the wrong one for every
 * boat following a plan, because the plan turns and the straight line does not. See the
 * measurements in the header: it is what held a correctly clipped survey line 33 m short of
 * its own end, in dead calm.
 *
 * This walks the boat instead. At each step it swings the heading toward the waypoint it is
 * being steered toward, capped at the hull's turn rate; drives the through-water speed along
 * that heading; ADDS THE DRIFT as advection; and advances the waypoint on the same two tests
 * the vessel itself uses (inside the approach radius, or past it along-track). So the
 * prediction contains both facts that matter: that the boat will turn, and that the water is
 * moving it while it does.
 *
 * ⚠ IT ENDS WHERE THE ROUTE ENDS, and returns clear rather than inventing a continuation.
 * Past the last waypoint the boat station-keeps; whether THAT is safe is the hold point's
 * question and hold.js certifies the disc, and a boat actually holding arrives back here
 * with no route and gets the straight projection. A guess about what happens after the plan
 * would be this function commanding something nobody asked for.
 *
 * @param {{e,n}}   p       boat position in the model's frame
 * @param {number}  hdgDeg  the boat's HEADING (not its course - the drift is added below)
 * @param {number}  twMs    through-water speed, m/s
 * @param {{e,n}}   drift   ground velocity that would remain with the engines stopped
 * @param {Array}   route   waypoints AHEAD of the boat, {e,n}, nearest first
 * @returns {{t, at, i}|null} when it first enters the buffer, where, and WHICH waypoint of
 *                          `route` it was steering toward at the time. A boat ALREADY inside
 *                          returns t = 0, never null - "we are in it" and "we will never be
 *                          in it" must not be the same answer.
 *
 * ⚠ `i` IS NOT BOOKKEEPING. The trouble on a routed detour is usually not on the leg the
 * boat is flying now - it is at a corner two or three waypoints ahead - and a deviation
 * applied to the wrong leg changes nothing at all. Measured live at New Castle: a Go-To
 * around a dock fouled at the THIRD waypoint, the search only ever considered the first,
 * found no answer, and the ladder went straight to hold and then to the helm.
 */
export function projectRoute(p, hdgDeg, twMs, drift, route, ko, buf, opts = {}) {
  if (!p || !ko || !route || !route.length || !(twMs > 0) || hdgDeg == null) return null;
  if (blocked(p, ko, buf)) return { t: 0, at: { e: p.e, n: p.n }, i: 0 };
  const horizon = opts.horizonS ?? HORIZON_S;
  const step = opts.stepS ?? STEP_S;
  const swing = (opts.turnRateDegS ?? PROJECT_TURN_RATE_DEG_S) * step;
  const approach = opts.approachM ?? PROJECT_APPROACH_M;
  const dr = drift || { e: 0, n: 0 };
  let e = p.e, n = p.n, h = hdgDeg, i = 0, prev = { e: p.e, n: p.n };
  for (let t = step; t <= horizon; t += step) {
    const tgt = route[i];
    h = turnToward(h, Math.atan2(tgt.e - e, tgt.n - n) / D2R, swing);
    const a = h * D2R;
    e += (twMs * Math.sin(a) + dr.e) * step;
    n += (twMs * Math.cos(a) + dr.n) * step;
    if (blocked({ e, n }, ko, buf)) return { t, at: { e, n }, i };
    const de = tgt.e - prev.e, dn = tgt.n - prev.n, segLen = Math.hypot(de, dn);
    const along = segLen > 1e-6 ? ((e - prev.e) * de + (n - prev.n) * dn) / segLen : Infinity;
    if (Math.hypot(tgt.e - e, tgt.n - n) <= approach || along >= segLen - approach) {
      prev = tgt;
      if (++i >= route.length) return null;         // the commanded motion is over
    }
  }
  return null;
}

/**
 * THE SLIGHT DEVIATION: a few metres over, and keep going.
 *
 * Andy, 2026-09-04: *"Investigate forcing slight deviations in a given track to prevent
 * holds when there is still plenty of available water away from the nogo."*
 *
 * A hold is an expensive answer to a near miss. It stops the survey, it CANNOT BE RESUMED
 * (a hold replaces the vessel's plan with a single-waypoint route, and the console's only
 * way back is to re-upload the run from waypoint one), and beside a structure it hands a
 * stopped hull to the tide. Where the predicted path clips a keep-out but there is open
 * water alongside, the seamanlike answer is to go a little wide - so this searches for the
 * SMALLEST amendment to the track that puts the whole predicted path clear, and returns a
 * point the caller can splice into the running plan.
 *
 * ⚠ TWO SHAPES, BECAUSE THE TROUBLE COMES IN TWO SHAPES, and the first cut of this function
 * only had one. Offsetting perpendicular to the leg answers a boat being SET onto something
 * beside it. It does nothing at all for the other case, which is the commoner one: a corner
 * waypoint the hull cannot turn at. A DriX holds 20°/s, so at 7 kn it turns in ~10 m - and
 * routeAround puts its corner waypoints ON the buffer edge, 7 m off a pier face, where a
 * 10 m turn circle reaches 3 m INSIDE the structure. The water that answers that is BACK
 * ALONG THE LEG (start the turn earlier, go round wider), which is exactly the direction a
 * perpendicular offset cannot reach. So:
 *
 *   bend  a via spliced in abeam the trouble, the original waypoints all kept. The
 *         smallest disturbance to the operator's plan, and it is tried first.
 *   move  the next waypoint itself relocated - the only answer to a corner that cannot be
 *         flown. ⚠ ONLY WHEN THERE IS A WAYPOINT BEYOND IT: the console may move a corner,
 *         never a DESTINATION. Moving the last waypoint would quietly send the boat
 *         somewhere other than where it was sent, which is not a deviation, it is a
 *         different command.
 *
 * ⚠ THE OFFSET IS VERIFIED, NOT ESTIMATED. Every candidate is re-projected through
 * `projectRoute` - same turn rate, same drift, same keep-out model, same horizon - with the
 * amendment applied. A deviation the hull could not turn onto in time, or that the set would
 * carry it off anyway, fails that test and is never offered. Same discipline as the escape
 * search below: score the actual track, never the intention. It is also what makes `edge`
 * safe to fire at close range where `slow` is not - a throttle command has a ramp this model
 * does not carry, while a turn rate is exactly what the projection integrates.
 *
 * ⚠ AND IT MUST MOVE INTO REAL WATER, which is `edgeMarginM` over the buffer at the point
 * itself. Without that gate the search answers a tight pass with a marginally different
 * tight pass and stops telling the operator about it - Andy's condition was *"when there is
 * still plenty of available water"*, and this is that clause.
 *
 * DIRECTIONS ARE SEARCHED, NOT SOLVED, for the reason escapeCourse gives: a gradient off the
 * nearest feature points away from ONE thing, and a boat in trouble at a corner has two.
 * Sides are not preferred by handedness either - Rule 9 keep-right is a PLANNER concern
 * (narrowChannelLane) and belongs to the route, not to a two-metre correction on it.
 *
 * Returns null when no amendment inside the cap answers it - and the caller must read that
 * as "the ordinary rungs now", not as "nothing to do".
 */
export function edgeAround(p, hdgDeg, twMs, drift, route, ko, buf, opts = {}) {
  const hit = projectRoute(p, hdgDeg, twMs, drift, route, ko, buf, opts);
  if (!hit || !(hit.t > 0)) return null;          // clear, or already inside: not a deviation
  // ⚠ THE DEVIATION GOES WHERE THE TROUBLE IS, NOT WHERE THE BOAT IS. On a routed detour the
  // foul is usually at a corner two or three waypoints ahead; amending the leg being flown
  // now would move the track somewhere nothing was ever going to happen. `hit.i` is the
  // waypoint the projection was steering toward when it fouled, and the amendments below are
  // all measured from there.
  const k = Math.min(hit.i, route.length - 1);
  const cap = opts.capM ?? edgeCapM(buf);
  const stepM = opts.stepM ?? edgeStepM(buf);
  const margin = opts.marginM ?? edgeMarginM(buf);
  const degStep = opts.degStep ?? EDGE_DEG_STEP;
  const approach = opts.approachM ?? PROJECT_APPROACH_M;
  const horizon = opts.horizonS ?? HORIZON_S;
  // Every amendment is anchored to a LEG - the one ending at the waypoint it touches - so
  // its "ahead", its handedness and its "starting earlier" all mean something.
  const onLeg = (mode, idx, drop, at) => {
    const from = idx === 0 ? p : route[idx - 1];
    const de = route[idx].e - from.e, dn = route[idx].n - from.n, L = Math.hypot(de, dn);
    if (!(L >= 1)) return null;                    // a leg with no length has no direction
    return { mode, idx, drop, at, from, ue: de / L, un: dn / L, L };
  };
  // THREE SHAPES, BECAUSE THE TROUBLE COMES IN THREE SHAPES:
  //   bend        a via spliced into the fouled leg, every waypoint kept. Least disturbance
  //               to the operator's plan, so it is tried first.
  //   move k-1    the CORNER THE BOAT IS TURNING AT. ⚠ This is the one the first cut left
  //               out, and it is the commonest case: a DriX holds 20°/s, so at 7 kn it turns
  //               in ~10 m, and routeAround puts its corners ON the buffer edge - 7 m off a
  //               pier face, where a 10 m turn circle reaches 3 m INSIDE the structure. The
  //               foul is then on the leg AFTER the corner, and no amount of bending that
  //               leg helps: the boat has already committed to the turn. The water that
  //               answers it is back at the corner.
  //   move k      the waypoint being steered toward. ⚠ NEVER WHEN IT IS THE DESTINATION -
  //               relocating the last waypoint is not a deviation, it is a different
  //               command, and where a commanded point is itself unsafe hold.js moves it at
  //               COMMAND time and says so on the card.
  const bases = [];
  const bend = onLeg("bend", k, 0, null);
  if (bend) {
    const al = Math.min(bend.L, Math.max(0, (hit.at.e - bend.from.e) * bend.ue
                                          + (hit.at.n - bend.from.n) * bend.un));
    bend.at = { e: bend.from.e + bend.ue * al, n: bend.from.n + bend.un * al };
    bases.push(bend);
  }
  if (k >= 1) {
    const mv = onLeg("move", k - 1, 1, route[k - 1]);      // never the last: route[k] follows
    if (mv) bases.push(mv);
  }
  if (k < route.length - 1) {
    const mv = onLeg("move", k, 1, route[k]);
    if (mv) bases.push(mv);
  }
  if (!bases.length) return null;
  // ⚠ THE DEVIATION IS VERIFIED AT A BIGGER BUFFER THAN THE ONE THAT TRIGGERED IT, AND THAT
  // IS WHAT STOPS IT CHATTERING. Taking the SMALLEST offset that merely clears `buf` leaves
  // the boat a hair outside, so the next frame's projection - from a position three metres
  // further on - fouls again and asks for another deviation, and another. Measured live at
  // New Castle: three amendments in twelve seconds, then the budget was spent and the boat
  // held anyway. Verifying against `buf + margin` gives an accepted deviation that much give
  // before the guard can fire again, so ONE answer holds. Same shape as the release
  // counterfactual: ask the question of the state you are proposing to enter.
  const want = buf + margin;
  // Screening is coarse and short; the WINNER is re-projected at the caller's own step and
  // full horizon before it is offered. See EDGE_DEG_STEP for what this costs otherwise.
  const screen = { ...opts, stepS: (opts.stepS ?? STEP_S) * EDGE_SCREEN_STEP_MULT,
                   horizonS: Math.min(horizon, Math.max(EDGE_SCREEN_MIN_S, hit.t * 3)) };
  for (let d = stepM; d <= cap + 1e-9; d += stepM) {
    for (const base of bases) {
      const won = [];
      for (let a = 0; a < 360; a += degStep) {
        const r = a * D2R;
        const via = { e: base.at.e + d * Math.sin(r), n: base.at.n + d * Math.cos(r) };
        // AHEAD ALONG ITS OWN LEG, always. A candidate abeam or astern of where that leg
        // begins is not a deviation from the track, it is a reversal onto it - and it can
        // score CLEAR for the wrong reason, because time spent turning round is time in
        // which nothing is entered.
        //
        // ⚠ MUTATION SAYS THIS LINE IS CURRENTLY REDUNDANT, AND IT STAYS ANYWAY. Deleting
        // it changes no answer in any geometry tests/track_edge.js can find: a via astern
        // needs a turn the re-projection below already refuses. It is kept as a cheap,
        // explicit statement of the rule - the same call estop_chain records for its own
        // redundant layer - and check 17 sweeps 24 geometries rather than sampling one, so
        // the day the horizon does run out mid-reversal, it is caught.
        if ((via.e - base.from.e) * base.ue + (via.n - base.from.n) * base.un <= approach)
          continue;
        // THE WATER GATE, as a yes/no rather than a distance: "clearance >= want" and "not
        // blocked at want" are the same question, and `blocked` can stop at the first hit
        // where clearanceM must find the smallest. The winner's actual clearance is
        // measured once, below, for the operator to read.
        //
        // ⚠ MUTATION SAYS THIS TOO IS NOW REDUNDANT, and the reason is worth keeping: the
        // whole-track verification below runs at the SAME `want`, and a track that clears
        // `want` everywhere generally passes through water that does. It survives here for
        // two reasons that are not performance: it is Andy's condition stated in the code
        // where the decision is made, and it can still reject a via the track test would
        // accept - the projection advances a waypoint at the approach radius, so the boat
        // can pass wide of a via sitting in a pinch, and a waypoint the boat is COMMANDED
        // to is a place it may end up (it is where the plan holds if it is truncated, and
        // it is where the operator sees the track going).
        if (blocked(via, ko, want)) continue;      // not plenty of water - no answer at all
        const cand = [...route.slice(0, base.idx), via,
                      ...route.slice(base.idx + base.drop)];
        if (projectRoute(p, hdgDeg, twMs, drift, cand, ko, buf, screen)) continue;
        if (projectRoute(p, hdgDeg, twMs, drift, cand, ko, want, opts)) continue;
        won.push(via);
      }
      let best = null;
      for (const via of won) {
        const water = clearanceM(via, ko, want + cap);
        if (!best || water > best.water) {
          const oe = via.e - base.at.e, on = via.n - base.at.n;
          // Starboard of a course (ue, un) is (un, -ue); "early" is simply an offset with a
          // component back along the leg, which is what starting a turn sooner looks like.
          best = { via, offsetM: d, mode: base.mode, at: base.idx, drop: base.drop, water,
                   hand: (oe * base.un - on * base.ue) >= 0 ? "starboard" : "port",
                   early: (oe * base.ue + on * base.un) < 0, wasEntryIn: hit.t };
        }
      }
      if (best) return best;                       // BEND BEFORE MOVE at the same offset,
    }                                              // and the SMALLEST amendment that answers
  }
  return null;
}

/** The deviation in words, for a banner, a card and a suite that reads one string. */
export function edgeText(edge) {
  if (!edge) return "no deviation";
  return edge.offsetM.toFixed(1) + " m to " + edge.hand
    + (edge.early ? ", starting earlier" : "")
    + (edge.mode === "move" ? " (moving the next waypoint)" : " (a dog-leg, waypoints kept)");
}

/**
 * The rung this situation warrants.
 *
 * @param {{e,n}}  p        boat position in the model's frame
 * @param {{e,n}}  vel      GROUND velocity now (course and speed over ground: includes set)
 * @param {{e,n}}  drift    the ground velocity that would REMAIN with the engines stopped
 * @param {object} ko       keep-out model
 * @param {number} buf      the operator's buffer
 * @param {object} opts     `route` (waypoints AHEAD, {e,n}), `hdgDeg` and `twMs` together
 *                          switch the look-ahead to `projectRoute`; without all three it
 *                          stays the straight projection it has always been. `edge:false`
 *                          asks for the ranking without the deviation search.
 * @returns {{level, tEntry, tEntryDrift, why, onPlan, edge}}
 */
export function assess(p, vel, drift, ko, buf, opts = {}) {
  const horizon = opts.horizonS ?? HORIZON_S;
  const holdS = opts.holdS ?? HOLD_S;
  // FOLLOW THE PLAN WHEN THERE IS ONE. All three of route, heading and through-water speed
  // are needed to walk the boat; any of them missing is a vessel that is not being steered
  // along anything, and the straight-line projection is then the honest model rather than
  // the lazy one. See the header for what the straight line cost when it was the only one.
  const route = (opts.route && opts.route.length) ? opts.route : null;
  const onPlan = !!(route && opts.twMs > 0 && opts.hdgDeg != null);
  const hit = onPlan ? projectRoute(p, opts.hdgDeg, opts.twMs, drift, route, ko, buf, opts)
                     : null;
  const tEntry = onPlan ? (hit ? hit.t : null)
                        : timeToEntry(p, vel, ko, buf, horizon, opts.stepS);
  const track = onPlan ? "on the route ahead" : "on the present track";
  if (tEntry == null) {
    return { level: "clear", tEntry: null, tEntryDrift: null, onPlan, edge: null,
             why: "nothing within " + horizon + " s " + track };
  }
  // THE SECOND PROJECTION IS THE WHOLE DESIGN. Would taking the way off actually help, or
  // is it the water carrying us in? `drift` is what remains when the engines stop.
  const tDrift = timeToEntry(p, drift, ko, buf, horizon, opts.stepS);
  if (tDrift == null) {
    // ⚠ THE DEVIATION IS TRIED ONLY HERE, AND THE PLACEMENT IS THE SAFETY ARGUMENT. This
    // branch is the one where stopping would work - so anything gentler than stopping is a
    // strict improvement, and nothing about the in-extremis rung below is touched. Where
    // the drift-only track enters too, the water is doing the carrying and a few metres of
    // track is not an answer to it; that case goes to the helm exactly as it did before.
    const edge = (onPlan && opts.edge !== false)
      ? edgeAround(p, opts.hdgDeg, opts.twMs, drift, route, ko, buf, opts) : null;
    if (edge) {
      return { level: "edge", tEntry, tEntryDrift: null, onPlan, edge,
               why: "entry in " + tEntry.toFixed(0) + " s " + track + ", but "
                    + edgeText(edge) + " clears it with " + edge.water.toFixed(1)
                    + " m of water — deviating, not stopping" };
    }
    return { level: tEntry <= holdS ? "hold" : "slow", tEntry, tEntryDrift: null,
             onPlan, edge: null,
             why: "entry in " + tEntry.toFixed(0) + " s under way, but the drift-only track "
                  + "is clear — taking the way off answers it" };
  }
  return { level: "helm", tEntry, tEntryDrift: tDrift, onPlan, edge: null,
           why: "entry in " + tEntry.toFixed(0) + " s under way AND " + tDrift.toFixed(0)
                + " s on drift alone — stopping does not answer it" };
}

/**
 * The ground velocity the boat WOULD have if its through-water speed were restored.
 *
 * ⚠ THIS EXISTS SO THE RELEASE CAN BE TESTED, AND BECAUSE RELEASING ON THE TRIGGERING TEST
 * OSCILLATES. Slowing changes the very quantity the ladder measures: slow -> the projected
 * entry moves past the horizon -> "clear" -> speed restored -> the entry collapses back
 * inside it -> slow again, several times a minute, with the throttle chattering.
 *
 * So the release asks the same question of the state it is proposing to ENTER: at the speed
 * we are about to go back to, is it still clear? No arbitrary margin to tune, and it cannot
 * chatter by construction. The drift is kept and only the through-water part is rescaled -
 * a boat that is being set does not stop being set when it speeds up.
 */
export function restoreVel(vel, drift, restoreMs) {
  if (!vel || !drift || !(restoreMs > 0)) return vel;
  const tw = { e: vel.e - drift.e, n: vel.n - drift.n };      // through the water
  const s = Math.hypot(tw.e, tw.n);
  if (s < 0.05) return vel;                                   // no water track to rescale
  return { e: drift.e + (tw.e / s) * restoreMs,
           n: drift.n + (tw.n / s) * restoreMs };
}

/**
 * Where to go to get out of it: the heading that buys the most water, and a point on it.
 *
 * Searched rather than solved. A gradient off the nearest feature points away from ONE
 * thing, and the situation that needs this rung is usually a boat set into a corner with
 * two of them; sampling the whole compass picks the way out rather than the way off the
 * nearest wall.
 *
 * The escape is scored WITH the drift added, because a heading that is clear through the
 * water and downstream into the pier is not an escape. That is the same mistake as
 * commanding a heading and calling it a course.
 *
 * ⚠ TWO FAULTS, BOTH MEASURED (review #7, 2026-09-14), BOTH IN THIS SCORE:
 *   * ALREADY INSIDE THE BUFFER, IT FOUND NOTHING. timeToEntry answers 0 for every heading
 *     from a point already in the buffer, so every candidate "survived" nothing and this
 *     returned null - BOXED IN, TAKE MANUAL CONTROL - with open water straight behind the boat.
 *     That is the state this rung is most likely to fire in: a pier face south, a 2 kn set onto
 *     it, a 5 m buffer, found a way out at 5.5 m off and none at 4.5, 3 or 1.5 m. From inside,
 *     a heading now counts as clear when its track never touches the feature itself, leaves the
 *     buffer within the horizon, and then stays out of it for a whole horizon; the escape point
 *     is the end of that horizon, not a few meters past the edge.
 *   * THE TIE-BREAK WAS GROUND DISTANCE, while this comment said "distance made good away from
 *     trouble". Every heading that never enters ties on the horizon, and the fastest over the
 *     ground won - which, with the set running along a face, is ALONG the face: from 8 m off it
 *     chose 75 deg, 14 m clear after 10 s and 35 m after 45 s, where straight out gives 60 m and
 *     241 m. Ties are broken by CLEARANCE at the end of the track now.
 *
 * Returns null when nothing improves matters - and the caller must treat that as its own
 * answer, not as "no action needed".
 */
export function escapeCourse(p, drift, ko, buf, speedMs, opts = {}) {
  const horizon = opts.horizonS ?? HORIZON_S;
  const step = opts.stepS ?? STEP_S;
  const degStep = opts.degStep ?? ESCAPE_STEP_DEG;
  if (!(speedMs > 0)) return null;
  const inside = blocked(p, ko, buf);
  let best = null;
  for (let hdg = 0; hdg < 360; hdg += degStep) {
    const a = hdg * D2R;
    const v = { e: drift.e + speedMs * Math.sin(a), n: drift.n + speedMs * Math.cos(a) };
    let survived, clear, run;
    if (!inside) {
      const t = timeToEntry(p, v, ko, buf, horizon, step);
      survived = t == null ? horizon : t;
      clear = t == null;
      run = survived;
    } else {
      // From inside: never touch the feature itself, get out of the buffer, and stay out. Walked
      // at a quarter step with a 0.5 m hard margin, because a charted shoreline or dock LINE has
      // no width, and a 3 m stride at escape speed could step straight over one between samples.
      // The fine walk only lasts until the track is OUT; from there it is an ordinary track
      // outside the buffer, and the ordinary projection says whether it comes back in - which
      // keeps a 1500-zone chart to tens of milliseconds rather than a quarter of a second.
      // ⚠ OUT WITHIN THE HORIZON, THEN A WHOLE HORIZON OF CLEAR WATER - AND THE ESCAPE POINT IS
      // AT THE END OF IT. Measured against the other two readings of "get out and stay out":
      //   * a fixed exit deadline (10 s) refused a 15 m buffer in a 4 kn set - straight out
      //     takes 11.7 s - and read BOXED IN with open water behind the boat;
      //   * an escape point one horizon from NOW ended a late exit a few meters outside the
      //     buffer, holding in the set that put it there.
      // The vessel flies the escape as a line with the crab solved (SimVcu.tick), so a slow way
      // out is still the line that was checked; lingering is scored down by `worst`, not refused.
      let out = false, fouled = false, tOut = 0;
      const fine = step / 4;
      for (let tt = fine; tt <= horizon + 1e-9; tt += fine) {
        const q = { e: p.e + v.e * tt, n: p.n + v.n * tt };
        if (blocked(q, ko, ESCAPE_HARD_M)) { fouled = true; break; }
        if (!blocked(q, ko, buf)) { out = true; tOut = tt; break; }
      }
      if (out) {
        const q = { e: p.e + v.e * tOut, n: p.n + v.n * tOut };
        fouled = timeToEntry(q, v, ko, buf, horizon, step) != null;
      }
      clear = out && !fouled;
      survived = clear ? horizon : 0;
      run = clear ? tOut + horizon : 0;
    }
    // Score: how long the track stays clear; then the WORST clearance along it, sampled each
    // second; then the clearance it ends in. Distance away from trouble at every point, not
    // distance over the ground - and not only at the end, or a track that grazes a pile on its
    // way to open water beats one that goes round it (tests/in_extremis.js 10e). Only clear
    // tracks are measured, so the cost is bounded by the headings that are actually answers.
    const to = { e: p.e + v.e * run, n: p.n + v.n * run };
    let worst = 0, gain = 0;
    if (clear) {
      gain = worst = clearanceM(to, ko);
      for (let tt = 1; tt < run; tt += 1) {
        const c = clearanceM({ e: p.e + v.e * tt, n: p.n + v.n * tt }, ko);
        if (c < worst) worst = c;
      }
    }
    if (!best || (clear && !best.clear) || (clear === best.clear
        && (survived > best.survived + 1e-9
            || (Math.abs(survived - best.survived) < 1e-9
                && (worst > best.worst + 1e-6
                    || (Math.abs(worst - best.worst) <= 1e-6 && gain > best.gain)))))) {
      best = { hdg, survived, worst, gain, clear, to };
    }
  }
  // Refusing is a real answer here. If every heading enters within the horizon, the boat is
  // boxed in and a confident-looking escape would be a lie; the caller alarms and leaves the
  // helm to the operator, who can see things this model cannot.
  return best && best.clear ? best : null;
}
