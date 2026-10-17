// tests/gate_endpoint.js - the lane gate's endpoint exemption is about the ENDPOINT.
//
// `gateLegClear` is the law over the Rule 9 lane: no route leaves the lane pipeline without
// passing the same `legClear` the obstacle search obeyed. It carries one deliberate
// exemption - a block within 2·buf of the route's own start or goal is tolerated, because a
// vessel moored inside the buffer must still be led out and an arrival can end at a dock.
//
// ⚠⚠ AND FOR ONE RELEASE THAT EXEMPTION ASKED THE WRONG QUESTION. It tested only whether the
// BLOCK was near an endpoint, which says nothing at all about whether that endpoint is
// anywhere it should not be. Measured at New Castle across 475 Go-To routes from one spawn:
//
//     legPath (the obstacle search) shipped a fouling leg in   0 of 475
//     ONE shipped route passed                            0.47 m from a charted pier
//     ... with the operator's buffer set to                   3 m
//
// The chain was `narrowChannelLane` moving it 3.45 → 2.63 m, `smoothTrack` taking it to
// 0.47 m (it tests whether the moved VERTEX is blocked and never the legs to and from it),
// and then this gate waving it through because the block sat 5.8 m from the goal against a
// 6 m radius. NEITHER ENDPOINT WAS IN THE BUFFER: the destination had 3.45 m of clear water
// round it. Re-measured after the fix, that route ships at 3.45 m - `legPath`'s own figure -
// with the lane intact and one splice.
//
//   node tests/gate_endpoint.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ⚠ THE MOORED-BOAT HALF IS TESTED IN tests/buoy_lane.js 18, and it must stay green: those
// endpoints ARE inside the buffer, which is the whole reason they need leading out of. This
// suite is the other half - the one nothing asked about.
//
// ⚠⚠ AND THE EXEMPTION COVERS THE BLOCKED WATER SHE IS LED OUT OF, NOT THE LEG THAT LEADS HER
// (2026-10-04, 7-11). It was "the FIRST block along the leg is near the blocked endpoint", and
// from a berth inside the buffer the first block along ANY leg out of it is the berth itself:
// the whole leg was waved through, and a review found the chart's lane bending the first leg
// out of a berth past a pile 1.7 m off with a 3 m buffer - and through a 6 x 6 m dolphin. The
// exempt water is now the blocked run contiguous with the endpoint, never nearer what blocks
// it than the endpoint is (less buf/4).
//
// TEETH - mutations RUN against a sidecar copy of routing.js:
//   the exemption drops the endpoint test again (the reported 0.47 m)  -> 2
//   the exemption is dropped entirely (a moored boat is re-routed)     -> 3, 8
//   startIn / goalIn are computed at 2·buf instead of the buffer       -> 2
//   legCrosses dropped from clearButEnds / the gate's exemption       -> 13
//   smoothTrack tests the moved vertex alone again                   -> 14
//   the snap takes a free cell across the line again                 -> 16
//   clearButEnds / the gate's exemption each alone                   -> 17 / 18
//   the smoothing pass tests the vertex alone again                  -> 19
//   legClear asked at the buffer, not hypot(buf, h/2)                 -> 20
//   the string-pull trusts the raster alone again / round dilation  -> 21, 22
//   the gate stops re-checking altogether                              -> 1, 2, 7, 8b
//   the leading run is not asked for (the whole leg from a berth)      -> 7
//   the run is capped at 2·buf from the berth                          -> 8
//   the run may close on what blocks it (no "never nearer")            -> 8b
//   a patch is taken whatever its length (round the land)             -> 9
//   legPath ships a snapped endpoint's leg unasked (through a spit)   -> 10
//   the standoff's re-gate asks "never nearer" of the margin, not the floor -> 11, 12
//   the planner's re-gate (keepStandoff) gives the gate no floor (round the goal) -> 12

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const { planeFrame } = require("../static/js/geodesy.js");
const { bbOf } = require("../static/js/geometry.js");
const { legClear, blocked } = require("../static/js/keepouts.js");
const { gateLegClear } = require("../static/js/routing.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = "THREW: " + e.message; }
  let d = detail;
  if (typeof d === "function") { try { d = d(); } catch (e) { d = "(detail threw: " + e.message + ")"; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   [" + d + "]" : ""));
  if (!ok) fails++;
}

const REF = { lat: 43.0722, lon: -70.7110 };
const F = planeFrame(REF);
const LL = (e, n) => F.fromEN(e, n);
const BUF = 3;

// A pier lying east-west across the route's path, its faces at n = 40 and n = 46.
const ring = [{ e: -60, n: 40 }, { e: 60, n: 40 }, { e: 60, n: 46 }, { e: -60, n: 46 }];
const PIER = { polys: [{ ring, bb: bbOf(ring), kind: "a dock / pier" }],
               lines: [], points: [], marks: [], sys: [], chans: [] };

// A route that runs north straight THROUGH the pier. `fallback` is only reached when the
// patch fails, so it is the same route here.
const routeTo = (nGoal) => [LL(0, 0), LL(0, 20), LL(0, nGoal)];
const fouls = (r) => {
  let n = 0;
  for (let i = 1; i < r.length; i++) if (!legClear(r[i - 1], r[i], F, PIER, BUF)) n++;
  return n;
};

console.log("The lane gate's endpoint exemption is about the ENDPOINT:");

check("1. the baseline: a leg that crosses a pier is spliced, and the shipped route is clear",
      () => {
        const route = routeTo(120);                 // goal 74 m clear of the far face
        const g = gateLegClear(route, route, F, PIER, BUF);
        return fouls(route) > 0 && g.splices >= 1 && !g.abandoned && fouls(g.route) === 0;
      },
      () => { const route = routeTo(120); const g = gateLegClear(route, route, F, PIER, BUF);
              return "in " + fouls(route) + " foul leg(s) -> out " + fouls(g.route)
                     + ", " + g.splices + " splice(s)"; });

// ⚠ THE EXEMPTION READS `firstBlockAlong`, SO THE BLOCK HAS TO BE NEAR THE GOAL - which on
// a long approach it never is, because the FIRST block is near the leg's start. The real
// case had a short final leg grazing a pier just before arriving, and that is what this
// world is: a pile 2 m to starboard of a route running north, with the goal a few metres
// past it. The first version of these two checks used the head-on pier above, where the
// first block sits 11-14 m from the goal - so the exemption could not fire either way and
// neither check could tell the fix from the fault.
const PILE = { polys: [], lines: [],
               points: [{ e: 2, n: 100, r: 0, kind: "a pile" }],
               marks: [], sys: [], chans: [] };
const grazeTo = (nGoal) => [LL(0, 60), LL(0, 90), LL(0, nGoal)];
const foulsP = (r) => { let n = 0;
  for (let i = 1; i < r.length; i++) if (!legClear(r[i - 1], r[i], F, PILE, BUF)) n++;
  return n; };

check("2. ⚠ THE REPORTED FAULT: a goal in CLEAR WATER is not exempt, however near the block " +
      "happens to fall to it",
      () => {
        // goal 3.6 m from the pile - outside the 3 m buffer, so clear water - and the block
        // begins 5.2 m short of it, inside the exemption's 6 m radius. The old test waived
        // exactly this, and shipped a leg passing 2 m off the pile.
        const goal = LL(0, 103), route = grazeTo(103);
        const g = gateLegClear(route, route, F, PILE, BUF);
        return !blocked(F.toEN(goal), PILE, BUF)      // the goal really is in clear water
            && foulsP(route) > 0                       // ... and the route really did foul
            && foulsP(g.route) === 0;                  // ... and the gate patched it
      },
      () => { const route = grazeTo(103);
              const g = gateLegClear(route, route, F, PILE, BUF);
              return "in " + foulsP(route) + " foul leg(s) -> out " + foulsP(g.route)
                     + ", " + g.splices + " splice(s)"; });

check("3. ... but a goal INSIDE the buffer still is — an arrival can end at a dock, and " +
      "that leg must ship unchanged rather than detour round the berth",
      () => {
        const goal = LL(0, 101), route = grazeTo(101);   // 2.2 m from the pile: in the buffer
        const g = gateLegClear(route, route, F, PILE, BUF);
        return blocked(F.toEN(goal), PILE, BUF)
            && g.splices === 0 && g.route.length === route.length;
      },
      () => { const route = grazeTo(101);
              const g = gateLegClear(route, route, F, PILE, BUF);
              return g.splices + " splice(s), " + g.route.length + " of "
                     + route.length + " waypoints"; });

check("4. and the same holds at the START — a boat moored inside the buffer is led out, one " +
      "in clear water is not given a free pass",
      () => {
        // start INSIDE: from n = 44 (inside the pier itself) running north out of it.
        const inRoute = [LL(0, 44), LL(0, 60), LL(0, 120)];
        const gin = gateLegClear(inRoute, inRoute, F, PIER, BUF);
        // start CLEAR: from n = 120 running SOUTH through the pier to clear water beyond.
        const outRoute = [LL(0, 120), LL(0, 100), LL(0, 20)];
        const gout = gateLegClear(outRoute, outRoute, F, PIER, BUF);
        return blocked(F.toEN(inRoute[0]), PIER, BUF) && gin.splices === 0
            && !blocked(F.toEN(outRoute[0]), PIER, BUF) && fouls(gout.route) === 0;
      },
      () => { const inRoute = [LL(0, 44), LL(0, 60), LL(0, 120)];
              const outRoute = [LL(0, 120), LL(0, 100), LL(0, 20)];
              return "moored start " + gateLegClear(inRoute, inRoute, F, PIER, BUF).splices
                     + " splice(s); clear start "
                     + fouls(gateLegClear(outRoute, outRoute, F, PIER, BUF).route)
                     + " foul leg(s) out"; });

check("5. the endpoint question is asked at the BUFFER, not at the exemption's own radius — " +
      "a goal 4 m off a pier with a 3 m buffer is clear water, not a berth",
      () => {
        const src = require("fs").readFileSync(
          require("path").join(__dirname, "..", "static", "js", "routing.js"), "utf8");
        return /const startIn = blocked\(frame\.toEN\(start\), ko, buf\);/.test(src)
            && /const goalIn = blocked\(frame\.toEN\(goal\), ko, buf\);/.test(src);
      },
      "asking at 2·buf would call a 4 m clearance a berth and waive it all over again");

// A berth 2 m off the pier's north face (inside the 3 m buffer), led out north; a pile 1.5 m
// to starboard of that leg 27 m out.
const BERTH = { polys: PIER.polys, lines: [], points: [{ e: 1.5, n: 75, r: 0, kind: "a pile" }],
                marks: [], sys: [], chans: [] };
const offPile = (r) => {
  const p = { e: 1.5, n: 75 };
  let m = Infinity;
  for (let i = 1; i < r.length; i++) {
    const a = F.toEN(r[i - 1]), b = F.toEN(r[i]), dx = b.e - a.e, dy = b.n - a.n, l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((p.e - a.e) * dx + (p.n - a.n) * dy) / l2));
    m = Math.min(m, Math.hypot(p.e - a.e - u * dx, p.n - a.n - u * dy));
  }
  return m;
};

