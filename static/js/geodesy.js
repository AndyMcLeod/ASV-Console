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
// would make the diff enormous and the "no behaviour change" claim far harder to check than
// the three one-line adapters below. Measured: distTo 84 -> 80 ns/call, azTo 116 -> 111,
// atDA 26 -> 53. The atDA doubling is 27 ns on 16 call sites, none of them a raster.
export function azTo(a, b){ return flatBearingDeg(a.lat, a.lon, b.lat, b.lon); }
export function distTo(a, b){ return flatDistanceM(a.lat, a.lon, b.lat, b.lon); }
export function atDA(p, dist, az){ return flatOffset(p.lat, p.lon, dist, az); }

// Local ENU about a reference point: metres east / north. The survey and routing maths
// works in this frame, because a flat plane is exact enough over a survey area and the
// trigonometry stays readable.
//
// ── DELIBERATELY NOT DELEGATED TO asv_core, AND THE REASON IS A NUMBER ──────────────────
// The core's toEN/fromEN take a `Frame` — a validated, frozen contract object carrying
// `m_per_deg_lon` PRECOMPUTED. These take a bare ref point and compute the cosine inline.
// Building a Frame per call to bridge that is a regression on the hot path:
//
//     llEN as written here, cosine inline       123 ns/call
//     core toEN, Frame built per call           328 ns/call    2.7x SLOWER
//     core toEN, Frame hoisted to the caller     26 ns/call     4.7x faster
//
// llEN has 63 call sites in the keep-out raster and that raster runs inside a drag. The
// fast form is the right end state and it is worth 4.7x, but it means threading a Frame
// through all 63 — a refactor of the keep-out path, which must be its own change with its
// own verification rather than a passenger on this one.
//
// THE EXPRESSIONS BELOW ARE VERBATIM FROM THE PAGE, INCLUDING THE UNFACTORED
// `*M_PER_DEG_LAT*Math.cos(...)`. Hoisting that product into a local reads better and is
// NOT the same number: IEEE-754 multiplication is not associative, so `(a*b)*c` and
// `a*(b*c)` can differ in the last bits. That is nothing on its own, but this is the frame
// the keep-out routing and the Rule 9 lane are computed in, and a move whose whole claim is
// "no behaviour change" should not spend its credibility on a tidier line. Carrying the
// scale as a Frame value IS that hoist, made deliberate — it is exactly the 3.7e-9 m the
// core's differential reports against these three functions, and why they stay here until
// somebody does the refactor on purpose.
export function toEN(p, ref){
  return {e:(p.lon-ref.lon)*M_PER_DEG_LAT*Math.cos(ref.lat*Math.PI/180),
          n:(p.lat-ref.lat)*M_PER_DEG_LAT};
}
export function fromEN(e, n, ref){
  return {lat: ref.lat + n/M_PER_DEG_LAT,
          lon: ref.lon + e/(M_PER_DEG_LAT*Math.cos(ref.lat*Math.PI/180))};
}
// The same transform taking loose lat/lon rather than a point. Kept as its own function
// (not a wrapper) because it is the hot one - 63 call sites in the keep-out raster.
export function llEN(lat, lon, ref){
  return {e:(lon-ref.lon)*M_PER_DEG_LAT*Math.cos(ref.lat*Math.PI/180),
          n:(lat-ref.lat)*M_PER_DEG_LAT};
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
