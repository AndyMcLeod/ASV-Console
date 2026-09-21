// static/js/coast.js - coming in on the drift: where to stop the prop.
//
// Andy, 2026-09-03, after the vessel hit a pier on an approach for the second time:
//
//   "Even consider drifting in by calculating wind and current affects on set and drift.
//    Its ok to come in at idle with the prop stopped, but it take calculation to do it.
//    We recently implemented current in the environmental model."
//
// THE MEASUREMENT THAT MOTIVATES IT. In his own session log (asv_20260903-170505.jsonl) the
// boat reached 1.74 m from its hold point at 6.07 kn. A 1,380 kg hull at 6.07 kn carries
// 6,728 J; at the ~1 kn this manoeuvre aims to arrive at, 172 J. The point of a drift-in is
// not elegance, it is that FORTY TIMES less energy arrives at the pier.
//
// ⚠ THIS MODULE COMMANDS NOTHING AND READS NO PAGE STATE - the guard.js / hold.js rule. It
// answers one question ("where should the prop stop, and is that safe?") and the caller
// decides. That split is what lets the numbers be tested without a boat moving.
//
// ── THE LAW ────────────────────────────────────────────────────────────────────────────
//
// Quadratic drag, m dv/dt = -k v², is a pure exponential in the DISTANCE domain:
//
//     v(x) = v0 · exp(-x / Lc)        Lc = m/k, one length, speed-independent
//     x(v0→v1) = Lc · ln(v0/v1)       distance to shed way
//     t(v0→v1) = Lc · (1/v1 - 1/v0)   time to shed it
//
// One number describes the hull. The halving distance is Lc·ln2 WHATEVER speed you release
// at - which is the property that separates a real coast from the flat ramp the sim uses for
// engine-governed speed changes (a ramp's distance goes as v0², so halving from 14 kn would
// cost four times halving from 7). tests/coast.js check 3 is exactly that discrimination.
//
// ⚠⚠ THE LAW IS WRONG WHERE IT MATTERS MOST, AND THAT IS WHY THE MANOEUVRE IS BUILT TO
// UNDERSHOOT. Below about a knot real hull resistance goes viscous (~v^1.83), and this
// vessel's own fuel curve (burn ∝ v^3.5) implies resistance ∝ v^2.5 - semi-displacement,
// not clean quadratic. So the two halves of the same hull's physics disagree about the
// exponent and v² over-predicts the run remaining in exactly the last stretch that decides
// whether the boat touches. Every design decision below leans the same way as a result:
// release EARLY, arrive SHORT, and let station-keeping close the gap it was always going to
// close anyway. Undershoot is absorbed by machinery that already exists; overshoot is what
// hits piers.
//
// ── WHAT THE SET INPUT ACTUALLY IS ─────────────────────────────────────────────────────
//
// ⚠ `env_set_kn` IS THE UNDER-WAY SET, NOT THE ENGINES-STOPPED SET. The leeway half is
// computed from APPARENT wind against a heading-relative silhouette (asv_console.py, the
// wind block in SimVcu.tick), so the same weather reads differently on a moving hull than
// on a stopped one - and a coast is precisely a transition between those two states. The
// solver consumes the under-way value because it is the only one published. It is therefore
// an ESTIMATE OF AN ESTIMATE, and `COAST_SET_TOL` below is the admission of that.
//
// Nor does anything carry a sample time: the environment is polled every 1200 s and the
// stream every 900 s, both re-published at 4 Hz with no timestamp, and the sim's own gust
// envelope is ±33% on periods of 40-145 s - shorter than the coast itself. A single frame's
// set is not a forecast. It is the best guess available, used with a band around it.

import { blocked } from "./keepouts.js";
import { HOLD_S } from "./guard.js";

const D2R = Math.PI / 180;

/**
 * The speed the manoeuvre aims to be down to when it reaches the hold point, m/s.
 *
 * ⚠ A POLICY NUMBER, NAMED AS ONE - the same honesty NARROW_MAX_M carries. Physics does not
 * pick it; two practical ends bracket it. Slower is gentler but the quadratic tail is
 * merciless (coasting a DriX to 0.2 kn takes 105 m and five and a half minutes, which is not
 * an approach, it is an abdication). Faster stops being a drift-in. Half a metre per second
 * - a walking pace, about a knot - keeps the coast under a minute and still lands the
 * ~40x energy cut this whole manoeuvre exists for.
 */
export const COAST_ARRIVE_MS = 0.5;

/** Fractional uncertainty on Lc. The fleet's own estimates span 21-52 m about a ~35 m
 *  centre; a third is that bracket rounded outward, not a comfortable margin. */
export const COAST_LC_TOL = 1 / 3;

