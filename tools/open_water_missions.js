// tools/open_water_missions.js - OPEN WATER FIRST, flown over HIS charts in the waters he runs (2026-10-14).
//
// Andy: "Look at the image included and try to generate logic that would emulate the path the red line follows. Generate
// logic that would emulate this in our mission tests in our areas of experimentation." His chart is too big to cut a
// suite fixture of at this scale, so this replays Go-Tos in his waters - his own two (Castine to the Thorofare, New Castle to Gloucester) and
// eleven more across the same four areas - over the console's own chart cache (charts/enc, tile_v3_*),
// each planned twice by the page's own planNogoRoute - the shortest clear way (V.OPEN_WATER false, the planner before
// 2026-10-14) and open water first - for the DriX H-8 with the EM712 gondola as the console sets her (floor 4.0 m, buffer
// 5 m, transit standoff 20 m, +0.5 m of water). Each route is measured against the chart's DANGERS - land, shoal water,
// rocks, wrecks, structures; its buoys aside, which the Rule 9 lane passes 10-35 m off by design - for its least
// clearance, the meters of it within 100 / 250 / 500 m of one, and its turns of more than 20 degrees.
//
// A case PASSES when open water first, taken, runs no more of its length within 250 m of a danger than the shortest way,
// is no more than (1 + DETOUR_MAX) its length, leaves no more marks on the wrong hand, and stays inside the chart read
// (a tile of the area not in the cache is UNREAD water, as the page holds a square no chart covers: no route enters it);
// and when kept, is the shortest way exactly. Castine -> the Fox Islands Thorofare (his Go-To and his drawing) must also
// run down the open bay WEST of North Haven, where the shortest way threads the islands east of it.
//
//   node tools/open_water_missions.js [--charts DIR] [--area NAME] [--case NAME] [--json OUT]
//     DIR   the chart cache (default: charts/enc beside this repo's asv_console.py; his console's is D:\Claude\ASV\charts\enc)
//   exit 0: every case compared passed (one whose start or end, or whose shortest way, needs a tile not in the cache is
//   SKIPPED or NOT COMPARED, and said); 1: a case failed.
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const JS = (f) => path.join(ROOT, "static", "js", f);
const { V, nogo, sea } = require(JS("state.js"));
const { planeFrame } = require(JS("geodesy.js"));
const { buildKeepouts, buildMargin } = require(JS("chart.js"));
const P = require(JS("passage.js"));
const K = require(JS("keepouts.js"));
const OW = require(JS("openwater.js"));

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const CHARTS = arg("--charts") || path.join(ROOT, "charts", "enc");

// HIS WATERS. Each area's box is the chart read for its cases (the planners route inside it, CHART_EDGE_M in).
const AREAS = {
  penobscot: { box: [-69.16, 43.98, -68.58, 44.50], cases: [
    { name: "castine_thorofare", from: [44.387854, -68.795047], to: [44.108639, -68.922784], note: "his Go-To and drawing, 2026-10-14",
      west: { lat: 44.15, lonBelow: -68.91, say: "down the open bay west of North Haven" } },
    { name: "castine_rockland", from: [44.388, -68.795], to: [44.100, -69.075] },
    { name: "camden_castine", from: [44.203, -69.033], to: [44.388, -68.795] },
    { name: "rockland_eggemoggin", from: [44.100, -69.075], to: [44.315, -68.740] } ] },
  casco: { box: [-70.36, 43.42, -69.80, 43.92], cases: [
    { name: "portland_harpswell", from: [43.630, -70.200], to: [43.745, -70.050], note: "inside the Casco Bay islands" },
    { name: "portland_woodisland", from: [43.630, -70.200], to: [43.462, -70.330] },
    { name: "portland_boothbay_approach", from: [43.630, -70.200], to: [43.720, -69.860] },
    { name: "portland_eastcasco", from: [43.630, -70.200], to: [43.700, -70.030], note: "past the outer islands" } ] },
  piscataqua: { box: [-70.85, 42.90, -70.45, 43.20], cases: [
    { name: "newcastle_shoals", from: [43.070, -70.705], to: [42.980, -70.617] },
    { name: "newcastle_york", from: [43.070, -70.705], to: [43.130, -70.620] },
    { name: "shoals_rye", from: [42.980, -70.617], to: [43.000, -70.730] } ] },
  capeann: { box: [-70.85, 42.52, -70.45, 43.12], cases: [
    { name: "newcastle_gloucester", from: [43.070, -70.705], to: [42.600, -70.660], note: "his 61 km Go-To, 2026-10-12" },
    { name: "gloucester_rockport", from: [42.600, -70.660], to: [42.660, -70.600] } ] },
};

