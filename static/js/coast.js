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
// 6,728 J; at the ~1 kn this maneuver aims to arrive at, 172 J. The point of a drift-in is
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
// ⚠⚠ THE LAW IS WRONG WHERE IT MATTERS MOST, AND THAT IS WHY THE MANEUVER IS BUILT TO
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
 * The speed the maneuver aims to be down to when it reaches the hold point, m/s.
 *
 * ⚠ A POLICY NUMBER, NAMED AS ONE - the same honesty NARROW_MAX_M carries. Physics does not
 * pick it; two practical ends bracket it. Slower is gentler but the quadratic tail is
 * merciless (coasting a DriX to 0.2 kn takes 105 m and five and a half minutes, which is not
 * an approach, it is an abdication). Faster stops being a drift-in. Half a meter per second
 * - a walking pace, about a knot - keeps the coast under a minute and still lands the
 * ~40x energy cut this whole maneuver exists for.
 */
export const COAST_ARRIVE_MS = 0.5;

/** Fractional uncertainty on Lc. The fleet's own estimates spanned 21-52 m about a ~35 m
 *  center; a third is that bracket rounded outward, not a comfortable margin. MEASURED since
 *  (2026-10-03, the DriX's own logs, 145 prop-out coasts): 35.6 m median, IQR 32.4-39.2 - and
 *  speed-dependent, ~22 m at 1-2 kn to ~45 m at 5-6 kn. A third covers that above ~2 kn; below
 *  it the law runs LONG (the real tail decays faster), which is the drift-in's safe side. */
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

// ── SLOWING DOWN IN GEAR IS NOT A COAST (measured 2026-10-03) ─────────────────────────────
//
// The coast law above is the PROP-OUT run: clutch in neutral, nothing pushing, way shed to zero. The AIS guard's SLOW
// is a different maneuver, and the DriX-8's own logs (Aug 2026, 16 sessions) show how she flies it: a cut from her
// 7-kn setpoint to her 4-kn LOW goes to IDLE WITH THE CLUTCH STILL IN GEAR, 20 cuts of 20. Two things follow, and
// neither is in the coast law:
//   * the idle prop still pushes, so her speed decays toward her IDLE-IN-GEAR speed (3.6-3.7 kn), not toward zero -
//     and LOW sits just above that floor, which is exactly where the last of the shedding is slowest;
//   * a DEAD TIME passes between the command and real deceleration (1.2 s for a single setpoint step, 3.3 s when her
//     guidance ramps the setpoint down).
// Measured from the setpoint message, through the water: 6.2 -> 4.0 kn in 32.5 m and 13.0 s (IQR 29.1-35.5 m, n=20, 6
// sessions). The coast law allowed 15.4 m and 6.1 s for the same run, so the AIS reach it fed was short by 13-17 m.
// No single coast length fixes that (the equivalent Lc runs 57-92 m by speed band) - the SHAPE is wrong, not the
// constant - and a bigger Lc in the coast block would break the drift-in it really belongs to (COAST_MAX_S).
//
// THE LAW: a dead time `lag`, then quadratic drag against the idle prop's residual thrust:
//     v dv/dx = (U^2 - v^2) / Lg            U = idle-in-gear speed, Lg = the in-gear decay length
//     x(v0->v1) = v0*lag + (Lg/2) * ln((v0^2 - U^2) / (v1^2 - U^2))
//     t(v0->v1) = lag + (Lg/(2U)) * ln(((v1+U)(v0-U)) / ((v1-U)(v0+U)))
// With U -> 0 and lag = 0 it is exactly coastRun. Fitted to the 20 cuts it reproduces them to within about a meter at
// the median (4.5, 4.25 and 4.0 kn). The vessel declares it as `maneuvering.slowdown` = {idle_kn, length_m, lag_s};
// the lag the DriX carries is the slower measured response, 3.3 s (Andy, 2026-10-03: "Build the fix with the 3.3 s
// lag") - whether a console SLOW reaches her as a step or a ramp is not yet known, and a ramp is the longer case.

/** How far above her idle-in-gear speed the in-gear law is asked to bring her, at least, m/s (0.25 kn). She cannot be
 *  slowed below idle in gear, and the decay toward it is asymptotic - so a LOW at or under idle is answered as idle
 *  plus this, never as a target the law would need infinite water to reach. */
