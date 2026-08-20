// static/js/turns.js - THE SHAPE OF A REVERSAL, and the radius the hull can hold.
//
// Line-to-line turn geometry: the semicircle and the teardrop, the arc sampler under both,
// the radius floor they are built at, and the end-shortening that leaves room for them. No
// DOM, no fetch, no mission state - a geometry question in, a waypoint list out.
//
// ── WHY THIS FILE EXISTS (2026-08-20) ──────────────────────────────────────────────────
//
// These four lived in asv.html's 4,521-line <script> block, and that was the ONE genuine
// prerequisite left in the estate: WorldView has the same turn geometry as clean exports in
// `mission.js`, and for three sessions the handoff has recorded that nothing about ASV's
// could be imported, differentially measured or vendored until it came out of the page.
// This is that move. It is an EXTRACTION, not a merge: no body changed, and the comparison
// against WorldView's is the next job, not this one.
//
// ⚠ `punchOut` DELIBERATELY DID NOT COME WITH THEM, AND THE AUDIT'S "shared symbol" ROW IS
// MISLEADING ABOUT IT. Another shared name that is not a shared quantity: WorldView's
// `punchOut(pattern, opts)` is a PURE MISSION ASSEMBLER with injected seams (`clear`,
// `routeAround`); this console's `punchOut()` takes no arguments at all and is the BUTTON
// HANDLER - it reads `currentPattern()`, writes `#sp_hint`, toggles `#sp_punch`, flips
// `encShow`, calls `render()` and `showBanner()`. The two are not the same function with
// different parameters; one is UI and the other is algorithm. What corresponds to
// WorldView's `punchOut` is the ASSEMBLY INSIDE this console's handler, and separating
// those is its own job with its own decisions. It stays in the page.
//
// WHAT EACH ONE NEEDS, and why the move was clean: `shortenSeg` takes `distTo`,
// `minTurnRadiusM` reads the vessel block through `V`, `arcPts` needs nothing at all, and
// `teardropTurn` uses `llEN`/`M_PER_DEG_LAT` and validates every chord with `legClear`.
// All four were already reaching for ES modules; none of them ever touched the DOM. That is
// why this is 142 lines moved and no behaviour to re-check - though it was re-checked
// anyway, function by function, against the page as it was.
import { M_PER_DEG_LAT, distTo, llEN } from "./geodesy.js";
import { legClear } from "./chart.js";
import { V } from "./state.js";

