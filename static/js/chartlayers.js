// static/js/chartlayers.js - THE CHART'S THREE CACHED LAYERS, DRAWN: the ENC (drawENC), the keep-out zones (drawNogo) and the
// states' shore-distance bands (drawLawBands), with the helpers they draw by (featureBox, layerSees, tracePx).
//
// ⚠ MOVED HERE FROM static/asv.html (2026-10-17, Andy: "implement 4 and 5" of the performance review; for item 4 he chose
// "Same drawing, off the page"). Measured, a redraw of these layers - on every zoom, and every time the view following the
// boat leaves the drawn margin - cost the page's only thread 30-80 ms a layer at New Castle (an 1100 x 800 view: one frame
// of 96-197 ms a zoom), with the clearance guard waiting behind it. So the chart worker (skin_worker.js) draws them, on an OffscreenCanvas, from its own
// copy of the extract, and the page blits the bitmap it sends; with no worker, or no copy of the extract in it, the page
// draws them itself exactly as before. ONE COPY OF THE DRAWING for both, moved verbatim but for what it read off the page:
// that comes in `D`, the state each caller gathers (the page's drawENC / drawNogo / drawLawBands wrappers, and the
// worker's request), so the two cannot draw from different rules. The layer CACHE (makeLayer / layerHolds / drawLayer /
// drawLayerOff) stays on the page, which owns the view.
import { M_PER_DEG_LAT } from "./geodesy.js";
import { eachRing, eachPath, eachPoint } from "./geometry.js";
import { overheadBlocks } from "./keepouts.js";

/** The margin a cached layer is drawn with round the view, in pixels (see the page's drawLayer). */
export const LAYER_PAD_PX = 256;
/** The shore band is not drawn where it is narrower than this across (drawLawBands). */
export const LAW_BAND_MIN_PX = 3;

// ⚠ A LAYER DRAWS ONLY WHAT IT SHOWS, AND NO FINER THAN A PIXEL (2026-10-14, the zoom stalls). Andy: "increase that limit.
// its causing problems. investigate ramifications". His session at 15:48 held 14,534 keep-out zones from a 1.34 x 0.47
// degree read - 54,091 chart features and 3.36 million vertices in the box - and every zoom change redrew both layers
// whole: every feature of the box projected and traced, on the page's only thread, whether it was on the canvas or not,
// and whatever number of its vertices fell on one pixel. The page stopped for 1.6 to 12.9 s at each, the longest at
// the widest zooms, and the guard was blind while it did (TELEMETRY STALE). A wider read cap makes the box, and so the
// stall, bigger. So: a feature whose box is off the layer's canvas is not traced (layerSees), a vertex within 0.7 px of
// the last one traced is not traced (tracePx: the ring's or path's last vertex always is), and a line or area smaller
// than half a pixel both ways is not drawn. THE PICTURE ONLY: the keep-out model, the planners and the guard read the
// features themselves, never this.
const featBox = new WeakMap();
export function featureBox(f){
  let b = featBox.get(f);
  if(b) return b;
  let W = Infinity, S = Infinity, E = -Infinity, N = -Infinity;
  const walk = (c) => { if(typeof c[0] === "number"){ if(c[0] < W) W = c[0]; if(c[0] > E) E = c[0]; if(c[1] < S) S = c[1]; if(c[1] > N) N = c[1]; return; }
                        for(const x of c) walk(x); };
  if(f.geometry && f.geometry.coordinates && f.geometry.coordinates.length) walk(f.geometry.coordinates);
  b = {W, S, E, N};
  featBox.set(f, b);
  return b;
}
export function layerSees(ctx, toScreen){
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  return (f, margin = 2, tiny = false) => {
    const b = featureBox(f);
    if(!(b.W <= b.E && b.S <= b.N)) return false;
    const a = toScreen(b.N, b.W), c = toScreen(b.S, b.E);
    const x0 = Math.min(a.x, c.x), x1 = Math.max(a.x, c.x), y0 = Math.min(a.y, c.y), y1 = Math.max(a.y, c.y);
    if(x1 < -margin || y1 < -margin || x0 > cw + margin || y0 > ch + margin) return false;
    return tiny || x1 - x0 >= 0.5 || y1 - y0 >= 0.5;
  };
}
export function tracePx(ctx, toScreen, pts){
  const n = pts.length;
  let lx = 0, ly = 0;
  for(let i = 0; i < n; i++){
    const c = pts[i], q = toScreen(c[1], c[0]);
    if(i === 0){ ctx.moveTo(q.x, q.y); lx = q.x; ly = q.y; continue; }
    if(i < n - 1 && Math.abs(q.x - lx) < 0.7 && Math.abs(q.y - ly) < 0.7) continue;
    ctx.lineTo(q.x, q.y); lx = q.x; ly = q.y;
  }
}

