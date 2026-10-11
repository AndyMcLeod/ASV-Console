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
  const world = () => {
    const w = { banners: [], logs: [], sent: [], sup: true, need: 11 };
    const mk = new Function("S", "asv", "fuelModel", "energyLevel", "fuelHomeNeed", "rthLevel", "rthDecision", "homeFieldTick",
      "supervising", "showBanner", "logClient", "doRTH", "fuelSay", "fuelFmt", "FUEL_AT_HOME_M",
      "let fuelRth = {acted: false, alerted: false};\nlet fuelNow = null, fuelErrSaid = false;\n" + grab("fuelTick")
      + "\nreturn {tick: fuelTick, latch: () => ({...fuelRth}), now: () => fuelNow};");
    w.api = mk({ home: { lat: 0, lon: 0 } }, { lat: 0.01, lon: 0 }, () => model, F.energyLevel,
      () => ({ need: w.need, m: 5000, water: true, twKn: 8 }), F.rthLevel, F.rthDecision, () => {}, () => w.sup,
      (t) => w.banners.push(t), (k, d) => w.logs.push([k, d]),
      (o) => { w.sent.push(o); return Promise.resolve(); }, () => "the sentence", (m, x) => x.toFixed(1) + " L", AT_HOME);
    w.frame = (fuel, o) => w.api.tick({ armed: true, estop: false, behavior: "survey", status: { fuel_l: fuel }, ...(o || {}) });
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
}

// ── 9. THE WIRING ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const PROJ = grab("fuelProjection"), TICK = grab("fuelTick"), NEED = grab("fuelHomeNeed"), BUILD = grab("homeFieldTick");
  check("9. ONE ESTIMATE OF THE WAY HOME: the monitor and every step of the card's projection both ask fuelHomeNeed - water "
        + "distance at the TRANSIT speed (an RTH flies the transit role) - so the card cannot promise a mission the monitor "
        + "will cut short",
        () => /fuelHomeNeed\(model, \{lat: asv\.lat, lon: asv\.lon\}\)/.test(TICK) && /fuelHomeNeed\(model, fr\.fromEN\(q\.e, q\.n\)\)/.test(PROJ)
              && /roleSpeed\("transit"\)/.test(NEED) && /homeDistFrom\(ll\)/.test(NEED),
        "fuelTick / fuelProjection / fuelHomeNeed");
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

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
