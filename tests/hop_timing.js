// tests/hop_timing.js - the TRANSITS in the Lines card: the hop between coverage regions is timed like a turn, the
// approach and the return home are clocked, and the card plans each from the committed route at the transit speed.
//
// Andy, 2026-09-25: "In the line plan card there is data for lines and turns but not transits within a mission. Add
// that feature." Before this, accumLineTime's last branch read `// else: approach / inter-region transit -> neither
// line nor turn`: the boat's time between regions was the one component of a run the card could not account for.
//
// DRIVEN: the page's own accumLineTime, syncLineStats, resetLineStats, isReversalGap, reversalScaleM, turnZoneM,
// nearestEndpointM, buildTurnTable, hopVia, buildHopTable and routeLenM, brace-matched out of static/asv.html, over
// a two-region plan (lines 1-2, then 3-4 six hundred meters north) and a scripted run: approach, line 1, the
// reversal onto line 2, the hop north, line 3, then Return-to-Home. currentLegLine is the one stub - it answers
// what the leg index would, frame by frame.
//   1  the approach is clocked while no line has been run
//   2  the reversal between lines 1 and 2 is a TURN, not a hop - and the turn closes on line 2
//   3  the hop between the regions is a transit record: opened off line 2, clocked every frame, closed by line 3
//   4  buildHopTable: ONE transit (the reversal gaps are not transits), the committed route's meters via the plan's
//      detour point, the plan at the TRANSIT speed, the actual from the clock - and the turn table is unchanged
//   5  the return home is clocked while the RTH runs
//   6  resetLineStats clears every transit record with the lines and turns
//
//   node tests/hop_timing.js      # exit 0 = pass, 1 = fail
// ASV_HTML points this at a SIDECAR copy for a mutation run.
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
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const G = require("../static/js/geodesy.js");

function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond); note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}

// ── the world ─────────────────────────────────────────────────────────────────────────
const REF = { lat: 43.0, lon: -70.0 };
const P = (e, n) => G.fromEN(e, n, REF);
const L = (a, b) => ({ a, b });
const LINES = [L(P(0, 0), P(300, 0)), L(P(300, 20), P(0, 20)),                 // region A
               L(P(0, 600), P(300, 600)), L(P(300, 620), P(0, 620))];          // region B, 600 m north
const VIA = P(150, 300);                                                       // the hop's routed detour point
const WPS = [LINES[0].a, LINES[0].b, LINES[1].a, LINES[1].b, VIA, LINES[2].a, LINES[2].b, LINES[3].a, LINES[3].b];

// eslint-disable-next-line no-new-func
const W = new Function("G", `"use strict";
  const { distTo, azTo, toEN, alignDeg } = G;
  const V = { SPEED_KN: { low: 1.5, survey: 3.0, high: 6.0 } };
  const mission = { lines: [], waypoints: [], arrival_radius_m: 2, speeds: { transit: "high", survey: "survey", turn: "survey" }, speed: "survey" };
  let S = { run: "running", behavior: "survey", status: { sog_kn: 3.0, cog_deg: 90 } };
  let asv = { lat: 43.0, lon: -70.0, hdg: 90 };
  let leg = -1;                                          // what currentLegLine would answer this frame
  const currentLegLine = () => leg;
  let clockNow = 0; const performance = { now: () => clockNow * 1000 };
  let lineActual = [], lineClock = null, loggedLines = false;
  let turnSeg = [], curTurn = -1, lastRunLine = -1, runLineIdx = -1;
  let hopSeg = [], curHop = -1, approachSec = 0, rthSec = 0;
  let lineStatsKey = null;
  let runElapsed = 0, runClock = null, runTotalM = 0, runTotalKey = null, runSeq = null, jobElapsed = 0, jobClock = null, runMotions = 0;
  let runRoute = null; const window = { _wpIndex: 0 };
  ${["lineSetKey", "syncLineStats", "resetLineStats", "resetRunTimer", "indexedRoute", "routeRemainingM", "turnZoneM",
     "nearestEndpointM", "reversalScaleM", "isReversalGap", "accumLineTime", "buildTurnTable", "roleSpeed", "roleSpeedMS",
     "routeLenM", "hopVia", "buildHopTable"].map(n => "__GRAB_" + n + "__").join("\n")}
  return {
    plan: (lines, wps) => { mission.lines = lines; mission.waypoints = wps; resetLineStats(); },
    frame: (o) => { clockNow += 1; if ('leg' in o) leg = o.leg; if (o.at) { asv = { lat: o.at.lat, lon: o.at.lon, hdg: o.hdg != null ? o.hdg : asv.hdg }; }
                    if (o.hdg != null) { asv.hdg = o.hdg; S.status.cog_deg = o.hdg; } if (o.behavior) S.behavior = o.behavior; accumLineTime(); },
    get: () => ({ lineActual: lineActual.slice(), turnSeg: JSON.parse(JSON.stringify(turnSeg)), hopSeg: JSON.parse(JSON.stringify(hopSeg)),
                  curTurn, curHop, approachSec, rthSec, lastRunLine, runLineIdx }),
    hops: () => buildHopTable(), turns: () => buildTurnTable(), reset: () => resetLineStats(),
    reversal: (k) => isReversalGap(k), transitMs: () => roleSpeedMS("transit") };`
  .replace(/__GRAB_(\w+)__/g, (_, n) => grab(n)))(G);

console.log("The transits in the Lines card - the hop between regions, the approach and the return home, clocked and planned:");
W.plan(LINES, WPS);
const on = (line, frac, hdg) => { const a = LINES[line].a, b = LINES[line].b;
  return { lat: a.lat + (b.lat - a.lat) * frac, lon: a.lon + (b.lon - a.lon) * frac, hdg }; };