// Shorten a survey segment by `m` metres at BOTH ends (settle on-line + leave room
// for the turn). Leaves it untouched if that would make it too short.
export function shortenSeg(a, b, m){
  const d=distTo(a,b); if(d < 2*m + 2) return [a,b];
  const t0=m/d, t1=1-m/d;
  return [ {lat:a.lat+(b.lat-a.lat)*t0, lon:a.lon+(b.lon-a.lon)*t0},
           {lat:a.lat+(b.lat-a.lat)*t1, lon:a.lon+(b.lon-a.lon)*t1} ];
}
// Boat minimum turn radius (m) it can actually HOLD at a given speed, with a
// margin for line-following overshoot. A turn tighter than this can't be tracked:
// the boat overshoots OUTBOARD - into the nogo the arc was hugging - even though
// the (idealised) arc validates clear. This is the FLOOR every generated turn is
// built at; it is never the reason a turn is skipped (see teardropTurn).
// Vessel-derived; populated by loadVessel() from /api/vessel (single source of
// truth = the active vessel file). The literals are only a fallback if the fetch
// fails before first paint.
export function minTurnRadiusM(speedKey){
  const kn = V.SPEED_KN[speedKey] || 3.0;
  const v = kn*0.514444, w = V.MAX_TURN_RATE_DEG_S*Math.PI/180;   // m/s, rad/s
  return (v/w) * 1.4;                                    // 1.4× the physical v/ω (tracking margin)
}
// Interior points of a circular arc: centre C, radius R, from angle a0 sweeping
// `sweep` radians (signed, + = CCW), at ~3 m spacing with a `minSeg` floor. EXCLUDES
// both endpoints. ~3 m is enough to render a smooth arc and let the follower's
// approach radius round it, at roughly half the waypoint count of a 1.5 m arc.
// Chords cut INBOARD - away from whatever the arc is hugging - and every chord is
// legClear-validated by the caller, so a sparse arc stays clear. `map(x,y)` takes
// frame coords to lat/lon.
export function arcPts(C, R, a0, sweep, minSeg, map){
  const n=Math.max(minSeg||2, Math.ceil(Math.abs(sweep)*R/3)), out=[];
  for(let i=1;i<n;i++){ const a=a0+sweep*(i/n);
    out.push(map(C.x+R*Math.cos(a), C.y+R*Math.sin(a))); }
  return out;
}
// Line-to-line reversal turn. TWO SHAPES, ONE CONTRACT: both roll the ASV onto the
// next line ALIGNED with its heading, both are built at a radius the boat can
// actually HOLD at the plan speed, and both are legClear-validated against nogo
// before they are returned.
//
//   SEMICIRCLE - line offset >= 2*minR. One 180° arc, radius = HALF THE LINE
//     OFFSET, bulging outboard. The classic boustrophedon turn: shortest, and it
//     never reaches more than R beyond the line ends. Any boat whose minimum radius
//     fits inside half the spacing gets this (a 4 m USV at survey speed needs 2.1 m
//     of radius, so in practice: always).
//
//   TEARDROP - line offset < 2*minR. The semicircle would be tighter than the boat
//     can hold, so loop at the boat's OWN minimum radius instead: a short arc AWAY
//     from the next line, a >180° loop back over the top, and a short arc onto the
//     line - three tangent circles of radius minR. DECOUPLING THE TURN RADIUS FROM
//     THE LINE OFFSET is the entire point. An 8 m USV at 7 kn needs ~14 m of radius,
//     which a 15 m line spacing can never supply as a semicircle; before this
//     existed such a boat got no turn at all and fell back to a "straight" hop
//     between anti-parallel line ends - which is a 180° reversal at half the
//     spacing, i.e. exactly the radius that was just rejected as unflyable. The
//     teardrop costs outboard water (up to ~2.75*minR past the line ends, vs R for
//     the semicircle), which is why it is the fallback and not the default, and why
//     the caller reports the excursion to the operator.
//
// Teardrop geometry, in a frame with the turn entry at the origin, +y = the exit
// heading and +x = towards the next line, offset d = |lateral|, R = minR:
//     C1 = (-R, 0)        left  circle at the entry   (turn AWAY from the next line)
//     C3 = (d + R, 0)     left  circle at the exit
//     C2 = (d/2, +q)      right circle over the top,  q = sqrt(4R² - ((d+2R)/2)²)
// C2 is tangent to both outer circles (|C1-C2| = |C2-C3| = 2R), which is solvable
// exactly when d <= 2R - precisely the case the semicircle cannot serve. Tangent
// points are the circle-centre midpoints. Net heading change is -180° by
// construction, and at d = 2R it degenerates (q = 0, outer arcs vanish) into the
// plain semicircle, so the two shapes agree on their shared boundary.
//
// Any ALONG-TRACK offset between E and F (clipped lines of unequal length) is
// absorbed by a straight run collinear with a survey line - before the loop if F is
// ahead of E, after it if F is behind - so the arcs always see a clean abeam pair
// and the extra geometry is the safest shape available.
//
// Returns {pts, kind:"semicircle"|"teardrop", R, outboard} with `pts` EXCLUDING E
// and F, or {why:"degenerate"|"skew"|"nogo"} if no turn was produced. `outboard` is
// how far past the line end the turn reaches, which is what the operator has to
// have clear water for.
export function teardropTurn(E, F, hE, hF, ref, ko, buf, minR){
  const en2ll=(e,n)=>({lat:ref.lat+n/M_PER_DEG_LAT, lon:ref.lon+e/(M_PER_DEG_LAT*Math.cos(ref.lat*Math.PI/180))});
  const Ee=llEN(E.lat,E.lon,ref), Fe=llEN(F.lat,F.lon,ref);
  const half=Math.hypot(Ee.e-Fe.e, Ee.n-Fe.n)/2;
  if(half>60 || half<0.25) return {why:"degenerate"};    // lines too far apart / coincident
  const minRc=Math.max(0.75, minR||0);
  const fwd={e:Math.sin(hE*Math.PI/180), n:Math.cos(hE*Math.PI/180)};   // exit heading = outboard
  let pts, kind, R, outboard;
  if(half>=minRc){
    // ---- SEMICIRCLE: the offset itself supplies a radius the boat can hold ---- //
    R=half; kind="semicircle"; outboard=R;
    const C={x:(Ee.e+Fe.e)/2, y:(Ee.n+Fe.n)/2};
    const a0=Math.atan2(Ee.n-C.y, Ee.e-C.x);
    let dir=1, bestProj=-1e9;                            // pick the 180° sweep that bulges outboard
    for(const d of [1,-1]){ const am=a0+d*Math.PI/2;
      const proj=Math.cos(am)*fwd.e + Math.sin(am)*fwd.n;
      if(proj>bestProj){ bestProj=proj; dir=d; } }
    pts=arcPts(C, R, a0, dir*Math.PI, 4, en2ll);
  } else {
    // ---- TEARDROP: loop at the boat's own minimum radius --------------------- //
    // The closed form above assumes a true reversal; the caller's 50° anti-parallel
    // gate is far looser than that, so re-check here and decline the skew cases
    // rather than roll out on a heading that misses the next line.
    if(Math.abs(((hF-hE+360)%360)-180) > 15) return {why:"skew"};
    R=minRc; kind="teardrop";
    const rgt={e:fwd.n, n:-fwd.e};                       // starboard of the exit heading
    const D={e:Fe.e-Ee.e, n:Fe.n-Ee.n};
    const along=D.e*fwd.e+D.n*fwd.n, lat=D.e*rgt.e+D.n*rgt.n;
    const s=lat>=0?1:-1, d=Math.abs(lat);
    if(d<0.5) return {why:"degenerate"};                 // lines on top of each other
    // Absorb the along-track offset with an on-line straight, then work in the local
    // frame (origin A, +x towards the next line, +y = exit heading) where F is abeam.
    const A={e:Ee.e+(along>0?along*fwd.e:0), n:Ee.n+(along>0?along*fwd.n:0)};
    const B={e:Fe.e-(along<0?along*fwd.e:0), n:Fe.n-(along<0?along*fwd.n:0)};
    const map=(x,y)=>en2ll(A.e + x*s*rgt.e + y*fwd.e, A.n + x*s*rgt.n + y*fwd.n);
    const qy2=4*R*R - Math.pow((d+2*R)/2, 2);
    if(qy2<0) return {why:"degenerate"};                 // unreachable while d <= 2R, but don't NaN
    const qy=Math.sqrt(qy2);
    const C1={x:-R, y:0}, C3={x:d+R, y:0}, C2={x:d/2, y:qy};
    const T1={x:(C1.x+C2.x)/2, y:(C1.y+C2.y)/2};         // equal radii -> tangent point is the
    const T2={x:(C2.x+C3.x)/2, y:(C2.y+C3.y)/2};         // midpoint of the two centres
    const n2pi=a=>{ a%=2*Math.PI; return a<0?a+2*Math.PI:a; };
    const ang=(P,C)=>Math.atan2(P.y-C.y, P.x-C.x);
    const s1=n2pi(ang(T1,C1));                                  // arc 1: CCW from angle 0 (the entry)
    const a2=ang(T1,C2), s2=-n2pi(a2-ang(T2,C2));               // arc 2: CW over the top (>180°)
    const a3=ang(T2,C3), s3=n2pi(Math.PI-a3);                   // arc 3: CCW onto the next line
    pts=[];
    if(along>0) pts.push(en2ll(A.e, A.n));                      // run-out to the abeam point
    pts.push(...arcPts(C1, R, 0, s1, 2, map), map(T1.x,T1.y));
    pts.push(...arcPts(C2, R, a2, s2, 2, map), map(T2.x,T2.y));
    pts.push(...arcPts(C3, R, a3, s3, 2, map));
    if(along<0) pts.push(en2ll(B.e, B.n));                      // roll out early, straight in to F
    // How far past the line end the loop actually reaches, measured on the exit
    // heading from E - this is the water the operator has to have clear.
    outboard=0;
    for(const p of pts){ const pe=llEN(p.lat,p.lon,ref);
      outboard=Math.max(outboard, (pe.e-Ee.e)*fwd.e + (pe.n-Ee.n)*fwd.n); }
  }
  // `seg` on refusal = the failing chord, so the caller can ask blockedInfo/
  // firstBlockAlong WHAT blocked it and name it (a "keep-out" the operator is
  // staring at can be open-looking water - a navigation channel).
  let prev=E; for(const p of [...pts, F]){ if(!legClear(prev,p,ref,ko,buf)) return {why:"nogo", seg:[prev,p]}; prev=p; }
  return {pts, kind, R, outboard};
}