check("7. ⚠ A LEG OUT OF A BERTH IS ASKED PAST THE BERTH: the blocked water she is led out of is " +
      "exempt, and a pile further along that leg is not - it is spliced round, at the buffer",
      () => {
        const route = [LL(0, 48), LL(0, 160)];
        const g = gateLegClear(route, route, F, BERTH, BUF);
        return blocked(F.toEN(route[0]), BERTH, BUF) && offPile(route) < BUF
            && g.splices >= 1 && !g.abandoned && offPile(g.route) >= BUF - 0.01;
      },
      () => { const route = [LL(0, 48), LL(0, 160)]; const g = gateLegClear(route, route, F, BERTH, BUF);
              return "the pile " + offPile(route).toFixed(2) + " m off the leg in -> " + offPile(g.route).toFixed(2)
                     + " m off the route out, " + g.splices + " splice(s)"; });

check("8. ... and that water is all of it she lies in, however far: led out ALONG the pier 2 m off its " +
      "face - no nearer than her berth - for 40 m, the route ships unspliced (capped at 2·buf from the " +
      "berth, a real Go-To leaving land's standoff at 51 m was spliced into a 110 degree turn)",
      () => {
        const route = [LL(-50, 48), LL(-10, 48), LL(30, 80), LL(30, 160)];
        const g = gateLegClear(route, route, F, PIER, BUF);
        return blocked(F.toEN(route[0]), PIER, BUF) && !legClear(route[0], route[1], F, PIER, BUF)
            && g.splices === 0 && g.route.length === route.length;
      },
      () => { const route = [LL(-50, 48), LL(-10, 48), LL(30, 80), LL(30, 160)];
              const g = gateLegClear(route, route, F, PIER, BUF);
              return g.splices + " splice(s), " + g.route.length + " of " + route.length + " waypoints"; });

