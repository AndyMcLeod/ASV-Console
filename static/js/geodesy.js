// static/js/geodesy.js — flat-earth geodesy + the Web-Mercator projection.
//
// THE PUREST LAYER IN THE CONSOLE: no DOM, no shared state. Every function here is a value
// in, a value out. That is what lets Node import this file directly, so tests/*.js can call
// the REAL azTo/distTo instead of regex-ing them out of a 6,000-line HTML file and eval-ing
// the text.
//
// ── THE FLAT MODEL NOW COMES FROM asv_core (2026-08-19) ─────────────────────────────────
// `distTo`, `azTo`, `atDA`, `alignDeg` and `M_PER_DEG_LAT` are the core's. THIS CONSOLE IS
// WHERE THAT MODEL CAME FROM: the core's flatDistanceM / flatBearingDeg / flatOffset were
// built from these functions, asymmetry and all — distance and bearing take the cosine at
// the MID-latitude, the offset at the START latitude. Nobody would invent that on purpose,
// and the core reproduces it rather than smoothing it, because smoothing it would move
// keep-out decisions.
//
// ADOPTION IS PARTIAL, AND THE SPLIT WAS MEASURED. See the block above toEN for why the
// ENU family stays here — it is a hot-path cost, not a preference.
//
// WHAT DELEGATION COSTS, MEASURED OVER 1,000 PAIRS AROUND LEWES:
//   distTo  3.6e-12 m     azTo  5.7e-14 deg     atDA  0 (exact)     alignDeg  0 (exact)
// Those are not zero because the core precomputes `D2R = PI/180` where this file wrote
// `*Math.PI/180` inline, and IEEE-754 multiplication is not associative. It is the same
// class of difference as the hoist warned about below — one part in 1e12 of the 3 m
// keep-out buffer. Stated rather than hidden, and the core's differential prints it.
//
// Azimuth convention: 0 = N, 90 = E, clockwise - matching CAMP's QGeoCoordinate, so the
// survey-pattern maths that consumes this stays a faithful port of surveypattern.cpp.
//
// WHAT IS DELIBERATELY NOT HERE: originPx() and viewSize() look like they belong, but they
// read `zoom`, `center` and the #map element - they are VIEW state, not geodesy, and
// hoisting them would drag the DOM into the one module that has no business knowing about
// it. They stay in the page and pass what they need to worldPx().

import {
  M_PER_DEG_LAT_FLAT,
  flatDistanceM, flatBearingDeg, flatOffset,
  geodesicDistanceM, geodesicBearingDeg,
  alignDeg as coreAlignDeg,
} from "./core_geodesy.js";

// Re-exported under this console's own names, unchanged in value.
export const M_PER_DEG_LAT = M_PER_DEG_LAT_FLAT;   // 111320
export const alignDeg = coreAlignDeg;
export const TILE = 256;                       // Web-Mercator tile edge, px

// WHAT THE CORE IS TOLD IT DELEGATES. asv_core's differential suite reads this and refuses
// to count a delegated metric as evidence: comparing a wrapper with the function it calls
// compares a function with itself, and a tick that can only ever be green is worse than no
// tick. Anything NOT listed here is still this console's own maths and is still
// differentially checked against the core.
export const DELEGATES_TO_CORE = Object.freeze(
  ["distTo", "azTo", "atDA", "alignDeg", "M_PER_DEG_LAT"]);

// THESE THREE ARE WRAPPERS, NOT ALIASES, and that is a real cost worth naming. The estate
// prefers aliases precisely because a wrapper is an adapter layer that can drift. It is not
// possible here: the core takes loose (lat, lon) numbers, this console has always passed
// {lat, lon} POINTS, and there are 118 call sites between the three. Rewriting them all
// would make the diff enormous and the "no behavior change" claim far harder to check than
// the three one-line adapters below. Measured: distTo 84 -> 80 ns/call, azTo 116 -> 111,
// atDA 26 -> 53. The atDA doubling is 27 ns on 16 call sites, none of them a raster.
export function azTo(a, b){ return flatBearingDeg(a.lat, a.lon, b.lat, b.lon); }
export function distTo(a, b){ return flatDistanceM(a.lat, a.lon, b.lat, b.lon); }
export function atDA(p, dist, az){ return flatOffset(p.lat, p.lon, dist, az); }

