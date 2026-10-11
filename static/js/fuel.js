// static/js/fuel.js - the mission's fuel, and the point she must turn for home.
//
// Andy, 2026-10-11: "In the mission status card add projected fuel usage for mission. Use the DriX Fuel Planner and
// the Transit Calculator projects for reference. Estimate for BEN and [the small-class boat] until we have hard data. Monitor for
// available fuel to RTH. This point is to be calculated by projected having 20% fuel on arrival home. Send Alert and
// shift mission to RTH when fuel hits value."
//
// THE BURN IS THE SIM'S OWN LAW, read from the vessel file (`power`), so what the card projects is what the simulator
// then burns: fuel L/h = idle + (full - idle) (v / high)^exp, v the speed through the water, clamped to [0, high]
// (asv_console.py, the tick's burn and state()'s burn_lph); a battery drains (idle + load v / high) V/s, unclamped,
// exactly as the sim does. DriX's law is the console's fit to the Fuel planner's measured laws (within 2% from 7 to 11
// kn, vessels/drix08.json); BEN's and the small-class boat's are ESTIMATES until there is a measured burn - `measured` says
// which, off the file's own `source` line.
//
// AS THE REFERENCE PROJECTS DO IT (the Fuel planner's engine.py and the Transit Calculator's fuel.py): a leg's TIME
// is its length over the speed made good over the ground, and its FUEL is that time at the burn of the speed through
// the water - the set changes the fuel, never the boat's commanded speed. The RESERVE is a fraction of the TANK, not
// of what is aboard (both projects; Transit's mutate.py fails a load-based floor): 20% of capacity here, at his word.
//
// ⚠ A BATTERY'S EMPTY IS NOT THE GAUGE'S EMPTY. The console's battery gauge reads 0% at `battery_v.empty` (18 V on the
// small-class boat - where its maker's guide says the steering fails), and 20% of THAT span arrives home at 19.7 V: below the console's
// own critical band (20 V) and its factory low-voltage alarm (23 V, `battery_v.warn`). So a battery's usable
// span for this purpose runs down to `warn`, the alarm, and the 20% is of full - warn. An estimate, like the drain law.
//
// ⚠ ONLY WHILE HOME IS IN RANGE (Andy, 2026-10-11: "automatic RTH only when home is in range, otherwise an alert at 20%
// with no automatic action"). From a visiting harbor with home the far end of a passage, the fuel home plus the reserve
// is more than a full tank, so the RTH point stood above anything she could hold: the monitor read REACHED the moment
// she was armed and sent an RTH the console then refused (doRTH certifies a return of 50 km at most). fuelWatch decides
// which rule a point is under; out of range the monitor watches the reserve itself and only alerts. A DIESEL hull's rule
// only ("Long range missions are not to be undertaken by the battery powered units"): a battery hull keeps the RTH point.
//
// Every function here is PURE: the page hands in the vessel, the speeds, the route and the distance home, and nothing
// in this file commands anything.

import { legGroundMs } from "./targets.js";

/** Knots to meters per second (targets.js's figure, restated so this module reads alone). */
const FUEL_KN_MS = 0.514444;

/** What she must have left on arrival home: Andy, "projected having 20% fuel on arrival home". */
export const FUEL_RESERVE_FRAC = 0.20;

/** The projection's step along the route, m: where along it the RTH point is looked for. */
export const FUEL_STEP_M = 250;

/**
 * The slowest she is taken to make good over the ground on any leg, m/s - the CPA clock's floor (CPA_MIN_LEG_MS). A set
 * stronger than her speed through the water would stall her; the floor makes that leg very expensive, not free.
 */
export const FUEL_MIN_GROUND_MS = 0.3;

/** Above the RTH point by this fraction of the usable span, the card warns that she is close to it. */
export const FUEL_NEAR_FRAC = 0.05;

/** Back above the RTH point by this fraction of the usable span (refuelled, an override, a nearer home), it re-arms. */
export const FUEL_REARM_FRAC = 0.02;

/**
 * The vessel's energy model, from its file and its top speed (kn): null when the file carries none she can be
 * projected from.
 *
 *   { kind: "fuel" | "battery", unit: "L" | "V", full, floor, reserve, rateAt(kn) per hour, measured, source }
 *
 * `floor` is empty FOR A MISSION (0 L; a battery's factory alarm), `reserve` the 20% she must arrive home with, above
 * the floor. Levels are in the unit: liters aboard, or the pack's volts.
 */