check("8b. ... but not along it CLOSER IN: a leg from the berth (2.5 m off the face) that closes to 0.8 m " +
      "off it is spliced",
      () => {
        const route = [LL(-50, 48.5), LL(-10, 46.8), LL(30, 80), LL(30, 160)];
        const g = gateLegClear(route, route, F, PIER, BUF);
        return blocked(F.toEN(route[0]), PIER, BUF) && g.splices >= 1 && !g.abandoned;
      },
      () => { const route = [LL(-50, 48.5), LL(-10, 46.8), LL(30, 80), LL(30, 160)];
              const g = gateLegClear(route, route, F, PIER, BUF);
              return g.splices + " splice(s)" + (g.abandoned ? ", ABANDONED" : ""); });

// A wall 3 km long with a 10 m slot 100 m west of the lane: the search's own route goes through the slot (clear at the
// buffer), the lane's leg crosses the wall beside it, and the router's fine grid closes the slot - its patch goes round
// the wall's end, 3,084 m for a 520 m leg.
const SLOT = (() => {
  const rect = (e0, n0, e1, n1) => [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }];
  const rings = [rect(-1500, 500, -105, 510), rect(-95, 500, 1500, 510)];
  return { polys: rings.map((r) => ({ ring: r, bb: bbOf(r), kind: "land" })), lines: [], points: [], marks: [], sys: [], chans: [] };
})();
const lenOf = (r) => { let L = 0; for (let i = 1; i < r.length; i++) L += F.distTo(r[i - 1], r[i]); return L; };