export const SLOW_IDLE_MARGIN_MS = 0.25 * 0.514444;

/** Over how much speed above the target the dead time comes in, m/s (0.5 kn).
 *  ⚠ WITHOUT IT THE REACH JUMPED AT LOW (found reviewing this change, 2026-10-03): the decay term goes to zero as she
 *  nears the target, but a dead time charged in full does not - at 4.001 kn the DriX's reach was 56.8 m where 4.000 kn
 *  gave 50.0 m, and in the sim, which holds LOW at exactly 4.00 kn through the water, a hundredth of a knot of noise
 *  flipped the ladder's horizon by 7 m frame to frame. A boat within half a knot of LOW arrives at the 50 m line a few
 *  tenths over it, which the coast law always accepted; so the dead time's water ramps in across that half knot and
 *  is whole from there on. Every measured case (from 6.2 kn, 2.2 kn over LOW) carries the full lag. */
export const SLOW_LAG_RAMP_MS = 0.5 * 0.514444;

/**
 * The in-gear slow-down law from a vessel's `maneuvering.slowdown` block, or null - the same honest degrade as
 * coastLc: a vessel without the block (every hull but the DriX today) falls back to the coast law.
 * @returns {{U, Lg, lag, measured, source}|null}  U in m/s, Lg in m, lag in s
 */
export function slowLaw(slowBlock) {
  const b = slowBlock;
  if (!b || typeof b !== "object") return null;
  // REAL NUMBERS ONLY, as asv_console.py's parse takes them: `+` would make "3.65", [3.65], "0x4" and "" numbers, and
  // Python's float() takes a different set, so on a hand-edited vessel file the sim and the page parted (review).
  const num = (x) => typeof x === "number";
  if (!num(b.idle_kn) || !num(b.length_m) || !(b.lag_s == null || num(b.lag_s))) return null;
  const idleKn = b.idle_kn, Lg = b.length_m, lag = b.lag_s == null ? 0 : b.lag_s;
  if (!(idleKn > 0) || !(Lg > 0) || !(lag >= 0) || !isFinite(idleKn) || !isFinite(Lg) || !isFinite(lag)) return null;
  return { U: idleKn * 0.514444, Lg, lag, measured: !!b.measured, source: b.source || null };
}

/**
 * Distance and time to slow from `v0` to `v1` (m/s) IN GEAR, under law `law` (slowLaw) - or null when there is
 * nothing to shed (she is already at or below the speed it would leave her at). `v1` is raised to idle + the margin
 * when it asks for less: `v1eff` says what was actually answered.
 */
export function slowRun(v0, v1, law) {
  if (!law || !(v1 > 0)) return null;
  const U = law.U, Lg = law.Lg, lag = law.lag;
  const v1eff = Math.max(v1, U + SLOW_IDLE_MARGIN_MS);
  if (!(v0 > v1eff)) return null;
  const decay = (Lg / 2) * Math.log((v0 * v0 - U * U) / (v1eff * v1eff - U * U));
  const secs = (Lg / (2 * U)) * Math.log(((v1eff + U) * (v0 - U)) / ((v1eff - U) * (v0 + U)));
  const lagEff = lag * Math.min(1, (v0 - v1eff) / SLOW_LAG_RAMP_MS);   // continuous at the target (SLOW_LAG_RAMP_MS)
  return { m: v0 * lagEff + decay, s: lagEff + secs, v1eff, lagEff };
}

