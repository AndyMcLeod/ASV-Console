// static/js/chart.js - WHAT THE CHART SAYS, and whether the vessel may be there.
//
// The keep-out model: charted hazards and the extent they really occupy, depth corrected to
// NOW, the clearance tests every behaviour routes against, and the identity of the fairway
// (IALA lateral marks and the channel polygons they define). No DOM, no canvas, no fetch -
// a question in, an answer out - so a suite can call it directly rather than lifting these
// functions out of a 5,000-line page as source text and eval-ing them.
//
// WHAT IS DELIBERATELY NOT HERE: the Rule 9 lane and the keep-out router. Those two are
// mutually recursive - the router asks for a keep-right lane, and building that lane asks
// the router for a path - so they stay in the page for now and will move together as one
// unit. It is also why `gateLegClear` is not here despite reading like a clearance test: it
// calls the router, and importing that back would close a cycle this module avoids.
//
// DEPTHS ARE CORRECTED, NOT CHARTED. Everything works in depth-below-the-vessel-NOW: the
// charted sounding plus the live water-level offset. A charted 0.9 m at +1.2 m of tide is
// navigable water for a 2 m boat, and treating the chart datum as truth would refuse it.
//
// THE BODIES BELOW ARE UNCHANGED FROM THE PAGE. The state they read (`nogo`, `sea.*`,
// `V.*`) moved one commit earlier, on purpose, so this move had nothing left to rewrite.
import { M_PER_DEG_LAT, distTo, fromEN, llEN } from "./geodesy.js";
import { bbOf, inBB, dSeg, pinp, eachRing, eachPath, eachPoint, ptInGeom } from "./geometry.js";
import { V, nogo, sea } from "./state.js";

  // shoreline+manmade+depth+hazards
// CHARTED POINT HAZARDS HAVE AN EXTENT THE CHART DOES NOT GIVE US. A wreck symbol is a
// POSITION, not a size: the casualty under it can be a 100 m ship, and the ENC point
// says nothing about which way it lies. Treating it as a bare point and leaning on the
// nogo buffer for clearance models a wrecked ship as a 3 m dot - a route then only has
// to miss the charted position by the buffer to validate "clear".
//
// So hazards whose EXTENT IS UNKNOWN get an intrinsic radius, and the buffer is added on
// top of it as the margin it was always meant to be. Objects that genuinely ARE point
// sized - piles, buoys, beacons, mooring points - keep the plain buffer (extent 0).
export const HAZ_UNKNOWN_EXTENT = new Set(["Wreck_point", "Hulk_point", "Obstruction_point",
                                    "Underwater_Awash_Rock_point"]);
// Vessel-configurable via planning.wreck_radius_m; loadVessel() overwrites this.
// A wreck with a CHARTED depth over it (VALSOU) is a known quantity: if the corrected
// sounding clears the vessel's own navigability floor by this margin, the boat can pass
// over it and the hazard collapses back to a point. Absent VALSOU means UNKNOWN, which
// is the conservative case - not the permissive one.
export const WRECK_CLEAR_MARGIN_M = 1.0;
// --- real-time water level UI -------------------------------------------- //
// HOW FAR AWAY IS THE TIDE THAT IS BEING APPLIED? A CO-OPS reading is only the local
// water level near its own station. The console interpolates the nearest few, but if the
// nearest is hundreds of km off, the number on screen is another coast's tide - which is
// exactly what showed an Erie level while the boat sat at Lewes (the console had started
// on the Erie vessel; the reading was correctly LABELLED Erie, but it looked as
// authoritative as any other, and the operator has no reason to read the station name on
// a value that is normally trustworthy).
//
// So the readout earns its confidence by distance and says so GRAPHICALLY - a far reading
// is ghosted, a remote one heavily so. Thresholds are about representativeness, not
// nicety: tidal range and phase drift materially over tens of km of coast.
export const WATER_FAR_KM = 25;
      // beyond here the reading is indicative, not local
