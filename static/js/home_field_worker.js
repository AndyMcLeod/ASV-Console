// static/js/home_field_worker.js - builds the water-distance-to-home field (home_field.js) OFF the page's thread.
//
// ALL of the build is here, the raster included: the page held its thread 374 ms rasterizing a 900k-cell grid of
// 1465 keep-outs for one home up the Piscataqua (measured on a scratch console, 2026-10-11), and the clearance guard
// runs on that thread. The page sends the keep-out model only when it CHANGES (a tide, a wider extract, a buffer) -
// {type: "ko"} - and each build after that is one small message: {type: "build"} with the grid and home. The field
// and the grid come back transferred, not copied.
import { rasterKeepouts } from "./raster.js";
import { homeField, homeSeeds } from "./home_field.js";

let ko = null, koGen = null;

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === "ko") { ko = m.ko; koGen = m.gen; return; }
  if (m.type !== "build") return;
  try {
    if (!ko || m.gen !== koGen) throw new Error("the keep-out model it was asked for is not the one it holds");
    const t0 = Date.now(), g = m.g, blk = new Uint8Array(g.W * g.H);
    rasterKeepouts(blk, g.W, g.H, g.x0, g.y0, g.cell, ko, m.buffer);
    const seeds = homeSeeds(g, blk, m.home, m.reachM);
    if (!seeds) { self.postMessage({ id: m.id, error: "home has no clear water within " + m.reachM + " m on the chart" }); return; }
    const dist = homeField(blk, g.W, g.H, seeds);
    self.postMessage({ id: m.id, dist, blk, ms: Date.now() - t0 }, [dist.buffer, blk.buffer]);
  } catch (e) {
    self.postMessage({ id: m.id, error: String((e && e.message) || e) });
  }
};
