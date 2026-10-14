// tests/fuel_rth.js - the mission's fuel, the RTH point, and the shift home at it.
//
// Andy, 2026-10-11: "In the mission status card add projected fuel usage for mission. Use the DriX Fuel Planner and
// the Transit Calculator projects for reference. Estimate for BEN and [the small-class boat] until we have hard data. Monitor for
// available fuel to RTH. This point is to be calculated by projected having 20% fuel on arrival home. Send Alert and
// shift mission to RTH when fuel hits value."
//
// WHAT IS PINNED, and why each against something outside the code under test:
//   1     the card's burn law IS the simulator's - the server's own two lines, lifted from asv_console.py and run in
//         Python, at speeds either side of each hull's top speed - so what the card projects is what the sim burns;
//   2     each vessel's figures, against its file and (the small-class boat) the maker's guide it was fitted to;
//   3     a leg's fuel in a set: time over the ground, burn at the speed through the water, worked by hand;
//   4     the RTH point: floor + 20% of the TANK (not of what is aboard, the Transit Calculator's rule) + the fuel home;
//         a battery's floor is its factory alarm, not the gauge's 0%;
//   5     where on a plan she reaches it, against the closed form for a run straight away from home;
//   6     the monitor's decision table (fuel.js rthDecision);
//   7     the water distance home (home_field.js): never short of the true shortest path, within 3% of it, never
//         through a blocked corner, and blind where it should be;
//   8     the page's monitor, lifted out of the page and driven frame by frame: alert and send ONCE, the operator's
//         change after it stands, a point reached while she cannot be sent is sent the frame she can be;
//   9     the wiring: one estimate of the way home for monitor and card, the monitor caught inside the frame handler,
//         the build off the page's thread, the rows and the rehearsal row in the markup.
//   HOME OUT OF RANGE (2026-10-11, Andy: "automatic RTH only when home is in range, otherwise an alert at 20% with no
//   automatic action"): 6b-6c the decision and the rule (fuel.js fuelWatch: in range = a return doRTH would route AND
//   a full tank reaching home with the reserve); 8e-8i the page's monitor - home 900 km off, past a full tank, across
//   the change of rule, disarmed, no home: one alert at the reserve, nothing ever commanded; 9 one answer for monitor,
//   projection and doRTH; 9e the row and the pill say which rule she is under. DIESEL HULLS ONLY (Andy: "Long range
//   missions are not to be undertaken by the battery powered units"): 6d, 8j a battery hull keeps the RTH point.
//   (The server's sim-only `level` on /api/cmd/energy is tests/energy_chartinfo.py 13-13c.)
//
// TEETH - twenty-one mutations RUN, each on a scratch copy of static/, tests/, vessels/ and asv_console.py, all caught:
//   the reserve 25% (the Fuel planner's), not his 20%          -> 4, 5, 8
//   the fuel burn not clamped at top speed                     -> 1
//   the battery drain clamped (the sim's is not)               -> 1
//   a battery's floor its gauge's empty, not its alarm         -> 2, 4
//   the set ignored along the mission                          -> 3
//   the burn read at the ground speed                          -> 3
//   her level not drawn down along the route                   -> 5
//   the RTH point looked for at leg ends only                  -> 5
//   sent home in the middle of an escape                       -> 6
//   re-armed the moment she is above the point                 -> 6
//   sent again on every frame below it                         -> 6, 8, 8d
//   eight neighbors (no knight's moves)                        -> 7
//   a diagonal cutting a blocked corner                        -> 7b
//   the field in 32-bit floats again                           -> the run HANGS (the heap's 64-bit keys never match)
//   her offset from the cell's center dropped                  -> 7
//   'already said' asked before the send (the first cut)       -> 8c
//   every window sending                                       -> 8d
//   the monitor not caught in the frame handler                -> 9b
//   the card projecting with its own straight line home        -> 9
//   the raster back on the page's thread                       -> 9c
//   the sim's tick burning by another law than state() reports -> 0 (the line count: both copies, identical)
// and fifteen more for the out-of-range rule (scratchpad mutate_fuelrange.py), all caught - the 15th SURVIVED the first
// cut, because with her armed the page's own alert branch masks it; 8i (disarmed) was written for it:
//   out of range still sends (alertOnly ignored in fuel.js)    -> 6b, 8i (armed, the page's alert branch masks it)
//   the alert does not latch                                   -> 6b, 8e, 8g, 8i
//   the distance test ignored                                  -> 6c, 8e, 8g, 8i, 9e
//   past a full tank still in range                            -> 6c, 8f
//   exactly a full tank counted out of range                   -> 6c
//   no home: not watched at all                                -> 6c, 8h
//   the alert at the floor, not the reserve                    -> 6c, 8e, 8f, 8g, 8h, 8i, 9e
//   the page never asks the distance                           -> 8e, 8g, 8i, 9
//   the monitor not told it is alert-only                      -> 8i
//   the alert said on every frame                              -> 8e, 8i
//   the latch dropped when the rule changes                    -> 8g
//   the projection keeps the RTH point out of range            -> 9
//   the row's label not switched / 'RTH due' out of range      -> 9e
//   the pill keeps the RTH point out of range                  -> 9e
//   a battery hull put under the long-range rule (a 16th)      -> 6d, 8j

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const APP = process.env.ASV_APP || path.join(__dirname, "..");
const F = require(path.join(APP, "static", "js", "fuel.js"));
const HF = require(path.join(APP, "static", "js", "home_field.js"));
const H = fs.readFileSync(process.env.ASV_HTML || path.join(APP, "static", "asv.html"), "utf8");   // a sweep's sidecar, or the page
const SRV = fs.readFileSync(path.join(APP, "asv_console.py"), "utf8");
const WORKER = fs.readFileSync(path.join(APP, "static", "js", "home_field_worker.js"), "utf8");
const vessel = (id) => JSON.parse(fs.readFileSync(path.join(APP, "vessels", id + ".json"), "utf8"));

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? (typeof detail === "function" ? "" : detail) + " — " : "") + "THREW: " + e.message; }
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "detail threw: " + e.message; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}
// a function's whole text out of the page, by brace count
function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("function " + name + " not found in the page (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const KN = 0.514444;
const IDS = ["drix08", "drix08_em712", "ben_cworker4", "zboat_1800hs"];

console.log("The mission's fuel, the RTH point, and the shift home at it:");

// ── 1. THE CARD'S BURN IS THE SIMULATOR'S ─────────────────────────────────────────────────────────────────────────
{
  const lineOf = (re, what) => { const m = SRV.match(re); if (!m) throw new Error("the server's " + what + " line is gone"); return m[0].trim(); };
  const FRAC = lineOf(/^\s*frac = clamp\(self\.sog_kn \/ max\(1e-6, SPEED_KN\["high"\]\), 0\.0, 1\.0\)$/m, "fuel frac");
  const BURN = lineOf(/^\s*burn_lph = FUEL_BURN_IDLE \+ \(FUEL_BURN_FULL - FUEL_BURN_IDLE\) \* \(frac \*\* FUEL_BURN_EXP\)$/m, "fuel burn");
  // ⚠ THE BURN LINE IS WRITTEN TWICE - the sim's tick burns by it and state() reports burn_lph by it - and a regex that
  // took "the first match" would pass on the other copy if one were changed. Both, identical:
  const burnCopies = (SRV.match(/^\s*burn_lph = FUEL_BURN_IDLE \+ \(FUEL_BURN_FULL - FUEL_BURN_IDLE\) \* \(frac \*\* FUEL_BURN_EXP\)$/gm) || []).length;
  if (burnCopies !== 2) throw new Error("the server's burn line should appear twice (the tick and state()), found " + burnCopies);
  const DRAIN = lineOf(/^\s*drain = \(DRAIN_IDLE \+ DRAIN_LOAD \* \(self\.sog_kn \/ max\(1e-6, SPEED_KN\["high"\]\)\)\) \* dt$/m, "battery drain");
  const SPEEDS = [0, 1, 2.5, 3, 5.5, 7, 8, 10, 11.5, 14];
  const py = [
    "import json, sys",
    "def clamp(v, a, b): return a if v < a else b if v > b else v",
    "FRAC, BURN, DRAIN, ids, app, speeds = json.loads(sys.argv[1])",
    "class O: pass",
    "out = {}",
    "for vid in ids:",
    "    v = json.load(open(app + '/vessels/' + vid + '.json', encoding='utf-8'))",
    "    SPEED_KN = v['propulsion']['speeds_kn']; p = v['power']; self = O(); res = []",
    "    for kn in speeds:",
    "        self.sog_kn = kn; dt = 3600.0; g = dict(globals()); g.update(self=self, dt=dt, SPEED_KN=SPEED_KN, clamp=clamp)",
    "        if p['type'] == 'fuel':",
    "            f = p['fuel']; g.update(FUEL_BURN_IDLE=f['burn_lph_idle'], FUEL_BURN_FULL=f['burn_lph_full'], FUEL_BURN_EXP=f['burn_exp'])",
    "            exec(FRAC, g); exec(BURN, g); res.append(g['burn_lph'])",
    "        else:",
    "            g.update(DRAIN_IDLE=p['drain']['idle'], DRAIN_LOAD=p['drain']['load'])",
    "            exec(DRAIN, g); res.append(g['drain'])",
    "    out[vid] = res",
    "print(json.dumps(out))",
  ].join("\n");
  const r = cp.spawnSync(process.env.PYTHON || "python", ["-c", py, JSON.stringify([FRAC, BURN, DRAIN, IDS, APP.replace(/\\/g, "/"), SPEEDS])],
                         { encoding: "utf8" });
  const srv = JSON.parse(r.stdout || "null");
  let worst = 0, where = "";
  for (const id of IDS) {
    const v = vessel(id), m = F.energyModel(v, v.propulsion.speeds_kn.high);
    SPEEDS.forEach((kn, i) => { const d = Math.abs(m.rateAt(kn) - srv[id][i]); if (d > worst) { worst = d; where = id + " at " + kn + " kn"; } });
  }
  check("1. THE CARD'S BURN IS THE SIMULATOR'S: fuel.js's rate, against the server's own burn and drain lines (lifted from "
        + "asv_console.py and run in Python), for all four hulls at ten speeds - past top speed too, where the fuel burn is "
        + "clamped and the battery drain is not",
        () => srv && worst < 1e-9,
        () => "largest difference " + worst.toExponential(2) + (where ? " (" + where + ")" : "") + (r.stderr ? "; python: " + r.stderr.slice(0, 200) : ""));
}

// ── 2. EACH VESSEL'S FIGURES ──────────────────────────────────────────────────────────────────────────────────────
{
  const M = Object.fromEntries(IDS.map((id) => { const v = vessel(id); return [id, F.energyModel(v, v.propulsion.speeds_kn.high)]; }));
  const z = M.zboat_1800hs, zToAlarmMin = (kn) => (z.full - z.floor) / z.rateAt(kn) * 60;
  check("2. the hulls' figures, from their files: the DriX burns MEASURED (her file's law: 1.05 L/h idle, 3.80 at 7 kn and "
        + "5.96 at 10 kn on the EM712), BEN and the small-class boat ESTIMATED; BEN's 100 L tank at 5.0 L/h flat out (20 h, his "
        + "figures); the small-class boat's empty FOR A MISSION is her 23 V alarm, and her drain is fitted to the maker's 90 "
        + "minutes to it at survey speed (3 kn)",
        () => M.drix08_em712.measured && M.drix08.measured && !M.ben_cworker4.measured && !z.measured
              && near(M.drix08_em712.rateAt(0), 1.05, 1e-9) && near(M.drix08_em712.rateAt(7), 3.80, 0.01)
              && near(M.drix08_em712.rateAt(10), 5.96, 1e-9) && M.ben_cworker4.full === 100
              && near(M.ben_cworker4.rateAt(5.5), 5.0, 1e-9) && z.kind === "battery" && z.floor === 23
              && near(zToAlarmMin(3), 90, 1) && zToAlarmMin(6) > 30 && zToAlarmMin(6) < 90
              && /User's Guide/.test(vessel("zboat_1800hs").power.source || ""),
        () => "EM712 " + [0, 7, 10].map((k) => M.drix08_em712.rateAt(k).toFixed(2)).join("/") + " L/h; BEN " + M.ben_cworker4.rateAt(5.5)
            + " L/h of " + M.ben_cworker4.full + " L; small-class floor " + z.floor + " V, " + zToAlarmMin(3).toFixed(1) + " min to it at 3 kn, "
            + zToAlarmMin(6).toFixed(1) + " at 6");
}

// ── 3. A LEG'S FUEL IN A SET ──────────────────────────────────────────────────────────────────────────────────────
{
  const v = vessel("drix08"), m = F.energyModel(v, v.propulsion.speeds_kn.high);
  const leg = [{ a: { e: 0, n: 0 }, b: { e: 10000, n: 0 }, twKn: 8, idx: 0 }];
  const run = (drift) => F.projectMission(m, leg, drift, null, null);
  // 10 km due east at 8 kn through the water: calm 2430.0 s; a 1 kn set from ahead makes good 7 kn (2777.1 s), from
  // astern 9 kn (2160.0 s), across sqrt(64 - 1) = 7.937 kn (2449.4 s). The fuel is each time at the 8 kn burn.
  const want = { calm: 10000 / (8 * KN), head: 10000 / (7 * KN), fair: 10000 / (9 * KN), cross: 10000 / (Math.sqrt(63) * KN) };
  const got = { calm: run({ e: 0, n: 0 }), head: run({ e: -KN, n: 0 }), fair: run({ e: KN, n: 0 }), cross: run({ e: 0, n: KN }) };
  const okAll = Object.keys(want).every((k) => near(got[k].seconds, want[k], 0.5) && near(got[k].used, m.rateAt(8) * want[k] / 3600, 1e-6));
  const stall = run({ e: -9 * KN, n: 0 });
  check("3. A LEG'S FUEL IN A SET: its time over the ground (crabbing across a cross-set costs along-track speed), its "
        + "burn at the speed through the water - calm, head, fair and cross, worked by hand - and a set stronger than she "
        + "is costs a great deal, not nothing (the 0.3 m/s floor)",
        () => okAll && near(stall.seconds, 10000 / F.FUEL_MIN_GROUND_MS, 0.5) && near(stall.used, m.rateAt(8) * stall.seconds / 3600, 1e-6),
        () => Object.keys(want).map((k) => k + " " + got[k].seconds.toFixed(1) + " s / " + got[k].used.toFixed(3) + " L (want "
            + want[k].toFixed(1) + " s)").join(", ") + "; a 9 kn head set: " + stall.used.toFixed(1) + " L");
}

// ── 4. THE RTH POINT ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const v = vessel("drix08_em712"), m = F.energyModel(v, v.propulsion.speeds_kn.high);
  const b = vessel("zboat_1800hs"), z = F.energyModel(b, b.propulsion.speeds_kn.high);
  check("4. THE RTH POINT is the floor, plus 20% of the TANK (not of what is aboard - the Transit Calculator's rule), plus "
        + "the fuel home: 50 L of the DriX's 250 L whatever she carries; a battery's floor is its factory alarm and its 20% "
        + "is of the span above it (23.7 V on the small-class boat, not the gauge's 19.7)",
        () => F.FUEL_RESERVE_FRAC === 0.2 && m.reserve === 50 && m.floor === 0 && F.rthLevel(m, 7.5) === 57.5
              && near(z.reserve, 0.7, 1e-9) && near(F.rthLevel(z, 0), 23.7, 1e-9) && F.rthLevel(m, null) === null,
        () => "DriX reserve " + m.reserve + " L, RTH point with 7.5 L home " + F.rthLevel(m, 7.5) + " L; small-class " + F.rthLevel(z, 0).toFixed(2) + " V at home");
}