// 1. THE APPROACH: five frames far from the plan, no line run yet.
for (let i = 0; i < 5; i++) W.frame({ leg: -1, at: P(-400, -300), hdg: 45 });
const g1 = W.get();
check("1. the approach is clocked while no line has been run - four seconds over five frames (the first starts the clock)",
      () => Math.abs(g1.approachSec - 4) < 1e-6 && g1.hopSeg.length === 0 && g1.turnSeg.length === 0 && g1.lastRunLine === -1,
      () => "approach " + g1.approachSec + " s, hops " + g1.hopSeg.length + ", turns " + g1.turnSeg.length);

// 2. LINE 1, THEN THE REVERSAL ONTO LINE 2: near the line end, the next line a reversal away - a TURN, not a hop.
for (let i = 0; i < 10; i++) W.frame({ leg: 0, at: on(0, 0.3 + i * 0.05), hdg: 90 });
for (let i = 0; i < 4; i++) W.frame({ leg: -1, at: P(302, 8 + i * 3), hdg: 0 });
const g2a = W.get();
for (let i = 0; i < 10; i++) W.frame({ leg: 1, at: on(1, 0.2 + i * 0.05), hdg: 270 });
const g2 = W.get();
check("2. the reversal between lines 1 and 2 is a TURN, not a hop - open off line 1, closed by line 2 - and the approach "
      + "clock stopped when line 1 began",
      () => g2a.turnSeg.length === 1 && g2a.curTurn === 0 && Math.abs(g2a.turnSeg[0].sec - 4) < 1e-6 && g2a.hopSeg.length === 0
            && g2.turnSeg[0].to === 1 && g2.curTurn === -1 && Math.abs(g2.lineActual[0] - 10) < 1e-6 && Math.abs(g2.lineActual[1] - 10) < 1e-6
            && Math.abs(g2.approachSec - 4) < 1e-6 && W.reversal(0) === true && W.reversal(1) === false && W.reversal(2) === true,
      () => JSON.stringify({ turns: g2.turnSeg, hops: g2.hopSeg, lines: g2.lineActual, approach: g2.approachSec,
                             reversal: [W.reversal(0), W.reversal(1), W.reversal(2)] }));

// 3. THE HOP NORTH: twenty frames far from any line end, then line 3.
for (let i = 0; i < 20; i++) W.frame({ leg: -1, at: P(150, 100 + i * 20), hdg: 0 });
const g3a = W.get();
for (let i = 0; i < 5; i++) W.frame({ leg: 2, at: on(2, 0.3 + i * 0.05), hdg: 90 });
const g3 = W.get();
check("3. the hop between the regions is a transit record: opened off line 2 the first frame away, clocked every frame "
      + "(20 s), closed by line 3 - and it never became a turn",
      () => g3a.hopSeg.length === 1 && g3a.curHop === 0 && g3a.hopSeg[0].from === 1 && g3a.hopSeg[0].to === -1
            && Math.abs(g3a.hopSeg[0].sec - 20) < 1e-6 && g3a.turnSeg.length === 1
            && g3.hopSeg[0].to === 2 && g3.curHop === -1 && Math.abs(g3.lineActual[2] - 5) < 1e-6 && g3.turnSeg.length === 1,
      () => JSON.stringify({ during: g3a.hopSeg, after: g3.hopSeg, turns: g3.turnSeg.length, line3: g3.lineActual[2] }));

// 4. THE TABLE: one transit, the route via the plan's detour point at the transit speed, the actual from the clock.
const ht = W.hops(), tt = W.turns();
const viaM = G.distTo(LINES[1].b, VIA) + G.distTo(VIA, LINES[2].a);
const planS = Math.round(viaM / W.transitMs());
check("4. buildHopTable: ONE transit (the two reversal gaps are not transits), L2→L3, the committed route's meters through "
      + "the plan's detour point, the plan at the TRANSIT speed (high), the actual 20 s - and the turn table unchanged",
      () => ht.length === 1 && ht[0].from === 2 && ht[0].to === 3 && Math.abs(ht[0].m - viaM) < 1 && ht[0].plan_s === planS
            && ht[0].sec === 20 && planS > 150 && tt.length === 1 && tt[0].from === 1 && tt[0].to === 2 && tt[0].sec === 4,
      () => JSON.stringify({ hops: ht, viaM: Math.round(viaM), planS, turns: tt }));

// 5. THE RETURN HOME is clocked while the RTH runs - not a survey frame, so accumLineTime's survey branch is skipped.
for (let i = 0; i < 8; i++) W.frame({ leg: -1, behavior: "rth", at: P(-100 - i * 30, 300), hdg: 225 });
const g5 = W.get();
check("5. the return home is clocked while the RTH runs (8 s), and the survey records are left as they were",
      () => Math.abs(g5.rthSec - 8) < 1e-6 && g5.hopSeg.length === 1 && Math.abs(g5.hopSeg[0].sec - 20) < 1e-6
            && Math.abs(g5.approachSec - 4) < 1e-6,
      () => "rth " + g5.rthSec + " s; hops " + JSON.stringify(g5.hopSeg) + "; approach " + g5.approachSec);

// 6. THE RESET clears every transit record with the lines and turns.
W.reset();
const g6 = W.get();
check("6. resetLineStats clears the hop records, the open hop, and the approach and RTH clocks with the lines and turns",
      () => g6.hopSeg.length === 0 && g6.curHop === -1 && g6.approachSec === 0 && g6.rthSec === 0 && g6.turnSeg.length === 0
            && g6.lineActual.every((s) => s === 0),
      () => JSON.stringify(g6));

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
