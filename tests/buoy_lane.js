// tests/buoy_lane.js - channel-LANE routing regression test (the operator's spec).
//
// Ported from the sibling console 2026-07-31 along with the routing. Same contract,
// adapted to this console's layout: everything lives in ONE file (static/asv.html -
// there is no routing.js split here), and the per-vessel `channel_reach_m` override is
// stubbed to null so the test exercises the default channel reach.
//
// The behaviour, drawn by the operator on the Erie Harbor Channel and applied to every
// mode (Go-To, RTH, Transit, survey approach, routed detours):
//
//   * OUTBOUND rides between the centreline and the GREEN buoys (green to starboard)
//   * INBOUND  rides between the centreline and the RED buoys   (red to starboard)
//   * BOTH keep the channel CENTRELINE TO PORT
//
// which is one direction-based geometric rule: offset a lane to STARBOARD of the
// buoy-pair centreline, half way out to the buoy line on that side (= a quarter of the
// full channel width in from the edge). Colour is never an input - it falls out,
// because IALA lateral marks sit on fixed sides. The offset is measured from the robust
// buoy-pair CENTRELINE, not the edge ray-march that made the old keepRight ride the
// wrong side of the buoys twice on the water.
//
// Runs the REAL channelLaneRoute / systemCenterline, and the geometry helpers they need,
// pulled out of static/asv.html and run against a synthetic buoyed channel. (This header
// used to name two source files from the SIBLING console's layout - a split it has and
// this one does not. Ported comments rot: the source a harness names must be the source
// it actually reads, or the next reader goes looking for a file that was never here.)
//
//   node tests/buoy_lane.js      # exit 0 = pass, 1 = fail   (stdlib Node, no deps)
//
// TEETH: flip the starboard unit in channelLaneRoute (sbe/sbn), drop LANE_FRAC to 0, or
// neuter the function, and the side / lane-position assertions below fail.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy in one
// global scope; the eval below reproduces that.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// check() turns a throw inside its own thunk into a failed check. Scenario SETUP is not
// inside one - building a world, eval-ing page code, awaiting a fetch - and a throw there
// would kill the process before a single FAIL line printed. "No FAIL lines" and "the
// process died" are indistinguishable to anything reading stdout, so a mutation that
// crashes this suite would score as SURVIVED. Report it instead, in the normal format.
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

// LAYER-0 HELPERS COME FROM THE REAL MODULES, not from asv.html's source text.
// These moved out of the page on 2026-08-09. Requiring them means a renamed or
// deleted export fails HERE, loudly, instead of silently reverting to a stale copy;
// and the checks below exercise the shipped function rather than an eval of its text.
// Top-level so the suite's DIRECT eval() of page functions still resolves them.
const { azTo, distTo, fromEN, llEN, planeFrame } = require("../static/js/geodesy.js");
const { dSeg, inBB, pinp } = require("../static/js/geometry.js");

// The vessel-derived parameter block moved to static/js/state.js (2026-08-09). The page
// functions eval'd below read V.NOGO_MIN_DEPTH_M / V.WRECK_RADIUS_M / ..., so the suite
// needs the SAME object the page mutates - and gets it, rather than a stub, so a check
// that leans on a vessel default is reading the real one.
const { V } = require("../static/js/state.js");

// --- source lookup: the page AND its modules -----------------------------------------
// THIS SUITE KEEPS THE SOURCE-TEXT ROUTE ON PURPOSE, and it is the only one that does.
// Every other suite now require()s the real modules. This one cannot, because check 19
// MONKEY-PATCHES the router: it replaces `legPath` with a stub that always fails, then
// asserts gateLegClear ships the lawful pre-lane input and flags `abandoned`. A real
// import makes that impossible in both directions - the binding is const, and more
// fundamentally gateLegClear calls passage.js's OWN legPath, which nothing outside the
// module can reach. Reproducing the browser's single shared scope through eval is what
// lets that branch be reached at all, and the branch is worth reaching: it is the "the law
// cannot patch this stretch" fallback, where a wrong answer means a Rule 9 banner over a
// lane the router already abandoned.
//
// The alternative would be a dependency-injection seam in passage.js existing solely for
// this test. Not worth it: routing code should not grow a hook so a harness can lie to it.
//
// MODSRC is those modules concatenated with the `export` keyword stripped, so each
// declaration reads exactly as it did when it sat in the page.
const MODSRC = require("fs")
  .readdirSync(require("path").join(__dirname, "..", "static", "js"))
  .filter(f => f.endsWith(".js"))
  .map(f => require("fs").readFileSync(
    require("path").join(__dirname, "..", "static", "js", f), "utf8"))
  .join("\n")
  .replace(/^export /gm, "");

// asv_core's routing.js on its own. MODSRC concatenates every module, and `grab` takes
// the FIRST match -- which for channelLaneRoute is passage.js's WRAPPER, the one that
// supplies V.CHANNEL_REACH_M and mirrors the lane fact into sea.*. That wrapper is what
// the console calls, so it is what this suite should exercise; but it calls the core body
// by the name it imports it under, and the eval scope has to supply that the way the
// browser's module graph does.
const ROUTINGSRC = require("fs")
  .readFileSync(require("path").join(__dirname, "..", "static", "js", "routing.js"), "utf8")
  .replace(/^export /gm, "");

const STATIC = path.join(__dirname, "..", "static");
const { sea } = require("../static/js/state.js");
const H = fs.readFileSync(path.join(STATIC, "asv.html"), "utf8");

