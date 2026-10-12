// static/js/coarse_worker.js - the passage planned coarse (coarse.js) OFF the page's thread: the page's one thread is
// the clearance guard's too, and a passage's search runs over every tile it reaches. The grids come over as the
// files' own bytes (transferred, not copied); the plan goes back as one message.
import { planPassage } from "./coarse.js";

self.onmessage = (ev) => {
  const d = (ev && ev.data) || {};
  const t0 = Date.now();
  try {
    const r = planPassage({ grids: d.grids || [], floorDm: d.floorDm, airDm: d.airDm || 0, points: d.points || [] });
    self.postMessage({ id: d.id, ms: Date.now() - t0, ...r });
  } catch (e) {
    self.postMessage({ id: d.id, error: String((e && e.message) || e) });
  }
};