/**
 * ONE TICK OF THE THROTTLE, m/s -> m/s: the step the page's corner walk (turns.js flownTrack) takes, and the SAME step
 * as asv_console.py `speed_step_kn`, which the simulator takes (2026-10-03, Andy: "Model the in-gear slow-down in the
 * sim", with the corner walk taking it too). One law in three places - the AIS reach (slowRun), the sim and the walk -
 * because a walk that sheds speed faster than the boat certifies corners she rounds wider than it says.
 *
 * A CUT IN GEAR: with `law` set and the target below the speed but at or above idle + SLOW_IDLE_MARGIN_MS, she holds
 * her speed for a dead time - `law.lag`, ramped in over SLOW_LAG_RAMP_MS above the target, fixed in `st.lag` when the
 * cut begins and NOT restarted while it lasts - then dv/dt = -(v^2 - U^2)/Lg, stepped by its exact solution
 * v = U / tanh(atanh(U/v0) + U t/Lg), so a cut at a constant target lands where slowRun says to within a tick. The
 * governor catches her at the target. EVERYTHING ELSE is the engine's ramp, `rampMs` m/s per second, as it always was:
 * a speed-up, a hull with no law, and a cut below idle + margin - a STOP, which she cannot make in gear and which was
 * never measured.
 *
 * ⚠ A CUT THAT FOLLOWS A STOP STARTS WITH NO DEAD TIME. Coming down on the ramp (a stop) the throttle is already off,
 * so `st.lag` is left at 0 there rather than null: when the target then rises to LOW while she is still above it - the
 * station-keep asking for its re-approach speed half way through her stop - the cut carries on from where the way is,
 * with no fresh 3.3 s at full speed. Only holding or gaining speed, or being caught at the target, ends a cut (null).
 * Without it, in the first cut of this step, the farthest she overshot a hold point grew from 12.4 to 15.7 m arriving
 * at 7 kn and from 24.5 to 33.1 m at 14 kn (calm water).
 * @param st  {lag: number|null} - the walk's own state, one object per walk
 */
export function speedStep(v, want, dt, st, law, rampMs) {
  if (law && want >= law.U + SLOW_IDLE_MARGIN_MS && v > want) {
    if (st.lag == null) st.lag = law.lag * Math.min(1, (v - want) / SLOW_LAG_RAMP_MS);   // the cut begins
    const used = Math.min(dt, st.lag);
    st.lag -= used;
    const rest = dt - used;
    if (rest > 0) v = law.U / Math.tanh(Math.atanh(law.U / v) + law.U * rest / law.Lg);
    if (v <= want) { st.lag = null; return want; }                // caught at the target: the cut is over
    return v;
  }
  st.lag = want < v ? 0 : null;                                   // coming down on the ramp: the throttle is off
  return v + Math.max(-rampMs * dt, Math.min(rampMs * dt, want - v));
}

/**
 * HER SPEED THROUGH THE WATER `t` SECONDS FROM NOW, WHILE A CUT TO `v1` IS FLOWN IN GEAR - a function t -> m/s, or null
 * with no law or nothing to shed (the caller keeps its constant speed). She holds `v0` for the delay still to run - the
 * command's latency and the dead time, less the `elapsedS` since the command was sent (a cut already under way has
 * spent some of it) - then decays exactly as speedStep steps her, caught at the target. The CLEARANCE GUARD's question
 * (2026-10-03, Andy: "fix the guard's model of slowing down"): its slow-instead-of-hold answer used to walk her at LOW
 * from the instant it decided, and in gear she needs ~43 m to get there from 7 kn - at 7 kn it accepted a slow-down
 * from 41 m off the buffer edge where she needs ~54, so the hold fired late, ~7 m closer.
 * @param elapsedS  seconds since the cut was commanded (0 for a cut not yet sent)
 */
export function slowProfile(v0, v1, law, latencyS = 0, elapsedS = 0) {
  if (!law || !(v0 > v1)) return null;
  const v1eff = Math.max(v1, law.U + SLOW_IDLE_MARGIN_MS);
  if (!(v0 > v1eff)) return null;
  const delay = Math.max(0, (latencyS || 0) + law.lag * Math.min(1, (v0 - v1eff) / SLOW_LAG_RAMP_MS) - (elapsedS || 0));
  const th0 = Math.atanh(law.U / v0), k = law.U / law.Lg;
  return (t) => (t <= delay ? v0 : Math.max(v1eff, law.U / Math.tanh(th0 + k * (t - delay))));
}

/**
 * HOW FAR AHEAD OF A SLOWER LEG THE SLOWER SPEED HAS TO BE COMMANDED, m over the ground: the water the in-gear cut from
 * `v` (through the water) to `v1` takes (slowRun, its dead time included), plus `setMs` - the set ALONG her track, a
 * following set only - carried for the cut's own time, plus `latencyS` of travel at her ground speed for the command to
 * reach her. 0 with no law - a hull that sheds speed on the engine's ramp is commanded at the leg, as it always was -
 * and 0 when she is already at or under `v1`.
 *
 * ⚠ THE SET IS THE SAME TERM aisReachM CARRIES (drift x the cut's time), found by mutation: a following 1.75 kn set
 * carries her ~14 m further over the ground during a 15.5 s cut, and a lead measured in water alone delivered LOW 14 m
 * past the turn. A head set would shorten the ground run; it is not credited (setMs < 0 counts as 0), the safe side.
 */
