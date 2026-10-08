// tests/chart_box.js - A ROUTE RUNS ONLY OVER WATER THE CHART WAS READ OVER.
//
// Found 2026-10-03 on the live check of the ENC-first Rule 9 lane, on a fresh console: a Go-To from New Castle up the
// Piscataqua to a pier at Adams Point. The keep-out model holds the features of ONE box - `nogo.bbox`, the extract's
// own - and outside it the model holds NOTHING, which every clearance test reads as clear water, not as unknown. A
// command reads the chart over a box round the boat and the target, padded 300 m and joined to the operating area
// (ensureNogoCovers), and the router's search reaches 900 m to 8 km past the straight line. The route ran 429 m past
// the box's north edge, and replayed on his full chart 21 of its 402 legs were not clear: 10 over land, 7 over water
// shallower than the floor, 4 through charted hazards. His own console flew the same Go-To clear only because an
// earlier command had widened its box past them.
//
// THE CONTRACT THIS FILE HOLDS:
//   1. beyondChart judges a route against the box: every point at least CHART_EDGE_M inside every edge, or what ran
//      past - the FIRST point that did, the farthest any stood beyond the box, every point of the route;
//   2. planNogoRoute REFUSES such a route (mode "uncharted", no `route` to fly), and routePlan returns it with
//      `uncharted` beside it; a planner given no box judges nothing, and a route inside the box is untouched;
//   3. the page's planInsideChart reads the chart over a refused route and plans again - each round over the water the
//      last route used, the plan's own water read again after it - and refuses IN WORDS when it cannot: a read wider
//      than the server extracts (never asked for), a read that failed, or CHART_WIDEN_ROUNDS reads and still past;
//   4. refreshNogo never asks the server for a box it refuses (that answer threw the model away and the next plan
//      drove straight, unchecked), and the page's limit is the server's;
//   5. every command path plans through it, and refuses an uncharted plan before it draws or posts anything; the
//      passive transit estimate reports one as an estimate, not as "unroutable".
//
//   node tests/chart_box.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// The miniature world in 2-3: a wall of land runs north-south across the leg, an island the small extract holds
// (it reaches into the box) and, north of it, land the small extract does NOT hold (it lies wholly outside). The
// router, shown only the island, goes round its north end - straight through the land it was never shown. The
// answer is round the south end, 2 km off the line, and only a wider read finds it.

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " + String(e && e.stack || e).split("\n").slice(0, 3).join(" | "));
  console.log("1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const fs = require("fs");
const path = require("path");
// ASV_HTML points this at a SIDECAR copy for a mutation run - every read of the page goes through it.
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const SERVER = fs.readFileSync(path.join(__dirname, "..", "asv_console.py"), "utf8");

// THE REAL MODULES.
const { planeFrame, M_PER_DEG_LAT } = require("../static/js/geodesy.js");
const { nogo } = require("../static/js/state.js");
const P = require("../static/js/passage.js");
const K = require("../static/js/keepouts.js");
const { bbOf } = require("../static/js/geometry.js");
const { boxAround } = require("../static/js/inkreads.js");
const { fmtDist, fmtMS } = require("../static/js/units.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond);
        note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  const m = H.match(new RegExp("^(?:const|let|var)\\s+" + name + "\\s*=[^;]*;", "m"));
  if (!m) throw new Error("test setup: declaration " + name + " not found (renamed?)");
  return m[0];
}
const declValue = (name) => +grabDecl(name).replace(/^[^=]*=\s*/, "").replace(/;.*$/, "");
const union = (a, b) => ({ W: Math.min(a.W, b.W), S: Math.min(a.S, b.S), E: Math.max(a.E, b.E), N: Math.max(a.N, b.N) });

// ── 1. beyondChart ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const box = { W: -70.80, S: 43.00, E: -70.60, N: 43.20 };
  const k = (lat) => M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180);
  const inN = (m, lon = -70.70) => ({ lat: box.N - m / M_PER_DEG_LAT, lon });     // m meters inside the north edge
  const mid = { lat: 43.10, lon: -70.70 };
  const deep = [mid, inN(150), { lat: 43.10, lon: box.W + 150 / k(43.10) }];
  check("1. CHART_EDGE_M is 100 m, and a route whose every point stands at least that far inside every edge is not "
        + "judged past the box (nor is one with no box to judge against, or no points)",
        () => P.CHART_EDGE_M === 100 && P.beyondChart(deep, box) === null
              && P.beyondChart(deep, null) === null && P.beyondChart([], box) === null
              && P.beyondChart([inN(100.5)], box) === null,
        "CHART_EDGE_M " + P.CHART_EDGE_M);
  const r = P.beyondChart([mid, inN(60), inN(-200), inN(-50), mid], box);
  check("1b. a point inside the box but within the margin is past it; `at` is where the route LEAVES the box (its first "
        + "point beyond it, not the margin point before it), `outM` the farthest any point stands BEYOND the box itself, "
        + "and every point of the route comes back (copies)",
        () => r && Math.abs(r.at.lat - inN(-200).lat) < 1e-12 && Math.abs(r.outM - 200) < 0.01 && r.edgeM === 100
              && r.pts.length === 5 && r.pts[0] !== mid && r.pts[0].lat === mid.lat,
        () => r ? "at " + r.at.lat.toFixed(6) + ", outM " + r.outM.toFixed(2) + ", " + r.pts.length + " pts" : "null");
  const margin = P.beyondChart([mid, inN(60), inN(30), mid], box);
  check("1c. ... and one only INTO the margin says it never left the box (outM 0), `at` its first point in the margin",
        () => margin && margin.outM === 0 && Math.abs(margin.at.lat - inN(60).lat) < 1e-12,
        () => JSON.stringify(margin && { outM: margin.outM, at: margin.at.lat }));
  // every edge, on its own: a mutation that drops one term of the min is caught here
  const edges = {
    N: inN(-10), S: { lat: box.S + -10 / M_PER_DEG_LAT, lon: -70.70 },
    W: { lat: 43.10, lon: box.W - 10 / k(43.10) }, E: { lat: 43.10, lon: box.E + 10 / k(43.10) },
  };
  const each = Object.entries(edges).map(([e, p]) => [e, P.beyondChart([mid, p], box)]);
  check("1d. every one of the four edges is an edge: 10 m past each is 10 m beyond the box",
        () => each.every(([, x]) => x && Math.abs(x.outM - 10) < 0.01),
        () => each.map(([e, x]) => e + " " + (x ? x.outM.toFixed(2) : "null")).join(", "));
  check("1e. the words: meters beyond the box, or the margin it came within - in the units it is handed",
        () => P.beyondChartSay({ outM: 429.4, edgeM: 100 }) === "the route runs 429 m beyond the water the chart was read over"
              && P.beyondChartSay({ outM: 0, edgeM: 100 }) === "the route runs within 100 m of the edge of the water the chart was read over"
              && P.beyondChartSay({ outM: 1500, edgeM: 100 }, fmtDist) === "the route runs 1.50 km beyond the water the chart was read over",
        P.beyondChartSay({ outM: 1500, edgeM: 100 }, fmtDist));
}

