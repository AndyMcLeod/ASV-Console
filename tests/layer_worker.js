// tests/layer_worker.js - the chart's three cached layers drawn off the page, and drawn the SAME.
//
// Andy, 2026-10-17: "implement 4 and 5" of the performance review; for item 4 he chose "Same drawing, off the page". A
// redraw of the ENC, keep-out and shore-band layers cost the page 30-80 ms a layer at New Castle (an 1100 x 800 view:
// one frame of 96-197 ms a zoom), on every zoom and each time the view following her left the drawn margin. The drawing moved to static/js/chartlayers.js; the chart worker
// (static/js/skin_worker.js) keeps the extract it parsed for the seabed walk and draws a layer on request; the page's
// drawLayerOff asks for it and blits what the layer holds meanwhile.
//
//   1. THE WORKER DRAWS WHAT THE PAGE DREW. skin_worker.js is run for real (a worker thread, `self` shimmed) with a
//      RECORDING OffscreenCanvas: every call and every property set on its contexts is logged. The same layer is drawn
//      on this side by chartlayers.js with the same inputs - the page's own state for it - into a recording context.
//      The two logs must be the same, call for call and number for number, for all three layers over a New Castle
//      world (land, shoreline, a dock, depth areas, a wreck, soundings, a dredged channel, New Hampshire's water, its
//      shore rule's band) - which is the same picture, because the canvas is the same.
//   2. THE PAGE'S SIDE (drawLayerOff, layerAnswer, layerStale - the page's own, lifted): a miss asks the worker - the
//      view and margin, the extract, the state - and draws nothing itself; a render while it is out asks nothing more;
//      the answer becomes the layer, and is blitted at the view's offset from then on; a zoom asks again and shows the
//      old picture SCALED meanwhile; an answer to a request since replaced is dropped (2b); a failed answer, a timeout
//      and an extract it does not hold are drawn on the page, and that extract stays on the page.
//
//   node tests/layer_worker.js      # exit 0 = pass, 1 = fail   (stdlib Node)

// --- crash guard: a throw outside a check() must still REPORT ------------------------
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
const { Worker: NodeWorker } = require("worker_threads");
const { pathToFileURL } = require("url");
const JSD = process.env.ASV_JS || path.join(__dirname, "..", "static", "js");
const H = fs.readFileSync(process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html"), "utf8").split("\r\n").join("\n");
const CL = require(path.join(JSD, "chartlayers.js"));
const SK = require(path.join(JSD, "skin.js"));
const G = require(path.join(JSD, "geodesy.js"));
const CH = require(path.join(JSD, "chart.js"));
const SZ = require(path.join(JSD, "speedzones.js"));
const ST = require(path.join(JSD, "state.js"));

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond); note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  const st = H.search(new RegExp("(^|\\n)function " + name + "\\("));
  if (st < 0) throw new Error("function " + name + " not found in the page");
  let k = H.indexOf("{", st), d = 0;
  for (;;) { const c = H[k]; if (c === "{") d++; else if (c === "}") { d--; if (!d) break; } k++; }
  return H.slice(st, k + 1).replace(/^\n/, "");
}

// ── A RECORDING CANVAS: every call and property set, in order (the same class on both sides) ──────────────────────────
const RECORDER = `
class RecCtx {
  constructor(canvas){ this.canvas = canvas; this.log = canvas.log; this._p = {}; }
}
const PROPS = ["fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "globalAlpha", "globalCompositeOperation", "font"];
for (const p of PROPS) Object.defineProperty(RecCtx.prototype, p, {
  get(){ return this._p[p]; }, set(v){ this._p[p] = v; this.log.push(["set", p, v]); } });
for (const m of ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "stroke", "fill", "arc", "clearRect", "fillRect",
                 "strokeRect", "setLineDash", "rect"]) {
  RecCtx.prototype[m] = function (...a) { this.log.push([m, ...a.map(x => Array.isArray(x) ? x.slice() : x)]); };
}
RecCtx.prototype.drawImage = function (src, ...a) { this.log.push(["drawImage", src && src.tag, ...a]); };
let canvasN = 0;
class RecCanvas {
  constructor(w, h){ this._w = w; this._h = h; this.tag = "canvas" + (++canvasN); this.log = []; this._ctx = null; }
  get width(){ return this._w; } set width(v){ this._w = v; this.log.push(["width", v]); }
  get height(){ return this._h; } set height(v){ this._h = v; this.log.push(["height", v]); }
  getContext(){ return this._ctx || (this._ctx = new RecCtx(this)); }
  transferToImageBitmap(){ return { recorded: this.log, w: this._w, h: this._h }; }
}`;
// eslint-disable-next-line no-eval
const { RecCanvas } = new Function(RECORDER + "\nreturn { RecCanvas };")();

