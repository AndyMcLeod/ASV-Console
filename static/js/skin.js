// static/js/skin.js - THE SKIN OF THE EARTH HAS NO GAPS, so a gap in it is an object the console does not hold.
//
// Andy, 2026-10-01, at Pepperrell Cove with survey lines and transits drawn straight across the floats off the
// Kittery Point piers: "The ENC check routine that catches features not represented in layers missed these dock
// features and ran transits and survey lines across them. review the routine and improve."
//
// WHAT THE FLOATS ARE, AND WHY NO LAYER HAS THEM. They are pontoons - S-57 PONTON. NOAA's chart renderer draws
// them (the yellow shapes on his chart, each with its gangway to a pier); NOAA's vector service, the one the
// console extracts from, publishes no pontoon layer in any band (see "Pontoon_line" in asv_console.py's
// ENC_ROLES), so the extract holds no feature for them. The chart-image scan (chartink.js) was the backstop, and
// it missed them too: their outlines were "explained" by depth-area boundaries that trace them exactly.
//
// ⚠⚠ THAT IS ALSO WHY THE EXTRACT HAS THEIR SHAPE, EXACTLY. S-57 puts a few classes in GROUP 1, "the skin of the
// earth": depth areas, dredged areas, land, floating docks, hulks, pontoons and unsurveyed areas. Group 1 objects
// tile the whole chart with NO GAPS AND NO OVERLAPS, so every pontoon is cut out of the depth areas round it - and
// the depth areas ARE served. Wherever no Group 1 polygon the console holds covers the seabed, the chart has an
// object there that the console does not hold. At Pepperrell Cove that is exactly the two floats: a 62 m2 hole in
// one depth area, and a 194 m2 Z-shaped gap between two of them - and nothing else in a 10 km extract but one
// more float at the shipyard.
//
// THE METHOD IS TOPOLOGY, NOT GEOMETRY. Adjacent Group 1 polygons share their edges vertex for vertex (measured:
// 92.1% of the 183,639 edges in his New Castle extract cancel in pairs and every vertex balances; Lewes 89.8%, Los
// Angeles 97.8%, the same). Orient every ring so its polygon lies on its LEFT; an edge two polygons share then
// appears once each way and cancels. What is left bounds the coverage - its outer limits and its holes - and the
// rings that close CLOCKWISE are the holes: the uncovered side is inside them. No union, no clipping, no
// tolerance: an edge either cancels or it does not.
//
// ⚠ ONLY HOLES WHOLLY INSIDE THE EXTRACT ARE GAPS. A feature is fetched if it touches the box, so near the box's
// edge a hole's filler can lie outside it, unfetched: islands just beyond the east edge of his New Castle extract
// leave 156 apparent holes, every one of them crossing the edge. Inside the box everything that could fill a hole
// was fetched, so a hole there is a hole in the chart's own seabed.
//
// ⚠⚠ A PARTIAL EXTRACT IS REFUSED, NOT READ. For every other layer a missing one is the dangerous direction - a
// pier not drawn is a pier not avoided. Here it is the opposite and just as bad: a depth layer that failed to
// arrive would make the whole area read as one gap, a keep-out the size of the harbour. `partial` names the failed
// classes; one Group 1 class among them and the answer is "not read", in words.
//
// NOTHING HERE TOUCHES THE PAGE. Features in, gaps out - tests/skin_gaps.js holds it without a browser.

/** The Group 1 classes under the names NOAA's vector service publishes them as (the ones it does not, too). */
export const SKIN_CLASSES = Object.freeze(["Depth_Area", "Dredged_Area", "Land_Area", "Floating_Dock_area",
                                          "Hulk_area", "Pontoon_area", "Unsurveyed_Area"]);
const SKIN_SET = new Set(SKIN_CLASSES);
/** Vertices are matched on a 1e-7 degree grid, about a centimeter: the same vertex has the same key. */
export const SKIN_Q = 1e7;
/** A gap smaller than this is arithmetic, not an object. */
export const MIN_GAP_M2 = 1.0;
/** What a gap is called wherever a refusal or a readout names it. */
export const SKIN_KIND = "a float the ENC charts but NOAA's vector service omits (a gap in the charted seabed)";
/** The class a gap is carried under in the feature list - its own, so nothing mistakes it for a served one. */
export const SKIN_GAP_CLASS = "Skin_Gap_area";