// Pull a `function NAME(...) { ... }` definition out of a source file by brace matching.
function grab(src, name) {
  if (src.indexOf("function " + name + "(") < 0) src = MODSRC;
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  // SKIP THE PARAMETER LIST FIRST. `legPath(A, B, frame, ko, buf, opts = {})` has a `{}`
  // DEFAULT ARGUMENT, and starting the brace count at the first `{` after the name stopped
  // dead on it -- grab returned the signature and nothing else, and the eval below died
  // with a bare "Unexpected token '}'" that pointed at the eval call, not the cause. Walk
  // the parens to the end of the signature, THEN find the body brace. (asv_core's routing
  // bodies took optional `opts` when they moved there, 2026-08-20.)
  let q = src.indexOf("(", start), par = 0;
  for (;;) { const c = src[q]; if (c === "(") par++; else if (c === ")") { par--; if (!par) break; } q++; }
  let k = src.indexOf("{", q), depth = 0;
  for (;;) { const c = src[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return src.slice(start, k + 1);
}

// Pull a module-level declaration (`const X = ...;` / `let X = ...;`) out verbatim, so
// the test uses the REAL tuning value rather than a copy that can drift.
function grabDecl(name) {
  // the page first, then the modules - same order the page itself loads them
  for (const HS of [H, MODSRC]) {
    for (const kw of ["const ", "let ", "var "]) {
      const i = HS.indexOf(kw + name + " =");
      if (i >= 0) return HS.slice(i, HS.indexOf(";", i) + 1);
    }
  }
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}

// Geometry helpers + the whole route-search cluster - all in static/asv.html here.
const HELPERS = ["blocked", "stampSeg", "dilateGrid", "rasterKeepouts", "routeAround", "snapClearLL",
                 "routeAroundSeg", "pruneStitch", "legClear", "legPath",
                 "blockedInfo", "firstBlockAlong", "gateLegClear",
                 "smoothTrack", "systemCenterline", "extendCenterline",
                 // A PRIVATE HELPER OF asv_core's routing module. The lane bodies grabbed
                 // above call it; this console's old copy inlined the same arc-length
                 // resampling, so it has to be in the shared scope the way the module
                 // graph puts it.
                 "resampleEN",
                 "buoyChannelLane", "narrowChannelLane", "channelLaneRoute"];
const M_PER_DEG_LAT = 111320.0;

// One classic scope, exactly like the browser (routing.js + the inline script share
// globals). Direct eval leaks the function declarations into this module scope, so
// channelLaneRoute / systemCenterline are callable directly below.
// eslint-disable-next-line no-eval
eval("const M_PER_DEG_LAT=" + M_PER_DEG_LAT + ";\n" +
     "const SEG_LEN_M=2200;\nlet CHANNEL_REACH_M=null;\n" +          // vessel override: default reach
     // asv_core's routing tuning constants, read from the module rather than
     // restated here -- a copy would drift from what the console searches with.
     grabDecl("HEURISTIC_WEIGHT") + "\n" + grabDecl("POP_CAP") + "\n"
       + grabDecl("MAX_DIM") + "\n"
       // NARROW_MAX_M is the COLREGS Rule 9 applicability bound (2026-08-31): how wide the
       // water may be and still be a narrow channel. Read from the module, never restated
       // here — a copy would let this suite agree with a threshold the console does not use.
       + grabDecl("NARROW_MAX_M") + "\n" +
     // `laneUsed` became `sea.laneUsed` when Rule 9 moved to passage.js, so the eval'd
     // bodies below write into the SHARED state object rather than a local of their own -
     // which is what lets the checks below read back what the router actually did.
     grabDecl("LANE_FRAC") + "\n" + grabDecl("CL_EXTEND_CAP_M") + "\n" +
     // laneCenterline is an ARROW CONST in asv_core, not a `function` declaration, so it
     // comes through grabDecl (which reads `const X = ...;`) rather than grab().
     grabDecl("laneCenterline") + "\n" +
     // The core pipeline under the name passage.js's wrapper imports it as. A NAMED
     // function expression: the inner name binds only inside itself, so it does not
     // shadow the wrapper grabbed from passage.js below.
     "const coreChannelLaneRoute = " + grab(ROUTINGSRC, "channelLaneRoute") + ";\n" +
     HELPERS.map((n) => grab(H, n)).join("\n") + "\n" +
     // A `const` declared inside a direct eval stays in the EVAL's scope, so this is how
     // the checks below read the module's OWN Rule 9 width bound rather than a number
     // restated in this file — which would let the suite agree with a threshold the
     // console does not use.
     "function __narrowMax(){ return NARROW_MAX_M; }");
const NARROW_MAX_M = __narrowMax();

// --- synthetic world ------------------------------------------------------- //
// A FRAME, not a bare point. The clearance bodies grabbed into the eval scope above are
// asv_core's now, and those convert through `frame.toEN` rather than `llEN(lat, lon, ref)`.
// planeFrame still carries lat/lon, so ref.lat/ref.lon below are untouched.
const ref = planeFrame({ lat: 42.14, lon: -80.08 });
const cosr = Math.cos(ref.lat * Math.PI / 180);
const enLL = (e, n) => ({ lat: ref.lat + n / M_PER_DEG_LAT, lon: ref.lon + e / (M_PER_DEG_LAT * cosr) });
const toE = (p) => (p.lon - ref.lon) * M_PER_DEG_LAT * cosr;   // recover the east offset (m)
const toN = (p) => (p.lat - ref.lat) * M_PER_DEG_LAT;          // ... and the north offset (m)
const bbOf = (ring) => { let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
  for (const p of ring) { if (p.e < x0) x0 = p.e; if (p.e > x1) x1 = p.e; if (p.n < y0) y0 = p.n; if (p.n > y1) y1 = p.n; }
  return { x0, y0, x1, y1 }; };

// A straight N-S buoyed channel: port-hand (green, odd) buoys on the WEST edge
// (e=-HALF), starboard-hand (red, even) on the EAST edge (e=+HALF), paired across from
// n=100..900. Numbers rise NORTHWARD, so northbound is "inbound"/returning and
// southbound is "outbound" - but nothing in the routing reads that; it is pure geometry.
// The centreline is e=0 and the half-width is HALF, so the lane must ride |e| = HALF/2.
// Clear water (no keep-outs), so obstacle re-routing never triggers.
const HALF = 50;
const WANT = HALF / 2;                 // LANE_FRAC 0.5 of the half-width = ¼ width in from the edge
function channel() {
  const ns = [100, 300, 500, 700, 900];
  const port = ns.map((n, i) => ({ e: -HALF, n, side: -1, num: 2 * i + 1, sys: "CH" }));  // 1,3,5,7,9 (green, west)
  const stbd = ns.map((n, i) => ({ e: HALF, n, side: 1, num: 2 * (i + 1), sys: "CH" }));   // 2,4,6,8,10 (red, east)
  return { polys: [], lines: [], points: [], marks: [...port, ...stbd],
           sys: [{ sys: "CH", port, stbd }] };
}

// Run channelLaneRoute over a base path (list of {e,n}) and return the route in E/N.
// channelLaneRoute returns {route, lane} - the lane fact travels WITH the route it
// describes rather than being left in a module flag (see laneRun below, which asserts it).
function runLane(world, base) {
  const pts = base.map((p) => enLL(p.e, p.n));
  const out = channelLaneRoute(pts, ref, world, 3).route;
  return [pts[0], ...out].map((p) => ({ e: toE(p), n: toN(p) }));   // include the start
}
// The same call, kept whole, for the assertions about what it REPORTS.
function laneRun(world, base) {
  return channelLaneRoute(base.map((p) => enLL(p.e, p.n)), ref, world, 3);
}
// The east offset where the route crosses n = nq. The channel is centred on e=0, so e IS
// the cross-channel offset: 0 = on the centreline, +e = east, -e = west.
function eAtN(track, nq) {
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    if ((a.n - nq) * (b.n - nq) <= 0 && a.n !== b.n) {
      const t = (nq - a.n) / (b.n - a.n); return a.e + (b.e - a.e) * t;
    }
  }
  return null;
}

// --- assertions ------------------------------------------------------------ //
let fails = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!cond) fails++;
}

