// tests/deep_first.js - DEEP WATER FIRST (2026-10-12).
//
// Andy, of his Go-To past Thacher Island off Rockport, which ran over the 5.4-9.1 m patch beside Oak Rock - legal water at
// her 4.0 m floor: "good safe practice would have put it between the buoys and especially not over the shallow spot.
// There should be an awareness that although the ENC is an excellent source of data it can be inaccurate in some
// instances." His choice, asked: plan first keeping 2 m over the floor and 50 m off charted rocks and shoal soundings;
// today's floor and buffer only on stretches where there is no other way; and say so on the plan.
//
// keepouts.js deepKeepouts builds that MARGIN LAYER beside the model (`ko.margin`, inert); passage.js deepFirst walks the
// floor's route, takes a deeper way round each stretch of margin water that has one within the detour allowed, and
// RELEASES the rest; blocked / clearanceM / blockedInfo and the raster read the layer only where a planner ARMS it
// (`ko.deep`). deepLanePass runs the lane pass on that, and where a mark is left wrong near the layer, again with the
// mark held - a buoy outranks the chart's margin.
//
// THE REAL CHARTS: tests/fixtures/enc_oak_rock.json (his tile about Oak Rock Buoy 2 and Thacher Island Buoy 1) and
// tests/fixtures/enc_dog_bar.json (his tile about the mouth of Gloucester Harbor, the end of that Go-To), built at his
// settings that evening - the DriX EM712, Min depth 4.0 m, +0.33 m of water.
//
//   node tests/deep_first.js      # exit 0 = pass, 1 = fail   (stdlib Node)

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
const APP = process.env.ASV_APP || path.join(__dirname, "..");
const JS = (f) => path.join(APP, "static", "js", f);
const { V, nogo, sea } = require(JS("state.js"));
const { planeFrame } = require(JS("geodesy.js"));
const { buildKeepouts, buildMargin, legClear } = require(JS("chart.js"));
const K = require(JS("keepouts.js"));
const P = require(JS("passage.js"));
const R = require(JS("routing.js"));
const { rasterKeepouts } = require(JS("raster.js"));
const { koCount, packKo, unpackKo, routeReply } = require(JS("route_job.js"));
const ASV_HTML = process.env.ASV_HTML || path.join(APP, "static", "asv.html");
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
const f0 = (x) => (x == null ? "null" : String(Math.round(x)));
const ENF = { land: true, depth: true, haz: true, area: false, wreck: true, chan: true };
V.NOGO_MIN_DEPTH_M = 3.15; V.OPER_MIN_DEPTH_M = 4.0; V.NOGO_BUFFER_M = 5; V.AIR_DRAFT_M = 2.85; V.OVERHEAD_CLEARANCE_M = 1.0;
const O = { holdR: 20, setMs: 0, standoffM: 20 };
// her route's nearest approach to a set of frame points, and the meters of it inside a set of rings
const sampled = (F, route, step = 2) => { const out = [], en = route.map((q) => F.toEN(q));
  for (let i = 1; i < en.length; i++) { const a = en[i - 1], b = en[i], n = Math.max(1, Math.ceil(Math.hypot(b.e - a.e, b.n - a.n) / step));
    for (let k = 0; k <= n; k++) out.push({ e: a.e + (b.e - a.e) * k / n, n: a.n + (b.n - a.n) * k / n }); } return out; };
const nearest = (F, route, pts) => { let m = Infinity; for (const p of sampled(F, route)) for (const q of pts) m = Math.min(m, Math.hypot(p.e - q.e, p.n - q.n)); return m; };
const lenOf = (F, route) => { let L = 0; for (let i = 1; i < route.length; i++) { const a = F.toEN(route[i - 1]), b = F.toEN(route[i]); L += Math.hypot(b.e - a.e, b.n - a.n); } return L; };
const pip = (p, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
  if ((ring[i].n > p.n) !== (ring[j].n > p.n) && p.e < (ring[j].e - ring[i].e) * (p.n - ring[i].n) / (ring[j].n - ring[i].n) + ring[i].e) c = !c; return c; };
const metersIn = (F, route, rings) => { let m = 0; const s = sampled(F, route, 2); for (let i = 1; i < s.length; i++) if (rings.some((r) => pip(s[i], r))) m += Math.hypot(s[i].e - s[i - 1].e, s[i].n - s[i - 1].n); return m; };

// ── A WORLD OF ITS OWN: open water 10-20 m deep, laid out in a local plane ───────────────────────────────────────────
const GF = planeFrame({ lat: 42.0, lon: -70.0 });
const LLc = (e, n) => { const q = GF.fromEN(e, n); return [q.lon, q.lat]; };
const gll = (e, n) => { const q = GF.fromEN(e, n); return { lat: q.lat, lon: q.lon }; };
const rect = (e0, n0, e1, n1) => [[LLc(e0, n0), LLc(e1, n0), LLc(e1, n1), LLc(e0, n1), LLc(e0, n0)]];
const area = (d1, d2, e0, n0, e1, n1) => ({ role: "depth_area", cls: "Depth_Area", props: { DRVAL1: d1, DRVAL2: d2 }, geometry: { type: "Polygon", coordinates: rect(e0, n0, e1, n1) } });
const land = (e0, n0, e1, n1) => ({ role: "land", cls: "Land_Area", props: {}, geometry: { type: "Polygon", coordinates: rect(e0, n0, e1, n1) } });
const sounding = (e, n, d) => ({ role: "sounding", cls: "Sounding_point", props: {}, geometry: { type: "Point", coordinates: [...LLc(e, n), d] } });
const rock = (e, n, vs) => ({ role: "hazard_point", cls: "Underwater_Awash_Rock_point", props: vs == null ? {} : { VALSOU: vs }, geometry: { type: "Point", coordinates: LLc(e, n) } });
const SEA = area(10, 20, -6000, -6000, 6000, 6000);
const GBOX = (() => { const a = GF.fromEN(-5500, -5500), b = GF.fromEN(5500, 5500); return { W: a.lon, S: a.lat, E: b.lon, N: b.lat }; })();
const world = (feats, withMargin = true) => {
  const was = sea.waterOffset; sea.waterOffset = 0;
  try { const ko = buildKeepouts(GF, ENF, { min: 4.0, max: 0 }, feats);
        if (withMargin) ko.margin = buildMargin(GF, ENF, { min: 4.0, max: 0 }, feats, undefined, ko);
        return ko; } finally { sea.waterOffset = was; }
};
const onWorld = (ko) => Object.assign(nogo, { ready: true, frame: GF, ko, buffer: 5, bbox: GBOX, unread: null, ais: null });
const ringEN = (e0, n0, e1, n1) => [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }];

