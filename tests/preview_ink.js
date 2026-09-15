// tests/preview_ink.js - a preview never looks like the route (review #19, 2026-09-15).
//
// A punched survey pattern and a clipped search pattern were drawn solid GREEN - the green of the route uploaded to
// the boat - while the committed plan's lines are yellow. A pattern nobody had added to the plan looked exactly like
// the run under way; on 2026-09-11 it cost a whole investigation into "a line heading out to the northwest" at
// Eastport. A preview is now cyan throughout - the drafts' color - and labelled PREVIEW — not in plan; green is only
// the route, yellow only the plan.
// DRIVEN: the page's own drawPattern, drawSearch and drawPreviewLabel, with a canvas that records every stroke's ink.
//
//   node tests/preview_ink.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 10 sidecar mutations RUN, 10/10 caught:
//   punched coverage green again -> 1, 5          coverage under a lead green again -> 1, 5
//   the selected run green inside -> 1, 2, 5      the survey preview unlabelled -> 3
//   the label without its halo -> 3               search kept legs green again -> 4, 5
//   the search preview unlabelled -> 4            the Quick Start says green -> 6
//   the search hint says green -> 6               the route loses its green -> 5
//
// NOTE: the page's script is <script type="module">, which runs STRICT; the functions are evaluated strict here.

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
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
const DECL = (H.match(/^const PREVIEW_INK = [^;]*;/m) || [])[0];
if (!DECL) throw new Error("test setup: const PREVIEW_INK not found (renamed?)");

console.log("A preview never looks like the route:");

const ROUTE_GREEN = "rgba(63,191,107";
const CYAN = "rgba(57,192,255";
// ── a canvas that remembers what ink every stroke and every word went down in ─────────────────────────────────────
function recorder() {
  const log = [];
  let st = { strokeStyle: "", fillStyle: "", lineWidth: 1, dash: [] };
  const stack = [];
  const ctx = {
    get strokeStyle() { return st.strokeStyle; }, set strokeStyle(v) { st.strokeStyle = v; },
    get fillStyle() { return st.fillStyle; }, set fillStyle(v) { st.fillStyle = v; },
    get lineWidth() { return st.lineWidth; }, set lineWidth(v) { st.lineWidth = v; },
    font: "", setLineDash(d) { st.dash = d; },
    save() { stack.push(Object.assign({}, st)); }, restore() { st = stack.pop() || st; },
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, closePath() {}, fill() {},
    stroke() { log.push({ op: "stroke", ink: st.strokeStyle, w: st.lineWidth, dashed: st.dash.length > 0 }); },
    fillText(t, x, y) { log.push({ op: "text", t, ink: st.fillStyle, x, y }); },
    strokeText(t, x, y) { log.push({ op: "halo", t, ink: st.strokeStyle }); },
  };
  return { ctx, log };
}

const L = (e0, n0, e1, n1) => [{ lat: n0, lon: e0 }, { lat: n1, lon: e1 }];
const SRC = [L(0, 0, 10, 0), L(10, 1, 0, 1)];
const toScreen = (lat, lon) => ({ x: 100 + lon * 10, y: 200 - lat * 10 });

function survey(opts) {
  const { ctx, log } = recorder();
  // eslint-disable-next-line no-eval
  const f = eval("(function(){ \"use strict\";\n"
    + "const pat = { A: {}, B: {}, C: {} }, currentPattern = () => ({}), patSourceLines = () => SRC, patClip = SRC,"
    + " patLeadTotal = () => opts.lead ? 5 : 0, patCoverSeg = (k) => SRC[k], patRoutes = [SRC[0]], patUnsafe = [SRC[1]],"
    + " patSel = opts.sel ? { lat: 0, lon: 5 } : null, patCoverMid = (k) => ({ lat: SRC[k][0].lat, lon: 5 }),"
    + " distTo = (a, b) => Math.hypot(a.lat - b.lat, a.lon - b.lon), boundaryActive = () => false,"
    + " patScreen = () => null, HANDLE = {};\n"
    + DECL + "\n" + grab("drawPreviewLabel") + "\n" + grab("drawPattern") + "\n return drawPattern; })()");
  f(toScreen);
  return log;
}

