// tests/buoy_lane.js - channel-LANE routing regression test (the operator's spec).
//
// Ported from the Z-Boat sibling 2026-07-31 along with the routing. Same contract,
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
// Runs the REAL channelLaneRoute / systemCenterline from static/routing.js (geometry
// helpers pulled from static/zboat.html) against a synthetic buoyed channel.
//
//   node tests/buoy_lane.js      # exit 0 = pass, 1 = fail   (stdlib Node, no deps)
//
// TEETH: flip the starboard unit in channelLaneRoute (sbe/sbn), drop LANE_FRAC to 0, or
// neuter the function, and the side / lane-position assertions below fail.
//
// NOTE: no "use strict" - classic browser <script>s (routing.js + the inline script)
// run sloppy and share one global scope; the eval below reproduces that.

const fs = require("fs");
const path = require("path");

const STATIC = path.join(__dirname, "..", "static");
const H = fs.readFileSync(path.join(STATIC, "asv.html"), "utf8");

// Pull a `function NAME(...) { ... }` definition out of a source file by brace matching.
function grab(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = src.indexOf("{", start), depth = 0;
  for (;;) { const c = src[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return src.slice(start, k + 1);
}

// Pull a module-level declaration (`const X = ...;` / `let X = ...;`) out verbatim, so
// the test uses the REAL tuning value rather than a copy that can drift.
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}

// Geometry helpers + the whole route-search cluster - all in static/asv.html here.
const HELPERS = ["llEN", "fromEN", "blocked", "inBB", "pinp", "dSeg", "distTo", "azTo",
                 "stampSeg", "dilateGrid", "rasterKeepouts", "routeAround", "snapClearLL",
                 "routeAroundSeg", "pruneStitch", "legClear", "legPath",
                 "smoothTrack", "systemCenterline", "buoyChannelLane",
                 "narrowChannelLane", "channelLaneRoute"];
const M_PER_DEG_LAT = 111320.0;

// One classic scope, exactly like the browser (routing.js + the inline script share
// globals). Direct eval leaks the function declarations into this module scope, so
// channelLaneRoute / systemCenterline are callable directly below.
// eslint-disable-next-line no-eval
eval("const M_PER_DEG_LAT=" + M_PER_DEG_LAT + ";\n" +
     "const SEG_LEN_M=2200;\nlet CHANNEL_REACH_M=null;\n" +          // vessel override: default reach
     grabDecl("LANE_FRAC") + "\n" + grabDecl("lastChannelLane") + "\n" +
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
function runLane(world, base) {
  const pts = base.map((p) => enLL(p.e, p.n));
  const out = channelLaneRoute(pts, ref, world, 3);
  return [pts[0], ...out].map((p) => ({ e: toE(p), n: toN(p) }));   // include the start
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

console.log(fails ? "\nFAILED (" + fails + ")" : "\nPASS");
process.exit(fails ? 1 : 0);