function tilesFor(B) {
  if (!fs.existsSync(CHARTS)) return [];
  return fs.readdirSync(CHARTS).filter((f) => /^tile_v3_/.test(f)).filter((f) => {
    const [w, s, e, n] = f.replace("tile_v3_", "").replace(".jsonl", "").split("_").map(Number);
    return e > B.W && w < B.E && n > B.S && s < B.N;
  });
}
function loadFeats(B, tiles) {
  const inBox = (c) => c[0] >= B.W && c[0] <= B.E && c[1] >= B.S && c[1] <= B.N;
  const any = (g, f) => { const walk = (x) => (Array.isArray(x[0]) ? x.some(walk) : f(x)); return walk(g.coordinates); };
  const feats = [], seen = new Set();
  for (const t of tiles) {
    for (const ln of fs.readFileSync(path.join(CHARTS, t), "utf8").split("\n").slice(1)) {
      if (!ln.trim()) continue;
      let r; try { r = JSON.parse(ln); } catch (e) { continue; }
      if (!r.geometry || !r.geometry.coordinates || r.role === "extra" || r.role === "depth_contour") continue;
      if (!any(r.geometry, inBox)) continue;
      const key = r.cls + JSON.stringify(r.geometry).slice(0, 200);          // a feature two tiles both carry, once
      if (seen.has(key)) continue;
      seen.add(key);
      feats.push(r);
    }
  }
  return feats;
}
// every tile the box needs, or the tiles it lacks
function missingTiles(B, have) {
  const out = [];
  for (let w = Math.floor(B.W * 4) / 4; w < B.E; w += 0.25)
    for (let s = Math.floor(B.S * 4) / 4; s < B.N; s += 0.25) {
      const nm = "tile_v3_" + w.toFixed(4) + "_" + s.toFixed(4) + "_" + (w + 0.25).toFixed(4) + "_" + (s + 0.25).toFixed(4) + ".jsonl";
      if (!have.includes(nm)) out.push(nm);
    }
  return out;
}

const isBuoy = (q) => q.kind === "a channel buoy" || /^Buoy_/.test(q.cls || "");
function measure(F, ko, r) {
  const D = { ...ko, points: (ko.points || []).filter((q) => !isBuoy(q)) };
  let L = 0, least = Infinity, w100 = 0, w250 = 0, w500 = 0, turns = 0;
  for (let i = 1; i < r.length; i++) {
    const a = F.toEN(r[i - 1]), b = F.toEN(r[i]), len = Math.hypot(b.e - a.e, b.n - a.n), n = Math.max(1, Math.ceil(len / 20));
    L += len;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, c = Math.min(600, K.clearanceM({ e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t }, D, 600));
      least = Math.min(least, c);
      if (c < 100) w100 += len / n; if (c < 250) w250 += len / n; if (c < 500) w500 += len / n;
    }
  }
  for (let i = 1; i < r.length - 1; i++) {
    const t = Math.abs(((F.azTo(r[i], r[i + 1]) - F.azTo(r[i - 1], r[i]) + 540) % 360) - 180);
    if (t > 20) turns++;
  }
  return { m: L, least, w100, w250, w500, turns };
}
const lonAt = (r, lat) => { for (let i = 1; i < r.length; i++) { const a = r[i - 1], b = r[i];
  if ((a.lat - lat) * (b.lat - lat) <= 0 && a.lat !== b.lat) return a.lon + (b.lon - a.lon) * (lat - a.lat) / (b.lat - a.lat); } return null; };