/** Fractional uncertainty on the set. The sim's gust envelope is 1 ± 0.22·1.5 = ±33%, and
 *  the stream grid is coarser still, so a third is the SMALLER admission of ignorance. */
export const COAST_SET_TOL = 1 / 3;

/** Longest coast worth flying. Beyond this the boat is drifting, not approaching, and the
 *  set has had longer than one gust period to become something else. */
export const COAST_MAX_S = 90;

/** Sampling step along the projected track when checking it against the keep-out model.
 *  Fine enough not to step over a pile, the same reasoning as guard.js's STEP_S. */
export const COAST_STEP_M = 2.0;

/**
 * The hull's coast length from a vessel's `maneuvering.coast` block, or null.
 *
 * ⚠ NULL IS THE HONEST DEGRADE AND IT IS THE DEFAULT. Lc cannot be derived from anything
 * the vessel files already hold: it needs mass, and mass is absent from two of the three
 * shipped hulls entirely and present in the DriX's only as prose inside a `notes` string.
 * Nor can it be inferred from the hull box - the DriX's block coefficient works out at
 * 0.109 (its "2.0 m draft" is a slender strut, not a hull), so loa·beam·draft overstates
 * its displacement about ninefold. And the leeway constants are no help: HULL_CD and
 * HULL_A_LAT are LATERAL quantities, and pressed into service fore-and-aft they give a DriX
 * a 1.6 m stopping distance, out by a factor of fifteen.
 *
 * So the datum is a MEASUREMENT A MARINER CAN TAKE rather than a coefficient nobody can
 * calibrate: run up to a speed in slack water, cut the prop, and log the distance to some
 * lower speed. The console already records position and speed every tick, so it is a trial
 * this boat can fly. A vessel without the block does not coast, and says so.
 */
export function coastLc(coastBlock) {
  const c = coastBlock;
  if (!c) return null;
  const from = +c.from_kn, to = +c.to_kn, reach = +c.distance_m;
  // ⚠ THESE TWO GUARDS ARE REDUNDANT AND THAT IS RECORDED RATHER THAN TIDIED. Mutation
  // showed either one alone rejects every malformed block the suite tries: a reversed pair
  // gives a negative Lc, a zero reach gives zero, and equal speeds divide by ln(1) = 0 and
  // give Infinity - all of which the second test catches on its own, and all of which the
  // first refuses before the arithmetic. Only removing BOTH is detectable (tests/coast.js
  // check 2), which is the estop_chain precedent: a layer that survives alone is acceptable
  // once the pair has been shown to be load-bearing. The first is kept because refusing
  // nonsense before dividing by it is worth more than one line.
  if (!(from > 0) || !(to > 0) || !(reach > 0) || !(from > to)) return null;
  const lc = reach / Math.log(from / to);
  if (!isFinite(lc) || lc <= 0) return null;
  return { lc, from, to, reach, measured: !!c.measured, source: c.source || null };
}

/** Distance and time to shed way from `v0` to `v1` (m/s) on a hull of coast length `lc`. */
export function coastRun(v0, v1, lc) {
  if (!(v0 > v1) || !(v1 > 0) || !(lc > 0)) return null;
  return { m: lc * Math.log(v0 / v1), s: lc * (1 / v1 - 1 / v0) };
}

/**
 * Where to stop the prop so the boat arrives at `H` with the way off it - and whether that
 * is safe to do.
 *
 * THE GEOMETRY IS STEMMING THE SET, and it is inherited rather than re-litigated: hold.js
 * already places a berth DOWN-SET of the hazard so "residual drift carries the boat AWAY
 * from the structure" and "the correction is made heading INTO the set - the direction a
 * boat can actually stop in". Its own note calls that the enabling half of coming in on the
 * drift. So the approach heading is the set's reciprocal, and the arrival through-water
 * speed is `|set|` itself, at which the boat's way through the water exactly cancels the
 * water's motion over the ground and it arrives STOPPED. In slack water there is nothing to
 * cancel and the floor `COAST_ARRIVE_MS` applies instead.
 *
 * That is also why a stronger set makes this manoeuvre BETTER, not worse: the release range
 * shrinks because the set is doing the braking, and the arrival ground speed goes to zero
 * exactly (measured, DriX: 0.33 kn set -> release 40.6 m, arrive 0.64 kn; 2 kn set ->
 * release 6.8 m, arrive 0.00 kn).
 *
 * @param {object} o  {H, ko, buf, frame, setMs, setDeg, v0Ms, lc, holdClear}
 * @returns {{ok, release, releaseLL, hdg, waterM, groundM, secs, arriveMs, v1, band, why}}
 *          `ok:false` carries `why` in words. Refusing is a real answer - the caller powers
 *          in exactly as it does today.
 */
