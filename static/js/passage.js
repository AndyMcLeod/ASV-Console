// static/js/passage.js - HOW THE VESSEL GETS THERE: the Rule 9 lane and the keep-out router.
//
// RULE 9 AND THE ROUTER SHARE ONE MODULE ON PURPOSE. They are mutually recursive - the
// router asks for a keep-right lane, and building that lane asks the router for a path
// along it. That is a fact about the problem, not an accident of this code, so they sit
// together rather than becoming two modules that import each other in a cycle. It is also
// why `gateLegClear` lives here despite reading like a clearance test: it calls the router.
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
// The bodies below are unchanged from the page; only `laneUsed` became `sea.laneUsed`.
import { M_PER_DEG_LAT, azTo, distTo, fromEN, llEN } from "./geodesy.js";
import { inBB, pinp, segSamplesEN } from "./geometry.js";
import { V, nogo, sea } from "./state.js";

// ── THE ROUTING GRID COMES FROM asv_core (2026-08-19) ──────────────────────────────────
// stampSeg, dilateGrid and rasterKeepouts are the core's now, re-exported here so
// asv.html and the two suites that require them from this module are untouched. They take
// a keep-out model ALREADY IN ENU METRES and a cell grid — no frame, no coordinates —
// which is exactly why these three could move when the rest of this file could not.
//
// Measured identical against WorldView's before the move, not after: stampSeg 0 of 60
// grids differ, dilateGrid 0 of 40, rasterKeepouts 0 of 3072 cells (948 blocked). The
// signatures matched on both sides too, so nothing needed adapting.
//
// ⚠ THE REST OF THIS FILE DID NOT MOVE, AND THE REASON IS ONE PARAMETER. `legPath`,
// `routeAround`, `routeAroundSeg`, `smoothTrack`, `gateLegClear`, `pruneStitch`,
// `buoyChannelLane`, `narrowChannelLane`, `channelLaneRoute`, `channelSpanKeepouts` and
// `channelTurnKeepouts` are the same functions as WorldView's except that this console
// passes a bare `ref` POINT where it passes a `frame`. Settling that is a calling
// convention to decide, not a merge to perform — and WorldView's `frame` is duck-typed
// `{toEN, fromEN}`, so handing it this console's flat pair reproduces these numbers
// exactly. See the core's handoff.
import { stampSeg, dilateGrid, rasterKeepouts } from "./core_raster.js";
export { stampSeg, dilateGrid, rasterKeepouts };
import { blocked, blockedInfo, channelPolys, extendCenterline, firstBlockAlong, legClear,
         snapClearLL, systemCenterline } from "./chart.js";

// THE CENTRELINE THE LANE IS BUILT ON: the buoy-pair midline, extended past both ends to
// the charted extent of the fairway (see extendCenterline). Every consumer goes through
// this, so "where does the channel reach to" cannot mean one thing to the lane builder and
// another to the unmarked-water rule that skips already-laned stretches.
function laneCenterline(sy, ko){ return extendCenterline(systemCenterline(sy), ko && ko.chans); }