const onlyArea = arg("--area"), onlyCase = arg("--case"), out = [];
let failed = 0, flown = 0, skipped = 0;
const km = (m) => (m / 1000).toFixed(2);
for (const [aName, A] of Object.entries(AREAS)) {
  if (onlyArea && onlyArea !== aName) continue;
  const [W, S, E, N] = A.box, B = { W, S, E, N };
  const tiles = tilesFor(B);
  if (!tiles.length) { console.log("== " + aName + ": SKIPPED - no chart tile of it in " + CHARTS); skipped += A.cases.length; continue; }
  // the area's tiles not in the cache: unread squares, as the page's nogo.unread
  const unread = missingTiles(B, tiles).map((f) => { const [w, s, e, n] = f.replace("tile_v3_", "").replace(".jsonl", "").split("_").map(Number);
    return { W: w, S: s, E: e, N: n, failed: false }; });
  let t0 = Date.now();
  const feats = loadFeats(B, tiles);
  V.NOGO_MIN_DEPTH_M = 3.15; V.OPER_MIN_DEPTH_M = 4.0; V.NOGO_BUFFER_M = 5; V.AIR_DRAFT_M = 2.85; V.OVERHEAD_CLEARANCE_M = 1.0;
  sea.waterOffset = 0.5;
  const F = planeFrame({ lat: (S + N) / 2, lon: (W + E) / 2 });
  const ENF = { land: true, depth: true, haz: true, area: false, wreck: true, chan: true };
  const ko = buildKeepouts(F, ENF, { min: V.OPER_MIN_DEPTH_M, max: 0 }, feats);
  ko.margin = buildMargin(F, ENF, { min: V.OPER_MIN_DEPTH_M, max: 0 }, feats, undefined, ko);
  Object.assign(nogo, { ready: true, frame: F, ko, buffer: 5, bbox: B, unread: unread.length ? unread : null, ais: null });
  console.log("== " + aName + ": " + tiles.length + " tiles, " + feats.length + " features, model " + (Date.now() - t0) + " ms"
              + (unread.length ? "; " + unread.length + " tile(s) not in the cache, held as unread water" : ""));
  for (const c of A.cases) {
    if (onlyCase && onlyCase !== c.name) continue;
    const from = { lat: c.from[0], lon: c.from[1] }, to = { lat: c.to[0], lon: c.to[1] }, res = {};
    // its own two ends must be charted
    const inUnread = (q) => unread.some((r) => q.lat >= r.S && q.lat <= r.N && q.lon >= r.W && q.lon <= r.E);
    if (inUnread(from) || inUnread(to)) { console.log("  " + c.name.padEnd(28) + "SKIPPED - its start or end lies in a tile not in the cache"); skipped++; continue; }
    for (const [k, on] of [["today", false], ["open", true]]) {
      V.OPEN_WATER = on;
      t0 = Date.now();
      const r = P.planNogoRoute(from, to, { holdR: 20, setMs: 0, standoffM: 20 });
      const ms = Date.now() - t0;
      if (r.error) { res[k] = { error: r.error, ms }; continue; }
      const route = [from, ...r.route];
      res[k] = { ms, route, ow: r.openWater, ...measure(F, ko, route), wrong: (r.how && r.how.marks && r.how.marks.wrong) || 0,
                 inside: !P.beyondChart(route, B, undefined, nogo.unread) };
    }
    V.OPEN_WATER = true;
    flown++;
    const t = res.today, o = res.open, why = [];
    // the shortest way refused where open water first was not (a tile it would need is not in the cache): nothing to
    // compare against - said, and counted with the skipped, not as a failure of either
    const noCompare = t.error && !o.error;
    if (o.error) why.push("planned: " + o.error);
    else if (noCompare) { /* below */ }
    else if (o.ow && o.ow.used) {
      if (o.w250 > t.w250 + 1) why.push("more within 250 m (" + Math.round(o.w250) + " vs " + Math.round(t.w250) + ")");
      if (o.m > (1 + OW.OPEN_WATER.DETOUR_MAX) * t.m) why.push("past the detour cap");
      if (o.wrong > t.wrong) why.push(o.wrong + " mark(s) on the wrong hand");
      if (!o.inside) why.push("outside the chart read");
    } else if (JSON.stringify(o.route) !== JSON.stringify(t.route)) why.push("kept, but not the shortest way's route");
    if (c.west && !o.error) {
      const lon = lonAt(o.route, c.west.lat);
      if (!(lon != null && lon < c.west.lonBelow)) why.push("not " + c.west.say + " (" + (lon == null ? "never crosses" : lon.toFixed(4)) + " at " + c.west.lat + " N)");
    }
    if (why.length) failed++;
    else if (noCompare) { flown--; skipped++; }
    const fmt = (x) => (x.error ? "ERROR " + x.error : `${km(x.m)} km  least ${Math.round(x.least)} m  <100 ${Math.round(x.w100)}  <250 ${Math.round(x.w250)}  <500 ${Math.round(x.w500)}  turns ${x.turns}  ${x.ms} ms`);
    console.log("  " + c.name.padEnd(28) + "shortest:   " + fmt(t));
    console.log("  " + "".padEnd(28) + "open water: " + fmt(o) + (o.ow ? "  [" + (o.ow.used ? "TAKEN @" + o.ow.clearM + " m" + (o.ow.held ? ", the close-in way held past " + o.ow.held + " buoy(s)" : "") : "kept: " + o.ow.why) + "]" : ""));
    console.log("  " + "".padEnd(28) + (why.length ? "FAIL: " + why.join("; ") : noCompare ? "NOT COMPARED - the shortest way was refused here" : "pass")
                + (c.note ? "   (" + c.note + ")" : ""));
    out.push({ area: aName, name: c.name, today: { ...t, route: undefined }, open: { ...o, route: undefined }, routes: { today: t.route, open: o.route }, fail: why });
  }
}
const j = arg("--json");
if (j) fs.writeFileSync(j, JSON.stringify(out));
console.log("\n" + flown + " case(s) compared, " + skipped + " skipped or not compared (a chart tile not in the cache), " + failed + " failed");
process.exit(failed ? 1 : 0);
