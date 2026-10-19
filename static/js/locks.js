// static/js/locks.js - THE LOCKS ON THE CHART, and the way through one (Andy, 2026-10-18, at the Canaveral lock: "The ASV
// does not seem to understand locks" - then, offered a lock transit he opts into: "do ... B2").
//
// A LOCK'S GATES ARE KEEP-OUTS, AND STAY ONE TO EVERY PLANNER AND THE GUARD (asv_console.py ENC_ROLES: Gate_area, Gate_line
// are structures), so a route never runs through a lock by itself. What this module adds is knowing a lock is there - two
// gates facing each other across a chamber - so the console can OFFER to take her through it, one stage at a time, each
// gate passed only on the operator's word (the page's lock transit, asv.html). Pure: features in, geometry out.
//
// HOW A LOCK IS FOUND. NOAA charts the Canaveral lock as two Gate_line features - CATGAT "lock gate", HORCLR 27.4 m (the
// chamber's width), INFORM "Length is 182.8 meters/600 feet", 200 m apart - and NO Lock_Basin_area (measured, harbour and
// approach bands, 2026-10-18). So a lock is a PAIR of gates: LOCK.MIN_LEN_M to LOCK.MAX_LEN_M apart, near-parallel
// (LOCK.PARALLEL_DEG), each lying ACROSS the line between them (LOCK.AXIS_DEG) - the chamber's axis. A gate that says
// what it is (CATGAT) and is not a lock gate is never paired; one that says nothing (a tile read before CATGAT was kept)
// may be, and the operator's opt-in is the check on that.

import { M_PER_DEG_LAT } from "./geodesy.js";

export const LOCK = {
  MIN_LEN_M: 30,        // two gates nearer than this are one structure's two lines, not a chamber
  MAX_LEN_M: 600,       // the longest chamber this pairs: Canaveral's is 200 m between its gates
  PARALLEL_DEG: 30,     // the two gates near-parallel
  AXIS_DEG: 50,         // each gate across the line between them (90 is square across)
  STANDOFF_M: 60,       // where she holds short of a gate, and where the way out ends, along the axis
  OFFER_M: 3000,        // a lock is offered only for a boat this near its nearer gate
  STEP_M: 20,           // the centerline legs, a point this often
};

const toRad = Math.PI / 180;
// a local plane round `o` (m east, m north) - a lock is a few hundred meters, flat enough
const EN = (o, p) => ({ e: (p.lon - o.lon) * M_PER_DEG_LAT * Math.cos(o.lat * toRad), n: (p.lat - o.lat) * M_PER_DEG_LAT });
const LL = (o, q) => ({ lat: o.lat + q.n / M_PER_DEG_LAT, lon: o.lon + q.e / (M_PER_DEG_LAT * Math.cos(o.lat * toRad)) });
const dist = (a, b) => { const q = EN(a, b); return Math.hypot(q.e, q.n); };
// an undirected line's bearing, 0-180
const lineDeg = (a, b) => { const q = EN(a, b); return ((Math.atan2(q.e, q.n) / toRad) % 180 + 180) % 180; };
const across = (d1, d2) => { const d = Math.abs(d1 - d2) % 180; return Math.min(d, 180 - d); };   // 0-90 between lines

/** A gate's two ends, middle and line bearing, from a Gate_line (its longest part) or a Gate_area (its farthest two
 *  vertices); null for any other shape. */
export function gateGeom(f) {
  const g = (f && f.geometry) || {}, c = g.coordinates;
  let pts = null;
  if (g.type === "LineString") pts = c;
  else if (g.type === "MultiLineString") pts = (c || []).reduce((a, p) => (p.length > (a ? a.length : 0) ? p : a), null);
  else if (g.type === "Polygon" || g.type === "MultiPolygon") {
    const ring = g.type === "Polygon" ? (c || [])[0] : ((c || [])[0] || [])[0];
    if (ring && ring.length > 1) {
      let best = null, bd = -1;
      for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
        const d = dist({ lat: ring[i][1], lon: ring[i][0] }, { lat: ring[j][1], lon: ring[j][0] });
        if (d > bd) { bd = d; best = [ring[i], ring[j]]; }
      }
      pts = best;
    }
  }
  if (!pts || pts.length < 2) return null;
  const a = { lat: pts[0][1], lon: pts[0][0] }, b = { lat: pts[pts.length - 1][1], lon: pts[pts.length - 1][0] };
  return { a, b, mid: { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }, deg: lineDeg(a, b), lenM: dist(a, b) };
}

const isGate = (f) => f && (f.cls === "Gate_line" || f.cls === "Gate_area");
const catgat = (f) => ((f.props || f.properties || {}).CATGAT);
const saysNotLock = (f) => { const c = catgat(f); return c != null && c !== "" && !/lock/i.test(String(c)); };

/** The locks among `features`: [{id, gates: [fA, fB], A, B (the gates' middles), lengthM, widthM (HORCLR, or null),
 *  name, note}] - each gate in one lock at most, the nearest pairs first. */
