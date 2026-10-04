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
// from the channel centerline - NOT from buoy color, so it holds in either IALA region and
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
import { M_PER_DEG_LAT, azTo, distTo, llEN } from "./geodesy.js";
import { V, nogo, sea } from "./state.js";
import { blockedInfo, firstBlockAlong, legClear } from "./chart.js";
// Where a boat is asked to hold, and how much water it has there (the hold DISC).
import { HOLD_RADIUS_MIN_M, holdClearM, holdMarginM, snapCapM, snapClearRadial } from "./hold.js";
// The shared routing layer. `legPath` is used below by planNogoRoute and routePlan; the
// rest pass straight through to this console's importers, which are untouched.
import { LANE_FRAC, SEG_LEN_M, buoyChannelLane, narrowChannelLane, smoothTrack,
         chartedChannelLane, markPassRoute, marksKept, markVerdicts, tallyMarks, chartedRide,
         gateLegClear, channelSpanKeepouts, channelTurnKeepouts,
         routeAround, routeAroundSeg, pruneStitch, legPath,
         channelLaneRoute as coreChannelLaneRoute,
         stampSeg, dilateGrid, rasterKeepouts } from "./routing.js";
export { LANE_FRAC, SEG_LEN_M, buoyChannelLane, narrowChannelLane, smoothTrack,
         chartedChannelLane, markPassRoute, marksKept,
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
//
// `how` (2026-10-03) SAYS WHICH KEEP-RIGHT IT WAS, because there are three now and they put
// her in different water: three quarters of the way across a channel the CHART draws; the
// lane off a pair of buoy lines or the banks of a narrow cut; and lateral marks left one by
// one on their proper hand. A plan that carries no `how` reads as it always did.
export function laneHow(how){
  const parts = [];
  if(how && how.charted) parts.push("right of center in the charted channel");
  if(!how || how.pairs || how.narrow) parts.push("channel lane, centerline to port");
  const mk = how && how.marks;
  if(mk && mk.kept){
    const n = (k, hand) => k + " mark" + (k === 1 ? "" : "s") + " left to " + hand;
    parts.push([mk.stbd ? n(mk.stbd, "starboard") : "", mk.port ? n(mk.port, "port") : ""].filter(Boolean).join(", "));
  }
  return parts;
}
export function buoyageNote(lane, partial, how){
  // Go-To / RTH / Transit ride the CHANNEL LANE: offset to starboard of the buoy-pair
  // centerline, so the centerline stays to port and the starboard-hand marks to
  // starboard - either direction of travel.
  //
  // A PARTIAL LANE SAYS SO. The banner is the only thing telling the operator whether
  // the boat is keeping right, and "Rule 9: channel lane" over a route that rides one
  // channel's centerline dead on, or that lost the lane to a spliced detour, is worse
  // than no banner: it is a claim they would otherwise have checked.
  if(!lane) return "";
  const wrong = (how && how.marks && how.marks.wrong) || 0;
  // ⚠ A MARK ON THE WRONG HAND IS SAID AS THAT, not folded into "not laned": it is the one
  // thing here the operator can check against the chart at a glance, and the one a pilot
  // would ask about first.
  return "Rule 9: " + laneHow(how).join("; ")
       + (wrong ? " — " + wrong + " mark" + (wrong === 1 ? "" : "s") + " NOT left on the proper hand" : "")
       + (partial && (!how || how.gaps) ? " — PARTIAL: some of this route is not laned" : "");
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
// keep-out, then buoyChannelLane REPLACED that route with the buoy-gate centerline
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
// every transit: ride a lane offset to STARBOARD of the channel CENTERLINE, half
// the local half-width out (= a quarter of the full width in from the edge), so the
// centerline stays to PORT. Color is never an input - it falls out, because IALA
// lateral marks sit on fixed sides. Direction of travel picks the side, so inbound
// and outbound ride opposite halves and opposing traffic passes port-to-port.
// Marked channels take the centerline from PAIRED buoy midpoints; unmarked but
// confined water takes it from the water's own edges. This REPLACED an earlier
// color-driven buoy-line rule that rode the wrong side of the buoys on the water
// twice, because it derived its offset from a fragile edge ray-march instead of
// from the centerline. That rule and its color helpers were deleted 2026-08-02.
// ============================================================================
// Smooth + densify a coarse waypoint list into a followable track. The channel
// centerline has only ONE point per buoy pair, so a bare boat->midpoints->target path
// dog-legs at each bend and is too sparse for the follower to track smoothly. Two
// steps: (1) linearly RESAMPLE onto ~STEP-spaced points that lie exactly on the input
// polyline (so straight runs stay dead on the centerline); (2) round the corners with a
// couple of light [0.25,0.5,0.25] smoothing passes - identity on a straight run, so it
// only rounds the bends, and it can only move a point INWARD (never bulging into the
// far bank). Endpoints are fixed; a smoothed point that would land in a keep-out is left
// un-smoothed. Net: many waypoints, on the centerline on the straights, gently rounded
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
  // `opts.ko` (2026-09-27): a model in place of the charted one - the page routes a way in round the
  // AIS contacts as well, and those live in the guard's model, never in nogo.ko.
  const ref=nogo.frame, ko=(opts && opts.ko) || nogo.ko, buf=nogo.buffer;
  // A FLY-THROUGH TARGET IS NOT A BERTH (2026-09-27, found on the first rehearsal with a test contact). The way in
  // to a survey's rejoin point ends at a waypoint the boat passes THROUGH at speed - the plan's own next leg
  // carries her on - so it needs the buffer, not a hold's margin and disc. Judged as a berth, the first point of
  // the line beyond a contact's ring (a standoff off it, 3 m) was "too tight to hold in" (the 6 m margin), moved
  // off the line, and the resume refused with "inside a keep-out" - the automatic way round at the minute would
  // have failed the same way. With `opts.flyThrough` the target stands where it is if it is clear at the buffer,
  // and is refused BY NAME if it is not; nothing is relocated. Go-To, RTH and the hold keep the berth test.
  if(opts && opts.flyThrough){
    const en0 = llEN(to.lat,to.lon,ref);
    const bi0 = blockedInfo(en0, ko, buf);
    if(bi0) return {error:"the target sits in "+bi0.kind, reason:{mode:"target", info:bi0, at:to}};
    return {to:{lat:to.lat,lon:to.lon}, heldOff:null, need:null, holdClear: discInChart(holdClearM(en0, ko, buf), to, buf)};
  }
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
  // ⚠⚠ ONE DEFINITION OF "THIS POINT CAN HOLD A BOAT", AND IT IS THE SNAP'S OWN. The gate
  // that stood here asked only for the working MARGIN (`holdClearM(en) < need`), while
  // snapClearRadial's acceptance also asks for the whole hold DISC - `buf + holdR`. Wherever
  // the hold radius exceeds the margin the two part company, and a point with room for the
  // BOAT but none for its WANDER was never offered to the search: the target was accepted
  // where it stood, `heldOff` came back null, and the vessel was handed a `hold_clear_m`
  // describing a disc it does not fit in. Measured 13 m off a pier face with a 20 m approach
  // radius: 8.0 m of clear water - which satisfies the margin - and 13 of the 36 points of
  // the commanded disc blocked.
  //
  // Asking ALWAYS costs one clearance test, and `moved: 0` is the snap's own way of saying
  // "the point as given was fine" - so a berth in open water is still left exactly where the
  // operator put it (tests/hold_point.js 6e and 8 hold that half).
  {
    const sn = snapClearRadial(en, ko, buf, holdR, {need, setE, setN});
    // ⚠ NAME THE CAUSE THE CODE ACTUALLY MEASURED. With the gate gone, a refusal can now
    // arrive at a target whose MARGIN is satisfied and whose hold DISC is not - and telling
    // that operator "under N m of clear water" would be asserting something the number in
    // front of them contradicts.
    if(!sn) return {error:(bi ? "the target sits in "+bi.kind
                            : holdClearM(en, ko, buf) < need
                              ? "the target has under "+need.toFixed(0)+" m of clear water"
                              : "the target has room for the boat but not for the "
                                +holdR.toFixed(0)+" m it may wander while holding")
                          +" and nowhere within "+snapCapM(buf).toFixed(0)
                          +" m of it holds a boat clear",
                    reason:{mode:"target", info:bi, at:to}};
    if(sn.moved > 0){
      const nt = ref.fromEN(sn.e, sn.n);
      // WHY it moved, in the words the operator needs: "it is IN the pier" and "it is not IN
      // the pier but there is no room to sit there" are different sentences.
      heldOff = {from:{lat:to.lat,lon:to.lon}, m:sn.moved, need,
                 kind: bi ? bi.kind
                     : holdClearM(en, ko, buf) < need ? "water too tight to hold in"
                     : "no room for the hold radius",
                 tight: !bi};
      to = {lat:nt.lat, lon:nt.lon};
    }
  }
  return {to:{lat:to.lat,lon:to.lon}, heldOff, need,
          holdClear: discInChart(holdClearM(llEN(to.lat,to.lon,ref), ko, buf), to, buf)};
}
// ⚠ THE HOLD DISC STAYS INSIDE THE WATER THE CHART WAS READ OVER TOO (2026-10-03, found by the review). `holdClearM`
// measures out to 500 m, and past the box edge the model is empty, so a target 300 m inside the box (ensureNogoCovers'
// pad) with a breakwater 350 m off, outside the extract, shipped a 497 m disc - inside which the vessel drives a
// STRAIGHT chord back - where the true clear water was 347 m. Capped at the point's distance to the box edge, less the
// buffer, so the disc and the boat in it lie wholly in read water. Every disc after this one is capped by it: the
// contacts' (holdClearWithContacts) take the smaller, and the re-certification never grows past the disc the hold began with.
function discInChart(m, ll, buf){
  if(m == null || !nogo.bbox) return m;
  return Math.max(0, Math.min(m, insideBoxM(ll, nogo.bbox) - (buf || 0)));
}
// ⚠⚠ A ROUTE RUNS ONLY OVER WATER THE CHART WAS READ OVER (2026-10-03, found on the live check of the ENC-first
// Rule 9 lane). The keep-out model holds the features of ONE box - `nogo.bbox`, the extract's own - and OUTSIDE it the
// model holds NOTHING, which every test here reads as clear water rather than as unknown. A command reads the chart
// over a box round the boat and the target, padded 300 m and joined to the operating area (ensureNogoCovers); the
// router's search reaches 900 m to 8 km past the straight line between them. So a route could leave the box and be
// certified clear over water nobody read: a fresh console's Go-To from New Castle up the Piscataqua ran 429 m past the
// box's north edge, and replayed on his full chart 21 of its 402 legs were not clear - 10 over land, 7 over water
// shallower than the floor, 4 through charted hazards. His own
// console flew the same Go-To clear only because an earlier command had already widened its box past them.
//
// So the planners REFUSE such a route rather than return it: planNogoRoute as an error, mode "uncharted"; routePlan as
// `uncharted` beside the route, which its two callers (the page's doTransit and doUpload) refuse on. The page then
// reads the chart over the route it was refused and plans again (planInsideChart in asv.html). A planner given no box
// - the suites' own worlds - is not asked: it has nothing to judge the route against.
//
// CHART_EDGE_M IS HOW FAR INSIDE THE BOX EDGE THE ROUTE MUST STAY. The extract holds every feature that reaches into
// the box, so a route point this far inside is judged against everything within this distance of it - well past the
// guard's standoff (19.5 m at 1.75 kn of set) and the leg's own buffer, with room for the boat to be off her track.
// A box is convex, so a route whose every point is inside it has every leg inside it too.
export const CHART_EDGE_M = 100;
/**
 * Where `pts` (a route, its start first) runs past the water the chart was read over: null when every point stands
 * at least `edgeM` inside `box`, else {at, outM, edgeM, pts} - where it LEAVES the box (its first point beyond it), or,
 * when it never does, its first point inside the margin; the farthest any point stands BEYOND the box itself (0 when
 * the route only reaches into the margin); the margin; and every point of the route: the water a wider read must
 * cover. Meters by the same flat degree ensureNogoCovers pads its box with.
 */
/** How far `p` stands inside `box`, in meters to its nearest edge (negative outside). */
export function insideBoxM(p, box){
  const k = M_PER_DEG_LAT * Math.cos(p.lat * Math.PI / 180);
  return Math.min((p.lat - box.S) * M_PER_DEG_LAT, (box.N - p.lat) * M_PER_DEG_LAT,
                  (p.lon - box.W) * k, (box.E - p.lon) * k);
}
export function beyondChart(pts, box, edgeM = CHART_EDGE_M){
  if(!box || !pts || !pts.length) return null;
  let near = null, out = null, outM = 0;
  for(const p of pts){
    const inside = insideBoxM(p, box);
    if(!(inside >= edgeM)){
      if(!near) near = {lat: p.lat, lon: p.lon};
      if(!out && inside < 0) out = {lat: p.lat, lon: p.lon};
      if(-inside > outM) outM = -inside;
    }
  }
  return near ? {at: out || near, outM, edgeM, pts: pts.map(p => ({lat: p.lat, lon: p.lon}))} : null;
}
/** What `beyondChart` found, in words; `fmt` formats meters (the page passes its own km / NM-aware fmtDist). `u.subject`
 *  names something other than a route ("the target" - a command refused before any route was planned). */
export function beyondChartSay(u, fmt){
  const f = fmt || (m => Math.round(m) + " m");
  const said = u.subject ? u.subject + " lies " : "the route runs ";
  return u.outM > 0 ? said + f(u.outM) + " beyond the water the chart was read over"
                    : said + "within " + f(u.edgeM) + " of the edge of the water the chart was read over";
}
// Plan an ENC-aware path from -> to ending at `to` - or at the nearest clear water to
// `to` when it sits in a keep-out (see holdTarget). {route} on success, {error} when no
// clear route exists (refuse + warn). Keeps to the starboard side of channels (Rule 9).
// A route that runs past the water the chart was read over is refused too - `uncharted`
// carries it, its route included, for the page to read the chart over and plan again.
export function planNogoRoute(from, to, opts){
  if(!nogo.ready) return {route:[{lat:to.lat,lon:to.lon}], direct:true, degraded:true};
  const ref=nogo.frame, ko=(opts && opts.ko) || nogo.ko, buf=nogo.buffer;   // opts.ko: see holdTarget (2026-09-27)
  const ht = holdTarget(to, opts);
  if(ht.error) return ht;
  to = ht.to;
  const heldOff = ht.heldOff, holdClear = ht.holdClear;
  // THE GUARD'S STANDOFF FIRST (2026-09-26), the buffer only where the water will not allow
  // it - and then SAID (`insideStandoff`). A transit legal at the bare buffer in a set is the
  // helm rung waiting: his 09:38 approach, and the live check's escape 9.9 m off Fort Point
  // on a detour routed at 3 m in a 1.75 kn set. `standoffM` is the planner/guard seam's own
  // number (patClipBufM in the page); calm water leaves it equal to the buffer.
  const want = (opts && opts.standoffM > buf + 0.05) ? opts.standoffM : buf;
  let leg = legPath(from, to, ref, ko, want), insideStandoff = false;
  if(!leg && want > buf){ leg = legPath(from, to, ref, ko, buf); insideStandoff = !!leg; }
  if(!leg){ const fb=firstBlockAlong(from, to, ref, ko, buf);
    return {error:"no clear route to the target — every path crosses "+(fb?fb.info.kind:"a nogo zone"),
            reason:{mode:"boxed", info:fb?fb.info:null, at:fb?fb.at:null, target:to}}; }
  const routed = leg.length > 1;
  // The lane's centerline is EXTENDED to the charted end of the fairway before the lane
  // is built on it (extendCenterline), so the stand-on past a mouth needs no separate
  // pass here. This comment used to claim the same thing about the UNextended centerline
  // - "it already runs out to the last buoy pair, so the fairway projects past the mouth"
  // - which was false: it ran out AT the last pair and the offset was decaying before it.
  const path = [{lat:from.lat,lon:from.lon}, ...leg];
  // ⚠ AND THE STANDOFF SURVIVES THE LANE PASS (2026-09-28). The lane, the smoothing, the gate and the knot prune
  // all run at the operator's BUFFER, so every shortcut they take is clear of the buffer and nothing more - and a
  // route the search built at the standoff came out of them with its corners cut back to 3 m. Found on the tighter
  // way round a contact, replayed on Andy's 19:25 geometry: routed at 19.5 m round KLEOS's ring, the route that
  // came out passed 7.9 m off her hull - inside the guard's standoff, where the helm rung takes the boat. The
  // result is re-gated at the margin the leg was FOUND at: the lane stands wherever it is clear of that, the
  // search's own route is spliced back where it is not. (routePlan has the same pass; see CLAUDE.md.)
  // ⚠ AND A BUOY SHE KEEPS CLOSE IS PASSED OUTSIDE THAT STANDOFF (2026-10-03). The gate below has no
  // notion of a side: measured on a mark with a bank 30 m beyond it, a leg passing it 10 m off on the
  // proper hand came back from the re-gate 29 m off on the OTHER. So the lane is told the margin it will
  // be re-gated at and stands her off the mark by that and a little more (MARK_PASS_M), and the marks are
  // counted again on the route that ships.
  // A MANEUVER IS LANED AS IT ALWAYS WAS. The way round a contact and the way back onto a line
  // (`flyThrough`) and the way back onto station (`maneuver`) are a few hundred meters of avoidance,
  // not a passage up a channel: neither is brought to a charted channel's starboard quarter nor sent
  // off to a buoy half a kilometer away. Go-To, RTH, a transit and the ETA rows are passages.
  const passage = !(opts && (opts.flyThrough || opts.maneuver));
  const laneOpts = {standoffM: insideStandoff ? 0 : want, marks: passage, charted: passage};
  const kr = insideStandoff || !(want > buf + 0.05) ? channelLaneRoute(path, ref, ko, buf, laneOpts)
                                                     : keepStandoff(channelLaneRoute(path, ref, ko, buf, laneOpts), path, ref, ko, want);
  // (the knot prune that used to run here moved INTO channelLaneRoute — the producer —
  // after the Upload path, which never pruned, shipped a splice-seam knot to the boat)
  // `lane` travels WITH the plan. A refusal above returns before this point and so carries
  // no lane at all, which is the honest answer: there is no route to describe.
  const route = kr.route.slice(1);
  // THE ROUTE AS FLOWN, judged against the box the chart was read over (beyondChart, above) - after the lane pass,
  // because that is the route the boat is sent. Refused with no `route`, so a caller that reads only `error` cannot fly it.
  const out = beyondChart([{lat: from.lat, lon: from.lon}, ...route], nogo.bbox);
  if(out) return {error: beyondChartSay(out), uncharted: {...out, route},
                  reason: {mode: "uncharted", info: {kind: "water the chart was not read over"}, at: out.at, near: !(out.outM > 0)}};
  return {route, direct: !routed, routed, lane: kr.lane, partial: kr.partial,
          how: kr.how, marks: kr.marks,
          heldOff, holdClear, insideStandoff, standoffM: want};
}
/** The lane pass's result re-gated at `want` (every leg clear of the standoff, spliced with the standoff's own
 *  route where it is not) and re-pruned at it. The lane is kept wherever the gate did not have to abandon it. */
function keepStandoff(kr, fallback, ref, ko, want){
  const g = gateLegClear(kr.route, fallback, ref, ko, want, {floor: nogo.buffer});   // (a patch out of her start, at its own radius)
  const route = pruneStitch(g.route, ref, ko, want, {keep: kr.keep, stubs: kr.stubs});   // (the marks' runs: see channelLaneRoute)
  // The marks are counted on THIS route: a splice has no notion of a side (see planNogoRoute).
  const mk = marksKept(route, ref, kr.marks);
  // ⚠ A LANE THE GATE ABANDONED SHIPS THE SEARCH'S OWN ROUTE, and nothing the lane claimed is true of it.
  const lane = !!kr.lane && !g.abandoned;
  const h = kr.how || {};
  // ... and the chart's lane is measured on THIS route too (chartedRide), and not claimed where most of the water it
  // owns was crossed short of it: carried over from the buffer's route, "right of center in the charted channel" was
  // said of a re-gated route that crossed 225 of 350 m short of it, outside its port edge.
  const ride = lane && kr.chartOwn ? chartedRide(route, ref, kr.chartOwn) : null;
  const short = !!ride && ride.shortM > Math.max(2 * kr.chartOwn.STEP, 0.05 * ride.ownedM);
  const how = {pairs: lane && !!h.pairs, charted: lane && !!h.charted && (!ride || ride.shortM <= ride.ownedM / 2),
               narrow: lane && !!h.narrow, marks: mk, gaps: lane && (!!h.gaps || g.splices > 0 || short),
               chartedShortM: ride ? ride.shortM : (h.chartedShortM || 0)};
  return {route, lane, partial: lane && (how.gaps || mk.wrong > 0), how, marks: kr.marks, keep: kr.keep};
}
// Route an ENTIRE run plan clear of nogo: the approach from `start` (present
// position) to wp0, plus every inter-waypoint transit. Detour waypoints are
// inserted where a leg would cross land / a nogo zone. The APPROACH (a transit)
// keeps to the starboard side of any channel (Rule 9); survey-line legs are left
// on their planned track. `keepRightAll` (pure-transit routes) keeps every leg
// starboard. Returns the full routed list + any legs that couldn't be routed.
/**
 * `standoffM` (2026-09-26): the TRANSIT legs - every leg on a pure transit (keepRightAll), the
 * approach to the first waypoint otherwise - are routed at the guard's standoff first and at
 * the buffer only where the water will not allow it, counted in `insideStandoff` so the page
 * can say so. The legs BETWEEN a plan's waypoints keep the buffer: they are the punch's own
 * geometry, already built at the standoff where it matters (lines, leads, turns, and the hops
 * the same way as here), and re-routing a turn arc at the standoff it was built to would
 * mangle it.
 *
 * `transitAt` (2026-10-02, sequenced surveys phase 2): a Set of waypoint indexes whose INCOMING leg is a transit too -
 * the leg into each later survey (surveys.js surveyEntries). Routed exactly as the approach is: at the standoff where
 * the water allows, keeping right in a buoyed channel (Rule 9, Andy's call). Absent, nothing changes.
 */
export function routePlan(start, wps, keepRightAll, standoffM, transitAt){
  if(!nogo.ready || !start) return {route: wps.map(p=>({lat:p.lat,lon:p.lon})), unroutable:[], degraded:true};
  const ref=nogo.frame, ko=nogo.ko, buf=nogo.buffer;
  const out=[]; const unroutable=[]; let prev={lat:start.lat, lon:start.lon};
  // ANY leg riding a lane makes it true for the plan. Accumulated here rather than read
  // back afterwards: this runs channelLaneRoute once per leg, so a per-call flag would
  // report only whichever leg happened to be last.
  let lane = false, partial = false, insideStandoff = 0;
  const how = {pairs: false, charted: false, narrow: false, gaps: false, marks: {kept: 0, wrong: 0, stbd: 0, port: 0}};
  const want = (standoffM > buf + 0.05) ? standoffM : buf;
  // ⚠ EACH LEG'S MARKS ARE JUDGED ON THAT LEG'S OWN PART OF THE ROUTE THAT SHIPS, and every pass
  // counts - but ONE pass, of a mark beside the waypoint two legs share, is counted once (both
  // legs excused it there: `nearEnd`), and wrong if either leg's part leaves it wrong. Summed
  // as each leg said, a mark beside a waypoint, excused by both legs, was counted by neither (a
  // red 100 m on her wrong hand under "2 marks left to starboard, 2 marks left to port"); judged
  // instead by its first leg's hand against the nearest point of the WHOLE plan, an out-and-back
  // transit up a channel of singles - every mark on its proper hand both ways - read "6 marks
  // NOT left on the proper hand", and an approach whose survey lines ran back down the channel
  // the same (`legVerdicts`).
  const legVerdicts = [];
  wps.forEach((wp, i)=>{
    const transit = keepRightAll || i===0 || !!(transitAt && transitAt.has(i));   // the legs the page routes itself
    let leg = legPath(prev, wp, ref, ko, transit ? want : buf);  // the standoff first (2026-09-26)
    let atStandoff = transit && want > buf + 0.05;               // ... and whether the leg was FOUND there
    if(!leg && transit && want > buf){ leg = legPath(prev, wp, ref, ko, buf); if(leg){ insideStandoff++; atStandoff = false; } }
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
    // between them stay on their planned track. (2026-10-02: a plan of several
    // surveys is several patterns, and the leg INTO each later one is that
    // pattern's approach - `transitAt`.)
    if(transit){                                    // the approach, a pure transit, and the leg into a later survey
      // ⚠ AND THE STANDOFF SURVIVES THE LANE PASS HERE TOO (2026-09-28), for planNogoRoute's reason: the lane, the
      // smoothing, the gate and the knot prune run at the BUFFER, and a transit leg found at the 19.5 m standoff came
      // out of them 6.3-14.1 m off a hull-sized block across it (tests/planner_guard_seam.js 7g). A leg found only at
      // the buffer - counted in insideStandoff - keeps the buffer's pass.
      const kr0 = channelLaneRoute(seg, ref, ko, buf, {standoffM: atStandoff ? want : 0});   // see planNogoRoute
      const kr = atStandoff ? keepStandoff(kr0, seg, ref, ko, want) : kr0;
      seg = kr.route; if(kr.lane) lane = true; if(kr.partial) partial = true;
      if(kr.how){
        for(const f of ["pairs", "charted", "narrow", "gaps"]) if(kr.how[f]) how[f] = true;
      }
      // (a mark too near this leg's start or end is counted where that end is a waypoint between two of its legs - not
      // at the transit's own start, the vessel's position, nor at its last waypoint: see markPassRoute's `reach`)
      legVerdicts.push({leg: i, v: markVerdicts(seg, ref, kr.marks || [], {start: i > 0, end: i < wps.length - 1})});
    }
    for(let k=1;k<seg.length;k++) out.push({lat:seg[k].lat, lon:seg[k].lon});
    prev = wp;
  });
  const passes = [];
  legVerdicts.forEach((L, a) => {
    const before = legVerdicts[a - 1], seam = before && before.leg === L.leg - 1;
    for(const e of L.v){
      const twin = seam && e.k.nearStart ? before.v.find((f) => f.k.m === e.k.m && f.k.nearEnd) : null;
      if(!twin){ passes.push(e); continue; }
      if((!e.proper && twin.proper) || (e.proper === twin.proper && Math.abs(e.x) < Math.abs(twin.x))) Object.assign(twin, e);
    }
  });
  if(legVerdicts.length){
    how.marks = tallyMarks(passes);
    if(how.marks.kept) lane = true;
    if(lane && how.marks.wrong) partial = true;
  }
  // A plan is only fully laned if EVERY laned leg was: one partial leg makes the plan
  // partial, the same way one laned leg makes it laned.
  // ⚠ AND THE WHOLE ROUTE IS JUDGED AGAINST THE BOX THE CHART WAS READ OVER (beyondChart): every leg, the survey's own
  // included, since a survey line over water nobody read is no more checked than a transit over it. `uncharted` is null
  // or what beyondChart found; the route is still returned, and the page refuses it (doTransit, doUpload).
  const uncharted = beyondChart([{lat: start.lat, lon: start.lon}, ...out], nogo.bbox);
  return {route: out, unroutable, lane, partial, how, insideStandoff, standoffM: want, uncharted};
}
