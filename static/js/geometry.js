// static/js/geometry.js — pure plane geometry and GeoJSON traversal.
//
// No DOM, no shared state. Two coordinate conventions live here and they are NOT
// interchangeable — mixing them is the easiest mistake to make in this file:
//
//   * ENU points  {e, n}   meters east / north about some reference (see geodesy.llEN).
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

// THE PLANAR PRIMITIVES COME FROM asv_core (2026-08-19). bbOf, inBB, dSeg, pinp and the
// three GeoJSON walkers are the core's now, re-exported here so every existing importer
// is untouched. WorldView had the same seven inside its keepouts.js, and they were
// measured side by side BEFORE the move rather than after: dSeg/bbOf/inBB bit-identical
// over 500/300/300 random cases, pinp agreeing over 400, the walkers yielding identically
// for Polygon, MultiPolygon, LineString and Point. A textual diff says every body differs.
// It is reading whitespace.
//
// NOTHING ELSE IN THE KEEP-OUT LAYER MOVED, AND THE REST IS NOT LIKE THESE. `blocked`,
// `blockedInfo`, `buildKeepouts`, `legClear`, `firstBlockAlong` and `channelPolys` are
// parallel implementations with different seams -- and three of them take a bare `ref`
// point here where WorldView takes a `Frame`, which is the same split that stopped the
// geodesy adoption at the ENU boundary. Those need a merge, not a vendoring.
import { bbOf, inBB, dSeg, pinp, eachRing, eachPath, eachPoint } from "./core_geometry.js";
export { bbOf, inBB, dSeg, pinp, eachRing, eachPath, eachPoint };

// --- bounding boxes -------------------------------------------------------------------
// ENU bbox of a point list. The 1e18 seeds stand in for infinities so an empty list gives
// an inverted box that `inBB` rejects for every point, rather than one that accepts all.

// Geographic bboxes are {W,S,E,N} in degrees — a different shape from the ENU {x0,y0,x1,y1}
// above, on purpose: they are not comparable and the field names keep them apart.
export function bboxContains(outer, inner){      // does the fetched coverage cover a survey bbox?
  return outer && inner && outer.W<=inner.W && outer.S<=inner.S && outer.E>=inner.E && outer.N>=inner.N;
}
/**
 * How far `to` lies ACROSS the track from `from`, for a vessel heading `headingDeg`.
 *
 * ⚠⚠ THE ACROSS-TRACK COMPONENT IS NOT THE DISTANCE, and the difference is the whole
 * reason this exists. Two survey lines one spacing apart are NEIGHBORS however far apart
 * their ends are along the line - and the chart clip leaves neighboring runs at different
 * extents routinely, so their ends can be a hundred metres apart while the lines are ten
 * metres apart. Asking the straight end-to-end distance answers a different question and
 * reads as the first one.
 *
 * ⚠ THE AXIS IS THE WHOLE CONTENT OF THIS FUNCTION. Projecting onto the heading gives the
 * ALONG-track component; projecting onto its normal gives the ACROSS. Swapping them inverts
 * every judgement built on it, and reads almost identically - which is exactly what a
 * mutation of this line did survive, back when it was inline trig nobody could drive.
 */
export function acrossTrackM(from, to, headingDeg, ref) {
  const a = llEN(from.lat, from.lon, ref), b = llEN(to.lat, to.lon, ref);
  const th = headingDeg * Math.PI / 180;
  const u = Math.sin(th), v = Math.cos(th);          // the unit vector ALONG the heading
  return Math.abs((b.e - a.e) * -v + (b.n - a.n) * u);   // ...onto its NORMAL
}

export function bboxAround(ll, radM){
  const dlat=radM/M_PER_DEG_LAT, dlon=radM/(M_PER_DEG_LAT*Math.cos(ll.lat*Math.PI/180));
  return {W:ll.lon-dlon, S:ll.lat-dlat, E:ll.lon+dlon, N:ll.lat+dlat};
}

// --- segments -------------------------------------------------------------------------
export function lerpLL(a,b,t){ return {lat:a.lat+(b.lat-a.lat)*t, lon:a.lon+(b.lon-a.lon)*t}; }

// Distance from an ENU point to a SEGMENT (not the infinite line): t is clamped to [0,1],
// which is what makes this usable for keep-out clearance rather than just bearing maths.

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

// --- GeoJSON traversal ----------------------------------------------------------------
// Each walker is a no-op on a geometry of the wrong type, so a caller can run all three
// over a mixed feature list without testing `type` itself.

// Is (lat,lon) inside a Polygon/MultiPolygon? Evaluated in an ENU frame CENTERD
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

