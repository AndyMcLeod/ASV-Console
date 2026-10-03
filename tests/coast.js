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
              && C.slowLaw({ idle_kn: 3.65, length_m: 23.8 }).lag === 0);
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

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
