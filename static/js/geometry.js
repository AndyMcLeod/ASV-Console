// static/js/geometry.js — pure plane geometry and GeoJSON traversal.
//
// No DOM, no shared state. Two coordinate conventions live here and they are NOT
// interchangeable — mixing them is the easiest mistake to make in this file:
//
//   * ENU points  {e, n}   metres east / north about some reference (see geodesy.llEN).
//                          Everything that measures, clips or tests containment works here.
//   * lat/lon     {lat,lon} degrees. Only lerpLL and bboxAround take these.
//
// GeoJSON coordinates are [lon, lat] — longitude FIRST. The eachRing / eachPath / eachPoint
// walkers hand the raw arrays through untouched, so a caller reading `c[0]` is reading a
// LONGITUDE. Every call site in the page does `toScreen(c[1], c[0])` for that reason.

// llEN is used by ptInGeom and segSamplesEN below, and was MISSING from this import for
// two commits: the page's eval'd copies resolved it from page scope, so nothing complained
// until a suite required the real module and got "llEN is not defined". An unresolved free
// variable in an ES module is a RUNTIME error inside the function, never a load error —
// which is why importing a module proves so much less than CALLING one.
import { M_PER_DEG_LAT, llEN } from "./geodesy.js";

// --- bounding boxes -------------------------------------------------------------------
// ENU bbox of a point list. The 1e18 seeds stand in for infinities so an empty list gives
// an inverted box that `inBB` rejects for every point, rather than one that accepts all.
export function bbOf(pts){ let x0=1e18,y0=1e18,x1=-1e18,y1=-1e18; for(const p of pts){ if(p.e<x0)x0=p.e; if(p.e>x1)x1=p.e; if(p.n<y0)y0=p.n; if(p.n>y1)y1=p.n; } return {x0,y0,x1,y1}; }
export function inBB(p,bb,buf){ return p.e>=bb.x0-buf&&p.e<=bb.x1+buf&&p.n>=bb.y0-buf&&p.n<=bb.y1+buf; }

// Geographic bboxes are {W,S,E,N} in degrees — a different shape from the ENU {x0,y0,x1,y1}
// above, on purpose: they are not comparable and the field names keep them apart.
export function bboxContains(outer, inner){      // does the fetched coverage cover a survey bbox?
  return outer && inner && outer.W<=inner.W && outer.S<=inner.S && outer.E>=inner.E && outer.N>=inner.N;
}
export function bboxAround(ll, radM){
  const dlat=radM/M_PER_DEG_LAT, dlon=radM/(M_PER_DEG_LAT*Math.cos(ll.lat*Math.PI/180));
  return {W:ll.lon-dlon, S:ll.lat-dlat, E:ll.lon+dlon, N:ll.lat+dlat};
}

// --- segments -------------------------------------------------------------------------
export function lerpLL(a,b,t){ return {lat:a.lat+(b.lat-a.lat)*t, lon:a.lon+(b.lon-a.lon)*t}; }

// Distance from an ENU point to a SEGMENT (not the infinite line): t is clamped to [0,1],
// which is what makes this usable for keep-out clearance rather than just bearing maths.
export function dSeg(p,a,b){ const dx=b.e-a.e, dy=b.n-a.n, l2=dx*dx+dy*dy||1;
  let t=((p.e-a.e)*dx+(p.n-a.n)*dy)/l2; t=t<0?0:t>1?1:t;
  return Math.hypot(p.e-(a.e+t*dx), p.n-(a.n+t*dy)); }

// Parameter t along p1->p2 where it meets p3->p4, or null. Returns the PARAMETER, not the
// point, because callers want "how far along my leg does it get blocked" more often than
// they want the crossing itself. Near-parallel segments (|den| < 1e-9) report null.
export function segInt(p1,p2,p3,p4){
  const d1x=p2.e-p1.e,d1y=p2.n-p1.n,d2x=p4.e-p3.e,d2y=p4.n-p3.n, den=d1x*d2y-d1y*d2x;
  if(Math.abs(den)<1e-9) return null;
  const t=((p3.e-p1.e)*d2y-(p3.n-p1.n)*d2x)/den, u=((p3.e-p1.e)*d1y-(p3.n-p1.n)*d1x)/den;
  return (t>=0&&t<=1&&u>=0&&u<=1) ? t : null;
}

// --- containment ----------------------------------------------------------------------
// Ray-casting point-in-polygon over an ENU ring. Boundary cases are not defined, and that
// is acceptable here because every caller has already added a keep-clear buffer.
export function pinp(p, ring){ let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){ const xi=ring[i].e,yi=ring[i].n,xj=ring[j].e,yj=ring[j].n;
    if(((yi>p.n)!=(yj>p.n)) && (p.e < (xj-xi)*(p.n-yi)/(yj-yi)+xi)) inside=!inside; } return inside; }

// --- GeoJSON traversal ----------------------------------------------------------------
// Each walker is a no-op on a geometry of the wrong type, so a caller can run all three
// over a mixed feature list without testing `type` itself.
export function eachRing(g, fn){ if(!g) return;
  if(g.type==="Polygon") g.coordinates.forEach(fn);
  else if(g.type==="MultiPolygon") g.coordinates.forEach(poly=>poly.forEach(fn)); }
export function eachPath(g, fn){ if(!g) return;
  if(g.type==="LineString") fn(g.coordinates);
  else if(g.type==="MultiLineString") g.coordinates.forEach(fn); }
export function eachPoint(g, fn){ if(!g) return;
  if(g.type==="Point") fn(g.coordinates);
  else if(g.type==="MultiPoint") g.coordinates.forEach(fn); }

// Is (lat,lon) inside a Polygon/MultiPolygon? Evaluated in an ENU frame CENTRED
// ON THE POINT ITSELF, so the point under test is the origin and each ring is
// projected around it - which keeps the flat-earth error smallest exactly
// where the answer is decided.
// Even-odd point-in-polygon over a GeoJSON geometry, reusing the routing
// primitives (the test point is its own ENU reference, so holes subtract).
export function ptInGeom(lat, lon, geom){
  if(!geom) return false;
  const ref = {lat, lon}, p = {e:0, n:0};
  let inside = false;
  eachRing(geom, rg=>{ const ring = rg.map(c=>llEN(c[1], c[0], ref));
    if(ring.length > 2 && pinp(p, ring)) inside = !inside; });
  return inside;
}

// Sample a segment at ~5 m in the ENU frame. The keep-out tests are POINT tests, so a
// leg is only as well tested as it is densely sampled; 5 m is finer than the
// smallest hazard the model carries.
// ~5 m EN samples along one survey line [a,b] (lat/lon pair).
export function segSamplesEN(l, ref){
  const a=llEN(l[0].lat,l[0].lon,ref), b=llEN(l[1].lat,l[1].lon,ref);
  const L=Math.hypot(b.e-a.e,b.n-a.n), n=Math.max(2,Math.ceil(L/5)), out=[];
  for(let i=0;i<=n;i++){ const t=i/n; out.push({e:a.e+(b.e-a.e)*t, n:a.n+(b.n-a.n)*t}); }
  return out;
}