// ── 5. WHERE ON A PLAN SHE REACHES IT ─────────────────────────────────────────────────────────────────────────────
{
  const v = vessel("drix08_em712"), m = F.energyModel(v, v.propulsion.speeds_kn.high);
  // 20 km straight away from home at 8 kn, calm, home at the origin. Out and back cost the same per meter, so the
  // level at x is L0 - e(x) and the RTH point there is 50 + e(x): they meet where e(x) = (L0 - 50) / 2.
  const e = (x) => m.rateAt(8) * (x / (8 * KN)) / 3600;
  const legs = [{ a: { e: 0, n: 0 }, b: { e: 20000, n: 0 }, twKn: 8, idx: 4 }];
  const need = (p) => F.homeEnergy(m, Math.hypot(p.e, p.n), 8, { e: 0, n: 0 }, { e: -1, n: 0 });
  const L0 = 50 + 2 * e(12000), P = F.projectMission(m, legs, { e: 0, n: 0 }, L0, need);
  const plenty = F.projectMission(m, legs, { e: 0, n: 0 }, 50 + 2 * e(20000) + 1, need);
  const already = F.projectMission(m, legs, { e: 0, n: 0 }, 49, need);
  check("5. WHERE ON THE PLAN SHE REACHES IT: straight away from home, the closed form puts it 12 km out - found within "
        + "one step (" + F.FUEL_STEP_M + " m) and never before it; a level that covers the whole run has none, and one "
        + "already below it reaches it where she is",
        () => P.turn && P.turn.alongM >= 12000 - 1e-6 && P.turn.alongM <= 12000 + F.FUEL_STEP_M && P.turn.idx === 4
              && plenty.turn === null && already.turn && already.turn.alongM === 0,
        () => "turn at " + (P.turn ? P.turn.alongM.toFixed(0) + " m (level " + P.turn.level.toFixed(2) + ", point " + P.turn.rth.toFixed(2) + ")" : "none")
            + "; with plenty: " + (plenty.turn ? plenty.turn.alongM : "none") + "; already below: " + (already.turn ? already.turn.alongM : "none"));
}

// ── 6. THE MONITOR'S DECISION ─────────────────────────────────────────────────────────────────────────────────────
{
  const v = vessel("drix08_em712"), model = F.energyModel(v, v.propulsion.speeds_kn.high);
  const D = (o) => F.rthDecision({ model, level: 60, rth: 61, armed: true, estop: false, behavior: "survey", atHome: false, acted: false, ...o });
  const t = {
    send: D({}), disarmed: D({ armed: false }), estop: D({ estop: true }), escape: D({ behavior: "escape" }),
    home: D({ atHome: true }), going: D({ behavior: "rth" }), acted: D({ acted: true }),
    near: D({ level: 70 }), ok: D({ level: 100 }), rearmLow: D({ level: 63, acted: true }), rearm: D({ level: 67, acted: true }),
    unknown: D({ level: null }),
  };
  check("6. THE DECISION: at the point she is sent home (and latched) - unless disarmed, in E-STOP, at home or held in "
        + "extremis (said, not latched: sent the frame she can be), already going home (latched, nothing sent), or "
        + "already answered; warned within 5% of the tank above it; re-armed only 2% clear above it",
        () => t.send.send && t.send.latch && t.send.state === "reached"
              && [t.disarmed, t.estop, t.escape, t.home].every((x) => x.state === "reached" && !x.send && !x.latch)
              && t.going.latch && !t.going.send && !t.acted.send && !t.acted.latch
              && t.near.state === "near" && t.ok.state === "ok" && !t.rearmLow.rearm && t.rearm.rearm
              && t.unknown.state === "unknown" && !t.unknown.send,
        () => Object.entries(t).map(([k, x]) => k + ":" + x.state + (x.send ? "+send" : "") + (x.latch ? "+latch" : "") + (x.rearm ? "+rearm" : "")).join(" "));
  // HOME OUT OF RANGE (2026-10-11, Andy: "automatic RTH only when home is in range, otherwise an alert at 20% with no
  // automatic action"): reached is never a send, armed and under way or not, and the alert latches at once.
  const A = (o) => D({ alertOnly: true, ...o });
  const a = { armed: A({}), going: A({ behavior: "rth" }), acted: A({ acted: true }), near: A({ level: 70 }),
              rearmLow: A({ level: 63, acted: true }), rearm: A({ level: 67, acted: true }) };
  check("6b. ... and OUT OF RANGE (alertOnly): reached is NEVER a send - armed and under way included - and latches at "
        + "once (the alert is the answer); near and the re-arm as in range",
        () => [a.armed, a.going].every((x) => x.state === "reached" && !x.send && x.latch) && !a.acted.send && !a.acted.latch
              && a.near.state === "near" && !a.rearmLow.rearm && a.rearm.rearm,
        () => Object.entries(a).map(([k, x]) => k + ":" + x.state + (x.send ? "+send" : "") + (x.latch ? "+latch" : "") + (x.rearm ? "+rearm" : "")).join(" "));
  // WHICH RULE A POINT IS UNDER (fuel.js fuelWatch). The DriX's tank is 250 L: the reserve 50 L, the floor 0.
  const W = (need, far) => F.fuelWatch(model, need, far);
  const w = { inRange: W(11, null), atFull: W(200, null), pastFull: W(200.5, null), far: W(11, 60000), none: W(null, null) };
  check("6c. HOME IN RANGE is a return the console would route (no `farM`) AND a full tank reaching it with the reserve: "
        + "then the RTH point (floor + reserve + the fuel home); otherwise - too far, past a full tank, or no home known - "
        + "the reserve itself (20% of the tank) and the alert",
        () => w.inRange.mode === "rth" && near(w.inRange.level, 61, 1e-9) && w.atFull.mode === "rth" && near(w.atFull.level, 250, 1e-9)
              && w.pastFull.mode === "alert" && w.pastFull.why === "fuel" && near(w.pastFull.level, 50, 1e-9)
              && w.far.mode === "alert" && w.far.why === "far" && near(w.far.level, 50, 1e-9)
              && w.none.mode === "alert" && w.none.why === "unknown" && F.fuelWatch(null, 11, null) === null,
        () => Object.entries(w).map(([k, x]) => k + ":" + x.mode + "@" + x.level + (x.why ? "(" + x.why + ")" : "")).join(" "));
  // ... A DIESEL HULL'S RULE ONLY (Andy: "Long range missions are not to be undertaken by the battery powered units.
  // Consider this only for the diesel powered ASV"). The small-class boat's pack: full 26.5 V, alarm 23, reserve 0.7.
  const zv = vessel("zboat_1800hs"), zm = F.energyModel(zv, zv.propulsion.speeds_kn.high);
  const Z = (need, far) => F.fuelWatch(zm, need, far);
  const z = { far: Z(0.5, 900000), pastFull: Z(5, null), none: Z(null, null), inRange: Z(0.5, null) };
  check("6d. ... and a BATTERY hull is never under it: too far, past a full pack, or in range, she is watched against the "
        + "RTH point (the fuel home + the reserve) as before; no home known, nothing is watched (as before)",
        () => zm.kind === "battery" && ["far", "pastFull", "inRange"].every((k) => z[k].mode === "rth")
              && near(z.far.level, F.rthLevel(zm, 0.5), 1e-9) && near(z.pastFull.level, F.rthLevel(zm, 5), 1e-9)
              && z.pastFull.level > zm.full && z.none.mode === "rth" && z.none.level === null,
        () => Object.entries(z).map(([k, x]) => k + ":" + x.mode + "@" + x.level).join(" "));
}

