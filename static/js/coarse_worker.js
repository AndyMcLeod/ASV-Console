// static/js/coarse_worker.js - the passage planned coarse (coarse.js) OFF the page's thread: the page's one thread is
// the clearance guard's too, and a passage's search runs over every tile it reaches. The grids come over as the
// files' own bytes (transferred, not copied); the plan goes back as one message.
//   `kind: "home"` (2026-10-12): the COARSE HOME FIELD instead - her water distance home over the same grids
// (coarse.js coarseHomeField), each tile's lengths transferred back.
//   `openWater: false` (2026-10-14): the costs by level alone, without open water first (the operator's Route rules).
import { buildField, coarseHomeField, decodeGrid, planPassage } from "./coarse.js";

self.onmessage = (ev) => {
  const d = (ev && ev.data) || {};
  const t0 = Date.now();
  try {
    if (d.kind === "home") {
      const grids = (d.grids || []).map((g) => (g.head ? g : decodeGrid(g)));
      const r = coarseHomeField(buildField(grids, d.floorDm, d.airDm || 0, { openWater: d.openWater !== false }), d.home);
      self.postMessage({ id: d.id, ms: Date.now() - t0, ...r }, r.tiles ? r.tiles.map((t) => t.len.buffer) : []);
      return;
    }
    const r = planPassage({ grids: d.grids || [], floorDm: d.floorDm, airDm: d.airDm || 0, points: d.points || [],
                            openWater: d.openWater !== false });
    self.postMessage({ id: d.id, ms: Date.now() - t0, ...r });
  } catch (e) {
    self.postMessage({ id: d.id, error: String((e && e.message) || e) });
  }
};