/** THE ENC LAYER. `D`: {features (the extract's), wreckOff (Shipwrecks unchecked), hazExtent (chart.js's)}. */
export function drawENC(toScreen, ctx, D){
  const feats = (D && D.features) || [];
  if(!feats.length) return;
  ctx.save();
  const sees = layerSees(ctx, toScreen);            // only what this layer shows, no finer than a pixel (above)
  const fillPoly=(g,fill,stroke)=>{ ctx.beginPath(); let any=false;
    eachRing(g,r=>{ any=true; tracePx(ctx, toScreen, r); ctx.closePath(); });
    if(!any) return; ctx.fillStyle=fill; ctx.fill("evenodd");
    if(stroke){ ctx.strokeStyle=stroke; ctx.lineWidth=1; ctx.stroke(); } };
  const strokePath=(g,stroke,w,dash)=>{ ctx.setLineDash(dash||[]); ctx.strokeStyle=stroke; ctx.lineWidth=w;
    eachPath(g,p=>{ ctx.beginPath(); tracePx(ctx, toScreen, p); ctx.stroke(); });
    ctx.setLineDash([]); };
  // fills: land / docks / informational areas. Shallow-water (depth) shading is
  // owned SOLELY by the NOGO layer (drawNogo) - the single depth-shading layer.
  // A coarser chart's piece (`clip`, the layered extract) is filled with NO outline: its edge along the cut is not a
  // coast, and the coast is drawn from the shoreline's own lines.
  for(const f of feats){ const g=f.geometry, r=f.role, cut=!!f.clip;
    if((r==="land"||r==="dock"||r==="hazard_area"||r==="dredged"||r==="restricted") && !sees(f)) continue;
    if(r==="land") fillPoly(g,"rgba(120,96,58,0.38)",cut?null:"rgba(150,120,70,0.7)");
    else if(r==="dock"||r==="hazard_area") fillPoly(g,"rgba(200,120,40,0.30)",cut?null:"rgba(210,140,60,0.85)");
    else if(r==="dredged"||r==="restricted") fillPoly(g,"rgba(90,140,190,0.10)",null); }
  // lines
  for(const f of feats){ const g=f.geometry, r=f.role;
    if((r==="shore_line"||r==="dock_line"||r==="depth_contour"||r==="dredged"||r==="restricted") && !sees(f)) continue;
    if(r==="shore_line") strokePath(g,"rgba(185,150,90,0.95)",1.6,[]);
    else if(r==="dock_line") strokePath(g,"rgba(210,140,60,0.95)",1.6,[]);
    else if(r==="depth_contour") strokePath(g,"rgba(95,145,195,0.55)",1,[3,3]);
    else if(r==="dredged"||r==="restricted") strokePath(g,"rgba(110,160,205,0.7)",1.2,[5,4]); }
  // points
  for(const f of feats){ const g=f.geometry, r=f.role;
    // a point: off the canvas by more than a sized hazard's circle could reach (LAYER_PAD_PX), or a sounding's dot
    if(r==="sounding" ? !sees(f, 2, true) : (r==="hazard_point"||r==="land_point") && !sees(f, LAYER_PAD_PX, true)) continue;
    if(r==="hazard_point"||r==="land_point") eachPoint(g,c=>{ const s=toScreen(c[1],c[0]);
      // A sized hazard (wreck / obstruction of unknown extent) draws the circle the
      // router actually keeps out of. Without it the operator sees a route swing wide
      // for no visible reason - and, worse, would read a bare cross as the whole danger.
      // A wreck the operator DISREGARDS (Shipwrecks unchecked) keeps its cross, which is the chart, and loses the
      // circle, which is the keep-out: nothing keeps out of it any more, so drawing one would say the opposite.
      const hr=(f.cls==="Wreck_point" && D.wreckOff) ? 0 : D.hazExtent(f);
      if(hr>0){ const s2=toScreen(c[1]+hr/M_PER_DEG_LAT, c[0]);
        const rpx=Math.abs(s2.y-s.y);
        if(rpx>2){ ctx.strokeStyle="rgba(217,83,79,0.55)"; ctx.lineWidth=1.2; ctx.setLineDash([4,3]);
          ctx.beginPath(); ctx.arc(s.x,s.y,rpx,0,2*Math.PI); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle="rgba(217,83,79,0.10)"; ctx.fill(); } }
      ctx.strokeStyle="#d9534f"; ctx.lineWidth=1.6; ctx.beginPath();
      ctx.moveTo(s.x-4,s.y-4); ctx.lineTo(s.x+4,s.y+4); ctx.moveTo(s.x+4,s.y-4); ctx.lineTo(s.x-4,s.y+4); ctx.stroke(); });
    else if(r==="sounding") eachPoint(g,c=>{ const s=toScreen(c[1],c[0]);
      ctx.fillStyle="rgba(139,160,173,0.5)"; ctx.beginPath(); ctx.arc(s.x,s.y,1.1,0,2*Math.PI); ctx.fill(); }); }
  ctx.restore();
}