// ── HIS CHART ABOUT OAK ROCK ──────────────────────────────────────────────────────────────────────────────────────────
const OAKFIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "enc_oak_rock.json"), "utf8"));
const OF = planeFrame({ lat: 42.642, lon: -70.582 });
const oakBuild = (feats, withMargin = true) => {
  const was = sea.waterOffset; sea.waterOffset = 0.33;
  try { const ko = buildKeepouts(OF, ENF, { min: 4.0, max: 0 }, feats);
        if (withMargin) ko.margin = buildMargin(OF, ENF, { min: 4.0, max: 0 }, feats, undefined, ko);
        return ko; } finally { sea.waterOffset = was; }
};
const OAK = oakBuild(OAKFIX.features), OAK0 = oakBuild(OAKFIX.features, false);
const [oW, oS, oE, oN] = OAKFIX.box;
const OBOX = { W: oW + 0.002, S: oS + 0.002, E: oE - 0.002, N: oN - 0.002 };
const onOak = (ko) => Object.assign(nogo, { ready: true, frame: OF, ko, buffer: 5, bbox: OBOX, unread: null, ais: null });
const oen = (ll) => OF.toEN(ll);
const OAK2 = oen({ lat: 42.64041, lon: -70.58413 }), THA1 = oen({ lat: 42.6392, lon: -70.58005 });
const NORTH = { lat: 42.6520, lon: -70.5855 }, SOUTH = { lat: 42.6320, lon: -70.5840 };
const patchRings = OAKFIX.features.filter((f) => f.role === "depth_area" && f.props.DRVAL1 === 5.4)
  .flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0])))
  .map((r) => r.map(([lon, lat]) => oen({ lat, lon })));
// the 5.4-9.1 m patch about the pair ("the shallow spot"): her route's samples within 200 m of the pair's own northings - past
// that, bound south, she runs into the margin water her end point itself lies in (said 'where she ends')
const nearPair = (n) => n > Math.min(OAK2.n, THA1.n) - 200 && n < Math.max(OAK2.n, THA1.n) + 200;
const atPair = (route) => { const pts = route.map(oen), n0 = (OAK2.n + THA1.n) / 2;
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if ((a.n - n0) * (b.n - n0) <= 0 && a.n !== b.n) return a.e + (b.e - a.e) * (n0 - a.n) / (b.n - a.n); }
  return null; };

console.log("Deep water first: the margin layer, armed by the planner, released where there is no other way:");

// ── THE LAYER ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const M = OAK.margin;
const bandOf = (d1) => OAKFIX.features.filter((f) => f.role === "depth_area" && f.props.DRVAL1 === d1);
// (an area is in the layer when a ring of the layer is ITS ring, vertex for vertex: neighbors share vertices along a seam)
const inLayer = (f) => { const rg = (f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]).map(([lon, lat]) => oen({ lat, lon }));
  return M.polys.some((q) => q.ring.length === rg.length && q.ring.every((v, i) => Math.hypot(v.e - rg[i].e, v.n - rg[i].n) < 0.01)); };
const shoal = OAKFIX.features.filter((f) => f.role === "sounding" && f.geometry.coordinates[2] + 0.33 < 6.0);
const deepS = OAKFIX.features.filter((f) => f.role === "sounding" && f.geometry.coordinates[2] + 0.33 >= 6.0);
const ptIn = (f) => { const p = oen({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }); return M.points.some((q) => Math.hypot(q.e - p.e, q.n - p.n) < 0.01); };
const oakRock = OAKFIX.features.filter((f) => f.cls === "Underwater_Awash_Rock_point" && f.props.OBJNAM === "Oak Rock");
check("1. THE LAYER ON HIS CHART (floor 4.0 m, +0.33 m): every 5.4-9.1 m area is in it - its SHALLOWEST depth 5.73 m is "
      + "under floor + 2 - and no 9.1-18.2 m area is; neither is a keep-out at the floor (the floor reads a band by its "
      + "deepest); every sounding under 6.0 m with the water is a 50 m berth or lies wholly inside an area, none deeper is "
      + "one; Oak Rock (charted 1.5 m) is a 50 m berth",
      () => bandOf(5.4).length > 0 && bandOf(5.4).every(inLayer) && bandOf(9.1).length > 0 && !bandOf(9.1).some(inLayer)
            && !OAK0.polys.some((q) => /less than/.test(q.kind)) && shoal.length > 0 && shoal.some(ptIn) && !deepS.some(ptIn)
            && oakRock.length && oakRock.every(ptIn) && M.points.every((q) => q.berth === 50 && q.r === 0)
            && K.DEEP_MARGIN_M === 2 && K.DEEP_BERTH_M === 50,
      () => "5.4 m areas " + bandOf(5.4).length + " (in the layer " + bandOf(5.4).filter(inLayer).length + "), 9.1 m areas "
            + bandOf(9.1).length + " (in it " + bandOf(9.1).filter(inLayer).length + "); shoal soundings " + shoal.length + " ("
            + shoal.filter(ptIn).length + " berths), deeper " + deepS.length + " (" + deepS.filter(ptIn).length + "); Oak Rock "
            + oakRock.map((f) => f.props.VALSOU + " m, a berth " + ptIn(f)).join() + "; " + JSON.stringify(M.counts));
// a sounding whose berth lies wholly inside an area adds nothing; one near its edge is kept
const pr = world([SEA, area(2, 3.6, -500, -500, 500, 500), sounding(0, 0, 1.0), sounding(470, 0, 1.0), sounding(1500, 0, 3.0), sounding(2500, 0, 9.0)]);
const prAt = (e) => pr.margin.points.some((q) => Math.abs(q.e - e) < 0.5 && Math.abs(q.n) < 0.5);
check("2. A SOUNDING INSIDE AN AREA ITS BERTH'S RADIUS FROM THE EDGE ADDS NOTHING: in a 1 km keep-out area, a 1.0 m sounding "
      + "at its middle is not kept and one 30 m from its edge is; in open water a 3.0 m sounding is and a 9.0 m one is not",
      () => !prAt(0) && prAt(470) && prAt(1500) && !prAt(2500) && pr.margin.counts.soundings === 2,
      () => "kept at e = " + pr.margin.points.map((q) => f0(q.e)).join(", ") + "; " + JSON.stringify(pr.margin.counts));
const tog = (enf) => K.deepKeepouts(GF, [SEA, area(5, 9, -200, -200, 200, 200), sounding(1000, 0, 3), rock(2000, 0, 3), rock(2500, 0, 5.5), rock(3500, 0, 8.0),
  { role: "hazard_point", cls: "Wreck_point", props: {}, geometry: { type: "Point", coordinates: LLc(3000, 0) } }],
  { minDepthM: 4.0, depthRange: { min: 4.0, max: 0 }, waterOffsetM: 0, enforce: enf }).counts;