// ── the miniature world ──────────────────────────────────────────────────────────────────────────────────────────
const F = planeFrame({ lat: 43.07, lon: -70.71 });
const at = (e, n) => { const q = F.fromEN(e, n); return { lat: q.lat, lon: q.lon }; };
const rect = (e0, e1, n0, n1) => { const ring = [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }];
  return { ring, bb: bbOf(ring), kind: "land", type: "poly" }; };
const model = (polys) => ({ polys, lines: [], points: [], marks: [], sys: [], chans: [] });
const ISLAND = rect(800, 1200, -2000, 1500);        // reaches into the small box: the small extract holds it
const NORTH = rect(-600, 2600, 1490, 3500);         // wholly outside it: the small extract does not
const FULL = model([ISLAND, NORTH]);
const A = at(0, 0), B = at(2000, 0);
const SMALL = boxAround([A, B], 300);               // what ensureNogoCovers reads for this command
// "THE SERVER": every poly whose extent touches the box asked for (an intersects query), whole
const polyBoxLL = (p) => { const lo = at(Math.min(...p.ring.map((q) => q.e)), Math.min(...p.ring.map((q) => q.n)));
  const hi = at(Math.max(...p.ring.map((q) => q.e)), Math.max(...p.ring.map((q) => q.n)));
  return { W: lo.lon, S: lo.lat, E: hi.lon, N: hi.lat }; };
const touches = (a, b) => !(a.E < b.W || a.W > b.E || a.N < b.S || a.S > b.N);
const extract = (box) => model(FULL.polys.filter((p) => touches(polyBoxLL(p), box)));
const foulLegs = (from, route, ko) => { const pts = [from, ...route]; let n = 0;
  for (let i = 1; i < pts.length; i++) if (!K.legClear(pts[i - 1], pts[i], F, ko, 3)) n++; return n; };
const maxN = (route) => Math.max(...route.map((p) => F.toEN(p).n));
const minN = (route) => Math.min(...route.map((p) => F.toEN(p).n));
const saved = { ready: nogo.ready, frame: nogo.frame, ko: nogo.ko, buffer: nogo.buffer, bbox: nogo.bbox };
const restore = () => Object.assign(nogo, saved);
const world = (box, ko) => { nogo.ready = true; nogo.frame = F; nogo.buffer = 3; nogo.bbox = box; nogo.ko = ko; };

// ── 2. planNogoRoute ─────────────────────────────────────────────────────────────────────────────────────────────
let old = null, refused = null, inside = null, insideNoBox = null;
try {
  world(null, extract(SMALL));
  old = P.planNogoRoute(A, B, {});                   // THE DEFECT: no box to judge against, the small extract's model
  world(SMALL, extract(SMALL));
  refused = P.planNogoRoute(A, B, {});
  const C = at(600, 150);                            // a target the straight line reaches, well inside the box
  inside = P.planNogoRoute(A, C, {});
  world(null, extract(SMALL));
  insideNoBox = P.planNogoRoute(A, C, {});
} finally { restore(); }
check("2. THE DEFECT, as it was: on the small extract alone the router goes round the island's NORTH end, past the "
      + "box, and through land the extract never held",
      () => old && old.route && maxN(old.route) > 1500 && foulLegs(A, old.route, FULL) > 0
            && P.beyondChart([A, ...old.route], SMALL) !== null,
      () => old && old.route ? old.route.length + " pts, north to n=" + maxN(old.route).toFixed(0) + " m, "
                               + foulLegs(A, old.route, FULL) + " leg(s) not clear on the full chart" : JSON.stringify(old));
check("2b. given the box, planNogoRoute REFUSES that route - mode \"uncharted\", the spot it left at, the route it "
      + "would have flown under `uncharted` and NO `route` a caller reading only `error` could fly",
      () => refused && /beyond the water the chart was read over/.test(refused.error)
            && refused.reason && refused.reason.mode === "uncharted" && refused.reason.at
            && refused.route === undefined && refused.uncharted && refused.uncharted.route.length === old.route.length
            && refused.uncharted.pts[0].lat === A.lat && refused.uncharted.outM > 1000,
      () => refused ? refused.error + "; uncharted " + (refused.uncharted ? refused.uncharted.route.length + " pts" : "-") : "?");
check("2c. ... and a route inside the box is not touched: the same route as with no box at all",
      () => inside && !inside.error && insideNoBox && JSON.stringify(inside.route) === JSON.stringify(insideNoBox.route),
      () => inside ? (inside.error || inside.route.length + " pts") : "?");

// ── 3. routePlan ─────────────────────────────────────────────────────────────────────────────────────────────────
let rpPast = null, rpIn = null, rpWide = null;
try {
  world(SMALL, extract(SMALL));
  rpPast = P.routePlan(A, [B], true, 3);
  rpIn = P.routePlan(A, [at(600, 150)], true, 3);
  const WIDE = union(SMALL, boxAround([at(-800, -3000), at(2800, 3700)], 300));
  world(WIDE, FULL);
  rpWide = P.routePlan(A, [B], true, 3);
} finally { restore(); }
check("3. routePlan returns a route past the box WITH `uncharted` beside it (its callers refuse on it), and none on a "
      + "route inside - nor on the true route once the chart is read over all of it",
      () => rpPast && rpPast.uncharted && rpPast.uncharted.outM > 1000 && rpPast.route.length > 1
            && rpIn && rpIn.uncharted === null
            && rpWide && rpWide.uncharted === null && minN(rpWide.route) < -2000 && foulLegs(A, rpWide.route, FULL) === 0,
      () => "past: " + (rpPast && rpPast.uncharted ? rpPast.uncharted.outM.toFixed(0) + " m beyond" : "none")
            + "; inside: " + (rpIn ? String(rpIn.uncharted) : "?")
            + "; read wide: " + (rpWide ? (rpWide.uncharted ? "past" : "south to n=" + minN(rpWide.route).toFixed(0)) : "?"));

