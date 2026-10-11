// static/js/home_field.js - how far she is from HOME by water, from anywhere, at the cost of a lookup.
//
// The fuel monitor (fuel.js) needs the energy home from where she is NOW and from every step of the mission ahead -
// and the RTH planner is far too dear to ask that of: one 3.5 km route home up the Piscataqua held the page's main
// thread for 1.6 s (measured on a scratch console, 2026-10-11), and the clearance guard runs on that thread. A straight
// line is no answer either: in his waters it crosses islands and land, and an underestimate of the way home is the one
// error this number must not make.
//
// So the water distance to home is built ONCE per home and chart model - outward from home over the planner's own
// conservative occupancy grid (raster.js rasterKeepouts: keep-outs dilated by the buffer, never under-approximated) -
// and every question after that is a lookup. A Dijkstra over 16 neighbours: the four sides, the four diagonals and the
// eight knight's moves, so a path in open water is within about 3% of the straight line it would be (8 neighbours alone
// are up to 8% long). No move cuts a blocked cell's corner: a diagonal needs both cells it passes between free, a
// knight's move the two it passes through.
//
// ⚠ IT IS AN ESTIMATE OF THE PLANNER'S ROUTE, NOT THE ROUTE. The planner keeps right in buoyed channels and prefers
// the guard's standoff to the bare buffer, so the RTH it lays runs somewhat longer than the shortest water path at the
// buffer; the 20% reserve is what absorbs that. A grid coarse enough to close a narrow passage makes the field LONGER
// (a detour) or unreachable, which the page then says - the safe direction.
//
// Pure, and runs in a Web Worker (home_field_worker.js) so the build never touches the page's thread.

/** The 16 moves: [dx, dy, cost in cells, ...the cells it passes between or through, as [dx, dy] pairs]. */
const HF_MOVES = (() => {
  const out = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push([dx, dy, 1, []]);
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) out.push([dx, dy, Math.SQRT2, [[dx, 0], [0, dy]]]);
  for (const [dx, dy] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]]) {
    // a knight's move passes through the two cells either side of its midpoint
    const via = Math.abs(dx) === 2 ? [[dx / 2, 0], [dx / 2, dy]] : [[0, dy / 2], [dx, dy / 2]];
    out.push([dx, dy, Math.hypot(dx, dy), via]);
  }
  return out;
})();

/** The nearest FREE cell to (gx, gy) within `rad` cells, or null: {i, gx, gy, d} with d in cells. */
export function nearestFreeCell(blk, W, H, gx, gy, rad) {
  let best = null;
  for (let r = 0; r <= rad; r++) {
    if (best && best.d <= r) break;                     // nothing on a farther ring can be nearer
    for (let y = gy - r; y <= gy + r; y++) {
      for (let x = gx - r; x <= gx + r; x++) {
        if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) !== r) continue;
        if (x < 0 || y < 0 || x >= W || y >= H || blk[y * W + x]) continue;
        const d = Math.hypot(x - gx, y - gy);
        if (!best || d < best.d) best = { i: y * W + x, gx: x, gy: y, d };
      }
    }
  }
  return best;
}

/**
 * The distance field, in CELLS: a Float64Array over the W x H grid, Infinity where the seeds cannot be reached.
 * `blk` the occupancy grid (1 = blocked), `seeds` [{i, d}] - cell index and its starting distance in cells.
 */
export function homeField(blk, W, H, seeds) {
  const N = W * H, dist = new Float64Array(N).fill(Infinity);   // 64-bit, as the heap's keys: a
  // 32-bit field read a seed at 0.7 as 0.69999999 and skipped it as stale, and nothing propagated
  // a binary heap of (distance, cell) - lazy deletion: a stale entry is skipped when popped
  let cap = 1 << 16, hk = new Float64Array(cap), hv = new Int32Array(cap), hn = 0;
  const push = (k, v) => {
    if (hn === cap) {
      cap *= 2;
      const k2 = new Float64Array(cap), v2 = new Int32Array(cap);
      k2.set(hk); v2.set(hv); hk = k2; hv = v2;
    }
    let i = hn++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= k) break;
      hk[i] = hk[p]; hv[i] = hv[p]; i = p;
    }
    hk[i] = k; hv[i] = v;
  };
  const pop = () => {
    const v = hv[0], lk = hk[--hn], lv = hv[hn];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= hn) break;
      if (c + 1 < hn && hk[c + 1] < hk[c]) c++;
      if (hk[c] >= lk) break;
      hk[i] = hk[c]; hv[i] = hv[c]; i = c;
    }
    hk[i] = lk; hv[i] = lv;
    return v;
  };
  for (const s of seeds || []) {
    if (s.i >= 0 && s.i < N && !blk[s.i] && s.d < dist[s.i]) { dist[s.i] = s.d; push(s.d, s.i); }
  }
  // the moves as flat arrays of index offsets for this W (the inner loop runs some 16 times per cell)
  const M = HF_MOVES.length, mdx = new Int32Array(M), mdy = new Int32Array(M), mcost = new Float64Array(M);
  const mOff = new Int32Array(M), v1 = new Int32Array(M), v2 = new Int32Array(M), nv = new Int32Array(M);
  HF_MOVES.forEach(([dx, dy, cost, via], m) => {
    mdx[m] = dx; mdy[m] = dy; mcost[m] = cost; mOff[m] = dy * W + dx; nv[m] = via.length;
    if (via.length) { v1[m] = via[0][1] * W + via[0][0]; v2[m] = via[1][1] * W + via[1][0]; }
  });
  while (hn > 0) {
    const k0 = hk[0], c = pop(), dc = dist[c];
    if (k0 > dc) continue;
    const cx = c % W, cy = (c - cx) / W;
    for (let m = 0; m < M; m++) {
      const x = cx + mdx[m], y = cy + mdy[m];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = c + mOff[m];
      if (blk[j] || (nv[m] && (blk[c + v1[m]] || blk[c + v2[m]]))) continue;
      const nd = dc + mcost[m];
      if (nd < dist[j]) { dist[j] = nd; push(nd, j); }
    }
  }
  return dist;
}