check("9. ⚠ A PATCH IS BOUNDED BY THE WAY THE SEARCH ITSELF WENT: where the router's patch goes round the land, " +
      "the search's own way between the same points is spliced instead, and every leg is clear",
      () => {
        const search = [LL(-30, 0), LL(-100, 400), LL(-100, 620), LL(30, 1000)];
        const route = [LL(-30, 0), LL(0, 480), LL(30, 1000)];
        const g = gateLegClear(route, search, F, SLOT, BUF);
        let clear = true;
        for (let i = 1; i < g.route.length; i++) if (!legClear(g.route[i - 1], g.route[i], F, SLOT, BUF)) clear = false;
        return search.every((p, i) => !i || legClear(search[i - 1], p, F, SLOT, BUF)) && !g.abandoned
            && g.splices === 1 && clear && lenOf(g.route) < 1.5 * lenOf(search);
      },
      () => { const search = [LL(-30, 0), LL(-100, 400), LL(-100, 620), LL(30, 1000)];
              const g = gateLegClear([LL(-30, 0), LL(0, 480), LL(30, 1000)], search, F, SLOT, BUF);
              return "shipped " + lenOf(g.route).toFixed(0) + " m (the search's route " + lenOf(search).toFixed(0)
                     + " m), " + g.splices + " splice(s)" + (g.abandoned ? ", ABANDONED" : ""); });

// A goal 9.8 m south of a spit of land, in an inlet 30 m wide: at a 19.5 m margin every cell near it is blocked, and the
// router snapped the goal to the nearest free cell - north of the spit - and ran the last leg straight across it.
const { legPath } = require("../static/js/routing.js");
const SPIT = (() => {
  const rect = (e0, n0, e1, n1) => [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }];
  const rings = [rect(-400, 0, 400, 10), rect(-400, -400, -15, 0), rect(15, -400, 400, 0)];
  return { polys: rings.map((r) => ({ ring: r, bb: bbOf(r), kind: "land" })), lines: [], points: [], marks: [], sys: [], chans: [] };
})();
const throughLand = (A, leg) => {
  if (!leg) return 0;
  const full = [A, ...leg];
  let n = 0;
  for (let i = 1; i < full.length; i++) if (!legClear(full[i - 1], full[i], F, SPIT, 0.05)) n++;
  return n;
};

check("10. ⚠ A LEG INTO A GOAL INSIDE THE MARGIN RUNS THROUGH NO KEEP-OUT: behind a spit, the router's snapped goal is " +
      "refused at a 19.5 m margin, and found at the buffer",
      () => {
        const A = LL(600, 200), B = LL(0, -9.8);
        const at19 = legPath(A, B, F, SPIT, 19.5), at3 = legPath(A, B, F, SPIT, 3);
        return throughLand(A, at19) === 0 && at3 && throughLand(A, at3) === 0;
      },
      () => { const A = LL(600, 200), B = LL(0, -9.8);
              const at19 = legPath(A, B, F, SPIT, 19.5), at3 = legPath(A, B, F, SPIT, 3);
              return "at 19.5 m " + (at19 ? at19.length + " pts, " + throughLand(A, at19) + " leg(s) through land" : "refused")
                     + "; at the buffer " + (at3 ? at3.length + " pts, " + throughLand(A, at3) + " through land" : "refused"); });

// A start 10 m off a pier's face, inside a 19.5 m standoff; her first leg comes in to 5 m of the pier, then away.
const NEAR = [LL(0, 56), LL(40, 51), LL(80, 160)];   // the pier's north face at n = 46

check("11. ... and in the standoff's re-gate (a floor below its margin) the water she is led out of may come as near as " +
      "the buffer: that leg is not spliced; with no floor it is (no nearer than the start less a quarter of the margin)",
      () => {
        const withFloor = gateLegClear(NEAR, NEAR, F, PIER, 19.5, { floor: BUF }), bare = gateLegClear(NEAR, NEAR, F, PIER, 19.5);
        return blocked(F.toEN(NEAR[0]), PIER, 19.5) && legClear(NEAR[0], NEAR[1], F, PIER, BUF)
            && withFloor.splices === 0 && bare.splices >= 1;
      },
      () => { const withFloor = gateLegClear(NEAR, NEAR, F, PIER, 19.5, { floor: BUF }), bare = gateLegClear(NEAR, NEAR, F, PIER, 19.5);
              return "with the buffer as its floor " + withFloor.splices + " splice(s); with none " + bare.splices; });