export function energyModel(vessel, highKn) {
  const p = vessel && vessel.power;
  if (!p || !(highKn > 0)) return null;
  if (p.type === "fuel" && p.fuel) {
    const f = p.fuel, cap = f.capacity_l;
    if (!(cap > 0) || ![f.burn_lph_idle, f.burn_lph_full, f.burn_exp].every(Number.isFinite)) return null;
    return {
      kind: "fuel", unit: "L", full: cap, floor: 0, reserve: FUEL_RESERVE_FRAC * cap,
      rateAt: (kn) => {
        const fr = Math.min(1, Math.max(0, (kn || 0) / highKn));
        return f.burn_lph_idle + (f.burn_lph_full - f.burn_lph_idle) * Math.pow(fr, f.burn_exp);
      },
      measured: /^\s*MEASURED\b/.test(f.source || ""), source: f.source || "",
    };
  }
  if (p.type === "battery" && p.battery_v && p.drain) {
    const b = p.battery_v, d = p.drain;
    if (![b.full, b.warn, d.idle, d.load].every(Number.isFinite) || !(b.full > b.warn)) return null;
    return {
      kind: "battery", unit: "V", full: b.full, floor: b.warn, reserve: FUEL_RESERVE_FRAC * (b.full - b.warn),
      rateAt: (kn) => (d.idle + d.load * ((kn || 0) / highKn)) * 3600,
      measured: false, source: p.source || "",
    };
  }
  return null;
}

/** Her level now, in the model's unit, off the console's state frame - or null when the vessel reports none. */
export function energyLevel(model, status) {
  if (!model || !status) return null;
  const v = model.kind === "fuel" ? status.fuel_l : status.battery_v;
  return Number.isFinite(v) ? v : null;
}

/** The energy one leg takes: `m` meters at `twKn` through the water, `groundMs` made good. */
export function legEnergy(model, m, twKn, groundMs) {
  if (!model || !(m > 0)) return 0;
  return model.rateAt(twKn) * (m / Math.max(FUEL_MIN_GROUND_MS, groundMs)) / 3600;
}

/**
 * The energy to get HOME from a point `distM` away along the water, at `twKn` through it, in the set `drift` {e, n} m/s
 * taken along `u` {e, n}, the straight line from the point to home (the water route bends; the set is one reading at
 * the boat). Null when the distance is unknown.
 */
export function homeEnergy(model, distM, twKn, drift, u) {
  if (!model || !Number.isFinite(distM)) return null;
  if (distM <= 0) return 0;
  return legEnergy(model, distM, twKn, legGroundMs(twKn * FUEL_KN_MS, drift, u || { e: 0, n: 0 }, FUEL_MIN_GROUND_MS));
}

/** THE RTH POINT: the level at which she must turn for home to arrive with the reserve - `need` the energy home. */
export function rthLevel(model, need) {
  return model && Number.isFinite(need) ? model.floor + model.reserve + need : null;
}

/**
 * WHICH RULE THE MONITOR WATCHES BY, FROM A POINT (Andy, 2026-10-11: "automatic RTH only when home is in range,
 * otherwise an alert at 20% with no automatic action"). Home is IN RANGE when the console would route a return there
 * (`farM` null - the page's rthTooFar, the test doRTH refuses by) and a FULL tank gets her there with the reserve (the
 * RTH point is not above `full`). Then she is watched against the RTH point and sent home at it, as before. Otherwise -
 * further than a return the console will route, beyond a full tank, or no home known - she is watched against the
 * reserve itself (floor + reserve: 20% of the tank) and the console only alerts, for the operator to find a port.
 *
 * ⚠ A DIESEL HULL'S RULE ONLY (Andy, the same day: "Long range missions are not to be undertaken by the battery powered
 * units. Consider this only for the diesel powered ASV"). A battery hull is ALWAYS watched against the RTH point and sent
 * home at it, as before, however far home is: a battery boat out of range of home is set up wrong, and the loud REACHED
 * (and doRTH's refusal past 50 km, "Set Home where she is") is the right thing to say. No home known: `level` null, not
 * monitored, as before.
 *
 *   { mode: "rth" | "alert", level, why: null | "far" | "fuel" | "unknown" }   - `level` the one she is watched against
 */
export function fuelWatch(model, need, farM) {
  if (!model) return null;
  if (model.kind !== "fuel") return { mode: "rth", level: rthLevel(model, need), why: null };
  const reserveLevel = model.floor + model.reserve;
  if (Number.isFinite(farM)) return { mode: "alert", level: reserveLevel, why: "far" };
  const rth = rthLevel(model, need);
  if (rth == null) return { mode: "alert", level: reserveLevel, why: "unknown" };
  if (rth > model.full) return { mode: "alert", level: reserveLevel, why: "fuel" };
  return { mode: "rth", level: rth, why: null };
}