export const WATER_REMOTE_KM = 75;
// --- IALA-B lateral buoyage: mark identity + BUOY LINES --------------------- //
// A lateral mark carries its channel identity in OBJNAM ("Erie Harbor Lighted
// Buoy 11"): the trailing integer is the buoy NUMBER - which by IALA convention
// increases in the CONVENTIONAL DIRECTION OF BUOYAGE, i.e. toward land (odd =
// green/port-hand, even = red/starboard-hand in region B) - and the leading text
// names the channel SYSTEM. Strip the designator ("[Lighted] [Bell] Buoy N",
// "Light N", "Beacon N", "Junction Buoy M") to get the system name.
export const MARK_TAIL=/\s*(lighted\s+)?(bell\s+|gong\s+|whistle\s+|horn\s+)?(junction\s+)?(buoy|light|beacon|daybeacon|daymark)\b.*$/i;
export function blocked(p, ko, buf){
  for(const poly of ko.polys){ if(!inBB(p,poly.bb,buf)) continue; if(pinp(p,poly.ring)) return true;
    const rg=poly.ring; for(let i=0,j=rg.length-1;i<rg.length;j=i++){ if(dSeg(p,rg[j],rg[i])<buf) return true; } }
  for(const ln of ko.lines){ if(!inBB(p,ln.bb,buf)) continue;
    for(let i=1;i<ln.pts.length;i++){ if(dSeg(p,ln.pts[i-1],ln.pts[i])<buf) return true; } }
  // R = the hazard's OWN extent (0 for a genuinely point-sized object) plus the buffer
  // as the clearance margin. Before this, every point hazard was buffer-sized, so a
  // charted wreck was modelled as a 3 m dot and a route could thread past it.
  for(const pt of ko.points){ const R=buf+(pt.r||0);
    if(Math.abs(p.e-pt.e)>R||Math.abs(p.n-pt.n)>R) continue;
    if(Math.hypot(p.e-pt.e,p.n-pt.n)<R) return true; }
  return false;
}
// Like blocked(), but returns the OFFENDING keep-out (kind + geometry) so a refusal
// can name it and highlight it. null when p is clear.
export function blockedInfo(p, ko, buf){
  for(const poly of ko.polys){ if(!inBB(p,poly.bb,buf)) continue;
    if(pinp(p,poly.ring)) return {kind:poly.kind, type:"poly", ring:poly.ring};
    const rg=poly.ring; for(let i=0,j=rg.length-1;i<rg.length;j=i++){ if(dSeg(p,rg[j],rg[i])<buf) return {kind:poly.kind, type:"poly", ring:poly.ring}; } }
  for(const ln of ko.lines){ if(!inBB(p,ln.bb,buf)) continue;
    for(let i=1;i<ln.pts.length;i++){ if(dSeg(p,ln.pts[i-1],ln.pts[i])<buf) return {kind:ln.kind, type:"line", pts:ln.pts}; } }
  for(const pt of ko.points){ const R=buf+(pt.r||0);
    if(Math.abs(p.e-pt.e)>R||Math.abs(p.n-pt.n)>R) continue;
    if(Math.hypot(p.e-pt.e,p.n-pt.n)<R) return {kind:pt.kind, type:"point", pt:{e:pt.e,n:pt.n}, r:pt.r||0}; }
  return null;
}
// Intrinsic radius (m) of a charted POINT hazard, before the nogo buffer is added.
// Zero for genuinely point-sized objects. For a wreck/hulk/obstruction/awash rock the
// chart gives a position but no extent, so we assume the configured radius UNLESS the
// feature carries a charted sounding over it (VALSOU) proving there is water above:
// corrected to the live water level and compared against the vessel's own navigability
// floor, exactly as depth areas are. No VALSOU means UNKNOWN, and unknown is the
// conservative case - the boat gives it the full berth.
export function hazExtent(f){
  if(!HAZ_UNKNOWN_EXTENT.has(f.cls)) return 0;
  const vs = f.props && f.props.VALSOU;
  if(typeof vs === "number" && (vs + sea.waterOffset) >= V.NOGO_MIN_DEPTH_M + WRECK_CLEAR_MARGIN_M) return 0;
  return V.WRECK_RADIUS_M;
}
// Worst (most conservative) zone of confidence containing the point - M_QUAL
// polygons can overlap, and a survey operator wants the pessimistic answer.
export function qualityAt(lat, lon){
  let worst = null;
  for(const q of (sea.chartInfo && sea.chartInfo.quality) || []){
    if(!ptInGeom(lat, lon, q.geometry)) continue;
    const z = Number(q.props.CATZOC) || 6;
    if(!worst || z > (Number(worst.CATZOC) || 6)) worst = q.props;
  }
  return worst;
}
// The active vessel's planning.nogo_buffer_m is a FLOOR. A persisted mission carries
// whatever buffer it was saved with - often a smaller boat's - and silently applying
// that to a bigger, deeper vessel would give it LESS clearance than its own file
// demands. The operator can still widen it beyond the floor from the panel.
export function bufferFloor(missionBuf){
  return Math.max(V.NOGO_BUFFER_M, (typeof missionBuf === "number") ? missionBuf : V.NOGO_BUFFER_M);
}
// local ENU (metres) about a reference lat/lon
// A human-readable category for a keep-out, so a refusal can say WHAT blocks it.
export function nogoKind(r, depthbad){
  if(depthbad) return "water shallower than "+V.NOGO_MIN_DEPTH_M.toFixed(1)+" m";
  if(r==="dock"||r==="dock_line") return "a dock / pier";
  if(r==="hazard_area"||r==="hazard_point") return "a charted hazard";
  if(r==="dredged") return "a dredged area";
  if(r==="restricted") return "a restricted area";
  if(r==="shore_line") return "the shoreline";
  return "land";
}
// --- what the Nogo row SAYS, and why --------------------------------------- //
// It used to collapse the whole model into "loading…" or a bare zone count, which told
// the operator neither what the console was doing nor - when it came up empty - WHY.
// The same lesson as the AIS table's link status: NAME THE STATE. "no zones" because the
// water is clear and "no zones" because there is no chart are opposite facts, and only
// one of them means every route is now unverified.
//
// Every state is DERIVED from values that already exist - `busy`, `nogo.band` (set only
// by a successful extract, so it is the "we have chart data" fact), `nogo.note` (why not,
// when not) and the keep-out counts. No new state field, so nothing can drift out of step
// with the model the behaviours actually route against.
export function nogoKindCounts(){                      // tally the keep-outs by their own kind names
  const c = {}, ko = nogo.ko;
  if(!ko) return c;
  for(const grp of [ko.polys, ko.lines, ko.points])
    for(const k of (grp || [])){
      const kind = String(k.kind || "keep-out").replace(/^(a|an|the) /, "");
      c[kind] = (c[kind] || 0) + 1;
    }
  return c;
}
// sampled straight-leg clearance vs a keep-out model
export function legClear(a, b, ref, ko, buf){
  const ae=llEN(a.lat,a.lon,ref), be=llEN(b.lat,b.lon,ref);
  const L=Math.hypot(be.e-ae.e,be.n-ae.n), n=Math.max(1,Math.ceil(L/Math.max(2,buf/2)));
  for(let i=0;i<=n;i++){ const t=i/n;
    if(blocked({e:ae.e+(be.e-ae.e)*t, n:ae.n+(be.n-ae.n)*t}, ko, buf)) return false; }
  return true;
}
// Offending feature + spot for one unroutable leg a->b (its direct line is blocked).
export function legReason(a, b){
  if(!nogo.ready) return null;
  const fb=firstBlockAlong(a, b, nogo.ref, nogo.ko, nogo.buffer);
  return fb ? {mode:"leg", info:fb.info, at:fb.at} : null;
}
export function legReasons(legs){ return (legs||[]).map(([a,b])=>legReason(a,b)).filter(Boolean); }
// Walk the DIRECT line from->to and return the first spot that's blocked (+ what by),
// used to explain/point at a "boxed in" target that itself sits in clear water.
export function firstBlockAlong(fromLL, toLL, ref, ko, buf){
  const a=llEN(fromLL.lat,fromLL.lon,ref), b=llEN(toLL.lat,toLL.lon,ref);
  const L=Math.hypot(b.e-a.e,b.n-a.n); const n=Math.max(2,Math.ceil(L/Math.max(2,buf/2)));
  for(let i=0;i<=n;i++){ const t=i/n; const p={e:a.e+(b.e-a.e)*t, n:a.n+(b.n-a.n)*t};
    const info=blockedInfo(p,ko,buf); if(info) return {at:fromEN(p.e,p.n,ref), info}; }
  return null;
}
export function snapClearLL(p, ref, ko, buf, pe, pn){     // nudge p along +/-(pe,pn) to clear water
  if(!blocked(llEN(p.lat,p.lon,ref), ko, buf)) return p;
  const base=llEN(p.lat,p.lon,ref), lim=Math.max(150, buf*20);
  for(let d=Math.max(3,buf); d<=lim; d+=Math.max(3,buf)){
    for(const s of [1,-1]){ const e=base.e+pe*d*s, n=base.n+pn*d*s;
      if(!blocked({e,n}, ko, buf)) return fromEN(e,n,ref); } }
  return null;                                     // couldn't clear -> caller falls back
}
// Is this ENC depth area OUTSIDE the survey depth window? Classify by the band's
// DEEPEST value so a band that straddles the minimum (e.g. 1.8-3.6 m vs a 2 m
// min) is KEPT - only bands entirely shallower than the minimum are excluded, so
// genuinely deeper water is no longer clipped. Too-deep only applies if a max is
// set (blank max => deep water is fine to survey).
export function depthExcluded(f, dr){
  if(f.role !== "depth_area") return false;
  const d1 = f.props.DRVAL1, d2 = f.props.DRVAL2;
  // charted depths are to a fixed datum (LWD / MLLW); add the live water level to
  // get ACTUAL available depth right now.
  const deepest = (d2!=null) ? d2 + sea.waterOffset : (d1!=null ? d1 + sea.waterOffset : null);
  const shallowest = (d1!=null) ? d1 + sea.waterOffset : (d2!=null ? d2 + sea.waterOffset : null);
  const tooShallow = (deepest!=null && deepest < dr.min);
  const tooDeep = (dr.max>0 && shallowest!=null && shallowest > dr.max);
  return tooShallow || tooDeep;
}
   // beyond here it is simply another area's tide
