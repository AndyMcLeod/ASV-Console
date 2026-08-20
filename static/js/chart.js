// static/js/chart.js - WHAT THE CHART SAYS, and whether the vessel may be there.
//
// The keep-out model: charted hazards and the extent they really occupy, depth corrected to
// NOW, the clearance tests every behaviour routes against, and the identity of the fairway
// (IALA lateral marks and the channel polygons they define). No DOM, no canvas, no fetch -
// a question in, an answer out - so a suite can call it directly rather than lifting these
// functions out of a 5,000-line page as source text and eval-ing them.
//
// THE SHARED BODIES MOVED TO asv_core ON 2026-08-20, and this file is now the seam that
// keeps them speaking this console's language. WorldView had the same eighteen symbols --
// its own file says it was ported FROM here -- and once Andy ruled `frame` rather than a
// bare ref, the two were one algorithm with two parameter lists. Measured before the move,
// this file against WorldView's, both handed THIS console's flat frame:
//
//     buildKeepouts    0.000e+0 m over 612 vertices, every bucket count identical
//                      (polys lines points marks sys chans) -- and again with areas
//                      enforced, hazards off, land off, and a 2.0-6.0 m depth window
//     blocked          0 of 1200 disagree (805 blocked)
//     blockedInfo      0 of 1200 -- same kind, same type
//     legClear         0 of 400 (70 clear, 330 blocked)
//     firstBlockAlong  0 of 400, worst reported position 0.000e+0 m
//     markId 0 of 10 names; markSystems, pairGates, systemCenterline, extendCenterline
//       and channelPolys JSON-identical; depthExcluded 0 of 90; hazExtent 0 of 63
//
// FOUR ARE WRAPPED RATHER THAN RE-EXPORTED, AND THAT IS A COST, STATED. buildKeepouts,
// hazExtent, depthExcluded and nogoKind read V.* and sea.* here where the core takes
// options. Wrapping keeps all 26 call sites in asv.html, passage.js and the suites exactly
// as they were, at the price of one object built per call. Same trade as geodesy.js.
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
// That correction is what the `waterOffsetM` option below carries into the core.
import { fromEN, llEN } from "./geodesy.js";
import { snapClearLL } from "./routing.js";
export { snapClearLL };
import { ptInGeom } from "./geometry.js";
import { V, nogo, sea } from "./state.js";
// THE SHARED KEEP-OUT LAYER. `blocked` is used below by snapClearLL and `firstBlockAlong`
// by legReason; the rest pass straight through to this console's importers.
import { HAZ_UNKNOWN_EXTENT, WRECK_CLEAR_MARGIN_M, MARK_TAIL, CL_EXTEND_CAP_M,
         blocked, blockedInfo, legClear, firstBlockAlong,
         markId, markSystems, systemCenterline, extendCenterline, pairGates, channelPolys,
         buildKeepouts as coreBuildKeepouts, hazExtent as coreHazExtent,
         depthExcluded as coreDepthExcluded, nogoKind as coreNogoKind } from "./keepouts.js";
export { HAZ_UNKNOWN_EXTENT, WRECK_CLEAR_MARGIN_M, MARK_TAIL, CL_EXTEND_CAP_M,
         blocked, blockedInfo, legClear, firstBlockAlong,
         markId, markSystems, systemCenterline, extendCenterline, pairGates, channelPolys };

// THE ONE SEAM WHERE THIS CONSOLE'S STATE BECOMES THE CORE'S OPTIONS. Built per call
// rather than cached because every field is live: V.* is rewritten when the operator
// switches hull, and sea.waterOffset moves with the tide. Caching it is exactly the
// staleness state.js warns about, in the direction that gives a deeper boat LESS clearance
// than its own file demands.
//
// The three values are the same numbers the core defaults to, checked rather than assumed -
// V.NOGO_MIN_DEPTH_M, V.WRECK_RADIUS_M and V.NOGO_BUFFER_M equal DEFAULTS.minDepthM,
// .wreckRadiusM and .bufferM exactly. What makes them worth passing is that all three are
// vessel-configurable here and the defaults are not.
function koOpts(){
  return {minDepthM: V.NOGO_MIN_DEPTH_M, wreckRadiusM: V.WRECK_RADIUS_M,
          bufferM: V.NOGO_BUFFER_M, waterOffsetM: sea.waterOffset};
}

  // shoreline+manmade+depth+hazards
