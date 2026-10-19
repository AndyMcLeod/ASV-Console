// tests/route_worker.js - THE ROUTE SEARCH OFF THE PAGE'S THREAD (2026-10-12) gives the page's own answer.
//
// Andy: "move the route planner into a worker". A Go-To up the Piscataqua held his supervising page's thread 11 s, then
// 17.8 s: the clearance guard, the readouts and supervision's report all stopped, a second chart tab took the post, and
// the Go-To was refused. The page now hands each command's search to static/js/route_worker.js (route_job.js: passage.js's
// own planNogoRoute / routePlan / holdTarget) through planOffThread, and waits with its thread free.
//
// A WORKER THAT PLANS ON A DIFFERENT WORLD FROM THE PAGE'S IS A SECOND PLANNER, and nothing on the chart would show it.
// So this suite drives the PAGE'S OWN planOffThread (lifted from static/asv.html) against the REAL route_worker.js, run in
// a Node worker thread - a separate set of module instances, and the same structured clone a browser's postMessage
// makes - and asserts every answer is the page's own, FIELD FOR FIELD, against the same search run directly on this
// thread: a Go-To up a buoyed river round an island and a shoal, one held off a target on the island, an Upload with a
// later survey's transit, a drawn transit's hold point and route, a hold refused, the way round a contact (its own
// model), the vessels not under way, and a passage section's model at another water. Then that the model goes over
// ONCE; that the page's thread is FREE while the worker searches (and is not on its own thread - the control); every
// way the worker can fail falls back to the page's own search; and a Stop pressed while a plan is searched withdraws it.
//
//   node tests/route_worker.js      # exit 0 = pass, 1 = fail   (stdlib Node, 18+)

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
const { pathToFileURL } = require("url");
const { Worker: NodeWorker } = require("worker_threads");

const APP = process.env.ASV_APP || path.join(__dirname, "..");
const ASV_HTML = process.env.ASV_HTML || path.join(APP, "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const JS = (f) => path.join(APP, "static", "js", f);
const { V, nogo, sea } = require(JS("state.js"));
const { planeFrame } = require(JS("geodesy.js"));
const { buildKeepouts } = require(JS("chart.js"));
const P = require(JS("passage.js"));
const { koCount, packKo, unpackKo } = require(JS("route_job.js"));
const { bbOf } = require(JS("geometry.js"));

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
function decl(re) {
  const m = H.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}
// The first difference between two answers, by path - or null. Exact: Object.is on every number, so a -0 or a NaN that
// came back different is a difference; a Set and a Map compared by their contents in order.
function diff(a, b, at = "") {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return at + ": " + String(a) + " vs " + String(b);
  if (Array.isArray(a) !== Array.isArray(b)) return at + ": array vs not";
  if (a instanceof Set || a instanceof Map) return diff([...a], [...b], at + "<" + a.constructor.name + ">");
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length || ka.some((k) => !Object.prototype.hasOwnProperty.call(b, k)))
    return at + ": keys " + ka.join(",") + " vs " + kb.join(",");
  for (const k of ka) { const d = diff(a[k], b[k], at + "." + k); if (d) return d; }
  return null;
}

// ── THE WORLD: a buoyed river between two banks, an island in it, a point narrowing it, a shoal and two rocks in the
// harbor below, built through the console's own buildKeepouts as a DriX (3.15 m floor, 5 m buffer). ──────────────────
const F = planeFrame({ lat: 43.07, lon: -70.73 });
const LL = (e, n) => { const q = F.fromEN(e, n); return { lat: q.lat, lon: q.lon }; };
const ring = (pts) => pts.map(([e, n]) => { const q = LL(e, n); return [q.lon, q.lat]; });
const poly = (role, cls, pts, props = {}) => ({ role, cls, props, geometry: { type: "Polygon", coordinates: [ring([...pts, pts[0]])] } });
const pt = (role, cls, e, n, props = {}) => { const q = LL(e, n); return { role, cls, props, geometry: { type: "Point", coordinates: [q.lon, q.lat] } }; };
const FEATS = [
  poly("land", "Land_Area", [[-3000, -400], [-150, -400], [-150, 3500], [-3000, 3500]]),
  poly("land", "Land_Area", [[150, -400], [3000, -400], [3000, 3500], [150, 3500]]),
  poly("land", "Land_Area", [[-40, 800], [40, 800], [40, 1100], [-40, 1100]]),                // the island
  poly("land", "Land_Area", [[150, 1800], [-60, 1850], [-60, 1950], [150, 2000]]),            // the point
  poly("depth_area", "Depth_Area", [[-600, -1400], [300, -1400], [300, -1000], [-600, -1000]], { DRVAL1: 1.0, DRVAL2: 2.0 }),
  pt("hazard_point", "Underwater_Awash_Rock_point", 400, -800),
  pt("hazard_point", "Underwater_Awash_Rock_point", -300, -700),
  poly("fairway", "Fairway_area", [[-100, -400], [100, -400], [100, 3400], [-100, 3400]]),
];
{ let num = 1;
  for (const n of [-300, 300, 1500, 2400, 3000]) {
    FEATS.push(pt("chan_mark", "Buoy_Lateral_point", -90, n, { CATLAM: 1, OBJNAM: "Test River Buoy " + (num++) }));
    FEATS.push(pt("chan_mark", "Buoy_Lateral_point", 90, n, { CATLAM: 2, OBJNAM: "Test River Buoy " + (num++) }));
  } }