const tAll = tog(ENF), tDepth = tog({ ...ENF, depth: false }), tHaz = tog({ ...ENF, haz: false }), tWreck = tog({ ...ENF, wreck: false });
check("3. THE ROCKS IT BERTHS, AND THE TOGGLES: a rock 3.0 m down and one 5.5 m down (passed at her 4.0 m floor, not 2 m over "
      + "it) are berthed, one 8.0 m down is not, a wreck of no charted depth is; depth off - no areas, no soundings; hazards "
      + "off - no rocks, no wrecks; wrecks off - the rocks stay, the wreck goes",
      () => tAll.areas === 1 && tAll.soundings === 1 && tAll.rocks === 3 && tDepth.areas === 0 && tDepth.soundings === 0 && tDepth.rocks === 3
            && tHaz.rocks === 0 && tHaz.areas === 1 && tWreck.rocks === 2,
      () => JSON.stringify({ all: tAll, depth: tDepth, haz: tHaz, wreck: tWreck }));

// ── INERT, ARMED, RELEASED ────────────────────────────────────────────────────────────────────────────────────────────
const inPatch = (() => { const r = patchRings[0]; let c = { e: 0, n: 0 }; for (const v of r) { c.e += v.e / r.length; c.n += v.n / r.length; }
  if (pip(c, r)) return c; for (const v of r) for (const w of r) { const q = { e: (v.e + w.e) / 2, n: (v.n + w.n) / 2 }; if (pip(q, r)) return q; } return null; })();
const armed = P.armDeep(OAK, 5), relArmed = P.armDeep(OAK, 5, [{ pts: [inPatch, inPatch], r: 60, bb: K.bbOf([inPatch]) }]);
check("4. INERT UNTIL ARMED: a point in the 5.4 m patch is not blocked by the model that carries the layer (`margin`) - the "
      + "guard, the punch, the hold point read that - and its clearance is the floor model's to the meter; ARMED (`deep`) it "
      + "is blocked, its clearance 0; RELEASED there, it is free again",
      () => inPatch && !K.blocked(inPatch, OAK, 5) && K.clearanceM(inPatch, OAK) === K.clearanceM(inPatch, OAK0)
            && K.blocked(inPatch, armed, 5) && K.clearanceM(inPatch, armed) === 0 && K.blockedInfo(inPatch, armed, 5).margin === true
            && !K.blocked(inPatch, relArmed, 5) && K.clearanceM(inPatch, relArmed) > 0,
      () => "unarmed " + K.blocked(inPatch, OAK, 5) + ", armed " + K.blocked(inPatch, armed, 5) + " (" + (K.blockedInfo(inPatch, armed, 5) || {}).kind
            + "), released " + K.blocked(inPatch, relArmed, 5));
const a5 = P.armDeep(OAK, 5), a20 = P.armDeep(OAK, 20), a5b = P.armDeep(OAK, 5);
check("5. ARMED AT A MARGIN, THE BERTH IS THE DISTANCE KEPT: at 5 m each berth's radius is 45, at 20 m it is 30 - 50 m from "
      + "the sounding either way - and the berths at a margin are one list, kept (the grid is filed once per margin)",
      () => a5.deep.points.every((q) => q.r === 45) && a20.deep.points.every((q) => q.r === 30) && a5.deep.points === a5b.deep.points
            && a5.deep.points !== a20.deep.points && a5.deep.polys === OAK.margin.polys,
      () => "radii " + [...new Set(a5.deep.points.map((q) => q.r))] + " / " + [...new Set(a20.deep.points.map((q) => q.r))]);
// the armed layer, read through the model's grid (keepouts.js nearIn), against the layer walked one feature at a time - a
// model of one feature is never filed (GRID_MIN) - every point test, clearance and refusal the same
const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const probe = Array.from({ length: 500 }, () => ({ e: -1600 + 3200 * rnd(), n: -1600 + 3200 * rnd() }));
const lay20 = a20.deep, armedOnly = { polys: [], lines: [], points: [], deep: lay20 };
const one = (f) => (f.ring ? { polys: [f], lines: [], points: [] } : { polys: [], lines: [], points: [f] });
const walkList = [...lay20.polys, ...lay20.points];
let gridDiff = 0, clrDiff = 0, infoDiff = 0, hits = 0;
for (const p of probe) {
  for (const buf of [5, 20, 150]) {
    const g = K.blocked(p, armedOnly, buf), first = walkList.find((f) => K.blocked(p, one(f), buf));
    if (g !== !!first) gridDiff++; if (first) hits++;
    const gi = K.blockedInfo(p, armedOnly, buf);
    if (!!gi !== !!first || (gi && gi.kind !== first.kind)) infoDiff++;
  }
  const gc = K.clearanceM(p, armedOnly, 60), wc = Math.min(60, ...walkList.map((f) => K.clearanceM(p, one(f), 60)));
  if (Math.abs(gc - wc) > 1e-9) clrDiff++;
}
check("6. THE ARMED LAYER READ THROUGH THE MODEL'S GRID FINDS WHAT A WALK OF IT FINDS, ONE FEATURE AT A TIME: 500 points about "
      + "the pair, at 5 m, 20 m and past the pad (150 m) - blocked, the refusal's kind and the clearance (to 60 m) the same for "
      + "every one, and its lists filed",
      () => gridDiff === 0 && infoDiff === 0 && clrDiff === 0 && hits > 50 && K.listGridded(lay20.polys) && K.listGridded(lay20.points),
      () => "blocked differs " + gridDiff + ", refusal " + infoDiff + ", clearance " + clrDiff + " (" + hits + " blocked tests)");
// the raster: never free where `blocked` refuses, and it does release
const rel = [{ pts: [{ e: -300, n: -900 }, { e: -300, n: 900 }], r: 150, bb: K.bbOf([{ e: -300, n: -900 }, { e: -300, n: 900 }]) }];
const armedR = P.armDeep(OAK, 5, rel), armedN = P.armDeep(OAK, 5);
const Wd = 320, Hd = 320, cell = 10, x0 = -1600, y0 = -1600;
const gR = new Uint8Array(Wd * Hd), gN = new Uint8Array(Wd * Hd), g0 = new Uint8Array(Wd * Hd);
rasterKeepouts(gR, Wd, Hd, x0, y0, cell, armedR, 5); rasterKeepouts(gN, Wd, Hd, x0, y0, cell, armedN, 5); rasterKeepouts(g0, Wd, Hd, x0, y0, cell, OAK0, 5);
let under = 0, cleared = 0, layerCells = 0;
for (let gy = 0; gy < Hd; gy++) for (let gx = 0; gx < Wd; gx++) {
  const i = gy * Wd + gx, p = { e: x0 + gx * cell, n: y0 + gy * cell };
  if (K.blocked(p, armedR, 5) && !gR[i]) under++;
  if (gN[i] && !g0[i]) layerCells++;
  if (gN[i] && !gR[i]) cleared++;
}
check("7. THE RASTER NEVER UNDER-READS THE ARMED LAYER (routing.js trusts a raster-clear leg): over 102,400 cells about the "
      + "pair, no cell center `blocked` refuses is free - with a 150 m release laid across the patch - and the layer is painted "
      + "(cells the floor's raster leaves free) and the release does clear some",
      () => under === 0 && layerCells > 1000 && cleared > 100,
      () => "under-read " + under + ", layer cells " + layerCells + ", cleared by the release " + cleared);