export function slowLeadM(v, v1, law, latencyS = 0, setMs = 0) {
  if (!law || !(v > v1)) return 0;
  const run = slowRun(v, v1, law), s = setMs > 0 ? setMs : 0;
  return (run ? run.m + s * run.s : 0) + (v + s) * (latencyS || 0);
}

/**
 * THE LEAD (Andy, 2026-10-03: "Lead + walk + sim"). The speed she must ALREADY be heading for: the slowest of the
 * leg she is on (`want`, m/s) and every leg ahead whose start lies within slowLeadM of her now. One body, two askers -
 * the page's speed governor, which commands it, and the corner walk (turns.js flownTrack), which flies it - so the
 * walk certifies the corners she will really round.
 *
 * WHY: the governor used to command a turn's speed on the frame she reached the turn. On the engine's ramp that cost
 * a meter or two; in gear the DriX needs ~43 m to come from 7 kn to 4, so she entered every LOW turn at survey speed,
 * and the corner walk taking her law reported every corner it had answered by slowing as one slowing does not answer
 * (measured on DriX plans: 15 slowed / 6 unanswered became 0 / 21). With the lead the punch's verdicts are the ramp's
 * and Upload answers more (21 / 0).
 *
 * ⚠ IT DOES NOT LET GO HALF WAY. The lead is measured from the FASTER of her speed and `want` (her own leg's target),
 * so it does not shrink as she slows: `d` falls with every meter she makes and the lead stands still, so a leg ahead
 * once inside it stays inside it. Measured from her speed alone - the first cut of this - the lead shrank faster than
 * `d` near the end of every cut that charged a latency (the meters were spent early, and the dead time ramps out within
 * half a knot of the target): unlatched it let go on 401 of 401 run-ins in review, raising the target, ending the cut
 * and starting a fresh 3.3 s dead time. The same rule means a run that stood down at LOW and is governed again near a
 * LOW leg is not raised to survey only to be cut again (her own speed is no measure of the lead she would need at it).
 * The caller still latches - `latched`, the leg ahead that pulled the target down last time, kept until she reaches it
 * - because `want` changes on the way in when there are legs between, and a fix can jump.
 *
 * @param ahead    j -> {d, ms} | null - the j-th leg AHEAD (0 = the next one): `d` = meters from her to where that leg
 *                 starts, `ms` = its target; null past the route's end. `d` must not decrease with j.
 * @param latched  the j of a leg ahead that already holds the target down, or -1
 * @param setMs    the set along her track, m/s (a following set lengthens the lead; see slowLeadM)
 * @returns {ms, j}  the target, and which leg ahead set it (-1: her own leg's)
 */
export function leadWant(want, v, ahead, law, latencyS = 0, latched = -1, setMs = 0) {
  const out = { ms: want, j: -1 };
  if (!law) return out;
  if (latched >= 0) {
    const a = ahead(latched);
    if (a && a.ms < out.ms) { out.ms = a.ms; out.j = latched; }
  }
  const vLead = Math.max(v, want);                    // the speed the lead is measured from (see above)
  const reach = slowLeadM(vLead, law.U + SLOW_IDLE_MARGIN_MS, law, latencyS, setMs);   // the most any cut can need
  for (let j = 0; j < 10000; j++) {
    const a = ahead(j);
    if (!a || !(a.d <= reach)) break;
    if (a.ms < out.ms && a.d <= slowLeadM(vLead, a.ms, law, latencyS, setMs)) { out.ms = a.ms; out.j = j; }
  }
  return out;
}

