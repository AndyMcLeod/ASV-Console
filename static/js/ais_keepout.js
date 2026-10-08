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
// ⚠ A CONTACT UNDER WAY IS NOT PART OF THE PLANNER'S MODEL, AND MUST NEVER BE. `nogo.ko` is what
// the punch, the router and the readouts are built from; these polygons are folded into the copy
// the clearance guard acts on, per frame. A ship crossing the survey area reconfigures no pattern -
// the boat avoids her and goes back (static/asv.html, aisReturnTick).
// ⚠⚠ ONE EXCEPTION, AND ONLY FOR A PASSAGE (Andy, 2026-10-07): a vessel NOT under way is as fixed
// as the pier she lies at, and a Go-To, an RTH or a transit leg is laid round her as round the
// pier - aisMooredKeepouts below, folded in by passage.js passageKo, never into `nogo.ko` itself
// and never into a survey pattern's lines. His RTH outbound passed NORD LOGOS, 132 m, stopped at
// the Newington pier, 79 m off her AIS fix at 10 kn, and nothing in the route had known she was there.
//
// ⚠ NOTHING HERE COMMANDS ANYTHING, and nothing here is cached: every call builds the polygons
// from the contacts it is handed and the clock it is given, so the answer can never be older
// than the report it came from - the same argument targets.js makes for CPA.

import { hullBox, velocityEN } from "./targets.js";
import { bbOf } from "./geometry.js";
import { HORIZON_S } from "./guard.js";
import { clearanceM } from "./keepouts.js";
import { coastLc, coastRun, slowLaw, slowRun, SLOW_LAG_RAMP_MS } from "./coast.js";

/** The hull assumed for a contact that broadcasts no size, meters. Andy's numbers. */
export const AIS_DEFAULT_LENGTH_M = 20;
export const AIS_DEFAULT_BEAM_M = 8;
/** Dead-reckon a contact from its last position report for at most this long, seconds. */
export const AIS_DR_MAX_S = 60;
/** Below this speed over the ground a contact is stationary: not dead-reckoned, not swept. */
export const AIS_MOVING_KN = 0.5;
// NOT UNDER WAY, THOUGH SHE REPORTS A SPEED (2026-09-28). FRIGGA at New Castle: 0.4 to 0.8 kn, twenty minutes
// between reports, at anchor - and at 0.8 kn she was modelled as under way, dead-reckoned a minute and swept 45 s
// ahead, 43 m of phantom hull pointing up her course that reached the way round her. A transponder under way
// reports every few seconds; one reporting minutes apart at under AIS_MOVING_SURE_KN is a vessel at anchor or
// moored with GPS jitter on her speed, and her navigational status, where she sends one, says so outright.
// ⚠ THE NUMBERS, after the review of 2026-09-28: 180 s sat exactly on Class B's own reporting interval at under
// 2 kn (ITU-R M.1371: every 3 minutes, and a Class B report carries no navigational status), so a slow contact
// genuinely under way flipped to "not under way" between two of her own reports; 400 s is past that interval with
// margin for the console's own polling. And a navigational status counts only while she is doing under
// AIS_NAV_TRUST_KN - "at anchor" left set at 6 kn is the commonest AIS data error there is, and the standard
// itself trusts "at anchor or moored" only while not moving faster than 3 knots.
export const AIS_MOVING_AGE_S = 400;      // a report older than this ...
export const AIS_MOVING_SURE_KN = 2.0;    // ... at under this speed is a vessel not under way
export const AIS_NAV_STOPPED = new Set([1, 5, 6]);   // navigational status: at anchor, moored, aground ...
export const AIS_NAV_TRUST_KN = 3.0;      // ... believed only while she is doing under this
export function aisNavWord(nav) { return nav == 1 ? "at anchor" : nav == 5 ? "moored" : nav == 6 ? "aground" : null; }
/** Contacts farther than this from the boat (now or at the end of their sweep) are not modelled. */
export const AIS_KO_RANGE_M = 3000;
/** A poll older than this is no model at all - the guard says so rather than reading a quiet sea. */
export const AIS_KO_STALE_S = 40;
/**
 * THE GUARD SEES A CONTACT FROM THIS FAR, AND NO FARTHER (Andy, 2026-09-29: "The buffer zone on approach to an AIS
 * target appears to be 150m. confirm distance and modify to 50m.")
 *
 * It was not a setting. The guard looks HORIZON_S (45 s) ahead of the boat, and a contact was a keep-out like a pier,
 * so she was slowed wherever the next 45 s of track reached a hull: 139 m at 6 kn. MEASURED in his 17:23 session: the
 * slow-down for TEST-1 began with the boat 132 m from her reported position, and she then crept at LOW for two and a
 * half minutes before holding 21 m off. A pier needs that horizon. A contact now joins the guard's model only once
 * her keep-out - her hull, swept along her own track while she is under way - is within this of the boat. Charted
 * keep-outs keep the whole horizon, and the escape, the way round, the return and the hold disc still see every
 * contact: this is when the ladder starts answering one, not whether she is known.
 */