export function findLocks(features) {
  const gs = [];
  for (const f of features || []) {
    if (!isGate(f) || saysNotLock(f)) continue;
    const g = gateGeom(f);
    if (g) gs.push({ f, g });
  }
  const pairs = [];
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
    const a = gs[i], b = gs[j], d = dist(a.g.mid, b.g.mid);
    if (!(d >= LOCK.MIN_LEN_M && d <= LOCK.MAX_LEN_M)) continue;
    if (across(a.g.deg, b.g.deg) > LOCK.PARALLEL_DEG) continue;
    const axis = lineDeg(a.g.mid, b.g.mid);
    if (across(axis, a.g.deg) < LOCK.AXIS_DEG || across(axis, b.g.deg) < LOCK.AXIS_DEG) continue;
    pairs.push({ a, b, d });
  }
  pairs.sort((p, q) => p.d - q.d);
  const used = new Set(), out = [];
  for (const p of pairs) {
    if (used.has(p.a) || used.has(p.b)) continue;
    used.add(p.a); used.add(p.b);
    const pa = p.a.f.props || p.a.f.properties || {}, pb = p.b.f.props || p.b.f.properties || {};
    const w = Number.isFinite(+pa.HORCLR) && pa.HORCLR != null ? +pa.HORCLR : Number.isFinite(+pb.HORCLR) && pb.HORCLR != null ? +pb.HORCLR : null;
    out.push({ id: "lock:" + [featureKey(p.a.f), featureKey(p.b.f)].sort().join("+"), gates: [p.a.f, p.b.f],
               A: p.a.g.mid, B: p.b.g.mid, lengthM: p.d, widthM: w,
               name: pa.OBJNAM || pb.OBJNAM || null, note: pa.INFORM || pb.INFORM || null });
  }
  return out;
}

/** A feature's key that survives a re-read of the same chart: class and object id, or its geometry when it has no id. */
export function featureKey(f) {
  const id = f && (f.oid != null ? f.oid : null);
  return (f && f.cls) + "|" + (id != null ? id : JSON.stringify((f && f.geometry && f.geometry.coordinates) || null).slice(0, 240));
}

/** Where along the lock's axis `p` lies: {t (m from A toward B; 0..lengthM between the gates), off (m off the axis)}. */
export function alongLock(lock, p) {
  const b = EN(lock.A, lock.B), q = EN(lock.A, p), L = Math.hypot(b.e, b.n) || 1;
  return { t: (q.e * b.e + q.n * b.n) / L, off: Math.abs(q.e * b.n - q.n * b.e) / L };
}
/** Are `from` and `to` on OPPOSITE sides of the lock's gates (each beyond a gate, along its axis)? */
export function lockBetween(lock, from, to) {
  const a = alongLock(lock, from), b = alongLock(lock, to);
  return (a.t < 0 && b.t > lock.lengthM) || (a.t > lock.lengthM && b.t < 0);
}
/** Is `p` inside the lock - between its gates, within the chamber's half-width (HORCLR, else 40 m) and `margin`? */
export function insideLock(lock, p, margin = 0) {
  const a = alongLock(lock, p), half = (lock.widthM || 40) / 2 + margin;
  return a.t >= -margin && a.t <= lock.lengthM + margin && a.off <= half;
}

/** The way through `lock` for a boat at `from`: {near, far (the gates' middles, near first), nearGate, farGate (their
 *  features), approach (held short of the near gate), chamber (between the gates), exit (beyond the far gate), inLeg
 *  (approach -> near gate -> chamber), outLeg (chamber -> far gate -> exit) - the legs along the axis, a point every
 *  LOCK.STEP_M}. */
export function lockWay(lock, from, standoffM = LOCK.STANDOFF_M) {
  const nearIsA = dist(from, lock.A) <= dist(from, lock.B);
  const near = nearIsA ? lock.A : lock.B, far = nearIsA ? lock.B : lock.A;
  const v = EN(near, far), L = Math.hypot(v.e, v.n) || 1, u = { e: v.e / L, n: v.n / L };
  const along = (o, m) => LL(o, { e: u.e * m, n: u.n * m });
  const approach = along(near, -standoffM), chamber = along(near, L / 2), exit = along(far, standoffM);
  const leg = (pts) => {
    const out = [];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], d = dist(a, b), n = Math.max(1, Math.ceil(d / LOCK.STEP_M));
      for (let i = 1; i <= n; i++) out.push({ lat: a.lat + (b.lat - a.lat) * i / n, lon: a.lon + (b.lon - a.lon) * i / n });
    }
    return out;
  };
  return { near, far, nearGate: nearIsA ? lock.gates[0] : lock.gates[1], farGate: nearIsA ? lock.gates[1] : lock.gates[0],
           approach, chamber, exit, inLeg: leg([approach, near, chamber]), outLeg: leg([chamber, far, exit]) };
}

/** The lock a Go-To from `from` to `to` would have to pass: the nearest lock whose nearer gate is within LOCK.OFFER_M of
 *  `from`, with `from` and `to` on opposite sides of it - or null. */
export function lockOnTheWay(locks, from, to) {
  let best = null, bd = Infinity;
  for (const L of locks || []) {
    const d = Math.min(dist(from, L.A), dist(from, L.B));
    if (d <= LOCK.OFFER_M && d < bd && lockBetween(L, from, to)) { best = L; bd = d; }
  }
  return best;
}