console.log("Channel-lane routing (ASV) — centreline to PORT, starboard marks to STARBOARD:");

const MIDS = [300, 500, 700];          // sample points deep inside the buoyed stretch

// 1 & 2. THE CORE RULE, both directions. Northbound, starboard is EAST, so the lane must
// sit at +WANT (between the centreline and the EAST/red line) — red to starboard, "red
// right returning". Southbound, starboard is WEST, so the lane sits at -WANT (between
// the centreline and the WEST/green line) — green to starboard. In both cases the
// centreline (e=0) is to PORT. The base path deliberately starts on the WRONG side, so a
// pass means the lane was actively placed, not inherited.
for (const [tag, dir, base] of [
  ["NORTHBOUND (starboard = EAST: red/east line to starboard)", +1, [{ e: -80, n: 0 }, { e: -80, n: 1000 }]],
  ["SOUTHBOUND (starboard = WEST: green/west line to starboard)", -1, [{ e: 80, n: 1000 }, { e: 80, n: 0 }]],
]) {
  const track = runLane(channel(), base);
  const es = MIDS.map((n) => eAtN(track, n));
  const ok = es.every((e) => e != null && e * dir > 0);                       // correct SIDE of the centreline
  check(tag + ": rides starboard of the centreline (centreline to port)", ok,
        "e=" + es.map((e) => e == null ? "null" : e.toFixed(0)).join(",") +
        " (want sign " + (dir > 0 ? "+" : "-") + ", base started on the far side)");
  check(tag + ": lane sits ~half way to the buoy line (¼ width in from the edge)",
        es.every((e) => e != null && Math.abs(Math.abs(e) - WANT) < 12 && Math.abs(e) < HALF - 3),
        "|e|=" + es.map((e) => e == null ? "null" : Math.abs(e).toFixed(0)).join(",") +
        " (want ~" + WANT + ", inside " + HALF + ")");
}

// 3. Opposing transits pass PORT-TO-PORT: the northbound and southbound lanes are on
// opposite sides of the centreline and genuinely separated. This is the whole point of
// the rule, and it is what the operator's two drawn tracks show.
{
  const nb = runLane(channel(), [{ e: 0, n: 0 }, { e: 0, n: 1000 }]);
  const sb = runLane(channel(), [{ e: 0, n: 1000 }, { e: 0, n: 0 }]);
  const sep = MIDS.map((n) => { const a = eAtN(nb, n), b = eAtN(sb, n); return (a == null || b == null) ? null : a - b; });
  check("opposing transits pass port-to-port (lanes on opposite sides, separated)",
        sep.every((s) => s != null && s > WANT),
        "separation=" + sep.map((s) => s == null ? "null" : s.toFixed(0)).join(",") + " m (want > " + WANT + ")");
}

// 4. The transit is DENSIFIED into a smooth, followable track (not a few dog-legging
// waypoints). Guards the smoothTrack resample/round pass.
{
  const track = runLane(channel(), [{ e: -80, n: 0 }, { e: -80, n: 1000 }]);
  let maxGap = 0;
  for (let i = 1; i < track.length; i++) maxGap = Math.max(maxGap, Math.hypot(track[i].e - track[i - 1].e, track[i].n - track[i - 1].n));
  check("channel transit is densified into a smooth track (enough waypoints, small gaps)",
        track.length >= 15 && maxGap < 60,
        track.length + " waypoints, max gap " + maxGap.toFixed(0) + " m (want >=15 wpts, gap <60 m)");
}

