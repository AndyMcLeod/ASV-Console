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
//         through a blocked corner, and blind where it should be; 7d her OWN cell first, never a hop across land to a
//         cell nearer home, and a lookup that reads a few cells, not the whole reach (the 2.3 s page stall, 2026-11-06);
//   8    the page's monitor, lifted out of the page and driven frame by frame: alert and send ONCE, the operator's
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
//   THE ENERGY OVERRIDE (Andy, 2026-11-10 live: "energy over-ride failed in the running instance"). The console reports
//   a full pack under it, and the monitor judged that as her level: a battery hull is watched against the RTH point at
//   any range (6d), and past the reach of a full pack the point stands above full - so 3.46 nm out, the override on, she
//   was sent home over her Go-To (three sessions in five days in the recordings; 20 RTHs in 26 s in one). 6e the
//   decision's own state and energyLevel's null; 8k-8l the page's monitor silent under it and answering on the frame it
//   goes off, the latch not outliving it; 8m ONE low-fuel RTH in flight; 8n its own alert comes down; 9h both rows and
//   the pill say NOT MONITORED; 9f2 the rehearsal stands down; 9i the pill's click awaited, one at a time; 9g the walk
//   redone when her level goes or comes back; 10g the alert's sentence reckons what she arrives with. And from the
//   review of that change: 8o a view-only window does not count a crossing as answered (taking over, it sends her);
//   8p a new link (boot_id) is a new watch. (The server's half - every new link told the override - is
//   tests/run_link_control.py 21-21e and tests/energy_chartinfo.py 14-15; doRTH's withdrawal is tests/command_result.js 54b.)
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
// and forty for the energy override (2026-11-10; scratchpad mut_en.py / mut_en2.py: fuel.js on a sidecar app through
// ASV_APP, the page on a sidecar through ASV_HTML), all caught - one SURVIVED the first cut, and what it found was
// this suite: with the pill's one-click-at-a-time guard removed, 9i's stub left two awaits unsettled and node exited 0
// at 9f2, the rest never run. The floor below (`finished`) and a resolver per post answer it.
//   energyLevel still reads the forced gauge                    -> 6e, 8k
//   rthDecision not told the override / told after the level    -> 6e, 8k, 8l
//   the override re-arms only a latch that was set / sends      -> 6e, 8l
//   fuelTick does not pass the override / says it is not on     -> 8k, 8l
//   no in-flight guard / never cleared / no bound / never set   -> 8m (and 8, 8l, 8p: the next crossing blocked)
//   a late landing clears the next one's mark                   -> 8m
//   the latch set in a window that cannot send                  -> 8o
//   the latch kept across a new boot_id                         -> 8p
//   the alert left up / every LOW FUEL banner taken / one kind  -> 8n
//   the RTH row, the Fuel row, the tips, the pill unbranched    -> 9h
//   the rehearsal row and its gate live under the override      -> 9f2, 9h
//   the walk kept when her level goes or comes back             -> 9g
//   the sentence asserts the reserve / no tolerance / no "more
//   than she has" / no "above its alarm"                        -> 10g
//   the click: no busy guard, no took(), the request's state,
//   busy never released, the same value posted                  -> 9i

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);
// ⚠ A SUITE THAT STOPS RUNNING ITS CHECKS MUST NOT EXIT 0 (2026-11-10; tests/command_result.js holds the same floor).
// The checks from 9f on run inside an async function, and an await that never settles does not crash node: the
// process ends quietly, code 0, with every check after it never run. Found by mutation - with the energy pill's
// one-click-at-a-time guard removed, 9i's own stub left two promises unsettled, and the suite "passed" having stopped
// at 9f2.
let finished = false;
process.on("exit", (code) => {
  if (!finished && !code) {
    console.log("  FAIL 0. THE SUITE DID NOT FINISH - node was about to exit 0 with checks still to run: an await that "
                + "never settles is a SILENT PASS");
    console.log("\n1 CHECK(S) FAILED (did not finish)");
    process.exitCode = 1;
  }
});

// the AVOIDING record the guard, the resumes and setPlanIntent now touch (2026-11-02):
// a stub, because this suite owns none of the flag's behaviour - tests/ais_avoid.js does.
let avoiding = null; const avoidingRaise = (why, kind, rejoin) => { avoiding = {why, kind, rejoin}; }; const avoidingNow = () => avoiding;
// the Doing row asks avoidingShown(), not avoidingNow(), since 2026-11-03 - two surfaces, one function, so a
// view-only page cannot have the badge and the row disagree. Stood in for here, where the subject is the card.
const avoidingShown = () => avoiding;
const avoidingSay = (a) => "AVOIDING - " + a.why.toUpperCase() + " " + a.kind;
const AVOID_TIP = "when the badge comes down";

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
  // UNDER THE ENERGY OVERRIDE (Andy, 2026-11-10 live: "energy over-ride failed in the running instance"). The console
  // reports a full pack under it, and a full pack is AT OR BELOW a battery hull's RTH point wherever the fuel home is
  // more than the span less the reserve (6d): 26.5 V against a point of 26.6 V was "reached", and she was sent home
  // over her Go-To with the override on. The override is the decision's own input, asked BEFORE any level.
  const O = (o) => D({ override: true, ...o });
  const full = { model: zm, level: zm.full, rth: F.rthLevel(zm, 2.9), armed: true, estop: false, behavior: "goto", atHome: false, acted: false };
  const u = { below: O({}), acted: O({ acted: true }), alertOnly: O({ alertOnly: true }), going: O({ behavior: "rth" }),
              disarmed: O({ armed: false }), above: O({ level: 100 }), aboveActed: O({ level: 100, acted: true }),
              noLevel: O({ level: null }), noPoint: O({ rth: null }), pastFull: F.rthDecision({ ...full, override: true }) };
  const off = F.rthDecision(full), noModel = F.rthDecision({ override: true });
  // ... and a forced reading is not her level: energyLevel answers null under it, for both kinds (the pill shows the
  // status; every reader of the LEVEL has a "no level" path)
  const lv = { batt: F.energyLevel(zm, { battery_v: 26.5, unlimited_energy: true }), fuel: F.energyLevel(model, { fuel_l: 250, unlimited_energy: true }),
               battOff: F.energyLevel(zm, { battery_v: 26.5, unlimited_energy: false }), fuelOff: F.energyLevel(model, { fuel_l: 250 }) };
  check("6e. UNDER THE ENERGY OVERRIDE the decision is a state of its own, 'override': never a send, never a latch - below "
        + "the point, already answered, out of range, going home, disarmed, above it, with no level or no point, and with a "
        + "battery's RTH point ABOVE a full pack (26.6 V of 26.5) - and it lets the latch go (rearm, whether or not it was "
        + "set), so the crossing after it goes off is answered; the override off, that same full pack is REACHED and sent; "
        + "and under it energyLevel reads NO level (null), fuel or battery",
        () => Object.values(u).every((x) => x.state === "override" && !x.send && !x.latch && x.rearm === true)
              && full.rth > zm.full && off.state === "reached" && off.send && off.latch && noModel.state === "unknown"
              && lv.batt === null && lv.fuel === null && lv.battOff === 26.5 && lv.fuelOff === 250,
        () => Object.entries({ ...u, off }).map(([k, x]) => k + ":" + x.state + (x.send ? "+send" : "") + (x.latch ? "+latch" : "") + (x.rearm ? "+rearm" : "")).join(" ")
            + " | levels " + JSON.stringify(lv));
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
  // 7d. HER OWN CELL, THEN THE NEAREST - NEVER A SHORTCUT THROUGH LAND, AND NO WHOLE-SQUARE SCAN (2026-11-06, "the chart
  // page is freezing up"). fieldDistM took the least (field + straight hop) over every cell within the reach, and its
  // early exit never fired: ~14,600 cells a call at the page's 300 m reach, asked at every step of the mission ahead
  // (fuelProjection) - 2.3 s of frozen page every 12 s on his 814-waypoint DriX survey. And the least total ran the hop
  // THROUGH land: a boat beside a thin wall, home on its far side, read the far side's field plus the hop across it.
  // The field's reads are COUNTED (a Proxy over it), so a whole-square scan cannot hide behind a right answer.
  {
    const counted = (arr) => { const c = { n: 0 }; c.arr = new Proxy(arr, { get(t, k) {
      if (typeof k === "string" && k !== "" && !Number.isNaN(+k)) c.n++;
      const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } }); return c; };
    // (a) a 1-cell wall from the bottom to 1800 m, home west of it, the boat 30 m east of it in open water
    const thin = new Uint8Array(g.W * g.H);
    for (let y = 0; y < 180; y++) thin[y * g.W + 100] = 1;
    const dt = HF.homeField(thin, g.W, g.H, HF.homeSeeds(g, thin, home, 100)), boatA = { e: 1033, n: 200 };
    const ca = counted(dt), byWater = HF.fieldDistM(g, ca.arr, thin, boatA, 100);
    const truA = Math.hypot(1000 - 200, 1800 - 200) + Math.hypot(boatA.e - 1010, 1800 - boatA.n);
    const own = HF.cellOf(g, boatA), ownAt = HF.cellCenter(g, own.gx, own.gy);
    const ownM = dt[own.i] * g.cell + Math.hypot(ownAt.e - boatA.e, ownAt.n - boatA.n);
    // (b) the boat INSIDE a blocked strip one cell from its west edge, home east of it: the nearest clear cell is west
    // (round the strip's end), the east edge is 10 cells off and nearer home by water - a hop through the strip
    const strip = new Uint8Array(g.W * g.H);
    for (let y = 0; y < 150; y++) for (let x = 60; x < 70; x++) strip[y * g.W + x] = 1;
    const homeB = { e: 1500, n: 200 }, ds = HF.homeField(strip, g.W, g.H, HF.homeSeeds(g, strip, homeB, 100));
    const boatB = { e: 605, n: 205 }, cb = counted(ds), inStrip = HF.fieldDistM(g, cb.arr, strip, boatB, 150);
    const westAt = HF.cellCenter(g, 59, 20), westM = ds[20 * g.W + 59] * g.cell + Math.hypot(westAt.e - boatB.e, westAt.n - boatB.n);
    const eastAt = HF.cellCenter(g, 70, 20), eastM = ds[20 * g.W + 70] * g.cell + Math.hypot(eastAt.e - boatB.e, eastAt.n - boatB.n);
    const sq = (2 * Math.ceil(150 / g.cell) + 1) ** 2;
    check("7d. ... her OWN cell when it reaches home (beside a thin wall: the way round its end, never the far side's field "
          + "plus a hop through it; the field read for that one cell alone), else the NEAREST clear cell (inside a blocked "
          + "strip: out its near side, not across it to the side nearer home), the search stopping at the ring that holds it",
          () => Math.abs(byWater - ownM) < 1e-9 && byWater >= truA - 1 && byWater <= truA * 1.03 && ca.n <= 2
                && Math.abs(inStrip - westM) < 1e-9 && eastM < westM - 500 && cb.n < sq / 4,
          () => "beside the wall " + byWater.toFixed(0) + " m (own cell " + ownM.toFixed(0) + ", true " + truA.toFixed(0)
              + ", straight across " + Math.hypot(boatA.e - home.e, boatA.n - home.n).toFixed(0) + ") reading the field "
              + ca.n + "x; in the strip " + inStrip.toFixed(0) + " m (west " + westM.toFixed(0) + ", east across it "
              + eastM.toFixed(0) + ") reading it " + cb.n + "x of a " + sq + "-cell square");
  }
}