V.NOGO_MIN_DEPTH_M = 3.15; V.NOGO_BUFFER_M = 5; V.OPER_MIN_DEPTH_M = 0;
const ENF = { land: true, depth: true, haz: true, area: false, wreck: true, chan: true };
const build = (tide) => { const was = sea.waterOffset; sea.waterOffset = tide || 0;
  try { return buildKeepouts(F, ENF, { min: 3.15, max: 0 }, FEATS); } finally { sea.waterOffset = was; } };
const KO = build(0);
const SW = LL(-3000, -3000), NE = LL(3000, 3600);
function chart(ko) {
  Object.assign(nogo, { ready: true, frame: F, ko, buffer: 5, bbox: { W: SW.lon, S: SW.lat, E: NE.lon, N: NE.lat }, unread: null, ais: null });
  sea.laneUsed = false; sea.lanePartial = false;
}
chart(KO);

// ── THE PAGE: its own planOffThread and the plumbing beside it, over a Worker that is the REAL route_worker.js in a Node
// worker thread (a `self` for it to answer through). Everything the page passes is copied across exactly as a
// browser's postMessage copies it. ─────────────────────────────────────────────────────────────────────────────────
const BOOT = (file) => `
  const { parentPort } = require("worker_threads");
  globalThis.self = { postMessage: (d) => parentPort.postMessage(d) };
  import(${JSON.stringify(pathToFileURL(file).href)}).then(
    () => parentPort.on("message", (d) => self.onmessage({ data: d })),
    (e) => { throw e; });`;
function makeWorkerClass(rec) {
  return class PageWorker {
    constructor(url, opts) {
      rec.made.push({ url, type: opts && opts.type });
      const file = url === "/static/js/route_worker.js" && !rec.broken ? JS("route_worker.js") : path.join(APP, "no-such-worker.js");
      this.w = new NodeWorker(BOOT(file), { eval: true });
      this.w.on("message", (d) => this.onmessage && this.onmessage({ data: d }));
      this.w.on("error", (e) => this.onerror && this.onerror({ message: e.message }));
      this.w.unref();
    }
    // (what each model was BEFORE the post - its count, and the very array it went in - since a transferred buffer is
    // emptied by the post: 7c reads that it was)
    postMessage(m, t) {
      rec.posted.push({ ...m, models: (m.models || []).map((x) => ({ id: x.id, packed: !!x.packed, xy: x.packed && x.packed.xy,
        bytes: x.packed ? x.packed.xy.byteLength : 0, n: koCount(x.packed ? unpackKo(x.packed) : x.ko) })),
        transfer: (t || []).length });
      this.w.postMessage(m, t);
    }
    terminate() { rec.terminated++; this.w.terminate(); }
  };
}
function makePage(opt = {}) {
  const rec = { made: [], posted: [], terminated: 0, logs: [], busy: 0, banners: [], broken: !!opt.brokenWorker };
  const Worker = opt.noWorker ? undefined : makeWorkerClass(rec);
  let timeoutDecl = decl(/^const ROUTE_WORKER_TIMEOUT_MS = [^;]*;/m);
  if (opt.timeoutMs != null) timeoutDecl = "const ROUTE_WORKER_TIMEOUT_MS = " + opt.timeoutMs + ";";
  const body = [
    "\"use strict\";",
    "let supPlanEnd = 0;",
    "const supervisorBusy = async () => { rec.busy++; };",
    "const logClient = (kind, data) => rec.logs.push({kind, data});",
    "const showBanner = (m) => rec.banners.push(m);",
    timeoutDecl,
    decl(/^const ROUTE_WORKER_OFF = [^;]*;/m),
    decl(/^const routeLanes = [\s\S]*?;\n/m),
    decl(/^const routeKoIds = [^;]*;/m),
    decl(/^let routeKoSeq = [^;]*;/m),
    decl(/^let routeStopGen = [^;]*;/m),
    ["routeKoId", "routeWorkerOf", "routeWorkerLost", "planHere", "planOffThread", "routeStopPressed"].map(grab).join("\n"),
    "return { planOffThread, routeStopPressed, routeLanes, planEnd: () => supPlanEnd };",
  ].join("\n");
  // eslint-disable-next-line no-new-func
  const page = new Function("V", "nogo", "sea", "routeKoCount", "routePackKo", "Worker", "location", "rec", body)(
    V, nogo, sea, koCount, packKo, Worker, { search: opt.search || "" }, rec);
  page.rec = rec;
  page.close = () => { for (const L of Object.values(page.routeLanes)) if (L.w) { try { L.w.terminate(); } catch (e) {} } };
  return page;
}

