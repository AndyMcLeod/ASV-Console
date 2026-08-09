// tests/measure_tool.js - the chart MEASUREMENT TOOL and the right-click menu that arms it.
//
// WHY THIS EXISTS. Andy asked for a ruler on the chart: right-click -> Measure, click a
// point, move, click again, with the distance running ALONG the line. Three things about
// that are easy to get wrong in ways that look fine on screen, and each has bitten this
// console before under a different name:
//
//   * THE VALUE, NOT THE LABEL. The AIS range control shipped a field labelled nm holding
//     a km number - wrong by 1.852, with a plausible figure on screen. So check 2 asserts
//     1852 m reads "1.00 nm", not "1.85 nm", and that the pill moves it BOTH ways.
//   * THE RECIPROCAL. The survey card derived a line's direction and got its reciprocal
//     back (typed 327, card read 147). A bearing is only right if reversing the endpoints
//     moves it by 180 - check 4 measures exactly that.
//   * PAINTED UNDER SOMETHING. The pattern move grip was drawn, live and invisible, because
//     the boat marker painted over it. Check 22 pins drawMeasure() after the boat in
//     render().
//
// And one that is new here: a right-click fires mousedown AND mouseup, so the gesture that
// opens the menu would ALSO have run the chart's mode chain - anchoring a measurement, or
// (latent long before this feature) dropping a waypoint. Check 12 holds that guard.
//
//   node tests/measure_tool.js      # exit 0 = pass, 1 = fail   (stdlib Node, no deps)
//
// TEETH (each mutation run, results in CLAUDE.md):
//   * measLabel hand-rolls (m/1000).toFixed(2)+" km"      -> 1,2 fail
//   * bearing taken b->a (the reciprocal)                 -> 4 fails
//   * bearing printed unpadded (String(deg))              -> 5 fails
//   * the upside-down flip dropped                        -> 6 fails
//   * MEAS_LABEL_MIN_PX floor dropped (label always)      -> 7 fails
//   * second click replaces instead of completing         -> 9,10 fail
//   * the measure branch moved ABOVE the `moved > 5` pan   -> 11 fails
//     guard
//   * mousedown's `e.button !== 0` guard removed          -> 12 fails
//   * cmGate re-derives the arm rule from S.armed         -> 14,15 fail
//   * a disabled row acts anyway (the .off check dropped) -> 16 fails
//   * a row reads the LIVE pointer instead of menuLL      -> 17 fails
//   * the viewport clamp dropped                          -> 18 fails
//   * setMode stops dropping the pending leg              -> 21 fails
//   * drawMeasure moved above the boat in render()        -> 22 fails
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy, and the
// evals below reproduce that.

const fs = require("fs");
const path = require("path");

// LAYER-0 HELPERS COME FROM THE REAL MODULES, not from asv.html's source text.
// These moved out of the page on 2026-08-09. Requiring them means a renamed or
// deleted export fails HERE, loudly, instead of silently reverting to a stale copy;
// and the checks below exercise the shipped function rather than an eval of its text.
// Top-level so the suite's DIRECT eval() of page functions still resolves them.
const { azTo, distTo } = require("../static/js/geodesy.js");
const { fmtDist, setDistUnit } = require("../static/js/units.js");

// --- source lookup: the page AND its modules -----------------------------------------
// Parts of the client live in static/js/*.js now, so a name this suite lifts as SOURCE TEXT
// may be in either place. MODSRC is those modules concatenated with the `export` keyword
// stripped, which makes each declaration read exactly as it did when it sat in the page -
// so the grab helpers below need no other change.
const MODSRC = require("fs")
  .readdirSync(require("path").join(__dirname, "..", "static", "js"))
  .filter(f => f.endsWith(".js"))
  .map(f => require("fs").readFileSync(
    require("path").join(__dirname, "..", "static", "js", f), "utf8"))
  .join("\n")
  .replace(/^export /gm, "");

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

let fails = 0, ran = 0;
// Every condition is a thunk and a THROW is a failed check, never a dead process - a
// harness that cannot survive the fault it tests for cannot report it.
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!cond(); note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}

// Scenario setup that runs OUTSIDE a thunk (so a failure note can report the state the
// check actually saw) must still survive the fault it is testing for: a mutation that makes
// openChartMenu throw would otherwise kill the process before a single FAIL line printed,
// and the runner would score that as SURVIVED. attempt() turns the throw into data.
function attempt(fn) {
  try { return { ok: true, value: fn() }; }
  catch (e) { return { ok: false, err: e.message }; }
}