/**
 * THE MISSION AHEAD, WALKED: `legs` [{a: {e, n}, b: {e, n}, twKn, idx}] in a plane, from where she is now, each flown at
 * twKn through the water in the set `drift`; `level0` her level now (or null: the usage is still projected);
 * `homeNeedAt(p)` the energy home from a point (or null where it is unknown). Returns
 *
 *   { used, seconds, levelEnd, turn }
 *
 * `turn` is the FIRST point, stepping FUEL_STEP_M along the route, where her projected level has come down to the
 * RTH point there: {idx, alongM, at: {e, n}, level, rth} - where the mission will be cut short and she will be sent
 * home. Null when the whole mission is flown above it (or her level is unknown).
 */
export function projectMission(model, legs, drift, level0, homeNeedAt) {
  const out = { used: 0, seconds: 0, levelEnd: null, turn: null };
  if (!model || !legs) return out;
  const probe = (at, idx, alongM) => {
    if (out.turn || !Number.isFinite(level0) || !homeNeedAt) return;
    const need = homeNeedAt(at);
    if (!Number.isFinite(need)) return;
    const level = level0 - out.used, rth = rthLevel(model, need);
    if (level <= rth) out.turn = { idx, alongM, at, level, rth };
  };
  let alongM = 0;
  if (legs.length) probe(legs[0].a, legs[0].idx, 0);
  for (const g of legs) {
    const de = g.b.e - g.a.e, dn = g.b.n - g.a.n, L = Math.hypot(de, dn);
    if (!(L > 0)) continue;
    const u = { e: de / L, n: dn / L };
    const gms = legGroundMs((g.twKn || 0) * FUEL_KN_MS, drift, u, FUEL_MIN_GROUND_MS);
    const n = Math.max(1, Math.ceil(L / FUEL_STEP_M)), step = L / n;
    for (let k = 1; k <= n; k++) {
      out.used += legEnergy(model, step, g.twKn, gms);
      out.seconds += step / gms;
      alongM += step;
      probe({ e: g.a.e + u.e * step * k, n: g.a.n + u.n * step * k }, g.idx, alongM);
    }
  }
  if (Number.isFinite(level0)) out.levelEnd = level0 - out.used;
  return out;
}

/**
 * WHAT THE MONITOR DOES ON THIS FRAME, given her level, the RTH point, and the console's state. Pure; the page acts on
 * it. `o`: {level, rth, model, armed, estop, behavior, atHome, acted}. `acted` is the page's latch: the console has
 * already sent her home for this crossing, or found her already going.
 *
 *   { state: "unknown" | "ok" | "near" | "reached", send, latch, rearm }
 *
 *   send  - command the RTH now: reached, not yet acted on, armed, no E-STOP, not at home, and not already going home
 *           ("rth") nor in the guard's in-extremis escape ("escape" - the RTH waits for the operator's next command
 *           there, as the end-of-plan chain does).
 *   latch - the crossing is answered: sent now, or already on her way home.
 *   rearm - back above the RTH point by FUEL_REARM_FRAC of the span (refuelled, an override, a nearer home): the next
 *           crossing is acted on again.
 *
 * `o.alertOnly` (fuelWatch's "alert": home out of range, `rth` the reserve itself): reached, it is never a send - the
 * alert IS the answer, so it latches at once and re-arms as above. The latch is not dropped when the rule changes: a
 * boat alerted at 20% out of range that then comes into range is already below the RTH point, and the console does not
 * override the port the operator chose with an RTH of its own; refueled, she re-arms.
 */
export function rthDecision(o) {
  const res = { state: "unknown", send: false, latch: false, rearm: false };
  const m = o && o.model;
  if (!m || !Number.isFinite(o.level) || !Number.isFinite(o.rth)) return res;
  const span = m.full - m.floor;
  if (o.level > o.rth) {
    res.state = o.level <= o.rth + FUEL_NEAR_FRAC * span ? "near" : "ok";
    res.rearm = !!o.acted && o.level > o.rth + FUEL_REARM_FRAC * span;
    return res;
  }
  res.state = "reached";
  if (o.acted) return res;
  if (o.alertOnly) { res.latch = true; return res; }
  if (o.behavior === "rth") { res.latch = true; return res; }
  res.send = !!o.armed && !o.estop && !o.atHome && o.behavior !== "escape";
  res.latch = res.send;
  return res;
}