export function solveCoast(o) {
  const { H, ko, buf, frame, v0Ms, lc } = o;
  const setMs = Math.max(0, o.setMs || 0);
  if (!(lc > 0)) return { ok: false, why: "this vessel has no measured coast length" };
  if (!(v0Ms > 0)) return { ok: false, why: "no approach speed to shed" };

  // ⚠ THE HEADING IS THE ROUTE'S, NOT THE COAST'S TO CHOOSE. An earlier cut of this let the
  // solver pick the heading that stems the set, on the seamanlike argument that arriving
  // into the set is the gentlest arrival - and it is. But the release point then comes out
  // UP-SET of the berth, which is wherever the router did not go, and at Eastport is inside
  // the pier: solving on the set alone put the release point 40 m into a wharf. The router
  // owns the path and has already cleared it; the coast decides only WHERE ALONG IT the prop
  // stops. What the set still buys is real, and it is collected below - hold.js has already
  // placed the berth down-set of the hazard, so a route ending there is generally stemming
  // the set anyway, and the more it does the gentler this arrival gets.
  const hdg = o.hdg;
  if (hdg == null) return { ok: false, why: "no approach heading to coast along" };
  const hr = hdg * D2R;
  const hE = Math.sin(hr), hN = Math.cos(hr);

  // The set as a vector, and its component ALONG the approach. A set on the nose (negative
  // along-track) brakes the boat and is cancelled exactly at v1 = -alongSet, arriving dead
  // stopped over the ground. A following set cannot be cancelled by coasting at all, so the
  // floor applies and the arrival carries it.
  const sr = (o.setDeg || 0) * D2R;
  const sE = setMs * Math.sin(sr), sN = setMs * Math.cos(sr);
  const alongSet = sE * hE + sN * hN;               // + = set pushing us along the approach
  const v1 = Math.max(COAST_ARRIVE_MS, -alongSet);
  if (v1 >= v0Ms) {
    return { ok: false, why: "she is already down to the speed this would leave her at - "
                            + "there is no way to shed" };
  }
  const run = coastRun(v0Ms, v1, lc);
  if (!run) return { ok: false, why: "the coast does not solve at these speeds" };
  if (run.s > COAST_MAX_S) {
    return { ok: false, why: "the coast would take " + run.s.toFixed(0) + " s, longer than the "
                            + COAST_MAX_S + " s a single set reading is good for" };
  }

  // THE NOMINAL COAST, SOLVED BACKWARDS AND VECTORIALLY - exact, no root-finding, because
  // with the heading held the coast is analytic:  P_end = P0 + h*(water run) + set*(time).
  // Doing it as vectors rather than along-track scalars is what keeps a CROSS set honest.
  const dE = hE * run.m + sE * run.s, dN = hN * run.m + sN * run.s;
  const nominalM = Math.hypot(dE, dN);
  if (!(nominalM > 0.5)) {
    return { ok: false, why: "the set would hold her where she is - stem it under power" };
  }
  const uE = dE / nominalM, uN = dN / nominalM;      // the ground track's own direction

  // ── THE COAST ENDS ON A SPEED, NOT ON A POSITION, AND THAT IS THE SAFETY ARGUMENT ─────
  //
  // ⚠ AIMING BY POSITION CANNOT BE MADE SAFE HERE AND THE ARITHMETIC SAYS SO. The coast
  // length is an ESTIMATE (±1/3, this hull's own bracket) and over a ~50 m run that is ±17 m
  // of doubt, while the berth it is aimed at has ~6 m of certified clear water. No aim point
  // reconciles those: aim at the berth and a third of the band sails through it; aim short
  // by the band and the boat stops 20 m out and has to be driven in anyway.
  //
  // So position is not the end condition. SPEED is. The vessel coasts until its way is down
  // to a walking pace and then resumes ordinary powered control for whatever remains -
  // which is the same machinery that closes any arrival today, only now entered at about a
  // knot instead of six. Where that transition falls stops mattering: a hull that carries
  // further simply reaches the berth before it happens, and one that carries less hands
  // over further out. The coast-length error moves the handover, never the arrival speed,
  // and the arrival speed is the whole point (6,728 J at 6.07 kn; 172 J at one).
  //
  // `band` is therefore reported for the operator's eye rather than used as a gate: it says
  // where the handover is expected to fall, and how far that could slide either way.
  const slackM = run.m * COAST_LC_TOL + setMs * run.s * COAST_SET_TOL;
  const releaseM = nominalM;
  // ⚠⚠ THE RELEASE RANGE HAS TO FIT ON THE LEG THE VESSEL LATCHES ON. The only number that
  // crosses to the boat is the scalar `groundM`, and the vessel arms the drift-in on the LAST
  // LEG ONLY - `_wp_index == len(_plan) - 1 and dist_b <= _coast_from_m`. So a release range
  // longer than that leg is already satisfied the instant she enters it: the prop stops at
  // the leg's START, not `groundM` out, and she arrives at v0*exp(-leg/Lc) rather than at the
  // speed this function quoted. Measured on the DriX: a 10 m last leg against a 49.7 m
  // release turns a 0.98 kn / 175 J arrival into 2.98 kn / 1622 J - and the banner still said
  // one knot. Refused in the idiom COAST_MAX_S already uses, because a coast that cannot be
  // flown as solved is not a coast.
  if (o.legM != null && releaseM > o.legM) {
    return { ok: false, release: null, hdg,
             why: "the release range (" + releaseM.toFixed(0) + " m) is longer than the final "
                  + "leg (" + o.legM.toFixed(0) + " m) - the prop would stop at the leg's "
                  + "start and she would arrive with way still on" };
  }
  // ⚠⚠ AND THE WALK STARTS WHERE THE PROP ACTUALLY STOPS, WHICH IS NOT ALONG `u`. The latch
  // is RANGE TO THE LAST WAYPOINT on a boat the line-follower is holding ON the route, so the
  // release point is `releaseM` back along the APPROACH. Stepping back along the ground track
  // agrees only when the set is dead ahead or dead astern: a 1 kn beam set puts the two 28 m
  // apart and a 2 kn one 60 m, so the water being checked was not the water she passes
  // through - and the one number the vessel acts on was solved against it.
  const release = { e: H.e - hE * releaseM, n: H.n - hN * releaseM };
  const band = { shortM: Math.max(0, nominalM - slackM), longM: nominalM + slackM, slackM };

  // The ground velocity she carries at the nominal stop: her remaining way plus the set.
  const arriveMs = Math.hypot(v1 * hE + sE, v1 * hN + sN);

  // Walk the drift track against the same keep-out model the router used - release to berth,
  // and one certified-clear-water's worth PAST it, because a hull that carries further than
  // modelled arrives with a little way still on. hold.js sized that water against this same
  // set, so it is the honest allowance for exactly this error.
  const overshootM = Math.max(0, o.holdClear || 0);
  const walkM = releaseM + overshootM;
  const steps = Math.max(2, Math.ceil(walkM / COAST_STEP_M));
  for (let i = 0; i <= steps; i++) {
    const d = (walkM * i) / steps;
    // IN to the berth she is still STEERED - crabbing down the cleared approach the router
    // gave her - and only PAST it, with the way off, is she set bodily. So the run in follows
    // the heading and only the overshoot follows the ground track.
    const q = d <= releaseM
      ? { e: release.e + hE * d, n: release.n + hN * d }
      : { e: H.e + uE * (d - releaseM), n: H.n + uN * (d - releaseM) };
    if (blocked(q, ko, buf)) {
      return { ok: false, release, hdg,
               why: (i === 0 ? "the release point itself is in a keep-out"
                             : "the drift track runs into a keep-out " + d.toFixed(0)
                               + " m along" + (d > releaseM ? ", past the berth" : "")) };
    }
  }

  return {
    ok: true, release, releaseLL: frame ? frame.fromEN(release.e, release.n) : null,
    hdg, waterM: run.m, groundM: releaseM, nominalM, slackM, secs: run.s, v1, arriveMs, band,
    why: "prop stopped " + releaseM.toFixed(0) + " m out, arriving at about "
         + (arriveMs / 0.514444).toFixed(1) + " kn after " + run.s.toFixed(0) + " s"
         + (alongSet < -0.02 ? ", stemming the set" : (alongSet > 0.02 ? ", set astern" : ""))
         + "; power resumes for whatever is left",
  };
}

/**
 * Is a coast worth flying at all here?
 *
 * ⚠ THE COAST IS AN OPTIMISATION IN BENIGN CONDITIONS, NEVER A MANOEUVRE OF LAST RESORT.
 * It is flown only while the look-ahead ladder says `clear`, and the first rung above that
 * ends it - see the caller. That single rule is what keeps guard.js untouched by this
 * feature: the ladder's hold/helm split is decided by a SECOND projection made with the
 * engines notionally stopped, which on a boat that has ALREADY stopped its engine collapses
 * (vel and drift become the same vector, so tEntry and tEntryDrift are always equal and only
 * `clear` and `helm` remain reachable). Rather than teach a safety ladder about a new state,
 * the coast simply never runs where the ladder has anything to say.
 */
export function coastWorthIt(groundM, holdClear) {
  // Not worth stopping the prop for less than the hold disc the boat may wander anyway.
  if (!(groundM > 0)) return false;
  return groundM > Math.max(5, (holdClear || 0));
}
