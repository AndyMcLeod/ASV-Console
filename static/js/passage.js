// static/js/passage.js - HOW THE VESSEL GETS THERE: the Rule 9 lane and the keep-out router.
//
// RULE 9 AND THE ROUTER SHARE ONE MODULE ON PURPOSE. They are mutually recursive - the
// router asks for a keep-right lane, and building that lane asks the router for a path
// along it. That is a fact about the problem, not an accident of this code. It is also why
// `gateLegClear` belongs with them despite reading like a clearance test: it calls the
// router. The core keeps them together for the same reason, in ONE routing.js rather than
// WorldView's two files.
//
// WHAT RULE 9 MEANS HERE. In a narrow channel or fairway a power-driven vessel keeps to the
// starboard side of the fairway. The lane is derived GEOMETRICALLY - a quarter-width offset
// from the channel centreline - NOT from buoy colour, so it holds in either IALA region and
// where the marks are sparse. `channelSpanKeepouts` then stops a SURVEY line from spanning
// the channel it should be running along.
//
// EVERY ROUTE IS CLEAR OF THE KEEP-OUT MODEL OR IT IS REFUSED. A leg with no clear detour is
// reported as unsafe, never quietly straightened - a route that merely looks plausible on
// the chart is the failure this module exists to prevent.
//
// ── THE ROUTING BODIES MOVED TO asv_core ON 2026-08-20 ────────────────────────────────
//
// Fourteen symbols now come from `./routing.js`. WorldView had every one of them, ported
// FROM this file, and they came back MEASURED: both sides handed THIS console's flat frame
// and the SAME keep-out model object, 0.000e+0 m across the board —
//
//     snapClearLL      0 of 300 (187 moved, 113 refused)
//     routeAround      0 of 6 legs; routeAroundSeg 0 of 6; 9 margin/maxDim overrides
//     legPath          0 of 6, through the whole escalation ladder
//     pruneStitch, smoothTrack                      0 of 3 each
//     buoyChannelLane / narrowChannelLane           0 of 4, flags agreeing
//     gateLegClear     0 of 3, with `abandoned` and `splices` agreeing
//     channelLaneRoute 0 of 4 end to end, `lane` and `partial` agreeing
//     channelSpanKeepouts / channelTurnKeepouts     0 of 2 each
//
// ⚠ AND THOSE ZEROS WERE TRUE BUT LUCKY, WHICH IS THE FINDING. A SHARED NAME IS NOT A
// SHARED QUANTITY: `distTo` is the FLAT model here and VINCENTY in WorldView — a steady
// 0.278 % apart, 4.4 m at 1600 m and 22.5 m at 8100 m, the widest margin the search uses —
// and `azTo` up to 0.120°. The shared bodies call BOTH: `legPath`'s escape ring filters and
// sorts candidates by `distTo`, `pruneStitch` folds a vertex past 150° of `azTo`, and
// `gateLegClear` exempts a block within 2·buf of an endpoint. Measured, that gap changes
// 92 of 20,000 keep/drop decisions, 3.0 % of best-first orderings, 11 of 20,000 fold tests
// and 9 of 20,000 endpoint exemptions. The fixture simply never landed near a threshold.
//
// So THE METRIC TRAVELS WITH THE FRAME. `planeFrame` carries this console's own `distTo`
// and `azTo` beside `toEN`/`fromEN`, the shared bodies call `frame.distTo`, and nothing
// here moves. Whether this router SHOULD keep measuring flat is a separate and open
// question - the flat model is 0.278 % short, and changing it would move real routes.
//
// ⚠ THE LANE PRODUCERS RETURN THEIR FLAGS NOW. `buoyChannelLane` and `narrowChannelLane`
// used to write `sea.laneUsed` / `sea.lanePartial` - a module-level scratch flag set by
// three producers for one consumer to read - where WorldView returns {path, used, partial}.
// The core takes the returned form, and `channelLaneRoute` below MIRRORS it back into
// `sea.*` so anything inspecting that state still sees the truth. The side-channel is gone
// from the producers; the fields are now a report, not a channel.
import { azTo, distTo, llEN } from "./geodesy.js";
import { V, nogo, sea } from "./state.js";
import { blockedInfo, firstBlockAlong, legClear } from "./chart.js";
// Where a boat is asked to hold, and how much water it has there (the hold DISC).
import { HOLD_RADIUS_MIN_M, holdClearM, holdMarginM, snapCapM, snapClearRadial } from "./hold.js";
// The shared routing layer. `legPath` is used below by planNogoRoute and routePlan; the
// rest pass straight through to this console's importers, which are untouched.
import { LANE_FRAC, SEG_LEN_M, buoyChannelLane, narrowChannelLane, smoothTrack,
         gateLegClear, channelSpanKeepouts, channelTurnKeepouts,
         routeAround, routeAroundSeg, pruneStitch, legPath,
         channelLaneRoute as coreChannelLaneRoute,
         stampSeg, dilateGrid, rasterKeepouts } from "./routing.js";
