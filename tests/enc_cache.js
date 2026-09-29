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
//   * 2026-09-29, his 25-line plan loaded, the boat idle: render() was 22.9 ms of a 23.9 ms
//     telemetry frame and drawNogo 18.6 of it - the keep-out layer had no cache at all - and under
//     way the chart FOLLOWS the boat, so the view-keyed ENC layer missed on every frame as well.
//     Both are held in a layer drawn over the view plus LAYER_PAD_PX a side (drawLayer), redrawn
//     only when the view leaves it or an input changes (checks 2, 2b and 10-14)
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
let drew = 0, blits = 0, lastBlit = null, rec = null;
function fakeCtx() {
  const noop = () => {};
  // `rec`, when a check sets it, collects every vertex drawn: what 13 compares between the direct
  // draw and the cached one. `lastBlit` is where the layer was put on the screen.
  const pt = (x, y) => { if (rec) rec.push([x, y]); };
  return { save: noop, restore: noop, beginPath: () => { drew++; }, closePath: noop,
           moveTo: pt, lineTo: pt, stroke: noop, fill: noop, arc: noop,
           clearRect: noop, setLineDash: noop,
           drawImage: (src, x, y) => { blits++; lastBlit = { x, y }; },
           fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", lineCap: "" };
}
const ctx = fakeCtx();
// ⚠ THE CACHES' OWN STATE, AT MODULE SCOPE. The page declares them as `const encLayer = makeLayer()`
// on a bare declaration line, which grab() cannot reach (it takes functions), and a declaration
// written inside the eval below would live in the eval's scope where drawENCCached writes it and
// nothing here could read it. Mirrored out here (and made after the eval, which defines makeLayer),
// as guard_resume records for holdWant.
var encLayer = null, nogoLayer = null;
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

// the keep-out layer's world (checks 10-14): what drawNogo reads, each of it movable by a check
let nogoShow = true, SD = { min: 0, max: 0 }, PAT = null;
let nogo = { ready: true, features: [], enf: { land: true, depth: true } };
let chartInk = { lines: [], areas: [] };
function depthRange() { return { min: SD.min, max: SD.max }; }
function currentPattern() { return PAT; }
// the page's depthExcluded corrects a feature's depth by the tide; so does this one, so the tide matters
function depthExcluded(f, dr) { return (f.d + (sea.waterOffset || 0)) < dr.min; }

// the margin a layer is drawn with, read from the page so a change to it moves these checks with it
const PAD = +(H.match(/const LAYER_PAD_PX = (\d+);/) || [])[1];
// eslint-disable-next-line no-eval
eval("const LAYER_PAD_PX = " + PAD + ";\n" + grab("makeLayer") + "\n" + grab("layerHolds") + "\n" + grab("drawLayer")
     + "\n" + grab("drawENC") + "\n" + grab("encLayerKeyNow") + "\n" + grab("drawENCCached")
     + "\n" + grab("drawNogo") + "\n" + grab("nogoLayerKeyNow") + "\n" + grab("drawNogoCached"));
encLayer = makeLayer(); nogoLayer = makeLayer();

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

// 2. A PAN INSIDE THE DRAWN MARGIN IS A BLIT AT THE NEW OFFSET (2026-09-29). The chart follows the boat
//    on every frame she has a fix, so under way this is the ordinary frame, not a corner case - and the
//    view-keyed cache missed on every one of them. The layer must MOVE with the view, pixel for pixel,
//    or it strands the chart where it was first drawn; past the margin it is a redraw.
reset(); drawENCCached(toScreen, 800, 600, o);
const at0 = lastBlit;
reset(); drawENCCached(toScreen, 800, 600, { x: 140, y: 200 });
const moved = { drew, blits, at: lastBlit };
check("2. a view that moved WITHIN the drawn margin draws nothing, and the layer moves 40 px with it",
      () => moved.drew === 0 && moved.blits === 1 && !!at0 && !!moved.at
            && moved.at.x === at0.x - 40 && moved.at.y === at0.y,
      () => "panned 40 px -> drew " + moved.drew + " path(s), blitted at " + JSON.stringify(moved.at)
            + " (was " + JSON.stringify(at0) + ")");
reset(); drawENCCached(toScreen, 800, 600, { x: 100 + PAD + 40, y: 200 });
const past = { drew, blits };
check("2b. ... and one that moved PAST the margin redraws it",
      () => PAD > 0 && past.drew > 0 && past.blits === 1,
      "panned " + (PAD + 40) + " px, beyond the " + PAD + " px margin -> drew " + past.drew
        + " path(s). A cache that never misses is faster and wrong, and would strand the chart at "
        + "the place it was first drawn");

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

// 5b. THE ZOOM IS NAMED NOW (2026-09-29). The view-keyed layer had it twice over - the zoom and an
//     origin to the pixel, which every zoom moves - and the padded layer keys on neither origin nor
//     size, so the zoom is the one view term left in its key, and it has to be there by name.
const zm = invalidatesOn("the zoom changed", () => { zoom = 14; }, () => { zoom = 13; });
check("5b. ... and the ZOOM, the one view term the layer's key still carries",
      () => zm.drew > 0,
      "zoom 13 -> 14 redrew " + zm.drew + " path(s). The origin left the key when a pan became a blit, "
        + "so without its own term a zoom would have been blitted at the old scale");

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

// ⚠⚠ 9. A VIEW WITH NO SIZE (2026-09-23). viewSize() is mapEl.clientWidth/clientHeight,
// which is 0x0 whenever the map has no layout - a minimized or background window, a hidden
// pane, the first frame before layout. This layer sized its canvas to that and then blitted
// it, and the browser's rule for drawImage is unforgiving: a source canvas with a width or
// height of 0 is an InvalidStateError. Thrown on EVERY frame, that made the page blind - 465
// telemetry frames failed in a row on the console this was found on - and killed any command
// handler that ends in render() right after its post had landed. Andy saw it as the sim
// "refusing to acknowledge" an RTH the vessel had in fact taken.
//
// ⚠ THE FAKE drawImage ABOVE NEVER THROWS, so against it this check would pass on the broken
// code and prove nothing. For the length of this block it is replaced with the browser's own
// rule, and that is what lets the check go red when the guard is absent.
{
  const lenient = ctx.drawImage;
  ctx.drawImage = (src) => {
    if (!(src && src.width > 0 && src.height > 0))
      throw new Error("InvalidStateError: The image argument is a canvas element with a width or height of 0.");
    blits++;
  };
  encLayer = makeLayer();
  reset();
  // ⚠ THREE DEGENERATE VIEWS, NOT ONE. Driven only at 0x0, this check passed a guard that
  // tested the width alone - the mutation survived - and a window collapsed to zero HEIGHT
  // with a real width would still have thrown. Each axis is its own refusal case.
  let threw = null, blitsAtZero = 0, cachedZero = false;
  for (const [dw, dh] of [[0, 0], [0, 600], [800, 0]]) {
    encLayer = makeLayer(); reset();
    try { drawENCCached(toScreen, dw, dh, o); } catch (e) { threw = threw || (dw + "x" + dh + ": " + e.message); }
    blitsAtZero += blits;
    // (the layer's canvas is `cv` since 2026-09-29; the MARGIN would size even a 0x0 view's layer to 2*PAD
    //  a side, so what makes this red without the guard is the blit count, not the size)
    cachedZero = cachedZero || (!!encLayer.cv && !(encLayer.cv.width > 0 && encLayer.cv.height > 0));
  }
  // THE ACCEPTANCE CASE: the same layer, given a real view, still draws - a guard that made
  // every draw a no-op would pass the refusal above and fail here.
  reset();
  let threwReal = null;
  try { drawENCCached(toScreen, 800, 600, o); } catch (e) { threwReal = e.message; }
  const blitsReal = blits;
  check("9. a view with NO SIZE draws nothing and throws nothing - the cache is never sized 0x0",
        threw === null && blitsAtZero === 0 && !cachedZero && threwReal === null && blitsReal === 1,
        "0x0: " + (threw ? "THREW " + threw.slice(0, 60) : "no throw") + ", " + blitsAtZero
          + " blit(s), cache " + (cachedZero ? "SIZED 0x0" : (encLayer.cv ? "sized for the real view" : "untouched"))
          + "; then 800x600: " + (threwReal ? "THREW" : "drew") + " with " + blitsReal + " blit(s)");
  ctx.drawImage = lenient;
}

// -- 10-14. THE KEEP-OUT LAYER IS CACHED TOO, AND ITS KEY NAMES EVERYTHING drawNogo READS (2026-09-29) -----
// Measured with his 25-line plan loaded and the boat idle: render() 22.9 ms of a 23.9 ms telemetry frame, and
// drawNogo 18.6 of it - no cache at all. A keep-out shading held for the wrong water is WORSE than a slow one, so
// the checks that matter are the key's: every input drawNogo reads must redraw it when it moves.
{
  const poly = (d, role) => ({ role, d, geometry: { type: "Polygon", coordinates: [[[0,0],[0,2],[2,2],[0,0]]] } });
  const shore = { role: "shore_line", geometry: { type: "LineString", coordinates: [[0,0],[3,1],[4,4]] } };
  nogo = { ready: true, features: [poly(0, "land"), poly(2, "depth_area"), shore], enf: { land: true, depth: true } };
  chartInk = { lines: [{ a: { lat: 1, lon: 1 }, b: { lat: 2, lon: 3 } }],
               areas: [{ ring: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }] }] };
  sea.waterOffset = 0; V.OPER_MIN_DEPTH_M = 3; SD = { min: 0, max: 0 }; PAT = null; zoom = 13;
  nogoLayer = makeLayer();
  reset(); drawNogoCached(toScreen, 800, 600, o); const nf = { drew, blits };
  reset(); drawNogoCached(toScreen, 800, 600, o); const ns = { drew, blits };
  nogoShow = false; reset(); drawNogoCached(toScreen, 800, 600, o); const off = { drew, blits }; nogoShow = true;
  // a view with no size (a minimized window): nothing drawn or blitted, as for the ENC layer (9). The margin would
  // size even this layer to 2*PAD a side, so it is the counts that make the guard's absence visible
  const keep = nogoLayer; nogoLayer = makeLayer();
  let zeroDrew = 0, zeroBlits = 0;
  for (const [dw, dh] of [[0, 0], [0, 600], [800, 0]]) { reset(); drawNogoCached(toScreen, dw, dh, o); zeroDrew += drew; zeroBlits += blits; }
  nogoLayer = keep;
  check("10. the keep-out layer is CACHED: the second draw of an unchanged view walks no feature and blits it - and "
        + "switched off, or in a view with no size, nothing is drawn or blitted",
        () => nf.drew > 0 && nf.blits === 1 && ns.drew === 0 && ns.blits === 1 && off.drew === 0 && off.blits === 0
              && zeroDrew === 0 && zeroBlits === 0,
        "first " + nf.drew + " path(s), repeat " + ns.drew + " (" + ns.blits + " blit), off " + off.drew + "/" + off.blits
          + ", no size " + zeroDrew + "/" + zeroBlits
          + ". 18.6 ms of every 23.9 ms telemetry frame, with his plan loaded, was this layer redrawn unchanged");

  const primeN = () => { reset(); drawNogoCached(toScreen, 800, 600, o); };
  const movesIt = (label, mutate, restore) => {
    primeN(); mutate(); reset(); drawNogoCached(toScreen, 800, 600, o); const d = drew; restore(); primeN();
    return { label, d };
  };
  const inputs = [
    movesIt("structures enforced", () => { nogo.enf.land = false; }, () => { nogo.enf.land = true; }),
    movesIt("depth enforced", () => { nogo.enf.depth = false; }, () => { nogo.enf.depth = true; }),
    movesIt("the depth floor", () => { V.OPER_MIN_DEPTH_M = 5; }, () => { V.OPER_MIN_DEPTH_M = 3; }),
    movesIt("the survey window's floor", () => { SD = { min: 4, max: 0 }; }, () => { SD = { min: 0, max: 0 }; }),
    movesIt("the survey window's ceiling", () => { SD = { min: 0, max: 30 }; }, () => { SD = { min: 0, max: 0 }; }),
    movesIt("a pattern up (the amber tier)", () => { PAT = { lines: [] }; }, () => { PAT = null; }),
    movesIt("the tide", () => { sea.waterOffset = 1.2; }, () => { sea.waterOffset = 0; }),
    movesIt("the zoom", () => { zoom = 14; }, () => { zoom = 13; }),
  ];
  const stale = inputs.filter(x => !(x.d > 0)).map(x => x.label);
  check("11. its key names EVERY input drawNogo reads - the two enforce toggles, the depth floor, the survey window "
        + "both ways, a pattern being up, the tide and the zoom each redraw it",
        () => stale.length === 0,
        () => stale.length ? "HELD across: " + stale.join(", ") : inputs.length + " inputs, every one redraws");

  const srcCases = [
    movesIt("a refetch (a new feature list, the same features)", () => { nogo.features = nogo.features.slice(); }, () => {}),
    movesIt("a new chart read's lines", () => { chartInk = { ...chartInk, lines: chartInk.lines.slice() }; }, () => {}),
    movesIt("a new chart read's footprints", () => { chartInk = { ...chartInk, areas: chartInk.areas.slice() }; }, () => {}),
  ];
  const same = (() => { primeN(); chartInk = { ...chartInk }; reset(); drawNogoCached(toScreen, 800, 600, o); return drew; })();
  const missed = srcCases.filter(x => !(x.d > 0)).map(x => x.label);
  check("12. its SOURCES are compared by identity - a new feature list, a new chart read's lines or footprints "
        + "each redraw it; the same arrays under a new chartInk object do not",
        () => missed.length === 0 && same === 0,
        () => (missed.length ? "HELD across: " + missed.join(", ") : "all three redraw") + "; the same arrays: "
              + same + " path(s)");

  // 13. THE CACHED DRAW IS THE DIRECT DRAW, MOVED BY THE BLIT: every vertex the layer holds, put where the blit puts
  //     it, is the vertex the direct draw would have put on the screen - in the same order.
  const verts = (fn) => { rec = []; fn(); const r = rec; rec = null; return r; };
  nogoLayer = makeLayer();
  let blitAt = null;
  const cached = verts(() => { lastBlit = null; drawNogoCached(toScreen, 800, 600, o); blitAt = lastBlit; });
  const direct = verts(() => drawNogo(toScreen, ctx));
  let worst = 0;
  const sameGeom = cached.length === direct.length && cached.length > 0 && !!blitAt
    && cached.every((v, i) => { const e = Math.max(Math.abs(v[0] + blitAt.x - direct[i][0]), Math.abs(v[1] + blitAt.y - direct[i][1]));
                                 worst = Math.max(worst, e); return e < 1e-9; });
  // and at a FRACTIONAL origin - the ordinary case, since the view centers on the boat - the blit is whole pixels,
  // so a vertex may land up to half a pixel from where a direct draw puts it, never more
  const of = { x: 100.37, y: 200.81 };
  const tsF = (lat, lon) => ({ x: lon * 100 - of.x + 100, y: lat * 100 - of.y + 200 });
  nogoLayer = makeLayer();
  let blitF = null;
  const cachedF = verts(() => { lastBlit = null; drawNogoCached(tsF, 800, 600, of); blitF = lastBlit; });
  const directF = verts(() => drawNogo(tsF, ctx));
  let worstF = 0;
  cachedF.forEach((v, i) => { worstF = Math.max(worstF, Math.abs(v[0] + blitF.x - directF[i][0]), Math.abs(v[1] + blitF.y - directF[i][1])); });
  check("13. the cached layer IS the direct draw, moved by its blit - every vertex in the same order, exactly at a whole-"
        + "pixel origin and within half a pixel at a fractional one",
        () => sameGeom && cachedF.length === directF.length && worstF <= 0.5 + 1e-9,
        () => cached.length + " vertices, worst " + worst.toExponential(1) + " px; at a fractional origin "
              + worstF.toFixed(3) + " px (blit at " + JSON.stringify(blitF) + ")");

  const rn = codeOnly(grab("render"));
  check("14. render() draws the keep-out layer THROUGH the cache, not directly",
        () => /drawNogoCached\(toScreen, w, h, o\);/.test(rn) && !/drawNogo\(toScreen/.test(rn),
        "render in static/asv.html");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