// 5. UNMARKED CHANNEL — the same rule with no buoys at all. A channel cut between two
// land banks (the boat-basin exit case): the lane must still ride starboard of the
// centreline, both directions. The centreline here comes from the WATER's own edges.
{
  const bank = (e0, e1) => ({ ring: [{ e: e0, n: -200 }, { e: e1, n: -200 }, { e: e1, n: 1200 }, { e: e0, n: 1200 }] });
  const mk = (r) => ({ ring: r.ring, bb: bbOf(r.ring), kind: "land" });
  const cut = () => ({ polys: [mk(bank(HALF, 400)), mk(bank(-HALF, -400))],   // banks at e=±50
                       lines: [], points: [], marks: [], sys: [] });
  for (const [tag, dir, base] of [
    ["NORTHBOUND", +1, [{ e: 0, n: 0 }, { e: 0, n: 1000 }]],
    ["SOUTHBOUND", -1, [{ e: 0, n: 1000 }, { e: 0, n: 0 }]],
  ]) {
    const track = runLane(cut(), base);
    const es = MIDS.map((n) => eAtN(track, n));
    check("UNMARKED channel " + tag + ": still rides starboard of the centreline",
          es.every((e) => e != null && e * dir > 3 && Math.abs(e) < HALF - 3),
          "e=" + es.map((e) => e == null ? "null" : e.toFixed(0)).join(",") +
          " (want sign " + (dir > 0 ? "+" : "-") + ", inside " + HALF + "; " + (2 * HALF)
          + " m wide, inside the " + NARROW_MAX_M + " m narrow bound)");
  }
}

// 5a. ⚠⚠ AND OPEN WATER GETS NO LANE AT ALL — THE REPORTED DEFECT. Andy, 2026-08-31:
// "Rule 9 is being improperly applied in the current ASV Console implementation. It
// applies only within narrow channels. ... In open bay or open ocean transits and while
// running various survey patterns the rule should not be considered."
//
// There was no width test at all. `narrowChannelLane` called anything a channel if a
// perpendicular march found SOMETHING within max(120, buf*30) on both sides — 150 m at
// the shipped buffer — so a bay with shores 300 m apart was laned, and the console told
// the operator it was complying with a rule of the road while riding a quarter-width
// offset down the middle of open water.
//
// The SAME geometry as check 5, widened past the bound and nothing else changed: banks
// that make a channel 100 m apart make a bay at 400 m, and width is the only thing the
// code is allowed to respond to here.
{
  const bank = (e0, e1) => { const ring = [{ e: e0, n: -200 }, { e: e1, n: -200 },
                                           { e: e1, n: 1200 }, { e: e0, n: 1200 }];
    return { ring, bb: bbOf(ring), kind: "land" }; };
  const wide = () => ({ polys: [bank(200, 900), bank(-200, -900)],   // 400 m apart
                        lines: [], points: [], marks: [], sys: [], chans: [] });
  const track = runLane(wide(), [{ e: 0, n: 0 }, { e: 0, n: 1000 }]);
  const es = MIDS.map((n) => eAtN(track, n));
  check("5a. OPEN BAY (400 m between shores): NO Rule 9 lane — the reported defect",
        es.every((e) => e != null && Math.abs(e) < 3),
        "e=" + es.map((e) => e == null ? "null" : e.toFixed(1)).join(",")
          + " (400 m > the " + NARROW_MAX_M + " m narrow bound, and nothing charts a channel"
          + " here — before this it read a starboard offset)");
  // ... and the plan must not CLAIM a lane either. A banner reading "riding the Rule 9
  // channel lane" over open water is the half of the defect the operator actually sees.
  const r = channelLaneRoute([{ e: 0, n: 0 }, { e: 0, n: 1000 }].map((p) => enLL(p.e, p.n)),
                             ref, wide(), 6);
  check("5a2. ... and the plan does not CLAIM one",
        r.lane === false && r.partial === false,
        "lane=" + r.lane + " partial=" + r.partial);
}

// 5b. A LONE BUOY IS NOT A WALL. A mark is a point you may pass either side of, so it
// must not bound the water the way a bank does. With a breakwater on one side and a
// single buoy on the other, counting the buoy as a channel edge shoved the track TOWARD
// the wall and jogged it back once the buoy passed astern — seen live as a loop by the
// breakwater on an RTH. The track must stay exactly as it is with no buoy present.
{
  const wall = [{ e: 40, n: -500 }, { e: 400, n: -500 }, { e: 400, n: 1500 }, { e: 40, n: 1500 }];
  const world = (withBuoy) => ({
    polys: [{ ring: wall, bb: bbOf(wall), kind: "land" }], lines: [],
    points: withBuoy ? [{ e: -15, n: 500, kind: "a channel buoy" }] : [],
    marks: withBuoy ? [{ e: -15, n: 500, side: -1, num: 7, sys: "X" }] : [], sys: [] });
  const at = (w) => { const t = runLane(w, [{ e: 0, n: 0 }, { e: 0, n: 1000 }]);
    return [420, 500, 580].map((n) => eAtN(t, n)); };
  const noBuoy = at(world(false)), withBuoy = at(world(true));
  check("a lone buoy abeam is NOT treated as a channel wall (no jog toward the wall)",
        withBuoy.every((e, i) => e != null && noBuoy[i] != null && Math.abs(e - noBuoy[i]) < 1.5),
        "with buoy e=" + withBuoy.map((e) => e == null ? "null" : e.toFixed(1)).join(",") +
        "  vs no buoy e=" + noBuoy.map((e) => e == null ? "null" : e.toFixed(1)).join(","));
}