// A Go-To in a set (a 19.5 m standoff) to a goal 19-20 m off an obstruction 20 m beyond it, from 1.5 km out: the
// search's way comes in past the obstruction, and the planner's re-gate at the standoff (keepStandoff) must take the
// goal's own water as it is - no nearer the obstruction than the buffer - not go round the goal to come at it from the
// far side. (With no floor given the gate, it went round: 90 degrees, 10 m past the goal; with the floor ignored, 73.)
{
  const { planNogoRoute } = require("../static/js/passage.js"), { nogo } = require("../static/js/state.js");
  const pt = (e, n, r) => ({ polys: [], lines: [], points: [{ e, n, r, kind: "an obstruction" }], marks: [], sys: [], chans: [] });
  const sharpNear = (t, near) => {
    let worst = 0;
    for (let i = 1; i < t.length - 1; i++) {
      const a = t[i - 1], b = t[i], c = t[i + 1];
      if (Math.hypot(b.e, b.n) > near) continue;
      let d = Math.abs(Math.atan2(c.e - b.e, c.n - b.n) - Math.atan2(b.e - a.e, b.n - a.n)) * 180 / Math.PI;
      if (d > 180) d = 360 - d;
      worst = Math.max(worst, d);
    }
    return worst;
  };
  const saved = { ready: nogo.ready, frame: nogo.frame, ko: nogo.ko, buffer: nogo.buffer };
  const res = [];
  try {
    for (const [o, s] of [[[20, 0, 1], [1500, 0]], [[20, 0, 1], [1500, 60]], [[22, 1.3, 2.9], [1500, 30]]]) {
      const ko = pt(o[0], o[1], o[2]);
      Object.assign(nogo, { ready: true, frame: F, ko, buffer: BUF });
      const A = LL(s[0], s[1]), r = planNogoRoute(A, LL(0, 0), { standoffM: 19.5, ko });
      const pts = r.route ? [A, ...r.route] : [];
      const t = pts.map((p) => F.toEN(p));
      res.push({ err: r.error, sharp: sharpNear(t, 60), past: Math.min(...t.map((p) => p.e)),
                 foul: pts.slice(1).filter((p, i) => !legClear(pts[i], p, F, ko, BUF)).length });
    }
  } finally { Object.assign(nogo, saved); }
  check("12. ⚠ A GOAL INSIDE THE STANDOFF, approached past what puts it there: the route comes straight in - no turn of 45 "
        + "degrees or more within 60 m of it, never past it to come at it from the far side - and no leg nearer anything "
        + "than the buffer",
        res.every((q) => !q.err && q.sharp < 45 && q.past > -1 && q.foul === 0),
        res.map((q) => q.err ? "REFUSED " + q.err : "sharpest " + q.sharp.toFixed(0) + " deg, least e " + q.past.toFixed(1)
                        + " m, " + q.foul + " leg(s) inside the buffer").join(" | "));
}

check("6. ⚠ AND THIS FILE IS ASV'S NOW — re-vendoring it from asv_core would delete the fix",
      () => {
        const src = require("fs").readFileSync(
          require("path").join(__dirname, "..", "static", "js", "routing.js"), "utf8");
        return /ASV OWNS THIS FILE NOW/.test(src) && /DO NOT RE-VENDOR IT/.test(src)
            && src.indexOf("ASV OWNS THIS FILE NOW") < src.indexOf("VENDORED FROM asv_core");
      },
      "the same note keepouts.js and core_turns.js already carry; a --check reporting DRIFT " +
      "over there is correct");