// ⚠ THE OVERLAY'S SYMBOLOGY (2026-10-19; Andy: "the nogo key reveals user interpretation limits with the current color
// pattern versus the ENC. Try changing NOGO imposed bounded areas and speed limited areas with hatched lines or brighter
// colors or both. Review visualization research for maximized user interpretation."). What the operator must tell apart at
// a glance: the CHART'S OWN features (the ENC layer: land tan, docks orange, water white, depth contours blue) from what the
// CONSOLE IMPOSES on them - the keep-outs it refuses to route through, and the water a speed rule holds her slow in. Until
// now both impositions were flat translucent washes (a 20 percent red over the chart's own tan land read as mud; the speed
// rules' amber was the survey window's amber too), and the key had no row for speed-limited water at all. The design, and
// what it rests on:
//   TEXTURE FOR THE IMPOSITION, HUE FOR THE CHART. Bertin's visual variables (Semiology of Graphics): a thematic overlay
//   should use a variable the base map does not - texture (a hatch) stays legible over any fill under it, where a second
//   wash merely muddies the first. The chart's fills keep their hues; the console's rules are HATCHED.
//   ORIENTATION TELLS THE TWO RULES APART BEFORE COLOR DOES. Orientation and color are separable pre-attentive features
//   (Treisman and Gelade's feature-integration theory; Ware, Information Visualization: Perception for Design, on texture
//   segmentation by orientation): the keep-outs' hatch runs at 45 degrees, the speed rules' at 135 - an operator who cannot
//   tell red from amber (a tenth of men) still reads two different textures, and a keep-out inside a speed band reads as a
//   cross-hatch, both rules at once.
//   THE HATCH LINES CARRY LUMINANCE, NOT JUST HUE. Fine lines need luminance contrast against their ground to be seen
//   (Ware: the chromatic channels are blind to detail); the lines are near-opaque, 1.3 px, 7 px apart - a period a chart
//   reader resolves as texture at arm's length - over a faint wash of the same hue, so the region still reads as a region.
//   THE COLORS ARE THE ONES CHART USERS ALREADY HOLD. Red for what she must not enter (the safety color of ISO 3864 and the
//   S-52 ENC presentation's danger), amber for caution - a rule that slows her, not one that stops her. IHO S-52 itself draws
//   a regulated area as a hatched, bounded region, so a hatch is what a mariner already reads as "an area with a rule".
//   The survey window, a planning aid and not a rule, leaves the amber it shared with the speed rules for a teal wash.
//   OVERLAPS, BY RANK. The ENC layer is drawn first, the speed rules over it, the keep-outs over those: where both rules
//   apply the cross-hatch shows both, and a keep-out's edge is never hidden by a band.
// Every color the overlays draw is in INK, the key names every one of them, and tests/nogo_key.js holds the two together:
// drawNogo and drawLawBands may use no color but INK's.
export const INK = {
  keepFill: "rgba(217,83,79,0.10)", keepHatch: "rgba(217,83,79,0.95)", keepEdge: "rgba(217,83,79,0.85)",
  speedFill: "rgba(232,180,106,0.10)", speedHatch: "rgba(232,180,106,0.95)",
  speedEdge: "#e8b46a",                              // a zone's dashed outline; the solid line AT a shore rule's distance
  zoneOffFill: "rgba(160,170,180,0.05)", zoneOffEdge: "rgba(160,170,180,0.6)",   // a charted zone this hull is not bound by
  surveyFill: "rgba(70,150,170,0.22)",
  unreadFill: "rgba(128,128,128,0.22)", failedFill: "rgba(150,150,150,0.30)", failedEdge: "rgba(200,200,200,0.8)",
  gapEdge: "rgba(255,150,30,0.95)",
  inkFill: "rgba(224,64,208,0.28)", inkEdge: "rgba(224,64,208,0.95)",
  mask: "#000",                                      // drawLawBands' state mask, composited away: never on screen
};
/** The two hatches: the keep-outs' runs at 45 degrees, the speed rules' at 135; lines `widthPx` wide, `spacingPx` apart. */
export const HATCH = {keep: 45, speed: 135, spacingPx: 7, widthPx: 1.3};

