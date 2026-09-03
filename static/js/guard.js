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
//   slow    entry is predicted, and taking the way off WOULD avoid it. Buy time.
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
// ⚠ NOTHING HERE COMMANDS ANYTHING. This module answers "what is ahead and what does it
// warrant"; the caller decides and commands. That separation is what lets the numbers be
// shown on the card, and tested, without a boat moving - the same split the clearance
// readout already has.

import { blocked } from "./keepouts.js";

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

const D2R = Math.PI / 180;

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
 * The rung this situation warrants.
 *
 * @param {{e,n}}  p        boat position in the model's frame
 * @param {{e,n}}  vel      GROUND velocity now (course and speed over ground: includes set)
 * @param {{e,n}}  drift    the ground velocity that would REMAIN with the engines stopped
 * @param {object} ko       keep-out model
 * @param {number} buf      the operator's buffer
 * @returns {{level, tEntry, tEntryDrift, why}}
 */
export function assess(p, vel, drift, ko, buf, opts = {}) {
  const horizon = opts.horizonS ?? HORIZON_S;
  const holdS = opts.holdS ?? HOLD_S;
  const tEntry = timeToEntry(p, vel, ko, buf, horizon, opts.stepS);
  if (tEntry == null) {
    return { level: "clear", tEntry: null, tEntryDrift: null,
             why: "nothing within " + horizon + " s on the present track" };
  }
  // THE SECOND PROJECTION IS THE WHOLE DESIGN. Would taking the way off actually help, or
  // is it the water carrying us in? `drift` is what remains when the engines stop.
  const tDrift = timeToEntry(p, drift, ko, buf, horizon, opts.stepS);
  if (tDrift == null) {
    return { level: tEntry <= holdS ? "hold" : "slow", tEntry, tEntryDrift: null,
             why: "entry in " + tEntry.toFixed(0) + " s under way, but the drift-only track "
                  + "is clear — taking the way off answers it" };
  }
  return { level: "helm", tEntry, tEntryDrift: tDrift,
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
 * two of them; sampling the whole compass and scoring the WORST clearance along each
 * candidate track picks the way out rather than the way off the nearest wall.
 *
 * The escape is scored WITH the drift added, because a heading that is clear through the
 * water and downstream into the pier is not an escape. That is the same mistake as
 * commanding a heading and calling it a course.
 *
 * Returns null when nothing improves matters - and the caller must treat that as its own
 * answer, not as "no action needed".
 */
export function escapeCourse(p, drift, ko, buf, speedMs, opts = {}) {
  const horizon = opts.horizonS ?? HORIZON_S;
  const step = opts.stepS ?? STEP_S;
  const degStep = opts.degStep ?? ESCAPE_STEP_DEG;
  if (!(speedMs > 0)) return null;
  let best = null;
  for (let hdg = 0; hdg < 360; hdg += degStep) {
    const a = hdg * D2R;
    const v = { e: drift.e + speedMs * Math.sin(a), n: drift.n + speedMs * Math.cos(a) };
    const t = timeToEntry(p, v, ko, buf, horizon, step);
    // Score by how long the track stays clear, then by how far it gets. A heading that
    // never enters within the horizon scores the horizon itself, so several may tie - and
    // the tie is broken by distance made good away from trouble.
    const survived = t == null ? horizon : t;
    const reach = Math.hypot(v.e, v.n) * survived;
    if (!best || survived > best.survived + 1e-9
        || (Math.abs(survived - best.survived) < 1e-9 && reach > best.reach)) {
      best = { hdg, survived, reach, clear: t == null,
               to: { e: p.e + v.e * survived, n: p.n + v.n * survived } };
    }
  }
  // Refusing is a real answer here. If every heading enters within the horizon, the boat is
  // boxed in and a confident-looking escape would be a lie; the caller alarms and leaves the
  // helm to the operator, who can see things this model cannot.
  return best && best.clear ? best : null;
}
