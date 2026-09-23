// tests/enc_cache.js - the ENC layer is cached, and the pointer path draws once per frame.
//
// THE MEASUREMENT THIS EXISTS TO PROTECT (2026-09-22, live against a console on port 52010
// holding Andy's mission.json.bak1, browser pane HIDDEN so these are lower bounds):
//
//   * one render() cost 63.7 ms; the identical mousemove that does NOT render cost 0.2 ms,
//     so the draw was the entire cost
//   * idle, nobody touching the page: 13 long tasks / 1795 ms / 35.9 % of the main thread
//   * ENC on 57.5 % vs ENC off 3.4 %, with 1,304 keep-out zones loaded BOTH ways - so
//     drawENC was ~50 points of it and drawNogo ~4
//   * /api/enc for one view: 5,674 features / 481,980 coordinate pairs, walked THREE times
//   * SURV mode with a pattern down: 87.5 ms per pointer event, so a 2 s corner drag at
//     100 Hz is ~17.5 s of blocked main thread - his recorded stall was 20.2 s
//   * AFTER: idle 35.9 % -> 1.0 % (1 long task of 50 ms in 5 s), ink still present, and a
//     zoom still invalidated the layer and redrew
//
//   node tests/enc_cache.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// """ + W + """ THE PAN NUMBER IS NOT IN THAT LIST ON PURPOSE. It was measured at 0.5 ms per move and
// that number is WORTHLESS: requestAnimationFrame does not fire in a hidden pane, so the
// coalesced draw never ran and the "measurement" timed a handler that had deferred all its
// work to a callback that was never going to happen. A displayed-pane pan measurement is
// OWED. The idle figure above is sound because onState calls render() DIRECTLY, not through
// renderSoon(), so that path runs hidden or not.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// ⚠ REQUIRED OF EVERY SUITE (turn_geometry 30). Without it a throw out here kills the run
// before a single FAIL line prints, and a runner reading stdout scores that as a pass - which
// is strictly worse than the suite not existing. It is also what lets the runner treat FAIL
// lines alone as the signal, since the suites end with five different summary wordings.
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
const codeOnly = s => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

console.log("The ENC layer is cached, and the key is the whole point:");

// -- THE WORLD --------------------------------------------------------------------------
// A fake canvas/context that RECORDS. drawENC is the real one, so a miss really walks the
// features and a hit really does not.
let drew = 0, blits = 0;
function fakeCtx() {
  const noop = () => {};
  return { save: noop, restore: noop, beginPath: () => { drew++; }, closePath: noop,
           moveTo: noop, lineTo: noop, stroke: noop, fill: noop, arc: noop,
           clearRect: noop, setLineDash: noop, drawImage: () => { blits++; },
           fillStyle: "", strokeStyle: "", lineWidth: 0, font: "" };
}
const ctx = fakeCtx();
// ⚠ THE CACHE'S OWN THREE, AT MODULE SCOPE. The page declares them with `let` on a bare
// declaration line, which grab() cannot reach (it takes functions), and a `let` written inside
// the eval below would live in the eval's scope where drawENCCached writes it and nothing here
// could read it. Mirrored out here, as guard_resume records for holdWant.
var encLayer = null, encLayerSrc = null, encLayerKey = "";
let sea = { enc: { features: [] }, waterOffset: 0 };
let zoom = 13;
const V = { WRECK_RADIUS_M: 25, NOGO_BUFFER_M: 3, NOGO_MIN_DEPTH_M: 1, OPER_MIN_DEPTH_M: 3 };
const M_PER_DEG_LAT = 111320;
function nogoDR() { return { min: Math.max(V.NOGO_MIN_DEPTH_M, V.OPER_MIN_DEPTH_M), max: 0 }; }
function hazExtent() { return 0; }
function eachRing(g, fn) { if (g && g.type === "Polygon") g.coordinates.forEach(fn); }
function eachPath(g, fn) { if (g && g.type === "LineString") fn(g.coordinates); }
function eachPoint(g, fn) { if (g && g.type === "Point") fn(g.coordinates); }
// the offscreen canvas the page asks the DOM for
globalThis.document = { createElement: () => {
  const c = { width: 0, height: 0, _ctx: fakeCtx() };
  c.getContext = () => c._ctx;
  return c;
} };

// eslint-disable-next-line no-eval
eval(grab("drawENC") + "\n" + grab("encLayerKeyNow") + "\n" + grab("drawENCCached"));

const feat = { role: "land", geometry: { type: "Polygon", coordinates: [[[0,0],[0,1],[1,1],[0,0]]] } };
const toScreen = (lat, lon) => ({ x: lon * 100, y: lat * 100 });
const reset = () => { drew = 0; blits = 0; };

// -- 1-2. A HIT DRAWS NOTHING AND BLITS; A VIEW CHANGE REDRAWS ---------------------------
sea.enc = { features: [feat] };
const o = { x: 100, y: 200 };
reset(); drawENCCached(toScreen, 800, 600, o);
const first = { drew, blits };
reset(); drawENCCached(toScreen, 800, 600, o);
const second = { drew, blits };
check("1. the second draw of an unchanged view walks NO features and blits the layer",
      () => first.drew > 0 && first.blits === 1 && second.drew === 0 && second.blits === 1,
      "first pass drew " + first.drew + " path(s) and blitted " + first.blits
        + "; the repeat drew " + second.drew + " and blitted " + second.blits
        + ". At 4 Hz with 481,980 coordinate pairs this is the 35.9 % of the main thread the "
        + "page was spending on a chart that had not changed");

