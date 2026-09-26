// static/js/ais_keepout.js - AIS contacts as keep-outs the boat must not enter.
//
// Andy, 2026-09-25:
//
//   "Treat AIS targets with dimensions as NOGO areas. They may be moving so the calculation
//    must update with them. If the AIS target moves through a survey area it will not force a
//    survey pattern reconfiguration. But the ASV will avoid the AIS target and return to the
//    survey line once it is clear with a 100m backup over previously run line. AIS targets
//    without dimensions are to be assumed 20m long and 8m wide."
//
// and, a minute later: "disregard the 20m perimeter buffer" - so THE HULL IS THE KEEP-OUT. The
// only margin around it is the vessel's own keep-clear buffer, applied by `blocked` exactly as
// it is to a pier; nothing here adds a meter to a contact that was not broadcast.
//
// WHAT ONE CONTACT BECOMES. A polygon in the keep-out model's own frame, shaped like the model's
// charted polygons (`{ring, bb, kind}`) so `blocked`, `clearanceM`, `blockedInfo`, `legClear`
// and the guard's projections take it without a special case:
//
//   * the hull box the contact broadcasts (targets.hullBox: A/B/C/D about the GNSS antenna,
//     so a 300 m ship with the bridge aft has its bow where the water is, not 150 m short),
//     or AIS_DEFAULT_LENGTH_M x AIS_DEFAULT_BEAM_M about the antenna where it broadcasts none;
//   * oriented by her heading, else her course over the ground while she is under way; a
//     stationary contact with neither is a disc of the box's half-diagonal, which is every
//     orientation at once;
//   * DEAD-RECKONED from her last report by her own course and speed, so the box moves between
//     polls rather than jumping at each one - capped at AIS_DR_MAX_S, past which a prediction is
//     a guess and the box stays where the last honest one put it;
//   * and, while she is under way, SWEPT: the convex hull of the box now and the box `sweepS`
//     seconds on. That is "the calculation must update with them" made concrete. The guard's
//     look-ahead walks OUR boat forward against a model it takes as fixed; a contact that is
//     itself moving is only in that model where she is NOW, and a boat stopped in her path would
//     read clear right up to the frame her bow arrived. The sweep is the water she will occupy
//     within the same look-ahead, so a crossing contact holds the boat AHEAD of her track and a
//     contact bearing down reads in extremis - and steers the escape out of her way - while
//     there is still water to do it in. It is not a buffer: a stationary contact has none.
//
// ⚠ IT IS NOT PART OF THE PLANNER'S MODEL, AND MUST NEVER BE. `nogo.ko` is what the punch, the
// router and the readouts are built from; these polygons are folded into the copy the clearance
// guard acts on, per frame, and into nothing else. A ship crossing the survey area reconfigures
// no pattern - the boat avoids her and goes back (static/asv.html, aisReturnTick).
//
// ⚠ NOTHING HERE COMMANDS ANYTHING, and nothing here is cached: every call builds the polygons
// from the contacts it is handed and the clock it is given, so the answer can never be older
// than the report it came from - the same argument targets.js makes for CPA.

import { hullBox, velocityEN } from "./targets.js";
import { bbOf } from "./geometry.js";
import { HORIZON_S } from "./guard.js";

/** The hull assumed for a contact that broadcasts no size, meters. Andy's numbers. */
export const AIS_DEFAULT_LENGTH_M = 20;
export const AIS_DEFAULT_BEAM_M = 8;
/** Dead-reckon a contact from its last position report for at most this long, seconds. */
export const AIS_DR_MAX_S = 60;
/** Below this speed over the ground a contact is stationary: not dead-reckoned, not swept. */
export const AIS_MOVING_KN = 0.5;
/** Contacts farther than this from the boat (now or at the end of their sweep) are not modelled. */
export const AIS_KO_RANGE_M = 3000;
/** A poll older than this is no model at all - the guard says so rather than reading a quiet sea. */
export const AIS_KO_STALE_S = 40;

const D2R = Math.PI / 180;

/**
 * The hull box to model a contact with: what she broadcast, or the assumed hull.
 *
 * `assumed` is true only when NOTHING was broadcast. A partial report (a length with no beam)
 * is sized by hullBox at a plausible ratio and is not "assumed" - a size was reported.
 */
export function aisBox(v) {
  const hb = hullBox(v);
  if (hb) return { ...hb, assumed: false };
  const L = AIS_DEFAULT_LENGTH_M, B = AIS_DEFAULT_BEAM_M;
  return { lengthM: L, beamM: B, toBowM: L / 2, toSternM: L / 2, toPortM: B / 2, toStbdM: B / 2,
           exact: false, assumed: true };
}

/**
 * Which way the hull points: her true heading where she reports one, else her course over the
 * ground while she is under way. A stationary contact's COG is report noise, not a direction.
 */
export function aisHeadingDeg(v, moving) {
  const h = v && v.heading;
  if (h != null && Number.isFinite(+h) && +h >= 0 && +h < 360) return +h;
  const c = v && v.cog;
  if (moving && c != null && Number.isFinite(+c)) return ((+c) % 360 + 360) % 360;
  return null;
}

/**
 * Seconds since the contact's position report: the service's own `age` at the moment it was
 * polled, plus the time since that poll.
 */
export function aisAgeS(v, polledAtMs, nowMs) {
  const since = polledAtMs > 0 && nowMs > polledAtMs ? (nowMs - polledAtMs) / 1000 : 0;
  return Math.max(0, (+(v && v.age) || 0) + since);
}