// The searches, as the page's callers build them (doGoTo, doUpload, doTransit, resumeFromHere, sailSend).
const O = { holdR: 20, setMs: 0, setDeg: 0 };
const goto = (from, to, o) => ({ op: "nogo", args: { from, to, opts: o } });

(async () => {
  console.log("The route search in a worker gives the page's own answer:");
  const page = makePage();
  // (a search the worker could not answer would be answered by `here` - the very search compared against - so each is
  // asked with a fallback that SAYS it ran, and a check passes only on the worker's own answer: `fb` false)
  const ask = async (job, here, adopt) => {
    const before = { lu: sea.laneUsed, lp: sea.lanePartial };
    let fb = false;
    const w = await page.planOffThread(job, () => { fb = true; return here(); }, adopt);
    const flags = { laneUsed: sea.laneUsed, lanePartial: sea.lanePartial };
    sea.laneUsed = before.lu; sea.lanePartial = before.lp;
    const d = here();                                  // the same search, here, directly
    return { w, d, fb, flags, dflags: { laneUsed: sea.laneUsed, lanePartial: sea.lanePartial } };
  };

  // 1. A Go-To up the river: round the shoal, through the channel, past the island and the point.
  const from = LL(0, -2200), up = LL(0, 3200), o1 = { ...O, standoffM: 12 };
  const g = await ask(goto(from, up, o1), () => P.planNogoRoute(from, up, o1));
  const fellBack1 = page.rec.logs.filter((l) => l.kind === "route_worker" && !l.data.ok).length;
  check("1. A GO-TO UP THE RIVER: the worker's answer is the page's own, field for field - the route, the lane, the marks, "
        + "the standoff, the hold disc - and so are the lane flags it leaves (sea.laneUsed / lanePartial); and it is a real "
        + "search (routed, laned, dozens of points), answered by the worker and not by the fallback",
        () => !g.fb && !diff(g.w, g.d) && !diff(g.flags, g.dflags) && g.d.routed && g.d.lane && g.d.route.length > 20
              && fellBack1 === 0 && page.rec.busy === 0 && page.rec.made.length === 1,
        () => (diff(g.w, g.d) || "identical") + "; flags " + JSON.stringify(g.flags) + " vs " + JSON.stringify(g.dflags)
              + "; " + g.d.route.length + " points, lane " + g.d.lane + "; fell back " + fellBack1 + ", busy " + page.rec.busy);

  // 1b. Held off a target on the island.
  const isle = LL(0, 950);
  const h = await ask(goto(from, isle, o1), () => P.planNogoRoute(from, isle, o1));
  check("1b. ... and a Go-To to a point ON THE ISLAND is held off it in the worker exactly as here: the same hold point, "
        + "the same `heldOff` (how far, and why), the same route to it",
        () => !h.fb && !diff(h.w, h.d) && h.d.heldOff && h.d.heldOff.m > 0 && h.d.route.length > 5,
        () => (diff(h.w, h.d) || "identical") + "; held off " + (h.d.heldOff && h.d.heldOff.m) + " m (" + (h.d.heldOff && h.d.heldOff.kind) + ")");

  // 2. An Upload: survey lines across the harbor, then a later survey up the river - its leg in a transit (transitAt).
  const wps = [LL(-1200, -2300), LL(1200, -2300), LL(1200, -1800), LL(-1200, -1800), LL(0, 500), LL(0, 700)];
  const start = LL(0, -2600), at = new Set([4]);
  const u = await ask({ op: "route", args: { start, wps, keepRightAll: false, standoffM: 12, transitAt: at } },
                      () => P.routePlan(start, wps, false, 12, at));
  check("2. AN UPLOAD (doUpload's routePlan, a later survey's leg in a transit by `transitAt` - a Set, copied as one): the "
        + "worker's plan is the page's own, and every leg was routed (the leg into the river round the shoal)",
        () => !u.fb && !diff(u.w, u.d) && !diff(u.flags, u.dflags) && u.d.unroutable.length === 0 && u.d.route.length > wps.length + 5,
        () => (diff(u.w, u.d) || "identical") + "; " + u.d.route.length + " points for " + wps.length + " waypoints");

  // 3. A drawn transit: its last point on the island, held off, and routed to (doTransit's closure, as one search).
  let htW = null;
  const via = [LL(0, -500)], o3 = { ...O };
  const hereT = () => { const ht = P.holdTarget(isle, o3); if (ht.error) return { ht, plan: null };
                        return { ht, plan: P.routePlan(from, [...via, ht.to], true, 12) }; };
  const tW = await page.planOffThread({ op: "holdRoute", args: { target: isle, holdOpts: o3, start: from, via, keepRightAll: true, standoffM: 12 } },
                                      () => { throw new Error("the fallback ran"); }, (r) => { htW = r.ht; return r.plan; });
  const tD = hereT();
  check("3. A DRAWN TRANSIT ending on the island (holdRoute): the hold point comes back BESIDE the plan, and both are the "
        + "page's own - held off as here, routed as here",
        () => !diff(htW, tD.ht) && !diff(tW, tD.plan) && tD.ht.heldOff && tW.route.length > 5,
        () => (diff(htW, tD.ht) || diff(tW, tD.plan) || "identical") + "; held off " + (tD.ht.heldOff && tD.ht.heldOff.m) + " m");
  // 3b. ... and a hold point that cannot be found is the same refusal, with no plan.
  let htR = null;
  const inland = LL(-2000, 1500);
  const tR = await page.planOffThread({ op: "holdRoute", args: { target: inland, holdOpts: o3, start: from, via, keepRightAll: true, standoffM: 12 } },
                                      () => { throw new Error("the fallback ran"); }, (r) => { htR = r.ht; return r.plan; });
  const dR = P.holdTarget(inland, o3);
  check("3b. ... and a hold point in the land with no clear water near it is REFUSED in the worker as here: the same error, "
        + "and no plan",
        () => tR === null && htR && htR.error && htR.error === dR.error && !diff(htR, dR),
        () => "worker: " + (htR && htR.error) + "; here: " + dR.error);

  // 4. The way round a contact: a model of its own (koRoundHer), sent BESIDE the chart's - her hull ON the way in the
  // chart's model alone gives (a fly-through, as resumeFromHere's is), so a worker that planned without it would not match.
  const o4plain = { ...O, standoffM: 12, flyThrough: true };
  const plain = P.planNogoRoute(from, up, o4plain);
  const at4 = plain.route.map((q) => F.toEN(q)).reduce((b, q) => Math.abs(q.n - 2400) < Math.abs(b.n - 2400) ? q : b);
  const hull = [[-6, -30], [6, -30], [6, 30], [-6, 30]].map(([e, n]) => ({ e: at4.e + e, n: 2400 + n }));
  const koIn = { ...KO, polys: [...KO.polys, { ring: hull, bb: bbOf(hull), kind: "AIS: TEST SHIP (60 m)" }] };
  const o4 = { ...O, standoffM: 12, ko: koIn, flyThrough: true };
  const n0 = page.rec.posted.length;
  const c4 = await ask(goto(from, up, o4), () => P.planNogoRoute(from, up, o4));
  const sent4 = page.rec.posted[n0].models.map((m) => m.n);
  const n1 = page.rec.posted.length;
  await page.planOffThread(goto(from, up, o1), () => P.planNogoRoute(from, up, o1));
  const sent4b = page.rec.posted[n1].models.length;
  check("4. THE WAY ROUND A CONTACT (resumeFromHere's `opts.ko`, the contacts' model): sent beside the chart's - that model "
        + "alone, the chart's already being held - and the worker's way round is the page's own, and not the way it takes "
        + "with no contact there; the search after it sends nothing (the contacts' model was dropped, the chart's kept)",
        () => !c4.fb && !diff(c4.w, c4.d) && sent4.length === 1 && sent4[0] === koCount(koIn) && !!diff(c4.d.route, plain.route)
              && sent4b === 0,
        () => (diff(c4.w, c4.d) || "identical") + "; sent " + JSON.stringify(sent4) + " (the chart's " + koCount(KO) + ")"
              + "; then " + sent4b + " sent");
  // 4b. ... and a contacts' model that IS the chart's (no contacts) is the chart's: nothing sent, the same identity there.
  const o4b = { ...O, standoffM: 12, ko: KO, flyThrough: true };
  const n2 = page.rec.posted.length;
  const c4b = await ask(goto(from, isle, o4b), () => P.planNogoRoute(from, isle, o4b));
  check("4b. ... with no contacts the way in's model IS the chart's (koRoundHer returns nogo.ko): nothing sent, and the "
        + "worker takes the same branch the page does (the chart's model, not passageKo's copy)",
        () => !c4b.fb && !diff(c4b.w, c4b.d) && page.rec.posted[n2].models.length === 0
              && page.rec.posted[n2].args.opts.ko.id === page.rec.posted[n2].ko.id,
        () => (diff(c4b.w, c4b.d) || "identical") + "; sent " + page.rec.posted[n2].models.length);

  // 5. The vessels not under way (passageKo): the page's read of the AIS proxy goes with the search.
  // (moored ON the route the Go-To took without her: where it crosses n = 2420, on its keep-right side of the river)
  const onRoute = g.d.route.map((q) => F.toEN(q)).reduce((b, q) => Math.abs(q.n - 2420) < Math.abs(b.n - 2420) ? q : b);
  const bargeAt = LL(onRoute.e, 2420);
  nogo.ais = { polledAt: Date.now(), vessels: [{ mmsi: 367000001, name: "TEST BARGE", lat: bargeAt.lat, lon: bargeAt.lon,
                                                 sog: 0, cog: 0, heading: 0, nav_status: 5, length: 40, width: 12 }] };
  const m5 = await ask(goto(from, up, o1), () => P.planNogoRoute(from, up, o1));
  nogo.ais = null;
  check("5. THE VESSELS NOT UNDER WAY (nogo.ais, passageKo): a moored barge in the river is laid round in the worker as "
        + "here, and named the same (`moored`)",
        () => !m5.fb && !diff(m5.w, m5.d) && m5.d.moored.length === 1 && !!diff(m5.d.route, g.d.route),
        () => (diff(m5.w, m5.d) || "identical") + "; moored " + JSON.stringify(m5.d.moored));

  // 6. A passage section at its own water (sailSend: koAtLevel), the model handed in place of the chart's.
  const KO2 = build(2.5);                                  // +2.5 m: the 1.0 m shoal is 3.5 m of water, over her 3.15 m floor
  const hereL = () => { const keep = nogo.ko; nogo.ko = KO2; try { return P.routePlan(from, [LL(0, -500)], true, 12); } finally { nogo.ko = keep; } };
  const n3 = page.rec.posted.length;
  const lW = await page.planOffThread({ op: "route", ko: KO2, args: { start: from, wps: [LL(0, -500)], keepRightAll: true, standoffM: 12 } },
                                      () => { throw new Error("the fallback ran"); });
  const lD = hereL(), lDatum = P.routePlan(from, [LL(0, -500)], true, 12);
  const sent6 = page.rec.posted[n3].models.length, held6 = [...page.routeLanes.cmd.held];
  check("6. A PASSAGE SECTION AT ITS OWN WATER (job.ko - atWaterLevel's model at +2.5 m, the shoal open): the worker plans "
        + "on THAT model and its route is the page's own at that water - straight over the shoal, where at datum it goes "
        + "round - and the model is sent for the one search and not kept",
        () => !diff(lW, lD) && !!diff(lD.route, lDatum.route) && lD.route.length < lDatum.route.length
              && sent6 === 1 && held6.length === 1 && held6[0] === page.rec.posted[n3].keep[0],
        () => (diff(lW, lD) || "identical") + "; " + lD.route.length + " points at +2.5 m, " + lDatum.route.length + " at datum; sent "
              + sent6 + ", held after " + JSON.stringify(held6));

  // 7. THE MODEL GOES ONCE: the chart's on the first search, nothing after; a rebuilt chart, once again.
  const counts = page.rec.posted.map((m) => m.models.length);
  const KO3 = build(0);                                    // the same chart rebuilt: a new object, so a new model
  chart(KO3);
  const n4 = page.rec.posted.length;
  const r7 = await page.planOffThread(goto(from, up, o1), () => P.planNogoRoute(from, up, o1));
  const sent7 = page.rec.posted[n4].models.length, d7 = P.planNogoRoute(from, up, o1);
  chart(KO);
  check("7. THE MODEL GOES OVER ONCE: the chart's model on the first search and on none after it (only a search's own "
        + "model rides with it); a REBUILT chart - a new object - is sent once more, and planned on",
        () => counts[0] === 1 && counts.slice(1).filter((n, i) => n > 0).length === 2 && sent7 === 1 && !diff(r7, d7),
        () => "models sent per search: " + JSON.stringify(counts) + " (4: the contacts', 6: the water's); rebuilt: " + sent7);

  // 7b. ... and the VESSEL'S OWN BLOCK (V) goes with every search: her channel reach, how far the confined-water search
  // looks for a channel's walls (routing.js CONFINE: at least 120 m and the buffer x 30). A plain river - its two banks
  // 300 m apart and its charted fairway, no island, no buoys - at a 3 m buffer: its walls are out of the default's reach
  // and in a 400 m one's (the narrow lane: `how.narrow`), so the worker's answer at 400 m is the page's own at 400 m only
  // if her reach went with the search.
  const KOW = buildKeepouts(F, ENF, { min: 3.15, max: 0 }, [FEATS[0], FEATS[1], FEATS.find((f) => f.role === "fairway")]);
  chart(KOW); nogo.buffer = 3;
  const reachWas = V.CHANNEL_REACH_M;
  const atDefault = P.planNogoRoute(from, up, o1);
  V.CHANNEL_REACH_M = 400;
  const r7b = await ask(goto(from, up, o1), () => P.planNogoRoute(from, up, o1));
  V.CHANNEL_REACH_M = reachWas;
  chart(KO);
  check("7b. ... and the VESSEL'S OWN BLOCK (V) goes with every search: at her channel reach of 400 m - a plain river's "
        + "banks found, where the default reach does not find them - the worker's answer is the page's own at that reach, "
        + "and not the route the default reach gives",
        () => !r7b.fb && !diff(r7b.w, r7b.d) && r7b.d.how.narrow === true && atDefault.how.narrow === false
              && !!diff(r7b.d.route, atDefault.route),
        () => (diff(r7b.w, r7b.d) || "identical") + "; the narrow lane at 400 m " + r7b.d.how.narrow + ", at the default "
              + atDefault.how.narrow + "; routes " + (diff(r7b.d.route, atDefault.route) ? "differ" : "THE SAME"));

  // 7c. THE MODEL GOES PACKED AND TRANSFERRED (2026-10-12, Andy: "go ahead with the transfer change"). Cloned as objects
  // the Piscataqua chart's model cost the page 227-684 ms a time; its points now go as one Float64Array whose buffer is
  // handed over. Every model posted went that way - packed, its buffer in the transfer list and EMPTIED on the page by the
  // post (a copy would leave it whole) - and a model packed and unpacked is the model, field for field: the chart's own
  // (marks, buoy systems, charted channels, rocks), at another water, with a contact's hull, with a fold's own fields on a
  // ring (the chart image's), and an empty one; and packing leaves the page's model as it was.
  const posts = page.rec.posted.filter((m) => m.models.length);
  const allPacked = posts.every((m) => m.models.every((x) => x.packed && x.bytes > 0 && x.xy.byteLength === 0) && m.transfer === m.models.length);
  const folded = { ...KO, polys: [...KO.polys, { ring: hull, bb: bbOf(hull), kind: "a structure read off the chart", fromChart: true }],
                   lines: [...KO.lines, { pts: [{ e: 1, n: 2 }, { e: -0, n: 3.5 }], bb: bbOf([{ e: 1, n: 2 }, { e: 0, n: 3.5 }]), kind: "a line read off the chart", fromChart: true }] };
  const empty = { polys: [], lines: [], points: [] };
  const before7c = JSON.stringify(KO);
  const rt = [["the chart's", KO], ["at +2.5 m", KO2], ["with a contact", koIn], ["with the chart image's", folded], ["empty", empty]]
    .map(([name, k]) => ({ name, d: diff(unpackKo(packKo(k)), k) }));
  check("7c. THE MODEL GOES PACKED AND TRANSFERRED: every model posted went as one Float64Array of its points, in the "
        + "transfer list and EMPTIED on the page by the post (handed over, not copied); and packed and unpacked a model is the "
        + "model, field for field - the chart's own, one at another water, one with a contact's hull, one with the chart "
        + "image's structures (a -0 among them), an empty one - with the page's own left as it was",
        () => posts.length >= 4 && allPacked && rt.every((x) => !x.d) && JSON.stringify(KO) === before7c,
        () => posts.length + " posts carried a model, " + (allPacked ? "every one packed and transferred" : "NOT all transferred: "
              + JSON.stringify(posts.map((m) => m.models.map((x) => [x.packed, x.bytes, x.xy && x.xy.byteLength]))))
              + "; round trips: " + rt.map((x) => x.name + " " + (x.d || "same")).join(", "));

  // 8. THE PAGE'S THREAD IS FREE while the worker searches - and is not while it searches here (the control).
  const ticks = async (run) => { let n = 0; const iv = setInterval(() => n++, 5); const t0 = Date.now();
    await run(); const ms = Date.now() - t0; clearInterval(iv); return { n, ms }; };
  // (four searches each way, so the time measured is well past the timer's own resolution)
  const free = await ticks(async () => { for (let k = 0; k < 4; k++) await page.planOffThread(goto(from, up, o1), () => P.planNogoRoute(from, up, o1)); });
  const held = await ticks(async () => { await new Promise((r) => setTimeout(r, 0)); for (let k = 0; k < 4; k++) P.planNogoRoute(from, up, o1); });
  check("8. THE PAGE'S THREAD IS FREE while the worker searches: its timers run all through the search - and on the page's "
        + "own thread (the control: the search as it ran before) they do not run at all",
        // (Windows wakes a timer every ~15.6 ms whatever it asked for, and later on a loaded machine: since the grid over every
        // feature list (2026-10-13) the four searches take ~250 ms, and run beside five other suites they once stretched to
        // 787 ms with the page's timer woken every 33 ms. A tick every 40 ms is the floor asked of it; the control reads 0.)
        () => free.n >= Math.max(5, free.ms / 40) && held.n <= 1 && held.ms > 50,
        () => "in the worker " + free.n + " ticks in " + free.ms + " ms; here " + held.n + " in " + held.ms + " ms");

  // 9. EVERY WAY THE WORKER CAN FAIL FALLS BACK TO THE PAGE'S OWN SEARCH.
  // 9a. a search the worker refuses (here: one it does not know) - answered here, said in the session record
  const bad = await page.planOffThread({ op: "bogus", args: {} }, () => "the page's own");
  const log9 = page.rec.logs.find((l) => l.kind === "route_worker" && !l.data.ok);
  // 9b. no Worker at all
  const p9b = makePage({ noWorker: true });
  const r9b = await p9b.planOffThread(goto(from, up, o1), () => "the page's own");
  // 9c. ?route_worker=off
  const p9c = makePage({ search: "?route_worker=off" });
  const r9c = await p9c.planOffThread(goto(from, up, o1), () => "the page's own");
  check("9. A SEARCH THE WORKER CANNOT ANSWER is answered HERE, as it always was - with the console told this tab is busy "
        + "first (supervisorBusy) and the end stamped (supPlanEnd) - and recorded (route_worker, ok false); so is every "
        + "search with no Worker, and with ?route_worker=off (no worker even made)",
        () => bad === "the page's own" && log9 && /no such search/.test(log9.data.error) && page.rec.busy === 1
              && r9b === "the page's own" && p9b.rec.busy === 1 && p9b.planEnd() > 0
              && r9c === "the page's own" && p9c.rec.busy === 1 && p9c.rec.made.length === 0,
        () => "refused: " + bad + " (" + (log9 && log9.data.error.split("\n")[0]) + "); no Worker: " + r9b + "; off: " + r9c
              + " (" + p9c.rec.made.length + " made)");
  // 9d. a worker that will not load (its file is not there): gone for this page - the search it was given and every one
  // after it answered here, with no second worker made
  const pBroken = makePage({ brokenWorker: true });
  const r9d = await pBroken.planOffThread(goto(from, up, o1), () => "the page's own");
  const r9d2 = await pBroken.planOffThread(goto(from, up, o1), () => "the page's own, again");
  check("9d. A WORKER THAT WILL NOT LOAD is gone for this page: the search it was given is answered here, and so is the "
        + "next - with no second worker made",
        () => r9d === "the page's own" && r9d2 === "the page's own, again" && pBroken.rec.made.length === 1
              && !!pBroken.routeLanes.cmd.dead && pBroken.rec.busy === 2,
        () => r9d + " / " + r9d2 + "; made " + pBroken.rec.made.length + "; dead: " + pBroken.routeLanes.cmd.dead);
  pBroken.close();
  // 9e. a search past the timeout: the worker is ended, the search answered here, and the next one gets a NEW worker
  const p9t = makePage({ timeoutMs: 1 });
  const r9t = await p9t.planOffThread(goto(from, up, o1), () => "the page's own");
  const madeT = p9t.rec.made.length, termT = p9t.rec.terminated, deadT = p9t.routeLanes.cmd.dead;
  const r9t2 = await p9t.planOffThread(goto(from, up, o1), () => "the page's own, again");
  check("9e. A SEARCH PAST ROUTE_WORKER_TIMEOUT_MS: the worker is ended and the search answered here; the worker is NOT "
        + "given up on - the next search makes a new one (which, at 1 ms, times out too)",
        () => r9t === "the page's own" && termT === 1 && !deadT && r9t2 === "the page's own, again" && p9t.rec.made.length === 2
              && madeT === 1,
        () => r9t + "; terminated " + termT + ", dead " + deadT + "; made " + p9t.rec.made.length);
  p9t.close(); p9b.close(); p9c.close();

  // 10. no chart: the planner answers at once, degraded - here, with no busy report and no worker
  const p10 = makePage();
  nogo.ready = false;
  const r10 = await p10.planOffThread(goto(from, up, o1), () => P.planNogoRoute(from, up, o1));
  nogo.ready = true;
  check("10. NO CHART (nogo not ready): the planner answers at once - degraded, straight to the target - here, with no "
        + "busy report to the console and no worker made",
        () => r10.degraded && p10.rec.busy === 0 && p10.rec.made.length === 0,
        () => JSON.stringify(r10).slice(0, 80) + "; busy " + p10.rec.busy + ", made " + p10.rec.made.length);
  p10.close();

  // 11. the ETA rows have their own worker
  const p11 = makePage();
  await p11.planOffThread(goto(from, up, o1), () => null);
  await p11.planOffThread(goto(from, up, o1), () => null, undefined, "est");
  const estLog = p11.rec.logs.filter((l) => l.kind === "route_worker");
  check("11. THE ETA ROWS' SEARCHES HAVE A WORKER OF THEIR OWN, so an estimate never stands in front of a command's (two "
        + "made, one each); and theirs are not written to the session record (one every 50 m of her motion)",
        () => p11.rec.made.length === 2 && p11.routeLanes.cmd.w && p11.routeLanes.est.w && p11.routeLanes.cmd.w !== p11.routeLanes.est.w
              && estLog.length === 1 && estLog[0].data.lane === "cmd",
        () => "made " + p11.rec.made.length + "; recorded " + JSON.stringify(estLog.map((l) => l.data.lane)));
  p11.close();

  // ── 12. A STOP WITHDRAWS A PLAN STILL BEING SEARCHED (planInsideChart) ────────────────────────────────────────────
  const pic = (stopDuring) => {
    const rec = { banners: [], logs: [] };
    const body = [
      "\"use strict\";",
      decl(/^let routeStopGen = [^;]*;/m),
      grab("routeStopPressed"),
      "const showBanner = (m) => rec.banners.push(m), takeDownBanner = () => {};",
      "const logClient = (kind, data) => rec.logs.push({kind, data});",
      "const readPassageAis = async () => {}, aisKeepoutsNow = () => [], openWaterRead = async () => null;",
      grab("planInsideChart"),
      "return { planInsideChart, routeStopPressed };"].join("\n");
    // eslint-disable-next-line no-new-func
    const w = new Function("nogo", "beyondChart", "beyondChartSay", "fmtDist", "rec", body)(
      { ready: true, bbox: null }, P.beyondChart, P.beyondChartSay, (m) => m + " m", rec);
    const plan = () => new Promise((res) => setTimeout(() => { if (stopDuring) w.routeStopPressed(stopDuring); res({ route: [up] }); }, 5));
    return { w, rec, run: () => w.planInsideChart([from, up], undefined, plan, "Go-To") };
  };
  const s12 = pic("STOP"), r12 = await s12.run();
  const n12 = pic(null), q12 = await n12.run();
  check("12. A STOP PRESSED WHILE THE ROUTE IS SEARCHED WITHDRAWS THE PLAN: planInsideChart answers `withdrawn` with an "
        + "error saying which was pressed, says it on the banner (nothing was sent) and records it (plan_withdrawn) - and "
        + "with no press the plan comes back as planned",
        () => r12.withdrawn === true && /^Go-To withdrawn: STOP was pressed/.test(r12.error) && !r12.route
              && s12.rec.banners.some((b) => /Nothing was sent/.test(b)) && s12.rec.logs.some((l) => l.kind === "plan_withdrawn" && l.data.by === "STOP")
              && !q12.withdrawn && q12.route && q12.route.length === 1,
        () => JSON.stringify(r12) + "; unpressed: " + JSON.stringify(q12).slice(0, 60));

  // ── 13. THE WIRING ───────────────────────────────────────────────────────────────────────────────────────────────
  const CALLERS = { doGoTo: "Go-To", doRTH: "RTH", sailSend: "section", doTransit: "Transit", doUpload: "Upload",
                    continueSurvey: "Continue", resumeFromHere: "Resume from here" };
  // (the caller's closure: from its `await planInsideChart(` to the `withdrawn` it checks straight after)
  // (a caller that searches through planGoToLeg - the Go-To since 2026-10-18, its lock transit's legs beside it - is held
  // to that function's own search through planOffThread, and to its own `withdrawn` straight after the call)
  const legSrc = grab("planGoToLeg"), legThrough = /return planInsideChart\([\s\S]*planOffThread\(/.test(legSrc);
  const wiring = Object.keys(CALLERS).map((fn) => {
    const src = grab(fn);
    let i = src.indexOf("await planInsideChart("), viaLeg = false;
    if (i < 0) { i = src.indexOf("await planGoToLeg("); viaLeg = i >= 0; }
    const j = i < 0 ? -1 : src.indexOf(".withdrawn", i);
    return { fn, through: i >= 0 && j > i && (viaLeg ? legThrough : /planOffThread\(/.test(src.slice(i, j))), checks: i >= 0 && j > i };
  });
  const tec = grab("transitEstCompute");
  const handler = (id) => { const i = H.indexOf('$("#' + id + '").onclick'); return H.slice(i, H.indexOf("\n$(", i + 10)); };
  const stopH = handler("b_stop"), pauseH = handler("b_pause"), holdH = handler("b_hold"), estopH = handler("b_estop");
  const PIC = grab("planInsideChart"), PH = grab("planHere");
  check("13. THE WIRING: every command's search goes through planOffThread and every caller stands down on `withdrawn`; "
        + "the ETA rows use their own worker; Stop, Pause (pausing, not resuming), Hold and E-STOP (latching, once "
        + "confirmed) each withdraw a plan in flight; planInsideChart awaits the caller's search and no longer holds the "
        + "thread itself, and planHere tells the console before it does",
        () => wiring.every((w) => w.through && w.checks)
              && /planOffThread\(\{op: "nogo"[^\n]*"est"\)/.test(tec) && !/= planNogoRoute\(/.test(tec)
              && /routeStopPressed\("STOP"\);[^\n]*\n\s*const r = await cmd\("\/api\/cmd\/stop"\)/.test(stopH)
              && pauseH.indexOf("resumeRun()") < pauseH.indexOf('routeStopPressed("PAUSE")')
              && /routeStopPressed\("HOLD"\);[^\n]*\n\s*const r = await cmd\("\/api\/cmd\/hold"/.test(holdH)
              && estopH.indexOf("guiConfirm") < estopH.indexOf('if(on) routeStopPressed("E-STOP")')
              && /let p = await plan\(\)/.test(PIC) && /p = await plan\(\);/.test(PIC) && !/supervisorBusy/.test(PIC)
              && (PIC.match(/routeStopGen !== stopWas/g) || []).length === 3
              && /await supervisorBusy\(\);\s*\n\s*try\{ return here\(\); \}\s*\n\s*finally\{ supPlanEnd = Date\.now\(\); \}/.test(PH),
        () => wiring.filter((w) => !(w.through && w.checks)).map((w) => w.fn + (w.through ? "" : " not through planOffThread")
              + (w.checks ? "" : " not checking withdrawn")).join("; ") || "all seven callers wired");

  page.close();
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