// ── deepFirst ON WATER OF ITS OWN ─────────────────────────────────────────────────────────────────────────────────────
// a 5.0-9.1 m patch 300 m across in 10-20 m water, her route straight through it
const PATCH = area(5.0, 9.1, -150, -150, 150, 150), patchRing = ringEN(-150, -150, 150, 150);
const A = gll(0, -1500), B = gll(0, 1500);
onWorld(world([SEA, PATCH], false));
const pA0 = P.planNogoRoute(A, B, {});
onWorld(world([SEA, PATCH]));
const pA = P.planNogoRoute(A, B, {});
check("8. A STRETCH WITH A DEEPER WAY IS TAKEN ROUND: through a 300 m patch of 5.0-9.1 m water the route goes round it - none of "
      + "it in the patch, the patch 5 m off - one stretch taken round, none at her floor, nothing said on the banner; the "
      + "CONTROL, the same water without the layer, runs straight through it, as today",
      () => !pA.error && metersIn(GF, [A, ...pA.route], [patchRing]) === 0 && nearest(GF, [A, ...pA.route], sampled(GF, [gll(-150, -150), gll(150, -150), gll(150, 150), gll(-150, 150), gll(-150, -150)], 2)) >= 4.9
            && pA.deep.repaired === 1 && pA.deep.runs.length === 0 && P.deepNote(pA.deep) === ""
            && !pA0.error && metersIn(GF, [A, ...pA0.route], [patchRing]) > 290 && pA0.deep === null,
      () => "deep: in the patch " + f0(metersIn(GF, [A, ...pA.route], [patchRing])) + " m, repaired " + pA.deep.repaired + ", runs " + pA.deep.runs.length
            + ", " + f0(lenOf(GF, [A, ...pA.route])) + " m long; control: in it " + f0(metersIn(GF, [A, ...pA0.route], [patchRing])) + " m, deep " + pA0.deep);
// the same patch 2.2 km wide: there IS a way round, within the search's reach, and it is far past the detour allowed
const WIDE = area(5.0, 9.1, -1100, -150, 1100, 150), wideRing = ringEN(-1100, -150, 1100, 150);
onWorld(world([SEA, WIDE]));
const pW = P.planNogoRoute(A, B, {});
check("9. ... AND ONE WITH NONE WITHIN THE DETOUR ALLOWED IS KEPT AT HER FLOOR AND SAID: across a 2.2 km band of it the way "
      + "round is far past half again the way (or 1 km more), so she crosses it as the floor's route does - the stretch "
      + "released, 'none' - and the banner and the Intent card say so, where",
      () => !pW.error && Math.abs(metersIn(GF, [A, ...pW.route], [wideRing]) - 300) < 15 && pW.deep.repaired === 0
            && pW.deep.released.length === 1 && pW.deep.released[0].why === "none" && pW.deep.runs.length === 1 && pW.deep.runs[0].why === "none"
            && /^deep water first: \d+ m at her floor \(1 with no deeper way\)$/.test(P.deepNote(pW.deep))
            && P.DEEP_DETOUR === 1.5 && P.DEEP_DETOUR_MIN_M === 1000,
      () => "in the band " + f0(metersIn(GF, [A, ...pW.route], [wideRing])) + " m; released " + JSON.stringify(pW.deep.released.map((x) => [f0(x.m), x.why]))
            + "; banner: " + P.deepNote(pW.deep));
// a 3.0 m sounding 30 m off her straight line, and a 2.0 m rock 20 m off the other side further on
onWorld(world([SEA, sounding(30, -400, 3.0), rock(-20, 500, 2.0)]));
const pS = P.planNogoRoute(A, B, {});
const sPt = { e: 30, n: -400 }, rPt = { e: -20, n: 500 };
onWorld(world([SEA, sounding(30, -400, 3.0), rock(-20, 500, 2.0)], false));
const pS0 = P.planNogoRoute(A, B, {});
check("10. 50 M OFF A SHOAL SOUNDING AND A CHARTED ROCK: a 3.0 m sounding 30 m off her line and a 2.0 m rock 20 m off it are "
      + "each passed at 50 m or more (the berth less nothing: at her 5 m buffer, a 45 m radius); the CONTROL passes the sounding "
      + "at 30 m - a sounding is no keep-out at the floor - and the rock at its assumed 10 m and the buffer",
      () => !pS.error && nearest(GF, [A, ...pS.route], [sPt]) >= 49.9 && nearest(GF, [A, ...pS.route], [rPt]) >= 49.9 && pS.deep.runs.length === 0
            && !pS0.error && nearest(GF, [A, ...pS0.route], [sPt]) < 31 && nearest(GF, [A, ...pS0.route], [rPt]) < 21,
      () => "deep: sounding " + f0(nearest(GF, [A, ...pS.route], [sPt])) + " m, rock " + f0(nearest(GF, [A, ...pS.route], [rPt])) + " m; control: "
            + f0(nearest(GF, [A, ...pS0.route], [sPt])) + " m, " + f0(nearest(GF, [A, ...pS0.route], [rPt])) + " m");
// she starts in a long strip of margin water 150 m from its east edge (nearer it, the search's own leave to run out of
// blocked water from her start finds the way without the release)
const STRIP = area(5.0, 9.1, -200, -2500, 200, 400), stripRing = ringEN(-200, -2500, 200, 400);
const S0 = gll(50, -2000), T0 = gll(0, 1500);
onWorld(world([SEA, STRIP]));
const pSt = P.planNogoRoute(S0, T0, {});
onWorld(world([SEA, STRIP], false));
const pSt0 = P.planNogoRoute(S0, T0, {});
check("11. SHE STARTS IN MARGIN WATER: she leaves it the short way - the water about her out to the nearest deeper water is "
      + "released first - and runs the rest outside it; one stretch, 'where she starts', said; the CONTROL runs 2.4 km up the strip",
      () => !pSt.error && metersIn(GF, [S0, ...pSt.route], [stripRing]) < 200 && pSt.deep.runs.length === 1 && pSt.deep.runs[0].why === "start"
            && /where she starts/.test(P.deepNote(pSt.deep)) && P.deepWhy(pSt.deep)[0].t === "lane"
            && !pSt0.error && metersIn(GF, [S0, ...pSt0.route], [stripRing]) > 2300,
      () => "deep: in the strip " + f0(metersIn(GF, [S0, ...pSt.route], [stripRing])) + " m (" + JSON.stringify(pSt.deep.runs.map((r) => [f0(r.m), r.why]))
            + "); control " + f0(metersIn(GF, [S0, ...pSt0.route], [stripRing])) + " m");