// --- THE ROUTER'S METRIC: TRUE DISTANCE, NOT THE FLAT MODEL ------------------------- //
//
// ANDY'S RULING, 2026-08-20: "standardize". The shared routing bodies in asv_core call
// `frame.distTo` / `frame.azTo`, and until now this console handed them the FLAT pair while
// WorldView handed over Vincenty -- a steady 0.278 % apart, 4.4 m at 1600 m and 22.5 m at
// the 8100 m escalation margin, `azTo` up to 0.120 deg. Both consoles now measure with THE
// SAME CORE FUNCTIONS, so a route search asks the same question in both.
//
// THESE ARE DELIBERATELY NOT CALLED `distTo`. This console's `distTo` above is the FLAT
// model and stays that way: it has 118 call sites in the turn geometry, the survey pattern,
// the readouts and the mission legs, and those live in the SAME FLAT PLANE as `toEN` and
// `llEN`, where the hypotenuse of an ENU difference IS the distance. Making one name mean
// two quantities inside one repo is exactly the trap the routing extraction spent a session
// documenting; these names say which is which at every call site.
//
// WHERE THE ROUTER USES THEM, AND WHY A FLAT PLANE WITH A TRUE METRIC IS SAFE. `legPath`
// filters and sorts its open-water escape candidates, `pruneStitch` folds a vertex past
// 60 deg, and `gateLegClear` forgives a block within 2*buf of an endpoint. All three are
// HEURISTICS -- which candidate to prefer, which vertex to drop, which block to excuse. Not
// one is a clearance bound: every route is still proved by `legClear`, which works in the
// plane through `toEN` and never touches these.
export function trueDistTo(a, b){ return geodesicDistanceM(a.lat, a.lon, b.lat, b.lon); }
export function trueAzTo(a, b){ return geodesicBearingDeg(a.lat, a.lon, b.lat, b.lon); }

// Local ENU about a reference point: meters east / north. The survey and routing maths
// works in this frame, because a flat plane is exact enough over a survey area and the
// trigonometry stays readable.
//
// ── DELIBERATELY NOT DELEGATED TO asv_core ─────────────────────────────────────────────
// The core's toEN/fromEN take a `Frame` — a validated, frozen contract object carrying
// `m_per_deg_lon` PRECOMPUTED. These take a bare ref point and compute the cosine inline.
// Building a Frame per call to bridge that costs 328 ns against 123: a real regression
// for no gain, so these three stay.
//
// ⚠ THE OTHER HALF OF THIS NOTE WAS WRONG, AND IS CORRECTED HERE (2026-08-19). It said
// the hoisted form was "worth 4.7x" and that llEN had "63 call sites in the keep-out
// raster, which runs inside a drag" — and booked a follow-up refactor on that basis. 63
// is a count of call sites IN THE SOURCE. It was asserted to mean runtime volume on the
// drag path and never measured there. Counted properly:
//
//     legClear  (the drag-path call)          2 llEN, 2 fromEN
//     firstBlockAlong                         2 llEN, 3 fromEN
//     planNogoRoute (a whole route search)    0 llEN, 2 fromEN
//     buildKeepouts (180 polygons)         3060 llEN — but ONCE PER CHART, not per drag
//
// A leg is converted at its two endpoints and the raster then works in ENU, where the
// coordinates already are. The 4.7x was a microbenchmark of the function in isolation;
// end to end the hoist is unmeasurable, with run-to-run variance (build 0.2–0.5 ms,
// 40-leg pass 4.0–8.7 ms) far larger than any difference. THERE IS NO REFACTOR TO DO
// HERE — keeping these three is the end state, not a staging post.
//
// THE EXPRESSIONS BELOW ARE VERBATIM FROM THE PAGE, INCLUDING THE UNFACTORED
// `*M_PER_DEG_LAT*Math.cos(...)`. Hoisting that product into a local reads better and is
// NOT the same number: IEEE-754 multiplication is not associative, so `(a*b)*c` and
// `a*(b*c)` can differ in the last bits. That is nothing on its own, but this is the frame
// the keep-out routing and the Rule 9 lane are computed in, and a move whose whole claim is
// "no behavior change" should not spend its credibility on a tidier line. Carrying the
// scale as a Frame value IS that hoist, made deliberate — it is exactly the 3.7e-9 m the
// core's differential reports against these three functions. That number is the reason to
// leave the expressions alone, not a debt: there is no refactor pending (see above).
export function toEN(p, ref){
  return {e:(p.lon-ref.lon)*M_PER_DEG_LAT*Math.cos(ref.lat*Math.PI/180),
          n:(p.lat-ref.lat)*M_PER_DEG_LAT};
}
export function fromEN(e, n, ref){
  return {lat: ref.lat + n/M_PER_DEG_LAT,
          lon: ref.lon + e/(M_PER_DEG_LAT*Math.cos(ref.lat*Math.PI/180))};
}
// The same transform taking loose lat/lon rather than a point. Kept as its own function
// (not a wrapper) because it is the one with the most call sites — 63 in the source,
// though see above for what that does and does not mean at runtime.
export function llEN(lat, lon, ref){
  return {e:(lon-ref.lon)*M_PER_DEG_LAT*Math.cos(ref.lat*Math.PI/180),
          n:(lat-ref.lat)*M_PER_DEG_LAT};
}