const M_PER_DEG = 111320;
const SPAN = 67108864;                      // 2^26 vertex ids, so an edge key a*SPAN+b stays an exact integer

/**
 * The gaps in the skin of the earth, inside `bbox`.
 *
 * @param {Array} features   the extract, as /api/enc serves it ({role, cls, props, geometry} in lon/lat)
 * @param {{W:number,S:number,E:number,N:number}} bbox   the box the extract was fetched over
 * @param {{partial?: string[]}} [opts]   the classes the server says failed to arrive
 * @returns {{gaps: Array<{ring: number[][], areaM2: number, wM: number, hM: number, lat: number, lon: number}>,
 *            refused: string|null, held: number, rings: number, edges: number, cancelled: number,
 *            chains: number, open: number, crossing: number, slivers: number}}
 *   `crossing` counts the holes that reach outside the box (unjudged: their filler may lie beyond it), `open` the
 *   leftover chains that never closed (zero on every extract measured - a broken topology would show here first),
 *   `slivers` the closed gaps under MIN_GAP_M2.
 */
export function skinGaps(features, bbox, opts = {}) {
  const out = { gaps: [], refused: null, held: 0, rings: 0, edges: 0, cancelled: 0, chains: 0, open: 0,
                crossing: 0, slivers: 0 };
  const failed = (opts.partial || []).filter(c => SKIN_SET.has(c));
  if (failed.length) {
    out.refused = "the extract arrived without its " + failed.join(", ") + " layer(s) - a missing depth layer "
                + "would read as one gap over the whole area, so the seabed was NOT checked for gaps";
    return out;
  }
  if (!bbox || !(bbox.W < bbox.E && bbox.S < bbox.N)) { out.refused = "no extract box to judge holes against"; return out; }

  // ONE ID PER VERTEX, so an edge is two small integers rather than a string per edge.
  // ⚠ THIS PASS IS THE WHOLE COST OF THE FUNCTION, and it runs on the page's main thread - the clearance guard's
  // thread. A string key per vertex took 650 ms over his New Castle extract; a Map of number keys ~250 ms all
  // told. So: offsets from the box's center, 26 bits each way (+-3.3 degrees, twice the widest extract the
  // server will cut), packed into one exact integer and kept in an open-addressed table of typed arrays; a vertex
  // beyond that range falls back to a string-keyed Map, so a far vertex costs time but is never wrong.
  const vx = [], vy = [];
  const cx0 = Math.round((bbox.W + bbox.E) / 2 * SKIN_Q), cy0 = Math.round((bbox.S + bbox.N) / 2 * SKIN_Q);
  const HALF = 33554432;
  let cap = 1 << 16, mask = cap - 1, HK = new Float64Array(cap).fill(-1), HI = new Int32Array(cap);
  const far = new Map();
  const slot = (dx, dy, k) => {
    let h = (Math.imul(dx, 0x9E3779B1) ^ Math.imul(dy, 0x85EBCA77)) & mask;
    while (HK[h] !== -1 && HK[h] !== k) h = (h + 1) & mask;
    return h;
  };
  const idOf = (x, y) => {
    const dx = x - cx0 + HALF, dy = y - cy0 + HALF;
    if (!(dx >= 0 && dx < SPAN && dy >= 0 && dy < SPAN)) {
      const k = x + "," + y;
      let i = far.get(k);
      if (i === undefined) { i = vx.length; far.set(k, i); vx.push(x); vy.push(y); }
      return i;
    }
    const k = dx * SPAN + dy;
    let h = slot(dx, dy, k);
    if (HK[h] === k) return HI[h];
    if ((vx.length + 1) * 2 > cap) {                      // half full: double, and re-place every key
      const ok = HK, oi = HI;
      cap *= 2; mask = cap - 1; HK = new Float64Array(cap).fill(-1); HI = new Int32Array(cap);
      for (let j = 0; j < ok.length; j++) if (ok[j] !== -1) {
        const kk = ok[j], ddx = Math.floor(kk / SPAN), s = slot(ddx, kk - ddx * SPAN, kk);
        HK[s] = kk; HI[s] = oi[j];
      }
      h = slot(dx, dy, k);
    }
    HK[h] = k; HI[h] = vx.length; vx.push(x); vy.push(y);
    return vx.length - 1;
  };
  // Twice the signed area, from offsets to the ring's first vertex: the absolute products would run past 2^53.
  const area2 = (ids) => {
    const x0 = vx[ids[0]], y0 = vy[ids[0]];
    let a = 0;
    for (let i = 1; i < ids.length; i++) {
      const ax = vx[ids[i - 1]] - x0, ay = vy[ids[i - 1]] - y0, bx = vx[ids[i]] - x0, by = vy[ids[i]] - y0;
      a += ax * by - bx * ay;
    }
    return a;
  };
  // The directed edges, as vertex-id pairs in growable typed arrays.
  let EA = new Int32Array(1 << 16), EB = new Int32Array(1 << 16), ne = 0;
  const pushEdge = (a, b) => {
    if (ne === EA.length) {
      const na = new Int32Array(ne * 2), nb = new Int32Array(ne * 2);
      na.set(EA); nb.set(EB); EA = na; EB = nb;
    }
    EA[ne] = a; EB[ne] = b; ne++;
  };
  let buf = new Int32Array(4096);                      // one ring's vertex ids, reused for every ring
  for (const f of features || []) {
    if (!f || !SKIN_SET.has(f.cls) || !f.geometry) continue;
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : null;
    if (!polys) continue;
    for (const poly of polys) {
      out.held++;
      for (let ri = 0; ri < poly.length; ri++) {
        const ring = poly[ri];
        if (!ring || ring.length < 3) continue;
        if (buf.length < ring.length + 1) buf = new Int32Array(2 * ring.length + 2);
        let n = 0;
        for (let j = 0; j < ring.length; j++) {
          const c = ring[j], i = idOf(Math.round(c[0] * SKIN_Q), Math.round(c[1] * SKIN_Q));
          if (n === 0 || buf[n - 1] !== i) buf[n++] = i;
        }
        if (buf[0] !== buf[n - 1]) buf[n++] = buf[0];
        if (n < 4) continue;
        // ⚠ ORIENTED HERE, NOT TRUSTED. The interior goes on the LEFT of every edge - outer rings
        // counter-clockwise, holes clockwise - whatever winding the service happened to send.
        const x0 = vx[buf[0]], y0 = vy[buf[0]];
        let A = 0;
        for (let j = 1; j < n; j++) {
          const ax = vx[buf[j - 1]] - x0, ay = vy[buf[j - 1]] - y0, bx = vx[buf[j]] - x0, by = vy[buf[j]] - y0;
          A += ax * by - bx * ay;
        }
        const flip = (ri === 0 && A < 0) || (ri > 0 && A > 0);
        out.rings++;
        for (let j = 1; j < n; j++) { if (flip) pushEdge(buf[j], buf[j - 1]); else pushEdge(buf[j - 1], buf[j]); }
      }
    }
  }
  out.edges = ne;

  // AN EDGE SHARED BY TWO POLYGONS RUNS ONCE EACH WAY AND CANCELS. What survives bounds the coverage.
  // ⚠ BY SORTING, NOT BY A MAP OF COUNTS (the second half of the 650 ms): each edge becomes one exact number - its
  // two ends low-id first, doubled, plus one if it runs high to low - so after a numeric sort every copy of an
  // undirected edge sits together and its two directions can simply be counted. ESPAN is sized to the vertex
  // count, which keeps every key below 2^53.
  let ESPAN = 2;
  while (ESPAN <= vx.length) ESPAN *= 2;
  const keys = new Float64Array(ne);
  for (let i = 0; i < ne; i++) {
    const a = EA[i], b = EB[i];
    keys[i] = a < b ? (a * ESPAN + b) * 2 : (b * ESPAN + a) * 2 + 1;
  }
  keys.sort();
  const left = new Map();
  const leave = (a, b, n) => {
    let L = left.get(a);
    if (!L) left.set(a, L = []);
    for (let j = 0; j < n; j++) L.push(b);
  };
  for (let i = 0; i < ne; ) {
    const u = Math.floor(keys[i] / 2);
    let fwd = 0, rev = 0, j = i;
    while (j < ne && Math.floor(keys[j] / 2) === u) { if (keys[j] % 2) rev++; else fwd++; j++; }
    const lo = Math.floor(u / ESPAN), hi = u - lo * ESPAN, c = Math.min(fwd, rev);
    out.cancelled += 2 * c;
    if (fwd > c) leave(lo, hi, fwd - c);
    if (rev > c) leave(hi, lo, rev - c);
    i = j;
  }

  // CHAIN THE SURVIVORS INTO RINGS. Where two of them leave one vertex - two gaps touching at a corner - the turn
  // that keeps the UNCOVERED side on the right is the smallest counter-clockwise turn from the way back.
  const turn = (cur, prev, to) => {
    const bx = vx[prev] - vx[cur], by = vy[prev] - vy[cur], dx = vx[to] - vx[cur], dy = vy[to] - vy[cur];
    let t = Math.atan2(bx * dy - by * dx, bx * dx + by * dy);
    if (t <= 0) t += 2 * Math.PI;
    return t;
  };
  const qW = bbox.W * SKIN_Q, qE = bbox.E * SKIN_Q, qS = bbox.S * SKIN_Q, qN = bbox.N * SKIN_Q;
  for (const [s0, L0] of left) {
    while (L0.length) {
      const first = L0.pop();
      const ring = [s0, first];
      let prev = s0, cur = first, closed = false;
      for (let guard = 0; guard < 4 * out.edges + 8; guard++) {
        const L = left.get(cur) || [];
        let best = -1, bestT = Infinity;
        for (let j = 0; j < L.length; j++) {
          const t = turn(cur, prev, L[j]);
          if (t < bestT) { bestT = t; best = j; }
        }
        if (cur === s0 && (best < 0 || turn(s0, prev, first) <= bestT)) { closed = true; break; }
        if (best < 0) break;                              // the survivors do not balance here: an open chain
        const nxt = L[best];
        L.splice(best, 1);
        ring.push(nxt);
        prev = cur; cur = nxt;
      }
      out.chains++;
      if (!closed) { out.open++; continue; }
      if (area2(ring) >= 0) continue;                     // counter-clockwise: an outer limit of the coverage
      let inside = true;
      for (const i of ring) if (!(vx[i] >= qW && vx[i] <= qE && vy[i] >= qS && vy[i] <= qN)) { inside = false; break; }
      if (!inside) { out.crossing++; continue; }
      const pts = ring.map(i => [vx[i] / SKIN_Q, vy[i] / SKIN_Q]);
      let lat = 0, lon = 0;
      for (const p of pts) { lon += p[0]; lat += p[1]; }
      lat /= pts.length; lon /= pts.length;
      const kx = M_PER_DEG * Math.cos(lat * Math.PI / 180);
      const areaM2 = Math.abs(area2(ring)) / 2 / (SKIN_Q * SKIN_Q) * kx * M_PER_DEG;
      if (areaM2 < MIN_GAP_M2) { out.slivers++; continue; }
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      out.gaps.push({ ring: pts, areaM2, lat, lon,
                      wM: (Math.max(...xs) - Math.min(...xs)) * kx, hM: (Math.max(...ys) - Math.min(...ys)) * M_PER_DEG });
    }
  }
  out.gaps.sort((a, b) => b.areaM2 - a.areaM2);
  return out;
}

/**
 * A gap as a feature the keep-out model reads like any dock - role `dock`, so it follows the operator's
 * structure toggle, is painted into the chart scan's explained mask and joins its attachment pool - but under its
 * OWN class and kind, so a refusal names it for what it is and nothing mistakes it for a feature NOAA served.
 */
export function skinGapFeature(gap) {
  return { role: "dock", cls: SKIN_GAP_CLASS, kind: SKIN_KIND, derived: "skin_gap",
           props: { AREA_M2: Math.round(gap.areaM2 * 10) / 10 },
           geometry: { type: "Polygon", coordinates: [gap.ring] } };
}