// ── HIS WATER AT OAK ROCK ─────────────────────────────────────────────────────────────────────────────────────────────
onOak(OAK);
const south = P.planNogoRoute(NORTH, SOUTH, O), north = P.planNogoRoute(SOUTH, NORTH, O);
onOak(OAK0);
const south0 = P.planNogoRoute(NORTH, SOUTH, O);
const legsClear = (route, ko) => { for (let i = 1; i < route.length; i++) if (!legClear(route[i - 1], route[i], OF, ko, 5)) return false; return true; };
const patchAt = (r, from) => { const s = sampled(OF, [from, ...r.route], 2); let m = 0;
  for (let i = 1; i < s.length; i++) if (nearPair(s[i].n) && patchRings.some((rg) => pip(s[i], rg))) m += Math.hypot(s[i].e - s[i - 1].e, s[i].n - s[i - 1].n);
  return m; };
check("12. HIS GO-TO'S WATER, BOUND SOUTH: between Oak Rock Buoy 2 and Thacher Island Buoy 1 and NONE of it over the 5.4-9.1 m "
      + "patch about them (the shallow spot) - both offshore marks still kept, every leg clear of the floor's model, no stretch "
      + "between her start and her end said at her floor; the CONTROL (today's planner, no layer) between them too, but over the "
      + "patch's edge",
      () => !south.error && patchAt(south, NORTH) === 0 && atPair([NORTH, ...south.route]) > OAK2.e && atPair([NORTH, ...south.route]) < THA1.e
            && south.how.marks.offshore === 2 && south.how.marks.offshoreWrong === 0 && legsClear([NORTH, ...south.route], OAK0)
            && south.deep.runs.every((r) => r.end) && !south0.error && patchAt(south0, NORTH) > 20,
      () => "deep: over the patch " + f0(patchAt(south, NORTH)) + " m, " + f0(atPair([NORTH, ...south.route]) - OAK2.e) + " m east of Oak Rock 2, "
            + JSON.stringify(south.how.marks) + ", runs " + JSON.stringify(south.deep.runs.map((r) => [f0(r.m), r.why]))
            + "; control: over it " + f0(patchAt(south0, NORTH)) + " m, " + f0(atPair([NORTH, ...south0.route]) - OAK2.e) + " m east of Oak Rock 2");
check("13. ... AND BOUND NORTH THE SAME",
      () => !north.error && patchAt(north, SOUTH) === 0 && atPair([SOUTH, ...north.route]) > OAK2.e && atPair([SOUTH, ...north.route]) < THA1.e
            && north.how.marks.offshoreWrong === 0,
      () => "over the patch " + f0(patchAt(north, SOUTH)) + " m, " + f0(atPair([SOUTH, ...north.route]) - OAK2.e) + " m east of Oak Rock 2");

// ── A BUOY OUTRANKS THE MARGIN: HIS WATER AT THE DOG BAR ──────────────────────────────────────────────────────────────
const DOGFIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "enc_dog_bar.json"), "utf8"));
const DF = planeFrame({ lat: 42.582, lon: -70.671 });
const dogBuild = (feats, withMargin = true) => {
  const was = sea.waterOffset; sea.waterOffset = 0.33;
  try { const ko = buildKeepouts(DF, ENF, { min: 4.0, max: 0 }, feats);
        if (withMargin) ko.margin = buildMargin(DF, ENF, { min: 4.0, max: 0 }, feats, undefined, ko);
        return ko; } finally { sea.waterOffset = was; }
};
const DOG = dogBuild(DOGFIX.features), DOG0 = dogBuild(DOGFIX.features, false);
const [dW, dS, dE, dN] = DOGFIX.box;
const DBOX = { W: dW + 0.002, S: dS + 0.002, E: dE - 0.002, N: dN - 0.002 };
const onDog = (ko) => Object.assign(nogo, { ready: true, frame: DF, ko, buffer: 5, bbox: DBOX, unread: null, ais: null });
const DFROM = { lat: 42.578135, lon: -70.660575 }, DTO = { lat: 42.592985, lon: -70.670282 };   // his route, and his Gloucester target
const verdicts = (from, r) => R.markVerdicts([from, ...r.route], DF, r.marks).map((v) => ({ sys: v.k.m.sys, ok: v.proper }));
onDog(DOG0);
const dToday = P.planNogoRoute(DFROM, DTO, O);
onDog(DOG);
const dDeep = P.planNogoRoute(DFROM, DTO, O);
// the rehearsal: the deep route's lane pass WITHOUT the second asking (deepFirst then the lane pass, as deepLanePass begins)
const dLeg = R.legPath(DFROM, DTO, DF, DOG, 20);
const dFirst = P.deepFirst([DFROM, ...dLeg], DF, DOG, 20);
const dOnce = P.keepStandoff(P.channelLaneRoute(dFirst.path, DF, dFirst.ko, 5, { standoffM: 20, marks: true, charted: true }), dFirst.path, DF, dFirst.ko, 20);
const wrongOf = (vs) => vs.filter((v) => !v.ok).map((v) => v.sys).sort().join(",");
const vToday = verdicts(DFROM, dToday), vDeep = verdicts(DFROM, dDeep), vOnce = R.markVerdicts(dOnce.route, DF, dOnce.marks).map((v) => ({ sys: v.k.m.sys, ok: v.proper }));
check("14. A BUOY OUTRANKS THE MARGIN, AT THE MOUTH OF GLOUCESTER HARBOR: armed once, the layer kept the marks stage from bringing "
      + "her to the Dog Bar Channel green's proper hand, as the floor's model lets it (the REHEARSAL: deepFirst and one lane pass, "
      + "the green wrong); asked again with the marks it left wrong held - the layer lifted about them - the plan leaves the "
      + "marks as today's does, and the Dog Bar water held for a buoy is said ('for a buoy')",
      () => !dToday.error && !dDeep.error && wrongOf(vDeep) === wrongOf(vToday) && /dog bar channel/.test(wrongOf(vOnce))
            && !/dog bar channel/.test(wrongOf(vDeep)) && dDeep.deep.runs.some((r) => r.why === "mark") && /for a buoy\)/.test(P.deepNote(dDeep.deep)),
      () => "today wrong [" + wrongOf(vToday) + "]; once [" + wrongOf(vOnce) + "]; deep first [" + wrongOf(vDeep) + "]; runs "
            + JSON.stringify(dDeep.deep.runs.map((r) => [f0(r.m), r.why])));