export const AIS_LOOKAHEAD_M = 50;
/** The contacts the ladder acts on: those whose keep-out lies within `m` of the boat at `own` (the model's frame). */
export function aisInReach(own, polys, m = AIS_LOOKAHEAD_M) {
  if (!own || !polys || !polys.length) return [];
  return polys.filter(q => clearanceM(own, { polys: [q], lines: [], points: [] }, m + 1) <= m);
}
/**
 * THE REACH A HULL NEEDS (Andy, 2026-09-29, when the stopping margin was raised: "extend for drix if necessary").
 * AIS_LOOKAHEAD_M is where the answer to a contact BEGINS. A hull that sheds way slowly has to be seen earlier by the
 * water it takes her to come down to LOW first, or she arrives at the 50 m still at speed. That water is her own
 * slow-down law plus what the set carries her in those seconds. A hull with no datum, or already at LOW, from 50 m.
 *
 * ⚠ THE GUARD'S SLOW IS FLOWN IN GEAR, AND ON THE DriX THAT IS NOT A COAST (measured from her logs 2026-10-03; Andy:
 * "Build the fix with the 3.3 s lag"). A cut to LOW goes to idle with the clutch in, so she decays toward her
 * idle-in-gear speed after a dead time - 6.2 -> 4.0 kn took 32.5 m and 13.0 s (n=20), where the prop-out coast law
 * this used to apply allowed 15.4 m and 6.1 s. So a vessel that declares `maneuvering.slowdown` is answered with
 * THAT law (coast.js slowRun); one that declares only `maneuvering.coast` keeps the coast law (coastRun); neither, 50 m.
 * The DriX: ~87 m at her real 6.2 kn through the water (100 m in a 1.75 kn set), ~93 m at a literal 7 kn, ~124 m at
 * 14 kn - and that last is an extrapolation, since her logs never show her above ~10.6 kn through the water. The page
 * asks it with the console's command delay too (`latencyS`, below): ~90 / ~96 / ~131 m.
 *
 * @param {object} man     the vessel's `maneuvering` block ({coast, slowdown}); a bare coast block (it has `from_kn`)
 *                         is still taken, as the coast law alone - the form this function took before 2026-10-03
 * @param {number} twMs    her speed through the water, m/s
 * @param {number} lowMs   the speed the guard slows her to (LOW), m/s
 * @param {number} driftMs the set's speed, m/s
 * @param {number} latencyS the console's own delay before her SLOW reaches her (the page passes SPEED_CMD_LATENCY_S):
 *                          she runs on at her speed - and the set with her - for that long first. ⚠ ADDED 2026-10-03
 *                          (Andy: "fix the guard's model of slowing down"): without it, a contact first in reach at
 *                          7 kn read 20.1 s to entry against the 20 s HOLD_S - a tenth of a second of margin - and at
 *                          14 kn the slow-down the guard offered could not be had before the hold fired. 0 = as before.
 */