// 1-3. the survey preview
const plain = survey({}), lead = survey({ lead: true }), sel = survey({ sel: true });
const strokes = (log, w) => log.filter((r) => r.op === "stroke" && (w == null || r.w === w));
check("1. a punched survey preview's kept lines go down in cyan - solid, over the faint dashed raw lines - never in the "
      + "green of the uploaded route, with or without a lead",
      () => strokes(plain, 2.5).length && strokes(plain, 2.5).every((r) => r.ink.startsWith(CYAN) && !r.dashed)
            && strokes(lead, 2.5).every((r) => r.ink.startsWith(CYAN)) && strokes(lead, 1.4).every((r) => r.ink.startsWith(CYAN))
            && ![plain, lead, sel].some((log) => strokes(log).some((r) => r.ink.startsWith(ROUTE_GREEN))),
      () => "2.5 px inks: " + [...new Set(strokes(plain, 2.5).map((r) => r.ink))].join(" | "));
const halo9 = strokes(sel, 9), inner = strokes(sel, 2.5);
check("2. a selected run keeps its amber halo, with the preview's cyan inside it",
      () => halo9.length === 1 && halo9[0].ink.startsWith("rgba(255,215,106") && inner.length >= 2 && inner[inner.length - 1].ink.startsWith(CYAN),
      () => "halo " + (halo9[0] || {}).ink + "; inner " + (inner[inner.length - 1] || {}).ink);
const label = plain.filter((r) => r.op === "text" && r.t === "PREVIEW — not in plan");
const halo = plain.filter((r) => r.op === "halo" && r.t === "PREVIEW — not in plan");
check("3. the preview says what it is on the chart - PREVIEW — not in plan, in cyan with a dark halo, above its top-left",
      () => label.length === 1 && label[0].ink.startsWith(CYAN) && halo.length === 1 && label[0].x === 100 && label[0].y === 180,
      () => JSON.stringify(label[0] || "no label"));

// 4. the search preview
{
  const { ctx, log } = recorder();
  const RAW = [{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, { lat: 1, lon: 10 }];
  // eslint-disable-next-line no-eval
  const f = eval("(function(){ \"use strict\";\n"
    + "const mode = 'search', search = { datum: {} }, searchRoute = () => RAW,"
    + " searchRouted = { clipped: [RAW.slice(0, 2)], routes: [RAW.slice(1)], unsafe: [RAW.slice(0, 2)] },"
    + " searchScreen = () => ({ x: 50, y: 60 });\n"
    + DECL + "\n" + grab("drawPreviewLabel") + "\n" + grab("drawSearch") + "\n return drawSearch; })()");
  f(toScreen);
  const kept = log.filter((r) => r.op === "stroke" && r.w === 2.5);
  const amber = log.filter((r) => r.op === "stroke" && r.ink.startsWith("rgba(217,154,60"));
  const red = log.filter((r) => r.op === "stroke" && r.ink.startsWith("rgba(217,83,79"));
  const sLabel = log.filter((r) => r.op === "text" && r.t === "PREVIEW — not in plan");
  check("4. a clipped search preview's kept legs are cyan too, its detours still amber and its blocked legs red, and it "
        + "is labelled below its datum",
        () => kept.length && kept.every((r) => r.ink.startsWith(CYAN)) && amber.length && red.length
              && !log.some((r) => r.op === "stroke" && r.ink.startsWith(ROUTE_GREEN)) && sLabel.length === 1 && sLabel[0].y === 76,
        () => "kept " + [...new Set(kept.map((r) => r.ink))].join(" | ") + "; label " + JSON.stringify(sLabel[0] || null));
}

// 5-6. the other inks, and the words
const routeBlock = H.slice(H.indexOf("if(runRoute && runRoute.length && (S.run===\"running\""), H.indexOf("if(runUnsafe.length){"));
const commitBlock = H.slice(H.indexOf("drawBoundary(toScreen);") - 2600, H.indexOf("drawBoundary(toScreen);"));
check("5. the uploaded route is still the only green line and the committed plan still yellow - three inks, three meanings",
      () => /strokeStyle="rgba\(63,191,107,0\.7\)"/.test(routeBlock) && /rgba\(255,215,106,0\.55\)/.test(commitBlock)
            && (H.match(/rgba\(63,191,107/g) || []).length === 1,
      () => "green strokes in the page: " + (H.match(/rgba\(63,191,107/g) || []).length);
check("6. the help says cyan: the Quick Start's Punch Out step and the search hint - no preview is called green",
      () => /segments clip cyan, transits auto-route amber/.test(H) && /\(cyan kept \/ amber routed \/ red blocked\)/.test(H)
            && !/green kept|segments clip green/.test(H),
      () => "green-kept wording left: " + ((H.match(/green kept|segments clip green/g) || []).length));

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
