// static/js/berth.js - THE LAUNCH GRANT, as geometry and rules. No DOM, no fetch, no
// mission state: a berth, a keep-out model and a route in, a set of decisions out.
//
// Andy set the axiom this rests on, 2026-09-19:
//
//   "Assume all starts are close to a pier or other feature. Assume this for water depth,
//    too. If a user places the ASV in the water for a mission start, it is by definition
//    safe."
//
// THE PROBLEM IT ANSWERS, verified by hand before any of it was designed: a berthed boat is
// in extremis BY CONSTRUCTION. `timeToEntry` returns 0 on `blocked(p, ko, buf)` before the
// stationary test, and `projectRoute` short-circuits the same way - so inside a buffer both
// projections read 0 and `assess` lands on `helm` with no threshold consulted at all.
// THERE IS NO NUMBER TO TUNE. The only change that reaches the mechanism without putting a
// deletable `if` where the safety is, is to hand the ladder a different keep-out VIEW.
//
// So: the console records the launch as a POINT, works out at plan time the way OUT of it,
// and while the boat is on that checked way out it assesses against a model with the
// launched-against features REMOVED. The ladder, its thresholds and its arithmetic are
// untouched. It answers a true question about a smaller world, and the FULL question about
// everything else in the same frame.
//
// ⚠ static/js/guard.js IS NOT MODIFIED BY ANY OF THIS, and that is a checkable property
// rather than an assertion - see tests/berth_grant.js. `timeToEntry` still returns 0 from
// inside a buffer, `projectRoute` still short-circuits, `assess` still returns `helm` for a
// boat inside a buffer of a model that contains the thing. The guard's ANSWER stays true;
// only the MODEL it is asked about, and the console's authority to act on it, move.
//
// THE THREE CONJUNCTS. A single frame's suppression requires all of:
//   IDENTITY - the feature is one of those that makes the launch point uncertifiable (R3),
//              and its kind is one a person standing on a float could have certified (R4);
//   PLACE    - the boat is inside the corridor the planner drew out of the berth (R5);
//   PROOF    - the grant has not yet ended, and it ends the moment the console can certify
//              the water she is in for itself (R11), or she gives ground (R12), or the
//              corridor is left, or the clock runs out (R14).
//
// The rule numbers below are DEPARTURE_PARADIGM.md's, which is the design and the evidence.

import { blockedInfo, clearanceM, featureClearanceM } from "./keepouts.js";
import { holdClearM, holdMarginM, snapCapM } from "./hold.js";

/**
 * KINDS A GRANT MAY NEVER COVER (R4).
 *
 * A wreck at a berth is still a wreck. None of these is a thing a person standing on a
 * float certified by looking at the water, so none of them is covered by the act the axiom
 * rests on - and the operator cannot name them either, which is why this is a list and not
 * a setting. `buildKeepouts` produces exactly nine kind strings (see `nogoKind`); these four
 * are excluded permanently and the other five are grantable.
 */
export const UNGRANTABLE_KINDS = ["a charted hazard", "a channel buoy",
                                  "a dredged area", "a restricted area"];

/** The depth kinds carry their own threshold in the string, so they are matched by prefix. */
export const DEPTH_KIND_PREFIX = "water shallower than";

/** Is this kind one the launch act could have certified? */
export function grantableKind(kind) {
  if (!kind) return false;
  return !UNGRANTABLE_KINDS.includes(kind);
}

/** Is this a DEPTH feature? The depth grant is bounded differently from the structure one (R7). */
export function isDepthKind(kind) {
  return !!kind && kind.startsWith(DEPTH_KIND_PREFIX);
}

/**
 * IS THIS WATER A BERTH? (R2)
 *
 * `holdTarget`'s own two-line test, lifted whole (static/js/passage.js) so the planner and
 * the grant cannot disagree about what a berth IS: blocked at the buffer, or with less
 * clear water than a hold point would need.
 *
 * ⚠ NO GRANT IS ISSUED WHERE THE CONSOLE CAN ALREADY CERTIFY THE WATER. If the launch water
 * certifies, nothing is latched and nothing is suppressed - and the case needs no handling,
 * because the guard would not have fired.
 */
export function isBerth(pEN, ko, buf, needM) {
  if (!pEN || !ko) return false;
  return !!blockedInfo(pEN, ko, buf) || holdClearM(pEN, ko, buf) < needM;
}

/** The margin a hold point needs at this set - the guard's own decision budget (R6). */
export function berthNeedM(setMs) { return holdMarginM(setMs); }