export function aisReachM(man, twMs, lowMs, driftMs = 0, baseM = AIS_LOOKAHEAD_M, latencyS = 0) {
  const bare = !!(man && man.from_kn != null);
  const law = bare ? null : slowLaw(man && man.slowdown);
  let run = null;
  if (law) run = slowRun(twMs, lowMs, law);
  else {
    const lc = coastLc(bare ? man : (man && man.coast));
    run = lc ? coastRun(twMs, lowMs, lc.lc) : null;
  }
  if (!run) return baseM;
  const d = driftMs > 0 ? driftMs : 0;
  // ⚠ RAMPED IN ACROSS THE HALF KNOT ABOVE THE TARGET, as the dead time is (SLOW_LAG_RAMP_MS): charged in full it made the
  // reach jump 50.0 -> 52.1 m between 4.000 and 4.001 kn - the frame-to-frame flicker at LOW the ramp exists to stop (review)
  const ramp = Math.min(1, Math.max(0, twMs - (run.v1eff != null ? run.v1eff : lowMs)) / SLOW_LAG_RAMP_MS);
  return baseM + run.m + d * run.s + (latencyS > 0 ? (twMs + d) * latencyS * ramp : 0);
}

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
 * IS SHE UNDER WAY, AND WHICH WAY DOES SHE POINT - ONE RULE, for the keep-out AND the AIS layer (2026-09-30).
 *
 * Andy, 2026-09-30, at the Port of Los Angeles: "The AIS targets at the pier ... show 2 separate states. The red
 * outlines are perfectly alongside their respective pier as expected, while the green targets are rotated." Two
 * drawings of one ship, turned by two different rules: the red outline (the keep-out, aisKeepout below) pointed the
 * hull along her HEADING, and along her course only while she was under way; the AIS layer's hull (the page's
 * drawAIS) pointed it along her COURSE OVER GROUND first. A moored ship's course over the ground is GNSS noise, not a
 * direction. Measured on his own feed round Pier 300: CMA CGM AMAZON moored at 0.0 kn, heading 251 - the berth's axis
 * - and course 327.5, so the layer drew her 76 deg across her berth; 21 of the 45 contacts nearest the pier were drawn
 * more than 10 deg off their own keep-out. Both drawings now ask this, so the two cannot disagree again.
 *
 * `moving` is the keep-out's test, unchanged: making AIS_MOVING_KN with a course, and neither saying she is stopped
 * (moored, at anchor or aground - AIS_NAV_STOPPED - at under AIS_NAV_TRUST_KN) nor reporting like a vessel at anchor
 * (under AIS_MOVING_SURE_KN with a report older than AIS_MOVING_AGE_S). `vel` is her ground velocity then, else null.
 * `hdg` is where the BOW points (aisHeadingDeg): her true heading where she reports one; her course only while she is
 * under way; null when neither - a stopped ship with no heading can lie any way round, and is drawn and kept out as
 * the disc every orientation of her fits in (aisDiscM). `from` says which, in words for the hover tip: "heading",
 * "course" or null.
 *
 * opts: now (ms), polledAt (ms the contacts were fetched) - for the age that decides "reporting like one at anchor".
 */
export function aisMotion(v, opts = {}) {
  const now = +opts.now || 0;
  const sog = (v && v.sog != null && Number.isFinite(+v.sog) && +v.sog >= 0) ? +v.sog : null;
  const ageS = aisAgeS(v, +opts.polledAt || 0, now);
  const navStopped = !!v && v.nav != null && AIS_NAV_STOPPED.has(+v.nav)
                     && (sog == null || sog < AIS_NAV_TRUST_KN);                          // she says she is stopped, and is not plainly under way
  const slowAndOld = sog != null && sog < AIS_MOVING_SURE_KN && ageS > AIS_MOVING_AGE_S;   // reporting like one
  const vel = (sog != null && sog >= AIS_MOVING_KN && !navStopped && !slowAndOld) ? velocityEN(sog, v.cog) : null;   // null: no course
  const moving = !!vel;
  const hdg = aisHeadingDeg(v, moving);
  const h = v && v.heading;
  const from = hdg == null ? null : (h != null && Number.isFinite(+h) && +h >= 0 && +h < 360) ? "heading" : "course";
  return { sog, ageS, navStopped, vel, moving, hdg, from };
}

/** The radius of the disc a contact whose orientation is unknown is kept out as, and drawn as, round her ANTENNA: half
 *  her hull's diagonal - every orientation of her fits in it when the antenna is amidships. ⚠ NOT when it is well
 *  forward or aft: a 300 m ship with her antenna 50 m from the stern can swing her bow 250 m from it, outside a 150 m
 *  disc. Recorded, not changed here (2026-09-30): growing it is a change to the guard's model, not to a drawing. */
