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

const fs = require("fs");
const path = require("path");

// LAYER-0 HELPERS COME FROM THE REAL MODULES, not from asv.html's source text.
// These moved out of the page on 2026-08-09. Requiring them means a renamed or
// deleted export fails HERE, loudly, instead of silently reverting to a stale copy;
// and the checks below exercise the shipped function rather than an eval of its text.
// Top-level so the suite's DIRECT eval() of page functions still resolves them.
const { azTo, distTo, fromEN, llEN } = require("../static/js/geodesy.js");
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

const STATIC = path.join(__dirname, "..", "static");
const { sea } = require("../static/js/state.js");
const H = fs.readFileSync(path.join(STATIC, "asv.html"), "utf8");

// Pull a `function NAME(...) { ... }` definition out of a source file by brace matching.
function grab(src, name) {
  if (src.indexOf("function " + name + "(") < 0) src = MODSRC;
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = src.indexOf("{", start), depth = 0;
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
                 "smoothTrack", "systemCenterline", "buoyChannelLane",
                 "narrowChannelLane", "channelLaneRoute"];
const M_PER_DEG_LAT = 111320.0;

// One classic scope, exactly like the browser (routing.js + the inline script share
// globals). Direct eval leaks the function declarations into this module scope, so
// channelLaneRoute / systemCenterline are callable directly below.
// eslint-disable-next-line no-eval
eval("const M_PER_DEG_LAT=" + M_PER_DEG_LAT + ";\n" +
     "const SEG_LEN_M=2200;\nlet CHANNEL_REACH_M=null;\n" +          // vessel override: default reach
     // `laneUsed` became `sea.laneUsed` when Rule 9 moved to passage.js, so the eval'd
     // bodies below write into the SHARED state object rather than a local of their own -
     // which is what lets the checks below read back what the router actually did.
     grabDecl("LANE_FRAC") + "\n" +
     HELPERS.map((n) => grab(H, n)).join("\n"));

// --- synthetic world ------------------------------------------------------- //
const ref = { lat: 42.14, lon: -80.08 };
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
          " (want sign " + (dir > 0 ? "+" : "-") + ", inside " + HALF + ")");
  }
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
const ungated = (()=>{ sea.laneUsed=false;
  let o = buoyChannelLane(NB, ref, WW, 3); o = narrowChannelLane(o, ref, WW, 3);
  return [NB[0], ...smoothTrack(o, ref, WW, 3)]; })();
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
const mooredUngated = (()=>{ sea.laneUsed=false;
  let o = buoyChannelLane(NB, ref, dockWorld, 3); o = narrowChannelLane(o, ref, dockWorld, 3);
  return smoothTrack(o, ref, dockWorld, 3); })();
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
check("19b. ... and channelLaneRoute demotes the lane fact on abandonment",
      // channelLaneRoute lives in passage.js now, so this source-shape check reads the
      // modules rather than the page. MODSRC strips `export `, so the text is unchanged.
      /lane: sea\.laneUsed && !g\.abandoned/.test(MODSRC),
      "the banner must never claim a lane the gate threw away");

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

console.log(fails ? "\nFAILED (" + fails + ")" : "\nPASS");
process.exit(fails ? 1 : 0);