// ── 7. THE WATER DISTANCE HOME ────────────────────────────────────────────────────────────────────────────────────
{
  const g = HF.homeGrid([{ e: 0, n: 0 }, { e: 2000, n: 2000 }], 0, null, 10, 1e7);
  const open = new Uint8Array(g.W * g.H), home = { e: 200, n: 200 };
  const d0 = HF.homeField(open, g.W, g.H, HF.homeSeeds(g, open, home, 100));
  const ratios = [0, 10, 22.5, 30, 45, 60, 80].map((a) => {
    const r = 1500, p = { e: home.e + r * Math.cos(a * Math.PI / 180), n: home.n + r * Math.sin(a * Math.PI / 180) };
    return HF.fieldDistM(g, d0, open, p, 50) / Math.hypot(p.e - home.e, p.n - home.n);
  });
  // a wall across the middle with a gap at the top: the true shortest path runs round its end
  const wall = new Uint8Array(g.W * g.H);
  for (let y = 0; y < g.H; y++) for (let x = 95; x < 105; x++) if (y < 180) wall[y * g.W + x] = 1;
  const dw = HF.homeField(wall, g.W, g.H, HF.homeSeeds(g, wall, home, 100)), boat = { e: 1800, n: 200 };
  const viaWall = HF.fieldDistM(g, dw, wall, boat, 100);
  const tru = Math.hypot(950 - 200, 1800 - 200) + 100 + Math.hypot(1800 - 1050, 200 - 1800);
  check("7. THE WATER DISTANCE HOME is never SHORT of the true shortest path and within 3% of it: in open water at seven "
        + "bearings, and round the end of a wall the straight line runs through (where a straight-line estimate would "
        + "be less than half of it)",
        () => ratios.every((q) => q >= 1 - 1e-9 && q <= 1.03) && viaWall >= tru - 1 && viaWall <= tru * 1.03,
        () => "open water " + ratios.map((q) => q.toFixed(4)).join(" ") + "; round the wall " + viaWall.toFixed(0) + " m, true "
            + tru.toFixed(0) + " m, straight " + Math.hypot(boat.e - home.e, boat.n - home.n).toFixed(0) + " m");
  // a diagonal wall of cells touching only at their corners, corner to corner across the grid: it must not be passed
  const W = 60, diag = new Uint8Array(W * W);
  for (let i = 0; i < W; i++) diag[i * W + i] = 1;
  const dd = HF.homeField(diag, W, W, [{ i: 40 * W + 5, d: 0 }]);   // seeded above the diagonal (row 40, column 5)
  check("7b. ... and never through a blocked CORNER: a wall of cells meeting only at their corners holds - nothing on its "
        + "far side is reached, by a diagonal or a knight's move",
        () => !Number.isFinite(dd[5 * W + 40]) && Number.isFinite(dd[50 * W + 10]),
        () => "far side " + dd[5 * W + 40] + ", near side " + dd[50 * W + 10].toFixed(2));
  // a home in a blocked block seeds the nearest water; a boat in a cut-off pocket has no distance home at all
  const blk = new Uint8Array(g.W * g.H);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) blk[y * g.W + x] = 1;                 // a pier round home
  for (let y = 150; y < 190; y++) for (let x = 150; x < 190; x++) {                                    // a closed basin
    const edge = y === 150 || y === 189 || x === 150 || x === 189; if (edge) blk[y * g.W + x] = 1; }
  const seeds = HF.homeSeeds(g, blk, { e: 200, n: 200 }, 300), db = HF.homeField(blk, g.W, g.H, seeds);
  check("7c. ... a home inside a pier (or the buffer) seeds the nearest clear water, at its distance; a boat in a "
        + "closed basin has NO distance home (null - the page then falls back to the straight line and says so)",
        () => seeds && seeds[0].d > 0 && HF.fieldDistM(g, db, blk, { e: 1700, n: 1700 }, 50) === null
              && HF.fieldDistM(g, db, blk, { e: 1000, n: 1000 }, 50) > 0,
        () => "seed " + (seeds ? seeds[0].d.toFixed(2) + " cells from home" : "none") + "; in the basin "
            + HF.fieldDistM(g, db, blk, { e: 1700, n: 1700 }, 50));
}

