// static/js/targets.js - what an AIS contact is DOING relative to us.
//
// Andy, 2026-09-02: *"Add and recalculate CPA/TCPA as needed especially after a
// maneuver. ... These data will be used for advanced features when we implement sensor
// fusion and advanced target analysis."*
//
// CPA is the closest the two vessels will come if BOTH hold their present course and
// speed; TCPA is how long until that happens. They are the two numbers every collision
// judgement is built on, and the console had neither.
//
// ⚠ "RECALCULATE AFTER A MANOEUVRE" IS NOT A FEATURE HERE - IT IS THE CONSEQUENCE OF
// THESE BEING PURE FUNCTIONS OF THE PRESENT KINEMATICS. There is no stored CPA to go
// stale and no event to miss: `cpa()` reads the positions and velocities it is handed at
// the moment it is called, so the answer follows a manoeuvre by EITHER vessel the instant
// the next position report lands. The alternative - computing once and updating on a
// detected "manoeuvre" - needs a manoeuvre detector, and a missed detection there is a
// stale CPA that reads as authoritative. This way the number cannot be older than the
// data it came from.
//
// ⚠ AND CPA IS A PREDICTION, NOT A MEASUREMENT. It assumes both vessels hold course and
// speed; it says nothing about what a ship under a pilot's hand is about to do. It is an
// input to a watch, never a substitute for one. The console reports it and does not steer
// on it - the RC transmitter is master, and nothing in this file commands anything.

import { planeFrame } from "./geodesy.js";

/** Knots to metres per second. */
export const KN_TO_MS = 0.514444;

/**
 * How slowly the two can be closing before a CPA is meaningless.
 *
 * Below this the relative velocity is dominated by report noise rather than by motion:
 * TCPA = -(R·V)/|V|² divides by |V|², so a near-zero relative speed produces enormous
 * times from millimetres of jitter. Two vessels drifting together at under this are not
 * "converging in four hours", they are sitting there, and the honest answer is to say so.
 */
export const MIN_REL_SPEED_MS = 0.05;      // ~0.1 kn

/**
 * Course-and-speed vector in metres per second, east/north.
 *
 * Course over GROUND, not heading: CPA is about where the hull is going, and a vessel
 * crabbing in a cross-set has a heading that points somewhere it is not travelling. Where
 * COG is absent the contact is not reporting a track and there is nothing to project -
 * that is a null, not a zero, because a zero would assert the vessel is stopped.
 */
export function velocityEN(sog, cog) {
  if (sog == null || cog == null) return null;
  const v = sog * KN_TO_MS, a = cog * Math.PI / 180;
  return { e: v * Math.sin(a), n: v * Math.cos(a) };
}

/**
 * Closest point of approach between `own` and `target`.
 *
 * Both are {lat, lon, sog, cog}. Returns null when either lacks a track. Otherwise:
 *
 *   { rangeM, bearingDeg, cpaM, tcpaS, closing, relSpeedMs }
 *
 * `tcpaS` is NEGATIVE when the closest approach is in the PAST - the vessels are already
 * opening - and `closing` says which case you are in. Reporting a past CPA as though it
 * were ahead is the one wrong answer that looks like a working alarm, so the sign is
 * carried rather than clamped.
 *
 * Computed in a LOCAL TANGENT PLANE anchored at own vessel (the estate's rule - chaining
 * "exact" geodesic steps fans out, a plane does not). Over the few miles a CPA matters
 * across, the plane is the right model and the geodesy is noise beside the AIS position
 * error.
 */
export function cpa(own, target) {
  if (!own || !target) return null;
  const vo = velocityEN(own.sog, own.cog), vt = velocityEN(target.sog, target.cog);
  if (!vo || !vt) return null;
  const frame = planeFrame({ lat: own.lat, lon: own.lon });
  const O = frame.toEN(own), T = frame.toEN(target);
  const R = { e: T.e - O.e, n: T.n - O.n };            // own -> target
  const V = { e: vt.e - vo.e, n: vt.n - vo.n };        // target's motion relative to us
  const rangeM = Math.hypot(R.e, R.n);
  const bearingDeg = (Math.atan2(R.e, R.n) * 180 / Math.PI + 360) % 360;
  const relSpeedMs = Math.hypot(V.e, V.n);
  if (relSpeedMs < MIN_REL_SPEED_MS) {
    // Holding station on each other. The range is the CPA, now and indefinitely; there
    // is no TIME at which it happens, and inventing one would be a fiction.
    return { rangeM, bearingDeg, cpaM: rangeM, tcpaS: null, closing: false, relSpeedMs };
  }
  const tcpaS = -(R.e * V.e + R.n * V.n) / (relSpeedMs * relSpeedMs);
  const cpaM = Math.hypot(R.e + V.e * tcpaS, R.n + V.n * tcpaS);
  return { rangeM, bearingDeg, cpaM, tcpaS, closing: tcpaS > 0, relSpeedMs };
}

/**
 * The hull's on-chart footprint in metres, from whatever AIS gave us.
 *
 * AIS dimensions are referenced to the GNSS ANTENNA, not to the hull: A forward to the
 * bow, B aft to the stern, C to port, D to starboard. So the antenna - which is where the
 * reported lat/lon IS - sits at (C, A) within an (C+D) x (A+B) box, and on a 300 m ship
 * with the bridge aft that offset is most of the hull. Drawing the box centred on the
 * position would put a container ship's bow 100 m from where it really is.
 *
 * Returns null when nothing was broadcast, so the caller can fall back to a fixed glyph
 * rather than draw a vessel one metre long.
 */
export function hullBox(v) {
  const d = v && v.dim;
  const len = v && v.length, beam = v && v.beam;
  if (!len && !beam) return null;
  // A partial report still sizes the icon: a known length with an unknown beam is drawn
  // at a plausible 1:6 ratio rather than discarded, and vice versa.
  const L = len || (beam ? beam * 6 : 0);
  const B = beam || (len ? len / 6 : 0);
  if (!(L > 0 && B > 0)) return null;
  // Where the reported position sits inside that box. Without the parts, assume the
  // antenna is amidships - which is what a centred glyph has always silently assumed.
  const fwd = d && d.a ? d.a : L / 2;          // antenna -> bow
  const port = d && d.c ? d.c : B / 2;         // antenna -> port side
  return { lengthM: L, beamM: B, toBowM: fwd, toSternM: L - fwd,
           toPortM: port, toStbdM: B - port, exact: !!(len && beam) };
}