// ── A RING'S EDGES IN A GRID (2026-11-27, Andy's 5999-corner survey area) ─────────────────────────────────────────
// The page clips every survey line to the survey area (clipToPoly) on every redraw: each line against EVERY edge, then a
// point-in-polygon over every edge for each piece. Measured on the page's own functions: 66 ms a redraw at 2000
// corners, 195 at 6000, 735 at 20000 - a chart that stutters as it pans. This files the edges in a grid over the ring's
// extent so a line asks only the edges in the cells it passes through, and a point only the edges in its own row.
//
// ⚠ THE ANSWER IS THE FULL SCAN'S, BIT FOR BIT - it only skips edges that cannot answer. `edgesNear` hands over a
// SUPERSET of the edges a segment can meet (each edge filed in every cell its own run passes through, the segment read
// the same way, both widened by EPS of a cell against rounding), and the caller runs the same segInt on each, in the
// same (ring[j], ring[i]) order. `inside` is core pinp's even-odd test over the edges filed in the point's row: an edge
// pinp counts straddles the point's northing, so its run covers that row. tests/survey_area.js 9 holds the two equal
// over thousands of rings and lines.
const RING_GRID_MAX = 512;        // cells a side, at most
const RING_GRID_EPS = 1e-6;       // of a cell: the widening against rounding
/** The ring's edges filed in a grid, or null for a ring the grid cannot file (under 3 corners, a non-finite one): the
 *  caller then scans every edge. Edge i is ring[j] -> ring[i], j the corner before i - the order pinp and the page's
 *  clip loop take them in. */
export function ringGrid(ring){
  const n = ring ? ring.length : 0;
  if(n < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const p of ring){
    if(!Number.isFinite(p.e) || !Number.isFinite(p.n)) return null;
    if(p.e < x0) x0 = p.e;
    if(p.e > x1) x1 = p.e;
    if(p.n < y0) y0 = p.n;
    if(p.n > y1) y1 = p.n;
  }
  const G = Math.max(1, Math.min(RING_GRID_MAX, Math.ceil(Math.sqrt(n))));
  const w = (x1 - x0) / G || 1, h = (y1 - y0) / G || 1;        // an extent with no width is one cell across
  const ew = RING_GRID_EPS * w, eh = RING_GRID_EPS * h;
  const clampI = (v) => v < 0 ? 0 : v >= G ? G - 1 : v;
  const col = (x) => clampI(Math.floor((x - x0) / w)), row = (y) => clampI(Math.floor((y - y0) / h));
  // the cells a segment passes through: each row its northings span, and in it the columns of the part of it in that
  // row's band - every bound widened by EPS of a cell
  const eachCell = (a, b, fn) => {
    const r0 = row(Math.min(a.n, b.n) - eh), r1 = row(Math.max(a.n, b.n) + eh), dy = b.n - a.n, dx = b.e - a.e;
    for(let r = r0; r <= r1; r++){
      let xa = a.e, xb = b.e;
      if(dy !== 0){
        const lo = y0 + r * h - eh, hi = y0 + (r + 1) * h + eh;
        let ta = (lo - a.n) / dy, tb = (hi - a.n) / dy;
        ta = ta < 0 ? 0 : ta > 1 ? 1 : ta;
        tb = tb < 0 ? 0 : tb > 1 ? 1 : tb;
        xa = a.e + dx * ta; xb = a.e + dx * tb;
      }
      const c0 = col(Math.min(xa, xb) - ew), c1 = col(Math.max(xa, xb) + ew);
      for(let c = c0; c <= c1; c++) fn(r * G + c);
    }
  };
  const cells = new Array(G * G), rows = new Array(G);
  for(let i = 0, j = n - 1; i < n; j = i++){
    eachCell(ring[j], ring[i], (k) => { (cells[k] || (cells[k] = [])).push(i); });
    const r0 = row(Math.min(ring[j].n, ring[i].n) - eh), r1 = row(Math.max(ring[j].n, ring[i].n) + eh);
    for(let r = r0; r <= r1; r++) (rows[r] || (rows[r] = [])).push(i);
  }
  const seen = new Int32Array(n);
  let stamp = 0;
  return {
    n, G,
    /** fn(i, j) once for each edge ring[j] -> ring[i] that segment a -> b ({e, n}) may meet (a superset). */
    edgesNear(a, b, fn){
      if(!Number.isFinite(a.e) || !Number.isFinite(a.n) || !Number.isFinite(b.e) || !Number.isFinite(b.n)){
        for(let i = 0, j = n - 1; i < n; j = i++) fn(i, j);   // nothing to file it by: every edge, as the full scan
        return;
      }
      if(++stamp === 0x7fffffff){ seen.fill(0); stamp = 1; }
      eachCell(a, b, (k) => {
        const L = cells[k]; if(!L) return;
        for(const i of L){ if(seen[i] !== stamp){ seen[i] = stamp; fn(i, i === 0 ? n - 1 : i - 1); } }
      });
    },
    /** core pinp's answer for {e, n} p, asked of the edges filed in p's row only. */
    inside(p){
      if(!Number.isFinite(p.e) || !Number.isFinite(p.n)) return pinp(p, ring);
      const L = rows[row(p.n)]; if(!L) return false;
      let inside = false;
      for(const i of L){
        const j = i === 0 ? n - 1 : i - 1;
        const xi = ring[i].e, yi = ring[i].n, xj = ring[j].e, yj = ring[j].n;
        if(((yi > p.n) !== (yj > p.n)) && (p.e < (xj - xi) * (p.n - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    },
  };
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