// ── 8. THE PAGE'S MONITOR, DRIVEN FRAME BY FRAME ──────────────────────────────────────────────────────────────────
{
  const v = vessel("drix08_em712"), model = F.energyModel(v, v.propulsion.speeds_kn.high);
  const AT_HOME = +(/const FUEL_AT_HOME_M = ([\d.]+);/.exec(H) || [])[1];
  const RTH_MAX = 10 * +(/const NOGO_RADIUS_M = ([\d.]+);/.exec(H) || [])[1];
  // The page's own fuelTick, fuelWatchAt (is home in range) and the out-of-range sentence, with the world stubbed:
  // `need` the fuel home, `far` the distance rthTooFar refuses a return by (null: within it), `S.home` null for none.
  const world = (mdl) => {
    const m0 = mdl || model;
    const w = { banners: [], logs: [], sent: [], sup: true, need: 11, far: null, S: { home: { lat: 0, lon: 0 } } };
    const mk = new Function("S", "asv", "fuelModel", "energyLevel", "fuelHomeNeed", "rthTooFar", "fuelWatch", "rthLevel", "rthDecision",
      "homeFieldTick", "coarseHomeTick", "supervising", "showBanner", "logClient", "doRTH", "fuelSay", "fuelFmt", "fmtDist", "FUEL_AT_HOME_M",
      "FUEL_RESERVE_FRAC", "RTH_MAX_M",
      "let fuelRth = {acted: false, alerted: false};\nlet fuelNow = null, fuelErrSaid = false;\n" + grab("fuelTick")
      + "\n" + grab("fuelWatchAt") + "\n" + grab("fuelOutOfRangeSay") + "\n" + grab("fuelReserveOf") + "\n" + grab("homeHowSay")
      + "\nreturn {tick: fuelTick, latch: () => ({...fuelRth}), now: () => fuelNow};");
    w.api = mk(w.S, { lat: 0.01, lon: 0 }, () => m0, F.energyLevel,
      () => ({ need: w.need, m: 5000, water: true, twKn: 8 }), () => (w.far == null ? null : { m: w.far }), F.fuelWatch,
      F.rthLevel, F.rthDecision, () => {}, () => {}, () => w.sup,
      (t) => w.banners.push(t), (k, d) => w.logs.push([k, d]),
      (o) => { w.sent.push(o); return Promise.resolve(); }, () => "the sentence", (m, x) => x.toFixed(1) + " L",
      (m) => (m / 1000).toFixed(1) + " km", AT_HOME, F.FUEL_RESERVE_FRAC, RTH_MAX);
    w.frame = (fuel, o) => w.api.tick({ armed: true, estop: false, behavior: "survey",
      status: m0.kind === "fuel" ? { fuel_l: fuel } : { battery_v: fuel }, ...(o || {}) });
    return w;
  };
  // she runs down through the point (61 L) on a survey
  const A = world();
  A.frame(70); const before = A.sent.length + A.banners.length;
  A.frame(60.9); A.frame(60.5); A.frame(60);
  const once = A.sent.length === 1 && A.banners.length === 1 && /LOW FUEL/.test(A.banners[0]) && /LOW FUEL/.test(A.sent[0].why)
               && A.logs.length === 1 && A.logs[0][0] === "fuel_rth" && A.logs[0][1].sent === true;
  // the operator commands her elsewhere afterwards: it stands
  A.frame(59.5, { behavior: "goto" }); A.frame(59, { behavior: "goto" });
  const stands = A.sent.length === 1;
  // refuelled (or a nearer home): re-armed, and the next crossing is acted on
  A.frame(100); A.frame(60.8, { behavior: "goto" });
  check("8. THE PAGE'S MONITOR (its own fuelTick, lifted out and driven frame by frame): crossing the point alerts and "
        + "sends her home ONCE - the alert, the log and doRTH with the reason - and the operator's change after it stands; "
        + "re-armed above it, the next crossing is answered again",
        () => before === 0 && once && stands && A.sent.length === 2,
        () => "sent " + A.sent.length + " (want 2: one per crossing), banners " + A.banners.length + ", logs " + A.logs.length
            + (A.sent[0] ? "; why: " + A.sent[0].why : ""));
  // reached while she cannot be sent: said once, sent the frame she can be
  const B = world();
  B.frame(60, { armed: false }); B.frame(59.9, { armed: false });
  const saidOnce = B.banners.length === 1 && /DISARMED/.test(B.banners[0]) && B.sent.length === 0;
  B.frame(59.8);
  check("8b. ... reached while she is DISARMED: said once, in words naming why she was not sent (and logged sent: false)",
        () => saidOnce && B.logs[0][1].sent === false,
        () => "banners " + JSON.stringify(B.banners.map((t) => t.slice(-60))));
  check("8c. ... and SENT the frame she can be - armed after the alert, she goes home (the first cut returned on "
        + "'already said' before asking, and never sent her)",
        () => B.sent.length === 1,
        () => "sent " + B.sent.length + " after arming");
  // already going home when she reaches it; then commanded elsewhere: not sent, it stands
  const C = world();
  C.frame(60, { behavior: "rth" }); C.frame(59, { behavior: "survey" });
  // a window that does not supervise: says it, sends nothing
  const Dw = world(); Dw.sup = false; Dw.frame(60);
  check("8d. ... reached on her way home already: said, latched, nothing sent - and a mission commanded after it stands; "
        + "a window that does not supervise alerts and sends nothing (the supervising one does)",
        () => C.sent.length === 0 && /already returning home/.test(C.banners[0] || "") && Dw.sent.length === 0
              && /supervising window/.test(Dw.banners[0] || ""),
        () => "going home: " + C.sent.length + " sent, '" + (C.banners[0] || "").slice(-40) + "'; viewer: " + Dw.sent.length + " sent");
  // ── HOME OUT OF RANGE (2026-10-11, Andy: "automatic RTH only when home is in range, otherwise an alert at 20% with no
  // automatic action"). The tank is 250 L, so the reserve is 50 L; in range the RTH point here would be 61 L.
  const E = world(); E.far = 900000;
  for (const l of [70, 61, 60, 55, 50.5]) E.frame(l);
  const quietAbove = E.banners.length === 0 && E.sent.length === 0;
  E.frame(49.9); E.frame(49); E.frame(45);
  const alertOnce = E.banners.length === 1 && E.sent.length === 0 && /AT THE 20% RESERVE/.test(E.banners[0])
                   && /900\.0 km away, further than the 50\.0 km/.test(E.banners[0]) && /NOT being sent home: find a port/.test(E.banners[0])
                   && E.logs.length === 1 && E.logs[0][1].sent === false && E.logs[0][1].watch === "alert" && E.logs[0][1].out_of_range === "far";
  E.frame(100); E.frame(49.8);
  check("8e. HOME OUT OF RANGE (900 km, past the " + (RTH_MAX / 1000) + " km a return is routed): nothing at 61 L - where the "
        + "old rule sent an RTH the console then refused - nor anywhere above the 50 L reserve; at it ONE alert, naming the "
        + "distance and 'find a port', logged sent: false, and NOTHING commanded on any frame; refueled, the next crossing "
        + "alerts again",
        () => quietAbove && alertOnce && E.banners.length === 2 && E.sent.length === 0,
        () => "above: " + (quietAbove ? "quiet" : E.banners.length + " banner(s) / " + E.sent.length + " sent") + "; banners "
            + E.banners.length + ", sent " + E.sent.length + "; " + JSON.stringify((E.banners[0] || "").slice(0, 160)));
  const Fw = world(); Fw.need = 210;     // within the distance, but the RTH point would be 260 L, past a full tank
  Fw.frame(60); Fw.frame(55); const fQuiet = Fw.banners.length === 0;
  Fw.frame(49.9);
  check("8f. ... and PAST A FULL TANK (the fuel home 210 L, the RTH point 260 L of a 250 L tank): out of range too - the "
        + "alert at the reserve, its words saying a full tank does not reach home, nothing sent",
        () => fQuiet && Fw.banners.length === 1 && /even a full tank does not get her there/.test(Fw.banners[0]) && Fw.sent.length === 0,
        () => "banners " + JSON.stringify(Fw.banners.map((t) => t.slice(0, 140))) + ", sent " + Fw.sent.length);
  const G = world(); G.far = 900000;
  G.frame(49.9);                          // alerted out of range...
  G.far = null; G.frame(49.5); G.frame(49);   // ...then home comes into range, she is below its RTH point (61 L)
  const noOverride = G.sent.length === 0 && G.banners.length === 1;
  G.frame(100); G.frame(60.9);            // refueled, in range: the RTH point acts as before
  check("8g. ACROSS THE CHANGE OF RULE: alerted out of range, then home in range with her already below its RTH point - "
        + "nothing is sent (the port the operator chose is not overridden); refueled, the in-range crossing sends her home",
        () => noOverride && G.sent.length === 1 && /LOW FUEL/.test(G.sent[0].why),
        () => "after coming into range: " + (noOverride ? "nothing" : G.sent.length + " sent") + "; after the refuel: " + G.sent.length + " sent");
  // DISARMED (alongside at the visiting harbor, say): the alert must latch on its own - with the in-range decision a
  // disarmed boat is never latched, so a refuel could never re-arm it and the next crossing would pass unsaid.
  const I = world(); I.far = 900000;
  I.frame(49.9, { armed: false }); I.frame(49, { armed: false });
  const iOnce = I.banners.length === 1 && I.sent.length === 0;
  I.frame(100, { armed: false }); I.frame(49.8, { armed: false });
  check("8i. ... out of range and DISARMED: one alert, nothing sent - and refueled, the next crossing is alerted again "
        + "(the alert latches by itself; it does not wait on a send that out of range never comes)",
        () => iOnce && I.banners.length === 2 && I.sent.length === 0,
        () => "banners " + I.banners.length + " (want 2: one per crossing), sent " + I.sent.length);
  const Hn = world(); Hn.S.home = null;
  Hn.frame(60); Hn.frame(49.9);
  check("8h. NO HOME SET: out of range as well - watched at the reserve and alerted there, nothing sent (it was not "
        + "monitored at all)",
        () => Hn.banners.length === 1 && /No home is set/.test(Hn.banners[0]) && Hn.sent.length === 0,
        () => "banners " + JSON.stringify(Hn.banners.map((t) => t.slice(0, 140))) + ", sent " + Hn.sent.length);
  // A BATTERY HULL, home 900 km off: the RTH point as before - she is sent home (doRTH then refuses past 50 km, in words:
  // "Set Home where she is"), never left to an alert; and with no home, nothing is watched, as before.
  const zv = vessel("zboat_1800hs"), zm = F.energyModel(zv, zv.propulsion.speeds_kn.high);
  const Jb = world(zm); Jb.far = 900000; Jb.need = 0.5;
  Jb.frame(24.0); Jb.frame(23.9);       // the RTH point is 23.0 + 0.7 + 0.5 = 24.2 V
  const Kb = world(zm); Kb.S.home = null; Kb.frame(24.0); Kb.frame(23.6);
  check("8j. A BATTERY HULL OUT OF RANGE keeps the RTH point - sent home ONCE at it (no 'find a port'), however far home "
        + "is; with no home set, nothing is watched (the long-range rule is the diesel hulls' alone)",
        () => Jb.sent.length === 1 && /LOW FUEL/.test(Jb.sent[0].why) && !Jb.banners.some((t) => /find a port/.test(t))
              && Kb.banners.length === 0 && Kb.sent.length === 0,
        () => "out of range: " + Jb.sent.length + " sent, banners " + JSON.stringify(Jb.banners.map((t) => t.slice(0, 60)))
            + "; no home: " + Kb.banners.length + " banner(s), " + Kb.sent.length + " sent");
}