/**
 * THE GRID FOR A HOME: a box in the plane {x0, y0, cell, W, H} covering the points `pts` [{e, n}] (home, the boat, the
 * mission) padded by `padM`, inside `clip` {e0, n0, e1, n1} (the chart's extract) when given, at the finest cell no
 * smaller than `minCell` that keeps it to `maxCells`. Null when nothing is left of it.
 */
export function homeGrid(pts, padM, clip, minCell, maxCells) {
  if (!pts || !pts.length) return null;
  let e0 = Infinity, n0 = Infinity, e1 = -Infinity, n1 = -Infinity;
  for (const p of pts) { e0 = Math.min(e0, p.e); n0 = Math.min(n0, p.n); e1 = Math.max(e1, p.e); n1 = Math.max(n1, p.n); }
  e0 -= padM; n0 -= padM; e1 += padM; n1 += padM;
  if (clip) { e0 = Math.max(e0, clip.e0); n0 = Math.max(n0, clip.n0); e1 = Math.min(e1, clip.e1); n1 = Math.min(n1, clip.n1); }
  if (!(e1 > e0 && n1 > n0)) return null;
  const cell = Math.max(minCell, Math.sqrt((e1 - e0) * (n1 - n0) / maxCells));
  const W = Math.max(2, Math.ceil((e1 - e0) / cell)), H = Math.max(2, Math.ceil((n1 - n0) / cell));
  return { x0: e0, y0: n0, cell, W, H };
}

/** The cell a plane point falls in, or null outside the grid. */
export function cellOf(g, p) {
  const gx = Math.floor((p.e - g.x0) / g.cell), gy = Math.floor((p.n - g.y0) / g.cell);
  return gx < 0 || gy < 0 || gx >= g.W || gy >= g.H ? null : { gx, gy, i: gy * g.W + gx };
}

/** A cell's center in the plane. */
export function cellCenter(g, gx, gy) {
  return { e: g.x0 + (gx + 0.5) * g.cell, n: g.y0 + (gy + 0.5) * g.cell };
}

/**
 * The SEEDS for a home at plane point `home`: its own cell if it is water, else the nearest water cell within `radM`
 * (a home at a berth, inside the buffer - the RTH holds off it the same way), each at its straight distance from home.
 * Null when there is none.
 */
export function homeSeeds(g, blk, home, radM) {
  const c = cellOf(g, home);
  if (!c) return null;
  const f = nearestFreeCell(blk, g.W, g.H, c.gx, c.gy, Math.ceil(radM / g.cell));
  if (!f) return null;
  const at = cellCenter(g, f.gx, f.gy);
  return [{ i: f.i, d: Math.hypot(at.e - home.e, at.n - home.n) / g.cell }];
}

/**
 * HER WATER DISTANCE HOME from plane point `p`, meters: the field at her cell plus her offset from its center - or,
 * when her own cell is blocked or cut off (alongside, inside the buffer), at the nearest cell within `radM` that does
 * reach home, plus the straight distance to it. Null outside the grid or with nothing reachable near her.
 */
export function fieldDistM(g, dist, blk, p, radM) {
  const c = cellOf(g, p);
  if (!c) return null;
  const R = Math.ceil(radM / g.cell);
  let best = null;
  for (let r = 0; r <= R; r++) {
    if (best !== null && best <= (r - 1) * g.cell) break;   // a cell on ring r is at least r - 1 cells from her
    for (let y = c.gy - r; y <= c.gy + r; y++) {
      for (let x = c.gx - r; x <= c.gx + r; x++) {
        if (Math.max(Math.abs(x - c.gx), Math.abs(y - c.gy)) !== r) continue;
        if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
        const i = y * g.W + x;
        if (blk[i] || !Number.isFinite(dist[i])) continue;
        const at = cellCenter(g, x, y), m = dist[i] * g.cell + Math.hypot(at.e - p.e, at.n - p.n);
        if (best === null || m < best) best = m;
      }
    }
  }
  return best;
}