// ── 4. planInsideChart, the page's own ───────────────────────────────────────────────────────────────────────────
// Its world: the REAL planners above, the real boxAround / beyondChartSay / fmtDist, the page's own encSpanRefusal;
// a stand-in for ensureNogoCovers that does what the page's does to the model - unions the asked box (padded) into
// nogo.bbox and "extracts" every poly touching it - and records every call.
const CHART_WIDEN_ROUNDS = declValue("CHART_WIDEN_ROUNDS"), CHART_WIDEN_PAD_M = declValue("CHART_WIDEN_PAD_M");
const ENC_MAX_SPAN_DEG = declValue("ENC_MAX_SPAN_DEG");
// the stall watchdog's tick, which planInsideChart waits out before each read (its own banner must not be covered)
const STALL_TICK_MS = +(H.match(/const STALL_TICK_MS = (\d+)/) || [])[1];
const beyondChartSay = P.beyondChartSay, beyondChart = P.beyondChart;
let banners = [], downs = [], covers = [], aisTaken = 0, coverAnswer = null;
function showBanner(t) { banners.push(t); }
function takeDownBanner(re) { downs.push(re); }
function aisKeepoutsNow() { aisTaken++; return []; }
// ⚠ A READ THAT FAILS FAILS THE WAY THE REAL ONE DOES (found by the review: this stand-in used to answer false and
// leave the model up - a state the real refreshNogo never leaves - so 4e and 4j certified a refusal the page did not
// give). Without `keep` the real refreshNogo drops the model (nogo.ready = false); with it the model stands and
// `failed` says why (tests/nogo_readout.js 27-27b drive the real one).
const FAIL_WHY = "ENC offline (no cache for this area)";
async function ensureNogoCovers(pts, padM, opts) {
  covers.push({ pts: pts.map((p) => ({ lat: p.lat, lon: p.lon })), padM, opts: opts && { ...opts } });
  await Promise.resolve();
  if (coverAnswer) {
    const ok = coverAnswer();
    if (!ok) { if (opts && opts.keep) opts.failed = FAIL_WHY; else nogo.ready = false; }
    return ok;
  }
  const b = boxAround(pts, padM || 300);
  nogo.bbox = nogo.bbox ? union(nogo.bbox, b) : b;
  nogo.ko = extract(nogo.bbox);
  return true;
}
// eslint-disable-next-line no-eval
const encSpanRefusal = eval("(" + grab("encSpanRefusal") + ")");
// eslint-disable-next-line no-eval
const sizeWhy = eval("(" + grab("sizeWhy") + ")");
// eslint-disable-next-line no-eval
const unchartedTip = eval("(" + grab("unchartedTip") + ")");
// eslint-disable-next-line no-eval
const planWhy = eval("(" + grab("planWhy") + ")");
// eslint-disable-next-line no-eval
const bbUnion = eval("(" + grabDecl("bbUnion").replace(/^const\s+bbUnion\s*=\s*/, "").replace(/;\s*$/, "") + ")");
// THE VESSELS ALONG A PASSAGE (2026-10-07): the page's own read, run in this world - where no AIS proxy answers (a
// relative URL fetches nothing in node) - so it leaves nogo.ais null and every plan here is laid in the chart's model.
const PASSAGE_AIS_MAX_READS = declValue("PASSAGE_AIS_MAX_READS"), PASSAGE_AIS_TIMEOUT_MS = declValue("PASSAGE_AIS_TIMEOUT_MS");
const { distTo } = require("../static/js/geodesy.js");
// eslint-disable-next-line no-eval
const passageReadCenters = eval("(" + grab("passageReadCenters") + ")");
// eslint-disable-next-line no-eval
const readPassageAis = eval("(" + grab("readPassageAis") + ")");
// eslint-disable-next-line no-eval
const planInsideChart = eval("(" + grab("planInsideChart") + ")");
const fresh = () => { banners = []; downs = []; covers = []; aisTaken = 0; coverAnswer = null; };