// ── 9. THE WIRING ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const PROJ = grab("fuelProjection"), TICK = grab("fuelTick"), NEED = grab("fuelHomeNeed"), BUILD = grab("homeFieldTick");
  const WATCH = grab("fuelWatchAt");
  check("9. ONE ESTIMATE OF THE WAY HOME AND ONE ANSWER TO 'IN RANGE': the monitor and every step of the card's projection "
        + "both ask fuelWatchAt - fuelHomeNeed (water distance at the TRANSIT speed: an RTH flies the transit role) and "
        + "rthTooFar, the test doRTH refuses a return by - so the card cannot promise a mission the monitor will cut short, "
        + "and the monitor cannot send an RTH doRTH would refuse; out of range a step's level is the reserve itself",
        () => /fuelWatchAt\(model, \{lat: asv\.lat, lon: asv\.lon\}\)/.test(TICK) && /fuelWatchAt\(model, fr\.fromEN\(q\.e, q\.n\)\)/.test(PROJ)
              && /w\.mode === "rth" \? \(w\.h \? w\.h\.need : null\) : 0/.test(PROJ)
              && /fuelHomeNeed\(model, ll\)/.test(WATCH) && /rthTooFar\(ll, S\.home\)/.test(WATCH) && /fuelWatch\(model, /.test(WATCH)
              && /rthTooFar\(\{lat:asv\.lat,lon:asv\.lon\}, S\.home\)/.test(grab("doRTH"))
              && /roleSpeed\("transit"\)/.test(NEED) && /homeDistFrom\(ll\)/.test(NEED),
        "fuelTick / fuelProjection / fuelWatchAt / doRTH / fuelHomeNeed");
  check("9b. the monitor is CAUGHT inside the frame handler (a fault in it must not take the guard's frame down, and is said "
        + "once), the card's rows likewise, and the send is caught too",
        () => /try\{ fuelTick\(s\); \}catch\(e\)\{ if\(!fuelErrSaid\)/.test(grab("onState"))
              && /try\{ renderFuelRows\(\); \}catch/.test(grab("updateMissionCard")) && /doRTH\(\{why: [^}]*\}\)\.catch\(/.test(TICK),
        "onState / updateMissionCard / fuelTick");
  check("9c. the field is built OFF the page's thread - the raster as well as the search (one home up the Piscataqua held "
        + "the thread 374 ms rasterizing) - and the model goes to the worker once per generation",
        () => !/rasterKeepouts\(/.test(BUILD) && /type: "build"/.test(BUILD) && /homeFldKoSent !== homeKoGen/.test(BUILD)
              && /rasterKeepouts\(/.test(WORKER) && /homeField\(/.test(WORKER) && /homeSeeds\(/.test(WORKER),
        "homeFieldTick / home_field_worker.js");
  const mission = H.slice(H.indexOf('id="v_mission"'), H.indexOf('id="v_intent"'));
  check("9d. the card carries the two rows in its Run block, the RTH banner names why it was sent, and the rehearsal row is "
        + "in the chart menu, gated to the simulator",
        () => /id="mi_fuel"/.test(mission) && /id="mi_rthpt"/.test(mission) && /showBanner\(why\+"RTH: "\+\(plan\.routed/.test(grab("doRTH"))
              && /id="cmFuelRth"/.test(H) && /cmGate\("#cmFuelRth",\s+canSpawn\(\)/.test(H) && /cmRow\("#cmFuelRth"/.test(H),
        "markup / doRTH / chart menu");
}

// ── 9e. THE ROW AND THE PILL OUT OF RANGE (the page's renderFuelRows and fuelPillLine, the DOM stubbed) ──────────────
{
  const v = vessel("drix08_em712"), model = F.energyModel(v, v.propulsion.speeds_kn.high);
  const RTH_MAX = 10 * +(/const NOGO_RADIUS_M = ([\d.]+);/.exec(H) || [])[1];
  const mk = new Function("$", "fuelModel", "setCellText", "setTip", "fuelProjection", "fuelFmt", "fuelPct", "fmtMS", "fmtDist",
    "fuelSay", "S", "RTH_MAX_M", "FUEL_RESERVE_FRAC", "N0",
    "let fuelNow = N0;\n" + grab("renderFuelRows") + "\n" + grab("fuelPillLine") + "\n" + grab("fuelOutOfRangeSay") + "\n"
    + grab("fuelReserveOf") + "\n" + grab("homeHowSay") + "\nreturn {rows: renderFuelRows, pill: fuelPillLine};");
  const run = (N) => {
    const els = {}, $ = (s) => (els[s] = els[s] || { className: "vv", text: "", tip: "" });
    const api = mk($, () => model, (e, t) => { e.text = t; }, (e, t) => { e.tip = t; }, () => null, (m, x) => x.toFixed(1) + " L",
      (m, x) => Math.round(100 * (x - m.floor) / (m.full - m.floor)), (s) => s + " s", (m) => (m / 1000).toFixed(1) + " km",
      () => "the sentence", { home: { lat: 0, lon: 0 }, behavior: "survey" }, RTH_MAX, F.FUEL_RESERVE_FRAC, N);
    api.rows();
    const r = $("#mi_rthpt");
    return { label: $("#mi_rthpt_k").text, row: r.text, cls: r.className, tip: r.tip, pill: api.pill() };
  };
  const hFar = { need: 11, m: 900000, water: false, twKn: 8 }, hNear = { need: 11, m: 5000, water: true, twKn: 8 };
  const far = F.fuelWatch(model, 11, 900000), inr = F.fuelWatch(model, 11, null);
  const out = run({ model, level: 60, rth: far.level, h: hFar, w: { ...far, h: hFar, farM: 900000 }, state: "ok" });
  const hit = run({ model, level: 49, rth: far.level, h: hFar, w: { ...far, h: hFar, farM: 900000 }, state: "reached" });
  const inR = run({ model, level: 70, rth: inr.level, h: hNear, w: { ...inr, h: hNear, farM: null }, state: "ok" });
  check("9e. OUT OF RANGE THE ROW IS THE LOW-FUEL ALERT, and says so: its label, the reserve and how far above it she is, "
        + "REACHED with 'find a port' (no 'RTH due'), a tip naming why home is out of range and that nothing will be "
        + "commanded, and the pill likewise; in range it is the RTH point, unchanged",
        () => out.label === "Low fuel" && out.row === "50.0 L · 10.0 L above" && /will NOT send her home/.test(out.tip)
              && /900\.0 km away, further than the 50\.0 km/.test(out.tip) && /Low-fuel alert: 50\.0 L/.test(out.pill)
              && /does not send her home/.test(out.pill)
              && hit.row === "REACHED · 50.0 L · find a port" && hit.cls === "vv critical"
              && inR.label === "RTH point" && inR.row === "61.0 L · 9.0 L above" && /^\nRTH point: 61\.0 L/.test(inR.pill),
        () => JSON.stringify({ out: [out.label, out.row], hit: [hit.row, hit.cls], inR: [inR.label, inR.row], pill: out.pill.slice(0, 90) }));
}

// ── 10. HOME ALONG THE PASSAGE, NOT THE STRAIGHT LINE (2026-10-12, Andy: "fix the fuel monitor's straight-line distance
// home") ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The home field covers only the chart box round her, so on a passage the monitor measured the straight line home.
// With home at an end of the passage on the plan, the way home is the passage (her RTH goes home along it): measured as
// she would sail it, its fuel stretch by stretch in the set. The page's own homeDistFrom / passageHome / fuelHomeNeed /
// homeHowSay / fuelSay, the real coarse.js homeSections and fuel.js, the field stubbed.
{
  const C = require(path.join(APP, "static", "js", "coarse.js"));
  const v = vessel("drix08_em712"), m = F.energyModel(v, v.propulsion.speeds_kn.high);
  const M = 111320, HOME = { lat: 43.07, lon: -70.71 };
  const east = (p, d) => ({ lat: p.lat, lon: p.lon + d / (M * Math.cos(p.lat * Math.PI / 180)) });
  const north = (p, d) => ({ lat: p.lat + d / M, lon: p.lon });
  const flatD = (a, b) => Math.hypot((b.lat - a.lat) * M, (b.lon - a.lon) * M * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180));

  // 10. fuel.js pathEnergy: a stretch's own direction in the set, summed - worked by hand
  const tw = 7, set = { e: 0, n: KN };                                 // a 1 kn set to the north
  const P0 = HOME, P1 = north(HOME, 20000);
  const outBack = F.pathEnergy(m, [P0, P1, P0], tw, set);               // 20 km north (8 kn made good) and back (6 kn)
  const byHand = m.rateAt(tw) * (20000 / (8 * KN) + 20000 / (6 * KN)) / 3600;
  const one = F.pathEnergy(m, [P0, P1], tw, set), oneHome = F.homeEnergy(m, flatD(P0, P1), tw, set, { e: 0, n: 1 });
  // and 20 km EAST at 43 N in a 1 kn set to the east: 8 kn made good - its length measured at its own latitude
  const eastLeg = F.pathEnergy(m, [P0, east(P0, 20000)], tw, { e: KN, n: 0 });
  const eastByHand = m.rateAt(tw) * (20000 / (8 * KN)) / 3600;
  check("10. A WAY HOME OF STRETCHES (fuel.js pathEnergy): each at the transit speed in the set along ITS OWN direction, "
        + "summed - 20 km north with a 1 kn set and back against it, worked by hand (where the straight line home is NO "
        + "distance at all), and 20 km east with it astern, measured at its latitude; one straight stretch exactly "
        + "homeEnergy's",
        () => near(outBack, byHand, 1e-6) && near(eastLeg, eastByHand, 1e-3) && near(one, oneHome, 1e-9)
              && F.pathEnergy(m, [P0], tw, set) === 0 && F.pathEnergy(null, [P0, P1], tw, set) === null,
        () => outBack.toFixed(3) + " L (by hand " + byHand.toFixed(3) + "), east " + eastLeg.toFixed(4) + " (by hand "
              + eastByHand.toFixed(4) + "), one stretch " + one.toFixed(4) + " / " + oneHome.toFixed(4));

  // the page: a passage that goes round a headland - 30 km east, then north to a point 30 km east of T1 by way of a
  // turning point 5 km further out (a dogleg its turning points must keep), then west to T1, 25 km north of home
  const A = east(HOME, 30000), T1 = north(HOME, 25000), B = north(A, 25000), D = east(north(A, 12500), 5000);
  const secs = [{ from: HOME, to: A, via: [east(HOME, 15000)], end: "hold", port: null, lengthM: 30000 },
                { from: A, to: B, via: [D], end: "hold", port: null, lengthM: 26926 },
                { from: B, to: T1, via: [], end: "port", port: 1, lengthM: 30000 }];
  const page = (o) => {
    const w = Object.assign({ field: null, home_source: null, passage: { sections: secs, state: "running" } }, o || {});
    const src = [
      "const S = {home: w.home || HOME, home_source: w.home_source, status: {env_set_deg: 0, env_set_kn: 1}};",
      "const FR = {toEN: () => ({e: 0, n: 0})}, mission = {passage: w.passage}, nogo = {frame: FR}, homeFldBuild = null;",
      "const homeFld = w.field ? {dist: [1], frame: FR, key: 'k', g: {cell: 5}, note: 'ready'} : {dist: null, note: 'home is off the chart that was read'};",
      "const homeFieldKey = () => 'k', fieldDistM = () => w.field, cellOf = () => true, HOME_FIELD_REACH_M = 300;",
      "const V = {SPEED_KN: {transit: 7, survey: 5}}, roleSpeed = () => 'transit';",
      "let coarseHome = w.coarse || {key: null, hf: null, note: null, busy: false};",
      "const nogoDR = () => ({min: 3.15}), airNeedM = () => 4.85, coarseHomeDistM = w.coarseDist || (() => null);",
      "const groundVel = (deg, kn) => ({e: kn * KN * Math.sin(deg * Math.PI / 180), n: kn * KN * Math.cos(deg * Math.PI / 180)});",
      "const planeFrame = (o) => ({toEN: (p) => ({e: (p.lon - o.lon) * M * Math.cos(o.lat * Math.PI / 180), n: (p.lat - o.lat) * M})});",
      "const fmtDist = (x) => (x / 1000).toFixed(1) + ' km', fuelFmt = (md, x) => x.toFixed(1) + ' L';",
      ["fineHomeDist", "homeDistFrom", "homeHowSay", "coarseHomeKey", "passageHome", "fuelHomeNeed", "fuelSay"].map(grab).join("\n"),
      "return {homeDistFrom, fuelHomeNeed, fuelSay, key: coarseHomeKey};"].join("\n");
    return new Function("w", "HOME", "M", "KN", "distTo", "homeSections", "homeEnergy", "pathEnergy", "FUEL_RESERVE_FRAC", src)(
      w, HOME, M, KN, flatD, C.homeSections, F.homeEnergy, F.pathEnergy, F.FUEL_RESERVE_FRAC);
  };
  // she is on the last section, 3 km short of T1 - home is where the passage left from, the long way round behind her
  const her = east(T1, 3000);
  const P = page(), d = P.homeDistFrom(her), straight = flatD(her, HOME);
  const alongM = 27000 + flatD(B, D) + flatD(D, A) + 30000;   // back east to B, south by the dogleg to A, west home
  check("10b. OFF THE FIELD, ON A PASSAGE WITH HOME AT ITS END: the distance home is the way along the passage (back to "
        + "it, its sections home: " + (alongM / 1000).toFixed(1) + " km, its dogleg kept), BY WATER, said as 'along the passage' - not the straight "
        + "line (" + (straight / 1000).toFixed(1) + " km), which is short wherever a headland stands between",
        () => d && d.along === "passage" && d.water === true && Math.abs(d.m - alongM) < 250 && d.line.length >= 4
              && flatD(d.line[0], her) < 1 && flatD(d.line[d.line.length - 1], HOME) < 1 && d.m > 2 * straight,
        () => JSON.stringify({ m: d && Math.round(d.m), along: d && d.along, pts: d && d.line && d.line.length, straight: Math.round(straight) }));
  const noP = page({ passage: null }).homeDistFrom(her), offP = page().homeDistFrom(north(her, 30000));
  const roc = page({ home_source: "roc-1" }).homeDistFrom(her), neither = page({ home: north(HOME, -40000) }).homeDistFrom(her);
  const fld = page({ field: 4321 }).homeDistFrom(her);
  check("10c. ...and the STRAIGHT LINE only where nothing better is known, saying why: no passage; she 30 km off it; a "
        + "ROC's home (it moves); home at neither end - each 'not along the passage on the plan' and why; and where the "
        + "field reaches, the field's water distance still wins",
        () => [noP, offP, roc, neither].every((x) => x && x.water === false && !x.along && Math.abs(x.m - flatD(x === offP ? north(her, 30000) : her, x === neither ? north(HOME, -40000) : HOME)) < 1)
              && /^home is off the chart that was read$/.test(noP.why)
              && /not along the passage on the plan: she is 30\.0 km off it/.test(offP.why)
              && /not along the passage on the plan: home is the ROC's/.test(roc.why)
              && /not along the passage on the plan: home is at neither end of it/.test(neither.why)
              && fld.m === 4321 && fld.water === true && !fld.along,
        () => JSON.stringify([noP.why, offP.why, roc.why, neither.why, fld.m]));
  // the fuel home along it: each stretch in the set along its own direction - the north-going 25 km stretch homeward
  // runs SOUTH against the 1 kn set from the south... (env_set_deg 0: the set runs north)
  const need = P.fuelHomeNeed(m, her);
  const wantNeed = F.pathEnergy(m, d.line, 7, { e: 0, n: KN });
  const sayAlong = P.fuelSay(m, 80, 30, need), sayStraight = P.fuelSay(m, 80, 30, page({ passage: null }).fuelHomeNeed(m, her));
  check("10d. ITS FUEL along the passage, stretch by stretch in the set (fuel.js pathEnergy over the same line) - not the "
        + "distance at the straight line's one heading; and the sentence the alert and the card say names how home was "
        + "measured: 'along the passage', or a STRAIGHT LINE and why",
        () => need && need.along === "passage" && near(need.need, wantNeed, 1e-9) && need.need > 0 && need.m === d.m
              && sayAlong.includes("home is " + (need.m / 1000).toFixed(1) + " km along the passage and takes ")
              && /in a STRAIGHT LINE \(home is off the chart that was read\)/.test(sayStraight),
        () => (need ? need.need.toFixed(2) : "--") + " L (pathEnergy " + wantNeed.toFixed(2) + "); " + sayAlong.slice(0, 80));
  // ONE ANSWER for the RTH button and the monitor
  check("10e. ONE ANSWER TO 'THE WAY HOME ALONG THE PASSAGE': the RTH button (homeRecord) and the monitor's distance "
        + "(homeDistFrom) both ask passageHome, and every sentence that says how home was measured asks homeHowSay",
        () => /passageHome\(\{lat: asv\.lat, lon: asv\.lon\}\)/.test(grab("homeRecord")) && /passageHome\(ll\)/.test(grab("homeDistFrom"))
              && !/homeSections\(/.test(grab("homeRecord")) && /homeSections\(G, ll, S\.home\)/.test(grab("passageHome"))
              && ["fuelSay", "fuelOutOfRangeSay", "renderFuelRows", "fuelPillLine"].every((f) => /homeHowSay\(/.test(grab(f)))
              && !/" by water"/.test(["fuelSay", "fuelOutOfRangeSay", "renderFuelRows", "fuelPillLine"].map(grab).join("\n")),
        "homeRecord / homeDistFrom / passageHome / the four sentences");
  // 10f. the coarse grid's distance KEEPS ITS NAME through fuelHomeNeed into the sentence (found live: fuelHomeNeed
  // passed `along` only for the passage, and the coarse grid's 34.67 km round Cape Ann was said plain "by water")
  const Pc = page({ passage: null });
  const Pk = page({ passage: null, coarse: { key: Pc.key(), hf: {}, note: "ready", busy: false }, coarseDist: () => 31000 });
  const nC = Pk.fuelHomeNeed(m, her), sC = Pk.fuelSay(m, 80, 30, nC);
  check("10f. THE COARSE GRID'S DISTANCE through fuelHomeNeed keeps its name - the sentence the card and the alert say "
        + "reads 'by water (coarse grid)', its fuel at that distance",
        () => nC && nC.along === "coarse" && nC.m === 31000 && nC.water === true && /home is 31\.0 km by water \(coarse grid\) and takes /.test(sC),
        () => JSON.stringify({ along: nC && nC.along, m: nC && nC.m }) + "; " + sC.slice(0, 70));
}

// ── 11. THE COARSE HOME FIELD (2026-10-12, Andy: "build the coarse home field") ──────────────────────────────────────
// Past the field round home, with no passage leading home, the distance home was the straight line - short wherever
// land is in the way, so the RTH point came late. coarse.js coarseHomeField searches outward from home over the tiles'
// planning grids at the coarse planner's own costs; the page reads the chart along the way home with its grids and
// builds it in the coarse worker. Over synthetic grids, against distances worked by hand; the page's own functions
// with the console, the corridor read and the worker stubbed.
(async () => {
  const C = require(path.join(APP, "static", "js", "coarse.js"));
  const N = C.GRID_N, N2 = N * N, CD = C.CELL_DEG, M = 111320;
  const grid = (tx, ty) => { const W = tx * C.TILE_DEG - 180, S = ty * C.TILE_DEG - 90;
    return { head: { tile: [W, S, W + C.TILE_DEG, S + C.TILE_DEG] }, C: new Int16Array(N2).fill(300), T: new Int16Array(N2).fill(300),
             A: new Int16Array(N2).fill(32767), tx, ty }; };
  const TX = Math.round((-70.75 + 180) / C.TILE_DEG), TY = Math.round((43.0 + 90) / C.TILE_DEG);
  const ll = (g, c, r) => ({ lat: (g.ty * N + r + 0.5) * CD - 90, lon: (g.tx * N + c + 0.5) * CD - 180 });
  const flatD = (a, b) => Math.hypot((b.lat - a.lat) * M, (b.lon - a.lon) * M * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180));
  const field = (gs) => C.buildField(gs, 30);       // a 3 m floor: a cell charted at 300 dm is water, at 0 is land
  // ... and the planner's LEVEL rules alone (2026-10-14): open water first (coarse.js openWaterCosts) also prices a cell's
  // nearness to a danger, which no hand-worked way round a wall can be held to - 11 and 11b work the level rules by hand
  // with it off, and 11i holds what it adds
  const fieldLv = (gs) => C.buildField(gs, 30, 0, { openWater: false });
  const CELL_M = CD * M;                             // a cell's height, meters (~109)

  // 11. open water, and round a wall
  const open = [0, 1, 2].flatMap((i) => [0, 1].map((j) => grid(TX + i, TY + j)));
  const home = ll(open[0], 20, 20), hfO = C.coarseHomeField(field(open), home);
  const probes = [ll(open[5], 200, 200), ll(open[4], 128, 10), ll(open[1], 10, 250), { lat: home.lat + 0.12, lon: home.lon + 0.31 }];
  const ratios = probes.map((p) => C.coarseHomeDistM(hfO, p) / flatD(p, home));
  // her position need not be a cell's center: 0.4 of a cell north of one, her length home is the center's plus the 43 m
  const P0 = probes[0], Q0 = { lat: P0.lat + 0.4 * CD, lon: P0.lon };
  const offBy = C.coarseHomeDistM(hfO, Q0) - C.coarseHomeDistM(hfO, P0);
  const wall = [0, 1, 2].map((i) => grid(TX + i, TY));
  for (let r = 0; r < 230; r++) for (let c = 100; c < 103; c++) wall[1].C[r * N + c] = 0;          // land, rows 0-229
  const hW = ll(wall[0], 128, 50), far = ll(wall[2], 128, 50), top = ll(wall[1], 101, 231);
  const mW = C.coarseHomeDistM(C.coarseHomeField(fieldLv(wall), hW), far), aroundW = flatD(hW, top) + flatD(top, far);
  check("11. THE COARSE HOME FIELD (coarse.js coarseHomeField): across open water within 4% of the straight line (the 16 "
        + "moves - 8 neighbors alone run 8% long) and never short of it by more than half a cell, her offset from her "
        + "cell's center counted; round a wall of land (the level rules alone), "
        + "the way round it worked by hand (" + (aroundW / 1000).toFixed(1) + " km, the straight line "
        + (flatD(hW, far) / 1000).toFixed(1) + "), within 2%",
        () => ratios.every((q) => q >= 1 - 70 / 20000 && q < 1.04) && hfO.reached === 6 * N2
              && mW >= aroundW - CELL_M && mW < aroundW * 1.02 && Math.abs(offBy - flatD(Q0, P0)) < 0.5,
        () => "open " + ratios.map((q) => "+" + (100 * (q - 1)).toFixed(2) + "%").join(" ") + "; round the wall "
              + (mW / 1000).toFixed(2) + " km; off a cell's center by " + flatD(Q0, P0).toFixed(1) + " m, " + offBy.toFixed(1) + " m more");

  // 11b. home's port circle, corners, unread water, the planner's costs
  const ring = (g, cx, cy, rad) => { for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const d = Math.hypot(c - cx, r - cy); if (d >= rad && d < rad + 2) g.C[r * N + c] = 0; } };
  const inPort = [grid(TX, TY), grid(TX + 1, TY)];
  ring(inPort[0], 128, 128, 15);                    // home in a walled harbor ~1.6 km across: inside its 4 km circle
  const hP = ll(inPort[0], 128, 128), outP = ll(inPort[1], 128, 128);
  const portOK = C.coarseHomeDistM(C.coarseHomeField(field(inPort), hP), outP);
  const shut = [grid(TX, TY), grid(TX + 1, TY)];
  ring(shut[1], 128, 128, 15);                      // HER in a walled pond 25 km from home: not home's circle - shut
  const shutM = C.coarseHomeDistM(C.coarseHomeField(field(shut), ll(shut[0], 128, 128)), ll(shut[1], 128, 128));
  const diag = [grid(TX, TY), grid(TX + 1, TY)];
  for (let k = 0; k < N; k++) { diag[0].C[k * N + (N - 1 - k)] = 0; }   // a diagonal of land cells meeting only at corners
  for (let r = 0; r < N; r++) diag[1].C[r * N + 0] = 0;                // closed off on the east, so no way round
  const diagM = C.coarseHomeDistM(C.coarseHomeField(field(diag), ll(diag[0], 10, 10)), ll(diag[0], 240, 240));
  const gap = [grid(TX, TY), grid(TX + 2, TY)];     // the tile between them never read
  const gapM = C.coarseHomeDistM(C.coarseHomeField(field(gap), ll(gap[0], 128, 128)), ll(gap[1], 128, 128));
  const homeUnread = C.coarseHomeField(field([grid(TX, TY)]), ll(grid(TX + 3, TY), 5, 5));
  // THE PLANNER'S COSTS, BOTH WAYS. A band of water a danger touches (PARTLY: COST 3 a meter) ACROSS EVERY ROW, 20 cells
  // wide: there is no way round, so the way home crosses it - and its LENGTH is the meters, not the cost (a field that
  // kept the cost would read it ~12% long). And a band 61 cells wide over rows 0-59 only, home and her at row 30: through
  // it costs ~10 km more, round its end ~1.7 km more length - so the way home goes ROUND (a field without the costs
  // would go straight through).
  const band = [grid(TX, TY), grid(TX + 1, TY)];
  for (let r = 0; r < N; r++) for (let c = 100; c < 120; c++) { band[1].T[r * N + c] = 10; }
  const hB = ll(band[0], 128, 30), fB = ll(band[1], 200, 30), mB = C.coarseHomeDistM(C.coarseHomeField(fieldLv(band), hB), fB);
  const bandR = [grid(TX, TY), grid(TX + 1, TY)];
  for (let r = 0; r < 60; r++) for (let c = 100; c < 161; c++) { bandR[1].T[r * N + c] = 10; }
  const mR = C.coarseHomeDistM(C.coarseHomeField(fieldLv(bandR), hB), fB);
  check("11b. THE PLANNER'S RULES: home inside a walled harbor is reached - a blocked cell is crossed in HOME'S OWN port "
        + "circle - but a boat walled in 25 km off is not; no way through a diagonal of land meeting only at corners; "
        + "water never read is never entered, and home's own tile unread is said; water a danger touches costs three times "
        + "clear water - crossed where there is no way round, its LENGTH the meters, and gone ROUND where that is cheaper",
        () => Number.isFinite(portOK) && shutM === null && diagM === null && gapM === null && homeUnread.error === "unread"
              && Number.isFinite(mB) && mB < flatD(hB, fB) * 1.04 && mR > flatD(hB, fB) * 1.04 && mR < flatD(hB, fB) * 1.12,
        () => JSON.stringify({ port: portOK && Math.round(portOK), shut: shutM, diag: diagM, gap: gapM, home: homeUnread.error,
                               across: mB && Math.round(mB), round: mR && Math.round(mR), straight: Math.round(flatD(hB, fB)) }));

  // 11c. the worker: kind "home" builds it, the lengths transferred back
  const WSRC = fs.readFileSync(path.join(APP, "static", "js", "coarse_worker.js"), "utf8");
  const posted = [];
  const fakeSelf = { postMessage: (m, xfer) => posted.push({ m, xfer }) };
  // eslint-disable-next-line no-new-func
  new Function("self", "buildField", "coarseHomeField", "decodeGrid", "planPassage",
    WSRC.replace(/^import[^\n]*\n/m, ""))(fakeSelf, C.buildField, C.coarseHomeField, C.decodeGrid, C.planPassage);
  fakeSelf.onmessage({ data: { id: 7, kind: "home", grids: open, floorDm: 30, airDm: 0, home } });
  const wm = posted[0] || {};
  check("11c. THE WORKER (coarse_worker.js, kind 'home'): the field built over the grids sent, its tiles' lengths "
        + "TRANSFERRED back (not copied), answered by id; a passage plan unchanged",
        () => wm.m && wm.m.id === 7 && wm.m.tiles && wm.m.tiles.length === 6 && wm.xfer && wm.xfer.length === 6
              && wm.xfer[0] === wm.m.tiles[0].len.buffer && Math.abs(C.coarseHomeDistM({ tiles: wm.m.tiles }, probes[0]) - C.coarseHomeDistM(hfO, probes[0])) < 1e-6,
        () => JSON.stringify({ id: wm.m && wm.m.id, tiles: wm.m && wm.m.tiles && wm.m.tiles.length, xfer: wm.xfer && wm.xfer.length }));

  // 11d. the page: when it is built, and how
  const RTH_MAX = 10 * +(/const NOGO_RADIUS_M = ([\d.]+);/.exec(H) || [])[1];
  const d = (re) => { const m = re.exec(H); if (!m) throw new Error("anchor gone: " + re); return m[0]; };
  const HOMEP = { lat: 43.07, lon: -70.71 };
  const tickWorld = (o) => {
    const w = Object.assign({ fineM: null, here: { lat: 43.07, lon: -70.40 }, builds: [], coarse: { key: null, hf: null, at: 0, note: null, busy: false },
                              fldBuild: null }, o || {});
    const src = [
      "const S = {home: w.home || HOME}, asv = w.here, homeFldBuild = w.fldBuild, RTH_MAX_M = " + RTH_MAX + ";",
      "const V = w.V || {};",
      "let coarseHome = w.coarse;",
      "const fineHomeDist = () => (w.fineM != null ? {m: w.fineM} : {why: 'off the field'});",
      "const nogoDR = () => ({min: 3.15}), airNeedM = () => 4.85;",
      "const coarseHomeBuild = async (key, here) => { w.builds.push({key, here}); };",
      d(/const COARSE_HOME_RETRY_MS = [^;]*;/), grab("coarseHomeKey"), grab("coarseHomeTick"),
      "return {tick: coarseHomeTick, key: coarseHomeKey};"].join("\n");
    w.api = new Function("w", "HOME", "distTo", "coarseHomeDistM", src)(w, HOMEP, flatD, C.coarseHomeDistM);
    return w;
  };
  const t1 = tickWorld(); t1.api.tick();                                              // 25 km out, off the field: built
  const tFine = tickWorld({ fineM: 9000 }); tFine.api.tick();                         // the field round home answers
  const tFar = tickWorld({ here: { lat: 43.07, lon: -69.9 } }); tFar.api.tick();      // ~66 km: out of range
  const tBusy = tickWorld({ coarse: { key: null, hf: null, at: 0, note: null, busy: true } }); tBusy.api.tick();
  const tFld = tickWorld({ fldBuild: { id: 1 } }); tFld.api.tick();                   // the fine field is being built
  const tSoon = tickWorld(); Object.assign(tSoon.coarse, { tried: tSoon.api.key(), at: Date.now() - 1000, note: "failed" }); tSoon.api.tick();
  const holds = { tiles: [{ tx: Math.floor(((-70.40 + 180) / CD) / N), ty: Math.floor(((43.07 + 90) / CD) / N), len: new Float32Array(N2).fill(5000) }] };
  const tHold = tickWorld(); tHold.coarse.key = tHold.api.key(); tHold.coarse.hf = holds; tHold.api.tick();
  // home moved (or her floor) a few seconds after the last build: built again AT ONCE - live, the minute's wait held the
  // straight line over a home moved to the far side of Cape Ann
  const tMoved = tickWorld({ coarse: { key: "another home", tried: "another home", hf: holds, at: Date.now() - 1000, note: "ready", busy: false } });
  tMoved.api.tick();
  check("11d. WHEN IT IS BUILT (coarseHomeTick, on every frame): she past the field round home and within RTH_MAX_M of "
        + "home - and not while the field round home answers, she is out of range, a build is running or the field round "
        + "home is being built, within a minute of trying for this same home, or with a field built for this home that "
        + "holds her; at once when home (or her floor) moved",
        () => t1.builds.length === 1 && t1.builds[0].key === t1.api.key() && [tFine, tFar, tBusy, tFld, tSoon, tHold].every((w) => w.builds.length === 0)
              && tMoved.builds.length === 1,
        () => JSON.stringify([t1, tFine, tFar, tBusy, tFld, tSoon, tHold, tMoved].map((w) => w.builds.length)));

  const buildWorld = (o) => {
    const w = Object.assign({ posts: [], gets: 0, workerMsgs: [], logs: [], st0: { id: "c1", state: "running", total: 8 },
                              stDone: { id: "c1", state: "done", total: 8, tiles: [[1, 2, 3, 4], [5, 6, 7, 8]] },
                              res: null, coarse: { key: "old", hf: { tiles: [] }, at: 0, note: "ready", busy: false } }, o || {});
    const src = [
      "const S = {home: w.home || HOME}, V = w.V || {};",
      "let coarseHome = w.coarse;",
      "const postCorridor = async (b) => { w.posts.push(b); return w.st0; };",
      "const getCorridor = async (id) => { w.gets++; return w.stDone; };",
      "const CORRIDOR_POLL_MS = 0, passageGrids = async (tiles) => ({grids: tiles.map((t) => ({tile: t})), missing: 0});",
      "const coarseHomeInWorker = async (m) => { w.workerMsgs.push(m); return w.res || {tiles: [{tx: 1, ty: 2, len: new Float32Array(4)}], reached: 3, ms: 5}; };",
      "const nogoDR = () => ({min: 3.15}), airNeedM = () => 4.85, logClient = (k, dd) => w.logs.push([k, dd]);",
      ["COARSE_HOME_HALF_MIN_KM", "COARSE_HOME_HALF_FRAC", "COARSE_HOME_HALF_MAX_KM", "COARSE_HOME_MAX_TILES"].map((n) => d(new RegExp("const " + n + " = [^;]*;"))).join("\n"),
      "async " + grab("coarseHomeBuild"),          // (grab takes the function from its `function` keyword)
      "return {build: coarseHomeBuild, now: () => coarseHome};"].join("\n");
    w.api = new Function("w", "HOME", "distTo", "coarseHomeDistM", src)(w, HOMEP, flatD, C.coarseHomeDistM);
    return w;
  };
  const near = { lat: 43.07, lon: -70.60 }, mid = { lat: 43.07, lon: -70.40 }, farIn = { lat: 43.07, lon: -70.13 };
  const b1 = buildWorld(); await b1.api.build("K1", mid);
  const bNear = buildWorld(); await bNear.api.build("K", near);
  const bFar = buildWorld(); await bFar.api.build("K", farIn);
  const halfOf = (w) => w.posts[0] && w.posts[0].half_km;
  const ok1 = b1.api.now();
  check("11e. THE BUILD (coarseHomeBuild): the chart read along the way home - home to her - WITH its grids, either side "
        + "40% of her distance home (5 to 25 km), waited out, its tiles' grids to the worker as kind 'home' at her floor and "
        + "air draft from home; the field kept with its key and said ready, logged",
        () => b1.posts.length === 1 && b1.posts[0].grids === true && b1.posts[0].route.length === 2
              && flatD(b1.posts[0].route[0], HOMEP) < 1 && flatD(b1.posts[0].route[1], mid) < 1
              && Math.abs(halfOf(b1) - 0.4 * flatD(mid, HOMEP) / 1000) < 0.01 && halfOf(bNear) === 5 && halfOf(bFar) < 25 && halfOf(bFar) > 15
              && b1.gets >= 1 && b1.workerMsgs.length === 1 && b1.workerMsgs[0].kind === "home" && b1.workerMsgs[0].grids.length === 2
              && b1.workerMsgs[0].floorDm === 32 && b1.workerMsgs[0].airDm === 49 && flatD(b1.workerMsgs[0].home, HOMEP) < 1
              && ok1.key === "K1" && ok1.note === "ready" && ok1.busy === false && ok1.hf.tiles.length === 1
              && b1.logs.some((l) => l[0] === "coarse_home" && l[1].ok === true),
        () => JSON.stringify({ half: [halfOf(bNear), halfOf(b1) && +halfOf(b1).toFixed(2), halfOf(bFar) && +halfOf(bFar).toFixed(2)],
                               worker: b1.workerMsgs[0] && [b1.workerMsgs[0].kind, b1.workerMsgs[0].floorDm, b1.workerMsgs[0].airDm], now: [ok1.key, ok1.note] }));
  const bErr = buildWorld({ st0: { error: "refused" } }); await bErr.api.build("K2", mid);
  const bBig = buildWorld({ st0: { id: "c", state: "running", total: 400 } }); await bBig.api.build("K2", mid);
  const bStop = buildWorld({ stDone: { id: "c", state: "canceled" } }); await bStop.api.build("K2", mid);
  const bWk = buildWorld({ res: { error: "unread" } }); await bWk.api.build("K2", mid);
  const failed = [bErr, bBig, bStop, bWk].map((w) => w.api.now());
  check("11f. A BUILD THAT FAILS says why - the read refused, too many tiles (the read STOPPED, not left reading), the read "
        + "not done, home's own tile unread - is tried again later (`at`), and KEEPS the field it had",
        () => failed.every((c) => c.busy === false && c.at > 0 && c.key === "old" && c.hf && c.note !== "ready")
              && /could not be read \(refused\)/.test(failed[0].note) && /400 chart tiles/.test(failed[1].note) && bBig.gets === 0
              && bBig.posts.length === 2 && bBig.posts[1].cancel === "c" && bErr.posts.length === 1
              && /canceled/.test(failed[2].note) && /home's own chart tile could not be read/.test(failed[3].note),
        () => JSON.stringify(failed.map((c) => c.note)));

  // 11g. the order: the field round home, the coarse grid, the passage, the straight line - and said
  const HOME = { lat: 43.07, lon: -70.71 };
  const pageW = (o) => {
    const w = Object.assign({ field: null, passage: null, coarse: { key: null, hf: null, note: null, busy: false }, coarseDist: null }, o || {});
    const src = [
      "const S = {home: HOME, home_source: null}, V = {};",
      "const FR = {toEN: () => ({e: 0, n: 0})}, mission = {passage: w.passage}, nogo = {frame: FR}, homeFldBuild = null;",
      "const homeFld = w.field ? {dist: [1], frame: FR, key: 'k', g: {cell: 5}, note: 'ready'} : {dist: null, note: 'home is off the chart that was read'};",
      "const homeFieldKey = () => 'k', fieldDistM = () => w.field, cellOf = () => true, HOME_FIELD_REACH_M = 300;",
      "let coarseHome = w.coarse;",
      "const nogoDR = () => ({min: 3.15}), airNeedM = () => 4.85, coarseHomeDistM = () => w.coarseDist;",
      "const fmtDist = (x) => (x / 1000).toFixed(1) + ' km';",
      ["fineHomeDist", "homeDistFrom", "homeHowSay", "coarseHomeKey", "passageHome"].map(grab).join("\n"),
      "return {dist: homeDistFrom, how: homeHowSay, key: coarseHomeKey};"].join("\n");
    return new Function("w", "HOME", "distTo", "homeSections", src)(w, HOME, flatD, C.homeSections);
  };
  const her = { lat: 43.07, lon: -70.40 };
  const kNow = pageW().key();
  const gC = pageW({ coarse: { key: kNow, hf: {}, note: "ready", busy: false }, coarseDist: 31000 }).dist(her);
  const gF = pageW({ field: 26000, coarse: { key: kNow, hf: {}, note: "ready", busy: false }, coarseDist: 31000 }).dist(her);
  const gOld = pageW({ coarse: { key: "another home", hf: {}, note: "ready", busy: false }, coarseDist: 31000 }).dist(her);
  const gBusy = pageW({ coarse: { key: null, hf: null, note: null, busy: true } }).dist(her);
  const gFail = pageW({ coarse: { key: null, hf: null, note: "the chart read along the way canceled", busy: false } }).dist(her);
  const P = pageW();
  check("11g. THE ORDER: the field round home first; then the COARSE GRID (said 'by water (coarse grid)'); a coarse field "
        + "built for another home not used; then the passage, then the straight line - saying the coarse grid is being "
        + "read, or why its build failed",
        () => gF.m === 26000 && !gF.along && gC.m === 31000 && gC.along === "coarse" && gC.water === true
              && P.how(gC, true) === " by water (coarse grid)" && gOld.water === false && Math.abs(gOld.m - flatD(her, HOME)) < 1
              && /; the coarse grid is being read$/.test(gBusy.why) && /; the coarse grid: the chart read along the way canceled$/.test(gFail.why)
              && !/coarse/.test(gOld.why),
        () => JSON.stringify({ F: gF.m, C: [gC.m, gC.along], old: gOld.why, busy: gBusy.why, fail: gFail.why }));

  // 11i. OPEN WATER FIRST (2026-10-14): the same wall and band with the field's default costs - each cell priced for its
  // nearness to a danger as the passage search prices it (coarse.js openWaterCosts) - against the level rules alone. The
  // way home round the wall's end keeps OFF it: longer than the level rules' way, and within 2% of the way round it worked by
  // hand a CLEAR_M off its end; round the band, wider than the level rules go; across open water, nothing changed (no tile
  // without a danger carries a cost); and a field built with it off carries none. Then the switch: the key the page builds
  // the field for changes with it (a field built for one is not kept for the other), and the worker is told.
  const OWC = require(path.join(APP, "static", "js", "openwater.js")).OPEN_WATER;
  const mWo = C.coarseHomeDistM(C.coarseHomeField(field(wall), hW), far);
  const topD = ll(wall[1], 101, 229 + OWC.CLEAR_M / CELL_M), aroundD = flatD(hW, topD) + flatD(topD, far);
  const mRo = C.coarseHomeDistM(C.coarseHomeField(field(bandR), hB), fB);
  const fOn = field(wall), fOff = fieldLv(wall), hfLv = C.coarseHomeField(fieldLv(open), home);
  // home's own circle carries no open-water cost (the harbor is the detail planner's): an islet between her and home, both
  // well inside it - the way home is the level rules' own, to the meter
  const isl = [grid(TX, TY)];
  for (let r = 125; r <= 131; r++) for (let c = 134; c <= 136; c++) isl[0].C[r * N + c] = 0;
  const hI = ll(isl[0], 128, 128), pI = ll(isl[0], 142, 128);
  const inCircle = [C.coarseHomeDistM(C.coarseHomeField(field(isl), hI), pI), C.coarseHomeDistM(C.coarseHomeField(fieldLv(isl), hI), pI)];
  const openSame = probes.every((p) => Math.abs(C.coarseHomeDistM(hfO, p) - C.coarseHomeDistM(hfLv, p)) < 1e-6);
  const kOpen = tickWorld({ V: {} }).api.key(), kClose = tickWorld({ V: { OPEN_WATER: false } }).api.key();
  const bOff = buildWorld({ V: { OPEN_WATER: false } }); await bOff.api.build("K1", mid);
  const sent = [b1.workerMsgs[0] && b1.workerMsgs[0].openWater, bOff.workerMsgs[0] && bOff.workerMsgs[0].openWater];
  const planSend = grab("planPassageNow");
  check("11i. OPEN WATER FIRST, COARSE: round the wall the way home keeps off its end - " + (mWo / 1000).toFixed(2) + " km against "
        + "the level rules' " + (mW / 1000).toFixed(2) + ", within 2% of the way round " + OWC.CLEAR_M + " m off its end worked by hand ("
        + (aroundD / 1000).toFixed(2) + ") - and round the band wider; open water unchanged; inside home's own circle no cost (round an "
        + "islet there, the level rules' own way); with it off no cell carries the cost; the page's key and both worker messages carry the switch",
        () => mWo > mW + 500 && Math.abs(mWo - aroundD) / aroundD < 0.02 && mRo > mR + 300 && openSame
              && Number.isFinite(inCircle[0]) && Math.abs(inCircle[0] - inCircle[1]) < 1
              && fOn.list.map((t) => !!t.nr).join() === "false,true,false" && fOff.list.every((t) => !t.nr)
              && kOpen !== kClose && /\|open$/.test(kOpen) && /\|close$/.test(kClose)
              && sent[0] === true && sent[1] === false && /openWater: V\.OPEN_WATER !== false/.test(planSend),
        () => JSON.stringify({ wall: [Math.round(mW), Math.round(mWo), Math.round(aroundD)], band: [Math.round(mR), Math.round(mRo)],
                               nr: fOn.list.map((t) => !!t.nr), keys: [kOpen, kClose], sent, inCircle: inCircle.map((m) => m && Math.round(m)) }));

  // 11h. the wiring
  check("11h. THE WIRING: the monitor builds it on every frame after the field round home; its own worker, so a passage "
        + "being planned is never answered with it; the coarse home field imported from coarse.js",
        () => /homeFieldTick\(\);\s*\n\s*coarseHomeTick\(\);/.test(grab("fuelTick"))
              && /new Worker\("\/static\/js\/coarse_worker\.js", \{type: "module"\}\)/.test(grab("coarseHomeInWorker"))
              && /coarseHomeWorker/.test(grab("coarseHomeInWorker")) && !/passageWorker/.test(grab("coarseHomeInWorker"))
              && /import \{ PORT_R_M as PASSAGE_PORT_R_M, homeSections, coarseHomeDistM \} from "\/static\/js\/coarse\.js";/.test(H),
        "fuelTick / coarseHomeInWorker / the import");

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("  FAIL 0. the suite itself CRASHED before finishing - " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e)); console.log("\n1 CHECK(S) FAILED (crashed before finishing)"); process.exit(1); });
