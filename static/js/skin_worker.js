// static/js/skin_worker.js - THE CHART WORKER: the seabed's gaps (skin.js skinOverHarbour), and the chart's three cached
// layers drawn (chartlayers.js), OFF the page's thread.
//
// ⚠ THE SEABED WALK (2026-10-17, Andy: "implement 1 through 3" of the performance review): the walk over every seabed
// edge of a chart extract took 266 ms (a 16 MB New Castle extract) to 528 ms (a Go-To's 20 MB re-read) of the page's only
// thread - measured, the largest single piece of a keep-out model's arrival - and its answer is a handful of gaps. The
// page (asv.html fetchENCBbox) hands this the extract's own bytes as they arrive, TRANSFERRED, not copied, and parses its
// own text meanwhile; this parses its copy and walks it with the one skinOverHarbour both sides import. The answer carries
// the extract's feature count, and the page walks it itself when there is no answer, an error, or a count that is not the
// extract it holds (skinOffThread).
//
// ⚠ AND THE LAYERS (2026-10-17, "implement 4 and 5"; for item 4 he chose "Same drawing, off the page"): a redraw of the
// ENC, keep-out and shore-band layers - every zoom, and every time the view following her leaves the drawn margin - cost
// the page 30-80 ms a layer (New Castle, an 1100 x 800 view: one frame of 96-197 ms a zoom). The extract parsed above is KEPT (the last EXTRACTS_KEPT, the one drawn from most recently
// kept longest), and the page asks for a layer by the extract's id, the view and the layer's state; this draws it with
// chartlayers.js's own drawing on an OffscreenCanvas and sends the bitmap back, transferred. The keep-out layer's features
// are the extract's and its seabed gaps' (skinGapFeature over the walk above - the page's model is built from the same
// two, in that order). What the drawing reads off the shared state - the vessel's V and the tide - comes with each
// request. A layer that cannot be drawn here answers why, and the page draws it itself (drawLayerOff).
import { skinOverHarbour, skinGapFeature } from "./skin.js";
import { drawENC, drawNogo, drawLawBands } from "./chartlayers.js";
import { worldPx } from "./geodesy.js";
import { V, sea } from "./state.js";
import { hazExtent, depthExcluded } from "./chart.js";
import { lawZones, noaaZones } from "./speedzones.js";

const EXTRACTS_KEPT = 2;
const extracts = new Map();              // id -> {features, skin, nogo (lazy), zs (lazy)}, the most recently used last
let scratch = null;                      // the shore bands' scratch canvas (drawLawBands)

function keep(id, ex) {
  extracts.delete(id);
  extracts.set(id, ex);
  while (extracts.size > EXTRACTS_KEPT) extracts.delete(extracts.keys().next().value);
}
// the keep-out model's features: the extract's, then its seabed gaps' - refreshNogo's order
const nogoFeatures = (ex) => ex.nogo || (ex.nogo = ex.features.concat(((ex.skin && ex.skin.gaps) || []).map(skinGapFeature)));
// the law zones with a shore rule, as the page's drawLawBandsCached takes them from speedZonesNow
const lawOf = (ex) => ex.zs || (ex.zs = [...ex.features.filter((x) => x.role === "speed_zone"), ...noaaZones(ex.features),
  ...lawZones(ex.features)].filter((z) => z.law && z.law.within > 0 && z.law.pick));

function draw(m) {
  const t0 = Date.now();
  try {
    const ex = extracts.get(m.encId);
    if (!ex) throw new Error("the chart worker holds no extract " + m.encId);
    keep(m.encId, ex);                   // drawn from: kept longest
    Object.assign(V, m.V || {});
    sea.waterOffset = m.waterOffset || 0;
    const v = m.view, cv = new OffscreenCanvas(v.W, v.H), ctx = cv.getContext("2d");
    const toScreen = (lat, lon) => { const p = worldPx(lat, lon, v.zoom); return { x: p.x - v.ox, y: p.y - v.oy }; };
    const D = m.D || {};
    if (m.layer === "enc") drawENC(toScreen, ctx, { ...D, features: ex.features, hazExtent });
    else if (m.layer === "nogo") drawNogo(toScreen, ctx, { ...D, features: nogoFeatures(ex), depthExcluded });
    else if (m.layer === "law") {
      if (!scratch) scratch = new OffscreenCanvas(1, 1);
      drawLawBands(lawOf(ex), toScreen, ctx, { features: ex.features, scratch });
    } else throw new Error("no such layer: " + m.layer);
    const bitmap = cv.transferToImageBitmap();
    self.postMessage({ type: "drawn", seq: m.seq, layer: m.layer, ok: true, bitmap, ms: Date.now() - t0 }, [bitmap]);
  } catch (e) {
    self.postMessage({ type: "drawn", seq: m.seq, layer: m.layer, ok: false, error: String((e && e.message) || e), ms: Date.now() - t0 });
  }
}

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === "draw") { draw(m); return; }
  const t0 = Date.now();
  try {
    const d = JSON.parse(new TextDecoder().decode(m.raw));
    const feats = (d && d.features) || [];
    // `enc` as the page's fetchENCBbox makes it from the same answer: layered, and the classes that failed to arrive
    const skin = skinOverHarbour(feats, m.b, { layered: !!(d && d.layered), partial: (d && d.partial) || [] });
    keep(m.id, { features: feats, skin });
    self.postMessage({ id: m.id, ok: true, skin, n: feats.length, ms: Date.now() - t0 });
  } catch (e) {
    self.postMessage({ id: m.id, ok: false, error: String((e && e.message) || e), ms: Date.now() - t0 });
  }
};