(async () => {
  // 4. THE LOOP, END TO END, on the miniature world
  fresh();
  let got = null, calls = 0;
  try {
    world(SMALL, extract(SMALL));
    got = await planInsideChart([A, B], undefined, () => { calls++; return P.planNogoRoute(A, B, {}); }, "Go-To");
  } finally { restore(); }
  check("4. planInsideChart reads the chart over the refused route and plans again until the route stays inside: on "
        + "the miniature world, round the SOUTH end - clear of the land the first route crossed, inside the box it read",
        () => got && got.route && !got.error && minN(got.route) < -2000 && foulLegs(A, got.route, FULL) === 0
              && calls >= 2 && calls <= CHART_WIDEN_ROUNDS + 1,
        () => got ? (got.error || got.route.length + " pts, south to n=" + minN(got.route).toFixed(0) + " m, "
                                 + foulLegs(A, got.route, FULL) + " foul on the full chart") + "; " + calls + " plans, "
                    + covers.length + " cover calls" : "?");
  const wides = covers.filter((c) => c.padM === CHART_WIDEN_PAD_M);
  check("4b. ... each read is over the command's own points AND every point of the route it was refused, at the pad "
        + "ensureNogoCovers uses; after each, the command's own water again with ITS options; and EVERY read is a "
        + "`keep` read - one that fails leaves the model she is running on",
        () => wides.length === calls - 1 && wides.every((c) => c.pts.length > 2 && c.pts[0].lat === A.lat && c.pts[1].lat === B.lat)
              && covers.length === 2 * wides.length
              && covers.every((c, i) => i % 2 === 0 || (c.padM === null && c.pts.length === 2))
              && covers.every((c) => c.opts && c.opts.keep === true),
        () => covers.map((c) => c.pts.length + "pt/" + c.padM).join(", "));
  const says = wides.map((c) => c.opts && c.opts.say);
  check("4c. each read SAYS what it is - the banner refreshNogo raises while it fetches (53 s on the live check) - and "
        + "the planning after it says so too; the contacts are taken again in the frame before EVERY plan (a new "
        + "extract moves it); and the last banner is taken down once the route is inside",
        () => aisTaken === calls && banners.length === calls - 1 && says.length === calls - 1
              && says.every((t, i) => t === "Go-To: the route ran past the water the chart was read over - reading the chart along it ("
                                            + (i + 1) + " of " + CHART_WIDEN_ROUNDS + ")…")
              && banners.every((t, i) => t === "Go-To: planning again over the chart read along the route ("
                                               + (i + 1) + " of " + CHART_WIDEN_ROUNDS + ")…")
              && downs.length === 1 && downs[0].test(banners[banners.length - 1]),
        () => aisTaken + " takes, " + calls + " plans; reads say " + JSON.stringify(says) + "; banners " + JSON.stringify(banners));

  // 4d. too wide to read: never asked for
  fresh();
  let wide = null;
  try {
    world(SMALL, extract(SMALL));
    const far = { route: [at(0, 200000)], uncharted: P.beyondChart([A, at(0, 200000)], SMALL), error: "x", reason: { mode: "uncharted" } };
    wide = await planInsideChart([A, B], undefined, () => far, "Go-To");
  } finally { restore(); }
  check("4d. a route whose read would be wider than the server extracts is refused WITHOUT asking (the model in hand "
        + "is kept): the reason names the extract it would take and the limit, and replaces the planner's error",
        () => wide && covers.length === 0 && wide.uncharted.say && wide.error === wide.uncharted.say
              && /^the route runs 199\.\d\d km beyond the water the chart was read over - reading the chart over it would take an extract of 0\.\d\d° × 1\.8\d°, and the console reads at most 1\.5° on a side$/.test(wide.uncharted.say)
              && wide.uncharted.rounds === 0,
        () => wide ? wide.uncharted.say : "?");

  // 4e. the read fails
  fresh();
  let failed = null, upAfter = null;
  try {
    world(SMALL, extract(SMALL));
    coverAnswer = () => false;
    failed = await planInsideChart([A, B], undefined, () => P.planNogoRoute(A, B, {}), "RTH");
    upAfter = nogo.ready;
  } finally { restore(); }
  check("4e. a read that FAILS ends it - one read, no second plan - the reason says how (the read's own `failed`), "
        + "and the model she is running on is still up",
        () => failed && failed.error && /beyond the water the chart was read over - the chart could not be read over it \(ENC offline \(no cache for this area\)\)$/.test(failed.error)
              && covers.length === 1 && covers[0].opts.keep === true && failed.uncharted.rounds === 1 && upAfter === true,
        () => failed ? failed.error + "; model up after: " + upAfter : "?");

  // 4f. it never settles: exactly CHART_WIDEN_ROUNDS reads
  fresh();
  let restless = null, plans = 0;
  try {
    world(SMALL, extract(SMALL));
    restless = await planInsideChart([A, B], { plan: true }, () => { plans++;
      const r = [at(0, 0), at(0, (plans + 1) * 5000)];      // always further: past whatever was read
      return { route: r, unroutable: [], uncharted: P.beyondChart([A, ...r], nogo.bbox) }; }, "Upload");
  } finally { restore(); }
  check("4f. a route still past after CHART_WIDEN_ROUNDS (" + CHART_WIDEN_ROUNDS + ") reads is refused, saying so - "
        + "and a routePlan-shaped plan gets the words but no `error` (its callers refuse on `uncharted`); the "
        + "command's own options ride every re-read",
        () => restless && restless.uncharted && plans === CHART_WIDEN_ROUNDS + 1 && restless.uncharted.rounds === CHART_WIDEN_ROUNDS
              && /still did after the chart was read over the route 3 times - plan it in shorter legs$/.test(restless.uncharted.say)
              && restless.error === undefined
              && covers.filter((c) => c.padM === null).every((c) => c.opts && c.opts.plan === true),
        () => restless ? plans + " plans, " + restless.uncharted.say : "?");

  // 4g. a plan that is already inside, or none at all
  fresh();
  const ok = { route: [B], unroutable: [], uncharted: null };
  const same = await planInsideChart([A, B], undefined, () => ok, "Transit");
  const none = await planInsideChart([A, B], undefined, () => null, "Transit");
  check("4g. a plan inside the chart comes straight back - no read, no banner, nothing taken down - and so does a "
        + "plan that ended before routing (doTransit's refused hold point: null)",
        () => same === ok && none === null && covers.length === 0 && banners.length === 0 && downs.length === 0 && aisTaken === 2,
        () => covers.length + " reads, " + banners.length + " banners");

  // 4h-4j. THE COMMAND'S OWN POINTS FIRST: a target the chart could not be read over is refused before anything is
  // planned - planning one was measured at 15-31 s of the page's only thread for a Go-To 1.5-2 degrees off.
  fresh();
  let tooFar = null, planned = 0;
  const FAR = at(0, 200000);                                         // 1.8 degrees north: past the server's limit
  try {
    world(SMALL, extract(SMALL));
    tooFar = await planInsideChart([A, FAR], undefined, () => { planned++; return P.planNogoRoute(A, FAR, {}); }, "Go-To");
  } finally { restore(); }
  check("4h. a command whose OWN point lies past the chart, and past what the server will extract, is refused without "
        + "planning anything or asking for anything - in words, in both shapes its callers read (error, uncharted)",
        () => tooFar && planned === 0 && covers.length === 0 && aisTaken === 0
              && tooFar.error === tooFar.uncharted.say && tooFar.reason.mode === "uncharted"
              && Math.abs(tooFar.reason.at.lat - FAR.lat) < 1e-12 && tooFar.uncharted.rounds === 0
              && /^the target lies 199\.\d\d km beyond the water the chart was read over - reading the chart over it would take an extract of 0\.\d\d° × 1\.8\d°, and the console reads at most 1\.5° on a side$/.test(tooFar.error)
              && tooFar.uncharted.cause === "size" && tooFar.reason.near === false,
        () => tooFar ? planned + " plans, " + covers.length + " reads: " + tooFar.error : "?");
  fresh();
  let reread = null, planned2 = 0;
  try {
    world(SMALL, extract(SMALL));
    const C = at(-1500, 2500);                                       // past the box, but readable (west of the north land)
    reread = await planInsideChart([A, C], { plan: true }, () => { planned2++; return P.planNogoRoute(A, C, {}); }, "Upload");
  } finally { restore(); }
  check("4i. ... and one whose point CAN be read is read first (the command's own read may have been queued out), "
        + "with the command's options and `keep`, and then planned as usual",
        () => reread && !reread.error && planned2 >= 1 && covers.length >= 1 && covers[0].padM === null
              && covers[0].opts && covers[0].opts.plan === true && covers[0].opts.keep === true && covers[0].pts.length === 2,
        () => reread ? (reread.error || reread.route.length + " pts") + "; " + planned2 + " plans; reads "
                       + covers.map((c) => c.pts.length + "pt/" + c.padM).join(", ") : "?");
  fresh();
  let unread = null, planned3 = 0, upAfter3 = null;
  try {
    world(SMALL, extract(SMALL));
    coverAnswer = () => false;
    const C = at(-1500, 2500);
    unread = await planInsideChart([A, C], undefined, () => { planned3++; return P.planNogoRoute(A, C, {}); }, "Go-To");
    upAfter3 = nogo.ready;
  } finally { restore(); }
  check("4j. ... and when that read fails it is REFUSED unplanned, saying how the read failed - not planned degraded "
        + "and straight on a model the failed read took away (the review's finding: it used to be)",
        () => unread && planned3 === 0 && covers.length === 1 && upAfter3 === true && !unread.degraded
              && /beyond the water the chart was read over - the chart could not be read over it \(ENC offline \(no cache for this area\)\)$/.test(unread.error),
        () => unread ? planned3 + " plans, model up after: " + upAfter3 + ": " + (unread.error || JSON.stringify(unread)) : "?");
  fresh();
  let degraded = null, planned4 = 0;
  try {
    world(SMALL, extract(SMALL)); nogo.ready = false;
    degraded = await planInsideChart([A, FAR], undefined, () => { planned4++; return { route: [FAR], direct: true, degraded: true }; }, "Go-To");
  } finally { restore(); }
  check("4k. with NO model at all nothing is asked: the planner's own degraded answer stands, as it always has",
        () => degraded && degraded.degraded && planned4 === 1 && covers.length === 0,
        () => JSON.stringify(degraded));

  // 4l. TOO WIDE ONLY WITH THE WATER ALREADY READ (the review): every read is joined to the box already read, so a
  // nearby point can need an extract past the limit because of what an earlier command read - and the words say so.
  fresh();
  let joined = null, planned5 = 0;
  try {
    world(SMALL, extract(SMALL));
    nogo.bbox = union(SMALL, { W: SMALL.W, S: SMALL.S, E: SMALL.W + 1.49, N: SMALL.N });   // an earlier read, 1.49 deg wide
    const C = at(-1500, 2500);
    joined = await planInsideChart([A, C], undefined, () => { planned5++; return P.planNogoRoute(A, C, {}); }, "Go-To");
  } finally { restore(); }
  check("4l. a point that alone would read fine, refused because the water ALREADY read makes the extract too wide, "
        + "says so - the span already read, then the extract it would take",
        () => joined && planned5 === 0 && covers.length === 0
              && /^the target lies 2\.\d\d km beyond the water the chart was read over - reading the chart over it as well as the water already read \(1\.49° × 0\.0\d°\) would take an extract of 1\.5[1-9]° × 0\.0\d°, and the console reads at most 1\.5° on a side$/.test(joined.error),
        () => joined ? planned5 + " plans: " + joined.error : "?");

  // 4o. THE WIDENING PAD (the review's fuzz on his chart): with 300 m, a re-plan that drifted only a few hundred meters
  // further out than the route it was refused came back inside the 100 m margin, and was read again - every one of the
  // four such runs it saw. A stand-in planner that drifts 500 m further out after its read: one read at 1 km.
  fresh();
  let drift = null, dPlans = 0;
  try {
    world(SMALL, extract(SMALL));
    const north = (m) => ({ lat: SMALL.N + m / M_PER_DEG_LAT, lon: A.lon });
    drift = await planInsideChart([A, B], undefined, () => {
      const r = [north(dPlans++ === 0 ? 50 : 550)];
      return { route: r, unroutable: [], uncharted: P.beyondChart([A, ...r], nogo.bbox) }; }, "Go-To");
  } finally { restore(); }
  check("4o. a re-plan that drifts 500 m further out than the route it was refused needs no SECOND read: the widening "
        + "read is padded past it (CHART_WIDEN_PAD_M " + CHART_WIDEN_PAD_M + " m)",
        () => drift && !drift.uncharted && dPlans === 2 && covers.filter((c) => c.padM === CHART_WIDEN_PAD_M).length === 1,
        () => dPlans + " plans, " + covers.filter((c) => c.padM === CHART_WIDEN_PAD_M).length + " widening read(s)"
              + (drift && drift.uncharted ? "; still past: " + drift.uncharted.say : ""));

  // 4p. ... and the LOOP asks the joined box too, not only the pre-check (4l): the command's own points are inside, its
  // route runs a little past the box, and only the water already read makes the read too wide.
  fresh();
  let joinedLoop = null, jPlans = 0;
  try {
    world(SMALL, extract(SMALL));
    nogo.bbox = union(SMALL, { W: SMALL.W, S: SMALL.S, E: SMALL.W + 1.49, N: SMALL.N });
    joinedLoop = await planInsideChart([A, B], undefined, () => { jPlans++;
      const r = [{ lat: A.lat, lon: SMALL.W - 200 / (M_PER_DEG_LAT * Math.cos(A.lat * Math.PI / 180)) }];
      return { route: r, unroutable: [], uncharted: P.beyondChart([A, ...r], nogo.bbox) }; }, "Transit");
  } finally { restore(); }
  check("4p. a route whose read would be too wide only because of the water ALREADY read is refused WITHOUT asking - "
        + "the loop joins the box already read too - and says so",
        () => joinedLoop && joinedLoop.uncharted && jPlans === 1 && covers.length === 0 && joinedLoop.uncharted.cause === "size"
              && /reading the chart over it as well as the water already read \(1\.49° × 0\.0\d°\) would take an extract of 1\.5[1-9]° × 0\.0\d°/.test(joinedLoop.uncharted.say),
        () => joinedLoop && joinedLoop.uncharted ? jPlans + " plan(s), " + covers.length + " read(s): " + joinedLoop.uncharted.say : "?");

  // 4m-4n. WHAT TO DO ABOUT IT, by cause; and the planner's own words in the operator's units.
  check("4m. the advice names what can help: a read that FAILED is 'command it again once the chart can be read', "
        + "a size or a route still past after the reads is the command's own advice",
        () => unchartedTip({ cause: "failed" }, "X") === "Command it again once the chart can be read there."
              && unchartedTip({ cause: "size" }, "X") === "X" && unchartedTip({ cause: "rounds" }, "X") === "X"
              && unchartedTip(null, "X") === "X"
              && failed && failed.uncharted.cause === "failed" && restless && restless.uncharted.cause === "rounds"
              && wide && wide.uncharted.cause === "size",
        () => "causes: " + [failed, restless, wide].map((x) => x && x.uncharted && x.uncharted.cause).join(", "));
  check("4n. a refusal the planner made on its own (the resume, way-round and re-approach paths) is said in the "
        + "operator's units, and any other refusal as the planner said it",
        () => planWhy({ error: "the route runs 1207 m beyond the water the chart was read over",
                        uncharted: { outM: 1207, edgeM: 100 } }) === "the route runs 1.21 km beyond the water the chart was read over"
              && planWhy({ error: "no clear route to the target" }) === "no clear route to the target",
        () => planWhy({ uncharted: { outM: 1207, edgeM: 100 } }));

  // ── 5. the server's limit ──────────────────────────────────────────────────────────────────────────────────────
  const srv = SERVER.match(/^ENC_MAX_SPAN_DEG = ([\d.]+)/m);
  check("5. the page's ENC_MAX_SPAN_DEG is the server's (asv_console.py), and encSpanRefusal refuses past it on "
        + "either side and not at it",
        () => srv && +srv[1] === ENC_MAX_SPAN_DEG
              && encSpanRefusal({ W: 0, S: 0, E: 1.5, N: 1.5 }) === null
              && /^an extract of 1\.51° × 0\.20°/.test(encSpanRefusal({ W: 0, S: 0, E: 1.5004, N: 0.2 }))   // just past: rounded UP
              && /^an extract of 1\.60° × 0\.20°/.test(encSpanRefusal({ W: 0, S: 0, E: 1.6, N: 0.2 }))
              && /^an extract of 0\.20° × 1\.60°/.test(encSpanRefusal({ W: 0, S: 0, E: 0.2, N: 1.6 })),
        "server " + (srv && srv[1]) + ", page " + ENC_MAX_SPAN_DEG);
  const rn = grab("refreshNogo");
  check("5b. refreshNogo asks it of a box it is HANDED before it waits, claims or fetches anything - and returns",
        () => /const tooBig = bbox \? encSpanRefusal\(bbox\) : null;\s*if\(tooBig\)\{[^}]*return; \}/.test(rn)
              && rn.indexOf("encSpanRefusal(bbox)") < rn.indexOf("while(nogo.busy")
              && rn.indexOf("encSpanRefusal(bbox)") < rn.indexOf("fetchENCBbox("),
        "refreshNogo in static/asv.html");

  // ── 6. the wiring ──────────────────────────────────────────────────────────────────────────────────────────────
  const body = (name) => grab(name);
  const go = body("doGoTo"), rth = body("doRTH"), tr = body("doTransit"), up = body("doUpload");
  check("6. Go-To and RTH plan through planInsideChart, each over its own boat-and-target points",
        () => /const plan = await planInsideChart\(\[\{lat:asv\.lat,lon:asv\.lon\}, target\], undefined,\s*\(\) => planNogoRoute\(\{lat:asv\.lat,lon:asv\.lon\}, target,/.test(go)
              && /const plan = await planInsideChart\(\[\{lat:asv\.lat,lon:asv\.lon\}, \{lat:S\.home\.lat,lon:S\.home\.lon\}\], undefined,(?:[^\n]*\n)?\s*\(\) => planNogoRoute\(\{lat:asv\.lat,lon:asv\.lon\}, \{lat:S\.home\.lat,lon:S\.home\.lon\},/.test(rth),
        "doGoTo / doRTH");
  check("6b. ... and say what to do about it: the uncharted refusal gets its own advice, not 'nearer open water'",
        () => /mode==="uncharted" \? unchartedTip\(plan\.uncharted, "Go-To a point part of the way there first\."\)/.test(go)
              && /plan\.reason\.mode==="uncharted" \? unchartedTip\(plan\.uncharted, "Go-To a point on the way home first, or set Home nearer\."\)/.test(rth),
        "doGoTo / doRTH");
  const iTrPlan = tr.indexOf("await planInsideChart("), iTrHt = tr.indexOf("ht = holdTarget("),
        iTrUn = tr.indexOf("if(plan.uncharted){"), iTrPost = tr.indexOf('routeCmd("/api/cmd/transit"'), iTrDraw = tr.indexOf("runRoute = plan.route");
  check("6c. the Transit works out its hold point INSIDE the plan (on the model the route is judged by), and refuses "
        + "an uncharted plan before it draws or posts anything",
        () => iTrPlan > 0 && iTrHt > iTrPlan && iTrUn > iTrPlan && iTrUn < iTrPost && iTrUn < iTrDraw
              && /return routePlan\(\{lat:asv\.lat,lon:asv\.lon\}, line, true, transitStandoffM\(\)\);/.test(tr)
              && /if\(ht !== null && ht\.error\)\{/.test(tr),                   // null when refused before any planning (4h)
        "planInsideChart " + iTrPlan + ", holdTarget " + iTrHt + ", uncharted refusal " + iTrUn + ", post " + iTrPost + ", draw " + iTrDraw);
  const iUpPlan = up.indexOf("await planInsideChart("), iUpUn = up.indexOf("if(plan.uncharted){"),
        iUpPost = up.indexOf('cmd("/api/cmd/upload", {route: plan.route'), iUpDraw = up.indexOf("runRoute = plan.route");
  check("6d. the Upload plans through it with its own {plan: true} (each survey's water read again), and refuses an "
        + "uncharted plan before it draws or posts anything",
        () => /await planInsideChart\(\[\{lat:asv\.lat, lon:asv\.lon\}, \.\.\.wps\], \{plan: true\},/.test(up)
              && iUpUn > iUpPlan && iUpUn < iUpPost && iUpUn < iUpDraw,
        "planInsideChart " + iUpPlan + ", uncharted refusal " + iUpUn + ", post " + iUpPost + ", draw " + iUpDraw);
  const rpCalls = (H.match(/routePlan\(/g) || []).length - (H.match(/function routePlan\(/g) || []).length;
  check("6e. no other routePlan caller on the page: three calls - the Transit's, the Upload's, and the Upload's "
        + "degraded one with no model (which routePlan answers before it judges anything)",
        () => rpCalls === 3 && /const raw = routePlan\(\{lat:asv\.lat, lon:asv\.lon\}, wps, false, transitStandoffM\(\)\);/.test(up),
        rpCalls + " routePlan( calls");
  const pv = fs.readFileSync(path.join(__dirname, "..", "static", "js", "passage.js"), "utf8").split("\r\n").join("\n");
  check("6f. planNogoRoute judges the route AS FLOWN - after the lane pass, from the start - and routePlan the whole "
        + "route, every leg",
        () => /const route = kr\.route\.slice\(1\);\s*[\s\S]{0,300}const out = beyondChart\(\[\{lat: from\.lat, lon: from\.lon\}, \.\.\.route\], nogo\.bbox\);/.test(pv)
              && /const uncharted = beyondChart\(\[\{lat: start\.lat, lon: start\.lon\}, \.\.\.out\], nogo\.bbox\);/.test(pv),
        "static/js/passage.js");

  // ── 7. the passive estimate and the chart's mark ───────────────────────────────────────────────────────────────
  const distTo = F.distTo;
  // eslint-disable-next-line no-eval
  const routeLenM = eval("(" + grab("routeLenM") + ")");
  let planNogoRoute = null;
  // eslint-disable-next-line no-eval
  const transitEstCompute = eval("(" + grab("transitEstCompute") + ")");
  // eslint-disable-next-line no-eval
  const transitRowHtml = eval("(" + grab("transitRowHtml") + ")");
  let outM = 429;
  planNogoRoute = (from, to) => ({ error: "the route runs 429 m beyond the water the chart was read over",
                                   uncharted: { route: [at(0, 1000), { lat: to.lat, lon: to.lon }], outM } });
  const est = transitEstCompute(A, [at(1000, 1000)], null);
  const row = transitRowHtml("Transit", est.transit, 2, "high", 0);
  check("7. the passive transit estimate reports a route past the chart as an ESTIMATE over water not yet read - its "
        + "length, and a note that the command reads it first - never as 'unroutable'",
        () => est.transit && est.transit.uncharted === true && Math.abs(est.transit.m - (1000 + 1000)) < 1
              && !est.transit.err && /part of it over water the chart is not yet read over - the command reads it first/.test(row)
              && !/unroutable/.test(row),
        () => JSON.stringify(est.transit) + " -> " + row.replace(/<[^>]*>/g, ""));
  outM = 0;
  const rowEdge = transitRowHtml("Transit", transitEstCompute(A, [at(1000, 1000)], null).transit, 2, "high", 0);
  check("7c. ... and one that only comes within the margin of the edge - never past it - says THAT, not 'not yet read'",
        () => /it runs near the edge of the water the chart was read over - the command reads it first/.test(rowEdge)
              && !/not yet read/.test(rowEdge),
        () => rowEdge.replace(/<[^>]*>/g, ""));
  const estH = transitEstCompute(A, [at(1000, 1000)], at(0, 0));
  const rowH = transitRowHtml("RTH", estH.rth, 2, "high", 0);
  check("7e. ... and so does the RTH row (the plan's last waypoint home), not 'unroutable'",
        () => estH.rth && estH.rth.uncharted === true && Math.abs(estH.rth.m - 2000) < 1 && !estH.rth.err
              && /near the edge of the water the chart was read over - the command reads it first/.test(rowH) && !/unroutable/.test(rowH),
        () => JSON.stringify(estH.rth) + " -> " + rowH.replace(/<[^>]*>/g, ""));
  const keySrc = grab("transitEstKey");
  check("7d. the estimate is computed again once the chart is read further: its cache key carries the box",
        () => /const bb = nogo\.bbox \? \[nogo\.bbox\.W, nogo\.bbox\.S, nogo\.bbox\.E, nogo\.bbox\.N\]/.test(keySrc)
              && /nogo\.ready, nogo\.band, nogo\.buffer, wps\.length, bb\]\.join\("\|"\)/.test(keySrc),
        "transitEstKey");
  check("7b. the chart marks the spot in words of its own, not 'blocked by' - past the water read, or near its edge "
        + "when the route only came into the margin - and the refusals hand it which",
        () => /V\.mode==="uncharted" \? \(V\.near \? "near the edge of the chart read" : "past the water the chart was read over"\)/.test(grab("drawViolation"))
              && /near:!!reason\.near/.test(grab("violationFromReason"))
              && /near: !\(out\.outM > 0\)\}/.test(pv)
              && (grab("doTransit").match(/near:!\(plan\.uncharted\.outM > 0\)/g) || []).length === 1
              && (grab("doUpload").match(/near:!\(plan\.uncharted\.outM > 0\)/g) || []).length === 1,
        "drawViolation / violationFromReason / planNogoRoute / doTransit / doUpload");

  // ── 8. THE HOLD DISC STAYS INSIDE THE READ WATER (found by the review) ────────────────────────────────────────────
  // holdClearM measures out to 500 m and past the box edge the model is empty, so a target 300 m inside the box with
  // land 350 m off, outside the extract, shipped a 497 m disc: the vessel drives a STRAIGHT chord back inside it.
  let capped = null, uncapped = null, insideT = null;
  try {
    const T = at(300, 0);                                            // open water 300 m inside the box, 500 m from the island
    world(SMALL, extract(SMALL));
    capped = P.planNogoRoute(A, T, {});
    insideT = P.insideBoxM(T, SMALL);
    world(null, extract(SMALL));
    uncapped = P.planNogoRoute(A, T, {});
  } finally { restore(); }
  check("8. the hold disc a plan ships is capped at the hold point's distance to the box edge, less the buffer - and "
        + "a planner given no box measures it as before",
        () => capped && !capped.error && uncapped && !uncapped.error
              && Math.abs(capped.holdClear - (insideT - 3)) < 0.01 && uncapped.holdClear > capped.holdClear + 50,
        () => (capped && capped.holdClear != null ? "capped " + capped.holdClear.toFixed(1) : "?") + " m (the point "
              + (insideT != null ? insideT.toFixed(1) : "?") + " m inside); with no box "
              + (uncapped && uncapped.holdClear != null ? uncapped.holdClear.toFixed(1) : "?") + " m");

  // ── 9. THE REVIEW'S WIRING ─────────────────────────────────────────────────────────────────────────────────────
  const taut = grab("tautRoundHer"), rfh = grab("resumeFromHere"), upl = grab("doUpload");
  check("9. a taut way round her that runs past the read water is not taken: tautRoundHer judges every route it "
        + "returns, and hands one past the box to the router, which refuses it by name",
        () => /if\(beyondChart\(\[\{lat: fromLL\.lat, lon: fromLL\.lon\}, \.\.\.route\], nogo\.bbox\)\) return null;/.test(taut)
              && (taut.match(/return \{route/g) || []).length === 1,
        "tautRoundHer");
  const iCov = rfh.indexOf("await ensureNogoCovers([from, target]);"), iPic = rfh.indexOf("await planInsideChart([from, target]");
  const closure = iPic > 0 ? rfh.slice(iPic, rfh.indexOf('}, "Resume from here");', iPic)) : "";
  check("9b. Resume from here plans its way in through planInsideChart, AFTER its read, with her and the contacts' "
        + "model taken again INSIDE the plan - not the ones taken before a read that may have replaced the model",
        () => iCov > 0 && iPic > iCov
              && /const ais = aisKoDrawn \|\| \[\];/.test(closure) && /const koIn = koRoundHer\(ais, her, std\);/.test(closure)
              && /planNogoRoute\(from, target, \{\.\.\.holdOpts\(\), standoffM: patClipBufM\(\), ko: koIn, flyThrough: true\}\)/.test(closure),
        "resumeFromHere");
  const iConfirm = upl.indexOf('"Upload WITHOUT routing"'), iRaw = upl.indexOf("const raw = routePlan(");
  const between = iConfirm > 0 && iRaw > iConfirm ? upl.slice(iConfirm, iRaw) : "";
  check("9c. an Upload confirmed WITHOUT a model asks again whether the model landed during the confirm, and sends "
        + "nothing unrouted if it did",
        () => /if\(nogo\.ready\)\{\s*showBanner\("The chart model finished loading while Upload was waiting - NOTHING WAS UPLOADED/.test(between)
              && /render\(\); return;/.test(between),
        "doUpload");

  // ── 10. THE VESSELS ALONG A PASSAGE, READ AS IT IS PLANNED (2026-10-07) ───────────────────────────────────────────
  // The page's own readPassageAis against a stand-in proxy: it answers the vessels within `show_km` of each center it
  // is asked, as the real one does at sea (or the whole lake). Along an 18 km passage the plan is read from centers 1.5
  // radii apart - every point of it within a radius of one - the answers merged by MMSI; at most PASSAGE_AIS_MAX_READS
  // reads; one read on a lake; and nothing at all, nogo.ais null, when the proxy does not answer.
  {
    const realFetch = globalThis.fetch, asked = [];
    const vessels = [0, 4000, 9000, 13500, 18000].map((n, i) => { const p = F.fromEN(0, n); return { mmsi: 100 + i, lat: p.lat, lon: p.lon, sog: 0 }; });
    let mode = "sea", up = true;
    globalThis.fetch = async (url) => {
      const [lat, lon] = url.split("center=")[1].split(",").map(Number);
      asked.push({ lat, lon });
      if (!up) return { json: async () => ({ ok: false, vessels: [] }) };
      const within = mode === "lake" ? vessels : vessels.filter((v) => distTo({ lat, lon }, v) <= 9260);
      // (the real proxy sends no radius with a lake; this one does, so it is the lake rule that holds it to one read)
      return { json: async () => ({ ok: true, vessels: within, area: mode === "lake" ? { mode: "lake", name: "Lake Test", show_km: 9.26 }
                                                                                       : { mode: "sea", show_km: 9.26 } }) };
    };
    const A10 = F.fromEN(0, 0), B10 = F.fromEN(0, 18000);
    try {
      await readPassageAis([A10, B10]);
      const sea = { reads: asked.length, ids: (nogo.ais && nogo.ais.vessels.map((v) => v.mmsi).sort().join(",")) || "",
                    fresh: !!(nogo.ais && Date.now() - nogo.ais.polledAt < 5000),
                    covered: [0, 3000, 6000, 9000, 12000, 15000, 18000].every((n) => asked.some((c) => distTo(c, F.fromEN(0, n)) <= 9260)) };
      asked.length = 0;
      const many = []; for (let k = 0; k <= 20; k++) many.push(F.fromEN(k % 2 ? 2000 : 0, k * 9000));   // a 180 km plan
      await readPassageAis(many);
      const capped = asked.length;
      asked.length = 0; mode = "lake";
      await readPassageAis([A10, B10]);
      const lake = asked.length;
      asked.length = 0; mode = "sea"; up = false;
      await readPassageAis([A10, B10]);
      const down = { reads: asked.length, ais: nogo.ais };
      check("10. AN 18 km PASSAGE IS READ ALONG ITS LENGTH: centers 1.5 radii apart cover every point of it, the answers "
            + "merged by MMSI (all five vessels, each once); a 180 km plan is held to PASSAGE_AIS_MAX_READS reads; a lake is "
            + "one read; and a proxy that does not answer leaves nogo.ais null (the chart's model alone, as before)",
            sea.reads === 3 && sea.covered && sea.ids === "100,101,102,103,104" && sea.fresh
              && capped === PASSAGE_AIS_MAX_READS && lake === 1 && down.reads === 1 && down.ais === null,
            "sea: " + sea.reads + " reads, vessels " + sea.ids + ", covered " + sea.covered + "; 180 km: " + capped
              + " reads; lake: " + lake + "; down: " + down.reads + " read, nogo.ais " + JSON.stringify(down.ais));
    } finally { globalThis.fetch = realFetch; nogo.ais = null; }
  }

  console.log(fails ? fails + " CHECK(S) FAILED of " + ran : "all checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})().catch(__crash);