const hatchTiles = new WeakMap();                    // ctx -> {key: CanvasPattern}
/** A hatch pattern for `ctx`: `color` lines at `deg` (45 or 135). The tile is an OffscreenCanvas (the worker, or the page)
 *  or a page canvas; where neither can be made, or `ctx` cannot take a pattern (the suites' recording contexts), the color
 *  itself - the fill then reads as a wash, the drawing's calls unchanged. Cached per context. */
export function hatch(ctx, color, deg){
  if(!ctx || typeof ctx.createPattern !== "function") return color;
  let m = hatchTiles.get(ctx);
  if(!m){ m = {}; hatchTiles.set(ctx, m); }
  const key = color + "|" + deg;
  if(m[key]) return m[key];
  const S = Math.round(HATCH.spacingPx * Math.SQRT2);  // a square tile: a diagonal every S along each axis is a line every spacingPx across
  let tile = null;
  if(typeof OffscreenCanvas !== "undefined") tile = new OffscreenCanvas(S, S);
  else if(typeof document !== "undefined"){ tile = document.createElement("canvas"); tile.width = S; tile.height = S; }
  if(!tile) return color;
  const t = tile.getContext("2d");
  t.strokeStyle = color; t.lineWidth = HATCH.widthPx; t.lineCap = "square";
  t.beginPath();
  if(deg === 45){                                    // bottom-left to top-right, and the two corner pieces that make the tiling seamless
    t.moveTo(-1, S + 1); t.lineTo(S + 1, -1);
    t.moveTo(-1, 1); t.lineTo(1, -1);
    t.moveTo(S - 1, S + 1); t.lineTo(S + 1, S - 1);
  } else {                                           // top-left to bottom-right
    t.moveTo(-1, -1); t.lineTo(S + 1, S + 1);
    t.moveTo(S - 1, -1); t.lineTo(S + 1, 1);
    t.moveTo(-1, S - 1); t.lineTo(1, S + 1);
  }
  t.stroke();
  m[key] = ctx.createPattern(tile, "repeat") || color;
  return m[key];
}

/** THE NOGO KEY (Andy, 2026-10-18: "Need a NOGO key so the user knows what color is representing what component."): what
 *  the overlays draw, one row each, in INK's own colors. The page builds the key from this (nogoKeyBuild); tests/nogo_key.js
 *  holds INK, the drawing and the key together. `kind`: hatch (a wash `fill`, `hatch` lines at `deg`, `edge` its outline),
 *  area (a fill, `edge` its outline), line, dash (a dashed outline, `fill` under it), ink (a footprint and a line with a tick
 *  at each end). `{floor}` in a label is the depth floor, filled in by the page. */