// THE ROUTE LEFT as plane points ending at the berth (solveCoast): `o.path` as given, or the final leg
// straight back along `o.hdg` for `o.legM` - or without end, as the solver always took it with no leg.
function routeLeft(o) {
  if (Array.isArray(o.path) && o.path.length >= 2) return o.path;
  if (o.hdg == null || !o.H) return null;
  const hr = o.hdg * D2R, L = o.legM != null ? Math.max(0, o.legM) : 1e6;
  return [{ e: o.H.e - Math.sin(hr) * L, n: o.H.n - Math.cos(hr) * L }, o.H];
}
function pathLen(P) {
  let s = 0;
  for (let i = 1; i < P.length; i++) s += Math.hypot(P[i].e - P[i - 1].e, P[i].n - P[i - 1].n);
  return s;
}
// The point `m` meters back along P from its end (its first point, if P is shorter).
function backAlong(P, m) {
  let left = m;
  for (let i = P.length - 1; i > 0; i--) {
    const a = P[i], b = P[i - 1], L = Math.hypot(b.e - a.e, b.n - a.n);
    if (left <= L) return L > 0 ? { e: a.e + (b.e - a.e) * (left / L), n: a.n + (b.n - a.n) * (left / L) } : { e: a.e, n: a.n };
    left -= L;
  }
  return { e: P[0].e, n: P[0].n };
}
const bearingEN = (a, b) => (Math.atan2(b.e - a.e, b.n - a.n) / D2R + 360) % 360;
// The coast's ground run along heading `hdg`, for the first of solveCoast's two passes: as solveCoast
// solves it below, and only its length.
function coastAlong(hdg, v0Ms, lc, sE, sN) {
  const hr = hdg * D2R, hE = Math.sin(hr), hN = Math.cos(hr);
  const v1 = Math.max(COAST_ARRIVE_MS, -(sE * hE + sN * hN));
  const run = v1 < v0Ms ? coastRun(v0Ms, v1, lc) : null;
  return { nominalM: run ? Math.hypot(hE * run.m + sE * run.s, hN * run.m + sN * run.s) : 0 };
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
 * That is also why a stronger set makes this maneuver BETTER, not worse: the release range
 * shrinks because the set is doing the braking, and the arrival ground speed goes to zero
 * exactly (measured, DriX: 0.33 kn set -> release 40.6 m, arrive 0.64 kn; 2 kn set ->
 * release 6.8 m, arrive 0.00 kn).
 *
 * @param {object} o  {H, ko, buf, frame, setMs, setDeg, v0Ms, lc, holdClear} and EITHER `path` - the route left,
 *          plane points ending at the berth (2026-10-08) - OR `hdg` and `legM`, the final leg
 * @returns {{ok, release, releaseLL, hdg, waterM, groundM, secs, arriveMs, v1, band, why}}
 *          `ok:false` carries `why` in words. Refusing is a real answer - the caller powers
 *          in exactly as it does today.
 */
export function solveCoast(o) {
  const { ko, buf, frame, v0Ms, lc } = o;
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
  //
  // ⚠⚠ AND THE ROUTE LEFT, NOT THE LAST LEG (2026-10-08). `o.path`, when given, is the route she has
  // left to fly as plane points, ending at the berth, and the release range is measured ALONG IT: the
  // vessel arms the drift-in on the range left along its plan now. It armed on the last leg only, and a
  // laned route's last leg is 28-56 m where a drift-in from 14 kn needs 74-150 m - every Go-To and RTH of
  // his sessions of 2026-10-07/08 was refused here and ran onto its hold point at 14 kn. With no path the
  // route left is the final leg, straight back along `hdg` for `legM` (or without end), and every answer
  // is the one this solver has always given.
  const P = routeLeft(o);
  if (!P) return { ok: false, why: "no approach heading to coast along" };
  const H = P[P.length - 1], routeM = pathLen(P);

  // The set as a vector, and its component ALONG the approach. A set on the nose (negative
  // along-track) brakes the boat and is canceled exactly at v1 = -alongSet, arriving dead
  // stopped over the ground. A following set cannot be canceled by coasting at all, so the
  // floor applies and the arrival carries it.
  const sr = (o.setDeg || 0) * D2R;
  const sE = setMs * Math.sin(sr), sN = setMs * Math.cos(sr);
  // ⚠ ON A BENDING ROUTE THE HEADING IS THE CHORD OF THE STRETCH THE COAST SPANS, release point to berth -
  // the way she makes good while the prop is out - solved on the final leg's heading first for the range,
  // then again on that chord. On a straight approach the two are one; with no path it is `hdg`, as it was.
  let hdg = o.path ? bearingEN(P[P.length - 2], H) : o.hdg;
  if (o.path) {
    const pre = coastAlong(hdg, v0Ms, lc, sE, sN);
    if (pre.nominalM > 0.5) {
      const b = backAlong(P, Math.min(pre.nominalM, routeM));
      if (Math.hypot(H.e - b.e, H.n - b.n) > 0.5) hdg = bearingEN(b, H);
    }
  }
  const hr = hdg * D2R;
  const hE = Math.sin(hr), hN = Math.cos(hr);
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
  // ⚠⚠ THE RELEASE RANGE HAS TO FIT ON THE ROUTE THE VESSEL LATCHES ON. The only number that
  // crosses to the boat is the scalar `groundM`, and the vessel arms the drift-in once the range
  // left along its plan is down to it (SimVcu._route_left_m; until 2026-10-08 the LAST LEG ONLY).
  // So a release range longer than the route left is already satisfied the instant she starts:
  // the prop stops where she is, not `groundM` out, and she arrives at v0*exp(-route/Lc) rather
  // than at the speed this function quoted. Measured on the DriX: a 10 m last leg against a
  // 49.7 m release turns a 0.98 kn / 175 J arrival into 2.98 kn / 1622 J - and the banner still
  // said one knot. Refused in the idiom COAST_MAX_S already uses, because a coast that cannot be
  // flown as solved is not a coast.
  if (releaseM > routeM) {
    return { ok: false, release: null, hdg,
             why: o.path
               ? "the release range (" + releaseM.toFixed(0) + " m) is longer than the route left ("
                 + routeM.toFixed(0) + " m) - the prop would stop where she is and she would arrive "
                 + "with way still on"
               : "the release range (" + releaseM.toFixed(0) + " m) is longer than the final "
                 + "leg (" + o.legM.toFixed(0) + " m) - the prop would stop at the leg's "
                 + "start and she would arrive with way still on" };
  }
  // ⚠⚠ AND THE WALK STARTS WHERE THE PROP ACTUALLY STOPS, WHICH IS NOT ALONG `u`. The latch
  // is RANGE LEFT ALONG THE ROUTE on a boat the line-follower is holding ON it, so the
  // release point is `releaseM` back along the ROUTE, round whatever bends it has. Stepping back along the ground track
  // agrees only when the set is dead ahead or dead astern: a 1 kn beam set puts the two 28 m
  // apart and a 2 kn one 60 m, so the water being checked was not the water she passes
  // through - and the one number the vessel acts on was solved against it.
  const release = backAlong(P, releaseM);
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
      ? backAlong(P, releaseM - d)
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
    hdg, waterM: run.m, groundM: releaseM, nominalM, slackM, secs: run.s, v1, arriveMs, band, routeM,
    why: "prop stopped " + releaseM.toFixed(0) + " m out, arriving at about "
         + (arriveMs / 0.514444).toFixed(1) + " kn after " + run.s.toFixed(0) + " s"
         + (alongSet < -0.02 ? ", stemming the set" : (alongSet > 0.02 ? ", set astern" : ""))
         + "; power resumes for whatever is left",
  };
}