/**
 * WHICH FEATURES THE GRANT COVERS (R3, R4).
 *
 * A feature is GRANTED iff it is one of the ones that makes the launch point uncertifiable:
 * `featureClearanceM(berth, f) - buf < need0`. That is the same inequality `isBerth` above
 * applies to the model as a whole, asked of one feature at a time.
 *
 * ⚠ RE-DERIVED EVERY TIME, NEVER REMEMBERED. `rebuildNogo` replaces `nogo.ko` wholesale on
 * 0.1 m of tide, so a remembered feature object, signature or bounding box is a gate keyed
 * on invalidated state - the trap this estate has already paid for once. Remember the POINT;
 * re-derive the MODEL. The caller memoises on the `ko` object's own identity, which changes
 * exactly when the model is rebuilt.
 *
 * @returns {{structure:Array, depth:Array, all:Array, ungrantable:Array}}
 *   `ungrantable` is what made the berth uncertifiable and may NOT be covered - the caller
 *   refuses the departure by name when that list is the only reason (R4).
 */
export function grantedFeatures(ko, berthEN, buf, need0) {
  const out = { structure: [], depth: [], all: [], ungrantable: [] };
  if (!ko || !berthEN) return out;
  const consider = (f) => {
    if (featureClearanceM(berthEN, f) - buf >= need0) return;   // not why the berth is a berth
    if (!grantableKind(f.kind)) { out.ungrantable.push(f); return; }
    (isDepthKind(f.kind) ? out.depth : out.structure).push(f);
    out.all.push(f);
  };
  for (const f of ko.polys || []) consider(f);
  for (const f of ko.lines || []) consider(f);
  for (const f of ko.points || []) consider(f);
  return out;
}

/**
 * THE MODEL THE LADDER IS HANDED: the live one, less the granted features.
 *
 * ⚠ A FILTER, NOT A BRANCH, AND THAT IS THE SAFETY ARGUMENT. The rungs are unreachable
 * against a granted feature because that feature is not in the model they were given - so
 * there is no `if (departing)` inside a rung for a later edit to delete, and the ladder's
 * source is unchanged apart from which model it reads.
 *
 * ⚠ AND BECAUSE IT IS A FILTER, THE LOOK-AHEAD GETS LONGER, NOT SHORTER. `projectRoute`
 * stops at the FIRST entry. Today at a berth it stops at the launch pier and never looks
 * past it; under the grant it marches through and finds whatever is thirty seconds further
 * along - which is how a second structure beyond the berth still earns a full-authority
 * rung on the same frame.
 *
 * `marks` is carried through untouched: it is channel structure for the Rule 9 lane, not a
 * keep-out list, and nothing here has any business filtering it.
 */
export function grantFilter(ko, granted) {
  if (!ko || !granted || !granted.length) return ko;
  const drop = new Set(granted);
  return { ...ko,
           polys: (ko.polys || []).filter((f) => !drop.has(f)),
           lines: (ko.lines || []).filter((f) => !drop.has(f)),
           points: (ko.points || []).filter((f) => !drop.has(f)) };
}

/**
 * HOW WIDE THE CORRIDOR IS (R5).
 *
 * `max(hull length, the radius she turns in at her slowest)` - the two lengths that describe
 * the boat rather than the operator's opinion of the water.
 *
 * ⚠ BUFFER-INDEPENDENT BY CONSTRUCTION, and that is the direct repair of a judged defect in
 * an earlier draft: anchoring the corridor to the buffer meant RAISING the buffer for safety
 * WIDENED the exemption. A control that makes the console more cautious must never make a
 * standing-down wider.
 */
export function corridorHalfM(loaM, minTurnLowM) {
  return Math.max(Math.max(0, loaM || 0), Math.max(0, minTurnLowM || 0));
}

/**
 * THE GATE: the first water on the way out that the console would ITSELF accept as a hold
 * point (R6), and the DEPTH GATE beside it (R7).
 *
 * Walks the spine - the berth, then the planner's own route - at the rate `legClear` and
 * `clipLine` already walk flown water, and stops at the first sample with
 * `holdClearM >= need0`. No further than `snapCapM(buf)`, which is the cap the hold-point
 * search already refuses beyond: past it the console is not finding water, it is guessing.
 *
 * The DEPTH gate is the first sample not blocked at the buffer by a depth kind - reached
 * sooner than the structure gate, and the depth grant ends there (R7), because the depth
 * grant is precisely the permission to run with the hull's under-keel clearance unverified.
 *
 * @returns {{idx, at, m, depthIdx, depthAt, depthM, spineLenM, capped}} or null when no gate
 *   is found within the cap - which the caller REFUSES at Upload rather than discovering at
 *   Start, as an escape.
 */
