// static/js/hold.js - WHERE a boat is asked to hold, and how much water it has there.
//
// The command-time half of the Eastport work. Andy, 2026-09-02:
//
//   "A vessel must consider what is ahead of it and modify trajectory or speed or final
//    target to ENSURE nogo areas are never entered."
//
// "Final target" is this file. The run-time ladder (guard.js) catches a boat being set onto
// a structure while it holds; this is the belt to that braces - the boat should not be
// ASKED to hold somewhere unsafe in the first place. Two facts about a hold point, both of
// which every commanded hold used to leave unstated:
//
//   1. WHERE IT IS. `SimVcu` took `plan[-1]` as the hold point whatever it was, so a Go-To
//      onto a pier, or a Return-to-Home to a HOME set at a berth, asked the boat to hold
//      INSIDE a keep-out - and the raw-bearing re-approach then drove it there. The existing
//      `snapClearLL` nudges along ONE axis (it was written to split a long leg, where the
//      perpendicular is the natural direction). A hold point wants the nearest clear water
//      in ANY direction, which is a radial search: rings out from the point, every heading
//      on each ring, the first ring with a clear candidate wins, and within that ring the
//      candidate with the MOST water. Nearest first, then best.
//
//   2. HOW MUCH WATER IT HAS. A hold is not a point, it is a disc: the boat is allowed to
//      wander the hold radius before it re-approaches, and it is set off station by the
//      stream every few seconds near a structure. `holdClearM` is the radius of the disc
//      around the hold point that is clear of the keep-out model at the operator's buffer -
//      and it is what lets the boat's own re-approach be honest. Inside that disc a straight
//      chord back to the centre is clear by construction (every point of a disc is in the
//      disc), so the boat may drive it direct. Beyond it the boat cannot know, so it takes
//      the way off and the console supplies a ROUTED re-approach through the same planner
//      every other commanded motion uses.
//
// ⚠ THE SNAP MARGIN IS `buf + holdR`, NOT `buf`. A point that is merely unblocked can sit
// exactly on the buffer edge, and a hold there alarms the moment the tide moves it ten
// centimetres. The whole disc the boat is allowed to wander has to be clear, or the hold
// point is only clear on paper.
//
// ⚠ NOTHING HERE COMMANDS ANYTHING, and nothing here reads page state. Pure functions of a
// point, a keep-out model and a buffer - the same split guard.js has - so they can be shown
// on the card and tested without a boat moving.

import { blocked, clearanceM } from "./keepouts.js";
// The ladder's own decision margin. A hold point has to hold the boat for at least as long
// as the guard is allowed to take deciding about it - see holdMarginM.
import { HOLD_S } from "./guard.js";

const D2R = Math.PI / 180;

/**
 * THE WORKING MARGIN A HOLD POINT NEEDS - not merely "not blocked".
 *
 * Measured at Eastport, 2026-09-03: HOME sat with 1.47 m of certified clear water round it,
 * and the console drove there anyway, because nothing asked for more than "outside the
 * buffer". At 17:11:38 the boat was 1.74 m from that point doing 6.07 kn. A hold point with
 * no working margin is a strike waiting for the first gust.
 *
 * The number is the environment's, not a taste: a station-keeping boat is SET at the
 * stream's own rate (measured - a hull lying stopped in a 2 kn stream makes 2.00 kn over the
 * ground, tests/currents.py), so the water it needs is the water the set moves it through
 * before anything can answer. `HOLD_S` is the ladder's own budget for that decision, so the
 * two agree by construction rather than by coincidence.
 *
 * Floored at hull scale, because a dead calm is not authority to park against a wall - the
 * boat still yaws, the fix still wanders, and the chart is not perfect.
 */
export const HOLD_MARGIN_MIN_M = 6.0;
export function holdMarginM(setMs = 0, opts = {}) {
  const react = opts.reactS ?? HOLD_S;
  const floor = opts.minM ?? HOLD_MARGIN_MIN_M;
  return Math.max(floor, Math.max(0, setMs || 0) * react);
}

/**
 * How much a candidate offset direction is favoured for sitting DOWN-SET of the hazard.
 *
 * ⚠ THIS IS A PREFERENCE, NEVER A RULE - every candidate it chooses between has already
 * satisfied the margin. Expressed as a fraction of the required margin so it can tip a near
 * tie and cannot buy a materially tighter berth.
 */
export const SET_ALIGN_WEIGHT = 0.5;

/**
 * The hold radius the vessel model uses when no approach radius is known: the floor in
 * `SimVcu.tick`'s station-keep branch is `max(approach_m, 2.0)`, and this is that floor.
 * Stated here so the client's disc and the sim's disc are the same disc.
 */