export { LANE_FRAC, SEG_LEN_M, buoyChannelLane, narrowChannelLane, smoothTrack,
         gateLegClear, channelSpanKeepouts, channelTurnKeepouts,
         routeAround, routeAroundSeg, pruneStitch, legPath,
         stampSeg, dilateGrid, rasterKeepouts };

// The whole Rule 9 pipeline: marked lane, unmarked lane, smooth, the gate, the knot prune.
//
// TWO THINGS HAPPEN AT THIS SEAM AND NOTHING ELSE DOES.
//
// 1. `V.CHANNEL_REACH_M` becomes `opts.channelReachM`. Same number, same meaning, and the
//    same rule the core states: it is a MAXIMUM the confined-water search may reach to,
//    never a substitute for the tight default. Wiring it as a replacement once let a hull
//    whose value sat below its own `buf*30` have the search silently narrowed, and
//    stretches flipped between laned and unlaned with the water level.
//
// 2. The returned `lane` / `partial` are mirrored into `sea.laneUsed` / `sea.lanePartial`.
//    Those fields used to be how the producers TALKED to this function; now they are how
//    this function reports, so a readout or a suite that reads them is still right.
// `lane:false` runs the SMOOTH / GATE / PRUNE pipeline without the Rule 9 offset - what a
// survey or search PATTERN's own inter-leg hops want. See the core's own note: those three
// stages have nothing to do with Rule 9 and a pattern needs every one of them, so the lane
// is skipped rather than the call.
export function channelLaneRoute(pathLL, ref, ko, buf, opts){
  const r = coreChannelLaneRoute(pathLL, ref, ko, buf,
                                 {channelReachM: V.CHANNEL_REACH_M != null ? V.CHANNEL_REACH_M : 0,
                                  ...(opts || {})});
  sea.laneUsed = r.lane;
  sea.lanePartial = r.partial;
  return r;
}

