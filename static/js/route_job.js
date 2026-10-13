// static/js/route_job.js - ONE ROUTE SEARCH, run where it is handed: in route_worker.js, OFF the page's thread.
//
// ⚠ WHY (2026-10-12, Andy: "move the route planner into a worker"). A Go-To up the Piscataqua held his supervising
// page's thread 11 s, read the chart wider, and held it 17.8 s more: the clearance guard, the readouts and the controls
// all stopped for as long as the search ran, a second chart tab took supervision from the silent one, and the Go-To it
// then sent was refused. The search is passage.js's own - planNogoRoute, routePlan, holdTarget - unchanged; only WHERE
// it runs moves. The page (asv.html planOffThread) sends what the planner reads and takes back what it returns.
//
// WHAT THE PLANNER READS, and so all that is sent (passage.js, and the chart.js / keepouts.js / hold.js / routing.js
// bodies it calls, which take the model as an argument): nogo.ko, nogo.frame, nogo.buffer, nogo.bbox, nogo.unread,
// nogo.ready, nogo.ais, and V (V.CHANNEL_REACH_M, V.REACH_ROCK - the whole block is sent, it is small). It WRITES
// sea.laneUsed and sea.lanePartial (channelLaneRoute's mirror), which go back with the answer. A field added to that
// list without being sent here is a search on a different world from the page's - tests/route_worker.js asserts the
// answer is the page's own, field for field, on the New Castle chart.
//
// ⚠ THE MODEL IS SENT ONCE, BY ID. A keep-out model is never changed after it is built - rebuildNogo makes a new one
// and folds the chart-image structures in before anything else sees it - so an id stands for one model for good, and
// a search after the first is a small message. Its feature count travels with every search all the same, and a model
// that does not match is refused (and the page plans on its own thread, as it always did).
// ⚠ AND THE PAGE SAYS WHICH TO KEEP (`keep`, on every search): the chart's own model and nothing else, so a passage
// section's model at its own water, or the way round a contact, is dropped when its search is done. Two caches that
// each decided for themselves would drift; this one does as it is told, in the order the searches were sent.
import { V, nogo, sea } from "./state.js";
import { planeFrame } from "./geodesy.js";
import { planNogoRoute, routePlan, holdTarget } from "./passage.js";

const models = new Map();

/** A model's feature count: the check that the model held under an id is the one the page planned on. */
export function koCount(ko){
  return ko ? (ko.polys || []).length + (ko.lines || []).length + (ko.points || []).length : -1;
}
/** The ids this side holds now (tests/route_worker.js). */
export function heldModels(){ return [...models.keys()]; }
function modelOf(ref){
  const ko = models.get(ref.id);
  if(!ko) throw new Error("the keep-out model " + ref.id + " is not one this side holds");
  if(koCount(ko) !== ref.n) throw new Error("the keep-out model " + ref.id + " is not the one the page planned on ("
                                            + koCount(ko) + " features, not " + ref.n + ")");
  return ko;
}
// A caller's own model (`opts.ko`: the way in round a contact) arrives as a reference to one sent beside it.
function withKo(opts){
  return opts && opts.ko && opts.ko.id != null ? {...opts, ko: modelOf(opts.ko)} : opts;
}

function run(op, a){
  if(op === "nogo") return planNogoRoute(a.from, a.to, withKo(a.opts));
  if(op === "route") return routePlan(a.start, a.wps, a.keepRightAll, a.standoffM, a.transitAt);
  // A drawn transit and a passage's section: where she will hold (holdTarget), then the route to it - one search,
  // as the page's own closure runs them, and the hold point back with the plan.
  if(op === "holdRoute"){
    const ht = holdTarget(a.target, a.holdOpts);
    if(ht.error) return {ht, plan: null};
    return {ht, plan: routePlan(a.start, [...(a.via || []), ht.to], a.keepRightAll, a.standoffM)};
  }
  throw new Error("no such search: " + op);
}

/**
 * One message from the page, answered: {id, ok: true, out, sea: {laneUsed, lanePartial}, ms} or {id, ok: false, error}.
 * `m`: {id, op, args, ko: {id, n} (the model the search stands on as nogo.ko), models: [{id, ko}] (any not yet sent),
 *       keep: [ids] (what to hold after it), state: {V, nogo: {ready, buffer, bbox, unread, ais}, frameRef,
 *       laneUsed, lanePartial}}.
 */
export function routeReply(m){
  const t0 = Date.now();
  try{
    for(const x of (m && m.models) || []) models.set(x.id, x.ko);
    const s = (m && m.state) || {};
    Object.assign(V, s.V || {});
    const n = s.nogo || {};
    nogo.ready = !!n.ready; nogo.buffer = n.buffer; nogo.bbox = n.bbox || null; nogo.unread = n.unread || null;
    nogo.ais = n.ais || null;
    nogo.frame = s.frameRef ? planeFrame(s.frameRef) : null;
    nogo.ko = m.ko ? modelOf(m.ko) : null;
    sea.laneUsed = !!s.laneUsed; sea.lanePartial = !!s.lanePartial;
    const out = run(m.op, m.args || {});
    return {id: m.id, ok: true, out, sea: {laneUsed: sea.laneUsed, lanePartial: sea.lanePartial}, ms: Date.now() - t0};
  }catch(e){
    return {id: m && m.id, ok: false, error: String((e && e.stack) || e), ms: Date.now() - t0};
  }finally{
    const keep = new Set((m && m.keep) || []);
    for(const id of [...models.keys()]) if(!keep.has(id)) models.delete(id);
  }
}