export function corridorGate(spineEN, ko, buf, need0, opts = {}) {
  if (!spineEN || spineEN.length < 2 || !ko) return null;
  const step = Math.max(2, buf / 2);
  const cap = opts.capM != null ? opts.capM : snapCapM(buf);
  let run = 0, depthIdx = -1, depthAt = null, depthM = 0;
  for (let i = 1; i < spineEN.length; i++) {
    const a = spineEN[i - 1], b = spineEN[i];
    const seg = Math.hypot(b.e - a.e, b.n - a.n);
    const n = Math.max(1, Math.ceil(seg / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const q = { e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t };
      const along = run + seg * t;
      if (along > cap) return { idx: -1, at: null, m: cap, depthIdx, depthAt, depthM,
                                spineLenM: along, capped: true };
      if (depthIdx < 0) {
        const bi = blockedInfo(q, ko, buf);
        if (!bi || !isDepthKind(bi.kind)) { depthIdx = i; depthAt = q; depthM = along; }
      }
      if (holdClearM(q, ko, buf) >= need0)
        return { idx: i, at: q, m: along,
                 depthIdx: depthIdx < 0 ? i : depthIdx,
                 depthAt: depthAt || q, depthM: depthIdx < 0 ? along : depthM,
                 spineLenM: along, capped: false };
    }
    run += seg;
  }
  return { idx: -1, at: null, m: run, depthIdx, depthAt, depthM, spineLenM: run, capped: false };
}

/**
 * IS THE BOAT INSIDE THE CORRIDOR? (R5, the PLACE conjunct)
 *
 * Within `halfM` of the spine, and no further along it than the gate. Outside it, nothing is
 * suppressed, ever - which is what stops a grant issued at a berth from covering a pier
 * three hundred metres down the bay that happens to be the same kind.
 */
export function inCorridor(pEN, spineEN, gateIdx, halfM) {
  if (!pEN || !spineEN || spineEN.length < 2) return false;
  const last = gateIdx > 0 ? Math.min(gateIdx, spineEN.length - 1) : spineEN.length - 1;
  for (let i = 1; i <= last; i++) {
    const a = spineEN[i - 1], b = spineEN[i];
    const de = b.e - a.e, dn = b.n - a.n, l2 = de * de + dn * dn;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((pEN.e - a.e) * de + (pEN.n - a.n) * dn) / l2)) : 0;
    if (Math.hypot(pEN.e - (a.e + t * de), pEN.n - (a.n + t * dn)) <= halfM) return true;
  }
  return false;
}

/**
 * HOW MUCH GROUND SHE MAY GIVE BEFORE THE GRANT ENDS (R12).
 *
 * ⚠ THE HALVING IS THE REPAIR OF A JUDGED DEFECT. A flat 5 m give can never arm at a berth
 * with 0.97 m of water - the measured figure at New Castle - so the best set-back detector
 * in the design could not fire in the one place it was needed. She loses half the water she
 * has made, or 5 m, whichever is less, floored at the console's own jitter floor.
 *
 * Both numbers are the console's own and neither is new: 5 m is `guardOverrideOk`'s
 * statement of how much worse a situation may get before a permission lapses, and 0.5 m is
 * `updateClearance`'s jitter floor.
 */
export function recessionGiveM(cMaxM, overrideGiveM = 5.0, jitterM = 0.5) {
  return Math.max(jitterM, Math.min(overrideGiveM, 0.5 * Math.max(0, cMaxM || 0)));
}

/** The clearance from the GRANTED features alone - three or four entries, microseconds (R12). */
export function berthClearM(pEN, granted, cap = 500) {
  if (!pEN || !granted || !granted.length) return cap;
  const one = { polys: [], lines: [], points: [], marks: [] };
  for (const f of granted) {
    if (f.ring) one.polys.push(f); else if (f.pts) one.lines.push(f); else one.points.push(f);
  }
  return clearanceM(pEN, one, cap);
}

/**
 * THE CLOCK (R14): three times how long the checked way out takes at the only speed it may
 * be flown at, floored at a minute.
 *
 * The one bound that needs NO telemetry at all, which is what answers "the link died and she
 * is still alongside". It is also the least principled number in the design - derived from
 * how a departure OUGHT to go rather than from anything the hull or the chart knows - and it
 * stops the boat rather than restoring the helm (R14, and Andy's decision 5).
 */
export function grantClockMs(spineLenM, lowKn, floorMs = 60000) {
  const ms = Math.max(0.01, (lowKn || 0) * 0.514444);
  return Math.max(floorMs, 3 * Math.max(0, spineLenM || 0) / ms * 1000);
}

/**
 * HAS THE CONSOLE CERTIFIED THE WATER FOR ITSELF? (R11 - the PROOF end, and the only
 * successful one.)
 *
 * Asked of the UNFILTERED model, with the LIVE need rather than the frozen one. Both of
 * those are in the conservative direction: a building set can make proof HARDER but can
 * never enlarge the granted set, because membership keeps the frozen `need0`.
 *
 * It is literally the second half of `snapClearRadial`'s own acceptance test, so a departure
 * ends in water the console would have chosen as a hold point.
 */
export function grantProved(pEN, koFull, buf, liveNeedM) {
  if (!pEN || !koFull) return false;
  return holdClearM(pEN, koFull, buf) >= liveNeedM;
}