// CHANNEL-LANE routing - the operator's specified behaviour, applied to EVERY mode
// (Go-To, RTH, Transit, the survey approach leg, and any routed detour).
//
// Both tracks the operator drew keep the CENTRELINE TO PORT: the outbound track rides
// between the centreline and the green buoys (green to starboard), the inbound track
// between the centreline and the red buoys (red to starboard - "red right returning").
// That is one single rule, direction-based and purely geometric:
//
//     ride a lane offset to STARBOARD of the channel centreline, half way out to the
//     buoy line on that side  (= a quarter of the full channel width in from the edge)
//
// Colour never enters the computation - it falls out, because IALA lateral marks sit on
// fixed sides. Critically the offset is measured from the buoy-pair CENTRELINE (robust:
// midpoints of paired marks) and scaled by the local half-width, NOT by the edge
// ray-march that made the old colour-driven rule ride the wrong side twice.
//
// Build each buoy system's centreline (systemCenterline), pick the system that best
// BRIDGES boat->target (real span, aligned, acceptable detour), walk it in travel order,
// offset each point to starboard, then thread boat -> lane -> target. Every lane point
// is clearance-checked (shrink the offset, else fall back to the centreline point) and
// any blocked leg is re-routed via legPath, so obstacle avoidance is preserved. No-op
// when no buoy system bridges the transit.
export const LANE_FRAC = 0.5;
// RESOLUTION FIX for distant transits. routeAround grids the WHOLE A->B bbox at a
// cell capped by maxDim, so the cell coarsens past ~4 km and can no longer thread
// local features. Split a long leg into fine-grid-sized sub-legs (each keeps the 3 m
// cell), route each with the (validated) routeAround, and stitch. The stitched path
// is clear by construction: routeAround guarantees each sub-leg's interior is clear
// to/from its endpoints, and the split points are nudged to clear water first. Falls
// back to a single routeAround if a split point can't be cleared or any sub-leg is
// unroutable, so it NEVER does worse than before; short legs are returned untouched.
export const SEG_LEN_M = 2200;
// Order the clipped survey segments so the ASV never gets a leg numbered straight
// through a keep-out. Boustrophedon Cellular Decomposition: a keep-out that splits
// a line puts the near/far parts in DIFFERENT coverage cells, so they are never
// numbered back-to-back; each cell is covered as a continuous serpentine (turn
// onto the adjacent line) and only left via a validated transit. Any residual
// transit that still crosses a keep-out is returned in `unsafe` for the operator
// to review (Option 1 flags rather than auto-routing around).
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
export function buoyChannelLane(pathLL, ref, ko, buf){
  if(!pathLL || pathLL.length<2 || !ko || !ko.sys || !ko.sys.length) return pathLL;
  const en = pathLL.map(p=>llEN(p.lat,p.lon,ref));
  // SPLICE INTO THE ROUTED PATH, NEVER REPLACE IT. `pathLL` is the obstacle-clear route
  // legPath already worked out - the detour out of a basin, around a breakwater. Rebuilding
  // the transit as boat -> lane -> target threw all of that away and left a straight jump
  // from the boat to the channel entry that had to be re-routed from scratch (and could
  // fail), which showed up as errors at the START of a long Go-To that varied with the
  // target's bearing/range. So: densify the routed path, find the stretch of it that
  // actually runs along a channel, and replace ONLY that stretch with the lane.
  const SSTEP = Math.max(15, buf*4);
  const cum=[0]; for(let i=1;i<en.length;i++) cum.push(cum[i-1]+Math.hypot(en[i].e-en[i-1].e, en[i].n-en[i-1].n));
  const total=cum[cum.length-1]; if(!(total>0)) return pathLL;
  const atS=(s)=>{ let i=1; while(i<cum.length-1 && cum[i]<s) i++;
    const a=en[i-1], b=en[i], seg=(cum[i]-cum[i-1])||1, t=Math.max(0,Math.min(1,(s-cum[i-1])/seg));
    return {e:a.e+(b.e-a.e)*t, n:a.n+(b.n-a.n)*t}; };
  const base=[]; for(let s=0; s<total-1e-6; s+=SSTEP) base.push(atS(s));
  base.push(en[en.length-1]);
  if(base.length<3) return pathLL;
  const proj=(pt,cl)=>{ let bd=1e18, bu=0, bh=0;     // nearest point on the centreline + index + local half-width
    for(let i=1;i<cl.length;i++){ const a=cl[i-1],b=cl[i],dx=b.e-a.e,dy=b.n-a.n,l2=dx*dx+dy*dy||1;
      let t=((pt.e-a.e)*dx+(pt.n-a.n)*dy)/l2; t=Math.max(0,Math.min(1,t));
      const d=Math.hypot(pt.e-(a.e+t*dx), pt.n-(a.n+t*dy));
      if(d<bd){ bd=d; bu=(i-1)+t; const ha=(a.hw!=null?a.hw:0), hb=(b.hw!=null?b.hw:ha); bh=ha+(hb-ha)*t; } }
    return {d:bd, u:bu, hw:bh}; };
  const clLen=(cl,u0,u1)=>{ let L=0; const a=Math.min(u0,u1), b=Math.max(u0,u1);
    for(let i=Math.floor(a); i<Math.ceil(b) && i<cl.length-1; i++){
      const lo=Math.max(a,i)-i, hi=Math.min(b,i+1)-i;
      L+=Math.hypot(cl[i+1].e-cl[i].e, cl[i+1].n-cl[i].n)*(hi-lo); } return L; };
  // Pick the buoy system the ROUTED PATH ACTUALLY RUNS ALONG (longest stretch of it inside
  // the channel), rather than guessing from a boat->target straight line. That is what the
  // splice needs, and it drops the old alignment / detour heuristics that could misfire.
  let pick=null, qualified=0;
  for(const sy of ko.sys){ const cl=laneCenterline(sy, ko); if(cl.length<2) continue;
    // Capture scales with the channel: a transit running just OUTSIDE the buoys is still
    // using that channel and should be brought into the lane. Too tight a radius left such
    // a path un-laned entirely; the run-length and parallelism gates below stop it from
    // dragging in a path that merely passes nearby.
    let i0=-1, i1=-1;
    for(let i=0;i<base.length;i++){ const q=proj(base[i],cl);
      if(q.d <= Math.max(q.hw*2.5, 60)){ if(i0<0) i0=i; i1=i; } }
    if(i0<0 || i1<=i0) continue;
    const runM=(i1-i0)*SSTEP;
    if(runM < Math.max(120, buf*30)) continue;                         // a real stretch, not a brush past
    const qa=proj(base[i0],cl), qb=proj(base[i1],cl);
    if(clLen(cl, qa.u, qb.u) < 0.5*runM) continue;                     // ALONG the channel, not across it
    // ONE SYSTEM IS LANED PER LEG (the longest run). A transit down two successive
    // buoyed channels therefore rides the second DEAD ON ITS CENTRELINE - the head-on
    // position - and nothing downstream could tell, because the flag only ever recorded
    // "a lane was ridden", never "over all of the channel this route ran along". Count
    // the systems that qualified so the banner can say `partial` instead of lying.
    qualified++;
    if(!pick || runM>pick.runM) pick={cl,i0,i1,runM}; }
  if(!pick) return pathLL;
  if(qualified>1) sea.lanePartial = true;
  const {cl,i0,i1}=pick;
  const pa=proj(base[i0],cl), pb=proj(base[i1],cl);   // where the path enters / leaves the channel
  // DENSIFY the centreline between the boat's and the target's projections, IN TRAVEL
  // ORDER. Sampling the polyline (rather than taking its bare vertices) matters: a real
  // ENC channel may have only 2-3 buoy pairs over kilometres, which left a SINGLE
  // interior vertex whose tangent was computed from itself - a zero-length starboard
  // vector, so no lane offset was applied at all (measured on the live Erie channel).
  const CSTEP = Math.max(15, buf*5);
  const ptAt=(u)=>{ const i=Math.max(0,Math.min(cl.length-2,Math.floor(u))), t=u-i;
    const a=cl[i], b=cl[i+1], ha=(a.hw!=null?a.hw:0), hb=(b.hw!=null?b.hw:ha);
    return {e:a.e+(b.e-a.e)*t, n:a.n+(b.n-a.n)*t, hw:ha+(hb-ha)*t}; };
  const runLen=clLen(cl, pa.u, pb.u);
  const NS=Math.max(2, Math.ceil(runLen/CSTEP));
  const mids=[];
  for(let k=0;k<=NS;k++) mids.push(ptAt(pa.u + (pb.u-pa.u)*(k/NS)));   // pa -> pb = travel order
  if(mids.length<2) return pathLL;
  // THE LANE: offset each centreline point to STARBOARD OF TRAVEL by LANE_FRAC of the
  // local half-width, so the centreline stays to PORT and the starboard-hand buoys stay
  // to starboard - the outbound (green-right) and inbound (red-right) tracks the
  // operator drew, from one direction-based rule. Held a boat-width off the buoy line,
  // and shrunk (finally abandoned) if a lane point isn't in clear water.
  const STANDOFF = Math.max(buf+2, 6);
  const clearEN=(P,Q)=>{ const L=Math.hypot(Q.e-P.e,Q.n-P.n), n=Math.max(1,Math.ceil(L/Math.max(2,buf/2)));
    for(let k=0;k<=n;k++){ const t=k/n; if(blocked({e:P.e+(Q.e-P.e)*t,n:P.n+(Q.n-P.n)*t},ko,buf)) return false; } return true; };
  // Pass 1 - the largest offset whose POINT is in clear water (0 = ride the centreline).
  // The full ¼-width lane is not always available: on the inbound side of Erie the
  // starboard half is shoal, and 22 of 54 lane points genuinely could not take it.
  const SBv=[], want=new Float64Array(mids.length);
  for(let i=0;i<mids.length;i++){
    const a=mids[Math.max(0,i-1)], b=mids[Math.min(mids.length-1,i+1)];
    let te=b.e-a.e, tn=b.n-a.n; const tl=Math.hypot(te,tn)||1; te/=tl; tn/=tl;
    SBv.push([tn,-te]);                             // starboard unit (right of travel)
    const hw=(mids[i].hw!=null ? mids[i].hw : 0);
    const at=(o)=>({e:mids[i].e+tn*o, n:mids[i].n-te*o});
    let off=Math.min(hw*LANE_FRAC, Math.max(0, hw-STANDOFF)), k=0;   // stay inside the buoy line
    while(off>0.5 && blocked(at(off),ko,buf) && k<12){ off*=0.7; k++; }
    want[i] = blocked(at(off),ko,buf) ? 0 : off;
  }
  // Pass 2 - SLEW-LIMIT the offset so the lane eases in and out of the foul stretches
  // instead of stepping. A step between neighbouring points is what laid a rung across a
  // shoal corner; shrinking each point to match its predecessor instead (a forward sweep)
  // was sticky and collapsed the whole lane downstream of the first tight spot (measured:
  // the inbound lane kept 54 of ~190 points). Both passes only ever REDUCE an offset, so
  // no point is pushed past the clear-water limit found above.
  const segLen = runLen/Math.max(1, mids.length-1), gSlew = 0.25*segLen;
  for(let i=1;i<mids.length;i++) want[i]=Math.min(want[i], want[i-1]+gSlew);
  for(let i=mids.length-2;i>=0;i--) want[i]=Math.min(want[i], want[i+1]+gSlew);
  const lane=[];
  for(let i=0;i<mids.length;i++){
    const p={e:mids[i].e+SBv[i][0]*want[i], n:mids[i].n+SBv[i][1]*want[i]};
    lane.push(blocked(p,ko,buf) ? {e:mids[i].e, n:mids[i].n} : p);
  }
  if(!lane.length) return pathLL;
  // SPLICE: routed approach + lane + routed departure. base[0] is the boat and the tail of
  // `base` ends at the target, so the routed obstacle avoidance either side is preserved.
  const post = base.slice(i1+1);
  if(!post.length) post.push(en[en.length-1]);        // always finish at the target
  const seq=[en[0], ...base.slice(1,i0), ...lane, ...post];
  // Verify EVERY leg. A blocked one is re-routed; if it cannot be routed - or the lane
  // needs more than a couple of rescues, meaning it does not fit this path - ABANDON the
  // lane and hand back the routed path untouched. Never emit a leg known to cross a
  // keep-out (the old "best effort" fallback pushed the waypoint anyway, which could bury
  // an unroutable leg in the middle of a plan instead of surfacing it).
  let rescues=0;
  const out=[{lat:pathLL[0].lat, lon:pathLL[0].lon}];
  for(let i=0;i<seq.length-1;i++){
    const Pp=seq[i], Qp=seq[i+1], Qll=fromEN(Qp.e,Qp.n,ref);
    if(clearEN(Pp,Qp)){ out.push({lat:Qll.lat, lon:Qll.lon}); continue; }
    if(++rescues>3) return pathLL;                                     // lane doesn't fit -> keep the routed path
    const sub=legPath(fromEN(Pp.e,Pp.n,ref), Qll, ref, ko, buf);       // obstacle-clear detour
    if(!(sub && sub.length)) return pathLL;                            // unroutable -> keep the routed path
    for(const p of sub) out.push({lat:p.lat, lon:p.lon});
  }
  // A RESCUE IS AN UN-LANED PATCH. legPath's detour is lawful but carries no starboard
  // bias, so a lane that needed rescuing was not delivered end to end - say so rather
  // than letting the banner describe the stretches that worked.
  if(rescues>0) sea.lanePartial = true;
  sea.laneUsed = true;
  return out;
}
// THE SAME LANE RULE IN UNMARKED WATER. A channel does not stop being a channel because
// nobody buoyed it - the boat-basin exit, a canal, a dredged cut between banks all get
// the identical treatment: ride to STARBOARD of the local centreline, LANE_FRAC of the
// half-width out. Here the centreline is derived from the WATER ITSELF: march
// perpendicular to travel to the first obstruction each side (RC to starboard, LC to
// port); the local centre is (RC-LC)/2 to starboard of the sample and the half-width is
// (RC+LC)/2. This only fires where BOTH edges answer within CONFINE - i.e. genuinely
// channel-like, confined water, which is exactly where an edge march is trustworthy
// (open water and a single bank are left alone, and a buoyed stretch is skipped because
// buoyChannelLane has already laned it properly). The lateral shift is smoothed along
// the path so tier changes blend instead of stepping, held STANDOFF off both edges, and
// every emitted point is clearance-checked.
export function narrowChannelLane(pathLL, ref, ko, buf){
  if(!pathLL || pathLL.length<2 || !ko) return pathLL;
  const en = pathLL.map(p=>llEN(p.lat,p.lon,ref));
  // Kept FINER than the emitted waypoint spacing on purpose: this is the resolution the
  // channel is measured at, and a winding basin cut has short confined stretches that a
  // coarse sampling would step straight over. smoothTrack thins to the output spacing after.
  const STEP = Math.max(25, buf*7);
  // ASV: the per-vessel channel_reach_m override applies HERE. It used to set the
  // wall-search REACH of the old edge-march keep-right (deleted 2026-08-02); this is
  // the equivalent knob - how far out an edge still counts as a channel wall.
  //
  // THE OVERRIDE MAY ONLY WIDEN. It was added (0f36df7) to REACH FURTHER, so keep-right
  // would engage in the ~150-175 m Lewes fairway instead of the tight-marina default -
  // and then the geometric rework rewired it as `override ?? buf*30`, which made it a
  // REPLACEMENT. The DriX's 120 is below its own buf*30 of 150, so the knob that exists
  // to widen the search was silently narrowing it by 30 m: a sample near one wall of a
  // 175 m reach failed the both-edges test and got no lane at all, and the canal spawn
  // sits ~120 m from either bank - right on the edge, so stretches flipped between laned
  // and unlaned with the water level. A widening knob is a MAXIMUM, never a substitute.
  const CONFINE = Math.max(120, buf*30, V.CHANNEL_REACH_M!=null ? V.CHANNEL_REACH_M : 0);
  const STANDOFF = Math.max(buf+2, 6);
  const MS = Math.max(2, buf/2);                    // march step
  const cum=[0]; for(let i=1;i<en.length;i++) cum.push(cum[i-1]+Math.hypot(en[i].e-en[i-1].e, en[i].n-en[i-1].n));
  const total=cum[cum.length-1];
  if(!(total>3*STEP)) return pathLL;
  const atS=(s)=>{ let i=1; while(i<cum.length-1 && cum[i]<s) i++;
    const a=en[i-1], b=en[i], seg=(cum[i]-cum[i-1])||1, t=Math.max(0,Math.min(1,(s-cum[i-1])/seg));
    return {e:a.e+(b.e-a.e)*t, n:a.n+(b.n-a.n)*t}; };
  const samp=[]; for(let s=0; s<total-1e-6; s+=STEP) samp.push(atS(s));
  samp.push(en[en.length-1]);
  const N=samp.length; if(N<4) return pathLL;
  // Stretches already laned off the buoys - leave them exactly as they are. The SAME
  // extended centreline the buoy lane was built on, so the stand-on past a mouth is
  // recognised as buoy-laned water and this rule does not re-lane it off the banks.
  const cls=(ko.sys||[]).map(sy=>laneCenterline(sy, ko)).filter(cl=>cl.length>=2);
  const inBuoyChannel=(p)=>{ for(const cl of cls){
      for(let i=1;i<cl.length;i++){ const a=cl[i-1],b=cl[i],dx=b.e-a.e,dy=b.n-a.n,l2=dx*dx+dy*dy||1;
        let t=((p.e-a.e)*dx+(p.n-a.n)*dy)/l2; t=Math.max(0,Math.min(1,t));
        const d=Math.hypot(p.e-(a.e+t*dx), p.n-(a.n+t*dy));
        if(d < Math.max(a.hw||0, b.hw||0)*1.3) return true; } }
    return false; };
  // A BUOY IS NOT A WALL. Lateral marks are also small POINT keep-outs (don't hit a
  // buoy), but a mark is something you may pass either side of - it does not bound the
  // navigable water the way a bank does. Marching against them let a single buoy abeam
  // read as a channel edge, which (a) shoved the track toward the real wall opposite and
  // (b) jogged it back once the buoy passed astern - seen live as a loop by the
  // breakwater on an RTH. Marked channels are handled by buoyChannelLane, which uses the
  // marks properly (as a PAIRED centreline). The full `ko` is still used for every
  // clearance check below, so the lane never plans onto a buoy.
  const koWall = { polys:ko.polys||[], lines:ko.lines||[],
                   points:(ko.points||[]).filter(p=>p.kind!=="a channel buoy") };
  const march=(s,de,dn)=>{ for(let d=MS; d<=CONFINE; d+=MS){ if(blocked({e:s.e+de*d, n:s.n+dn*d},koWall,buf)) return d; }
    return Infinity; };
  const SB=[], shift=new Float64Array(N), have=new Uint8Array(N);
  for(let i=0;i<N;i++){
    const a=samp[Math.max(0,i-1)], b=samp[Math.min(N-1,i+1)];
    let te=b.e-a.e, tn=b.n-a.n; const tl=Math.hypot(te,tn)||1; te/=tl; tn/=tl;
    SB.push([tn,-te]);                              // starboard unit
    if(i===0 || i===N-1 || inBuoyChannel(samp[i])) continue;
    const rc=march(samp[i], tn,-te), lc=march(samp[i], -tn, te);
    if(!(rc<Infinity && lc<Infinity)) continue;     // not confined => not a channel => no lane
    const hw=(rc+lc)/2, ctr=(rc-lc)/2;              // local centreline offset, to starboard
    let d=ctr + LANE_FRAC*hw;                       // ... then the lane, starboard of it
    d=Math.min(d, rc-STANDOFF); d=Math.max(d, -(lc-STANDOFF));
    if(isFinite(d)){ shift[i]=d; have[i]=1; }
  }
  // Blend, but ONLY across samples that actually measured a channel. Averaging in the
  // zeros of non-channel neighbours halved the lane in a short confined stretch
  // (measured on the Canal Basin exit: 15/13/20 m of shift washed down to ~10).
  const sm=new Float64Array(N);
  for(let i=0;i<N;i++){ if(!have[i]) continue; let s=0,c=0;
    for(let k=-1;k<=1;k++){ const j=i+k; if(j>=0&&j<N&&have[j]){ s+=shift[j]; c++; } } sm[i]=s/c; }
  sm[0]=0; sm[N-1]=0;                               // pin the ends (leave start / reach target)
  const out=[];
  for(let i=0;i<N;i++){
    let d=sm[i], p={e:samp[i].e+SB[i][0]*d, n:samp[i].n+SB[i][1]*d}, k=0;
    while(Math.abs(d)>0.5 && blocked(p,ko,buf) && k<8){ d*=0.6; p={e:samp[i].e+SB[i][0]*d, n:samp[i].n+SB[i][1]*d}; k++; }
    out.push(blocked(p,ko,buf) ? samp[i] : p);
  }
  if(out.some((p,i)=>Math.abs(sm[i])>0.5)) sea.laneUsed = true;
  return out.map(p=>fromEN(p.e,p.n,ref));
}
export function channelLaneRoute(pathLL, ref, ko, buf){
  sea.laneUsed = false; sea.lanePartial = false;         // scratch: consumed on the next lines
  let out = buoyChannelLane(pathLL, ref, ko, buf);   // marked channels (buoy-pair centreline)
  out = narrowChannelLane(out, ref, ko, buf);        // unmarked / channel-like confined water
  out = smoothTrack(out, ref, ko, buf);              // round the bends, set the waypoint count
  const g = gateLegClear(out, pathLL, ref, ko, buf); // THE LAW - see gateLegClear above
  // THE KNOT PRUNE LIVES IN THE PRODUCER (moved here 2026-08-10; it was planNogoRoute's
  // alone). A gate SPLICE SEAM can fold a reversal knot: legPath's patch rejoins the lane
  // a few metres BEHIND the point it left, and the shipped route then demands a ~180°
  // turn in less water than any hull can turn in — flown at Lewes as a full 360° orbit
  // at the mouth of Roosevelt Inlet (session 20260810-131214: two 3-4 m reversal steps
  // at the exact splice seam, boat at 13.8 kn with a ~20 m turn radius). planNogoRoute
  // pruned its own output, so Go-To and RTH never showed this; routePlan (Upload) took
  // the lane output RAW, and the survey's approach leg carried the knot to the boat.
  // Pruning here means every consumer inherits it — the same producer-not-consumers rule
  // as gateLegClear itself. The prune is lawful by construction: a waypoint goes only if
  // its neighbours connect CLEAR, so a corner that exists to dodge a keep-out stays.
  const clean = pruneStitch(g.route, ref, ko, buf);
  // `partial` = a lane was ridden but NOT over every channel this route ran along: a
  // second buoy system left un-laned, a stretch rescued by the router, or a leg the gate
  // had to splice. Abandonment already zeroes `lane`, so it cannot also be partial.
  return {route: clean, lane: sea.laneUsed && !g.abandoned,
          partial: (sea.lanePartial || g.splices>0) && sea.laneUsed && !g.abandoned};
}
// PUNCH-OUT channel exclusion (survey coverage only): if a survey line SPANS ACROSS
// a channel, that channel is returned as keep-out polygons so the coverage lines
// clip out of it. "Spans across" = a survey line runs OUTSIDE -> INSIDE the channel
// -> OUTSIDE again (it crosses the fairway). The channel is often FRAGMENTED into
// adjacent polygons, so a sample is treated as "in the channel" if it's inside ANY
// channel poly - internal poly-to-poly boundaries don't count as a crossing. A
// survey CONTAINED within the channel (never goes out->in->out) excludes nothing.
// This augments ONLY the survey-line clip, never the transit routing, so normal
// transits and internal-channel surveys are unaffected. (The TURNS between the
// clipped lines answer to channelTurnKeepouts below, not to this.)
export function channelSpanKeepouts(src, ref, feats, marks){
  const chans=channelPolys(ref, feats, marks);
  if(!chans.length) return [];
  const inChan=(p)=>{ for(const c of chans){ if(inBB(p,c.bb,0) && pinp(p,c.ring)) return true; } return false; };
  // spanning = some survey line goes out -> in -> out across the channel region
  let spans=false;
  for(const l of src){ let seenOut=false, inAfterOut=false, outAfterIn=false, inRun=false;
    for(const p of segSamplesEN(l, ref)){ const ic=inChan(p);
      if(ic){ if(seenOut) inAfterOut=true; inRun=true; }
      else { if(inRun) outAfterIn=true; seenOut=true; inRun=false; } }
    if(inAfterOut && outAfterIn){ spans=true; break; } }
  if(!spans) return [];
  // exclude only the channel polys the survey actually enters (the crossed channel)
  const out=[];
  for(const c of chans){ let entered=false;
    for(const l of src){ for(const p of segSamplesEN(l, ref)){ if(inBB(p,c.bb,0) && pinp(p,c.ring)){ entered=true; break; } } if(entered) break; }
    if(entered) out.push({ring:c.ring, bb:c.bb, kind:"a navigation channel"}); }
  return out;
}
// TURN WATER (survey generation): a reversal turn may only use channel water the
// survey's own coverage lines occupy. Channel polys that contain NO sample of any
// CLIPPED coverage line are returned as keep-outs for the turns, the reversal
// straight-hop check and the serpentine ordering - never for routed region-hop
// transits, which may lawfully cross a channel under channelLaneRoute/gateLegClear.
// The grant is PER POLY and deliberately strict: a channel the survey genuinely
// occupies is granted fragment by fragment as its lines reach each fragment, and a
// wrongly REFUSED turn is a visible straight-hop flag while a wrongly GRANTED one
// is a silent excursion into traffic. This rule exists because generated teardrops
// arced 34 m into the Lewes channel across a charted pile row (2026-08-07): piles
// are charted as POINTS ~60 m apart so the arc threaded their keep-out disks
// lawfully, and a dredged channel is only a blanket keep-out when the operator
// enforces "Dredged / restricted" - which would also stop transiting it.
export function channelTurnKeepouts(clipped, ref, feats, marks){
  const chans=channelPolys(ref, feats, marks);
  if(!chans.length) return [];
  const out=[];
  for(const c of chans){ let entered=false;
    for(const l of clipped){ for(const p of segSamplesEN(l, ref)){ if(inBB(p,c.bb,0) && pinp(p,c.ring)){ entered=true; break; } } if(entered) break; }
    if(!entered) out.push({ring:c.ring, bb:c.bb, kind:"a navigation channel"}); }
  return out;
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
export function gateLegClear(route, fallback, ref, ko, buf){
  if(!route || route.length < 2) return {route, abandoned:false, splices:0};
  const start = route[0], goal = route[route.length-1];
  const near = (at, P) => { const a=llEN(at.lat,at.lon,ref), q=llEN(P.lat,P.lon,ref);
    return Math.hypot(a.e-q.e, a.n-q.n) <= buf*2; };
  const out = route.slice(); let splices = 0;
  for(let i = 1; i < out.length; ){
    if(legClear(out[i-1], out[i], ref, ko, buf)){ i++; continue; }
    const hit = firstBlockAlong(out[i-1], out[i], ref, ko, buf);
    if(hit && (near(hit.at, start) || near(hit.at, goal))){ i++; continue; }
    if(++splices > 20) return {route: fallback.slice(), abandoned:true, splices};
    let j = i;
    while(j < out.length-1 && !legClear(out[j], out[j+1], ref, ko, buf)) j++;
    const patch = legPath(out[i-1], out[j], ref, ko, buf);
    if(!patch) return {route: fallback.slice(), abandoned:true, splices};
    out.splice(i, j - i + 1, ...patch);
    i += patch.length;                                // trust the patch: see above
  }
  // `splices` is reported, not just counted: every one replaced a stretch of LANE with
  // router output that has no starboard bias. Total abandonment was already told to the
  // caller; a route that kept the lane over four fifths of its length and lost it over
  // the rest was not, and read to the operator as a full Rule 9 transit.
  return {route: out, abandoned:false, splices};
}
                            // sub-leg length that keeps cell ~3 m
export function routeAroundSeg(A, B, ref, ko, buf){
  const ae=llEN(A.lat,A.lon,ref), be=llEN(B.lat,B.lon,ref);
  const dist=Math.hypot(be.e-ae.e, be.n-ae.n);
  const margin=Math.max(40, buf*4, Math.min(dist,900));
  const cellSingle=Math.max(3, buf/2, (dist+2*margin)/1400);
  if(cellSingle <= 4.5) return routeAround(A, B, ref, ko, buf);   // already fine enough
  let te=be.e-ae.e, tn=be.n-ae.n; const tl=Math.hypot(te,tn)||1; te/=tl; tn/=tl;
  const pe=tn, pn=-te;                             // perpendicular unit (for split-point nudge)
  const K=Math.max(2, Math.ceil(dist/SEG_LEN_M));
  const bpts=[A];
  for(let i=1;i<K;i++){ const t=i/K, raw={lat:A.lat+(B.lat-A.lat)*t, lon:A.lon+(B.lon-A.lon)*t};
    const snapped=snapClearLL(raw, ref, ko, buf, pe, pn);
    if(!snapped) return routeAround(A, B, ref, ko, buf);          // can't clear a split -> fallback
    bpts.push(snapped); }
  bpts.push(B);
  const out=[];
  for(let i=0;i<bpts.length-1;i++){
    const via=routeAround(bpts[i], bpts[i+1], ref, ko, buf);
    if(via===null) return routeAround(A, B, ref, ko, buf);        // any sub-leg unroutable -> fallback
    out.push(...via);
    if(i < bpts.length-2) out.push(bpts[i+1]);                    // shared interior split point
  }
  // stitch prune: see pruneStitch - kills the split-point hairpin by dropping
  // sharp-turn waypoints whose neighbours connect clear.
  return pruneStitch([{lat:A.lat,lon:A.lon}, ...out, {lat:B.lat,lon:B.lon}], ref, ko, buf).slice(1,-1);
}
export function routeAround(A, B, ref, ko, buffer, marginOv, maxDimOv){
  const en2ll=(e,n)=>({lat:ref.lat+n/M_PER_DEG_LAT, lon:ref.lon+e/(M_PER_DEG_LAT*Math.cos(ref.lat*Math.PI/180))});
  const ae=llEN(A.lat,A.lon,ref), be=llEN(B.lat,B.lon,ref);
  let x0=Math.min(ae.e,be.e), x1=Math.max(ae.e,be.e), y0=Math.min(ae.n,be.n), y1=Math.max(ae.n,be.n);
  // Region = A-B bbox + a BOUNDED swing margin (does NOT scale with the whole
  // transit length - that made the cell coarsen until it could no longer thread a
  // channel and the leg got wrongly flagged red). The occupancy below is RASTERIZED
  // (fast), so a fine channel-resolving cell is affordable even at km scale.
  // `marginOv`/`maxDimOv`: legPath's ESCALATION retries pass wider regions here
  // when the default window cannot round a large landmass (see legPath).
  const dist=Math.hypot(be.e-ae.e, be.n-ae.n);
  const margin=marginOv || Math.max(40, buffer*4, Math.min(dist, 900));
  x0-=margin; x1+=margin; y0-=margin; y1+=margin;
  const maxDim=maxDimOv || 1400;                 // grid-dim cap (coarsen only if huge)
  const cell=Math.max(3, buffer/2, (x1-x0)/maxDim, (y1-y0)/maxDim);
  const W=Math.floor((x1-x0)/cell)+1, H=Math.floor((y1-y0)/cell)+1;
  if(W<2||H<2) return null;
  const EX=gx=>x0+gx*cell, NY=gy=>y0+gy*cell;
  const blk=new Uint8Array(W*H);
  rasterKeepouts(blk, W, H, x0, y0, cell, ko, buffer);   // scanline fill + dilation
  const snapR=Math.max(6, Math.ceil(90/cell));   // start/goal free-cell snap (~90 m, as the old coarse grid reached)
  const freeNear=(gx,gy)=>{ for(let r=0;r<=snapR;r++) for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
    const x=gx+dx,y=gy+dy; if(x<0||y<0||x>=W||y>=H)continue; if(!blk[y*W+x])return [x,y]; } return null; };
  const s=freeNear(Math.round((ae.e-x0)/cell),Math.round((ae.n-y0)/cell));
  const g=freeNear(Math.round((be.e-x0)/cell),Math.round((be.n-y0)/cell));
  if(!s||!g) return null;
  const gS=s[1]*W+s[0], gG=g[1]*W+g[0], N=W*H;
  const gc=new Float64Array(N).fill(Infinity), came=new Int32Array(N).fill(-1), closed=new Uint8Array(N);
  const hh=i=>Math.hypot((i%W)-g[0], ((i/W)|0)-g[1]);
  const heap=[];                                 // binary min-heap of [f, node]
  const hpush=(f,i)=>{ heap.push([f,i]); let k=heap.length-1; while(k>0){const p=(k-1)>>1; if(heap[p][0]<=heap[k][0])break; const t=heap[p];heap[p]=heap[k];heap[k]=t;k=p;} };
  const hpop=()=>{ const top=heap[0],last=heap.pop(); if(heap.length){heap[0]=last;let k=0,n=heap.length; for(;;){let l=2*k+1,r=2*k+2,m=k; if(l<n&&heap[l][0]<heap[m][0])m=l; if(r<n&&heap[r][0]<heap[m][0])m=r; if(m===k)break; const t=heap[m];heap[m]=heap[k];heap[k]=t;k=m;}} return top; };
  const HW=1.6;                                  // heuristic weight: greedier search,
  gc[gS]=0; hpush(HW*hh(gS),gS);                  // near-optimal detour, far fewer nodes
  const nb=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,1.41421],[1,-1,1.41421],[-1,1,1.41421],[-1,-1,1.41421]];
  let found=false, pops=0; const POP_CAP=900000;   // bound a no-path search's cost
  while(heap.length){ if(++pops>POP_CAP) break; const cur=hpop()[1]; if(closed[cur])continue; closed[cur]=1; if(cur===gG){found=true;break;}
    const cgx=cur%W, cgy=(cur/W)|0;
    for(const [dx,dy,w] of nb){ const nx=cgx+dx, ny=cgy+dy; if(nx<0||ny<0||nx>=W||ny>=H)continue; const ni=ny*W+nx; if(blk[ni])continue;
      if(dx&&dy && (blk[cgy*W+nx]||blk[ny*W+cgx]))continue;      // no diagonal corner-cut
      const cand=gc[cur]+w; if(cand<gc[ni]){ gc[ni]=cand; came[ni]=cur; hpush(cand+HW*hh(ni),ni); } } }
  if(!found) return null;
  const path=[]; for(let c=gG;c!==-1;c=came[c]) path.push(c); path.reverse();
  // Collapse collinear runs (a grid A* path is long straight/diagonal segments) so
  // the O(n^2) line-of-sight string-pull below runs over a few dozen TURN points,
  // not the hundreds a fine grid produces - that O(n^2) x exact-clear() was the real
  // cost blow-up on long transits, not A* itself.
  const key=[path[0]];
  for(let i=1;i<path.length-1;i++){ const a=path[i-1],b=path[i],c=path[i+1];
    const ax=a%W,ay=(a/W)|0, bx=b%W,by=(b/W)|0, cx=c%W,cy=(c/W)|0;
    if((bx-ax)*(cy-by)!==(by-ay)*(cx-bx)) key.push(b); }         // keep only direction changes
  if(path.length>1) key.push(path[path.length-1]);
  const pts=[A, ...key.map(c=>en2ll(EX(c%W),NY((c/W)|0))), B];
  // Line-of-sight clearance against the RASTER (O(1) per sample), not exact
  // blocked() (polygon tests). The raster is conservative (over-approximates the
  // keep-outs), so a raster-clear shortcut is genuinely clear - and this keeps the
  // O(n^2) string-pull cheap on long transits (exact clear() over km segments was
  // the blow-up). Sampled at the grid resolution.
  const clear=(p,q)=>{ const pe=llEN(p.lat,p.lon,ref), qe=llEN(q.lat,q.lon,ref);
    const L=Math.hypot(qe.e-pe.e,qe.n-pe.n), n=Math.max(1,Math.ceil(L/cell));
    for(let i=0;i<=n;i++){ const t=i/n, e=pe.e+(qe.e-pe.e)*t, nn=pe.n+(qe.n-pe.n)*t;
      const gx=Math.round((e-x0)/cell), gy=Math.round((nn-y0)/cell);
      if(gx<0||gy<0||gx>=W||gy>=H||blk[gy*W+gx]) return false; } return true; };
  const simp=[pts[0]]; let ci=0;                 // line-of-sight string pull (raster clear)
  while(ci<pts.length-1){ let nx=ci+1; for(let j=pts.length-1;j>ci;j--){ if(clear(pts[ci],pts[j])){nx=j;break;} } simp.push(pts[nx]); ci=nx; }
  // NB: we do NOT reject a route whose leg touching A isn't clear - the boat's own
  // position can legitimately sit within the keep-out buffer (moored at a dock, or
  // marginal charted depth), and the route's job is to lead it OUT. The raster is
  // conservative (over-approximates the keep-outs, never under - verified), so the
  // interior legs the string-pull produced are already clear.
  return simp.slice(1,-1);
}
// Drop any waypoint forming a sharp turn (>60°) whose neighbours connect clear
// (exact legClear). A stitched/refined path keeps only turns an obstacle forces;
// it can only ever SHORTEN a path that is already clear by construction.
export function pruneStitch(full, ref, ko, buf){
  full = full.slice();
  let changed=true;
  while(changed){ changed=false;
    for(let i=1;i<full.length-1;i++){
      const t=((azTo(full[i],full[i+1])-azTo(full[i-1],full[i])+540)%360)-180;
      if(Math.abs(t)>60 && legClear(full[i-1], full[i+1], ref, ko, buf)){
        full.splice(i,1); changed=true; break; }
    }
  }
  return full;
}
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
export function smoothTrack(pathLL, ref, ko, buf){
  if(!pathLL || pathLL.length<2) return pathLL;
  const en = pathLL.map(p=>llEN(p.lat,p.lon,ref));
  const STEP = Math.max(45, buf*13);                // waypoint spacing (the waypoint-count dial)
  // 1) resample by ARC LENGTH at STEP. Per-SEGMENT resampling could only ever ADD points
  // (a segment shorter than STEP still emitted one), so a dense input stayed dense and
  // STEP did not actually control the count. Walking the cumulative length does.
  const cum=[0]; for(let i=1;i<en.length;i++) cum.push(cum[i-1]+Math.hypot(en[i].e-en[i-1].e, en[i].n-en[i-1].n));
  const total=cum[cum.length-1];
  if(!(total>0)) return pathLL;
  const atS=(s)=>{ let i=1; while(i<cum.length-1 && cum[i]<s) i++;
    const a=en[i-1], b=en[i], seg=(cum[i]-cum[i-1])||1, t=Math.max(0,Math.min(1,(s-cum[i-1])/seg));
    return {e:a.e+(b.e-a.e)*t, n:a.n+(b.n-a.n)*t}; };
  let pts=[]; for(let s=0; s<total-1e-6; s+=STEP) pts.push(atS(s));
  pts.push(en[en.length-1]);
  if(pts.length<3) return pathLL;
  const hit=(e,n)=>blocked({e,n},ko,buf);
  for(let pass=0; pass<2; pass++){                  // 2) round the corners (identity on straights)
    const np=[pts[0]];
    for(let i=1;i<pts.length-1;i++){
      const s={e:0.25*pts[i-1].e+0.5*pts[i].e+0.25*pts[i+1].e, n:0.25*pts[i-1].n+0.5*pts[i].n+0.25*pts[i+1].n};
      np.push(hit(s.e,s.n) ? pts[i] : s);           // never smooth a point into a keep-out
    }
    np.push(pts[pts.length-1]);
    pts=np;
  }
  return pts.map(p=>fromEN(p.e,p.n,ref));
}
// Clear waypoint list from A to B ending at B: the direct leg if clear, else a
// routeAround detour. Returns null if no clear route exists.
export function legPath(A, B, ref, ko, buf){
  if(legClear(A, B, ref, ko, buf)) return [{lat:B.lat, lon:B.lon}];
  const via = routeAroundSeg(A, B, ref, ko, buf);   // keeps a fine grid on long transits
  if(via && via.length) return [...via.map(p=>({lat:p.lat,lon:p.lon})), {lat:B.lat, lon:B.lon}];
  // ESCALATING SWING REGION + FINE-ESCAPE COMPOSITION. The fast search region is
  // the A-B bbox + <=900 m, which cannot round a LARGE landmass - the detour
  // leaves that window by kilometres, so a long Go-To was refused while short
  // ones worked. Two stacked constraints: (1) the swing needs a WIDER region ->
  // retry with margin 2700/8100 m (grid coarsens; the raster over-approximates
  // keep-outs, so any path found is genuinely clear); (2) at the coarse cell a
  // tight BASIN/MARINA closes over the start or goal (the free-cell snap fails)
  // -> ESCAPE first: fine-route to a nearby open-water point, then escalate from
  // there. Sections + a safe fallback. Coarse legs are refined with the fine
  // default region and the stitches pruned. Bounded by a time budget.
  const T0=Date.now(), BUDGET_MS=9000;
  const wide=(P0,P1)=>{ for(const m of [2700, 8100]){
      if(Date.now()-T0>BUDGET_MS) return null;
      const c=routeAround(P0, P1, ref, ko, buf, m, 2000); if(c) return c; } return null; };
  const openRing=(C, toward)=>{      // open-water escape candidates, best-first
    const out=[]; const dC=distTo(C, toward);
    for(const r of [400, 800, 1600]) for(let a=0;a<360;a+=30){
      const e=llEN(C.lat,C.lon,ref);
      const p=fromEN(e.e + r*Math.sin(a*Math.PI/180), e.n + r*Math.cos(a*Math.PI/180), ref);
      if(blocked(llEN(p.lat,p.lon,ref), ko, buf*2)) continue;    // want genuinely open water
      if(distTo(p, toward) > dC + r) continue;                    // don't wander away
      out.push(p);
    }
    return out.sort((p,q)=>distTo(p,toward)-distTo(q,toward)).slice(0,6);
  };
  const compose=(pts)=>{             // refine coarse legs, prune stitches, return [...mids, B]
    const fine=[pts[0]];
    for(let i=0;i<pts.length-1;i++){
      if(i) fine.push(pts[i]);
      const sub=routeAroundSeg(pts[i], pts[i+1], ref, ko, buf);
      if(sub && sub.length) fine.push(...sub);
    }
    fine.push(pts[pts.length-1]);
    return pruneStitch(fine, ref, ko, buf).slice(1).map(p=>({lat:p.lat,lon:p.lon}));
  };
  let c = wide(A, B);                                        // (1) direct, wider regions
  if(c) return compose([{lat:A.lat,lon:A.lon}, ...c, {lat:B.lat,lon:B.lon}]);
  for(const E of openRing(A, B)){                            // (2) escape a tight START
    if(Date.now()-T0>BUDGET_MS) break;
    const e1=routeAround(A, E, ref, ko, buf); if(!e1) continue;
    const c2=wide(E, B);
    if(c2) return compose([{lat:A.lat,lon:A.lon}, ...e1, E, ...c2, {lat:B.lat,lon:B.lon}]);
  }
  for(const F of openRing(B, A)){                            // (3) escape a tight GOAL
    if(Date.now()-T0>BUDGET_MS) break;
    const f1=routeAround(F, B, ref, ko, buf); if(!f1) continue;
    const c2=wide(A, F);
    if(c2) return compose([{lat:A.lat,lon:A.lon}, ...c2, F, ...f1, {lat:B.lat,lon:B.lon}]);
  }
  for(const E of openRing(A, B).slice(0,3)){                 // (4) both ends tight
    if(Date.now()-T0>BUDGET_MS) break;
    const e1=routeAround(A, E, ref, ko, buf); if(!e1) continue;
    for(const F of openRing(B, A).slice(0,3)){
      if(Date.now()-T0>BUDGET_MS) break;
      const f1=routeAround(F, B, ref, ko, buf); if(!f1) continue;
      const c2=wide(E, F);
      if(c2) return compose([{lat:A.lat,lon:A.lon}, ...e1, E, ...c2, F, ...f1, {lat:B.lat,lon:B.lon}]);
    }
  }
  return null;
}
// Plan an ENC-aware path from -> to ending at `to`. {route} on success, {error}
// when the target sits in a nogo zone or no clear route exists (refuse + warn).
// Keeps to the starboard side of channels (Rule 9).
export function planNogoRoute(from, to){
  if(!nogo.ready) return {route:[{lat:to.lat,lon:to.lon}], direct:true, degraded:true};
  const ref=nogo.ref, ko=nogo.ko, buf=nogo.buffer;
  const bi = blockedInfo(llEN(to.lat,to.lon,ref), ko, buf);
  if(bi) return {error:"the target sits in "+bi.kind, reason:{mode:"target", info:bi, at:to}};
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
  return {route: kr.route.slice(1), direct: !routed, routed, lane: kr.lane, partial: kr.partial};
}
// Route an ENTIRE run plan clear of nogo: the approach from `start` (present
// position) to wp0, plus every inter-waypoint transit. Detour waypoints are
// inserted where a leg would cross land / a nogo zone. The APPROACH (a transit)
// keeps to the starboard side of any channel (Rule 9); survey-line legs are left
// on their planned track. `keepRightAll` (pure-transit routes) keeps every leg
// starboard. Returns the full routed list + any legs that couldn't be routed.
export function routePlan(start, wps, keepRightAll){
  if(!nogo.ready || !start) return {route: wps.map(p=>({lat:p.lat,lon:p.lon})), unroutable:[], degraded:true};
  const ref=nogo.ref, ko=nogo.ko, buf=nogo.buffer;
  const out=[]; const unroutable=[]; let prev={lat:start.lat, lon:start.lon};
  // ANY leg riding a lane makes it true for the plan. Accumulated here rather than read
  // back afterwards: this runs channelLaneRoute once per leg, so a per-call flag would
  // report only whichever leg happened to be last.
  let lane = false, partial = false;
  wps.forEach((wp, i)=>{
    const leg = legPath(prev, wp, ref, ko, buf);
    if(!leg){ unroutable.push([prev, {lat:wp.lat,lon:wp.lon}]); out.push({lat:wp.lat,lon:wp.lon}); prev=wp; return; }
    let seg = [prev, ...leg];                       // prev … wp
    // Rule 9 keep-right applies to every TRANSIT: the approach (leg 0), any leg of
    // a pure-transit route (keepRightAll), and any ROUTED DETOUR (leg.length>1 -
    // routeAround inserted a transit around obstacles). A straight mission leg in
    // between is left alone - at Upload we can't tell a survey coverage line from
    // a plain hop, and coverage lines must stay on their planned track.
    if(keepRightAll || i===0 || leg.length>1){
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
