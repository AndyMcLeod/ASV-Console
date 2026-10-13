// static/js/route_worker.js - the route search OFF the page's thread (route_job.js does the work; this only carries it).
// One search at a time, in the order the page sends them; the page keeps two of these - one for the commands, one for
// the ETA rows - so an estimate never stands in front of a Go-To.
import { routeReply } from "./route_job.js";

self.onmessage = (ev) => {
  const r = routeReply(ev.data);
  try { self.postMessage(r); }
  catch (e) { self.postMessage({ id: r.id, ok: false, error: "the answer could not be sent back: " + ((e && e.message) || e) }); }
};