// ── A LEG ACROSS A CHARTED LINE (the 2026-10-16 review, finding 1) ───────────────────────────────────────────────────
// A pier drawn as a LINE (dock_line, shore_line) is zero-width: the raster stamps it one cell wide, so the free cell
// nearest a start 0.8 m off it could lie on its far side; the ends' exemption asked legClear at 0.05 m with a 2 m step,
// which cannot see a line between two samples; the gate's start exemption asked "no nearer than the start is", which a
// crossing never is; and smoothTrack tested the moved vertex, not the legs it made. Three starts in four shipped a
// route straight across the pier. Now legCrosses (keepouts.js), geometric, is asked at all four.
{
  const { channelLaneRoute, smoothTrack, routeAround } = require("../static/js/routing.js");
  const { legCrosses, legCrossesEN } = require("../static/js/keepouts.js");
  const FR = planeFrame({ lat: 43.07, lon: -70.71 });
  const LL = (e, n) => FR.fromEN(e, n);
  const crosses = (route, xe, n0, n1) => {
    const en = route.map((p) => FR.toEN(p));
    for (let i = 1; i < en.length; i++) {
      const a = en[i - 1], b = en[i];
      if ((a.e - xe) * (b.e - xe) < 0) { const t = (xe - a.e) / (b.e - a.e), n = a.n + (b.n - a.n) * t; if (n >= n0 && n <= n1) return i; }
    }
    return 0;
  };
  const dockKo = (n0, n1) => { const pts = [{ e: 0, n: n0 }, { e: 0, n: n1 }];
    return { polys: [], lines: [{ pts, bb: bbOf(pts), kind: "a dock / pier" }], points: [], marks: [], sys: [], chans: [], restricted: [] }; };
  const cases = [[1.0, 0, -40, 0, -30, 30], [1.0, 3, -60, -5, -40, 40], [0.8, 10, -45, 12, -25, 25], [1.2, -4, -50, 2, -30, 30]];
  const got = cases.map(([ae, an, be, bn, n0, n1]) => {
    const ko = dockKo(n0, n1), A = LL(ae, an), B = LL(be, bn);
    const lp = legPath(A, B, FR, ko, 3);
    if (!lp) return { lp: null };
    const r1 = [A, ...lp], shipped = channelLaneRoute(r1, FR, ko, 3, { lane: false }).route;
    return { lpX: crosses(r1, 0, n0, n1), shipX: crosses(shipped, 0, n0, n1), ends: FR.distTo(shipped[shipped.length - 1], B) < 0.5,
             startIn: blocked(FR.toEN(A), ko, 3), n: shipped.length };
  });
  check("13. ⚠ A START 0.8-1.2 m OFF A PIER DRAWN AS A LINE (inside the 3 m buffer), the goal west of it: legPath rounds the "
        + "pier's end and so does the shipped route, in all four geometries; each ends at the goal",
        got.every((g) => g.lp !== null && g.startIn && g.lpX === 0 && g.shipX === 0 && g.ends),
        JSON.stringify(got));
  // the smoothing alone: a correct five-point detour round the line must not become a leg across it
  const ko3 = dockKo(-25, 25);
  const detour = [[0.8, 10], [5.2, 6.2], [5.2, 30.2], [-6.8, 30.2], [-45, 12]].map(([e, n]) => LL(e, n));
  const sm = smoothTrack(detour, FR, ko3, 3);
  check("14. smoothTrack keeps a detour round the pier a detour: the smoothed route crosses the line nowhere, and the legs it "
        + "made are clear at the buffer (its moved points are no longer tested alone)",
        crosses(sm, 0, -25, 25) === 0 && sm.slice(1, -1).every((p, i) => legClear(sm[i], p, FR, ko3, 3) || blocked(FR.toEN(sm[i]), ko3, 3)),
        JSON.stringify(sm.map((p) => { const q = FR.toEN(p); return [+q.e.toFixed(1), +q.n.toFixed(1)]; })));
  // legCrosses itself
  const sq = [{ e: 10, n: -10 }, { e: 30, n: -10 }, { e: 30, n: 10 }, { e: 10, n: 10 }];
  const koP = { polys: [{ ring: sq, bb: bbOf(sq), kind: "land" }], lines: ko3.lines, points: [{ e: 60, n: 0, r: 4 }], marks: [] };
  const u = {
    line: legCrossesEN({ e: 1, n: 0 }, { e: -5, n: 0 }, koP),                 // across the dock line
    along: legCrossesEN({ e: 0, n: -40 }, { e: 0, n: 40 }, koP),              // exactly along it: a run, not a crossing
    past: legCrossesEN({ e: 1, n: 30 }, { e: -5, n: 30 }, koP),               // past its end
    through: legCrossesEN({ e: 5, n: 0 }, { e: 35, n: 0 }, koP),              // through the square: in and out
    out: legCrossesEN({ e: 20, n: 0 }, { e: 40, n: 0 }, koP),                 // from inside the square: led out
    into: legCrossesEN({ e: 40, n: 0 }, { e: 20, n: 0 }, koP),                // into it: led in (an arrival at a dock)
    corner: legCrossesEN({ e: 5, n: 15 }, { e: 35, n: -15 }, koP),            // through two edges by way of a vertex
    pointThru: legCrossesEN({ e: 50, n: 0 }, { e: 70, n: 0 }, koP),           // through a point hazard's extent
    pointOut: legCrossesEN({ e: 61, n: 0 }, { e: 80, n: 0 }, koP),            // out of it
    pointBy: legCrossesEN({ e: 50, n: 5 }, { e: 70, n: 5 }, koP),             // 5 m off a 4 m extent
    ll: legCrosses(LL(1, 0), LL(-5, 0), FR, koP),
  };
  check("15. legCrosses: across a line yes, along it no, past its end no; through a polygon yes, out of it or into it no "
        + "(the one exit or entry is the way out of the water the endpoint lies in), through a vertex yes; through a point "
        + "hazard's extent yes, out of it no, 5 m off a 4 m extent no; the lat/lon form agrees",
        u.line && !u.along && !u.past && u.through && !u.out && !u.into && u.corner && u.pointThru && !u.pointOut && !u.pointBy && u.ll,
        JSON.stringify(u));
  // the snap: with free cells on both sides of the line, the start's cell is on HER side
  // (the geometry whose first free cell in scan order lay across the line: a start 1 m east of it, abeam its middle)
  const ko0 = dockKo(-30, 30);
  const viaS = routeAround(LL(1, 0), LL(-40, 0), FR, ko0, 3);
  const firstE = viaS && viaS.length ? FR.toEN(viaS[0]).e : null;
  check("16. the raster's start snap takes a free cell on her side of the line (the first via point east of it), not the "
        + "first free cell in scan order on the far side",
        viaS && viaS.length > 0 && firstE > 0 && crosses([LL(1, 0), ...viaS, LL(-40, 0)], 0, -30, 30) === 0,
        JSON.stringify(viaS && viaS.map((p) => { const q = FR.toEN(p); return [+q.e.toFixed(1), +q.n.toFixed(1)]; })));
  // each layer on its own, since each backs the others up
  const { clearButEnds, END_CLEAR_M } = require("../static/js/routing.js");
  check("17. clearButEnds: a leg out of a berth 0.8 m east of the line to clear water west of it is refused - the crossing is "
        + "asked, not only the 0.05 m samples 2 m apart; a leg out of the berth away from the line is allowed",
        clearButEnds(LL(0.8, 10), LL(-10, 12), FR, ko3, END_CLEAR_M, true, false) === false
          && clearButEnds(LL(0.8, 10), LL(12, 12), FR, ko3, END_CLEAR_M, true, false) === true);
  const g18 = gateLegClear([LL(0.8, 10), LL(-45, 12)], detour, FR, ko3, 3);
  check("18. the gate's start exemption does not wave a leg across the line through: a two-point route from the berth straight "
        + "across is spliced (the search's detour), and the shipped route crosses nowhere",
        g18.splices >= 1 && !g18.abandoned && crosses(g18.route, 0, -25, 25) === 0,
        JSON.stringify({ splices: g18.splices, abandoned: g18.abandoned, route: g18.route.map((p) => { const q = FR.toEN(p); return [+q.e.toFixed(1), +q.n.toFixed(1)]; }) }));
  // the smoothing PASS (the resampler keeps the search's vertices here, its chords crossing): the corner vertex at (5, 30)
  // would round to (-17.5, 2.5), and the leg to it crosses a line running from -70 to 25
  const koL = dockKo(-70, 25);
  const sm19 = smoothTrack([[5, -80], [5, 30], [-85, 30]].map(([e, n]) => LL(e, n)), FR, koL, 3);
  check("19. the smoothing pass leaves a vertex where rounding it would make a leg across the line: the smoothed route crosses "
        + "nowhere (the moved vertex alone, 17 m off the line, is clear - the leg to it is what crosses)",
        crosses(sm19, 0, -70, 25) === 0,
        JSON.stringify(sm19.map((p) => { const q = FR.toEN(p); return [+q.e.toFixed(1), +q.n.toFixed(1)]; })));
  // finding 3: the clearance legClear reads between two samples
  const r20 = (buf, d) => { const pt = { polys: [], lines: [], points: [{ e: 0, n: d, r: 0 }], marks: [] };
    // the hazard midway between two samples: a 20 m leg at buf 5 is sampled every 2.5 m, so put it at e = 1.25
    const step = Math.max(2, buf / 2); pt.points[0].e = step / 2;
    return legClear(LL(0, 0), LL(20, 0), FR, pt, buf); };
  check("20. legClear reads the clearance between its samples exactly: a point hazard midway between two samples, 4.9 m off a "
        + "20 m leg, is refused at a 5 m buffer (it passed at 4.845 m), 9.8 m off at 10 m (passed at 9.685), 2.9 m at 3 m "
        + "(passed at 2.84) - and 5.1, 10.1 and 3.1 m off are allowed",
        !r20(5, 4.9) && !r20(10, 9.8) && !r20(3, 2.9) && r20(5, 5.1) && r20(10, 10.1) && r20(3, 3.1),
        JSON.stringify([r20(5, 4.9), r20(10, 9.8), r20(3, 2.9), r20(5, 5.1), r20(10, 10.1), r20(3, 3.1)]));
}

