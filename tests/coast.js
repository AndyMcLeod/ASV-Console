// tests/coast.js - coming in on the drift: the model, and where the prop stops.
//
// Andy, 2026-09-03, after the vessel hit a pier on an approach for the second time:
// *"Even consider drifting in by calculating wind and current affects on set and drift. Its
// ok to come in at idle with the prop stopped, but it take calculation to do it."*
//
// THE NUMBER THE MANOEUVRE EXISTS FOR. In his own session log the boat reached 1.74 m from
// its hold point at 6.07 kn. A 1,380 kg hull carries 6,728 J at that speed and 172 J at the
// one knot this arrives at. Measured end to end in the sim against the same berth: powered
// 4.31 kn / 3,392 J, drift-in 0.95 kn / 165 J.
//
//   node tests/coast.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - the mutations run against a sidecar, and the checks that went red:
//   the drag law replaced by a flat ramp                       -> 3   (the halving invariant)
//   coastLc accepts a malformed / absent block                 -> 2
//   the solver picks its own heading instead of the route's    -> 6
//   the keep-out walk stops at the berth instead of past it    -> 8
//   the walk is dropped entirely                               -> 7
//   COAST_MAX_S dropped (a five-minute glide ships)            -> 9
//
// ⚠ THIS FILE'S check() TAKES A THUNK - it CALLS `cond`. tests/end_action.js and
// tests/hold_station.py do NOT; each reads its condition directly, and a thunk there is a
// function object, always truthy, permanently green. That mistake has been made twice in
// this repo. Know which harness you are in.

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const { bbOf } = require("../static/js/geometry.js");
const C = require("../static/js/coast.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? detail + " — " : "") + "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}

const KN = 0.514444;
// A pier face 12 m north of the berth - the Eastport shape, and the boat comes up from the
// south (heading 000) because that is the side the router can actually reach.
const face = [{ e: -400, n: 12 }, { e: 400, n: 12 }, { e: 400, n: 312 }, { e: -400, n: 312 }];
const PIER = { polys: [{ ring: face, bb: bbOf(face), kind: "a dock / pier" }],
               lines: [], points: [], marks: [], sys: [], chans: [] };
const OPEN = { polys: [], lines: [], points: [], marks: [], sys: [], chans: [] };
const BUF = 5, LC = 35.12;
const base = { H: { e: 0, n: 0 }, ko: OPEN, buf: BUF, frame: null,
               v0Ms: 4 * KN, lc: LC, hdg: 0, holdClear: 8 };
const at = (o) => C.solveCoast(Object.assign({}, base, o));

console.log("Coming in on the drift:");

// ── 1-3. THE LAW ───────────────────────────────────────────────────────────────────────
check("1. the datum is a HEADREACH a mariner can measure, not a coefficient nobody can",
      () => { const l = C.coastLc({ from_kn: 7, to_kn: 2, distance_m: 44 });
              return l && Math.abs(l.lc - 44 / Math.log(3.5)) < 1e-9; },
      "44 m from 7 kn to 2 kn -> Lc " + (44 / Math.log(3.5)).toFixed(2) + " m");

check("2. no coast block, or a malformed one, is NULL — and null is the honest degrade: a "
      + "hull with no measured coast does not coast at all",
      () => C.coastLc(null) === null && C.coastLc(undefined) === null
            && C.coastLc({}) === null
            && C.coastLc({ from_kn: 2, to_kn: 7, distance_m: 44 }) === null   // backwards
            && C.coastLc({ from_kn: 7, to_kn: 2, distance_m: 0 }) === null
            && C.coastLc({ from_kn: 7, to_kn: 0, distance_m: 44 }) === null,
      "two of the three shipped hulls have no coast datum in any form");

// ⚠⚠ THE CHECK THAT KILLS A FLAT-RAMP IMPOSTOR. Under quadratic drag the distance to HALVE
// speed is Lc·ln2 whatever you release at - the law has no memory of v0. Under the sim's
// engine ramp (a constant deceleration) the distance goes as v0², so halving from 14 kn
// would cost four times halving from 7. If someone ever "simplifies" the decay back into
// the ramp, this is the check that notices.
check("3. THE HALVING INVARIANT: the distance to halve speed is Lc·ln2 from ANY release "
      + "speed — a constant-deceleration ramp would scale it as v0²",
      () => {
        const d = (v0) => C.coastRun(v0 * KN, (v0 / 2) * KN, LC).m;
        const want = LC * Math.log(2);
        return [14, 7, 4, 2].every((v0) => Math.abs(d(v0) - want) < 1e-9);
      },
      "Lc·ln2 = " + (LC * Math.log(2)).toFixed(2) + " m from 14, 7, 4 and 2 kn alike");