// ... and the marks stage judges a deeper way BEFORE the lane pass has to be asked twice: a lone red buoy 60 m east of her
// line with a rock 50 m beyond it (bound north, her proper side is west of it - the buoy between her and the rock), and a
// patch of margin water on her line west of it. The shorter deeper way runs east of the rock - the buoy on her wrong hand.
const LONE = { role: "chan_mark", cls: "Buoy_Lateral_point", props: { CATLAM: 2, OBJNAM: "Lone Ledge Buoy" }, geometry: { type: "Point", coordinates: LLc(60, 0) } };
const LROCK = rock(110, 0), LPATCH = area(5.0, 9.1, -250, -150, 50, 150), lpRing = ringEN(-250, -150, 50, 150);
const judged = (feats) => { const ko = world(feats); onWorld(ko); const leg = R.legPath(A, B, GF, ko, 5), trace = [];
  const df = P.deepFirst([A, ...leg], GF, ko, 5, { trace }); const r = P.planNogoRoute(A, B, {});
  return { df, trace: trace.filter((t) => t.s0 != null), r, v: R.markVerdicts([A, ...r.route], GF, r.marks || []) }; };
const jB = judged([SEA, LPATCH, LONE, LROCK]), jN = judged([SEA, LPATCH, LROCK]);
check("14b. ... AND JUDGES A DEEPER WAY NEAR A MARK BEFORE THE LANE PASS IS ASKED TWICE: past a lone red buoy with a rock 50 m "
      + "beyond it, the deeper way round a patch on her line runs outside the rock - the buoy on her wrong hand; the marks stage, "
      + "run on that piece of route and on the floor's, finds it worse, so it is NOT taken (deepFirst itself refuses it, 'mark') "
      + "and the buoy is kept; the CONTROL, the same water with no buoy, takes it",
      () => jB.trace.length === 1 && jB.trace[0].lenNew != null && jB.trace[0].why === "mark" && jB.df.repaired === 0
            && jB.v.length === 1 && jB.v[0].proper && jB.r.deep.runs.length === 1 && jB.r.deep.runs[0].why === "mark"
            && jN.df.repaired === 1 && metersIn(GF, [A, ...jN.r.route], [lpRing]) === 0,
      () => "with the buoy: " + JSON.stringify(jB.trace.map((t) => [f0(t.lenOld), f0(t.lenNew), t.ok ? "taken" : t.why])) + ", the buoy "
            + (jB.v[0] && jB.v[0].proper ? "kept" : "WRONG") + "; without: repaired " + jN.df.repaired + ", in the patch "
            + f0(metersIn(GF, [A, ...jN.r.route], [lpRing])) + " m");

// ... and MARK BY MARK: from beside Eastern Point (his route), the deeper way past the Dog Bar keeps Eastern Point Ledge 4
// - which the floor's way, starting beside it, leaves wrong - and passes the Dog Bar red on its bar's side: one wrong for
// one wrong, counted. deepFirst refuses it for the red, and the plan leaves the marks as today's does.
const EP = { lat: 42.57659, lon: -70.66486 };
onDog(DOG0);
const epToday = P.planNogoRoute(EP, DTO, O);
onDog(DOG);
const epTrace = [], epFirst = P.deepFirst([EP, ...R.legPath(EP, DTO, DF, DOG, 20)], DF, DOG, 20, { trace: epTrace });
const epDeep = P.planNogoRoute(EP, DTO, O);
const epWin = epTrace.filter((t) => t.s0 != null);
check("14c. ... ONE BUOY AT A TIME, NOT A COUNT: from beside Eastern Point, a deeper way that keeps Eastern Point Ledge 4 (the floor's "
      + "way, starting beside it, does not) and passes the Dog Bar red on its bar's side is one wrong mark for one - and refused, "
      + "'mark', by deepFirst itself; the plan leaves the marks exactly as today's does",
      () => epWin.some((t) => t.lenNew != null && t.why === "mark") && !epToday.error && !epDeep.error
            && wrongOf(verdicts(EP, epDeep)) === wrongOf(verdicts(EP, epToday)) && !/dog bar/.test(wrongOf(verdicts(EP, epDeep))),
      () => "windows " + JSON.stringify(epWin.map((t) => [f0(t.lenOld), f0(t.lenNew), t.ok ? "taken" : t.why])) + "; today wrong ["
            + wrongOf(verdicts(EP, epToday)) + "], deep first [" + wrongOf(verdicts(EP, epDeep)) + "]");

// ... AND ITS WHOLE BERTH (Andy, 2026-10-13: "yes, hold offshore marks to the full 30 m berth"): the same lone buoy and rock,
// her line 18 m west of the buoy, and a band of margin water everything west of 35 m east - every run out to the berth lies
// in it, and her own line never touches it (no stretch, no deeper way). Once round (the REHEARSAL), the layer keeps the marks
// stage from the berth; asked again with the buoy held - the layer lifted about it - she is given it, and the margin water
// that costs is said as the buoy's.
const BAND = area(5.0, 9.1, -3000, -3000, 35, 3000), A2 = gll(42, -1500), B2 = gll(42, 1500);
const bandKo = world([SEA, BAND, LONE, LROCK]);
onWorld(bandKo);
const bPlan = P.planNogoRoute(A2, B2, {});
const bV = R.markVerdicts([A2, ...bPlan.route], GF, bPlan.marks || []);
const bFirst = P.deepFirst([A2, ...R.legPath(A2, B2, GF, bandKo, 5)], GF, bandKo, 5);
const bOnce = P.channelLaneRoute(bFirst.path, GF, bFirst.ko, 5, { marks: true, charted: true });
const bV1 = R.markVerdicts(bOnce.route, GF, bOnce.marks || []);
check("14d. ... AND A BUOY'S WHOLE BERTH: beside a band of margin water her line never touches, the layer kept the marks stage "
      + "from every run out to an offshore buoy's 30 m berth (the REHEARSAL, one lane pass: 18 m off, inside it); asked again with "
      + "the buoy held, she passes it at its berth, and the band's water that costs is said as the buoy's",
      () => !bPlan.error && bV.length === 1 && bV[0].proper && !bV[0].inside && Math.abs(bV[0].x) >= 29 && bPlan.how.marks.offshoreClose === 0
            && bV1.length === 1 && bV1[0].inside && bFirst.bore.length === 0
            && bPlan.deep.runs.length === 1 && bPlan.deep.runs[0].why === "mark" && /for a buoy\)/.test(P.deepNote(bPlan.deep)),
      () => "plan: " + (bV[0] ? f0(bV[0].x) + " m, inside " + bV[0].inside : "none") + "; rehearsal " + (bV1[0] ? f0(bV1[0].x) + " m, inside " + bV1[0].inside : "none")
            + "; runs " + JSON.stringify(bPlan.deep.runs.map((r) => [f0(r.m), r.why])));