// Order the clipped survey segments so the ASV never gets a leg numbered straight
// through a keep-out. Boustrophedon Cellular Decomposition: a keep-out that splits
// a line puts the near/far parts in DIFFERENT coverage cells, so they are never
// numbered back-to-back; each cell is covered as a continuous serpentine (turn
// onto the adjacent line) and left for the next cell by a hop.
//
// THE RULES, AS MEASURED (tests/survey_order.js; the technical manual's 8.3 writes them up):
//   * A run's line index is round((across - the smallest across) / spacing), and
//     "across" is positive to starboard of `legHeading` - toward the pattern's third
//     click, seen from its start corner - so index 0 is the outermost line on the side
//     AWAY from that click. The survey STARTS in the cell holding index 0 (ties: the
//     smallest along-track start), on that run as it was handed in. That is line 1 at
//     the start corner only when the pattern fills toward the click; when it fills
//     away from it, the survey starts on the far side of the box.
//   * The NEXT cell is whichever has a run end nearest the previous exit - greedy, not
//     an optimal tour - and every cell is swept from its lowest index up, each run
//     entered at its end nearer the previous exit.
//   * A line index with no runs at all is skipped, so a struck line does not break a cell.
// `unsafe` lists the exit-to-entry hops `legSafe` refuses, and punchOut does NOT use it:
// its pair loop re-judges every consecutive pair itself and joins it with a generated
// turn, a straight hop, a routed detour or a red flag. (This comment used to say the
// crossings were flagged "rather than auto-routing around"; the pair loop routes them.)
// Returns {ordered:[[entry,exit]..] (traversal-oriented), unsafe:[[a,b]..]}.
export function regionOrder(segs, ref, legHeading, spacing, legSafe){
  if(segs.length <= 1) return {ordered: segs.map(s=>[s[0],s[1]]), unsafe: []};
  const rad = legHeading*Math.PI/180, su = Math.sin(rad), cu = Math.cos(rad);
  const along = p=>{ const q=llEN(p.lat,p.lon,ref); return q.e*su + q.n*cu; };       // along-track
  const cross = p=>{ const q=llEN(p.lat,p.lon,ref); return q.e*cu - q.n*su; };       // across-track
  const items = segs.map(s=>{ const a0=along(s[0]), a1=along(s[1]);
    return {p0:s[0], p1:s[1], amin:Math.min(a0,a1), amax:Math.max(a0,a1),
            cross:(cross(s[0])+cross(s[1]))/2}; });
  const minC = Math.min(...items.map(i=>i.cross)), sp = spacing>0.5 ? spacing : 1;
  items.forEach(i=> i.li = Math.round((i.cross-minC)/sp));   // survey-line index (across-track)
  const byLine = new Map();
  items.forEach(i=>{ if(!byLine.has(i.li)) byLine.set(i.li,[]); byLine.get(i.li).push(i); });
  const lines = [...byLine.keys()].sort((a,b)=>a-b);
  lines.forEach(li=> byLine.get(li).sort((a,b)=>a.amin-b.amin));

  // --- sweep decomposition: cells each hold <=1 interval per line -----------
  const cells = []; let open = [];
  for(const li of lines){
    const ivals = byLine.get(li);
    const cellIvals = open.map(()=>[]);            // ivals overlapping each open cell
    const ivalCells = ivals.map(()=>[]);           // open cells overlapping each ival
    open.forEach((c,ci)=> ivals.forEach((iv,ii)=>{
      if(Math.min(c.front.amax,iv.amax) > Math.max(c.front.amin,iv.amin)){
        cellIvals[ci].push(ii); ivalCells[ii].push(ci); } }));
    const used = new Array(open.length).fill(false), nextOpen = [];
    ivals.forEach((iv,ii)=>{
      const cs = ivalCells[ii];
      if(cs.length===1 && cellIvals[cs[0]].length===1){        // clean continue
        const c = open[cs[0]]; used[cs[0]]=true;
        c.items.push(iv); c.front = {amin:iv.amin, amax:iv.amax}; nextOpen.push(c);
      } else {                                                 // split / merge / new
        cs.forEach(ci=>{ if(!used[ci]){ used[ci]=true; cells.push(open[ci]); } });
        nextOpen.push({items:[iv], front:{amin:iv.amin, amax:iv.amax}});
      }
    });
    open.forEach((c,ci)=>{ if(!used[ci] && cellIvals[ci].length===0) cells.push(c); });
    open = nextOpen;
  }
  open.forEach(c=>cells.push(c));

  // --- sequence cells (greedy nearest), serpentine within, orient + validate -
  const cellList = cells.filter(c=>c.items.length);
  const ordered = [], unsafe = [];
  let exit = null;
  const remaining = cellList.slice();
  while(remaining.length){
    let idx = 0;
    if(exit === null){                             // start: lowest line, then along-track
      let best = Infinity;
      remaining.forEach((c,i)=>{ const k = Math.min(...c.items.map(v=>v.li))*1e6 +
        Math.min(...c.items.map(v=>v.amin)); if(k<best){ best=k; idx=i; } });
    } else {
      let best = Infinity;
      remaining.forEach((c,i)=>{ const d = Math.min(...c.items.map(v=>
        Math.min(distTo(exit,v.p0), distTo(exit,v.p1)))); if(d<best){ best=d; idx=i; } });
    }
    const cell = remaining.splice(idx,1)[0];
    cell.items.forEach(iv=>{                        // items are in ascending line order
      let entry = iv.p0, ex = iv.p1;
      if(exit!==null && distTo(exit,iv.p1) < distTo(exit,iv.p0)){ entry = iv.p1; ex = iv.p0; }
      if(exit!==null && !legSafe(exit, entry)) unsafe.push([exit, entry]);
      ordered.push([entry, ex]); exit = ex;
    });
  }
  return {ordered, unsafe};
}
// How the console read the buoyage on THE ROUTE PASSED IN - `lane` comes off that plan's
// own result, not off a flag describing whichever route was planned most recently.
export function buoyageNote(lane, partial){
  // Go-To / RTH / Transit ride the CHANNEL LANE: offset to starboard of the buoy-pair
  // centreline, so the centreline stays to port and the starboard-hand marks to
  // starboard - either direction of travel.
  //
  // A PARTIAL LANE SAYS SO. The banner is the only thing telling the operator whether
  // the boat is keeping right, and "Rule 9: channel lane" over a route that rides one
  // channel's centreline dead on, or that lost the lane to a spliced detour, is worse
  // than no banner: it is a claim they would otherwise have checked.
  if(!lane) return "";
  return partial ? "Rule 9: channel lane, centreline to port — PARTIAL: some of this route is not laned"
                 : "Rule 9: channel lane, centreline to port";
}
// One entry point, applied to EVERY mode: lane off the buoys where a channel is marked,
// off the water's own edges where it isn't, then smooth + set the waypoint spacing.
//
// RETURNS {route, lane} - the fact that a lane was ridden comes back WITH the route it
// describes, rather than being left in a module flag for a banner to read later. The flag
// version had two faults, and neither was visible from the routing code:
//   * a REFUSED plan never reached this function, so the flag still held the PREVIOUS
//     plan's answer and any reader would have described the wrong route;
//   * routePlan calls this once PER LEG, and the reset at the top meant only the LAST leg
//     counted - a transit that rode a lane on leg 1 and open water on leg 3 reported none.
// A value returned with its subject cannot drift from it, and cannot be read by an
// operation that did not produce it.
// THE GATE: no route leaves the lane pipeline without passing the SAME legClear the
// obstacle search obeyed. Found at Erie (2026-08-06): legPath routed clear of every
// keep-out, then buoyChannelLane REPLACED that route with the buoy-gate centreline
// (offset to port) and smoothTrack rounded the bends - and where the charted channel
// hugs the waterfront, that lane geometry crossed the seawall's land polygon in three
// places. Nothing re-checked the substitution, so the banner said "routed around
// nogo zone(s)" about a route that no longer existed. The lane is a PREFERENCE; the
// nogo model is LAW. A failing stretch is re-routed by legPath and spliced, so the
// lane survives everywhere it is lawful; if the law cannot patch it, the pre-lane
// input ships instead (it was legPath-clear by construction) and `abandoned` tells
// the caller the Rule 9 banner would be a lie.
//
// Endpoint exemption, same as routeAround's A-rule: a block within 2*buf of the
// route's OWN start or goal is tolerated - a boat moored inside the buffer must
// still be led OUT, and the arrival can end at a dock.
// A spliced patch is legPath's own product and is NOT re-checked: the gate exists
// to catch the lane's inventions, not to out-lawyer the search - and re-checking a
// patch whose stretch-ends sit in-buffer would loop forever.
// THE JUNCTION IS A SEAM pruneStitch CANNOT SEE. A routed inter-line transit meets the
// survey line AT the line's own endpoint, and the line's heading is outside the route -
// so a via whose first point folds back against the line (a reversal knot AT the
// junction) has no interior corner for pruneStitch to drop, at this or any version.
// The survey generator shipped exactly that (session 20260810-131214, mission wpt 551:
// 176° in 4.5 m where a routed transit met a 22 m sliver line end - the boat orbits
// trying to capture it; reproduced at HEAD from the same log, buffer 5 / plan speed
// high). Only the caller that holds BOTH the via and the line endpoints can measure
// the junction; punchOut's transit loop calls these two there.
//
// A KNOT, as the log replay defines it: the course reverses (>KNOT_TURN_DEG of
// deflection) with less water than the hull can turn in (<KNOT_STEP_M on the shorter
// leg). Wider reversals are the documented straight-hop class - flyable as a wide
// swing, reported by the nNoTurn banner - so the thresholds are deliberately the knot
// detector's, NOT pruneStitch's 60°: a lane via lawfully leaves a line end steeply,
// and eating those points would trade Rule 9 discipline for no safety.
export const KNOT_TURN_DEG = 150, KNOT_STEP_M = 12;
export function junctionKnot(a, b, c){           // the b-vertex: arrive a->b, leave b->c
  const t = Math.abs(((azTo(b, c) - azTo(a, b) + 540) % 360) - 180);
  return t > KNOT_TURN_DEG && Math.min(distTo(a, b), distTo(b, c)) < KNOT_STEP_M;
}
// Prune a routed via's JUNCTION knots: while the seam at a line end folds (deflection
// past KNOT_TURN_DEG) within a VIA step shorter than KNOT_STEP_M, and the bridge to
// the next point connects CLEAR, the folding point goes - the same lawful-by-
// construction rule as pruneStitch, applied where it cannot reach. The drop keys on
// the via's OWN step, not junctionKnot's min-of-both-legs: a sliver LINE under
// KNOT_STEP_M would otherwise keep the knot test true whatever is dropped and drain a
// lawful via to nothing. An obstacle-forced fold keeps its points (the bridge
// refuses) and it is the CALLER's job to report it rather than ship it silently.
export function pruneJunctionKnots(lineIn, Ap, via, Bp, lineOut, ref, ko, buf){
  via = via.slice();
  const folds=(a,b,c)=>Math.abs(((azTo(b,c)-azTo(a,b)+540)%360)-180) > KNOT_TURN_DEG;
  while(via.length && folds(lineIn, Ap, via[0]) && distTo(Ap, via[0]) < KNOT_STEP_M &&
        legClear(Ap, via[1] || Bp, ref, ko, buf)) via.shift();
  while(via.length && folds(via[via.length-1], Bp, lineOut) && distTo(via[via.length-1], Bp) < KNOT_STEP_M &&
        legClear(via[via.length-2] || Ap, Bp, ref, ko, buf)) via.pop();
  return via;
}
// ============================================================================
// CHANNEL LANE (ported from the sibling console, 2026-07-31). COLREGS Rule 9 for
// every transit: ride a lane offset to STARBOARD of the channel CENTRELINE, half
// the local half-width out (= a quarter of the full width in from the edge), so the
// centreline stays to PORT. Colour is never an input - it falls out, because IALA
// lateral marks sit on fixed sides. Direction of travel picks the side, so inbound
// and outbound ride opposite halves and opposing traffic passes port-to-port.
// Marked channels take the centreline from PAIRED buoy midpoints; unmarked but
// confined water takes it from the water's own edges. This REPLACED an earlier
// colour-driven buoy-line rule that rode the wrong side of the buoys on the water
// twice, because it derived its offset from a fragile edge ray-march instead of
// from the centreline. That rule and its colour helpers were deleted 2026-08-02.
// ============================================================================
// Smooth + densify a coarse waypoint list into a followable track. The channel
// centreline has only ONE point per buoy pair, so a bare boat->midpoints->target path
// dog-legs at each bend and is too sparse for the follower to track smoothly. Two
// steps: (1) linearly RESAMPLE onto ~STEP-spaced points that lie exactly on the input
// polyline (so straight runs stay dead on the centreline); (2) round the corners with a
// couple of light [0.25,0.5,0.25] smoothing passes - identity on a straight run, so it
// only rounds the bends, and it can only move a point INWARD (never bulging into the
// far bank). Endpoints are fixed; a smoothed point that would land in a keep-out is left
// un-smoothed. Net: many waypoints, on the centreline on the straights, gently rounded
// at the bends.
// THE END OF A COMMANDED ROUTE IS WHERE THE BOAT WILL HOLD, so a target is a HOLD POINT
// and not merely a destination (the command-time half of the Eastport work, 2026-09-03).
//
// A target inside the keep-out model is no longer a refusal. It is moved to the nearest
// clear water in ANY direction (hold.js: radial, with the whole hold DISC clear - the
// operator's buffer plus the hold radius the boat is allowed to wander), and `heldOff`
// says where the operator's point was and what it sits in, so the banner and the Intent
// card can say "holding N m off it". Refusing was the old answer, and it arrived at the
// one moment it was least useful - mid-mission, on the chained Return-to-Home to a HOME
// that had been set at a berth. Only when there is no clear water within the search cap
// does the refusal remain, and then it names the cap.
//
// `holdClear` is the radius of the clear disc around the hold point and travels to the
// vessel as `hold_clear_m`: inside it the boat may re-approach DIRECT (a chord of a clear
// disc is clear), beyond it the boat takes the way off and the console supplies a routed
// re-approach (reapproachIfSetOff in asv.html). `opts.holdR` is the hold radius the disc
// must cover; the page passes the mission's approach radius, floored at the sim's own 2 m.
export function holdTarget(to, opts){
  if(!nogo.ready) return {to:{lat:to.lat,lon:to.lon}, heldOff:null, holdClear:null, degraded:true};
  const ref=nogo.frame, ko=nogo.ko, buf=nogo.buffer;
  const holdR = Math.max(HOLD_RADIUS_MIN_M, (opts && opts.holdR) || 0);
  // THE MARGIN IS THE ENVIRONMENT'S. A hold point must hold the boat for as long as the
  // ladder is allowed to take deciding about it, at the set the boat is actually in - so the
  // caller passes the live set and the number falls out of it. No set (or no telemetry yet)
  // still gets the hull-scale floor; it never gets "not blocked" as an answer again.
  const setMs = Math.max(0, (opts && opts.setMs) || 0);
  const setDeg = (opts && opts.setDeg);
  const need = holdMarginM(setMs);
  const sr = setDeg == null ? 0 : setDeg * Math.PI / 180;
  const setE = setMs * Math.sin(sr), setN = setMs * Math.cos(sr);
  let heldOff = null;
  const en = llEN(to.lat,to.lon,ref);
  const bi = blockedInfo(en, ko, buf);
  const tight = holdClearM(en, ko, buf) < need;
  if(bi || tight){
    const sn = snapClearRadial(en, ko, buf, holdR, {need, setE, setN});
    if(!sn) return {error:(bi ? "the target sits in "+bi.kind : "the target has under "
                            +need.toFixed(0)+" m of clear water")
                          +" and nowhere within "+snapCapM(buf).toFixed(0)
                          +" m of it holds a boat clear",
                    reason:{mode:"target", info:bi, at:to}};
    if(sn.moved > 0){
      const nt = ref.fromEN(sn.e, sn.n);
      // WHY it moved, in the words the operator needs: "it is IN the pier" and "it is not IN
      // the pier but there is no room to sit there" are different sentences.
      heldOff = {from:{lat:to.lat,lon:to.lon}, m:sn.moved, need,
                 kind: bi ? bi.kind : "water too tight to hold in",
                 tight: !bi};
      to = {lat:nt.lat, lon:nt.lon};
    }
  }
  return {to:{lat:to.lat,lon:to.lon}, heldOff, need,
          holdClear: holdClearM(llEN(to.lat,to.lon,ref), ko, buf)};
}
// Plan an ENC-aware path from -> to ending at `to` - or at the nearest clear water to
// `to` when it sits in a keep-out (see holdTarget). {route} on success, {error} when no
// clear route exists (refuse + warn). Keeps to the starboard side of channels (Rule 9).
export function planNogoRoute(from, to, opts){
  if(!nogo.ready) return {route:[{lat:to.lat,lon:to.lon}], direct:true, degraded:true};
  const ref=nogo.frame, ko=nogo.ko, buf=nogo.buffer;
  const ht = holdTarget(to, opts);
  if(ht.error) return ht;
  to = ht.to;
  const heldOff = ht.heldOff, holdClear = ht.holdClear;
  const leg = legPath(from, to, ref, ko, buf);
  if(!leg){ const fb=firstBlockAlong(from, to, ref, ko, buf);
    return {error:"no clear route to the target — every path crosses "+(fb?fb.info.kind:"a nogo zone"),
            reason:{mode:"boxed", info:fb?fb.info:null, at:fb?fb.at:null, target:to}}; }
  const routed = leg.length > 1;
  // The lane's centreline is EXTENDED to the charted end of the fairway before the lane
  // is built on it (extendCenterline), so the stand-on past a mouth needs no separate
  // pass here. This comment used to claim the same thing about the UNextended centreline
  // - "it already runs out to the last buoy pair, so the fairway projects past the mouth"
  // - which was false: it ran out AT the last pair and the offset was decaying before it.
  const path = [{lat:from.lat,lon:from.lon}, ...leg];
  const kr = channelLaneRoute(path, ref, ko, buf);
  // (the knot prune that used to run here moved INTO channelLaneRoute — the producer —
  // after the Upload path, which never pruned, shipped a splice-seam knot to the boat)
  // `lane` travels WITH the plan. A refusal above returns before this point and so carries
  // no lane at all, which is the honest answer: there is no route to describe.
  return {route: kr.route.slice(1), direct: !routed, routed, lane: kr.lane, partial: kr.partial,
          heldOff, holdClear};
}
// Route an ENTIRE run plan clear of nogo: the approach from `start` (present
// position) to wp0, plus every inter-waypoint transit. Detour waypoints are
// inserted where a leg would cross land / a nogo zone. The APPROACH (a transit)
// keeps to the starboard side of any channel (Rule 9); survey-line legs are left
// on their planned track. `keepRightAll` (pure-transit routes) keeps every leg
// starboard. Returns the full routed list + any legs that couldn't be routed.
export function routePlan(start, wps, keepRightAll){
  if(!nogo.ready || !start) return {route: wps.map(p=>({lat:p.lat,lon:p.lon})), unroutable:[], degraded:true};
  const ref=nogo.frame, ko=nogo.ko, buf=nogo.buffer;
  const out=[]; const unroutable=[]; let prev={lat:start.lat, lon:start.lon};
  // ANY leg riding a lane makes it true for the plan. Accumulated here rather than read
  // back afterwards: this runs channelLaneRoute once per leg, so a per-call flag would
  // report only whichever leg happened to be last.
  let lane = false, partial = false;
  wps.forEach((wp, i)=>{
    const leg = legPath(prev, wp, ref, ko, buf);
    if(!leg){ unroutable.push([prev, {lat:wp.lat,lon:wp.lon}]); out.push({lat:wp.lat,lon:wp.lon}); prev=wp; return; }
    let seg = [prev, ...leg];                       // prev … wp
    // Rule 9 keep-right applies to a TRANSIT: the approach out (leg 0), and every
    // leg of a pure-transit route (keepRightAll - Go-To, RTH, a drawn transit).
    //
    // ⚠ ROUTED DETOURS INSIDE A PLAN NO LONGER GET IT, and dropping that clause is
    // half of Andy's 2026-08-31 correction: "while running various survey patterns
    // the rule should not be considered." `leg.length>1` meant only "routeAround
    // inserted a detour here", which is as true between two coverage lines as
    // anywhere else - so a survey pattern's own inter-line hops were being laned.
    // The comment that stood here admitted the ambiguity it could not resolve ("at
    // Upload we can't tell a survey coverage line from a plain hop") and then
    // resolved it in the direction of APPLYING a rule of the road.
    //
    // It is resolved the other way now, and needs no new information: a plan that
    // is not a pure transit is a PATTERN, and the only leg of a pattern that is a
    // transit in Rule 9's sense is the approach to it. Coverage lines and the hops
    // between them stay on their planned track.
    if(keepRightAll || i===0){
      const kr = channelLaneRoute(seg, ref, ko, buf);
      seg = kr.route; if(kr.lane) lane = true; if(kr.partial) partial = true;
    }
    for(let k=1;k<seg.length;k++) out.push({lat:seg[k].lat, lon:seg[k].lon});
    prev = wp;
  });
  // A plan is only fully laned if EVERY laned leg was: one partial leg makes the plan
  // partial, the same way one laned leg makes it laned.
  return {route: out, unroutable, lane, partial};
}
