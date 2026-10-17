// static/js/skin_worker.js - the seabed's gaps (skin.js skinOverHarbour) OFF the page's thread (2026-10-17, Andy:
// "implement 1 through 3" of the performance review).
//
// ⚠ WHY: the walk over every seabed edge of a chart extract took 266 ms (a 16 MB New Castle extract) to 528 ms (a Go-To's
// 20 MB re-read) of the page's only thread - measured, the largest single piece of a keep-out model's arrival, with the
// clearance guard waiting behind it - and its answer is a handful of gaps. The page (asv.html fetchENCBbox) hands this
// the extract's own bytes as they arrive, TRANSFERRED, not copied, and parses its own text meanwhile; this parses its copy
// and walks it with the one skinOverHarbour both sides import. The answer carries the extract's feature count, and the
// page walks it itself when there is no answer, an error, or a count that is not the extract it holds (skinOffThread).
import { skinOverHarbour } from "./skin.js";

self.onmessage = (ev) => {
  const m = ev.data || {}, t0 = Date.now();
  try {
    const d = JSON.parse(new TextDecoder().decode(m.raw));
    const feats = (d && d.features) || [];
    // `enc` as the page's fetchENCBbox makes it from the same answer: layered, and the classes that failed to arrive
    const skin = skinOverHarbour(feats, m.b, { layered: !!(d && d.layered), partial: (d && d.partial) || [] });
    self.postMessage({ id: m.id, ok: true, skin, n: feats.length, ms: Date.now() - t0 });
  } catch (e) {
    self.postMessage({ id: m.id, ok: false, error: String((e && e.message) || e), ms: Date.now() - t0 });
  }
};