// ... and the marks stage judges a deeper way by the berth too, before the lane pass is asked twice: the lone buoy and its
// rock, her line through a patch of margin water that reaches to 30 m east - the shorter deeper way squeezes between the patch
// and the buoy, on its safe side but inside its berth. Refused by deepFirst itself; the CONTROL, the patch to 20 m east, leaves
// a deeper way at the whole berth, and it is taken.
const squeeze = (east) => { const ko = world([SEA, area(5.0, 9.1, -250, -150, east, 150), LONE, LROCK]); onWorld(ko);
  const trace = []; P.deepFirst([A, ...R.legPath(A, B, GF, ko, 5)], GF, ko, 5, { trace });
  const r = P.planNogoRoute(A, B, {}); return { win: trace.filter((t) => t.s0 != null), r, v: R.markVerdicts([A, ...r.route], GF, r.marks || []) }; };
const sq30 = squeeze(30), sq20 = squeeze(20);
check("14e. ... AND BY ITS BERTH: a deeper way that squeezes past a lone buoy on its safe side but inside its berth is refused "
      + "by deepFirst itself ('mark') and the buoy keeps its berth; the CONTROL, with room for the whole berth, is taken",
      () => sq30.win.length === 1 && sq30.win[0].lenNew != null && sq30.win[0].why === "mark" && sq30.v.length === 1 && !sq30.v[0].inside && sq30.v[0].proper
            && sq20.win.length === 1 && sq20.win[0].ok && sq20.v.length === 1 && !sq20.v[0].inside && Math.abs(sq20.v[0].x) >= 29,
      () => "to 30 m: " + JSON.stringify(sq30.win.map((t) => [f0(t.lenOld), f0(t.lenNew), t.ok ? "taken" : t.why])) + ", the buoy " + (sq30.v[0] ? f0(sq30.v[0].x) + " m" : "-")
            + "; to 20 m: " + JSON.stringify(sq20.win.map((t) => [f0(t.lenOld), f0(t.lenNew), t.ok ? "taken" : t.why])) + ", the buoy " + (sq20.v[0] ? f0(sq20.v[0].x) + " m" : "-"));

// ── WHAT IT LEAVES AS IT WAS ──────────────────────────────────────────────────────────────────────────────────────────
onWorld(world([SEA, PATCH]));
const fly = P.planNogoRoute(A, B, { flyThrough: true });
onWorld(world([SEA, PATCH], false));
const fly0 = P.planNogoRoute(A, B, { flyThrough: true });
check("15. A MANEUVER IS LAID AS IT ALWAYS WAS: the way back onto a line (flyThrough) is no passage - no deep water first, the "
      + "same route as without the layer, nothing said",
      () => !fly.error && fly.deep === null && JSON.stringify(fly.route) === JSON.stringify(fly0.route),
      () => "deep " + fly.deep + ", same route " + (JSON.stringify(fly.route) === JSON.stringify(fly0.route)));
const inP = gll(0, 0);
onWorld(world([SEA, PATCH]));
const hp = P.planNogoRoute(A, inP, {});
check("16. THE HOLD POINT STAYS ON THE FLOOR'S MODEL: a Go-To to the middle of the patch holds AT it - margin water is legal "
      + "water, not a keep-out to be held off - and the route's last stretch in it is said 'where she ends'",
      () => !hp.error && !hp.heldOff && Math.hypot(GF.toEN(hp.route[hp.route.length - 1]).e, GF.toEN(hp.route[hp.route.length - 1]).n) < 0.5
            && hp.deep.runs.length === 1 && hp.deep.runs[0].why === "end",
      () => "heldOff " + JSON.stringify(hp.heldOff) + "; ends " + f0(Math.hypot(GF.toEN(hp.route[hp.route.length - 1]).e, GF.toEN(hp.route[hp.route.length - 1]).n))
            + " m from it; runs " + JSON.stringify(hp.deep.runs.map((r) => [f0(r.m), r.why])));
// a survey plan: its approach is a passage, its lines are not
const wps = [gll(0, -1000), gll(0, 1000), gll(400, 1000)];
onWorld(world([SEA, PATCH]));
const rp = P.routePlan(gll(0, -2500), wps, false, 5);
onWorld(world([SEA, PATCH], false));
const rp0 = P.routePlan(gll(0, -2500), wps, false, 5);
const lineIn = (r) => { const i0 = r.route.findIndex((q) => Math.abs(q.lat - wps[0].lat) < 1e-9 && Math.abs(q.lon - wps[0].lon) < 1e-9);
  const i1 = r.route.findIndex((q) => Math.abs(q.lat - wps[1].lat) < 1e-9 && Math.abs(q.lon - wps[1].lon) < 1e-9); return r.route.slice(i0, i1 + 1); };
check("17. A SURVEY'S OWN LINES ARE NOT A PASSAGE: a coverage line through the patch runs through it with the layer as without "
      + "(the line is the survey's geometry); the approach to it is laid deep first",
      () => !rp.unroutable.length && JSON.stringify(lineIn(rp)) === JSON.stringify(lineIn(rp0)) && metersIn(GF, lineIn(rp), [patchRing]) > 290 && rp.deep !== null,
      () => "the line in the patch " + f0(metersIn(GF, lineIn(rp), [patchRing])) + " m, same as without " + (JSON.stringify(lineIn(rp)) === JSON.stringify(lineIn(rp0)))
            + "; deep " + JSON.stringify(rp.deep && { repaired: rp.deep.repaired, runs: rp.deep.runs.length }));

// ── THE ROUTE WORKER ──────────────────────────────────────────────────────────────────────────────────────────────────
const pk = packKo(OAK), back = unpackKo(pk);
const sameRings = (a, b) => a.length === b.length && a.every((q, i) => q.ring.length === b[i].ring.length && q.ring.every((v, j) => v.e === b[i].ring[j].e && v.n === b[i].ring[j].n) && q.kind === b[i].kind);
const nPts = OAK.polys.reduce((s, q) => s + q.ring.length, 0) + OAK.lines.reduce((s, q) => s + q.pts.length, 0) + OAK.margin.polys.reduce((s, q) => s + q.ring.length, 0);
check("18. THE LAYER GOES TO THE WORKER PACKED: its areas' points in the model's one transferred array (not cloned point by "
      + "point), back exactly - every ring, kind, berth and count; the feature count the worker checks the model by counts it",
      () => pk.xy.length === nPts * 2 && !("margin" in pk.rest) && sameRings(back.margin.polys, OAK.margin.polys)
            && JSON.stringify(back.margin.points) === JSON.stringify(OAK.margin.points) && JSON.stringify(back.margin.counts) === JSON.stringify(OAK.margin.counts)
            && koCount(OAK) === koCount(OAK0) + OAK.margin.polys.length + OAK.margin.points.length && koCount(back) === koCount(OAK),
      () => "xy " + pk.xy.length + " numbers for " + nPts + " points; counts " + koCount(OAK0) + " -> " + koCount(OAK));