export const NOGO_KEY = [
  {kind: "hatch", fill: INK.keepFill, hatch: INK.keepHatch, deg: HATCH.keep, edge: INK.keepEdge,
   label: "Keep-out: land, docks, hazards, bridges and spans too low for her, and water shallower than {floor}"},
  {kind: "line", stroke: INK.keepEdge, width: 1.4, label: "Keep-out edge: shoreline, piers, hazard lines, cables too low"},
  {kind: "hatch", fill: INK.speedFill, hatch: INK.speedHatch, deg: HATCH.speed, edge: INK.speedEdge,
   label: "Speed-limited water: a state's shore rule (its line at the rule's distance) or a charted zone - she is held to the law's limit in it"},
  {kind: "dash", fill: INK.zoneOffFill, stroke: INK.zoneOffEdge, width: 1.3, dash: "6 4",
   label: "A charted speed zone that does not bind this hull"},
  {kind: "area", fill: INK.surveyFill, label: "Outside the survey's depth window (while a survey is drawn)"},
  {kind: "area", fill: INK.unreadFill, label: "No chart here: a route through it is refused"},
  {kind: "dash", fill: INK.failedFill, stroke: INK.failedEdge, width: 1, dash: "4 3",
   label: "Chart could not be read: reading it again may chart it"},
  {kind: "dash", stroke: INK.gapEdge, width: 2, dash: "5 3",
   label: "A gap in the charted seabed, kept out as a structure: check the chart"},
  {kind: "ink", fill: INK.inkFill, stroke: INK.inkEdge,
   label: "Read off the chart's picture, not NOAA's data: check the chart"},
];

/** THE KEEP-OUT LAYER. `D`: {show, ready, features (the model's: the extract's and the seabed's gaps), enf, floorDr, surveyDr,
 *  hasPat, airNeed, depthExcluded (chart.js's), unreadAll (the extract's and the corridor's squares), chartInk {lines, areas}}. */