check("3b. ... and the run is Lc·ln(v0/v1), so shedding the same RATIO always costs the same",
      () => Math.abs(C.coastRun(8 * KN, 2 * KN, LC).m - C.coastRun(4 * KN, 1 * KN, LC).m) < 1e-9,
      "8->2 kn and 4->1 kn are both a factor of four, and both " +
      C.coastRun(8 * KN, 2 * KN, LC).m.toFixed(1) + " m");

// ── 4-5. WHAT IT REFUSES ───────────────────────────────────────────────────────────────
check("4. no coast length means no coast, in words",
      () => { const s = at({ lc: 0 }); return !s.ok && /no measured coast length/.test(s.why); },
      at({ lc: 0 }).why);

check("5. a boat already down to the speed this would leave her at has no way to shed",
      () => { const s = at({ v0Ms: 0.4 }); return !s.ok && /no way to shed/.test(s.why); },
      at({ v0Ms: 0.4 }).why);

// ── 6. THE HEADING IS THE ROUTE'S ───────────────────────────────────────────────────────
// ⚠ AN EARLIER CUT LET THE SOLVER CHOOSE THE HEADING THAT STEMS THE SET, on the seamanlike
// argument that arriving into the set is gentlest - and it is. But the release point then
// lands UP-SET of the berth, which is wherever the router did not go: at Eastport, 40 m
// inside the wharf. The router owns the path; the coast owns only where along it the prop
// stops.
check("6. the release point lies on the ROUTE'S approach heading, not one the coast picked "
      + "to suit the set",
      () => {
        const s = at({ hdg: 0, setMs: 1.0 * KN, setDeg: 270, ko: OPEN });
        if (!s.ok) return false;
        // heading 000 with a set from the east: the release must still be SOUTH of the
        // berth (astern along the route), never east or west of it.
        return s.release.n < -5 && Math.abs(s.release.e) < Math.abs(s.release.n);
      },
      (() => { const s = at({ hdg: 0, setMs: 1.0 * KN, setDeg: 270 });
               return s.ok ? "release e=" + s.release.e.toFixed(1) + " n=" + s.release.n.toFixed(1)
                           : s.why; })());

// ── 7-8. THE KEEP-OUT WALK ─────────────────────────────────────────────────────────────
check("7. the drift track is walked against the SAME keep-out model the router used, and a "
      + "track that runs into a pier is refused",
      () => { const s = at({ hdg: 180, ko: PIER, H: { e: 0, n: 60 } });
              return !s.ok && /keep-out/.test(s.why); },
      "a coast is a commanded motion like any other - it does not get to skip the model");

// ⚠ THE WALK GOES PAST THE BERTH, and it has to: a hull that carries further than modelled
// arrives with a little way still on and keeps going. hold.js sized the berth's clear water
// against this same set, so that water is the honest allowance for exactly this error.
check("8. ... and it is walked PAST the berth by the certified clear water, not merely up "
      + "to it — the overshoot is the error this model actually makes",
      () => {
        // berth 6 m south of the pier face: the run in is clear, but 8 m past it is not.
        const tight = { H: { e: 0, n: 6 }, ko: PIER, hdg: 0, holdClear: 8 };
        const s = at(tight);
        const noWalk = at(Object.assign({}, tight, { holdClear: 0 }));
        return !s.ok && noWalk.ok;      // refused only because the walk continued past
      },
      "the same geometry passes with no overshoot allowance and fails with one");

// ⚠⚠ 8b. THE WALK STARTS WHERE THE PROP ACTUALLY STOPS, AND WITH A CROSS SET THAT IS NOT
// ALONG THE GROUND TRACK. The only number that crosses to the vessel is the scalar
// `groundM`, and the vessel latches the drift-in on RANGE TO THE LAST WAYPOINT while the
// line-follower is still holding her ON the route - so the prop stops `groundM` back along
// the APPROACH. Stepping back along the ground track agrees only when the set is dead ahead
// or dead astern; on the beam the two points are far apart, and the water being walked was
// then not the water she passes through.
check("8b. with a CROSS set the release point is the range the VESSEL latches on, straight "
      + "back down the approach - not stepped back along the ground track, off to one side",
      () => {
        const s = at({ hdg: 0, setMs: 1.0 * KN, setDeg: 270, ko: OPEN });
        // heading 000: straight back down the approach is due south, so e = 0 exactly.
        return s.ok && Math.abs(s.release.e) < 1e-9
               && Math.abs(s.release.n + s.groundM) < 1e-9;
      },
      (() => { const s = at({ hdg: 0, setMs: 1.0 * KN, setDeg: 270, ko: OPEN });
               if (!s.ok) return s.why;
               return "release e=" + s.release.e.toFixed(2) + " n=" + s.release.n.toFixed(2)
                      + " against groundM " + s.groundM.toFixed(1) + " m"; })());