// ── THE WORLD: a corner of New Castle, New Hampshire ──────────────────────────────────────────────────────────────
const LAT0 = 43.0700, LON0 = -70.7100, KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
const ll = (e, n) => [LON0 + e / KX, LAT0 + n / 111320];
const ring = (...pts) => { const r = pts.map(p => ll(p[0], p[1])); r.push(r[0]); return r; };
const rect = (e0, n0, w, h) => ring([e0, n0], [e0 + w, n0], [e0 + w, n0 + h], [e0, n0 + h]);
const hole = (e0, n0, w, h) => ring([e0, n0], [e0, n0 + h], [e0 + w, n0 + h], [e0 + w, n0]);   // a ring the other way round
const F = (role, cls, geometry, props = {}, extra = {}) => ({ role, cls, props, geometry, band: "enc_harbour", ...extra });
const FEATS = [
  F("land", "Land_Area", { type: "Polygon", coordinates: [rect(-600, 100, 1200, 500)] }),
  F("shore_line", "Coastline", { type: "LineString", coordinates: [ll(-600, 100), ll(-200, 90), ll(200, 105), ll(600, 100)] }),
  F("dock", "Pier_area", { type: "Polygon", coordinates: [rect(-50, 40, 30, 60)] }),
  F("dock_line", "Shoreline_Construction", { type: "LineString", coordinates: [ll(-50, 40), ll(-20, 40)] }),
  // ... with a 40 m float cut out of it: the seabed walk's one gap, drawn in the keep-out layer as a structure
  F("depth_area", "Depth_Area", { type: "Polygon", coordinates: [rect(-600, -600, 1200, 700), hole(-220, -260, 40, 40)] }, { DRVAL1: 1.2, DRVAL2: 3 }, { d: 1.2 }),
  F("depth_area", "Depth_Area", { type: "Polygon", coordinates: [rect(-600, -900, 1200, 300)] }, { DRVAL1: 6, DRVAL2: 9 }),
  F("depth_contour", "Depth_Contour", { type: "LineString", coordinates: [ll(-600, -600), ll(600, -600)] }),
  F("dredged", "Dredged_Area", { type: "Polygon", coordinates: [rect(-300, -500, 200, 400)] }, { DRVAL1: 2 }),
  F("hazard_point", "Wreck_point", { type: "Point", coordinates: ll(150, -200) }, { CATWRK: 2 }),
  F("sounding", "Sounding", { type: "Point", coordinates: ll(-100, -300) }, { DEPTH: 4.1 }),
  F("sounding", "Sounding", { type: "Point", coordinates: ll(250, -350) }, { DEPTH: 7.3 }),
  F("state_water", "State_Water", { type: "Polygon", coordinates: [rect(-2000, -2000, 4000, 4000)] }, { state: "NH", unread: [] }),
];
const B = (() => { const a = ll(-1500, -1500), b = ll(1500, 1500); return { W: a[0], S: a[1], E: b[0], N: b[1] }; })();
const EXTRACT = { band: "enc_harbour", features: FEATS };
const VBLOCK = { WRECK_RADIUS_M: 25, NOGO_BUFFER_M: 5, NOGO_MIN_DEPTH_M: 3.15, OPER_MIN_DEPTH_M: 0, AIR_DRAFT_M: 2.85, OVERHEAD_CLEARANCE_M: 1 };
const WATER = 0.4;
const VIEW = (() => { const z = 16, c = G.worldPx(LAT0, LON0, z), W = 900, Hh = 700;
  return { zoom: z, ox: Math.round(c.x - W / 2), oy: Math.round(c.y - Hh / 2), W, H: Hh }; })();