// CHARTED POINT HAZARDS HAVE AN EXTENT THE CHART DOES NOT GIVE US. A wreck symbol is a
// POSITION, not a size: the casualty under it can be a 100 m ship, and the ENC point
// says nothing about which way it lies. Treating it as a bare point and leaning on the
// nogo buffer for clearance models a wrecked ship as a 3 m dot - a route then only has
// to miss the charted position by the buffer to validate "clear".
//
// So hazards whose EXTENT IS UNKNOWN get an intrinsic radius (HAZ_UNKNOWN_EXTENT, in the
// core), and the buffer is added on top of it as the margin it was always meant to be.
// Objects that genuinely ARE point sized - piles, buoys, beacons, mooring points - keep
// the plain buffer (extent 0).
//
// Vessel-configurable via planning.wreck_radius_m; loadVessel() overwrites V.WRECK_RADIUS_M,
// and koOpts() is what carries it into the shared body.
export function hazExtent(f){ return coreHazExtent(f, koOpts()); }
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
// A human-readable category for a keep-out, so a refusal can say WHAT blocks it.
//
// THE CORE'S ANSWER FOR "chan_mark" IS "a channel buoy" WHERE THIS FILE USED TO SAY
// "land", and nothing can reach the difference: buildKeepouts is the only caller in either
// repo, and it handles marks and CONTINUES before this is called - the buoy points it
// builds are labelled at the push site. The core's is the correct answer and the model was
// never affected either way; the core's tests/keepouts.py pins the unreachability rather
// than the strings, because an unreachable branch asserted by its output is a comment.
export function nogoKind(r, depthbad){ return coreNogoKind(r, depthbad, koOpts()); }
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
// Offending feature + spot for one unroutable leg a->b (its direct line is blocked).
export function legReason(a, b){
  if(!nogo.ready) return null;
  const fb=firstBlockAlong(a, b, nogo.frame, nogo.ko, nogo.buffer);
  return fb ? {mode:"leg", info:fb.info, at:fb.at} : null;
}
export function legReasons(legs){ return (legs||[]).map(([a,b])=>legReason(a,b)).filter(Boolean); }
// snapClearLL -- nudge a point along +/-(pe,pn) until it clears water -- IS THE CORE'S
// NOW. WorldView kept the same function in its router.js and the two were measured side by
// side before the move: 0 of 300 cases differ, 187 of them actually moving the point and
// 113 refusing. It arrives from the ROUTING module rather than the keep-out one because
// that is the file WorldView kept it in, and this console's importers name it here.
// Is this ENC depth area OUTSIDE the survey depth window? Classify by the band's
// DEEPEST value so a band that straddles the minimum (e.g. 1.8-3.6 m vs a 2 m
// min) is KEPT - only bands entirely shallower than the minimum are excluded, so
// genuinely deeper water is no longer clipped. Too-deep only applies if a max is
// set (blank max => deep water is fine to survey).
//
// The live water level is the third argument in the core; here it is read from `sea` so
// the 20-odd call sites keep their two-argument shape.
export function depthExcluded(f, dr){ return coreDepthExcluded(f, dr, sea.waterOffset); }
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
// Build the keep-out model. `ref` is a FRAME (Andy, 2026-08-20) - planeFrame() gives
// {toEN, fromEN} over this console's flat plane, which is the interface the core body
// takes, so the model that comes back is the one this console has always built.
//
// `feats` defaults to the fetched extract, which the core does NOT do - it takes what it
// is given. That default is this console's, so it stays here.
//
// ONE SEMANTIC CHANGED, AND IT IS FAIL-SAFE. A key ABSENT from `enf` used to read as
// falsy - i.e. disarmed - so a caller who forgot `land` silently got no shoreline
// keep-outs at all. The core defaults an absent key to its armed value (area alone
// defaults off, because a charted area is advisory) and REFUSES a key that is not one of
// the four, so WorldView's old `hazard` spelling can no longer be dropped on the floor.
// Every caller here passes a full {...NOGO_ENF}, so nothing in this console moves.
export function buildKeepouts(ref, enf, dr, feats){
  return coreBuildKeepouts(ref, feats || sea.enc.features,
                           {...koOpts(), depthRange: dr, enforce: enf});
}
// --- app-level ENC NOGO: build once, every behavior routes clear of it ---- //
export function nogoDR(){ return {min: V.NOGO_MIN_DEPTH_M, max: 0}; }