function grab(name) {
  const HS = H.indexOf("function " + name + "(") >= 0 ? H : MODSRC;
  const start = HS.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = HS.indexOf("{", start), depth = 0;
  for (;;) { const c = HS[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return HS.slice(start, k + 1);
}
// The gesture lives in an anonymous listener, not a named function, so grab its BODY and
// run the real shipped code rather than a paraphrase of it. Testing a paraphrase is how a
// clamp stayed green while its only caller lost it.
function grabListener(target, type) {
  const needle = target + '.addEventListener("' + type + '"';
  const start = H.indexOf(needle);
  if (start < 0) throw new Error("test setup: no " + target + " " + type + " listener (renamed?)");
  const open = H.indexOf("{", H.indexOf("=>", start));
  let k = open, depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(open, k + 1);
}

console.log("Measurement tool — a ruler on the chart, and the menu that arms it:");

// ---- the readout that flows along the line ----------------------------------------- //
// Real geodesy + the real formatter: measLabel is only correct if the console's own
// distance and azimuth functions are the ones behind it.
var M_PER_DEG_LAT = 111320;   // distUnit now lives in units.js (setDistUnit)
// eslint-disable-next-line no-eval
eval(grab("measLabel"));

const MEAS_SRC = grab("measLabel");
check("1  distance goes through fmtDist, so a measurement follows the DIST pill",
  () => /fmtDist\s*\(\s*distTo\s*\(/.test(MEAS_SRC) && !/\/\s*1000/.test(MEAS_SRC),
  () => MEAS_SRC.replace(/\s+/g, " ").slice(0, 96));

// 1852 m due east of the origin. The VALUE is what is asserted, in both units - a field
// merely LABELLED nm passes a label check while showing kilometres.
const A = { lat: 40.0, lon: -75.0 };
const eastM = (m) => ({ lat: A.lat, lon: A.lon + m / (M_PER_DEG_LAT * Math.cos(A.lat * Math.PI / 180)) });
check("2  the nm VALUE converts both ways (1852 m = 1.00 nm, 1.85 km)", () => {
  setDistUnit("nm"); const nm = measLabel({ a: A, b: eastM(1852) });
  setDistUnit("km"); const km = measLabel({ a: A, b: eastM(1852) });
  return /^1\.00 nm/.test(nm) && /^1\.85 km/.test(km);
}, () => { setDistUnit("nm"); const n = measLabel({ a: A, b: eastM(1852) }); setDistUnit("km"); return n + " / " + measLabel({ a: A, b: eastM(1852) }); });

check("3  a short leg still reads in metres (the standing units rule)", () => {
  setDistUnit("nm"); const s = measLabel({ a: A, b: eastM(240) }); setDistUnit("km");
  return /^240 m/.test(s);
}, () => { setDistUnit("nm"); const s = measLabel({ a: A, b: eastM(240) }); setDistUnit("km"); return s; });

// A bearing is only right if reversing the endpoints moves it by 180.
check("4  the bearing is the TRUE azimuth a->b, not its reciprocal", () => {
  const north = { lat: A.lat + 0.02, lon: A.lon };
  const fwd = measLabel({ a: A, b: north }), rev = measLabel({ a: north, b: A });
  return /· 000°$/.test(fwd) && /· 180°$/.test(rev);
}, () => measLabel({ a: A, b: { lat: A.lat + 0.02, lon: A.lon } }) + " / " +
        measLabel({ a: { lat: A.lat + 0.02, lon: A.lon }, b: A }));

check("5  the bearing is zero-padded to three digits, as a chart reads one", () => {
  const p = { lat: A.lat + 0.01, lon: A.lon }, q = { lat: A.lat, lon: A.lon + 0.0002 };
  return /· 0\d\d°$/.test(measLabel({ a: A, b: p })) && /· 0\d\d°$/.test(measLabel({ a: A, b: q }));
}, () => measLabel({ a: A, b: { lat: A.lat + 0.01, lon: A.lon } }));

// ---- the label as DRAWN: never upside-down, never on a leg too short to carry it ---- //
// A canvas stub that records what actually reached the context. The rotation is the whole
// point of "flows along the line", and it is invisible to any source-shape check.
function fakeCtx() {
  const c = {
    _rot: [], _text: [], _stack: 0,
    save() { c._stack++; }, restore() { c._stack--; },
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, stroke() {}, fill() {},
    setLineDash() {}, translate() {},
    // A monospace approximation that answers for the CURRENT font, like the real one.
    // A fake returning a constant width would let the fit test pass while the threshold
    // ignored the font entirely - which is the whole thing check 7 now exists to catch.
    measureText(t) {
      const px = parseFloat((/(\d+(?:\.\d+)?)px/.exec(c.font) || [0, 10])[1]);
      return { width: String(t).length * px * 0.6 };
    },
    rotate(a) { c._rot.push(a); },
    strokeText(t) { c._text.push(t); }, fillText(t) { c._text.push(t); },
    font: "", textAlign: "", lineWidth: 0, strokeStyle: "", fillStyle: "",
  };
  return c;
}
var ctx = fakeCtx();
var MEAS_COL, MEAS_FONT_PX, MEAS_FONT, MEAS_LABEL_GAP, MEAS_HALO_PX, MEAS_LABEL_PAD_PX;
// `const` inside eval() is scoped to the eval, so it would never reach these vars -
// strip the keyword and let each become a plain assignment. Taken from the page rather
// than restated here, so a retuned font is measured, never assumed.
for (const name of ["MEAS_COL", "MEAS_FONT_PX", "MEAS_FONT", "MEAS_LABEL_GAP",
                    "MEAS_HALO_PX", "MEAS_LABEL_PAD_PX"]) {
  const m = H.match(new RegExp("const " + name + " = .*?;"));
  if (!m) throw new Error("test setup: const " + name + " not found (renamed?)");
  // eslint-disable-next-line no-eval
  eval(m[0].replace(/^const /, ""));
}
eval(grab("drawMeasureLeg")); eval(grab("drawMeasure"));

// "Upside-down" is a question about the EFFECTIVE rotation, so normalise into (-180,180]
// first: a +105° leg flips to 285°, which is -75° and reads perfectly well.
const norm = a => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
let worstRot = 0;
check("6  the label never prints upside-down (|rotation| <= 90° all round the compass)", () => {
  for (let deg = 0; deg < 360; deg += 15) {
    ctx = fakeCtx();
    const r = deg * Math.PI / 180, L = 200;
    drawMeasureLeg({ x: 0, y: 0 }, { x: Math.cos(r) * L, y: Math.sin(r) * L }, "1.00 km · 090°", false);
    if (!ctx._rot.length) return false;
    worstRot = Math.max(worstRot, norm(ctx._rot[0]));
  }
  return worstRot <= Math.PI / 2 + 1e-9;
}, () => "worst " + (worstRot * 180 / Math.PI).toFixed(1) + "°, sampled every 15°");

// The floor is MEASURED from the text, so the test measures it the same way rather than
// naming a number the font can invalidate.
const fitProbe = "1.24 km · 047°";
const fitWidth = fitProbe.length * MEAS_FONT_PX * 0.6;
check("7  a leg too short to carry the label draws none; a long enough one does", () => {
  ctx = fakeCtx();
  drawMeasureLeg({ x: 0, y: 0 }, { x: fitWidth + MEAS_LABEL_PAD_PX - 4, y: 0 }, fitProbe, false);
  const shortHas = ctx._text.length > 0;
  ctx = fakeCtx();
  drawMeasureLeg({ x: 0, y: 0 }, { x: fitWidth + MEAS_LABEL_PAD_PX + 4, y: 0 }, fitProbe, false);
  return !shortHas && ctx._text.length > 0;
}, () => "fits at >" + Math.round(fitWidth + MEAS_LABEL_PAD_PX) + " px for " + fitProbe.length + " chars");

// THE INVARIANT THE WHOLE CONSTANT BLOCK EXISTS FOR. One number sets the reading's size and
// the gap and halo follow it. Restating any of them as a pixel literal is how the ENV rose
// came apart (327ce0c): the one value that scaled was fine, everything beside it was not.
const LEG_SRC = grab("drawMeasureLeg");
const DERIVED_DECLS = ["MEAS_FONT", "MEAS_LABEL_GAP", "MEAS_HALO_PX"]
  .map(n => (H.match(new RegExp("const " + n + " = .*?;")) || [""])[0]);
check("7b the label's size, gap and halo all derive from ONE constant",
  () => DERIVED_DECLS.every(d => d.includes("MEAS_FONT_PX"))
    && !/\b\d+px\b/.test(LEG_SRC)                    // no font size restated in the drawing
    && LEG_SRC.includes("MEAS_HALO_PX") && LEG_SRC.includes("MEAS_LABEL_GAP"),
  () => DERIVED_DECLS.map(d => d.replace(/\s+/g, " ")).join(" | ").slice(0, 96));

// Andy asked for the numbers to read LARGER. Pin the requirement, not the number: the
// chart's ordinary markers (L#, W#, T#) are read out of render() rather than restated.
const CHART_LABEL_PX = parseFloat((grab("render").match(/ctx\.font = "(\d+)px/) || [0, 10])[1]);
check("7c the reading is LARGER than the chart's ordinary labels",
  () => MEAS_FONT_PX > CHART_LABEL_PX,
  () => MEAS_FONT_PX + " px vs the chart's " + CHART_LABEL_PX + " px markers");

check("8  the label is haloed, so it reads over tiles, ENC fill and depth figures", () => {
  ctx = fakeCtx();
  drawMeasureLeg({ x: 0, y: 0 }, { x: 200, y: 0 }, "1.00 km · 090°", false);
  return ctx._text.length >= 2 && ctx._text[0] === ctx._text[1];   // strokeText then fillText
}, () => "text draws: " + ctx._text.length);

// ---- THE GESTURE, driven through the real mouseup handler --------------------------- //
// Screen -> world is stubbed to an identity-ish map so a click at (x,y) is (y/1000, x/1000):
// deterministic, and it keeps the test about the GESTURE rather than about Mercator.
const MOUSEUP = grabListener("window", "mouseup");
function gesture() {
  const G = {
    mode: "measure", measures: [], measPend: null,
    dragging: true, downAt: null, renders: 0,
    patDrag: null, patMoveLast: null, boundDrag: null, searchDrag: false, wpDrag: null,
    mission: { lines: [], waypoints: [] },
  };
  const env = {
    get mode() { return G.mode; },
    zoom: 15,
    mapEl: { classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    originPx: () => ({ x: 0, y: 0 }),
    worldToLatLon: (x, y) => ({ lat: y / 1000, lon: x / 1000 }),
    render: () => { G.renders++; },
    saveMission: () => {}, updateXTE: () => {}, updatePatReadout: () => {},
    updateSearchPanel: () => {}, updateTransitPanel: () => {}, deleteWaypoint: () => {},
    deleteLineByIndex: () => {}, surveyLineAtPx: () => -1, closeBoundary: () => {},
    doGoTo: () => {}, doSpawn: () => {}, setMode: () => {}, rocPost: () => {},
    showPanel: () => {}, worldPx: () => ({ x: 0, y: 0 }), $: () => ({ style: {}, classList: { add() {} } }),
    boundary: [], boundaryClosed: false, transit: [], search: {}, pat: {},
    patClip: null, rocPlaceKind: null,
  };
  // eslint-disable-next-line no-new-func
  const run = new Function("G", "E",
    "with(E){ with(G){ return function(e)" + MOUSEUP + "; } }")(G, env);
  G.click = (x, y, moved) => {
    G.dragging = true; G.downAt = { x: x - (moved || 0), y: y };
    run({ clientX: x, clientY: y, shiftKey: false, button: 0 });
  };
  return G;
}

// Each scenario is built OUTSIDE its thunk so the failure note reports the state the check
// actually saw, not a freshly-rebuilt empty one — and inside attempt(), so a mutation that
// makes the shipped handler throw is still REPORTED rather than killing the run.
const g9 = attempt(() => { const G = gesture(); G.click(100, 200, 0); return G; });
check("9  the first click ANCHORS: a pending leg, nothing completed yet",
  () => g9.ok && g9.value.measPend && g9.value.measPend.a.lon === 0.1
     && g9.value.measPend.a.lat === 0.2 && g9.value.measures.length === 0,
  () => g9.ok ? "pend " + JSON.stringify(g9.value.measPend) + " done " + g9.value.measures.length
              : "THREW: " + g9.err);

const g10 = attempt(() => { const G = gesture(); G.click(100, 200, 0); G.click(400, 600, 0); return G; });
check("10 the second click COMPLETES it, at the two clicked points",
  () => g10.ok && g10.value.measures.length === 1 && !g10.value.measPend
    && g10.value.measures[0].a.lon === 0.1 && g10.value.measures[0].a.lat === 0.2
    && g10.value.measures[0].b.lon === 0.4 && g10.value.measures[0].b.lat === 0.6,
  () => g10.ok ? JSON.stringify(g10.value.measures) : "THREW: " + g10.err);

const g11 = attempt(() => {
  const G = gesture();
  G.click(100, 200, 0); G.click(400, 600, 0);
  G.click(500, 100, 0); G.click(900, 300, 0);
  return G;
});
check("11 the tool stays armed: two more clicks lay down a SECOND leg",
  () => g11.ok && g11.value.measures.length === 2 && !g11.value.measPend
     && g11.value.measures[0].b.lon === 0.4,
  () => g11.ok ? "legs " + g11.value.measures.length + " " +
                 JSON.stringify(g11.value.measures.map(m => m.b)) : "THREW: " + g11.err);

// The pan guard is the whole reason the gesture needs no state machine: a press-drag is a
// pan in EVERY mode, so it must never be read as a measurement.
const g12 = attempt(() => {
  const G = gesture(); G.click(100, 200, 40);
  const cleanAfterDrag = !G.measPend && G.measures.length === 0;
  G.click(100, 200, 0); G.click(400, 600, 40);         // anchored, then dragged to pan
  return { G, cleanAfterDrag };
});
check("12 a pan-drag neither anchors nor completes (the `moved > 5` guard still leads)",
  () => g12.ok && g12.value.cleanAfterDrag && !!g12.value.G.measPend
     && g12.value.G.measures.length === 0,
  () => g12.ok ? "drag-only anchored? " + !g12.value.cleanAfterDrag +
                 " · completed by a drag? " + (g12.value.G.measures.length > 0) : "THREW: " + g12.err);

// A right-click fires mousedown AND mouseup. Without this guard the menu gesture also runs
// the mode chain - the shipped latent version of that dropped a waypoint in WPT mode.
const MOUSEDOWN = grabListener("mapEl", "mousedown");
check("13 only the PRIMARY button commands the chart (right-click can't measure)", () => {
  const firstStmt = MOUSEDOWN.replace(/\/\/[^\n]*\n/g, "").replace(/\s+/g, " ").trim();
  return /^\{\s*if\s*\(\s*e\.button\s*!==\s*0\s*\)\s*return\s*;/.test(firstStmt);
}, () => MOUSEDOWN.replace(/\/\/[^\n]*\n/g, "").replace(/\s+/g, " ").trim().slice(0, 70));

const MOUSEMOVE = grabListener("window", "mousemove");
// Match to end of LINE, not to the first `}` — the assignment's own object literal closes
// a brace, so a `[^}]*` scan reads only half the statement and can never see the guard.
const BAND = (MOUSEMOVE.match(/^.*if\(measPend\)\{.*$/m) || [""])[0];
check("14 the leg follows the pointer, and does not swallow a live pan",
  () => /measPend\.b\s*=/.test(BAND) && /if\(!dragging\)\s*render\(\)/.test(BAND) && !/return/.test(BAND),
  () => BAND.trim() || "<absent>");

// ---- THE MENU: gates derived, not re-derived ---------------------------------------- //
function El(o) {
  o = o || {};
  const set = new Set(o.cls || []);
  const el = {
    tagName: "DIV", disabled: !!o.disabled, textContent: "", onclick: null,
    style: { display: "none", left: "", top: "" },
    offsetWidth: o.w || 210, offsetHeight: o.h || 190,
    _kid: o.kid || null,
    classList: {
      toggle(c, on) { if (on === undefined) on = !set.has(c); on ? set.add(c) : set.delete(c); return on; },
      contains(c) { return set.has(c); }, add(c) { set.add(c); }, remove(c) { set.delete(c); },
    },
    querySelector() { return el._kid; },
    contains(n) { return n === el; },
  };
  return el;
}
// A LIVE, CONNECTED, ARMED SIMULATOR — every gate open. Each scenario below turns exactly
// one thing off, so a row that stops following its predicate is unambiguous.
const STATE_OK = { armed: true, estop: false, mode: "sim", link: "sim" };
function menu(opts) {
  opts = opts || {};
  const D = {};
  const mk = (id, o) => (D[id] = El(o));
  ["#cmPos", "#cmMeasureLbl", "#cmMeasureK", "#cmClearK"].forEach(id => mk(id));
  mk("#cmClear", { kid: D["#cmClearK"] });
  mk("#cmGoto", { kid: mk("#cmGotoK") });
  mk("#cmHome", { kid: mk("#cmHomeK") });
  mk("#cmSpawn", { kid: mk("#cmSpawnK") });
  mk("#cmMeasure", { kid: D["#cmMeasureK"] });
  mk("#cmCopy", { kid: mk("#cmCopyK") });
  const G = {
    cmenuEl: El({ w: 210, h: 190 }), menuLL: null, acted: [],
    S: Object.assign({}, STATE_OK, opts.state || {}),
    mode: opts.mode || "pan", measures: opts.measures || [], measPend: opts.measPend || null,
    innerWidth: opts.vw || 1200, innerHeight: opts.vh || 800,
    $: (id) => D[id] || El(),
    fmtLL: (a, b) => a.toFixed(5) + " / " + b.toFixed(5),
    setMode: (m) => { G.mode = (G.mode === m) ? "pan" : m; },
    flashNote: () => {}, render: () => {}, clearMeasures: () => { G.measures = []; },
    doGoTo: (ll) => G.acted.push(["goto", ll]), doSpawn: (ll) => G.acted.push(["spawn", ll]),
    copyPosition: (ll) => G.acted.push(["copy", ll]),
    cmd: (path, body) => G.acted.push(["cmd", path, body]),
    D,
  };
  // The REAL gate predicates run here, against a fake server state - not a paraphrase of
  // them. That is the whole point: if canCommand() changes, this test changes with it.
  // eslint-disable-next-line no-new-func
  new Function("G", "with(G){" +
    grab("linkConnected") + grab("canCommand") + grab("canSpawn") + grab("canSetHome") +
    grab("chartMenuOpen") + grab("closeChartMenu") + grab("cmGate") + grab("openChartMenu") + grab("cmRow") +
    "G.openChartMenu=openChartMenu; G.closeChartMenu=closeChartMenu;" +
    "G.chartMenuOpen=chartMenuOpen; G.cmRow=cmRow; G.cmGate=cmGate;" +
    // Run a SHIPPED source line inside this scope. A direct eval() here sees the local
    // chain (cmRow, cmd, doGoTo...), so a row's real registration can be executed rather
    // than paraphrased - which is the only way a check on a registration means anything.
    "G.runShipped = function(src){ return eval(src); }; }")(G);
  return G;
}
const rowOff = (G, id) => G.D[id].classList.contains("off");

// The point of the named predicates: the rule exists ONCE, and the menu asks it. Each
// scenario disables exactly one gate and only its own row may react.
const g15 = attempt(() => {
  const open = (o) => { const G = menu(o); G.openChartMenu(10, 10, { lat: 40, lon: -75 }); return G; };
  return {
    all:    open({}),                                     // armed sim, link up
    unarmed:open({ state: { armed: false } }),
    stopped:open({ state: { estop: true } }),
    real:   open({ state: { mode: "real", link: "vcu" } }),
    down:   open({ state: { mode: null, link: "idle" } }),
  };
});
check("15 each command row is gated by the console's OWN predicate, one rule per gate", () => {
  if (!g15.ok) return false;
  const v = g15.value;
  return !rowOff(v.all, "#cmGoto") && !rowOff(v.all, "#cmHome") && !rowOff(v.all, "#cmSpawn")
    && rowOff(v.unarmed, "#cmGoto") && !rowOff(v.unarmed, "#cmHome")   // arming is not a link
    && rowOff(v.stopped, "#cmGoto")                                     // E-STOP closes motion
    && rowOff(v.real, "#cmSpawn") && !rowOff(v.real, "#cmGoto")         // sim-only is sim-only
    && rowOff(v.down, "#cmHome") && rowOff(v.down, "#cmSpawn");         // no link, no home
}, () => g15.ok ? "canCommand / canSpawn / canSetHome drive the rows" : "THREW: " + g15.err);

// SET HOME USES THE CLICKED POINT (the operator's call, 2026-08-08 - this asserted the
// exact opposite for one commit, while the server still discarded a supplied position).
// The row must send the point the MENU was opened over, and the label must say "here", so
// the wording and the behaviour cannot drift apart. Because RTH drives to HOME, the client
// also has to CHECK the point against the keep-out model before it is accepted quietly -
// that is check 15b2, and it is the half that keeps a home on land from being silent.
//
// Runs the SHIPPED registration, not a stand-in. The first version of this check
// re-registered the row with a handler the test wrote itself and then asserted that
// handler behaved - it passed happily with the real row mutated. A check on a registration
// has to execute the registration.
const HOME_REG = (H.match(/^\s*cmRow\("#cmHome",[\s\S]*?\);\s*$/m) || [""])[0];
const g15b = attempt(() => {
  const G = menu({});
  if (!/cmRow\("#cmHome"/.test(HOME_REG)) throw new Error("cmHome registration not found (renamed?)");
  G.doSetHome = (ll) => G.acted.push(["sethome", ll]);
  G.runShipped(HOME_REG);
  G.openChartMenu(10, 10, { lat: 38.75, lon: -74.25 });
  G.D["#cmHome"].onclick();
  return G;
});
check("15b Set Home acts at the CLICKED POINT, and the row says so",
  () => g15b.ok && g15b.value.acted.length === 1
    && g15b.value.acted[0][0] === "sethome"
    && g15b.value.acted[0][1].lat === 38.75 && g15b.value.acted[0][1].lon === -74.25
    && /<span>Set Home here<\/span>/.test(H),                  // label and behaviour agree
  () => g15b.ok ? JSON.stringify(g15b.value.acted) : "THREW: " + g15b.err);

// RTH DRIVES TO HOME. A home on land, inside a charted structure, or in water this hull
// cannot sit in is a return that gets refused LATER - mid-mission, when it is least useful
// to find out. doSetHome must therefore (a) widen the keep-out extract to cover the point,
// or a home outside the modelled box tests "clear" because nothing is loaded near it and
// silence reads as approval, and (b) WARN rather than refuse, because the operator asked
// for the point they picked and this console's rule is that a refusal is a result, not a
// veto to work around.
const SETHOME_SRC = grab("doSetHome");
check("15b2 ... and the chosen point is CHECKED against the keep-out model, then warned about",
  () => /ensureNogoCovers\(/.test(SETHOME_SRC)          // extract widened before testing
    && /blockedInfo\(/.test(SETHOME_SRC)                 // tested against the real model
    && /nogo\.ready/.test(SETHOME_SRC)                   // an unloaded model is not "clear"
    && /showBanner\(/.test(SETHOME_SRC)                  // and the operator is told
    && !/return\s*;\s*}\s*$/.test(SETHOME_SRC.replace(/\s+/g, " ")),  // warns, never refuses
  () => SETHOME_SRC.replace(/\s+/g, " ").slice(0, 90));

// A COMMAND THAT NEVER LANDED MUST NOT REPORT SUCCESS. cmd() returns {} on a network error
// (having already flashed it), so a `if (r.error) return` guard falls straight through and
// announces "Home set" for a command the server never saw. Test for the POSITIVE signal -
// the server answers {ok:true} and nothing else does. Same family as the extract widening
// two checks up: in both, the absence of bad news was being read as good news.
check("15b3 ... and it confirms Home only on the server's OWN ok, never on silence",
  () => /if\(!\(r && r\.ok\)\)\s*return;/.test(SETHOME_SRC)
    && SETHOME_SRC.indexOf("r.ok") < SETHOME_SRC.indexOf("Home set at the chosen point"),
  () => (SETHOME_SRC.match(/if\(![^\n]*\)\s*return;/) || ["<no success guard>"])[0]);

// Andy moved all three off the command bar. A button left behind is a SECOND path to a
// vessel command, gated by whatever that button happens to still say.
const CMDBAR = H.slice(H.indexOf('<div class="cmdbar'), H.indexOf('</div>', H.indexOf('id="b_estop"')));
check("15c Go-To, Spawn and Set Home are gone from the command bar",
  () => !/id="b_goto"/.test(H) && !/id="b_spawn"/.test(H) && !/id="b_home"/.test(H)
    && /id="b_estop"/.test(CMDBAR) && /id="b_rth"/.test(CMDBAR),   // ... the rest still there
  () => ["b_goto", "b_spawn", "b_home"].filter(b => H.includes('id="' + b + '"')).join(",") || "all three removed");

// Their MODES were reachable only from those buttons. Dead mode branches are how a console
// grows a second way to do something that nobody can reach and nobody deletes.
check("15d ... and the goto/spawn placement modes went with them",
  () => !/setMode\("goto"\)/.test(H) && !/setMode\("spawn"\)/.test(H)
    && !/mode\s*===\s*"goto"/.test(H) && !/mode\s*===\s*"spawn"/.test(H)
    && /S\.behavior\s*===\s*"goto"/.test(H),      // the SERVER's behaviour name is not a mode
  "no unreachable placement mode left behind");

const MENU_SRC = H.slice(H.indexOf("// --- the chart context menu ---"), H.indexOf('$("#wptBtn").onclick'));
check("16 ... and the menu section contains no second copy of either rule", () =>
  MENU_SRC.length > 500 && !/S\.armed|\.estop|mode\s*===?\s*["']sim["']|s\.mode/.test(MENU_SRC),
  () => (MENU_SRC.match(/S\.armed|\.estop|mode\s*===?\s*["']sim["']|s\.mode/) || ["clean"])[0]);

const g17 = attempt(() => {
  const G = menu({ state: { armed: false } });        // disarmed: Go-To must be inert
  G.cmRow("#cmGoto", (ll) => G.doGoTo(ll));
  G.openChartMenu(10, 10, { lat: 40, lon: -75 });
  G.D["#cmGoto"].onclick();
  return G;
});
check("17 a disabled row is INERT — clicking it issues no command",
  () => g17.ok && g17.value.acted.length === 0,
  () => g17.ok ? "commands issued: " + JSON.stringify(g17.value.acted) : "THREW: " + g17.err);

const g18 = attempt(() => {
  const G = menu({});
  G.cmRow("#cmGoto", (ll) => G.doGoTo(ll));
  G.openChartMenu(10, 10, { lat: 38.75, lon: -74.25 });
  G.D["#cmGoto"].onclick();
  return G;
});
check("18 an enabled row acts at the MENU'S point, not wherever the pointer ended up",
  () => g18.ok && g18.value.acted.length === 1 && g18.value.acted[0][0] === "goto"
    && g18.value.acted[0][1].lat === 38.75 && g18.value.acted[0][1].lon === -74.25
    && g18.value.menuLL === null,                  // ... and the menu let its point go
  () => g18.ok ? JSON.stringify(g18.value.acted) + " menuLL=" + JSON.stringify(g18.value.menuLL)
               : "THREW: " + g18.err);

const g19 = attempt(() => {
  const G = menu({ vw: 1200, vh: 800 });
  G.openChartMenu(1180, 780, { lat: 40, lon: -75 });
  return G;
});
check("19 the menu clamps into the viewport, flipping at the right/bottom edges", () => {
  if (!g19.ok) return false;
  const el = g19.value.cmenuEl, x = parseFloat(el.style.left), y = parseFloat(el.style.top);
  return x >= 0 && y >= 0 && x + el.offsetWidth <= 1200 && y + el.offsetHeight <= 800;
}, () => g19.ok ? g19.value.cmenuEl.style.left + "," + g19.value.cmenuEl.style.top : "THREW: " + g19.err);

const g20 = attempt(() => {
  const off = menu({ mode: "pan" }); off.openChartMenu(10, 10, { lat: 40, lon: -75 });
  const on = menu({ mode: "measure" }); on.openChartMenu(10, 10, { lat: 40, lon: -75 });
  return { off: off.D["#cmMeasureLbl"].textContent, on: on.D["#cmMeasureLbl"].textContent };
});
check("20 the Measure row reads the LIVE mode, so it is both arm and disarm",
  () => g20.ok && /^Measure/.test(g20.value.off) && /^Stop/.test(g20.value.on),
  () => g20.ok ? g20.value.off + " / " + g20.value.on : "THREW: " + g20.err);

// Derived from the HTML, so a row added tomorrow is covered the day it is added - the same
// rule the pre-commit hook now follows for tests/.
const ROW_IDS = [...H.matchAll(/<div class="cmi" id="(cm\w+)"/g)].map(m => m[1]);
check("21 every row in the menu markup has a handler wired", () => ROW_IDS.length >= 5 &&
  ROW_IDS.every(id => H.includes('cmRow("#' + id + '"')),
  () => ROW_IDS.filter(id => !H.includes('cmRow("#' + id + '"')).join(",") || ROW_IDS.length + " rows");

// ---- lifecycle + separation --------------------------------------------------------- //
check("22 leaving the tool drops the half-drawn leg but KEEPS completed measurements", () => {
  const S = grab("setMode");
  return /if\(mode !== "measure"\) measPend = null;/.test(S) && !/measures\s*=\s*\[\]/.test(S);
}, () => (grab("setMode").match(/measPend = null;/) || ["<absent>"])[0]);

const KEYDOWN = grabListener("window", "keydown");
check("23 Escape peels one layer at a time: menu, then pending, then drawn, then the tool", () => {
  const order = ["chartMenuOpen()", "measPend", "measures.length", 'mode === "measure"'];
  let at = -1;
  return order.every(t => { const i = KEYDOWN.indexOf(t); const ok = i > at; at = i; return ok; })
    && /INPUT\|SELECT\|TEXTAREA/.test(KEYDOWN);   // ... and Esc still belongs to a focused field
}, () => KEYDOWN.replace(/\/\/[^\n]*\n/g, "").replace(/\s+/g, " ").slice(0, 100));

// A ruler is an ANNOTATION. If `measures` ever reached the mission store or the wire it
// would become something the boat could be asked to drive.
const rx = s => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
check("24 a measurement never reaches the mission, the plan, or the boat", () => {
  // every statement anywhere in the page that mentions `measures` / `measPend`, checked
  // against the outbound paths - the store, the wire, and localStorage
  const stmts = H.split("\n").filter(l => /\bmeas(ures|Pend)\b/.test(l) && !/^\s*\/\//.test(l));
  const leaks = ["saveMission", "upload_plan", "uploadPlan", "/api/", "lsSet(", "cmd(", "mission."];
  const bad = stmts.filter(l => leaks.some(fn => new RegExp(rx(fn)).test(l)));
  return stmts.length >= 6 && bad.length === 0;
}, () => { const stmts = H.split("\n").filter(l => /\bmeas(ures|Pend)\b/.test(l) && !/^\s*\/\//.test(l));
  const leaks = ["saveMission", "upload_plan", "uploadPlan", "/api/", "lsSet(", "cmd(", "mission."];
  const bad = stmts.filter(l => leaks.some(fn => new RegExp(rx(fn)).test(l)));
  return bad.length ? bad[0].trim().slice(0, 70) : stmts.length + " sites, all local"; });

check("25 drawMeasure is painted AFTER the boat, so nothing can cover the operator's ruler", () => {
  const R = grab("render");
  const boat = R.lastIndexOf("if(asv){"), meas = R.indexOf("drawMeasure(toScreen)");
  return boat > 0 && meas > boat;
}, () => { const R = grab("render"); return "boat@" + R.lastIndexOf("if(asv){") + " meas@" + R.indexOf("drawMeasure(toScreen)"); });

// `let` is not hoisted: read before its declaration executes it is a ReferenceError, not
// undefined - and render() runs from the state poll before the interaction section does.
check("26 measures/measPend are declared before render(), never in its temporal dead zone", () => {
  const decl = H.indexOf("let measures = []");
  return decl > 0 && decl < H.indexOf("function render(") && decl < H.indexOf("function drawMeasure(");
}, () => "decl@" + H.indexOf("let measures = []") + " render@" + H.indexOf("function render("));

check("27 the menu is hidden in the CONTROLS window — it acts on a chart it cannot show", () =>
  /body\.ui-controls #chartMenu\{display:none!important;\}/.test(H.replace(/"\+\s*\n?\s*(\/\/[^\n]*\n\s*)*"/g, "")),
  "bridged-window rule");

console.log("\n" + (fails ? "FAILED " + fails + " of " + ran : "PASSED all " + ran + " checks"));
process.exit(fails ? 1 : 0);