const NOGO_D = { show: true, ready: true, enf: { land: true, depth: true, wreck: true }, floorDr: { min: 3.15, max: 0 },
  surveyDr: { min: 2, max: 0 }, hasPat: true, airNeed: 3.85,
  unreadAll: [{ W: B.W, S: B.S, E: B.W + 0.002, N: B.S + 0.002, failed: true }],
  chartInk: { lines: [{ a: { lat: 43.0695, lon: -70.7090 }, b: { lat: 43.0696, lon: -70.7085 } }], areas: [] } };

// ── 1. THE WORKER DRAWS WHAT THE PAGE DREW ──────────────────────────────────────────────────────────────────────────
(async () => {
  // this side: chartlayers.js with the same inputs, in the same shared state the worker is sent
  Object.assign(ST.V, VBLOCK); ST.sea.waterOffset = WATER;
  const toScreen = (lat, lon) => { const p = G.worldPx(lat, lon, VIEW.zoom); return { x: p.x - VIEW.ox, y: p.y - VIEW.oy }; };
  const skin = SK.skinOverHarbour(FEATS, B, { layered: false, partial: [] });
  const zs = [...FEATS.filter(x => x.role === "speed_zone"), ...SZ.noaaZones(FEATS), ...SZ.lawZones(FEATS)]
    .filter(z => z.law && z.law.within > 0 && z.law.pick);
  const here = {};
  { const c = new RecCanvas(VIEW.W, VIEW.H); CL.drawENC(toScreen, c.getContext("2d"), { wreckOff: false, features: FEATS, hazExtent: CH.hazExtent }); here.enc = c.log; }
  { const c = new RecCanvas(VIEW.W, VIEW.H); CL.drawENC(toScreen, c.getContext("2d"), { wreckOff: true, features: FEATS, hazExtent: CH.hazExtent }); here.encOff = c.log; }
  { const c = new RecCanvas(VIEW.W, VIEW.H);
    CL.drawNogo(toScreen, c.getContext("2d"), { ...NOGO_D, features: FEATS.concat(skin.gaps.map(SK.skinGapFeature)), depthExcluded: CH.depthExcluded });
    here.nogo = c.log; }
  { const c = new RecCanvas(VIEW.W, VIEW.H), scratch = new RecCanvas(1, 1);
    CL.drawLawBands(zs, toScreen, c.getContext("2d"), { features: FEATS, scratch }); here.law = c.log.concat([["scratch"], ...scratch.log]); }

  // the worker, for real
  const WPATH = path.join(JSD, "skin_worker.js");
  const boot = `const { parentPort } = require("worker_threads");
${RECORDER}
globalThis.OffscreenCanvas = RecCanvas;
globalThis.self = globalThis; self.postMessage = (m) => parentPort.postMessage(m);
parentPort.on("message", (d) => self.onmessage({ data: d }));
let __scratch = null;
const __Off = RecCanvas;
import(${JSON.stringify(pathToFileURL(WPATH).href)}).then(() => parentPort.postMessage({ ready: true }), (e) => parentPort.postMessage({ ready: false, error: String(e && e.stack || e) }));`;
  const w = new NodeWorker(boot, { eval: true });
  const got = new Map(); let ready = null;
  w.on("message", (m) => { if (m && "ready" in m) ready = m; else if (m && m.type === "drawn") got.set(m.seq, m); else if (m && m.id) got.set("skin" + m.id, m); });
  await new Promise((res) => { const t = setInterval(() => { if (ready) { clearInterval(t); res(); } }, 5); });
  const u = new TextEncoder().encode(JSON.stringify(EXTRACT));
  w.postMessage({ id: 7, raw: u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength), b: B });
  const ask = (seq, layer, D) => w.postMessage({ type: "draw", seq, layer, encId: 7, view: VIEW, D, V: VBLOCK, waterOffset: WATER });
  ask(1, "enc", { wreckOff: false }); ask(2, "nogo", NOGO_D); ask(3, "law", {}); ask(5, "enc", { wreckOff: true });
  w.postMessage({ type: "draw", seq: 4, layer: "enc", encId: 99, view: VIEW, D: {}, V: VBLOCK, waterOffset: WATER });   // not held
  await new Promise((res) => { const t0 = Date.now(), t = setInterval(() => { if (got.size >= 6 || Date.now() - t0 > 20000) { clearInterval(t); res(); } }, 10); });
  await w.terminate();
  const there = (seq) => { const m = got.get(seq); return m && m.ok && m.bitmap ? m.bitmap.recorded : null; };
  // the shore band's scratch canvas is the worker's own (its log rides on the layer's drawImage of it): compare the layer's
  // calls, and the scratch's, the same way this side records them
  const lawThere = (() => { const m = got.get(3); if (!m || !m.ok) return null; return m.bitmap.recorded; })();
  const sameLog = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  const encSame = sameLog(there(1), here.enc), nogoSame = sameLog(there(2), here.nogo);
  // Shipwrecks off: the wreck keeps its cross and loses its keep-out circle - on both sides, and so a different picture
  const encOffSame = sameLog(there(5), here.encOff) && !sameLog(here.encOff, here.enc);
  const lawLayerCalls = here.law.slice(0, here.law.findIndex(x => x[0] === "scratch"));
  const lawSame = sameLog(lawThere && lawThere.map(x => x[0] === "drawImage" ? ["drawImage", "scratch", ...x.slice(2)] : x),
                          lawLayerCalls.map(x => x[0] === "drawImage" ? ["drawImage", "scratch", ...x.slice(2)] : x));
  const miss = got.get(4);
  const n = (a) => (a || []).length;
  check("1. THE WORKER DRAWS WHAT THE PAGE DREW: skin_worker.js, run for real on the extract's bytes, issues the same drawing "
        + "calls, number for number, as chartlayers.js does on this side for the same view and state - the ENC layer (with "
        + "Shipwrecks on and off), the keep-out layer (the extract's features and its seabed gaps, the floor, the survey window, an unread square, a "
        + "chart-read mark) and New Hampshire's shore band - and an extract it does not hold is answered as that, no picture",
        () => ready && ready.ready && n(here.enc) > 50 && n(here.nogo) > 20 && zs.length > 0 && n(lawLayerCalls) > 3 && skin.gaps.length === 1
              && encSame && encOffSame && nogoSame && lawSame && miss && miss.ok === false && /holds no extract 99/.test(miss.error),
        () => JSON.stringify({ ready, calls: { enc: [n(there(1)), n(here.enc)], nogo: [n(there(2)), n(here.nogo)], law: [n(lawThere), n(lawLayerCalls)] },
                               same: { encSame, encOffSame, nogoSame, lawSame }, zones: zs.length, gaps: skin.gaps.length, miss: miss && miss.error }));

  // ── 2. THE PAGE'S SIDE ────────────────────────────────────────────────────────────────────────────────────────────
  const decl = (re) => { const m = H.match(re); if (!m) throw new Error("not found: " + re); return m[0]; };
  const page = new Function("env", `
    let zoom = env.zoom0, layerSeq = 0;
    const LAYER_PAD_PX = ${CL.LAYER_PAD_PX};
    ${decl(/^const LAYER_WORKER_TIMEOUT_MS = [^;]*;/m)}
    const ctx = env.ctx, V = {a: 1}, sea = {waterOffset: 0.2};
    const document = {createElement: () => env.newCanvas()};
    const logClient = (k, d) => env.logged.push([k, d]);
    const render = () => { env.renders++; };
    let skinWorker = env.worker;
    const skinWorkerGet = () => skinWorker;
    ${grab("makeLayer")}
    ${grab("layerHolds")}
    ${grab("drawLayer")}
    ${grab("layerStale")}
    ${grab("drawLayerOff")}
    const encLayer = makeLayer(), nogoLayer = makeLayer(), lawLayer = makeLayer();
    ${grab("layerAnswer")}
    return {L: encLayer, setZoom: (z) => { zoom = z; },
            off: (key, srcs, w, h, o, encId) => drawLayerOff(encLayer, "enc", key, srcs, env.draw, env.toScreen, w, h, o, encId, () => ({d: 1})),
            answer: layerAnswer};`);
  const mkEnv = (zoom0) => { const e = { zoom0, renders: 0, logged: [], posts: [], blits: [], drew: 0 };
    e.ctx = { drawImage: (src, ...a) => e.blits.push([src && src.tag, ...a]) };
    e.newCanvas = () => ({ width: 0, height: 0, tag: "pagecanvas", getContext: () => ({ clearRect() {} }) });
    e.draw = () => { e.drew++; }; e.toScreen = (lat, lon) => ({ x: lon, y: lat });
    e.worker = { postMessage: (m) => e.posts.push(m) };
    return e; };
  const env = mkEnv(15);
  const P = page(env);
  const srcs = [{ extract: 1 }], o = { x: 1000.4, y: 2000.6 };
  P.off("k1", srcs, 800, 600, o, 7);
  const asked = env.posts[0], drewAtMiss = env.drew, blitsAtMiss = env.blits.length;
  P.off("k1", srcs, 800, 600, { x: o.x + 30, y: o.y - 20 }, 7);            // out: no second ask
  const askedOnce = env.posts.length;
  P.answer({ type: "drawn", seq: asked.seq, layer: "enc", ok: true, bitmap: { tag: "bmp1", close() {} } });
  const held = { cv: P.L.cv && P.L.cv.tag, key: P.L.key, zoom: P.L.zoom, ox: P.L.ox, oy: P.L.oy, w: P.L.w, h: P.L.h };
  env.blits = [];
  P.off("k1", srcs, 800, 600, o, 7);                                         // holds: a blit, no ask
  const holdBlit = env.blits[0], postsAfterHold = env.posts.length;
  P.setZoom(16); env.blits = [];
  P.off("k1z", srcs, 800, 600, { x: o.x * 2, y: o.y * 2 }, 7);              // a zoom: asked again, the old one scaled meanwhile
  const zoomAsk = env.posts[env.posts.length - 1], scaled = env.blits[0];
  P.answer({ type: "drawn", seq: zoomAsk.seq, layer: "enc", ok: false, error: "boom" });   // failed: drawn here from now on
  const drewBefore = env.drew;
  P.off("k1z", srcs, 800, 600, { x: o.x * 2, y: o.y * 2 }, 7);
  const drewOnPage = env.drew - drewBefore, postsAfterFail = env.posts.length;
  P.off("k2", [{ other: 1 }], 800, 600, o, null);                           // no extract in the worker: drawn here
  const drewNoId = env.drew - drewBefore - drewOnPage;
  check("2. THE PAGE ASKS AND DOES NOT WAIT: a miss asks the worker for the view and its margin - zoom, origin, size, the "
        + "extract, the state - and draws nothing itself; a render while it is out asks nothing more; the answer becomes the "
        + "layer and is blitted at the view's offset; a zoom asks again and shows the old picture SCALED (2x) meanwhile; a "
        + "failed answer is logged and the layer is drawn on the page - and for that extract from then on; an extract the "
        + "worker does not hold is drawn on the page",
        () => asked && asked.type === "draw" && asked.layer === "enc" && asked.encId === 7 && asked.view.zoom === 15
              && asked.view.W === 800 + 2 * CL.LAYER_PAD_PX && asked.view.H === 600 + 2 * CL.LAYER_PAD_PX
              && asked.view.ox === Math.round(o.x) - CL.LAYER_PAD_PX && asked.view.oy === Math.round(o.y) - CL.LAYER_PAD_PX
              && asked.D.d === 1 && asked.waterOffset === 0.2 && askedOnce === 1 && drewAtMiss === 0 && blitsAtMiss === 0
              && held.cv === "bmp1" && held.key === "k1" && held.zoom === 15 && env.renders >= 1
              && holdBlit && holdBlit[0] === "bmp1" && holdBlit[1] === Math.round(held.ox - o.x) && postsAfterHold === askedOnce
              && zoomAsk.view.zoom === 16 && scaled && scaled[0] === "bmp1" && scaled.length === 5
              && Math.abs(scaled[3] - held.w * 2) < 1e-9 && Math.abs(scaled[1] - (held.ox * 2 - o.x * 2)) < 1e-9
              && env.logged.some(([k, d]) => k === "layer_worker" && d.fallback && d.why === "boom")
              && drewOnPage === 1 && postsAfterFail === env.posts.length && P.L.noWorkerFor === 7 && drewNoId === 1,
        () => JSON.stringify({ asked: asked && { view: asked.view, encId: asked.encId }, askedOnce, held, holdBlit, scaled,
                               drewOnPage, drewNoId, logged: env.logged }));

  // an answer to a request since replaced: dropped (its view is not the one asked now), its bitmap let go
  const env3 = mkEnv(15);
  const P3 = page(env3);
  P3.off("s1", srcs, 800, 600, o, 3);
  const ask3 = env3.posts[0];
  let closedOld = false;
  P3.answer({ type: "drawn", seq: ask3.seq + 1, layer: "enc", ok: true, bitmap: { tag: "old", close() { closedOld = true; } } });
  const afterOld = { cv: P3.L.cv, pend: !!P3.L.pend, renders: env3.renders };
  P3.answer({ type: "drawn", seq: ask3.seq, layer: "enc", ok: true, bitmap: { tag: "mine", close() {} } });
  check("2b. AN ANSWER TO ANOTHER REQUEST IS NOT THIS ONE'S: a bitmap with a seq the layer is not waiting on is dropped and "
        + "let go - the layer keeps waiting and draws nothing from it - and its own answer then becomes the layer",
        () => closedOld && afterOld.cv === null && afterOld.pend && afterOld.renders === 0
              && P3.L.cv && P3.L.cv.tag === "mine" && !P3.L.pend && P3.L.key === "s1",
        () => JSON.stringify({ closedOld, afterOld: { ...afterOld, cv: afterOld.cv && afterOld.cv.tag }, now: P3.L.cv && P3.L.cv.tag }));

  // the timeout: an answer that never comes is drawn on the page
  const env2 = mkEnv(14);
  const P2 = page(env2);
  const realNow = Date.now;
  let clock = 1e12; Date.now = () => clock;
  try {
    P2.off("t1", srcs, 800, 600, o, 5);
    clock += 1000; P2.off("t2", srcs, 800, 600, o, 5);                       // another key while out: waits
    const waited = env2.drew;
    clock += 20000; P2.off("t2", srcs, 800, 600, o, 5);                      // past the timeout: drawn here
    check("3. A WORKER THAT DOES NOT ANSWER: a second key while the first is out waits for it; past LAYER_WORKER_TIMEOUT_MS "
          + "the layer is drawn on the page, said in the session log, and the extract stays on the page",
          () => waited === 0 && env2.drew === 1 && P2.L.noWorkerFor === 5 && env2.posts.length === 1
                && env2.logged.some(([k, d]) => k === "layer_worker" && /no answer/.test(d.why)),
          () => JSON.stringify({ waited, drew: env2.drew, posts: env2.posts.length, logged: env2.logged }));
  } finally { Date.now = realNow; }

  // the wiring
  check("4. THE WIRING: the three cached layers go through drawLayerOff - the ENC and shore layers on the extract the worker "
        + "holds (encIdForWorker), the keep-out layer on the one its features came from (nogoIdForWorker) - with their own "
        + "state; the extract's id and state ride on sea.enc and the model's on nogo.featuresFrom; the worker's answers reach "
        + "layerAnswer; and the page draws with chartlayers.js's drawing through thin wrappers",
        () => /drawLayerOff\(encLayer, "enc", encLayerKeyNow\(\), \[sea\.enc\], drawENC, toScreen, w, h, o, encIdForWorker\(\), encDrawData\);/.test(H)
              && /drawLayerOff\(nogoLayer, "nogo", nogoLayerKeyNow\(\),[^;]*nogoIdForWorker\(\), nogoDrawData\);/.test(H)
              && /drawLayerOff\(lawLayer, "law", String\(zoom\), \[zonesList\],[^;]*encIdForWorker\(\), null\);/.test(H)
              && /workerId: skinJob \? skinJob\.id : null/.test(H) && /nogo\.featuresFrom = enc\.workerState === "ok" \? enc\.workerId : null;/.test(H)
              && /if\(m\.type === "drawn"\)\{ layerAnswer\(m\); return; \}/.test(H)
              && /clDrawENC\(toScreen, ctx, \{\.\.\.encDrawData\(\), features: sea\.enc\.features, hazExtent\}\)/.test(grab("drawENC"))
              && /clDrawNogo\(toScreen, ctx, \{\.\.\.nogoDrawData\(\), features: nogo\.features, depthExcluded\}\)/.test(grab("drawNogo"))
              && !/\nfunction (featureBox|layerSees|tracePx)\(/.test(H),
        "drawENCCached / drawNogoCached / drawLawBandsCached / fetchENCBbox / refreshNogo / skinWorkerGet / the wrappers");

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