export function waterTrust(wl){
  if(!wl || !wl.ok || wl.source==="manual") return {level:"local", km:null};
  const stns = wl.stations || [];
  // The NEAREST contributing station is what decides it: an interpolation dominated by a
  // close station is still local even if a distant one is blended in.
  let km = null;
  for(const st of stns){ if(typeof st.dist_km === "number" && (km===null || st.dist_km<km)) km = st.dist_km; }
  if(km === null) return {level:"local", km:null};
  return {level: km > WATER_REMOTE_KM ? "remote" : (km > WATER_FAR_KM ? "far" : "local"), km};
}
// THE OFFSET THAT ACTUALLY CORRECTS CHARTED DEPTHS. Displaying a distant station's tide
// is one thing; APPLYING it to the nogo depth floor is another. A remote reading is not
// information about local water, and adding it would credit the boat with depth nobody
// has measured here - an 800 km tide of +1.16 m makes shallow water look 1.16 m deeper
// than it is, which is the same failure mode as trusting a chart symbol without its size.
//
// So a `remote` reading is SHOWN (ghosted, so the operator can see what the distant
// station says) but NOT APPLIED: routing falls back to chart datum, exactly as it already
// does when there is no data at all. `far` is still applied - it is indicative rather
// than irrelevant, and the ghosting says so.
//
// RESIDUAL, unchanged by this and shared with the no-data path: chart datum is the
// LOW-water reference, so if the real local tide is BELOW datum, charted depths are
// optimistic. The manual override exists for that case.
export function effectiveWaterOffset(wl){
  if(!wl || !wl.ok || wl.offset_m == null) return 0;
  // The manual-override exemption lives in waterTrust() and ONLY there - an operator's own
  // number is never "remote". Repeating the check here looked like defence in depth but was
  // unreachable, and an unreachable guard is a guard nobody is testing.
  return waterTrust(wl).level === "remote" ? 0 : wl.offset_m;
}
export function buildKeepouts(ref, enf, dr, feats){
  const polys=[], lines=[], points=[], marks=[];
  for(const f of (feats || sea.enc.features)){ const g=f.geometry, r=f.role;
    const land=(r==="land"||r==="dock"||r==="hazard_area"), shore=(r==="shore_line"||r==="dock_line");
    const depthbad=depthExcluded(f, dr), haz=(r==="hazard_point"), area=(r==="dredged"||r==="restricted");
    // LATERAL channel marks (buoys/beacons): collected as channel-defining marks
    // (paired into the Rule 9 channel centreline by systemCenterline) AND kept clear
    // as small point keep-outs (don't hit a buoy).
    // CATLAM: 1/3 = port-hand, 2/4 = starboard-hand.
    if(r==="chan_mark"){ const cat=f.props&&f.props.CATLAM, id=markId(f.props);
      eachPoint(g,c=>{ const q=llEN(c[1],c[0],ref);
        marks.push({e:q.e, n:q.n, side:(cat==2||cat==4)?1:(cat==1||cat==3)?-1:0, num:id.num, sys:id.sys});
        if(enf.haz){ const p={e:q.e,n:q.n,kind:"a channel buoy"}; points.push(p); } });
      continue; }
    if((land||shore)&&!enf.land) continue;
    if(depthbad&&!enf.depth) continue;
    if(haz&&!enf.haz) continue;
    if(area&&!enf.area) continue;
    const kind=nogoKind(r, depthbad);
    if(land||depthbad||area) eachRing(g,rg=>{ const ring=rg.map(c=>llEN(c[1],c[0],ref)); if(ring.length>2) polys.push({ring,bb:bbOf(ring),kind}); });
    else if(shore) eachPath(g,p=>{ const pts=p.map(c=>llEN(c[1],c[0],ref)); if(pts.length>1) lines.push({pts,bb:bbOf(pts),kind}); });
    else if(haz){ const r=hazExtent(f);
      eachPoint(g,c=>{ const q=llEN(c[1],c[0],ref); q.kind=kind; q.r=r; points.push(q); }); }
  }
  return {polys, lines, points, marks, sys:markSystems(marks)};
}
// --- app-level ENC NOGO: build once, every behavior routes clear of it ---- //
export function nogoDR(){ return {min: V.NOGO_MIN_DEPTH_M, max: 0}; }
export function markId(props){
  const nm=(props&&props.OBJNAM)||"";
  const m=nm.match(/(\d+)\s*[A-Za-z]?\s*$/);
  return {num: m?parseInt(m[1],10):null, sys: nm.replace(MARK_TAIL,"").trim().toLowerCase()};
}
// Group the marks into channel SYSTEMS and, within each, into the two ordered
// BUOY LINES (port-hand and starboard-hand, ordered by number = ordered inbound).
// Two refinements matter on real ENC data:
//  * DEDUPE - a buoy is charted twice (e.g. "Erie Harbor Buoy 9" AND "Erie Harbor
//    Lighted Buoy 9") at identical coordinates; without this the line doubles back.
//  * PREFIX MERGE - "Erie Harbor Entrance" (buoys 1-5) and "Erie Harbor" (7-14) are
//    the same channel continuing inland. Merging systems where one name is a word
//    prefix of the other (and their numbers don't collide) closes the ~2 km unmarked
//    gap between the entrance pair and the inner pairs, so the buoy line runs
//    continuously from the seaward gate to the head of the harbour. Unrelated
//    systems ("Presque Isle Park", "Erie Yacht Club Entrance") stay separate, each
//    with its own numbering restarting at 1.
export function markSystems(marks){
  const seen=new Set(), uniq=[];
  for(const m of (marks||[])){                       // dedupe co-located duplicates
    const k=Math.round(m.e/3)+","+Math.round(m.n/3)+","+m.side;
    if(seen.has(k)) continue; seen.add(k); uniq.push(m); }
  const by=new Map();
  for(const m of uniq){ const s=m.sys||""; if(!by.has(s)) by.set(s,[]); by.get(s).push(m); }
  const names=[...by.keys()].filter(s=>s), merged=new Map();
  const rootOf=(s)=>{ let r=s;                       // shortest word-prefix of s that is itself a system
    for(const o of names){ if(o!==s && o.length<r.length && s.startsWith(o+" ")){
      const a=by.get(o).map(x=>x.num).filter(x=>x!=null), b=by.get(s).map(x=>x.num).filter(x=>x!=null);
      if(!a.some(x=>b.includes(x))) r=o; } }
    return r; };
  for(const s of names){ const r=rootOf(s); if(!merged.has(r)) merged.set(r,[]); merged.get(r).push(...by.get(s)); }
  const out=[];
  for(const [sys,ms] of merged){
    const num=(a,b)=>a.num-b.num;
    const port=ms.filter(m=>m.side<0 && m.num!=null).sort(num);
    const stbd=ms.filter(m=>m.side>0 && m.num!=null).sort(num);
    if(port.length||stbd.length) out.push({sys, port, stbd});
  }
  return out;
}
// The CENTRELINE of one buoy system (E/N), ordered along the channel: pair each
// port-hand buoy with its nearest starboard-hand buoy and take the midpoint, then
// order by buoy NUMBER (which by convention runs along the channel). Deduped. This is
// the geometric middle of the buoyed fairway, independent of any routed base path.
// Each point also carries `hw` = the channel HALF-WIDTH there (centreline to either
// buoy line), which sets how far off the centreline the Rule 9 lane rides.
export function systemCenterline(sy){
  if(!sy || !sy.port || !sy.stbd || !sy.port.length || !sy.stbd.length) return [];
  const mids=[];
  for(const p of sy.port){ let best=null, bd=1e18;
    for(const s of sy.stbd){ const d=Math.hypot(s.e-p.e, s.n-p.n); if(d<bd){ bd=d; best=s; } }
    if(best && bd>=10 && bd<=500) mids.push({e:(p.e+best.e)/2, n:(p.n+best.n)/2, hw:bd/2, num:(p.num!=null?p.num:0)}); }
  mids.sort((a,b)=>a.num-b.num);
  const out=[];
  for(const q of mids){ if(!out.length || Math.hypot(q.e-out[out.length-1].e, q.n-out[out.length-1].n)>10)
    out.push({e:q.e, n:q.n, hw:q.hw}); }
  return out;
}
// Pair the lateral marks into channel GATES: each port-hand mark with its nearest
// starboard-hand mark across the channel (15-400 m apart), giving the gate centre, its
// width, and the channel axis through it. Used by channelSpanKeepouts to sweep a marked
// fairway into a corridor polygon where no dredged area is charted.
export function pairGates(marks){
  const ports=(marks||[]).filter(m=>m.side<0), stbds=(marks||[]).filter(m=>m.side>0), gates=[];
  for(const p of ports){ let best=null, bd=1e9;
    for(const s of stbds){ const d=Math.hypot(s.e-p.e, s.n-p.n); if(d>=15 && d<=400 && d<bd){ bd=d; best=s; } }
    if(best){ const C={e:(p.e+best.e)/2, n:(p.n+best.n)/2}, gx=(best.e-p.e)/bd, gy=(best.n-p.n)/bd;
      gates.push({C, width:bd, axis:[-gy, gx]}); } }   // axis = perpendicular to the gate line
  return gates;
}
// Charted-channel polygons: the ENC dredged areas plus the buoy-gate FAIRWAY
// corridors (the marked channel where no dredged polygon is charted, e.g. an
// inlet mouth). ONE list, shared by the span clip and the turn-water rule below,
// so "what counts as a channel" cannot drift between the two.
export function channelPolys(ref, feats, marks){
  const chans=[];
  // 1) dredged-area channels
  for(const f of (feats||[])){ if(f.role!=="dredged") continue;
    eachRing(f.geometry, rg=>{ const ring=rg.map(c=>llEN(c[1],c[0],ref)); if(ring.length>=3) chans.push({ring, bb:bbOf(ring)}); }); }
  // 2) buoy-gate corridors: pair the lateral marks into gates, then sweep each
  // gate line +/- one gate-width along the channel axis into a corridor polygon.
  for(const g of pairGates(marks)){
    const gux=g.axis[1], guy=-g.axis[0];         // gate-line unit (port -> starboard)
    const P={e:g.C.e-gux*g.width/2, n:g.C.n-guy*g.width/2};   // port mark
    const S={e:g.C.e+gux*g.width/2, n:g.C.n+guy*g.width/2};   // starboard mark
    const [ax,ay]=g.axis, Le=g.width;            // extend one gate-width each way along the channel
    const ring=[ {e:P.e-ax*Le,n:P.n-ay*Le}, {e:S.e-ax*Le,n:S.n-ay*Le},
                 {e:S.e+ax*Le,n:S.n+ay*Le}, {e:P.e+ax*Le,n:P.n+ay*Le} ];
    chans.push({ring, bb:bbOf(ring)});
  }
  return chans;
}