onOak(OAK);
const page = P.planNogoRoute(NORTH, SOUTH, O);
const rep = routeReply({ id: 1, op: "nogo", args: { from: NORTH, to: SOUTH, opts: O }, ko: { id: "oak", n: koCount(OAK) },
                         models: [{ id: "oak", packed: packKo(OAK) }], keep: [],
                         state: { V: { ...V }, nogo: { ready: true, buffer: 5, bbox: OBOX, unread: null, ais: null }, frameRef: { lat: 42.642, lon: -70.582 } } });
check("19. ... AND THE WORKER PLANS WHAT THE PAGE PLANS: the same route at Oak Rock, deep water first the same",
      () => rep.ok && JSON.stringify(rep.out.route) === JSON.stringify(page.route) && JSON.stringify(rep.out.deep) === JSON.stringify(page.deep),
      () => (rep.ok ? "routes the same " + (JSON.stringify(rep.out.route) === JSON.stringify(page.route)) + ", deep the same "
            + (JSON.stringify(rep.out.deep) === JSON.stringify(page.deep)) : rep.error.slice(0, 200)));

// ── THE WORDS ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const at = { lat: 42.631, lon: -70.5841 };
const dMix = { marginM: 2, berthM: 50, runs: [{ m: 80, why: "start", end: "start", at }, { m: 1247, why: "none", end: null, at }, { m: 93, why: "mark", end: null, at }] };
const dEnds = { marginM: 2, berthM: 50, runs: [{ m: 59, why: "start", end: "start", at }, { m: 508, why: "end", end: "end", at }] };
const dNone = { marginM: 2, berthM: 50, runs: [] };
const fmt = (m) => (m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km");
const wMix = P.deepWhy(dMix, fmt), wEnds = P.deepWhy(dEnds, fmt), wNone = P.deepWhy(dNone, fmt);
check("20. THE WORDS: the banner says nothing of a route that keeps the margin the whole way, and of one that does not, the "
      + "water at her floor and why; the Intent card always says which - a WARNING where a stretch lies between her start and "
      + "her end, with where it is",
      () => P.deepNote(dNone) === "" && P.deepNote(null) === ""
            && P.deepNote(dMix, fmt) === "deep water first: 1.42 km at her floor (where she starts, 1 with no deeper way, 1 for a buoy)"
            && wNone.length === 1 && wNone[0].t === "lane" && /kept 2 m over her floor and 50 m off charted rocks and shoal soundings the whole way/.test(wNone[0].s)
            && wMix[0].t === "warn" && /except 3 stretches at her floor and buffer/.test(wMix[0].s) && /1\.25 km near 42\.6310 N 70\.5841 W - no deeper way/.test(wMix[0].s)
            && /a buoy's proper hand or its berth/.test(wMix[0].s) && wEnds[0].t === "lane" && /where she ends/.test(wEnds[0].s) && P.deepWhy(null).length === 0,
      () => JSON.stringify([P.deepNote(dMix, fmt), wMix[0].t, wEnds[0].t]));
// the page: the three passage banners carry deepNote; the Intent card asks deepWhy of every plan (DRIVEN, below); both
// models the planner is handed carry the layer, the section's at its own water
const banners = (H.match(/offshoreNote\(plan\.how\), deepNote\(plan\.deep, fmtDist\), mooredNote\(plan\)\]/g) || []).length;
const grabFn = (name) => { const st = H.indexOf("function " + name + "("); let k = H.indexOf("{", st), dp = 0;
  for (;;) { const c = H[k]; if (c === "{") dp++; else if (c === "}") { dp--; if (!dp) break; } k++; } return H.slice(st, k + 1); };
const RB = grabFn("rebuildNogo");
const w = { calls: [] };
// eslint-disable-next-line no-new-func
const modelAt = new Function("w", ["const nogo = {frame: 'F', enf: 'E', features: ['f']}, sea = {enc: {features: []}}, nogoDR = () => ({min: 4, max: 0});",
  "const buildKeepouts = (frame, enf, dr, feats, m) => ({builtAt: m, polys: ['p']});",
  "const buildMargin = (frame, enf, dr, feats, m, ko) => { w.calls.push({m, ko, feats}); return {at: m}; };",
  "const foldChartInk = () => {};", grabFn("nogoModelAt"), "return nogoModelAt;"].join("\n"))(w);
const kAt = modelAt(0.7);
// setPlanIntent itself, driven with the real deepWhy
const SPI = new Function("deepWhy", "fmtDist", ["let planGen = 0, planIntent = null, guardOverride, edgeSpentM, edgeCount, guardActedAt, holdWant, edgeSearchAt;",
  "const arrivalSay = () => null, offshoreWhy = () => [], wptRole = () => '';", grabFn("setPlanIntent"), "return setPlanIntent;"].join("\n"))(P.deepWhy, fmt);
const piDeep = SPI("goto", { routed: true, lane: false, deep: dMix }, [at, at]), piNone = SPI("goto", { routed: true, lane: false }, [at, at]);
check("21. THE PAGE: the Go-To, RTH and transit banners carry deepNote; the Intent card says deepWhy's line of every plan that "
      + "carries one (setPlanIntent DRIVEN) and nothing of one that does not; rebuildNogo hangs the layer on the chart's model, "
      + "built against it; and a passage section's model (nogoModelAt) carries one built at the section's own water",
      () => banners === 3 && piDeep.why.some((x) => x.t === "warn" && /^deep water first: kept 2 m/.test(x.s)) && !piNone.why.some((x) => /deep water first/.test(x.s))
            && /nogo\.ko\.margin = buildMargin\(nogo\.frame, nogo\.enf, nogoDR\(\), feats, undefined, nogo\.ko\);/.test(RB)
            && RB.indexOf("nogo.ko.margin = buildMargin(") > RB.indexOf("nogo.ko = buildKeepouts(")
            && kAt.margin && kAt.margin.at === 0.7 && w.calls.length === 1 && w.calls[0].m === 0.7 && w.calls[0].ko === kAt,
      () => "banners " + banners + "; card " + JSON.stringify(piDeep.why.filter((x) => /deep/.test(x.s)).map((x) => x.t)) + "; section model "
            + JSON.stringify(kAt.margin));

// the guard, the punch and the hold disc read `margin` nowhere
const GUARDED = ["guard.js", "hold.js", "home_field.js", "home_field_worker.js"].map((f) => [f, fs.readFileSync(JS(f), "utf8")]);
check("22. THE GUARD NEVER SEES IT: nothing the clearance guard, the hold disc or the home field reads names the layer (`margin` "
      + "or `deep` on a model) - check 4 is what a model carrying it answers them",
      () => GUARDED.every(([, s]) => !/\.margin\b|\.deep\b/.test(s)),
      () => GUARDED.filter(([, s]) => /\.margin\b|\.deep\b/.test(s)).map(([f]) => f).join(", ") || "none");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