/**
 * Is a coast worth flying at all here?
 *
 * ⚠ THE COAST IS AN OPTIMISATION IN BENIGN CONDITIONS, NEVER A MANEUVER OF LAST RESORT.
 * It is flown only while the look-ahead ladder says `clear`, and the first rung above that
 * ends it - see the caller. That single rule is what keeps guard.js untouched by this
 * feature: the ladder's hold/helm split is decided by a SECOND projection made with the
 * engines notionally stopped, which on a boat that has ALREADY stopped its engine collapses
 * (vel and drift become the same vector, so tEntry and tEntryDrift are always equal and only
 * `clear` and `helm` remain reachable). Rather than teach a safety ladder about a new state,
 * the coast simply never runs where the ladder has anything to say.
 *
 * ⚠⚠ AND THE HOLD DISC NO LONGER DECIDES IT (Andy, 2026-10-08: "slow gradually on approach until it is
 * at or near dead stop prior to triggering the loiter command or whatever the next command may be").
 * It did - "not worth stopping the prop for less than the hold disc the boat may wander anyway" - and
 * four of the eight Go-Tos and RTHs in his logs of 2026-10-07/08 had a disc of 87 to 140 m, so each of those
 * would have had to coast further than that before this allowed it at all. A hold point is where she comes in
 * slow, whatever the water round it. Only a coast of COAST_MIN_M or less is not worth stopping the prop for. (`holdClear` is
 * still taken, and no longer read, so a caller written for the old rule asks the new one.)
 */
export const COAST_MIN_M = 5;
export function coastWorthIt(groundM, holdClear) {   // eslint-disable-line no-unused-vars
  return groundM > COAST_MIN_M;
}