// A FRAME: this console's flat plane, in the shape the shared keep-out and routing bodies
// expect — `{toEN(p), fromEN(e, n)}`, exactly WorldView's `tangentFrame` interface.
//
// Andy's ruling, 2026-08-20: `frame`, not a bare `ref`. The two consoles had the same
// functions differing only in that one argument, and this is the side that moves.
//
// ⚠ IT DELEGATES TO THE FUNCTIONS ABOVE RATHER THAN HOISTING THE SCALE, AND THAT IS THE
// WHOLE POINT. WorldView's tangentFrame computes `metersPerDegree` ONCE and closes over it;
// doing the same here would be the hoist this file has always warned about — `(a*b)*c`
// against `a*(b*c)`, about 4 nanometres of easting. Calling `toEN`/`fromEN` per invocation
// keeps the arithmetic character-for-character what it has always been, which is what makes
// the adoption of the shared bodies a rename rather than a change of answer: measured
// 0.000e+0 m across 156 vertices and a mixed feature set. The hoist is available and
// measured (it changes nothing anyone can observe, and buys nothing either — see the
// canceled Frame refactor), so it is not taken.
//
// ⚠ A FRAME IS ALSO A REF, AND THAT IS WHAT MAKES THE MIGRATION SAFE. It carries `lat` and
// `lon` as well as the two closures, so every function in this console that already takes a
// `ref` and does `ref.lat` / `llEN(lat, lon, ref)` keeps working, unchanged, when handed a
// frame instead. The switch is therefore one line at each place a ref is CREATED, not a
// rewrite of the seventy conversion call sites downstream — and it cannot half-apply, since
// a frame satisfies both contracts at once.
//
// That is deliberate scaffolding, not a permanent duck-type. Once the shared bodies replace
// this console's own (they use `frame.toEN` throughout), the `lat`/`lon` fields stop being
// read and can go. Until then they are what lets the interface move ahead of the bodies.
//
// ⚠ AND IT CARRIES THE ROUTER'S METRIC, WHICH IS NOT THE SAME THING AS THE PLANE.
//
// The plane is FLAT and stays flat: `toEN`/`fromEN` are this console's own, the keep-out
// model is built in them, and every clearance test runs there. The METRIC -- `distTo` and
// `azTo` -- is TRUE distance as of Andy's "standardize" ruling (2026-08-20), so the shared
// routing bodies ask the same question here as they do in WorldView. They are literally the
// same core functions now, not merely close.
//
// WHY THE FRAME CARRIES A METRIC AT ALL, now that both sides agree. Until the ruling the two
// consoles handed the shared bodies DIFFERENT functions -- flat here, Vincenty there, a
// steady 0.278 % apart. Measured, that changed 92 of 20,000 escape-ring keep/drop decisions
// and 3.0 % of best-first orderings, and every fixture still agreed at 0.000e+0 m because
// the gap only decides anything within meters of a threshold. Carrying the metric on the
// frame is what made that divergence VISIBLE and then fixable. It is not scaffolding to be
// tidied away because the two values happen to match today.
//
// ⚠ THE PLANE AND THE METRIC NOW DISAGREE BY 0.278 %, ON PURPOSE. A point placed r meters
// out through `fromEN` measures 0.9972*r by `distTo`. That is fine everywhere the router
// uses it -- see the note on `trueDistTo` above; all three uses are heuristics and no
// clearance bound goes through them. It would NOT be fine to give `toEN`/`fromEN` the
// ellipsoidal scale too: that is the tangent-plane divergence the core documents, it moves
// every keep-out decision by about 1.7 m, and it is a separate question nobody has asked.
export function planeFrame(ref){
  return {
    lat: ref.lat, lon: ref.lon,
    ref,
    toEN: (p) => toEN(p, ref),
    fromEN: (e, n) => fromEN(e, n, ref),
    distTo: trueDistTo, azTo: trueAzTo,
  };
}

// Web Mercator. `z` is the tile zoom; the result is in world pixels at that zoom, which
// the caller offsets by the viewport origin to get screen pixels.
//
// NOT IN THE CORE, AND NOT A GAP: Web Mercator is a screen projection and distPtSegPx is
// pixel hit-testing. Both are the VIEW layer. The core carries the models a plan is
// computed in, not the one it is drawn in.
export function worldPx(lat, lon, z){
  const s = TILE * Math.pow(2, z);
  const x = (lon + 180) / 360 * s;
  const sinLat = Math.sin(lat * Math.PI/180);
  const y = (0.5 - Math.log((1+sinLat)/(1-sinLat)) / (4*Math.PI)) * s;
  return {x, y};
}
export function worldToLatLon(x, y, z){
  const s = TILE * Math.pow(2, z);
  const lon = x / s * 360 - 180;
  const n = Math.PI - 2*Math.PI*y/s;
  const lat = 180/Math.PI * Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));
  return {lat, lon};
}

// point-to-segment distance in pixels (hit-testing a drawn line)
export function distPtSegPx(px,py, ax,ay, bx,by){ const dx=bx-ax, dy=by-ay, l2=dx*dx+dy*dy||1;
  let t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2)); return Math.hypot(px-(ax+t*dx), py-(ay+t*dy)); }

// Fold a heading difference to [0,90]: 0 = parallel, 90 = perpendicular. A survey line
// runs in either direction, so parallel and anti-parallel both read as aligned.
// DELEGATED: re-exported from the core at the top of this file, bit-exact against what
// used to be here.