/** The four corners of a hull box about its antenna `c` (frame meters), pointing `hdgDeg`. */
export function hullRingEN(c, hdgDeg, box) {
  const a = hdgDeg * D2R;
  const fe = Math.sin(a), fn = Math.cos(a);          // forward
  const re = Math.cos(a), rn = -Math.sin(a);         // to starboard
  const pt = (f, r) => ({ e: c.e + fe * f + re * r, n: c.n + fn * f + rn * r });
  return [pt(box.toBowM, box.toStbdM), pt(box.toBowM, -box.toPortM),
          pt(-box.toSternM, -box.toPortM), pt(-box.toSternM, box.toStbdM)];
}

/** A disc of radius `r` about `c`, as a ring - every orientation of a hull whose heading is unknown. */
export function discRingEN(c, r, n = 12) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    out.push({ e: c.e + r * Math.sin(a), n: c.n + r * Math.cos(a) });
  }
  return out;
}

/** Convex hull of frame points (Andrew's monotone chain), counter-clockwise, no repeat of the first. */
export function convexHull(pts) {
  const P = pts.slice().sort((a, b) => (a.e - b.e) || (a.n - b.n));
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a.e - o.e) * (b.n - o.n) - (a.n - o.n) * (b.e - o.e);
  const lower = [];
  for (const p of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/**
 * ONE contact as a keep-out polygon in `frame`, or null when she is not modelled (no position,
 * or beyond `rangeM` of `own` both now and at the end of her sweep).
 *
 * opts: now (ms), polledAt (ms the contacts were fetched), own ({e,n} the boat), rangeM,
 *       sweepS (default: the guard's HORIZON_S; 0 disables the sweep).
 *
 * Returns {ring, bb, kind, mmsi, name, moving, sweepS, at, hull, box}: `ring`/`bb`/`kind` are
 * what the keep-out model reads; `hull` is the un-swept box and `at` the dead-reckoned
 * antenna, for the chart.
 */
export function aisKeepout(v, frame, opts = {}) {
  if (!v || !frame || v.lat == null || v.lon == null) return null;
  const lat = +v.lat, lon = +v.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const now = +opts.now || 0;
  const sog = (v.sog != null && Number.isFinite(+v.sog) && +v.sog >= 0) ? +v.sog : null;
  const vel = (sog != null && sog >= AIS_MOVING_KN) ? velocityEN(sog, v.cog) : null;   // null: no course
  const moving = !!vel;
  const c = frame.toEN({ lat, lon });
  // Dead reckoning, capped: past AIS_DR_MAX_S the box stays where the last honest position put it.
  const dr = moving ? Math.min(aisAgeS(v, +opts.polledAt || 0, now), AIS_DR_MAX_S) : 0;
  const c0 = { e: c.e + (moving ? vel.e * dr : 0), n: c.n + (moving ? vel.n * dr : 0) };
  const sweepS = moving ? Math.max(0, opts.sweepS == null ? HORIZON_S : +opts.sweepS) : 0;
  const c1 = sweepS > 0 ? { e: c0.e + vel.e * sweepS, n: c0.n + vel.n * sweepS } : null;
  if (opts.own) {
    const range = opts.rangeM == null ? AIS_KO_RANGE_M : +opts.rangeM;
    const d0 = Math.hypot(c0.e - opts.own.e, c0.n - opts.own.n);
    const d1 = c1 ? Math.hypot(c1.e - opts.own.e, c1.n - opts.own.n) : d0;
    if (Math.min(d0, d1) > range) return null;
  }
  const box = aisBox(v);
  const hdg = aisHeadingDeg(v, moving);
  const shape = (at) => hdg == null
    ? discRingEN(at, Math.hypot(box.lengthM, box.beamM) / 2)
    : hullRingEN(at, hdg, box);
  const hull = shape(c0);
  const ring = c1 ? convexHull(hull.concat(shape(c1))) : hull;
  const size = Math.round(box.lengthM) + " x " + Math.round(box.beamM) + " m" + (box.assumed ? " assumed" : "");
  const name = (v.name != null && String(v.name).trim()) ? String(v.name).trim() : null;
  const kind = "AIS: " + (name || ("MMSI " + v.mmsi)) + " (" + size
    + (moving ? ", " + sog.toFixed(1) + " kn" : "") + ")";
  return { ring, bb: bbOf(ring), kind, mmsi: v.mmsi, name, moving, sweepS: c1 ? sweepS : 0,
           at: c0, hull, box, hdg };
}

/**
 * THE AIS KEEP-OUT MODEL for one frame: the contacts near the boat as polygons, or none with a
 * reason. `stale` is the answer the guard must not mistake for "no contacts": a poll older than
 * AIS_KO_STALE_S (or no poll yet) is a feed that has stopped answering, and the caller says so.
 *
 * opts as for aisKeepout, plus staleS (default AIS_KO_STALE_S).
 */
export function aisKeepouts(vessels, frame, opts = {}) {
  const now = +opts.now || 0;
  if (!frame) return { polys: [], stale: false, note: "no chart frame" };
  const polledAt = +opts.polledAt || 0;
  if (!(polledAt > 0)) return { polys: [], stale: true, note: "no AIS poll has answered yet" };
  const ageS = Math.max(0, (now - polledAt) / 1000);
  const staleS = opts.staleS == null ? AIS_KO_STALE_S : +opts.staleS;
  if (ageS > staleS) {
    return { polys: [], stale: true,
             note: "the last AIS poll that answered is " + Math.round(ageS) + " s old" };
  }
  const polys = [];
  for (const v of (vessels || [])) {
    const q = aisKeepout(v, frame, opts);
    if (q) polys.push(q);
  }
  return { polys, stale: false,
           note: polys.length + " AIS contact" + (polys.length === 1 ? "" : "s") + " modelled" };
}