reset(); drawENCCached(toScreen, 800, 600, { x: 140, y: 200 });
const moved = { drew, blits };
check("2. ... and a view that MOVED redraws it",
      () => moved.drew > 0 && moved.blits === 1,
      "panned 40 px -> drew " + moved.drew + " path(s). A cache that never misses is faster "
        + "and wrong, and would strand the chart at the place it was first drawn");

// -- 3-6. THE KEY CARRIES EVERY INPUT drawENC READS --------------------------------------
// """ + W + W + """ THESE ARE THE CHECKS THAT MATTER. hazExtent(f) -> koOpts() reads sea.waterOffset,
// nogoDR().min, V.WRECK_RADIUS_M and V.NOGO_BUFFER_M, so the hazard circles in this layer move
// with the TIDE and with the operator's depth floor WITHOUT the zoom or the origin changing.
// A key of (view + data) alone is faster and holds a stale tide's clearances under an
// operator, silently - the direction chart.js's own koOpts comment refuses to cache in.
const stable = () => { reset(); drawENCCached(toScreen, 800, 600, o); return drew; };
stable();                                    // prime at the current key
const invalidatesOn = (label, mutate, restore) => {
  mutate();
  reset(); drawENCCached(toScreen, 800, 600, o);
  const d = drew;
  restore();
  stable();                                  // re-prime so the next case starts from a hit
  return { label, drew: d };
};
const tide = invalidatesOn("the tide moved", () => { sea.waterOffset = 0.41; },
                           () => { sea.waterOffset = 0; });
check("3. the TIDE is in the key - a layer is not held across a water-level change",
      () => tide.drew > 0,
      "sea.waterOffset 0 -> 0.41 redrew " + tide.drew + " path(s). hazExtent reads it through "
        + "koOpts, so the hazard circles this layer draws are sized for the water level at "
        + "the moment it was drawn");

const floor = invalidatesOn("the depth floor moved", () => { V.OPER_MIN_DEPTH_M = 5; },
                            () => { V.OPER_MIN_DEPTH_M = 3; });
check("4. ... and so is the operator's DEPTH FLOOR",
      () => floor.drew > 0,
      "OPER_MIN_DEPTH_M 3 -> 5 redrew " + floor.drew + " path(s) (nogoDR().min, through koOpts)");

const hull = invalidatesOn("the hull changed", () => { V.WRECK_RADIUS_M = 60; },
                           () => { V.WRECK_RADIUS_M = 25; });
check("5. ... and the VESSEL's own wreck radius and buffer, which change when the hull does",
      () => hull.drew > 0,
      "WRECK_RADIUS_M 25 -> 60 redrew " + hull.drew + " path(s). V.* is rewritten when the "
        + "operator switches hull, which changes no view field at all");

// -- 6. THE DATA IS COMPARED BY IDENTITY, NOT BY COUNT -----------------------------------
reset();
sea.enc = { features: [feat] };              // a DIFFERENT object with the SAME feature count
drawENCCached(toScreen, 800, 600, o);
const refetched = drew;
check("6. a refetch of the same water is a MISS - the data is compared by identity, not count",
      () => refetched > 0,
      "a new sea.enc object of the same length redrew " + refetched + " path(s). fetchENCBbox "
        + "REPLACES sea.enc wholesale, so `===` is exact; a feature COUNT would serve the old "
        + "band's features back after a refetch at a different depth");

// -- 7-8. THE POINTER PATH IS COALESCED, THE TELEMETRY PATH IS NOT ------------------------
{
  const mm = codeOnly(H.slice(H.indexOf('window.addEventListener("mousemove", e=>{\n  const o = originPx()'),
                              H.indexOf('mapEl.addEventListener("mouseleave"')));
  check("7. every draw request on the POINTER path is coalesced",
        () => mm.length > 0 && /renderSoon\(\);/.test(mm) && !/[^n]render\(\);/.test(mm),
        () => "the chart mousemove handler asks " + (mm.match(/renderSoon\(\);/g) || []).length
            + " time(s) via renderSoon and " + (mm.match(/[^n]render\(\);/g) || []).length
            + " time(s) direct. It called render() SEVEN times, once per pointer event, at "
            + "63.7 ms each - and in SURV mode 87.5 ms, which is a 20.2 s stall on a 2 s drag");

  // """ + W + """ AND THE TELEMETRY PATH IS DELIBERATELY NOT COALESCED. onState calls render() ONCE per
  // frame, so there is nothing there to coalesce - what that path needed was the cheaper draw.
  // Routing it through renderSoon would ALSO stop the chart updating in a hidden window, where
  // rAF never fires, and the supervising tab is frequently the occluded one.
  const on = codeOnly(grab("onState"));
  check("8. ... and the 4 Hz telemetry path still renders DIRECTLY",
        () => /speedReconcile\(s, st\);/.test(on) && /[^n]render\(\);/.test(on)
              && !/renderSoon/.test(on),
        "onState calls render() once per frame. Coalescing it would buy nothing - there is one "
          + "call - and would stop the chart updating in an occluded window, because rAF does "
          + "not fire there. That is the trap this file records three times over");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