// 6. NO-OP in OPEN WATER: with no buoys and no confining edges, a plain Go-To must not
// be bent toward a channel that isn't there.
{
  const bare = { polys: [], lines: [], points: [], marks: [], sys: [] };
  const track = runLane(bare, [{ e: 30, n: 0 }, { e: 30, n: 1000 }]);
  const es = MIDS.map((n) => eAtN(track, n));
  check("open water (no buoys, no banks): base path is unchanged",
        es.every((e) => e != null && Math.abs(e - 30) < 2),
        "e=" + es.map((e) => e == null ? "null" : e.toFixed(0)).join(",") + " (want 30, unchanged)");
}

// 7. systemCenterline is the buoy-pair midline with the local half-width attached: for
// this symmetric channel it runs up e=0 with hw=HALF, ordered south->north by number.
{
  const cl = systemCenterline(channel().sys[0]);
  check("systemCenterline is the buoy-pair midline (e≈0, hw≈" + HALF + "), ordered by number",
        cl.length === 5 && cl.every((p) => Math.abs(p.e) < 1 && Math.abs(p.hw - HALF) < 1) &&
        cl.every((p, i) => i === 0 || p.n > cl[i - 1].n),
        "n=" + cl.map((p) => p.n.toFixed(0)).join(",") + " hw=" + cl.map((p) => p.hw.toFixed(0)).join(","));
}

// 8-10. THE LANE FACT TRAVELS WITH THE ROUTE, and is not remembered between plans.
// channelLaneRoute used to set a module flag that a banner read afterwards. Two faults
// followed, neither visible from the routing code: a REFUSED plan never called the
// function, so the flag still described the PREVIOUS route; and routePlan calls this once
// per leg, so a per-call flag reported only the last leg. Returning {route, lane} makes
// both impossible - there is no flag to outlive anything.
{
  const straight = [{ e: 0, n: 0 }, { e: 0, n: 1000 }];
  const bare = { polys: [], lines: [], points: [], marks: [], sys: [] };

  check("a transit that rides the channel lane REPORTS that it did",
        laneRun(channel(), straight).lane === true,
        "the banner's claim comes off the plan it describes");

  check("... and one in open water reports that it did NOT",
        laneRun(bare, [{ e: 30, n: 0 }, { e: 30, n: 1000 }]).lane === false,
        "no channel, no Rule 9 note");

  // THE STALENESS CASE, directly: plan a lane, then plan open water. The second answer
  // must be the second route's, not a leftover from the first.
  const first = laneRun(channel(), straight);
  const second = laneRun(bare, [{ e: 30, n: 0 }, { e: 30, n: 1000 }]);
  check("A LANE PLAN FOLLOWED BY AN OPEN-WATER PLAN DOES NOT INHERIT THE LANE",
        first.lane === true && second.lane === false,
        "first=" + first.lane + " second=" + second.lane + " (a remembered flag would say true,true)");
}

// --- 15-19. THE GATE: the lane yields to the nogo model --------------------- //
// Found at Erie (2026-08-06): legPath routed clear, then the lane pass REPLACED the
// route with buoy-gate geometry that crossed a seawall in three places, and nothing
// re-checked it. Mutations RUN, 4/4 caught: gate removed -> 16+19b; exemption
// dropped -> 18 (on the THIRD form of that check: wp[0] survives a splice, a length
// equality broke on clean code because mid-route splices are lawful - wp[1] is the
// observable the exemption actually protects); un-gated fallback -> 19; lane fact
// kept on abandonment -> 19b.
// re-checked the substitution - the banner claimed "routed around nogo zone(s)" about
// a route that no longer existed. The synthetic wall below reproduces the class: a
// pier polygon intrudes into the very line the lane must ride.
function walledChannel(){
  const w = channel();
  const ring = [{e:15,n:480},{e:35,n:480},{e:35,n:520},{e:15,n:520}];
  w.polys = [{ring, bb: bbOf(ring), kind: "land"}];
  return w;
}
const WW = walledChannel();
const NB = [{e:-80,n:0},{e:-80,n:1000}].map(p=>enLL(p.e,p.n));
const badLegsOf = (wps, world) => { let bad=0;
  for(let i=1;i<wps.length;i++) if(!legClear(wps[i-1],wps[i],ref,world,3)) bad++;
  return bad; };
// the UN-gated pipeline, exactly as channelLaneRoute ran before the gate existed
// THE LANE PRODUCERS RETURN {path, used, partial} NOW (asv_core, 2026-08-20) rather than
// writing sea.laneUsed / sea.lanePartial from inside. The pipeline is otherwise identical.
const ungated = (()=>{
  const o = narrowChannelLane(buoyChannelLane(NB, ref, WW, 3).path, ref, WW, 3);
  return [NB[0], ...smoothTrack(o.path, ref, WW, 3)]; })();
check("15. the scenario has TEETH: the un-gated lane pipeline crosses the pier",
      badLegsOf(ungated, WW) >= 1,
      badLegsOf(ungated, WW) + " unlawful leg(s) without the gate - the Erie class, synthetically");
const gatedRun = laneRun(WW, [{e:-80,n:0},{e:-80,n:1000}]);
const gated = [NB[0], ...gatedRun.route];
check("16. THE GATE: every leg of the shipped route passes the SAME legClear the search obeyed",
      badLegsOf(gated, WW) === 0,
      badLegsOf(gated, WW) + " unlawful leg(s) with the gate");