// ⚠⚠ 8c. AND THE RELEASE RANGE HAS TO FIT ON THE LEG THE VESSEL LATCHES ON. The arming test
// is `_wp_index == len(_plan) - 1 and dist_b <= _coast_from_m`, so a release range longer
// than the final leg is satisfied the instant she enters it: the prop stops at the leg's
// START rather than `groundM` out, and she arrives at v0*exp(-leg/Lc) - not the speed this
// solve quoted. On this hull a 10 m last leg against a ~50 m release turns a 1 kn arrival
// into 3 kn - 175 J against 1622 J - with the banner still saying one knot.
check("8c. a release range longer than the FINAL LEG is refused, because the vessel arms the "
      + "coast on that leg and would stop the prop at its start",
      () => { const s = at({ legM: 10 });
              return !s.ok && /final leg/.test(s.why); },
      at({ legM: 10 }).why);

check("8d. ACCEPTANCE: a leg with room for the whole release range still coasts, and a solve "
      + "given no leg at all is unchanged - the gate may only refuse, never move the answer",
      () => { const room = at({ legM: 400 }), none = at({});
              return room.ok && none.ok
                     && Math.abs(room.groundM - none.groundM) < 1e-9; },
      (() => { const room = at({ legM: 400 }), none = at({});
               return "legM 400 m -> " + (room.ok ? room.groundM.toFixed(1) + " m" : room.why)
                      + "; no legM -> " + (none.ok ? none.groundM.toFixed(1) + " m"
                                                   : none.why); })());

// ── 9. A COAST IS AN APPROACH, NOT AN ABDICATION ───────────────────────────────────────
check("9. a coast that would outlast the set reading it was solved from is refused",
      () => { const s = at({ v0Ms: 14 * KN, lc: 400 });
              return !s.ok && new RegExp(C.COAST_MAX_S + " s").test(s.why); },
      at({ v0Ms: 14 * KN, lc: 400 }).why);

// ── 10-11. WHAT THE SET BUYS ───────────────────────────────────────────────────────────
{
  const nose = at({ setMs: 1.0 * KN, setDeg: 180 });    // heading 000, set from ahead
  const stern = at({ setMs: 1.0 * KN, setDeg: 0 });     // set from astern, pushing her on
  check("10. a set on the nose is the gentlest arrival there is — it cancels her way exactly "
        + "and she arrives stopped over the ground",
        () => nose.ok && nose.arriveMs < 0.05,
        nose.ok ? "arrives " + (nose.arriveMs / KN).toFixed(2) + " kn" : nose.why);
  check("10b. ... while the same set ASTERN cannot be cancelled by coasting, and the arrival "
        + "carries it — said plainly rather than hidden",
        () => stern.ok && stern.arriveMs > nose.arriveMs + 0.3
              && /set astern/.test(stern.why),
        stern.ok ? "astern " + (stern.arriveMs / KN).toFixed(2) + " kn vs nose "
                   + (nose.arriveMs / KN).toFixed(2) + " kn" : stern.why);
  check("11. a stronger set on the nose releases LATER, because the water is doing the "
        + "braking",
        () => { const weak = at({ setMs: 0.2 * KN, setDeg: 180 });
                const strong = at({ setMs: 1.5 * KN, setDeg: 180 });
                return weak.ok && strong.ok && strong.groundM < weak.groundM; },
        "release " + at({ setMs: 0.2 * KN, setDeg: 180 }).groundM.toFixed(0) + " m in a weak set, "
          + at({ setMs: 1.5 * KN, setDeg: 180 }).groundM.toFixed(0) + " m in a strong one");
}

// ── 12. NOT WORTH STOPPING THE PROP FOR ────────────────────────────────────────────────
check("12. a coast shorter than the hold disc the boat may wander anyway is not worth "
      + "stopping the prop for",
      () => !C.coastWorthIt(3, 8) && C.coastWorthIt(40, 8),
      "the manoeuvre has to buy more than the berth already allows");