export function aisDiscM(box) {
  return Math.hypot(box.lengthM, box.beamM) / 2;
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
  // THE ONE RULE (aisMotion, 2026-09-30): whether she is under way, and which way her bow points. The AIS layer draws
  // her hull by the same answer, so the outline here and the ship drawn inside it always point the same way.
  const { sog, ageS, navStopped, vel, moving, hdg } = aisMotion(v, opts);
  const c = frame.toEN({ lat, lon });
  // Dead reckoning, capped: past AIS_DR_MAX_S the box stays where the last honest position put it.
  const dr = moving ? Math.min(ageS, AIS_DR_MAX_S) : 0;
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
  const shape = (at) => hdg == null
    ? discRingEN(at, aisDiscM(box))
    : hullRingEN(at, hdg, box);
  const hull = shape(c0);
  const ring = c1 ? convexHull(hull.concat(shape(c1))) : hull;
  const size = Math.round(box.lengthM) + " x " + Math.round(box.beamM) + " m" + (box.assumed ? " assumed" : "");
  const name = (v.name != null && String(v.name).trim()) ? String(v.name).trim() : null;
  const kind = "AIS: " + (name || ("MMSI " + v.mmsi)) + " (" + size
    + (moving ? ", " + sog.toFixed(1) + " kn" : navStopped ? ", " + aisNavWord(+v.nav) : "") + ")";
  return { ring, bb: bbOf(ring), kind, mmsi: v.mmsi, name, moving, sweepS: c1 ? sweepS : 0,
           at: c0, end: c1, hull, box, hdg };
}

/**
 * THE ESCAPE'S KEEP-OUT for a contact (Andy, 2026-09-27: "an avoidance maneuver of a radius equal to the
 * length or the estimated length of the vessel"): her keep-out grown by her own length on every side - the
 * ring the ESCAPE from her keeps outside of, because an escape is the one maneuver whose whole job is to get
 * well clear. The guard's own model (aisKeepout) stays the bare hull, so the ladder still measures to her
 * side. `q.box.lengthM` is the length she broadcasts, or the assumed 20 m.
 * ⚠ THE WAY ROUND HAS ITS OWN, TIGHTER RING since 2026-09-28 (aisRoundKeepout, below): with this one plus the
 * router's standoff outside it, the way round KLEOS passed 48-63 m off a 20 m vessel.
 */
export function aisAvoidKeepout(q) {
  if (!q || !q.ring || !q.box) return q;
  const L = Math.max(0, +q.box.lengthM || AIS_DEFAULT_LENGTH_M);
  const pts = [];
  for (const v of q.ring) for (const p of discRingEN(v, L, 16)) pts.push(p);
  const ring = convexHull(pts);
  return { ...q, ring, bb: bbOf(ring), avoidM: L, kind: q.kind + ", " + Math.round(L) + " m round her" };
}
export function aisAvoidKeepouts(polys) { return (polys || []).map(aisAvoidKeepout); }

/** A disc as a polygon that CONTAINS the circle: vertices on radius r / cos(pi/n), so no edge cuts inside r. */
function discOutEN(c, r, n) { return discRingEN(c, r / Math.cos(Math.PI / n), n); }
function centroidEN(ring) {
  let e = 0, n = 0;
  for (const p of ring) { e += p.e; n += p.n; }
  return { e: e / ring.length, n: n / ring.length };
}

/**
 * THE WAY ROUND'S KEEP-OUT for the contact the survey is routed round (Andy, 2026-09-28: "Too much distance
 * from the AIS target and a long failure to regain the survey line. Make the avoidance maneuver tighter and
 * recover the survey line sooner."). His 09-27 rule is kept and read as he said it - "an avoidance maneuver of
 * a RADIUS equal to the length" - a radius ABOUT HER. The first reading grew her hull by her length on every
 * side and the router then kept its standoff outside THAT, so the two margins were SUMMED: at New Castle, in a
 * 1.75 kn set (standoff 19.5 m), the way round passed KLEOS, 20 m long, 48-63 m off her center.
 *
 * The ring returned is what the ROUTER keeps `stdM` (its standoff) outside of, so it is built to put the route
 * where the larger of the two rules puts it, and no wider:
 *   * ONE SHIP-LENGTH FROM HER CENTER - a disc of radius L - stdM about her hull's center (and about where that
 *     center will be at the end of her sweep, if she is under way), which the router's standoff tops up to L;
 *   * THE STANDOFF PLUS THE BUFFER FROM HER HULL - her (swept) hull grown by the operator's buffer: the guard's
 *     own ladder measures to her hull, a way round that passes inside its standoff is a way round the guard
 *     stops, and the buffer is the margin for the boat's own cross-track error on the way past.
 * The union's convex hull. In calm water (standoff = the buffer) the disc dominates and the route passes one
 * ship-length from her center; in a set the standoff outgrows her length and the hull dominates.
 * Returned with `roundM` (her length) and `stdM`, and her kind naming the ring.
 */