const gtrack = gated.map(p=>({e:toE(p), n:toN(p)}));
check("17. ... and the lane SURVIVES where it is lawful - still riding +¼W away from the pier, lane fact intact",
      gatedRun.lane === true
      && Math.abs(eAtN(gtrack,300) - WANT) < 8 && Math.abs(eAtN(gtrack,700) - WANT) < 8,
      "e@300=" + (eAtN(gtrack,300)||0).toFixed(1) + " e@700=" + (eAtN(gtrack,700)||0).toFixed(1) + " (lane line " + WANT + ")");
// 18. ENDPOINT EXEMPTION: a boat moored INSIDE the buffer must be led out, not
// re-routed around its own berth. The start-adjacent leg stays the pipeline's own.
const dockWorld = walledChannel();
const dring = [{e:-84,n:-6},{e:-78,n:-6},{e:-78,n:-2},{e:-84,n:-2}];
dockWorld.polys.push({ring: dring, bb: bbOf(dring), kind: "land"});
const moored = laneRun(dockWorld, [{e:-80,n:0},{e:-80,n:1000}]);   // start ~2 m off the dock face
const mooredUngated = (()=>{
  const o = narrowChannelLane(buoyChannelLane(NB, ref, dockWorld, 3).path, ref, dockWorld, 3);
  return smoothTrack(o.path, ref, dockWorld, 3); })();
check("18. a start INSIDE the buffer is exempt: the berth leg ships UNCHANGED - same shape, no spliced detour around the boat's own dock",
      Math.abs(toE(moored.route[1]) - toE(mooredUngated[1])) < 1
      && Math.abs(toN(moored.route[1]) - toN(mooredUngated[1])) < 1,
      "wp[1] must be the pipeline's own - a dropped exemption REPLACES it with a spliced detour around the berth (wp[0] alone cannot see that; mid-route splices elsewhere are lawful and expected)");
// 19. THE LAW CANNOT PATCH -> the lawful pre-lane input ships, and the lane fact
// goes with it (a Rule 9 banner over an abandoned lane would be a lie).
const realLegPath = legPath;
legPath = () => null;
const gres = gateLegClear(ungated, NB, ref, WW, 3);
legPath = realLegPath;
check("19. when legPath cannot patch a stretch, the pre-lane input ships and `abandoned` says so",
      gres.abandoned === true && gres.route.length === NB.length
      && Math.abs(toN(gres.route[gres.route.length-1]) - 1000) < 1,
      "fallback = the legPath-clear input, flagged");
// WAS A SOURCE-TEXT CHECK, AND IS BEHAVIOURAL NOW. It used to grep MODSRC for the literal
// `lane: sea.laneUsed && !g.abandoned`. That regex stopped being able to fail for the right
// reason the moment the body moved to asv_core and stopped writing sea.* -- and a check
// that greps for a line it can no longer find is not testing the rule, it is testing where
// the rule is written. This runs the real pipeline with legPath stubbed out, so the gate
// genuinely abandons, and asserts the FACT.
legPath = () => null;
const abandonedRun = channelLaneRoute(NB, ref, WW, 3);
legPath = realLegPath;
check("19b. ... and channelLaneRoute demotes the lane fact on abandonment",
      abandonedRun.lane === false,
      "lane=" + abandonedRun.lane + " - the banner must never claim a lane the gate threw away");

