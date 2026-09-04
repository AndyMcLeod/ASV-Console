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
// TEETH - mutations RUN against a sidecar copy of routing.js:
//   the exemption drops the endpoint test again (the reported 0.47 m)  -> 2
//   the exemption is dropped entirely (a moored boat is re-routed)     -> 3
//   startIn / goalIn are computed at 2·buf instead of the buffer       -> 2
//   the gate stops re-checking altogether                              -> 1, 2

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
            && /const goalIn = blocked\(frame\.toEN\(goal\), ko, buf\);/.test(src)
            && /\(\(startIn && near\(hit, start\)\) \|\| \(goalIn && near\(hit, goal\)\)\)/.test(src);
      },
      "asking at 2·buf would call a 4 m clearance a berth and waive it all over again");

check("6. ⚠ AND THIS FILE IS ASV'S NOW — re-vendoring it from asv_core would delete the fix",
      () => {
        const src = require("fs").readFileSync(
          require("path").join(__dirname, "..", "static", "js", "routing.js"), "utf8");
        return /ASV OWNS THIS FILE NOW/.test(src) && /DO NOT RE-VENDOR IT/.test(src)
            && src.indexOf("ASV OWNS THIS FILE NOW") < src.indexOf("VENDORED FROM asv_core");
      },
      "the same note keepouts.js and core_turns.js already carry; a --check reporting DRIFT " +
      "over there is correct");

console.log("");
console.log(fails ? (fails + " CHECK(S) FAILED of " + ran) : ("all " + ran + " checks pass"));
process.exit(fails ? 1 : 0);
