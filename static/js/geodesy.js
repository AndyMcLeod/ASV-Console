// static/js/geodesy.js — flat-earth geodesy + the Web-Mercator projection.
//
// THE PUREST LAYER IN THE CONSOLE: no DOM, no shared state, no imports. Every function
// here is a value in, a value out. That is what lets Node import this file directly, so
// tests/turn_geometry.js and tests/buoy_lane.js can call the REAL azTo/distTo instead of
// regex-ing them out of a 6,000-line HTML file and eval-ing the text.
//
// WHAT IS DELIBERATELY NOT HERE: originPx() and viewSize() look like they belong, but they
// read `zoom`, `center` and the #map element - they are VIEW state, not geodesy, and
// hoisting them would drag the DOM into the one module that has no business knowing about
// it. They stay in the page and pass what they need to worldPx().
//
// Azimuth convention: 0 = N, 90 = E, clockwise - matching CAMP's QGeoCoordinate, so the
// survey-pattern maths that consumes this stays a faithful port of surveypattern.cpp.

export const M_PER_DEG_LAT = 111320;
export const TILE = 256;                       // Web-Mercator tile edge, px

export function azTo(a, b){
  const mlon = M_PER_DEG_LAT*Math.cos((a.lat+b.lat)/2*Math.PI/180);
  return (Math.atan2((b.lon-a.lon)*mlon, (b.lat-a.lat)*M_PER_DEG_LAT)*180/Math.PI + 360) % 360;
}
export function distTo(a, b){
  const mlon = M_PER_DEG_LAT*Math.cos((a.lat+b.lat)/2*Math.PI/180);
  return Math.hypot((b.lat-a.lat)*M_PER_DEG_LAT, (b.lon-a.lon)*mlon);
}
export function atDA(p, dist, az){             // move dist(m) along azimuth az(deg)
  const r = az*Math.PI/180;
  return {lat: p.lat + dist*Math.cos(r)/M_PER_DEG_LAT,
          lon: p.lon + dist*Math.sin(r)/(M_PER_DEG_LAT*Math.cos(p.lat*Math.PI/180))};
}

// Local ENU about a reference point: metres east / north. The survey and routing maths
// works in this frame, because a flat plane is exact enough over a survey area and the
// trigonometry stays readable.
//
// THE EXPRESSIONS BELOW ARE VERBATIM FROM THE PAGE, INCLUDING THE UNFACTORED
// `*M_PER_DEG_LAT*Math.cos(...)`. Hoisting that product into a local reads better and is
// NOT the same number: IEEE-754 multiplication is not associative, so `(a*b)*c` and
// `a*(b*c)` can differ in the last bits. That is nothing on its own, but this is the frame
// the keep-out routing and the Rule 9 lane are computed in, and a move whose whole claim is
// "no behaviour change" should not spend its credibility on a tidier line.
export function toEN(p, ref){
  return {e:(p.lon-ref.lon)*M_PER_DEG_LAT*Math.cos(ref.lat*Math.PI/180),
          n:(p.lat-ref.lat)*M_PER_DEG_LAT};
}
export function fromEN(e, n, ref){
  return {lat: ref.lat + n/M_PER_DEG_LAT,
          lon: ref.lon + e/(M_PER_DEG_LAT*Math.cos(ref.lat*Math.PI/180))};
}
// The same transform taking loose lat/lon rather than a point. Kept as its own function
// (not a wrapper) because it is the hot one - 42 call sites in the keep-out raster.
export function llEN(lat, lon, ref){
  return {e:(lon-ref.lon)*M_PER_DEG_LAT*Math.cos(ref.lat*Math.PI/180),
          n:(lat-ref.lat)*M_PER_DEG_LAT};
}

// Web Mercator. `z` is the tile zoom; the result is in world pixels at that zoom, which
// the caller offsets by the viewport origin to get screen pixels.
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
export function alignDeg(courseDeg, lineDeg){
  let d=Math.abs(((courseDeg-lineDeg)%360+360)%360);
  if(d>180) d=360-d;
  return Math.min(d,180-d);
}