// ── 13-18. SLOWING DOWN IN GEAR IS NOT A COAST (measured from the DriX-8's logs, 2026-10-03; Andy: "Build the fix
//    with the 3.3 s lag"). The guard's SLOW is flown at idle with the clutch in: a dead time, then a decay toward her
//    idle-in-gear speed U. The closed form is checked against a NUMERICAL integration of its own ODE - something outside
//    the formula - and against the coast law it must reduce to.
{
  const drix = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "vessels", "drix08.json"), "utf8"));
  const L = C.slowLaw(drix.maneuvering.slowdown);
  // v dv/dx = (U^2 - v^2)/Lg, integrated by RK4 in x from v0 down to v1, timing dt = dx/v
  const integrate = (v0, v1, law) => {
    let v = v0, x = v0 * law.lag, t = law.lag;
    const h = 0.001, f = (vv) => (law.U * law.U - vv * vv) / (law.Lg * vv);
    while (v > v1) {
      const k1 = f(v), k2 = f(v + h * k1 / 2), k3 = f(v + h * k2 / 2), k4 = f(v + h * k3);
      const vn = v + h * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
      t += h / ((v + vn) / 2); x += h; v = vn;
    }
    return { m: x, s: t };
  };
  const r = C.slowRun(6.2 * KN, 4.0 * KN, L), n = integrate(6.2 * KN, 4.0 * KN, L);
  check("13. the in-gear law's closed form IS its own ODE: 6.2 -> 4.0 kn on the DriX's block matches a numerical "
        + "integration of v dv/dx = (U^2 - v^2)/Lg plus the dead time, distance and time both within 0.1%",
        () => L && Math.abs(r.m - n.m) / n.m < 1e-3 && Math.abs(r.s - n.s) / n.s < 1e-3,
        r.m.toFixed(2) + " m / " + r.s.toFixed(2) + " s against " + n.m.toFixed(2) + " m / " + n.s.toFixed(2) + " s");
  const zero = C.slowRun(7 * KN, 4 * KN, { U: 1e-9, Lg: LC, lag: 0 }), coast = C.coastRun(7 * KN, 4 * KN, LC);
  check("14. ... and with no idle thrust and no dead time it IS the coast law, to the millimeter",
        () => Math.abs(zero.m - coast.m) < 1e-3 && Math.abs(zero.s - coast.s) < 1e-3,
        zero.m.toFixed(3) + " / " + coast.m.toFixed(3) + " m");
  const lag0 = C.slowRun(6.2 * KN, 4.0 * KN, Object.assign({}, L, { lag: 0 }));
  check("15. the dead time adds exactly v0 x lag of water and lag of time once she is half a knot or more over the target - 3.3 s at 6.2 kn is 10.5 m",
        () => Math.abs((r.m - lag0.m) - 6.2 * KN * 3.3) < 1e-9 && Math.abs((r.s - lag0.s) - 3.3) < 1e-9,
        (r.m - lag0.m).toFixed(2) + " m, " + (r.s - lag0.s).toFixed(2) + " s");
  const below = C.slowRun(6.2 * KN, 3.0 * KN, L), at = C.slowRun(3.8 * KN, 3.0 * KN, L);
  check("16. she cannot be slowed below idle in gear: a target at or under it is answered as idle + 0.25 kn (3.9 kn), "
        + "never as water the law would need without end - and from below that there is nothing to shed",
        () => below && Math.abs(below.v1eff / KN - 3.9) < 1e-9 && isFinite(below.m) && at === null
              && C.slowRun(4.0 * KN, 4.0 * KN, L) === null,
        "asked 3.0 kn, answered " + (below ? (below.v1eff / KN).toFixed(2) + " kn in " + below.m.toFixed(1) + " m" : "null"));
  check("17. a slow-down block that is not one is refused (no idle speed, no length, a negative or non-finite lag) - "
        + "the vessel then keeps its coast law - and a block with no lag reads as none",
        () => C.slowLaw(null) === null && C.slowLaw({}) === null && C.slowLaw({ idle_kn: 0, length_m: 23.8 }) === null
              && C.slowLaw({ idle_kn: 3.65, length_m: 0 }) === null && C.slowLaw({ idle_kn: 3.65, length_m: 23.8, lag_s: -1 }) === null
              && C.slowLaw({ idle_kn: 3.65, length_m: 23.8, lag_s: Infinity }) === null
              && C.slowLaw({ idle_kn: 3.65, length_m: 23.8 }).lag === 0
              // REAL NUMBERS ONLY (2026-10-03): `+` made "3.65", [3.65], "0x4" and true numbers, Python's float() a
              // different set - so the sim and the page parted on a hand-edited file (tests/coast_sim.py 15 asks both)
              && C.slowLaw({ idle_kn: "3.65", length_m: 23.8 }) === null && C.slowLaw({ idle_kn: [3.65], length_m: 23.8 }) === null
              && C.slowLaw({ idle_kn: 3.65, length_m: "0x4" }) === null && C.slowLaw({ idle_kn: true, length_m: 23.8 }) === null
              && C.slowLaw({ idle_kn: 3.65, length_m: 23.8, lag_s: "3.3" }) === null && C.slowLaw("slow") === null);
  // THE MEASUREMENT IT WAS FITTED TO (20 commanded 7 -> 4 kn cuts, through the water, from the setpoint message):
  // 4.5 kn in 21.0 m, 4.25 kn in 25.5 m, 4.0 kn in 32.5 m. With the 3.3 s lag (the slower, ramped response) the law
  // must not come in SHORT of any of them - it feeds a reach, and short is the dangerous side.
  const meas = [[4.5, 21.0], [4.25, 25.5], [4.0, 32.5]];
  const vs = meas.map(([v1, m]) => [v1, m, C.slowRun(6.2 * KN, v1 * KN, L).m]);
  check("18. against her own logs: from 6.2 kn (her real speed at the 7-kn setpoint) the law with the DriX's 3.3 s lag "
        + "needs at least the measured MEDIAN water to reach 4.5, 4.25 and 4.0 kn - it is not short of the middle cut - and "
        + "the coast law it replaces was short of all three",
        () => vs.every(([, m, mod]) => mod >= m) && meas.every(([v1, m]) => C.coastRun(6.2 * KN, v1 * KN, LC).m < m),
        vs.map(([v1, m, mod]) => v1 + " kn: " + mod.toFixed(1) + " m vs measured " + m + " (coast law "
                                 + C.coastRun(6.2 * KN, v1 * KN, LC).m.toFixed(1) + ")").join("; "));
}