// --- the vessel block must be reached THROUGH V, in every module ---------------------- //
// THIS CHECK EXISTS BECAUSE THIS SUITE HID THE BUG IT SHOULD HAVE CAUGHT. The eval above
// stubs `let CHANNEL_REACH_M = null` into its own scope so the default reach is exercised.
// When Rule 9 moved to passage.js it took a BARE `CHANNEL_REACH_M` with it - undefined in
// the browser, where the value lives on V. Every check here still passed, because the stub
// satisfied the reference; the console threw "CHANNEL_REACH_M is not defined" the moment a
// route was planned for real, and only a live probe found it.
//
// So this reads the module SOURCE rather than running it: a stub cannot mask a name that is
// never resolved here at all. Vessel parameters are reassigned on every hull switch, which
// is exactly why they must be read through V and never captured loose.
{
  const VESSEL_KEYS = ["VESSEL", "SPEED_KN", "MAX_TURN_RATE_DEG_S", "NOGO_MIN_DEPTH_M",
                       "NOGO_BUFFER_M", "CHANNEL_REACH_M", "WRECK_RADIUS_M"];
  const modDir = path.join(__dirname, "..", "static", "js");
  const bare = [];
  for (const f of fs.readdirSync(modDir).filter(x => x.endsWith(".js") && x !== "state.js")) {
    const src = fs.readFileSync(path.join(modDir, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");      // comments name these constants freely
    for (const k of VESSEL_KEYS) {
      if (new RegExp("(?<![\\w.$])" + k + "\\b").test(src)) bare.push(f + ":" + k);
    }
  }
  check("20. no module reads a vessel parameter loose — every one goes through V",
        bare.length === 0,
        bare.length ? bare.join(", ") : "checked " + VESSEL_KEYS.length + " names across the modules");
}

// --- 21-27: WHERE THE LANE LETS GO ---------------------------------------------------- //
// THE CLAUSE THIS SUITE HAD NO CHECK FOR, and the reason it passed for nine days over a
// lane that was measurably not doing it. The operator's rule, verbatim: stay a quarter
// width to the vessel's own right "whether entering or leaving ... hold this until past
// the extent of the channel as expressed on the chart or at the final set of buoys that
// mark that channel and only that channel."
//
// Every check above samples MIDS = 300/500/700 - deep inside the buoyage, where the lane
// was never in doubt. Nothing looked at an END. Measured on THIS world before the fix:
// the offset was already decaying 50 m inside the channel (24.3 at n=850), was 21.3 AT
// the final pair, and 7.0 one channel width past it, where the deleted channelEndExtend
// rule required it held. A vessel that lets go at the mouth cuts back across the fairway
// exactly where converging traffic expects it to stand on.
//
// The channel here is the same one: pairs at n=100..900, half-width 50, lane target 25.
// One channel WIDTH past the last pair is therefore n=1000.
{
  const CH = channel();
  const runEnds = (base, w) => {
    const pts = base.map((p) => enLL(p.e, p.n));
    const r = channelLaneRoute(pts, ref, w || CH, 3);
    return { track: [pts[0], ...r.route].map((p) => ({ e: toE(p), n: toN(p) })),
             lane: r.lane, partial: r.partial };
  };
  const fmt = (es) => es.map((e) => e == null ? "null" : e.toFixed(1)).join(",");

  // 21. LEAVING: the full offset must still be there AT the final pair. A lane that has
  // begun releasing before the last mark is not "held until past the extent".
  {
    const t = runEnds([{ e: 0, n: -200 }, { e: 0, n: 1400 }]).track;
    const es = [850, 900].map((n) => eAtN(t, n));
    check("21. LEAVING: the lane still holds the full ¼ width AT the final buoy pair",
          es.every((e) => e != null && e > WANT - 2),
          "e@850,900 = " + fmt(es) + " (want > " + (WANT - 2) + "; measured 24.3 / 21.3 before the fix)");
  }
  // 22. STAND ON past the mouth. The centreline is extended one full channel width beyond
  // the last pair (extendCenterline), so the lane is still substantially there at n=1000
  // and only then releases. This is the deleted channelEndExtend convention, restored.
  {
    const t = runEnds([{ e: 0, n: -200 }, { e: 0, n: 1400 }]).track;
    const e1000 = eAtN(t, 1000), e1300 = eAtN(t, 1300);
    check("22. STAND-ON: the lane is still held one channel width past the final pair, and released well after",
          e1000 != null && e1000 > WANT * 0.7 && e1300 != null && Math.abs(e1300) < 3,
          "e@1000 = " + (e1000 == null ? "null" : e1000.toFixed(1)) + " (want > " + (WANT * 0.7).toFixed(1) +
          "; was 7.0), e@1300 = " + (e1300 == null ? "null" : e1300.toFixed(1)) + " (released)");
  }
  // 23. ENTERING is the same rule run backwards - the boat must be ON the lane before it
  // reaches the first mark, not still crossing to it. Southbound, "the first pair" is the
  // n=900 end and the approach runs down from n=1400.
  {
    const t = runEnds([{ e: 0, n: 1400 }, { e: 0, n: -200 }]).track;
    const es = [1000, 900].map((n) => eAtN(t, n));
    check("23. ENTERING: the lane is established BEFORE the first pair, and on the correct side",
          es.every((e) => e != null && e < -(WANT - 4)),
          "e@1000,900 = " + fmt(es) + " (southbound: starboard is WEST, want <= -" + (WANT - 4) + ")");
  }
  // 24. "THE EXTENT OF THE CHANNEL AS EXPRESSED ON THE CHART" - a dredged area running
  // 500 m past the last buoy pair IS the channel there, and the lane must hold to its end
  // rather than to the buoyage. Before this, charted extent was never an input to the
  // lane at all: channelPolys fed only the survey clip.
  {
    const ring = [{ e: -HALF, n: -300 }, { e: HALF, n: -300 }, { e: HALF, n: 1400 }, { e: -HALF, n: 1400 }];
    const W = { ...channel(), chans: [{ ring, bb: bbOf(ring) }] };
    const t = runEnds([{ e: 0, n: -200 }, { e: 0, n: 1800 }], W).track;
    const es = [1100, 1300].map((n) => eAtN(t, n));
    check("24. CHARTED EXTENT: the lane holds to the end of the charted channel, not the last buoy",
          es.every((e) => e != null && e > WANT - 2),
          "e@1100,1300 = " + fmt(es) + " (dredged area ends n=1400; buoyage ends n=900)");
  }
  // 25. "THAT CHANNEL AND ONLY THAT CHANNEL". Two separately-named buoyed channels with
  // an 800 m unmarked gap: the lane must NOT be held across the gap, or the extension has
  // chained two channels into one and is steering off the marks of neither.
  {
    const two = (() => {
      const mkSys = (ns, sys, off) => {
        const port = ns.map((n, i) => ({ e: -HALF, n, side: -1, num: off + 2 * i + 1, sys }));
        const stbd = ns.map((n, i) => ({ e: HALF, n, side: 1, num: off + 2 * (i + 1), sys }));
        return { sys, port, stbd };
      };
      const A = mkSys([100, 300, 500], "alpha", 0), B = mkSys([1300, 1500, 1700], "bravo", 0);
      return { polys: [], lines: [], points: [], chans: [],
               marks: [...A.port, ...A.stbd, ...B.port, ...B.stbd], sys: [A, B] };
    })();
    const r = runEnds([{ e: 0, n: -200 }, { e: 0, n: 2000 }], two);
    const gap = [900, 1100].map((n) => eAtN(r.track, n));
    check("25. ONLY THAT CHANNEL: the lane is not held across the gap between two separate channels",
          gap.every((e) => e != null && Math.abs(e) < 5),
          "e@900,1100 (mid-gap) = " + fmt(gap) + " (want ~0 — a chained centreline would hold ±" + WANT + ")");
    // 26. ... and the banner says so. Only ONE buoy system is laned per leg, so a route
    // down two channels rides the second DEAD ON ITS CENTRELINE - the head-on position.
    // The plan may not describe that as a clean Rule 9 transit.
    check("26. HONEST BANNER: a route that laned only one of two channels reports `partial`",
          r.lane === true && r.partial === true,
          "lane=" + r.lane + " partial=" + r.partial + " (a lane was ridden, but not over all of it)");
  }
  // 27. THE WIDENING KNOB MAY ONLY WIDEN. channel_reach_m was added to REACH FURTHER so
  // keep-right would engage in a wide fairway; the rework rewired it as a REPLACEMENT
  // (`override ?? buf*30`), so the DriX's 120 silently cut its own 180 m default reach by
  // a third and stretches of the home channel got no lane at all. Banks at ±150 with
  // buf=6: reachable at the buf*30 default of 180, NOT at the override's 120.
  {
    const bank = (e0, e1) => { const ring = [{ e: e0, n: -200 }, { e: e1, n: -200 }, { e: e1, n: 1200 }, { e: e0, n: 1200 }];
      return { ring, bb: bbOf(ring), kind: "land" }; };
    // ⚠ A CHARTED CHANNEL, because 300 m of water is NOT a narrow channel by geometry any
    // more (NARROW_MAX_M, 2026-08-31) and without one this fixture would test nothing but
    // the new width bound. It is also the honest shape for what the knob is FOR: reaching
    // the far edge of a WIDE charted fairway is the whole reason channel_reach_m exists.
    const fairway = { ring: [{ e: -150, n: -200 }, { e: 150, n: -200 },
                             { e: 150, n: 1200 }, { e: -150, n: 1200 }] };
    fairway.bb = bbOf(fairway.ring);
    const wide = { polys: [bank(150, 600), bank(-150, -600)], lines: [], points: [], marks: [],
                   sys: [], chans: [fairway] };
    const prev = V.CHANNEL_REACH_M;
    V.CHANNEL_REACH_M = 120;                       // the DriX's own value, BELOW buf*30 = 180
    const pts = [{ e: 0, n: 0 }, { e: 0, n: 1000 }].map((p) => enLL(p.e, p.n));
    const track = [pts[0], ...channelLaneRoute(pts, ref, wide, 6).route].map((p) => ({ e: toE(p), n: toN(p) }));
    V.CHANNEL_REACH_M = prev;
    const es = MIDS.map((n) => eAtN(track, n));
    check("27. a channel_reach_m BELOW the default cannot narrow the wall search — the knob only widens",
          es.every((e) => e != null && e > 3),
          "e=" + fmt(es) + " (banks ±150, buf 6: needs reach 180, override says 120; " +
          "as a replacement this reads 0,0,0 — no lane)");
  }
}

// --- 28: THE KNOT PRUNE LIVES IN THE PRODUCER ----------------------------------------- //
// Flown at Lewes (session 20260810-131214): the Upload plan carried two 3-4 m REVERSAL
// steps at the mouth of Roosevelt Inlet — a gate splice seam that rejoined behind the
// point it left — and the DriX at 13.8 kn (turn radius ~20 m) orbited a full 360° trying
// to fly them. planNogoRoute pruned its own output so Go-To/RTH never showed this;
// routePlan took the lane output RAW. The fix moved pruneStitch INTO channelLaneRoute.
// No synthetic world here folds the seam (measured: the pier world splices but does not
// knot — the fold needed the real ENC's confluence), so the guard is two-part, the same
// split as 19/19b: the MECHANISM is proven functionally, and the WIRING is pinned in the
// module source. The real-geometry reproduction lives in the session log, replayed
// offline during the fix; its numbers are in CLAUDE.md "THE CIRCLE AT THE MOUTH".
{
  // 28. the mechanism: pruneStitch unfolds a 3 m reversal whose neighbours connect clear.
  const knotted = [
    { e: 0, n: 0 }, { e: 0, n: 60 },
    { e: -2, n: 57 },                        // the Lewes shape: a tiny step BACKWARDS
    { e: 8, n: 78 }, { e: 40, n: 120 },
  ].map((p) => enLL(p.e, p.n));
  const un = pruneStitch(knotted, ref, { polys: [], lines: [], points: [], marks: [], sys: [] }, 3);
  const turns = [];
  for (let i = 1; i < un.length - 1; i++) {
    const t = ((azTo(un[i], un[i + 1]) - azTo(un[i - 1], un[i]) + 540) % 360) - 180;
    turns.push(Math.abs(t));
  }
  check("28. pruneStitch unfolds a reversal knot the boat cannot fly",
        un.length < knotted.length && turns.every((t) => t <= 150),
        "5 wpts with a 3 m back-step -> " + un.length + " wpts, max turn " +
        (turns.length ? Math.max(...turns).toFixed(0) : "0") + "° (a 20 m-radius hull orbits a 177° reversal)");
  // 28b. the wiring: channelLaneRoute prunes THE GATE'S OWN OUTPUT — after the law, so a
  // splice seam cannot ship, and before the return, so every consumer inherits it.
  // (routePlan taking kr.route raw is exactly the path that carried the knot to the boat.)
  check("28b. channelLaneRoute ships the gate's output through the knot prune",
        /pruneStitch\(g\.route/.test(MODSRC),
        "the prune must run on gateLegClear's route inside the producer, not in one caller");
}

console.log(fails ? "\nFAILED (" + fails + ")" : "\nPASS");
process.exit(fails ? 1 : 0);