export const HOLD_RADIUS_MIN_M = 2.0;

/** Ring headings on the radial search: 36 candidates per ring. */
export const SNAP_DEG_STEP = 10;

/** How far out the radial search will look before refusing. Mirrors snapClearLL's cap. */
export function snapCapM(buf) { return Math.max(150, buf * 20); }

/**
 * The nearest water to `p` that a boat can actually be ASKED TO HOLD IN.
 *
 * ⚠ "NOT BLOCKED" WAS THE OLD TEST AND IT WAS NOT ENOUGH. A point one centimetre outside
 * the buffer passes `blocked()` and is a strike waiting for the first gust; Eastport's HOME
 * passed it with 1.47 m of clear water and the boat drove there at 6 kn. The test is now the
 * WORKING MARGIN (`need`): the water the set moves the boat through before anything can
 * answer. `moved: 0` still means "the point as given was fine", so a berth in open water is
 * untouched exactly as before.
 *
 * ⚠ AND WHERE IT MOVES TO IS NOT ARBITRARY: among candidates that all satisfy the margin, it
 * prefers the berth DOWN-SET of the hazard, so residual drift carries the boat AWAY from the
 * structure rather than onto it, and the station-keeping correction is made heading INTO the
 * set - the direction a boat can actually stop in. That is the seamanlike arrangement and it
 * is the enabling half of coming in on the drift: keep the hard thing upwind.
 *
 * @param {{e,n}}  p      the requested point, in the model's frame
 * @param {object} ko     keep-out model
 * @param {number} buf    the operator's buffer
 * @param {number} holdR  the hold radius - the disc that must ALSO be clear around the result
 * @param {object} opts   `need` (required clear water, default holdMarginM(0)), `setE`/`setN`
 *                        (the set as a vector, m/s, for the down-set preference)
 * @returns {{e,n,moved,brg,clr}|null}  `moved` 0 when `p` itself is fine; null when nothing
 *          within the cap satisfies the margin - a refusal, not "use the point anyway".
 */
export function snapClearRadial(p, ko, buf, holdR = HOLD_RADIUS_MIN_M, opts = {}) {
  if (!p || !ko) return null;
  const margin = buf + Math.max(0, holdR || 0);
  const need = opts.need ?? holdMarginM(0);
  // The margin is measured as clear water round the point (clearance less the buffer), the
  // same quantity the vessel is later told to re-approach within - one definition, not two.
  const ok = (q) => !blocked(q, ko, margin) && clearanceM(q, ko) - buf >= need;
  if (ok(p)) return { e: p.e, n: p.n, moved: 0, brg: null, clr: clearanceM(p, ko) };
  const step = opts.stepM ?? Math.max(2, buf);
  const cap = opts.capM ?? snapCapM(buf);
  const degStep = opts.degStep ?? SNAP_DEG_STEP;
  const setE = opts.setE || 0, setN = opts.setN || 0;
  const setMag = Math.hypot(setE, setN);
  for (let d = step; d <= cap + 1e-9; d += step) {
    let best = null;
    for (let a = 0; a < 360; a += degStep) {
      const r = a * D2R;
      const c = { e: p.e + d * Math.sin(r), n: p.n + d * Math.cos(r) };
      if (!ok(c)) continue;
      // Within the FIRST qualifying ring, prefer the most water - the ring decides "nearest",
      // this decides "best of the nearest", so two equally-near candidates either side of a
      // pile do not pick the one hard against the next pile. The set tips a near tie toward
      // the down-set berth; it is scaled by `need` so it can never buy a tighter one.
      const clr = clearanceM(c, ko);
      const align = setMag > 1e-6
        ? (Math.sin(r) * setE + Math.cos(r) * setN) / setMag    // +1 dead down-set
        : 0;
      const score = clr + SET_ALIGN_WEIGHT * need * align;
      if (!best || score > best.score) best = { e: c.e, n: c.n, moved: d, brg: a, clr, score };
    }
    if (best) return best;
  }
  return null;
}

/**
 * The radius of the disc around `p` that is clear of the keep-out model at buffer `buf`:
 * the distance to the nearest hazard EDGE less the buffer, floored at zero. Every point
 * within this radius of `p` passes `blocked(pt, ko, buf) === false`, which is the property
 * the vessel's direct re-approach relies on. Capped like clearanceM - open water reports
 * the cap less the buffer, not the horizon.
 */
export function holdClearM(p, ko, buf, cap = 500) {
  if (!p || !ko) return null;
  return Math.max(0, clearanceM(p, ko, cap) - (buf || 0));
}