// ── 8. THE PAGE'S MONITOR, DRIVEN FRAME BY FRAME ──────────────────────────────────────────────────────────────────
{
  const v = vessel("drix08_em712"), model = F.energyModel(v, v.propulsion.speeds_kn.high);
  const AT_HOME = +(/const FUEL_AT_HOME_M = ([\d.]+);/.exec(H) || [])[1];
  const RTH_MAX = 10 * +(/const NOGO_RADIUS_M = ([\d.]+);/.exec(H) || [])[1];
  // The page's own fuelTick, fuelWatchAt (is home in range) and the out-of-range sentence, with the world stubbed:
  // `need` the fuel home, `far` the distance rthTooFar refuses a return by (null: within it), `S.home` null for none.
  // (2026-11-10) `fields` counts the two home-field ticks; `clock` is the page's Date.now(), moved by the check; and the
  // RTH doRTH is asked for is a thing with the two calls the page makes on it (.catch, then .finally) - LANDED AT ONCE
  // (its finally run before the next frame, as every check before 8m assumes) unless the world holds it IN FLIGHT
  // (`hang`), when the check lands it itself (w.land()).
  const FLIGHT_MS = +(/^const FUEL_FLIGHT_MS = (\d+);/m.exec(H) || [])[1];
  const world = (mdl) => {
    const m0 = mdl || model;
    // `up` is the banner standing on the page (showBanner puts one up; the page's takeDownBanner lifts it by its text)
    const w = { banners: [], logs: [], sent: [], sup: true, need: 11, far: null, S: { home: { lat: 0, lon: 0 } },
                fields: 0, clock: 1000000, hang: false, land: null, up: null };
    const mk = new Function("S", "asv0", "fuelModel", "energyLevel", "fuelHomeNeed", "rthTooFar", "fuelWatch", "rthLevel", "rthDecision",
      "homeFieldTick", "coarseHomeTick", "supervising", "showBanner", "logClient", "doRTH", "fuelSay", "fuelFmt", "fmtDist", "FUEL_AT_HOME_M",
      "FUEL_RESERVE_FRAC", "RTH_MAX_M", "fmtVol", "FUEL_FLIGHT_MS", "Date", "takeDownBanner",
      // `asv` a binding the world can set (8t: a page's first frame, before it has a position of its own)
      "let asv = asv0;\nlet fuelRth = {acted: false, alerted: false};\nlet fuelNow = null, fuelErrSaid = false, fuelFlight = 0, fuelBoot;\n" + grab("fuelTick")
      + "\n" + grab("fuelWatchAt") + "\n" + grab("fuelOutOfRangeSay") + "\n" + grab("fuelReserveOf") + "\n" + grab("homeHowSay")
      + "\nreturn {tick: fuelTick, latch: () => ({...fuelRth}), now: () => fuelNow, flight: () => fuelFlight, setAsv: (v) => { asv = v; }};");
    // (2026-11-10 review) .then is handed `w.outcome` when it settles - what became of the post, as doRTH answers it
    // (undefined: taken; {notTaken: <cmd()'s answer>}: not) - before the finally, as a promise chain runs them
    const flown = () => { const p = { thens: [], catch() { return p; }, then(fn) { p.thens.push(fn); return p; },
      finally(fn) { const settle = () => { p.thens.forEach((t) => t(w.outcome)); fn(); }; if (w.hang) w.land = settle; else settle(); return p; } };
      return p; };
    w.api = mk(w.S, { lat: 0.01, lon: 0 }, () => m0, F.energyLevel,
      (m, ll) => { w.at = ll; return { need: w.need, m: 5000, water: true, twKn: 8 }; }, () => (w.far == null ? null : { m: w.far }), F.fuelWatch,
      F.rthLevel, F.rthDecision, () => { w.fields++; }, () => { w.fields++; }, () => w.sup,
      (t) => { w.banners.push(t); w.up = t; }, (k, d) => w.logs.push([k, d]),
      (o) => { w.sent.push(o); return flown(); }, () => "the sentence", (m, x) => x.toFixed(1) + " L",
      (m) => (m / 1000).toFixed(1) + " km", AT_HOME, F.FUEL_RESERVE_FRAC, RTH_MAX,
      require("../static/js/units.js").fmtVol,   // the alert's tenths in the operator's units (2026-10-17)
      FLIGHT_MS, { now: () => w.clock }, (re) => { if (w.up != null && re.test(w.up)) w.up = null; });
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
  // ── THE ENERGY OVERRIDE (Andy, 2026-11-10 live: "energy over-ride failed in the running instance"). The frame's own
  // status says it (status.unlimited_energy) beside the gauge the console forces full: the small-class boat's 26.5 V,
  // and the fuel home 2.9 V - the RTH point 23 + 0.7 + 2.9 = 26.6 V, ABOVE the pack. The figures of the frame that sent
  // her home over her Go-To with the override on.
  const ovr = (o) => ({ status: { battery_v: zm.full, unlimited_energy: true }, behavior: "goto", ...(o || {}) });
  const Ov = world(zm); Ov.need = 2.9;
  for (let i = 0; i < 4; i++) Ov.frame(zm.full, ovr());
  const quiet = Ov.banners.length === 0 && Ov.sent.length === 0 && Ov.logs.length === 0, built = Ov.fields;
  const said = Ov.api.now();
  Ov.frame(21.31, { behavior: "goto" }); Ov.frame(21.3, { behavior: "goto" });   // the override off: the pack as it is, below the point
  check("8k. THE ENERGY OVERRIDE ON, a battery hull whose RTH point is ABOVE a full pack (26.6 V of 26.5 - where the "
        + "forced-full gauge was 'reached' and she was sent home): nothing is said, logged or sent on any frame, the monitor "
        + "says 'override' with NO level, and the fields round home are still built; the frame it goes OFF with the pack "
        + "below the point she is alerted and sent home, once",
        () => quiet && built === 8 && said && said.override === true && said.state === "override" && said.level === null
              && Ov.sent.length === 1 && Ov.banners.length === 1 && /LOW FUEL/.test(Ov.sent[0].why) && Ov.logs[0][1].sent === true
              && Ov.sent[0].breakWhy === "fuel",
        () => "under it: " + (quiet ? "quiet" : Ov.banners.length + " banner(s) / " + Ov.sent.length + " sent") + ", state "
            + (said && said.state) + ", level " + (said && said.level) + ", field ticks " + built + " (want 8); after it went off: "
            + Ov.sent.length + " sent, " + Ov.banners.length + " banner(s)");
  // the latch does not outlive it: SENT before it went on, and SAID while disarmed before it went on
  const Ls = world(zm); Ls.need = 2.9;
  Ls.frame(26.4); for (let i = 0; i < 3; i++) Ls.frame(zm.full, ovr()); Ls.frame(26.3);
  const Ld = world(zm); Ld.need = 2.9;
  Ld.frame(26.4, { armed: false }); Ld.frame(26.39, { armed: false });
  const saidDisarmed = Ld.banners.length === 1 && Ld.sent.length === 0;
  for (let i = 0; i < 3; i++) Ld.frame(zm.full, ovr({ armed: false }));
  const letGo = Ld.api.latch();
  Ld.frame(26.3, { armed: false });
  // ... a diesel hull whose RTH point is EXACTLY a full tank (the fuel home 200 L of 250): a full gauge is 'reached' there too
  const Dz = world(); Dz.need = 200;
  for (let i = 0; i < 3; i++) Dz.frame(250, { status: { fuel_l: 250, unlimited_energy: true } });
  // ... a window that does not supervise is quiet under it as well (every chart window alerts, with the override off)
  const Vw = world(zm); Vw.need = 2.9; Vw.sup = false;
  for (let i = 0; i < 3; i++) Vw.frame(zm.full, ovr());
  check("8l. ... and THE LATCH DOES NOT OUTLIVE IT: sent before it went on, the crossing after it goes off is answered "
        + "again; said while disarmed before it went on, it is said again after; a diesel hull whose RTH point is exactly a "
        + "full tank is not sent home by a gauge forced full; and a view-only window is as quiet under it",
        () => Ls.sent.length === 2 && Ls.banners.length === 2 && saidDisarmed && !letGo.acted && !letGo.alerted
              && Ld.banners.length === 2 && Ld.sent.length === 0 && Dz.banners.length === 0 && Dz.sent.length === 0
              && Vw.banners.length === 0 && Vw.sent.length === 0 && Vw.logs.length === 0,
        () => "sent before: " + Ls.sent.length + " sent in all (want 2); said disarmed: " + Ld.banners.length + " banner(s) (want 2), latch "
            + JSON.stringify(letGo) + "; diesel at a full tank: " + Dz.banners.length + " banner(s), " + Dz.sent.length + " sent; viewer: "
            + Vw.banners.length + " banner(s)");
  // ... and its own alert does not stand over a monitor that is off: said while disarmed, then the override on - the
  // banner comes down; the RTH's OWN banner (a fact about a command she took) and anyone else's stay up
  const Bn = world(zm); Bn.need = 2.9;
  Bn.frame(26.4, { armed: false });
  const alertUp = /^⚠ LOW FUEL — THE RTH POINT: /.test(Bn.up || "");
  Bn.frame(zm.full, ovr({ armed: false }));
  const alertDown = Bn.up === null;
  const Br = world(); Br.far = 900000; Br.frame(49.9);                      // the out-of-range alert (a diesel hull's)
  const reserveUp = /^⚠ LOW FUEL — AT THE 20% RESERVE: /.test(Br.up || "");
  Br.frame(250, { status: { fuel_l: 250, unlimited_energy: true } });
  const keep = ["⚠ LOW FUEL, at the RTH point (26.50 V on the pack) · RTH: routed around nogo zone(s) via 156 waypoints", "Routing home…"].map((t) => {
    const k = world(zm); k.need = 2.9; k.up = t; k.frame(zm.full, ovr()); return k.up === t; });
  check("8n. UNDER THE OVERRIDE THE MONITOR'S OWN ALERT COMES DOWN (the banner is sticky, and stood over a card reading NOT "
        + "MONITORED): the RTH-point alert and the out-of-range alert both - while the banner of an RTH she was given, and "
        + "any other, stay up",
        () => alertUp && alertDown && reserveUp && Br.up === null && keep.every(Boolean),
        () => JSON.stringify({ alertUp, alertDown, reserveUp, reserveDown: Br.up === null, othersKept: keep }));
  // ── A WINDOW THAT CANNOT SEND HAS NOT ANSWERED (2026-11-10, the review). The latch was set at the decision, before
  // "is this the supervising window": a view-only window counted the crossing as answered, and after TAKE OVER - the
  // reason for one is often that the supervising tab has died - nobody sent her home.
  const Tk = world(); Tk.sup = false;
  Tk.frame(60); Tk.frame(59.9);
  const viewSaid = Tk.banners.length === 1 && /supervising window/.test(Tk.banners[0]) && Tk.sent.length === 0 && !Tk.api.latch().acted;
  Tk.sup = true; Tk.frame(59.8);                   // TAKE OVER, she is still on her survey below the point
  // ... while one that watched her sent home by the supervising window latches once she IS going home: taken over
  // after the operator's change, it sends nothing (the change stands, as in the window that sent)
  const Tw = world(); Tw.sup = false;
  Tw.frame(60); Tw.frame(59.9, { behavior: "rth" });
  const wLatched = Tw.api.latch().acted;
  Tw.sup = true; Tw.frame(59.8, { behavior: "goto" });
  check("8o. A VIEW-ONLY WINDOW DOES NOT COUNT THE CROSSING AS ANSWERED: it says the supervising window sends her home, "
        + "once, and is not latched - so when it TAKES OVER with her still below the point and not going home, IT sends "
        + "her; once she is going home it latches like any window, and an operator's change after that stands there too",
        () => viewSaid && Tk.sent.length === 1 && /Returning home now/.test(Tk.banners[1] || "") && wLatched && Tw.sent.length === 0
              && Tw.banners.length === 1,
        () => JSON.stringify({ viewSaid, sentAfterTakeOver: Tk.sent.length, banners: Tk.banners.map((t) => t.slice(-40)),
                               watcherLatched: wLatched, watcherSent: Tw.sent.length }));
  // ── A NEW LINK IS A NEW WATCH (2026-11-10, the review). The latch is the page's, and a page that is not reloaded kept
  // it through a Spawn, a vessel or port switch and a reconnect: a new boat (`boot_id`) below her point was neither
  // said nor sent on a page that had answered the last one's crossing.
  const Bt = world(zm); Bt.need = 0.5;                                      // the point 24.2 V
  Bt.frame(24.0, { boot_id: "a" }); Bt.frame(23.9, { boot_id: "a", behavior: "goto" });   // sent; her change stands
  const stoodA = Bt.sent.length === 1;
  Bt.frame(23.9, { boot_id: "b", behavior: "goto" }); Bt.frame(23.8, { boot_id: "b", behavior: "goto" });
  const Bd = world(zm); Bd.need = 0.5;                                      // said while disarmed on boat a: said again on b
  Bd.frame(24.0, { boot_id: "a", armed: false }); Bd.frame(23.9, { boot_id: "b", armed: false });
  check("8p. A NEW LINK IS A NEW WATCH: answered on one boat (sent, and the operator's change standing), a NEW boot_id "
        + "below her point is answered again, once; said while disarmed on one, it is said again on the next",
        () => stoodA && Bt.sent.length === 2 && Bt.banners.length === 2 && Bd.banners.length === 2 && Bd.sent.length === 0,
        () => JSON.stringify({ stoodA, sent: Bt.sent.length, banners: Bt.banners.length, disarmedSaid: Bd.banners.length }));
  // 8q (2026-11-10 review). A CROSSING SAID RE-ARMS AS ONE ACTED ON DOES. Said where she could not be sent - in a window
  // that does not supervise, or disarmed at the dock - the crossing was never re-armed (only `acted` re-armed), so the
  // page's "already said" swallowed her NEXT alert: a second crossing, and out of range the 20% reserve alert, which is
  // the monitor's whole answer there.
  const Qv = world(); Qv.sup = false;
  Qv.frame(60); Qv.frame(100); Qv.frame(60.5);                 // said in a viewer; up 2% above the point; the point again
  const Qd = world();
  Qd.frame(45, { armed: false }); Qd.frame(250, { armed: false });   // low and disarmed at the dock, said; refueled
  Qd.far = 900000; Qd.frame(55); Qd.frame(49.9);                     // the next trip: home out of range, down to 20%
  const Qc = world(); Qc.sup = false; Qc.frame(60); Qc.frame(62); Qc.frame(59);   // no re-arm without the 2% rise
  check("8q. A CROSSING SAID RE-ARMS LIKE ONE ACTED ON: said in a window that does not supervise, then back above the "
        + "point by 2%, the next crossing is said again; said disarmed at the dock, refueled, then out of range, the 20% "
        + "RESERVE alert is said; and with no rise, nothing is said twice",
        () => Qv.banners.length === 2 && Qv.sent.length === 0
              && Qd.banners.length === 2 && /DISARMED/.test(Qd.banners[0]) && /AT THE 20% RESERVE/.test(Qd.banners[1]) && Qd.sent.length === 0
              && Qc.banners.length === 1,
        () => JSON.stringify({ viewer: Qv.banners.length, dock: Qd.banners.map((t) => t.slice(0, 50)), noRise: Qc.banners.length }));
  // 8r (2026-11-10 review). A LOW-FUEL RTH NOT TAKEN FOR A REASON THE DECISION ITSELF GATES IS NOT AN ANSWER. The latch
  // is set at the ask and doRTH routes for seconds: refused because she was disarmed meanwhile, or never sent because
  // this window lost the post meanwhile, it left her below her point with nothing sent - for good. Now the next frame
  // decides again: nothing while she cannot be sent, sent the frame she can be. A refusal that would only repeat (no
  // link) keeps the latch, and one TAKEN keeps it (the operator's change after it stands).
  const notTaken = (o) => ({ notTaken: Object.assign({ ok: false, sent: true, refused: false }, o) });
  const Ra = world(); Ra.hang = true; Ra.S.armed = true; Ra.frame(60);
  Ra.S.armed = false; Ra.outcome = notTaken({ refused: true, error: "ARM before commanding the boat" }); Ra.land();
  Ra.frame(59.9, { armed: false }); const raHeld = Ra.sent.length === 1 && Ra.banners.length === 1;
  Ra.S.armed = true; Ra.frame(59.8);
  const Rb = world(); Rb.hang = true; Rb.S.armed = true; Rb.frame(60);
  Rb.outcome = notTaken({ sent: false, error: "this tab is VIEW ONLY" }); Rb.sup = false; Rb.land();
  Rb.frame(59.9); const rbHeld = Rb.sent.length === 1 && Rb.banners.length === 1;
  Rb.sup = true; Rb.frame(59.8);
  const Rc = world(); Rc.hang = true; Rc.S.armed = true; Rc.S.estop = false; Rc.frame(60);
  Rc.outcome = notTaken({ refused: true, error: "not connected" }); Rc.land(); Rc.frame(59.9); Rc.frame(59.8);
  const Rd = world(); Rd.hang = true; Rd.S.armed = true; Rd.frame(60); Rd.land(); Rd.frame(59.9, { behavior: "goto" });
  check("8r. A LOW-FUEL RTH REFUSED BECAUSE SHE WAS DISARMED while it was routed: nothing more while she is disarmed "
        + "(and nothing said twice), SENT the frame she is armed; one NEVER SENT (the post passed to another tab): sent when "
        + "this window supervises again; refused for another reason (no link) or TAKEN: not sent again",
        () => raHeld && Ra.sent.length === 2 && Ra.banners.length === 2 && /Returning home now/.test(Ra.banners[1])
              && rbHeld && Rb.sent.length === 2 && Rc.sent.length === 1 && Rd.sent.length === 1,
        () => JSON.stringify({ disarmed: [raHeld, Ra.sent.length], viewOnly: [rbHeld, Rb.sent.length], noLink: Rc.sent.length, taken: Rd.sent.length }));
  // 8s (2026-11-10 review). JUDGED AT THE FRAME'S OWN FIX. onState moves `asv` after it calls fuelTick, so the first frame
  // of a new link was judged where the OLD boat was (a battery hull spawned out of a full pack's reach of it read
  // "reached" on a full pack at home). The frame's fix when it carries one; `asv` when it does not.
  const Sx = world();
  Sx.frame(70, { status: { fuel_l: 70, lat_deg: 43.5, lon_deg: -70.25 } }); const atFix = Sx.at;
  Sx.frame(70); const atAsv = Sx.at;
  check("8s. EACH FRAME IS JUDGED AT ITS OWN FIX (the fuel home asked from the frame's lat/lon), and at the page's last "
        + "position only when the frame carries none",
        () => atFix && atFix.lat === 43.5 && atFix.lon === -70.25 && atAsv && atAsv.lat === 0.01 && atAsv.lon === 0,
        () => JSON.stringify({ atFix, atAsv }));
  // 8t (2026-11-10 verify round). NOTHING WITHOUT A POSITION OF THE PAGE'S OWN. 8s's fix let a page's FIRST frame (`asv`
  // still null) decide off the frame's fix - and doRTH, which reads `asv`, posted a bare RTH with no route: a straight
  // line home. With no `asv` nothing is decided; the next frame, with one, sends the routed RTH.
  const Tn = world(); Tn.api.setAsv(null);
  Tn.frame(60, { status: { fuel_l: 60, lat_deg: 0.01, lon_deg: 0 } }); const firstFrame = Tn.sent.length + Tn.banners.length;
  Tn.api.setAsv({ lat: 0.01, lon: 0 }); Tn.frame(59.9, { status: { fuel_l: 59.9, lat_deg: 0.01, lon_deg: 0 } });
  check("8t. A PAGE WITH NO POSITION OF ITS OWN DECIDES NOTHING (its first frame, `asv` null - doRTH would post a bare, "
        + "unrouted RTH): nothing said or sent on it, and the next frame, with one, sends her home",
        () => firstFrame === 0 && Tn.sent.length === 1 && Tn.banners.length === 1,
        () => JSON.stringify({ firstFrame, sent: Tn.sent.length, banners: Tn.banners.length }));
  // 8u (2026-11-10 verify round). THE REFUSAL JUDGED ON THE CONSOLE'S OWN STATE, AND WHICH STOP WITHDREW IT. The page's
  // S is a frame old: a 409 "ARM" back before the frame showing her disarmed kept the latch (S.armed still true). And a
  // plan withdrawn by an E-STOP pressed in this window is the E-STOP's case (sent the frame she can be); by a Stop it
  // stands - the operator's change.
  const Ua = world(); Ua.hang = true; Ua.S.armed = true; Ua.S.estop = false; Ua.frame(60);
  Ua.outcome = notTaken({ refused: true, error: "ARM before commanding the boat", state: { armed: false, estop: false } });
  Ua.land(); Ua.frame(59.9, { armed: false }); const uaHeld = Ua.sent.length === 1; Ua.frame(59.8);
  const Ub = world(); Ub.hang = true; Ub.frame(60);
  Ub.outcome = { notTaken: { withdrawn: true, by: "E-STOP" } }; Ub.land();
  Ub.frame(59.9, { estop: true }); const ubHeld = Ub.sent.length === 1; Ub.frame(59.8);
  const Uc = world(); Uc.hang = true; Uc.frame(60);
  Uc.outcome = { notTaken: { withdrawn: true, by: "STOP" } }; Uc.land(); Uc.frame(59.9, { behavior: "idle" }); Uc.frame(59.8, { behavior: "idle" });
  check("8u. A REFUSAL IS JUDGED ON THE CONSOLE'S OWN STATE (refused disarmed with the page's S still armed: dropped, sent "
        + "the frame she is armed); WITHDRAWN BY AN E-STOP pressed here: sent the frame she is out of it; withdrawn by a "
        + "STOP: it stands",
        () => uaHeld && Ua.sent.length === 2 && ubHeld && Ub.sent.length === 2 && Uc.sent.length === 1,
        () => JSON.stringify({ consoleState: [uaHeld, Ua.sent.length], estop: [ubHeld, Ub.sent.length], stop: Uc.sent.length }));
  // ── ONE LOW-FUEL RTH IN FLIGHT (2026-11-10, from the recording of 2026-11-08: 20 sent in 26 s, each queueing its own
  // route, with her level pinned at the point). doRTH takes seconds before its RTH lands; a latch re-armed meanwhile -
  // the point dips and comes back, here by the fuel home going 11 -> 5 -> 11 L (the point 61 -> 55 -> 61, the re-arm
  // line 60) - was answered with another doRTH. This world's RTH stays in flight until the check lands it.
  const dip = (w, lv) => { w.need = 5; w.frame(lv, { behavior: "goto" }); w.need = 11; };
  const Fl = world(); Fl.hang = true;
  Fl.frame(60.9, { behavior: "goto" });                       // the crossing: sent, and in flight
  const first = Fl.sent.length === 1 && Fl.api.flight() === Fl.clock;
  dip(Fl, 60.8); const rearmed = !Fl.api.latch().acted;       // re-armed while it is in flight
  Fl.frame(60.7, { behavior: "goto" });                       // the point again: NOT another RTH beside the one in flight
  dip(Fl, 60.6); Fl.frame(60.5, { behavior: "goto" });        // ... nor the next time
  const held = Fl.sent.length === 1 && Fl.banners.length === 1 && Fl.logs.length === 1;
  Fl.land();                                                  // it settles WITHOUT her going home (refused, or lost)
  const landed = Fl.api.flight() === 0;
  Fl.frame(60.45, { behavior: "goto" });                      // the crossing it held back is answered now, at once
  const retried = Fl.sent.length === 2 && Fl.banners.length === 2;
  // ... and when the one in flight LANDS - she is going home - that answers the crossing it held: nothing more is
  // sent, and the operator's change after it stands
  const Fg = world(); Fg.hang = true;
  Fg.frame(60.9, { behavior: "goto" }); dip(Fg, 60.8); Fg.frame(60.7, { behavior: "goto" });
  const notCounted = !Fg.api.latch().acted;                   // held back, and not counted as answered
  Fg.land(); Fg.frame(60.6, { behavior: "rth" });
  const answeredByIt = Fg.api.latch().acted && Fg.sent.length === 1;
  Fg.frame(60.5, { behavior: "goto" });
  // ... and a flight that never settles is not the monitor off for good: past FUEL_FLIGHT_MS the next crossing is sent
  const Fh = world(); Fh.hang = true;
  Fh.frame(60.9, { behavior: "goto" }); dip(Fh, 60.8);
  const landFirst = Fh.land;
  Fh.clock += FLIGHT_MS - 1; Fh.frame(60.7, { behavior: "goto" });
  const stillHeld = Fh.sent.length === 1;
  dip(Fh, 60.6); Fh.clock += 2; Fh.frame(60.5, { behavior: "goto" });
  // ... and the first, landing late, does not take down the mark of the one sent after it
  const second = Fh.api.flight(); landFirst();
  const secondStands = second === Fh.clock && Fh.api.flight() === second;
  check("8m. ONE LOW-FUEL RTH IN FLIGHT: while the RTH she was sent is still being routed, a latch re-armed and a point "
        + "reached again send NO second one (no banner, no log either) - it sent 20 in 26 s on 2026-11-08. The crossing it "
        + "holds back is not counted as answered: when the one in flight settles WITHOUT her going home (refused, lost) the "
        + "next frame sends; when it lands, she is going home and that answers it - nothing more sent, and the operator's "
        + "change after it stands. One that never settles stops holding after FUEL_FLIGHT_MS (" + (FLIGHT_MS / 1000)
        + " s), so the monitor is never off for good; and landing late, it leaves the next one's mark",
        () => FLIGHT_MS >= 30000 && first && rearmed && held && landed && retried && notCounted && answeredByIt
              && Fg.sent.length === 1 && stillHeld && Fh.sent.length === 2 && secondStands,
        () => JSON.stringify({ first, rearmed, held, landed, retried, heldNotCounted: notCounted, answeredByLanding: answeredByIt,
                               sentAfterHerChange: Fg.sent.length,
                               neverSettles: { held: stillHeld, sentPastTheBound: Fh.sent.length, secondStands } }));
}

// ── 9. THE WIRING ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const PROJ = grab("fuelProjection"), TICK = grab("fuelTick"), NEED = grab("fuelHomeNeed"), BUILD = grab("homeFieldTick");
  const WATCH = grab("fuelWatchAt");
  check("9. ONE ESTIMATE OF THE WAY HOME AND ONE ANSWER TO 'IN RANGE': the monitor and every step of the card's projection "
        + "both ask fuelWatchAt - fuelHomeNeed (water distance at the TRANSIT speed: an RTH flies the transit role) and "
        + "rthTooFar, the test doRTH refuses a return by - so the card cannot promise a mission the monitor will cut short, "
        + "and the monitor cannot send an RTH doRTH would refuse; out of range a step's level is the reserve itself",
        () => /fuelWatchAt\(model, fix\)/.test(TICK)
              && /const fix = !asv \? null : st\.lat_deg != null && st\.lon_deg != null \? \{lat: st\.lat_deg, lon: st\.lon_deg\} : \{lat: asv\.lat, lon: asv\.lon\};/.test(TICK)
              && /fuelWatchAt\(model, fr\.fromEN\(q\.e, q\.n\)\)/.test(PROJ)
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
  // (2026-11-10: `proj` the projection the card is handed - none before 9h - and `mdl` the hull; the Fuel row is returned too)
  const run = (N, proj, mdl) => {
    const els = {}, $ = (s) => (els[s] = els[s] || { className: "vv", text: "", tip: "" });
    const api = mk($, () => mdl || model, (e, t) => { e.text = t; }, (e, t) => { e.tip = t; }, () => proj || null, (m, x) => x.toFixed(1) + " L",
      (m, x) => Math.round(100 * (x - m.floor) / (m.full - m.floor)), (s) => s + " s", (m) => (m / 1000).toFixed(1) + " km",
      () => "the sentence", { home: { lat: 0, lon: 0 }, behavior: "survey" }, RTH_MAX, F.FUEL_RESERVE_FRAC, N);
    api.rows();
    const r = $("#mi_rthpt"), fr = $("#mi_fuel");
    return { label: $("#mi_rthpt_k").text, row: r.text, cls: r.className, tip: r.tip, pill: api.pill(),
             fuel: fr.text, fuelCls: fr.className, fuelTip: fr.tip };
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
  // ── 9h. UNDER THE ENERGY OVERRIDE BOTH ROWS AND THE PILL SAY SO (2026-11-10). One sentence said it, at the END of the
  // tip after the burn law's source line, while the rows above it read "REACHED · RTH due" (critical), "reached in
  // 2 nm" (warn) and "left (-36%)" (critical) off a full tank that is not hers. The monitor's word is `override` (8k):
  // her level is not read (null), so what the plan TAKES is shown and what is LEFT is not.
  const O = { model, level: null, rth: inr.level, h: hNear, w: { ...inr, h: hNear, farM: null }, state: "override", override: true };
  const plan = { legs: 3, used: 20, seconds: 100, levelEnd: null, turn: null, home: null };
  // a projection a frame stale - walked while the forced-full gauge still read as a level: its "left" and "reached in"
  const stale = { legs: 3, used: 20, seconds: 100, levelEnd: -90, turn: { alongM: 2000, idx: 4 }, home: null };
  const oPlan = run(O, plan), oStale = run(O, stale), oNone = run(O, null);
  const zv = vessel("zboat_1800hs"), zm = F.energyModel(zv, zv.propulsion.speeds_kn.high);
  const hZ = { need: 2.9, m: 6400, water: true, twKn: 6 }, zw = F.fuelWatch(zm, 2.9, null);
  const oBatt = run({ model: zm, level: null, rth: zw.level, h: hZ, w: { ...zw, h: hZ, farM: null }, state: "override", override: true }, null, zm);
  const ctl = run({ ...O, level: 250, state: "ok", override: false }, { ...plan, levelEnd: 230 });   // the same card, the override off
  check("9h. UNDER THE ENERGY OVERRIDE the RTH row reads NOT MONITORED (amber, never REACHED / RTH due / reached in), "
        + "the Fuel row what the plan takes and 'override on' with nothing 'left' (plain, never amber or red off a level "
        + "that is not hers - a stale projection included), both tips LEAD with the override and what it turns off, the "
        + "pill's line says not monitored; where a battery's point is above a full pack the tip says what turning it off "
        + "does; the override off, the same card reads its figures; and the rehearsal row is gated off under it",
        () => [oPlan, oStale, oNone].every((x) => x.row === "NOT MONITORED · override on" && x.cls === "vv warn" && x.label === "RTH point"
                 && /^THE ENERGY OVERRIDE IS ON: /.test(x.tip) && /NOTHING IS MONITORED - no low-fuel alert and no automatic RTH/.test(x.tip)
                 && /^\nRTH point: NOT MONITORED while the energy override is on/.test(x.pill))
              && [oPlan, oStale].every((x) => x.fuel === "~20.0 L · override on" && x.fuelCls === "vv" && !/left|at home/.test(x.fuel)
                 && /THE ENERGY OVERRIDE IS ON: /.test(x.fuelTip) && /What is left is not shown/.test(x.fuelTip))
              && oNone.fuel === "override on · no plan"
              && /With the override off the RTH point here is 61\.0 L/.test(oPlan.tip) && !/ABOVE a full/.test(oPlan.tip)
              && /ABOVE a full pack: turning the override off here raises the low-battery alert at once/.test(oBatt.tip)
              && /until the BATT pill is clicked again/.test(oBatt.tip) && /until the FUEL pill is clicked again/.test(oPlan.tip)
              && ctl.row === "61.0 L · 189.0 L above" && /left/.test(ctl.fuel) && !/OVERRIDE/.test(ctl.tip + ctl.fuelTip + ctl.pill)
              && /cmGate\("#cmFuelRth",\s+canSpawn\(\) && !!\(fuelNow && fuelNow\.rth != null && !fuelNow\.override\),/.test(H)
              && /\(fuelNow && fuelNow\.override\) \? "override on" : "no RTH point"/.test(H),
        () => JSON.stringify({ plan: [oPlan.row, oPlan.cls, oPlan.fuel, oPlan.fuelCls], stale: [oStale.row, oStale.fuel, oStale.fuelCls],
                               none: oNone.fuel, pill: oPlan.pill.slice(0, 70), batt: (oBatt.tip.match(/With the override off[^\n]*/) || [""])[0].slice(0, 200),
                               ctl: [ctl.row, ctl.fuel] }));
  // 9j (2026-11-10 review). THE OVERRIDE'S ROW IN THE STATES 9h DID NOT HAVE: home by the straight line (no "straight
  // line" tag - nothing is measured - and nothing amber off it); home OUT OF RANGE (no "the RTH point here is" - there is
  // no RTH point, only the alert); and a battery hull past the 50 km a return is routed, where turning it off raises the
  // alert but the RTH is REFUSED - the tip said "sends her home if she is armed".
  const oLine = run({ ...O, h: { ...hNear, water: false }, w: { ...inr, h: { ...hNear, water: false }, farM: null } }, plan);
  const oFar = run({ model, level: null, rth: far.level, h: hFar, w: { ...far, h: hFar, farM: 900000 }, state: "override", override: true }, plan);
  const hZfar = { need: 5, m: 80000, water: true, twKn: 6 }, zf = F.fuelWatch(zm, 5, 80000);
  const oBfar = run({ model: zm, level: null, rth: zf.level, h: hZfar, w: { ...zf, h: hZfar, farM: 80000 }, state: "override", override: true }, null, zm);
  check("9j. ... and in the states 9h had not: home by the straight line (no 'straight line', amber only for the override), "
        + "home out of range (the alert's own words, no RTH point offered), and a battery hull past 50 km (the tip says the "
        + "RTH is REFUSED, not that she is sent home; inside 50 km it still says she is)",
        () => oLine.row === "NOT MONITORED · override on" && oLine.cls === "vv warn"
              && oFar.row === "NOT MONITORED · override on" && /^THE ENERGY OVERRIDE IS ON: /.test(oFar.tip) && !/RTH point here is/.test(oFar.tip)
              && zf.mode === "rth" && zf.level >= zm.full
              && /turning the override off here raises the low-battery alert at once, and the RTH is REFUSED - home is 80\.0 km away, past the 50\.0 km the console will route a return: Set Home where she is\./.test(oBfar.tip)
              && !/sends her home/.test(oBfar.tip) && /alert at once, and sends her home if she is armed\./.test(oBatt.tip),
        () => JSON.stringify({ line: [oLine.row, oLine.cls], far: (oFar.tip.match(/RTH point here[^\n]*/) || ["(none)"])[0].slice(0, 80),
                               bfar: (oBfar.tip.match(/turning the override off[^\n]*/) || [""])[0].slice(0, 200) }));
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
      "const fmtDist = (x) => (x / 1000).toFixed(1) + ' km', fuelFmt = w.fuelFmt || ((md, x) => x.toFixed(1) + ' L');",
      "const fmtVol = w.fmtVol || ((x, d) => x.toFixed(1) + ' L');",   // the SHORT sentence's tenths (10h hands the real one)
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
  // 10g (2026-11-10). WHAT SHE ARRIVES WITH IS RECKONED, NOT ASSERTED. The sentence ended "which leaves the 50 L reserve
  // ... on arrival" whatever her level - true only AT the point. Live, on the frame the energy override went off: a pack
  // at 21.31 V, already under its 23 V alarm, with home taking 0.99 V, "leaves the 0.70 V reserve on arrival". The DriX's
  // point with home 11 L away is 61 L (reserve 50); the page's own fuelSay (this world's fuelFmt prints every level as L).
  const hS = { need: 11, m: 5000, water: true, twKn: 7 };
  const sAt = Pc.fuelSay(m, 61, 61, hS), sRound = Pc.fuelSay(m, 60.5, 61, hS);            // at it, and a gauge's rounding below
  const sShort = Pc.fuelSay(m, 40, 61, hS), sNone = Pc.fuelSay(m, 8, 61, hS);            // arrives with 29 L; cannot arrive
  const zv = vessel("zboat_1800hs"), zm = F.energyModel(zv, zv.propulsion.speeds_kn.high);
  const hB = { need: 0.99, m: 2311, water: true, twKn: 6 }, pB = F.rthLevel(zm, 0.99);    // the live frame: the point 24.69 V
  const sLive = Pc.fuelSay(zm, 21.31, pB, hB), sBshort = Pc.fuelSay(zm, 24.3, pB, hB), sBat = Pc.fuelSay(zm, pB, pB, hB);
  check("10g. THE SENTENCE RECKONS WHAT SHE ARRIVES WITH: at the point (and within a gauge's rounding of it) 'which leaves "
        + "the reserve on arrival', as before; below it, what is left on arrival and that it is SHORT of the reserve; and "
        + "where home takes more than she has (a pack already under its alarm: the live frame, 21.31 V) it says so - never "
        + "the reserve she will not have",
        () => / and takes 11\.0 L at 7 kn, which leaves the 50\.0 L reserve \(20% of the tank\) on arrival\.$/.test(sAt) && sRound.slice(sRound.indexOf(";")) === sAt.slice(sAt.indexOf(";"))
              && / at 7 kn, which leaves 29\.0 L on arrival - SHORT of the 50\.0 L reserve \(20% of the tank\)\.$/.test(sShort)
              && / at 7 kn - MORE THAN SHE HAS aboard\.$/.test(sNone) && !/reserve/.test(sNone)
              && / at 6 kn - MORE THAN SHE HAS above the pack's 23 V alarm\.$/.test(sLive) && !/which leaves/.test(sLive)
              && /, which leaves 23\.3 L on arrival, 0\.3 L above its alarm - SHORT of the 0\.7 L reserve \(20% of the pack above its 23 V alarm\)\.$/.test(sBshort)
              && !/above its alarm/.test(sShort)
              && /which leaves the 0\.7 L reserve \(20% of the pack above its 23 V alarm\) on arrival\.$/.test(sBat),
        () => JSON.stringify([sAt.slice(-70), sShort.slice(-75), sNone.slice(-40), sLive.slice(-60), sBshort.slice(-80)]));
  // 10h (2026-11-10 review). THE SHORT SENTENCE IN GALLONS, to a tenth: the card writes whole gallons from 10 up, so 48 L
  // on arrival beside the 50 L reserve read "leaves 13 gal on arrival - SHORT of the 13 gal reserve". The real units.js.
  const U = require("../static/js/units.js");
  U.setDistUnit("nm");
  const Psae = page({ fmtVol: U.fmtVol, fuelFmt: (md, x) => U.fmtVol(x) });
  const sSae = Psae.fuelSay(m, 59, 61, hS);                                               // 59 - 11 = 48 L on arrival
  U.setDistUnit("km");
  check("10h. ... and in GALLONS its shortfall to a tenth (12.7 gal on arrival, SHORT of the 13.2 gal reserve), never two "
        + "equal whole numbers",
        () => /which leaves 12\.7 gal on arrival - SHORT of the 13\.2 gal reserve \(20% of the tank\)\.$/.test(sSae),
        () => sSae.slice(-90));
}

// ── 11. THE COARSE HOME FIELD (2026-10-12, Andy: "build the coarse home field") ──────────────────────────────────────
// Past the field round home, with no passage leading home, the distance home was the straight line - short wherever
// land is in the way, so the RTH point came late. coarse.js coarseHomeField searches outward from home over the tiles'
// planning grids at the coarse planner's own costs; the page reads the chart along the way home with its grids and
// builds it in the coarse worker. Over synthetic grids, against distances worked by hand; the page's own functions
// with the console, the corridor read and the worker stubbed.
(async () => {
  // ── 9f. THE REHEARSAL ROW ASKS FIRST WHILE SHE IS UNDER WAY (Andy, 2026-10-16 live: "clearing the target vessel deleted
  //        the transit to the survey area sending the ASV home"). The row sat under "Clear test contacts"; a click meant
  //        for that one set the fuel and the monitor sent her home mid-survey. The page's own setFuelToRthPoint, driven.
  {
    const mk = (S, N, answer) => {
      const w = { asked: [], sent: [], notes: [] };
      const run = new Function("S", "fuelNow", "canSpawn", "guiConfirm", "cmd", "took", "flashNote", "fuelFmt",
        "return async " + grab("setFuelToRthPoint") + ";")(S, N, () => true,
        (t, m, o) => { w.asked.push({ t, m, always: !!(o && o.always) }); return Promise.resolve(answer); },
        (path, body) => { w.sent.push([path, body]); return Promise.resolve({ ok: true }); }, (r) => !!(r && r.ok),
        (t) => w.notes.push(t), (m, x) => x.toFixed(1) + " L");
      return { run, w };
    };
    const N = { model: { kind: "fuel", full: 250, floor: 0 }, rth: 50.13, level: 120, w: { mode: "rth" } };
    const UNDER_WAY = { armed: true, run: "running", behavior: "survey" };
    const no = mk(UNDER_WAY, N, false), yes = mk(UNDER_WAY, N, true);
    const idle = mk({ armed: true, run: "idle" }, N, false), paused = mk({ armed: true, run: "paused" }, N, false);
    const disarmed = mk({ armed: false, run: "running" }, N, false), alert = mk(UNDER_WAY, { ...N, w: { mode: "alert" } }, false);
    for (const x of [no, yes, idle, paused, disarmed, alert]) await x.run();
    const label = new Function(grab("cmdLabel") + "\nreturn cmdLabel;")();
    const apart = /<div class="cmsep"><\/div>\s*<div class="cmi" id="cmFuelRth">/.test(H);
    check("9f. ⚠ THE FUEL REHEARSAL ASKS FIRST WHILE SHE IS UNDER WAY (2026-10-16 live: a click meant for 'Clear test contacts' "
          + "set it and the monitor sent her home mid-survey): armed and running it asks - in the simulator too (always) - "
          + "saying it sends her home; a no sends nothing and says so, a yes sets it; idle, paused, disarmed, or with home "
          + "out of range (an alert, no RTH) it acts at once as built; the history names it, not 'Unlimited energy off'; "
          + "and a separator sets it apart from the test-contact rows",
          () => no.w.asked.length === 1 && no.w.asked[0].always && /sends her HOME/.test(no.w.asked[0].m) && no.w.sent.length === 0
                && /not set/.test(no.w.notes[0] || "")
                && yes.w.asked.length === 1 && yes.w.sent.length === 1 && yes.w.sent[0][0] === "/api/cmd/energy"
                && [idle, paused, disarmed, alert].every(x => x.w.asked.length === 0 && x.w.sent.length === 1)
                && label("/api/cmd/energy", { level: 49.6 }) === "Sim energy set (rehearsal)"
                && label("/api/cmd/energy", { unlimited: true }) === "Unlimited energy on"
                && label("/api/cmd/energy", { unlimited: false }) === "Unlimited energy off" && apart,
          () => JSON.stringify({ no: no.w, yes: { asked: yes.w.asked.length, sent: yes.w.sent.length },
                                 acts: [idle, paused, disarmed, alert].map(x => [x.w.asked.length, x.w.sent.length]),
                                 label: label("/api/cmd/energy", { level: 49.6 }), apart }));
    // 9f2 (2026-11-10). Under the energy override the console refuses a level (it reports full whatever is set): the row
    // said so only AFTER asking whether to send her home. Now before, and nothing is asked or sent.
    const ovrRun = mk(UNDER_WAY, { ...N, override: true }, true), ovrIdle = mk({ armed: true, run: "idle" }, { ...N, override: true }, true);
    await ovrRun.run(); await ovrIdle.run();
    check("9f2. ... and UNDER THE ENERGY OVERRIDE the rehearsal asks nothing and sends nothing - it says to turn the "
          + "override off first, under way or idle",
          () => [ovrRun, ovrIdle].every((x) => x.w.asked.length === 0 && x.w.sent.length === 0 && /energy override off first/.test(x.w.notes[0] || "")),
          () => JSON.stringify([ovrRun.w, ovrIdle.w]));
  }

  // ── 9i. THE ENERGY PILL SAYS WHAT THE CONSOLE ANSWERED, AFTER IT ANSWERED, ONE CLICK AT A TIME (2026-11-10). The page's
  //        own click handler, lifted by its text. It flashed "Energy override ON" beside a command it had not awaited:
  //        in a view-only window nothing was sent and that note replaced the refusal (and went into the history as done).
  {
    const src = (H.match(/\$\("#battPill"\)\.onclick = (async \(\)=>\{[\s\S]*?\r?\n\});/) || [])[1];
    if (!src) throw new Error("the energy pill's click handler was not found in the page (renamed, or no longer async?)");
    // every post waits for an answer of its OWN (w.answer(r) gives the oldest one waiting its reply; w.answerAll(r) every
    // one): with one resolver for the lot, a handler that sent three left two awaits unsettled and the suite stopped
    // there, exit 0 - the mutant that found the floor above
    const mk = (on0) => {
      const w = { sent: [], notes: [], waiting: [], S: { status: { unlimited_energy: on0 } } };
      w.answer = (r) => { const res = w.waiting.shift(); if (res) res(r); };
      w.answerAll = (r) => { while (w.waiting.length) w.answer(r); };
      w.click = new Function("S", "cmd", "took", "flashNote", "let energyBusy = false;\nreturn " + src + ";")(w.S,
        (path, body) => { w.sent.push([path, body]); return new Promise((res) => { w.waiting.push(res); }); },
        (r) => !!(r && r.ok), (t) => w.notes.push(t));
      return w;
    };
    const ok = (on) => ({ ok: true, state: { status: { unlimited_energy: on } } });
    // ON, taken: one post, and the note only once the console has answered
    const a = mk(false); const pa = a.click(); const early = a.notes.length;
    a.answer(ok(true)); await pa;
    // two more clicks before the answer: ONE post (S moves only with the stream - a second read the same value)
    const b = mk(false); const pb1 = b.click(), pb2 = b.click(), pb3 = b.click();
    const oneFlight = b.sent.length; b.answerAll(ok(true)); await Promise.all([pb1, pb2, pb3]);
    b.S.status.unlimited_energy = true; const pb4 = b.click(); b.answer(ok(false)); await pb4;       // free again: OFF goes
    // never sent (a view-only window), refused, lost: cmd() has said why, and the handler says NOTHING
    const c = mk(false); const pc = c.click(); c.answer({ ok: false, error: "this tab is VIEW ONLY", sent: false, refused: false }); await pc;
    const d = mk(true); const pd = d.click(); d.answer({ ok: false, error: "no answer", sent: true, refused: false }); await pd;
    const freed = (() => { const p = d.click(); const n = d.sent.length; d.answer(ok(false)); return p.then(() => n); })();
    const dSent = await freed;
    // the note is the ANSWER's state, not the request's: asked ON, the console answers that it is off
    const e = mk(false); const pe = e.click(); e.answer(ok(false)); await pe;
    check("9i. THE ENERGY PILL'S CLICK is awaited and one at a time: it posts {unlimited: the opposite of the state}, says "
          + "nothing until the console answers, then says what the ANSWER's state is - ON with 'the low-fuel monitor is "
          + "OFF', OFF with 'no longer held off' (never 'is watching': it may have nothing to watch); three clicks before the answer are ONE post; a command never sent, refused or "
          + "lost is left to cmd()'s own words (no 'Energy override ON' over a refusal), and the pill is free again after it",
          () => a.sent.length === 1 && a.sent[0][0] === "/api/cmd/energy" && a.sent[0][1].unlimited === true && early === 0
                && a.notes.length === 1 && /^Energy override ON — .*low-fuel monitor is OFF/.test(a.notes[0])
                && oneFlight === 1 && b.sent.length === 2 && b.sent[1][1].unlimited === false && b.notes.length === 2
                && /^Energy override OFF — .*monitor is no longer held off \(the card's RTH point row says what it watches\)\.$/.test(b.notes[1]) && !/watching/.test(b.notes[1])
                && c.sent.length === 1 && c.notes.length === 0 && d.notes.length === 1 && dSent === 2 && /^Energy override OFF/.test(d.notes[0])
                && e.notes.length === 1 && /^Energy override OFF/.test(e.notes[0]),
          () => JSON.stringify({ a: [a.sent, early, a.notes], b: [oneFlight, b.sent.length, b.notes.length], c: c.notes, d: [dSent, d.notes], e: e.notes }));
  }

  // ── 9g. THE CARD'S WALK OF THE MISSION, EVERY 10 S NOT EVERY SECOND (2026-10-17, measured ~100 ms of the page's thread
  //        a walk, every second, the whole run). The page's own fuelProjection, driven on a clock of the check's own.
  {
    const decl = (re) => { const m = H.match(re); if (!m) throw new Error("not found: " + re); return m[0]; };
    let clock = 0, walks = 0, level = 200, idx = 3, route = [{ lat: 43, lon: -70 }, { lat: 43.01, lon: -70 }, { lat: 43.02, lon: -70 }];
    const model = { kind: "fuel", full: 250, floor: 0 };
    const mk = new Function("Date", "fuelModel", "asv", "indexedRoute", "window", "S", "energyLevel", "planeFrame", "groundVel",
      "runLegKeys", "V", "roleSpeed", "speedRole", "projectMission", "fuelWatchAt", "endAction", "fuelHomeNeed",
      decl(/^const FUEL_PROJECT_MS = [^;]*;/m) + "\n"
      + (H.match(/^const FUEL_PROJECT_JUMP = [^;]*;/m) || ["const FUEL_PROJECT_JUMP = 0.01;"])[0] + "\n"   // (a page before it: unused there)
      + decl(/^let fuelProj = [^;]*;/m) + "\n" + grab("fuelProjection") + "\nreturn {P: fuelProjection, MS: FUEL_PROJECT_MS};");
    const api = mk({ now: () => clock }, () => model, { lat: 43, lon: -70 }, () => route, { get _wpIndex(){ return idx; } },
      { status: { fuel_l: 0 } }, () => level, () => ({ toEN: () => ({ e: 0, n: 0 }), fromEN: () => ({ lat: 43, lon: -70 }) }),
      () => null, () => () => null, { SPEED_KN: {} }, () => "7", () => "transit",
      () => { walks++; return { used: 1, seconds: 1 }; }, () => null, () => "loiter", () => null);
    const at = (t) => { clock = t; api.P(); return walks; };
    const w0 = at(0);                                   // first: walked
    const w1 = at(1200);                                // 1.2 s later: kept (it was walked again every second)
    idx = 4; const w2 = at(2500);                       // a new waypoint alone: kept
    level = 199.5; const w3 = at(3000);                 // 0.2% of the tank: kept
    const w4 = at(api.MS + 100);                        // past the interval: walked
    level = 195; const w5 = at(api.MS + 600);           // a jump of 2% of the tank (the rehearsal row, a refuel): at once
    route = route.slice(); const w6 = at(api.MS + 900); // a new plan: at once
    // (2026-11-10) the energy override takes her level away and gives it back: each is walked at once, or the row says
    // what is left of a level it no longer has for up to the interval - and no level, steadily, is not walked every frame
    level = null; const w7 = at(api.MS + 1000);         // the level gone (the override on): at once
    const w8 = at(api.MS + 1100);                       // still none: kept
    level = 195; const w9 = at(api.MS + 1200);          // the level back: at once
    check("9g. THE CARD'S WALK OF THE MISSION IS KEPT FOR " + (api.MS / 1000) + " S (2026-10-17: ~100 ms of the page's thread "
          + "every second, the whole run) - kept 1.2 s on, on a new waypoint alone and on a 0.2% level drift; walked again past "
          + "the interval, and AT ONCE on a level jump of 2% of the tank or a new plan - and when her level goes (the energy "
          + "override) or comes back, though not while it stays away",
          () => api.MS >= 10000 && w0 === 1 && w1 === 1 && w2 === 1 && w3 === 1 && w4 === 2 && w5 === 3 && w6 === 4
                && w7 === 5 && w8 === 5 && w9 === 6,
          () => JSON.stringify({ interval_ms: api.MS, walks: [w0, w1, w2, w3, w4, w5, w6, w7, w8, w9] }));
  }

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
  finished = true;
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("  FAIL 0. the suite itself CRASHED before finishing - " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e)); console.log("\n1 CHECK(S) FAILED (crashed before finishing)"); process.exit(1); });