export function aisRoundKeepout(q, stdM, bufM) {
  if (!q || !q.ring || !q.hull || !q.box) return q;
  const L = Math.max(0, +q.box.lengthM || AIS_DEFAULT_LENGTH_M);
  const std = Math.max(0, +stdM || 0), buf = Math.max(0, +bufM || 0);
  const pts = [];
  for (const v of q.ring) {
    if (buf > 0) for (const p of discOutEN(v, buf, 16)) pts.push(p);
    else pts.push(v);
  }
  const r = L - std;
  if (r > 0) {
    const hc = centroidEN(q.hull);
    for (const p of discOutEN(hc, r, 32)) pts.push(p);
    if (q.end && q.at) {
      const he = { e: hc.e + (q.end.e - q.at.e), n: hc.n + (q.end.n - q.at.n) };
      for (const p of discOutEN(he, r, 32)) pts.push(p);
    }
  }
  const ring = convexHull(pts);
  return { ...q, ring, bb: bbOf(ring), roundM: L, stdM: std,
           kind: q.kind + ", " + Math.round(L) + " m round her" };
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

/**
 * THE VESSELS NOT UNDER WAY, FOR A PASSAGE (Andy, 2026-10-07: "build ... Solution 2" - stopped or moored AIS contacts
 * as fixed obstacles in the route planner, re-read at every plan). His RTH outbound past the Newington pier passed
 * NORD LOGOS, 132 m and stopped alongside, 79 m off her AIS fix at 10.3 kn - roughly 20-30 m off her stern if the fix
 * is amidships - and neither the route nor the guard said a word: the route did not know she was there, and the guard
 * answers only a projected ENTRY into her hull.
 *
 * Each contact aisMotion (the one rule) calls not under way, as the guard models her (aisKeepout, unswept: her hull
 * along her heading, or the disc of every orientation where she reports none) - wherever she lies in `bbox`, not only
 * within AIS_KO_RANGE_M of the boat, because a passage reaches the whole chart it was read over. The router keeps its
 * standoff outside her as outside a pier; nothing is added here. A contact UNDER WAY is not in it, ever: she will not
 * be where the plan saw her, and the guard answers her on the water.
 *
 * Returns {polys, stale, note}: `stale` as aisKeepouts says it - an empty model with its reason, never a quiet sea.
 * opts: now (ms), polledAt (ms the contacts were read), staleS (default AIS_KO_STALE_S), bbox ({W,S,E,N} degrees).
 */
export function aisMooredKeepouts(vessels, frame, opts = {}) {
  const now = +opts.now || 0;
  if (!frame) return { polys: [], stale: false, note: "no chart frame" };
  const polledAt = +opts.polledAt || 0;
  if (!(polledAt > 0)) return { polys: [], stale: true, note: "no AIS read for this plan" };
  const ageS = Math.max(0, (now - polledAt) / 1000);
  const staleS = opts.staleS == null ? AIS_KO_STALE_S : +opts.staleS;
  if (ageS > staleS) return { polys: [], stale: true, note: "the AIS read is " + Math.round(ageS) + " s old" };
  const b = opts.bbox;
  const polys = [];
  for (const v of (vessels || [])) {
    if (!v || v.lat == null || v.lon == null) continue;
    if (b && !(+v.lat >= b.S && +v.lat <= b.N && +v.lon >= b.W && +v.lon <= b.E)) continue;
    const m = aisMotion(v, { now, polledAt });
    if (m.moving) continue;
    const q = aisKeepout(v, frame, { now, polledAt, sweepS: 0 });
    if (!q) continue;
    // aisKeepout names moored / at anchor / aground where she says so; a stopped ship that says nothing is "stopped"
    polys.push({ ...q, moored: true, kind: m.navStopped ? q.kind : q.kind.replace(/\)$/, ", stopped)") });
  }
  return { polys, stale: false, note: polys.length + " vessel" + (polys.length === 1 ? "" : "s") + " not under way" };
}