// ── 19-25. ONE STEP FOR THE SIM AND THE WALK, AND THE LEAD ──────────────────────────────────────────────────────────
//    Andy, 2026-10-03: "Model the in-gear slow-down in the sim", then, with the corner walk taking it too and the
//    governor slowing AHEAD of a slower leg: "Lead + walk + sim". speedStep is the step the corner walk takes and the
//    sim's speed_step_kn mirrors (tests/coast_sim.py holds the two to each other tick by tick); slowLeadM / leadWant
//    are the lead the governor commands and the walk flies.
{
  const drix = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "vessels", "drix08.json"), "utf8"));
  const L = C.slowLaw(drix.maneuvering.slowdown);
  const RAMP = 1.5 * KN, DT = 0.25;
  // a cut at a constant target from v0, stepped: time and water to reach it, and how long the speed did not move
  const cut = (v0, target, law, dt = DT, seq) => {
    const st = { lag: null }; let v = v0, t = 0, x = 0, held = 0;
    while (v > target + 1e-12 && t < 300) {
      const want = seq ? seq(t) : target, vn = C.speedStep(v, want, dt, st, law, RAMP);
      if (vn === v) held += dt;
      v = vn; t += dt; x += v * dt;
    }
    return { t, x, held, v };
  };
  const r7 = C.slowRun(7 * KN, 4 * KN, L), c7 = cut(7 * KN, 4 * KN, L), f7 = cut(7 * KN, 4 * KN, L, 0.01);
  const r62 = C.slowRun(6.2 * KN, 4 * KN, L), c62 = cut(6.2 * KN, 4 * KN, L);
  check("19. the STEP lands where the closed form says: a 7 -> 4 kn cut stepped at the vessel's 0.25 s tick reaches 4 kn "
        + "within one tick of slowRun's time and water (6.2 kn too), and converges on it as the step shrinks",
        () => Math.abs(c7.t - r7.s) <= DT && Math.abs(c7.x - r7.m) <= 7 * KN * DT
              && Math.abs(c62.t - r62.s) <= DT && Math.abs(c62.x - r62.m) <= 6.2 * KN * DT
              && Math.abs(f7.x - r7.m) < 0.05 && Math.abs(f7.t - r7.s) < 0.02,
        "7 kn: " + c7.x.toFixed(2) + " m / " + c7.t.toFixed(2) + " s stepped, " + r7.m.toFixed(2) + " m / " + r7.s.toFixed(2)
          + " s closed form (" + f7.x.toFixed(2) + " m at 0.01 s); 6.2 kn: " + c62.x.toFixed(2) + " vs " + r62.m.toFixed(2) + " m");
  // THE DEAD TIME: whole for a cut half a knot or more over the target, ramped below that, and FIXED when the cut
  // begins - a deeper cut on top (LOW after 4.5, the guard after the governor) carries on, it does not start again.
  const half = cut(4.25 * KN, 4 * KN, L), deeper = cut(7 * KN, 4 * KN, L, DT, (t) => (t < 2 ? 4.5 : 4.0) * KN);
  check("20. the DEAD TIME: a 7 -> 4 kn cut holds her speed for exactly the first 13 ticks (3.3 s), a cut 0.25 kn over "
        + "the target for half that, and a DEEPER cut 2 s in does not start it again",
        () => Math.abs(c7.held - 3.25) < 1e-9 && Math.abs(half.held - 1.5) < 1e-9 && deeper.held <= 3.25 + 1e-9,
        "held " + c7.held + " s / " + half.held + " s / deeper cut " + deeper.held + " s");
  // A STOP KEEPS THE RAMP (she cannot be cut below idle in gear, and a stop was never measured), and a cut that
  // follows a stop starts with the throttle already off: the station-keep asking LOW half way through her stop.
  const sStop = { lag: null }; let vs = 7 * KN;
  for (let i = 0; i < 4; i++) vs = C.speedStep(vs, 0, DT, sStop, L, RAMP);
  const vAfterStop = vs, vNext = C.speedStep(vs, 4 * KN, DT, sStop, L, RAMP);
  check("21. a STOP keeps the engine's ramp - 7 kn to 5.5 in 1 s - and a cut to LOW that follows it sheds speed on the "
        + "very next tick, with no fresh dead time",
        () => Math.abs(vAfterStop - 5.5 * KN) < 1e-9 && vNext < vAfterStop && sStop.lag === 0,
        "after 1 s of stop " + (vAfterStop / KN).toFixed(3) + " kn; next tick at LOW " + (vNext / KN).toFixed(3) + " kn");
  // A SPEED-UP, AND A HULL WITH NO LAW, ARE THE OLD CLAMP BIT FOR BIT - the small-class boat and the 4 m example USV are not touched.
  const targets = [7, 4, 4, 14, 2, 0, 9, 9, 3.95, 6].map((k) => k * KN);
  let vOld = 3 * KN, vNew = 3 * KN, same = true; const sN = { lag: null };
  for (let i = 0; i < 400; i++) {
    const w = targets[(i / 40) | 0];
    vOld += Math.max(-RAMP * DT, Math.min(RAMP * DT, w - vOld));
    vNew = C.speedStep(vNew, w, DT, sN, null, RAMP);
    if (vNew !== vOld) same = false;
  }
  const up = C.speedStep(4 * KN, 7 * KN, DT, { lag: null }, L, RAMP);
  check("22. a speed-up is the ramp on every hull, and with NO law the step IS the old clamp, bit for bit, over a run "
        + "of cuts, stops and speed-ups",
        () => same && Math.abs(up - (4 + 1.5 * DT) * KN) < 1e-12,
        "no-law step identical over 400 ticks: " + same + "; 4 -> 7 kn first tick " + (up / KN).toFixed(3) + " kn");
  const set = 1.75 * KN, withSet = C.slowLeadM(7 * KN, 4 * KN, L, 1.0, set);
  check("23. slowLeadM is her in-gear run plus the latency at her speed - 7 -> 4 kn with 1.0 s is 46.30 m - plus a "
        + "FOLLOWING set carried for the cut's time and the latency (1.75 kn: 61.17 m), a head set not credited, and 0 "
        + "with no law (a ramp hull is commanded at the leg, as always) or with nothing to shed",
        () => Math.abs(C.slowLeadM(7 * KN, 4 * KN, L, 1.0) - (r7.m + 7 * KN)) < 1e-9
              && Math.abs(C.slowLeadM(7 * KN, 4 * KN, L, 1.0) - 46.30) < 0.01
              && Math.abs(withSet - (r7.m + set * r7.s + (7 * KN + set))) < 1e-9
              && C.slowLeadM(7 * KN, 4 * KN, L, 1.0, -set) === C.slowLeadM(7 * KN, 4 * KN, L, 1.0)
              && C.slowLeadM(7 * KN, 4 * KN, null, 1.0) === 0 && C.slowLeadM(4 * KN, 4 * KN, L, 1.0) === 0
              && C.slowLeadM(3 * KN, 4 * KN, L, 1.0) === 0,
        C.slowLeadM(7 * KN, 4 * KN, L, 1.0).toFixed(2) + " m calm, " + withSet.toFixed(2) + " m in a following 1.75 kn set");
  // leadWant against a scripted route: legs ahead at {d, ms}
  const lead4 = C.slowLeadM(7 * KN, 4 * KN, L, 1.0);
  let asked = 0;
  const legs = (arr) => (j) => { asked = Math.max(asked, j + 1); return j < arr.length ? arr[j] : null; };
  const inside = C.leadWant(7 * KN, 7 * KN, legs([{ d: lead4 - 0.01, ms: 4 * KN }]), L, 1.0);
  const outside = C.leadWant(7 * KN, 7 * KN, legs([{ d: lead4 + 0.01, ms: 4 * KN }]), L, 1.0);
  const noLaw = C.leadWant(7 * KN, 7 * KN, legs([{ d: 1, ms: 4 * KN }]), null, 1.0);
  const two = C.leadWant(7 * KN, 7 * KN, legs([{ d: 10, ms: 5.5 * KN }, { d: 40, ms: 4 * KN }]), L, 1.0);
  asked = 0;
  C.leadWant(7 * KN, 7 * KN, legs([{ d: 10, ms: 7 * KN }, { d: 500, ms: 4 * KN }, { d: 900, ms: 4 * KN }]), L, 1.0);
  const askedFar = asked;
  const held = C.leadWant(7 * KN, 6 * KN, legs([{ d: 300, ms: 4 * KN }]), L, 1.0, 0);
  const setLead = C.leadWant(7 * KN, 7 * KN, legs([{ d: lead4 + 10, ms: 4 * KN }]), L, 1.0, -1, set);
  // already AT LOW 30 m short of a LOW leg (a stand-down dropped the latch): measured from her leg's own 7 kn, not her 4,
  // the lead holds her there - from her own speed it raised her to survey and cut her again (review)
  const atLow = C.leadWant(7 * KN, 4 * KN, legs([{ d: 30, ms: 4 * KN }]), L, 1.0);
  check("24. leadWant takes a slower leg ahead exactly when it lies within her lead (a centimeter inside, not a "
        + "centimeter outside), the slowest of two that do, never with no law, never asks past the farthest any cut "
        + "could need - and a LATCHED leg holds the target however far its start reads",
        () => inside.j === 0 && Math.abs(inside.ms - 4 * KN) < 1e-12 && outside.j === -1 && outside.ms === 7 * KN
              && noLaw.j === -1 && noLaw.ms === 7 * KN && two.j === 1 && Math.abs(two.ms - 4 * KN) < 1e-12
              && askedFar === 2 && held.j === 0 && Math.abs(held.ms - 4 * KN) < 1e-12 && setLead.j === 0 && atLow.j === 0,
        "lead " + lead4.toFixed(2) + " m; two legs -> leg " + two.j + "; legs asked with one 500 m out: " + askedFar);
  // 25. THE LEAD LANDS THE SPEED BY THE LEG, and it does not let go on the way in - swept over 401 run-ins (100-500 m),
  // because one length proves nothing about a tick grid (review: the first cut of this check passed at 300 m and
  // failed at 82 of 401). Walked in 0.25 s ticks with no latch, so a let-go shows as a flip, both ways: the walk's
  // (no latency) and the governor's (1 s latency, the command landing at once). Measured from her own speed alone -
  // the first rule - the governor's let go on every one of them.
  {
    const run = (D, lat, fromOwn) => { const st = { lag: null }; let v = 7 * KN, x = 0, began = null, flips = 0, eng = false;
      while (x < D) {
        const lw = C.leadWant(fromOwn ? v : 7 * KN, v, (j) => (j === 0 ? { d: D - x, ms: 4 * KN } : null), L, lat);
        if (lw.j === 0 && !eng) { eng = true; began = D - x; } else if (lw.j !== 0 && eng) flips++;
        v = C.speedStep(v, lw.ms, DT, st, L, RAMP); x += v * DT;
      }
      return { v, began, flips }; };
    let flipsWalk = 0, flipsGov = 0, worst = 0, beganOff = 0, oldLets = 0;
    for (let D = 100; D <= 500; D++) {
      const w = run(D, 0, false), g = run(D, 1.0, false), o = run(D, 1.0, true);
      flipsWalk += w.flips; flipsGov += g.flips; if (o.flips) oldLets++;
      worst = Math.max(worst, w.v / KN - 4, g.v / KN - 4);
      beganOff = Math.max(beganOff, Math.abs(w.began - r7.m));
    }
    check("25. the lead LANDS her at the slower speed by the leg on every run-in from 100 to 500 m - the cut begins "
          + "within a tick of slowRun's water before it - and never lets go on the way in, the walk's or the governor's; "
          + "measured from her own speed alone it let go on most of them",
          () => flipsWalk === 0 && flipsGov === 0 && worst <= 0.02 && beganOff <= 7 * KN * DT && oldLets > 300,
          "let-gos " + flipsWalk + " (walk) / " + flipsGov + " (governor); worst arrival " + (4 + worst).toFixed(3)
            + " kn; cut begun within " + beganOff.toFixed(2) + " m of slowRun; from her own speed: " + oldLets + " of 401 let go");
  }
}