export function drawNogo(toScreen, ctx, D){
  if(!D || !D.show || !D.ready || !D.features) return;
  const floorDr=D.floorDr;                         // < 1 m corrected -> nogo
  const surveyDr=D.surveyDr;                       // survey coverage window (panel)
  const hasPat=!!D.hasPat;                         // amber tier only while planning a survey
  const enf = D.enf || {}, chartInk = D.chartInk || {lines: [], areas: []};
  ctx.save();
  const sees = layerSees(ctx, toScreen);            // only what this layer shows, no finer than a pixel (drawLayer's note)
  // the rings traced ONCE (tracing is the cost: 3.36 million vertices in a wide read) and filled with each color in turn -
  // a fill leaves the path standing
  const fill=(g,...cs)=>{ ctx.beginPath(); let any=false;
    eachRing(g,r=>{ any=true; tracePx(ctx, toScreen, r); ctx.closePath(); });
    if(any) for(const c of cs){ ctx.fillStyle=c; ctx.fill("evenodd"); } };
  // a keep-out: the faint wash, then the 45-degree hatch over it (the symbology note at INK)
  const keep=(g)=>fill(g, INK.keepFill, hatch(ctx, INK.keepHatch, HATCH.keep));
  // WHAT IS OVERHEAD AND TOO LOW FOR HER (2026-10-12) is a keep-out like a pier, drawn as one: the span's water filled,
  // a cable stroked - the same test the model takes it by (overheadBlocks at airNeedM), so the drawing cannot disagree.
  const airNeed = D.airNeed;
  const lowOver = f => (f.role==="bridge_span"||f.role==="overhead") && overheadBlocks(f, airNeed);
  for(const f of D.features){ const r=f.role, g=f.geometry;
    if(!sees(f)) continue;
    // A wreck AREA the operator disregards (Shipwrecks unchecked) is not a keep-out, so it is not drawn as one.
    if(f.cls==="Wreck_area" && enf.wreck===false) continue;
    if(enf.land && (r==="land"||r==="dock"||r==="hazard_area"||r==="bridge"||lowOver(f))){ keep(g); continue; }
    // The seabed's other Group 1 objects (2026-10-12): a dredged channel by its maintained depth, unsurveyed water always.
    if(r==="depth_area"||r==="dredged"||r==="unsurveyed"){
      if(enf.depth && D.depthExcluded(f,floorDr)) keep(g);                                      // hard nogo (red hatch)
      else if(hasPat && D.depthExcluded(f,surveyDr)) fill(g, INK.surveyFill); }                 // outside survey window (teal)
  }
  ctx.strokeStyle=INK.keepEdge; ctx.lineWidth=1.4;
  for(const f of D.features){ const r=f.role;
    if(enf.land && (r==="shore_line"||r==="dock_line"||r==="hazard_line"||r==="land_line"||lowOver(f)) && sees(f))
      eachPath(f.geometry,p=>{ ctx.beginPath(); tracePx(ctx, toScreen, p); ctx.stroke(); }); }
  // ⚠ WATER NO CHART COVERS IS DRAWN GRAY (2026-10-11, the layered chart): the model holds nothing there, and a route
  // through it is refused - the operator sees where before planning. A square whose chart could not be READ is
  // outlined as well: reading it again may chart it.
  const unreadAll = D.unreadAll || [];              // the extract's and the corridor's (step 3), the caller's to gather
  if(unreadAll.length){
    ctx.save();
    for(const r of unreadAll){
      const a=toScreen(r.N,r.W), c=toScreen(r.S,r.E);
      ctx.fillStyle=r.failed?INK.failedFill:INK.unreadFill;
      ctx.fillRect(a.x,a.y,c.x-a.x,c.y-a.y);
      if(r.failed){ ctx.strokeStyle=INK.failedEdge; ctx.lineWidth=1; ctx.setLineDash([4,3]);
        ctx.strokeRect(a.x,a.y,c.x-a.x,c.y-a.y); ctx.setLineDash([]); }
    }
    ctx.restore();
  }
  // ⚠ THE SEABED'S GAPS ARE OUTLINED IN THEIR OWN COLOR (2026-09-30). They are filled like every structure, because
  // that is what they are to the router; but no NOAA layer served them - the console read them off the depth areas'
  // own holes - and the operator must be able to see which floats those are and look at the chart to check them.
  if(enf.land){
    ctx.save(); ctx.strokeStyle=INK.gapEdge; ctx.lineWidth=2; ctx.setLineDash([5,3]);
    for(const f of D.features){ if(f.derived!=="skin_gap") continue;
      eachRing(f.geometry,r=>{ ctx.beginPath(); r.forEach((p,i)=>{ const s=toScreen(p[1],p[0]); i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y); }); ctx.closePath(); ctx.stroke(); }); }
    ctx.restore();
  }
  // ⚠ WHAT WAS READ OFF THE CHART IS DRAWN DIFFERENTLY, AND THAT IS NOT DECORATION. These
  // are keep-outs the console inferred from a PICTURE; every other line here is published
  // vector data. Drawing them in the ENC's own red would tell the operator the console has a
  // warrant it does not have - and the one thing they must be able to do is look at the
  // chart and disagree. Magenta, heavier, with a tick at each end so a 10 m mark is visible
  // at a zoom where 10 m is ten pixels.
  // The FOOTPRINTS first, so the lines draw over them rather than under.
  if(enf.land && chartInk.areas && chartInk.areas.length){
    ctx.fillStyle=INK.inkFill; ctx.strokeStyle=INK.inkEdge;
    ctx.lineWidth=2;
    for(const A of chartInk.areas){
      if(!A.ring || A.ring.length < 3) continue;
      ctx.beginPath();
      A.ring.forEach((q,i)=>{ const sc=toScreen(q.lat,q.lon); i?ctx.lineTo(sc.x,sc.y):ctx.moveTo(sc.x,sc.y); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  if(enf.land && chartInk.lines && chartInk.lines.length){
    ctx.strokeStyle=INK.inkEdge; ctx.lineWidth=3.2; ctx.lineCap="round";
    for(const L of chartInk.lines){
      const a=toScreen(L.a.lat,L.a.lon), b=toScreen(L.b.lat,L.b.lon);
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1, tx=-dy/len*5, ty=dx/len*5;
      ctx.beginPath(); ctx.moveTo(a.x+tx,a.y+ty); ctx.lineTo(a.x-tx,a.y-ty);
      ctx.moveTo(b.x+tx,b.y+ty); ctx.lineTo(b.x-tx,b.y-ty); ctx.stroke();
    }
  }
  ctx.restore();
}

/** THE STATES' SHORE BANDS. `zs` the law zones (speedzones.js lawZones, with a law); `D`: {features, scratch (a canvas the
 *  size of `lctx`'s, or larger - it is resized)}. */
export function drawLawBands(zs, toScreen, lctx, D){
  const cw = lctx.canvas.width, ch = lctx.canvas.height;
  const lawScratch = D.scratch;                     // the caller's: a page canvas, or the worker's OffscreenCanvas
  if(lawScratch.width !== cw || lawScratch.height !== ch){ lawScratch.width = cw; lawScratch.height = ch; }
  const sx = lawScratch.getContext("2d"), sees = layerSees(lctx, toScreen);
  const feats = (D && D.features) || [], land = feats.filter(f => f.role === "land");
  for(const z of zs){
    const fr = z.law.frame, scr = (p) => { const ll = fr.fromEN(p.e, p.n); return toScreen(ll.lat, ll.lon); };
    const a = scr({e: 0, n: 0}), b = scr({e: 100, n: 0}), pxPerM = Math.hypot(b.x - a.x, b.y - a.y) / 100;
    const band = 2 * z.law.within * pxPerM, tol = Math.max(0.7, band / 16);
    if(band < LAW_BAND_MIN_PX) continue;
    const rings = (rs) => { sx.beginPath(); for(const r of rs){ r.ring.forEach((p, i) => { const s = scr(p); i ? sx.lineTo(s.x, s.y) : sx.moveTo(s.x, s.y); }); sx.closePath(); } };
    sx.globalCompositeOperation = "source-over"; sx.clearRect(0, 0, cw, ch);
    sx.beginPath();
    const trace = (pts) => {
      let lx = 0, ly = 0;
      for(let i = 0; i < pts.length; i++){
        const q = toScreen(pts[i][1], pts[i][0]);
        if(i === 0){ sx.moveTo(q.x, q.y); lx = q.x; ly = q.y; continue; }
        if(i < pts.length - 1 && Math.abs(q.x - lx) < tol && Math.abs(q.y - ly) < tol) continue;
        sx.lineTo(q.x, q.y); lx = q.x; ly = q.y;
      }
    };
    const takes = typeof z.law.pick === "function" ? z.law.pick : (x) => z.law.pick.includes(x.role);   // its roles, or its test
    const areas = [];
    for(const f of feats){
      if(!takes(f) || !sees(f, band, true)) continue;
      if(z.law.areas && /Polygon/.test(f.geometry.type)) areas.push(f);   // a marina's own water (Massachusetts): in it is in the rule
      eachRing(f.geometry, trace); eachPath(f.geometry, trace);
      eachPoint(f.geometry, (c) => { const q = toScreen(c[1], c[0]); sx.moveTo(q.x, q.y); sx.lineTo(q.x + 0.01, q.y); });
    }
    // the band 3 px wider than the rule's, solid; then the rule's own width cleared and laid again as a faint wash with
    // the 135-degree hatch over it (the symbology note at INK; 2026-10-19 - it was a 45 percent tint, the survey window's
    // amber too) - which leaves a solid edge line AT the rule's distance (measured live: a tint alone did not show on the
    // chart's white water)
    sx.lineCap = "round"; sx.lineJoin = "round"; sx.strokeStyle = INK.speedEdge;
    sx.lineWidth = band + 3; sx.stroke();
    sx.globalCompositeOperation = "destination-out";
    sx.globalAlpha = 1; sx.lineWidth = band; sx.stroke();
    sx.globalCompositeOperation = "source-over";
    sx.strokeStyle = INK.speedFill; sx.stroke();
    sx.strokeStyle = hatch(sx, INK.speedHatch, HATCH.speed); sx.stroke();
    sx.globalCompositeOperation = "destination-out";
    if(areas.length){                               // the areas themselves: the wash and the hatch
      sx.globalCompositeOperation = "source-over";
      for(const f of areas){
        sx.beginPath(); eachRing(f.geometry, (rg) => tracePx(sx, toScreen, rg));
        sx.fillStyle = INK.speedFill; sx.fill("evenodd");
        sx.fillStyle = hatch(sx, INK.speedHatch, HATCH.speed); sx.fill("evenodd");
      }
      sx.globalCompositeOperation = "destination-out";
    }
    if(z.law.exempt && z.law.exempt.length){ rings(z.law.exempt); sx.fill(); }
    for(const f of land){                           // each its own fill, so a lake in it stays and two that overlap still cut
      if(!sees(f, 2, true)) continue;
      sx.beginPath();
      eachRing(f.geometry, (rg) => tracePx(sx, toScreen, rg));
      sx.fill("evenodd");
    }
    // the state's own waters only: the mask LAST (destination-in), after the band is drawn whole - it was a source-in mask
    // laid first, which the wash and hatch (source-over strokes) would have spilled past
    if(z.law.state){ sx.globalCompositeOperation = "destination-in"; rings(z.law.state); sx.fillStyle = INK.mask; sx.fill(); }
    sx.globalCompositeOperation = "source-over";
    lctx.save(); lctx.globalAlpha = 0.8; lctx.drawImage(lawScratch, 0, 0); lctx.restore();
  }
}