// ── NO ROUTED LEG UNDER THE BUFFER (the 2026-10-16 review, finding 2) ─────────────────────────────────────────────────
// routeAround's string-pull tested a shortcut against the raster alone, once per cell, each sample rounded to the grid:
// with the buffer between one and one and a half cells a shortcut passed ~0.9 cell from a feature (2.149 m of 3 m,
// reproduced below), and the gate spliced its own patches unasked. Now a shortcut is confirmed with legClear, the
// dilation is a whole cell more than the buffer, and a patch is asked like any leg.
{
  const { routeAround, channelLaneRoute } = require("../static/js/routing.js");
  const K = require("../static/js/keepouts.js");
  const FR = planeFrame({ lat: 43.07, lon: -70.71 });
  const LL = (e, n) => FR.fromEN(e, n);
  const sq = (pts) => ({ ring: pts.map(([e, n]) => ({ e, n })), bb: bbOf(pts.map(([e, n]) => ({ e, n }))), kind: "a rock" });
  const koOf = (points, polys) => ({ polys: polys.map(sq), lines: [], points: points.map(([e, n, r]) => ({ e, n, r })), marks: [], sys: [], chans: [], restricted: [] });
  // the least clearance along a route's legs whose ENDS are clear (a leg out of a blocked start is the exemption's), at 0.25 m
  const minClear = (route, ko, buf) => {
    let m = Infinity;
    for (let i = 1; i < route.length; i++) {
      const a = FR.toEN(route[i - 1]), b = FR.toEN(route[i]);
      if (K.blocked(a, ko, buf) || K.blocked(b, ko, buf)) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(b.e - a.e, b.n - a.n) / 0.25));
      for (let k = 0; k <= n; k++) { const t = k / n; m = Math.min(m, K.clearanceM({ e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t }, ko, 100)); }
    }
    return m;
  };
  const ko21 = koOf([[10.1, 106.51, 0], [-18.93, -122.25, 10], [140.04, 61.14, 10], [53.16, -58.23, 10]], [[[60.7, -27.5], [99.7, 14.2], [53.8, 57.1], [14.8, 15.4]]]);
  const A21 = LL(-339.78778, 34.12468), B21 = LL(333.71086, 28.24948);
  const via = routeAround(A21, B21, FR, ko21, 3), r21 = via ? [A21, ...via, B21] : null;
  const lp21 = legPath(A21, B21, FR, ko21, 3), rr21 = lp21 ? [A21, ...lp21] : null;
  check("21. ⚠ THE REPRODUCED WORLD: routeAround's string-pull shipped a leg 2.149 m from a 10 m rock with a 3 m buffer; its "
        + "route and legPath's now keep the buffer on every leg (to a centimeter)",
        r21 && rr21 && minClear(r21, ko21, 3) >= 3 - 0.01 && minClear(rr21, ko21, 3) >= 3 - 0.01,
        JSON.stringify({ via: via && minClear(r21, ko21, 3).toFixed(3), legPath: rr21 && minClear(rr21, ko21, 3).toFixed(3) }));
  // a seeded fuzz: random rocks and one tilted block between A and B, 300-800 m apart, at a 3 m and a 5 m buffer, through
  // legPath and through the whole pipeline (the gate's patches included)
  let seed = 20261016;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const worst = { legPath: Infinity, shipped: Infinity, routed: 0, refused: 0, ex: null };
  for (let w = 0; w < 160; w++) {
    const buf = w % 2 ? 5 : 3, span = 300 + rnd() * 500;
    const pts = []; for (let k = 0; k < 5; k++) pts.push([rnd() * span - span / 2, rnd() * 300 - 150, k === 0 ? 0 : 10]);
    const c = { e: rnd() * 200 - 100, n: rnd() * 100 - 50 }, th = rnd() * Math.PI, L2 = 20, W2 = 40;
    const rot = (e, n) => [c.e + e * Math.cos(th) - n * Math.sin(th), c.n + e * Math.sin(th) + n * Math.cos(th)];
    const ko = koOf(pts, [[rot(-L2, -W2), rot(L2, -W2), rot(L2, W2), rot(-L2, W2)]]);
    const A = LL(-span / 2, rnd() * 60 - 30), B = LL(span / 2, rnd() * 60 - 30);
    if (K.blocked(FR.toEN(A), ko, buf) || K.blocked(FR.toEN(B), ko, buf)) continue;
    const lp = legPath(A, B, FR, ko, buf);
    if (!lp) { worst.refused++; continue; }
    worst.routed++;
    const m1 = minClear([A, ...lp], ko, buf), m2 = minClear(channelLaneRoute([A, ...lp], FR, ko, buf, { lane: false }).route, ko, buf);
    if (m1 - buf < worst.legPath - (worst.ex ? worst.ex.buf : 0) || m1 < buf - 0.01) worst.ex = { w, buf, m1: +m1.toFixed(3), m2: +m2.toFixed(3) };
    worst.legPath = Math.min(worst.legPath, m1 - buf); worst.shipped = Math.min(worst.shipped, m2 - buf);
  }
  check("22. ⚠ A SEEDED FUZZ, 160 worlds at 3 and 5 m: every routed leg with clear ends keeps the buffer, out of legPath and "
        + "out of the whole pipeline (before the fix: 19 of 614 routeAround legs and 12 of 446 shipped routes under it)",
        worst.routed >= 100 && worst.legPath >= -0.01 && worst.shipped >= -0.01,
        JSON.stringify({ routed: worst.routed, refused: worst.refused, underByLegPath: +worst.legPath.toFixed(3), underByShipped: +worst.shipped.toFixed(3), ex: worst.ex }));
}

console.log("");
console.log(fails ? (fails + " CHECK(S) FAILED of " + ran) : ("all " + ran + " checks pass"));
process.exit(fails ? 1 : 0);