// ── 26-28. THE CUT AS THE GUARD SEES IT COMING (Andy, 2026-10-03: "fix the guard's model of slowing down") ─────────────
// slowProfile is the speed she will have t seconds on - the same law speedStep steps, with the command's latency and the
// dead time still to run in front of it - and guard.js projectRoute walks it (`twAt`) where the slow-instead-of-hold
// used to walk an instant LOW.
{
  const drix = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "vessels", "drix08.json"), "utf8"));
  const L = C.slowLaw(drix.maneuvering.slowdown), RAMP = 1.5 * KN, DT = 0.25;
  const p0 = C.slowProfile(7 * KN, 4 * KN, L);
  // from 7 kn (the dead time whole) AND from 5.0 and 4.3 kn, where it is ramped in - the guard asks it from mid-cut speeds
  let worst = 0;
  for (const v0 of [7, 5.0, 4.3]) {
    const pv = C.slowProfile(v0 * KN, 4 * KN, L), st = { lag: null }; let v = v0 * KN;
    for (let k = 1; k <= 80; k++) { v = C.speedStep(v, 4 * KN, DT, st, L, RAMP); worst = Math.max(worst, Math.abs(v - pv(k * DT))); }
  }
  check("26. the profile IS the step: cuts to 4 kn from 7, 5.0 and 4.3 kn (the dead time whole, and ramped in) read off "
        + "slowProfile at every 0.25 s tick equal coast.js speedStep's stepped speeds - the dead time, the decay and the catch "
        + "at LOW - to a micrometer per second",
        () => worst < 1e-9, "worst difference " + worst.toExponential(2) + " m/s over 20 s, three cuts");
  const pL = C.slowProfile(7 * KN, 4 * KN, L, 1.0), pE = C.slowProfile(7 * KN, 4 * KN, L, 1.0, 2.5), pAll = C.slowProfile(7 * KN, 4 * KN, L, 1.0, 99);
  check("27. the command's latency comes first (the cut begins 1 s later), the time since the cut was commanded comes off "
        + "the delay still to run, a cut long commanded decays from now - and there is no profile with no law, or nothing to shed",
        () => [2, 5, 9, 14].every((t) => Math.abs(pL(t) - p0(t - 1)) < 1e-12 && Math.abs(pE(t) - p0(t + 1.5)) < 1e-12)
              && pAll(0.5) < 7 * KN && pAll(0) === 7 * KN
              && C.slowProfile(7 * KN, 4 * KN, null) === null && C.slowProfile(4 * KN, 4 * KN, L) === null
              && C.slowProfile(3.8 * KN, 3.0 * KN, L) === null,
        "at 5 s: fresh " + (p0(5) / KN).toFixed(3) + " kn, with the latency " + (pL(5) / KN).toFixed(3) + ", commanded 2.5 s ago "
          + (pE(5) / KN).toFixed(3));
  const G = require("../static/js/guard.js"), { bbOf } = require("../static/js/geometry.js");
  const wall = [{ e: 80, n: -50 }, { e: 120, n: -50 }, { e: 120, n: 50 }, { e: 80, n: 50 }];
  const KO = { polys: [{ ring: wall, bb: bbOf(wall), kind: "a wall" }], lines: [], points: [], marks: [], sys: [], chans: [] };
  const route = [{ e: 400, n: 0 }], pj = (o) => G.projectRoute({ e: 0, n: 0 }, 90, 7 * KN, { e: 0, n: 0 }, route, KO, 3, o || {});
  const fast = pj(), same = pj({ twAt: () => 7 * KN }), gear = pj({ twAt: C.slowProfile(7 * KN, 4 * KN, L, 1.0) }), low = pj({ twAt: () => 4 * KN });
  // each step walked at the speed she has at its START, the faster end: summed independently here
  const profG = C.slowProfile(7 * KN, 4 * KN, L, 1.0);
  let xs = 0, ts = 0; while (xs < 77) { ts += 0.5; xs += profG(ts - 0.5) * 0.5; }      // and WHERE: she runs due east
  check("28. guard.js projectRoute WALKS the profile: a wall 77 m on is met at 7 kn first, coming down in gear later, at an "
        + "instant LOW last - each step at the speed she has at its START (the faster end; an independent sum agrees to the "
        + "step) - and a constant `twAt` is the walk without it, to the step",
        () => fast && gear && low && fast.t < gear.t && gear.t < low.t && gear.t === ts && Math.abs(gear.at.e - xs) < 1e-9
              && same && same.t === fast.t
              && same.at.e === fast.at.e && same.at.n === fast.at.n,
        "entry at 7 kn " + (fast && fast.t) + " s, in gear " + (gear && gear.t) + " s (summed: " + ts + " s), at LOW " + (low && low.t) + " s");
  // 28b. AND THE CRAB IS TAKEN FROM THE SPEED SHE IS DOING: coming down from 7 kn along a line with a wall 4 m to the north
  // and a 1.5 kn set onto it, she crabs harder as she slows and holds the line - a crab kept at the 7 kn angle lets the
  // set walk her into the wall's buffer.
  const side = [{ e: -10, n: 4 }, { e: 600, n: 4 }, { e: 600, n: 40 }, { e: -10, n: 40 }];
  const KS = { polys: [{ ring: side, bb: bbOf(side), kind: "a wall" }], lines: [], points: [], marks: [], sys: [], chans: [] };
  const crabbed = G.projectRoute({ e: 0, n: 0 }, 90, 7 * KN, { e: 0, n: 1.5 * KN }, [{ e: 600, n: 0 }], KS, 2, { twAt: profG });
  check("28b. ... and the crab across a set is taken from the speed she is doing: slowing from 7 kn down a line 4 m off a "
        + "wall with a 1.5 kn set onto it, she crabs harder as she comes down and holds the line clear of the 2 m buffer",
        () => crabbed === null, "entry " + JSON.stringify(crabbed));
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
