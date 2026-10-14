// static/js/coarse.js - THE PASSAGE, PLANNED COARSE: a route over a whole passage, off the tiles' planning grids.
//
// Andy, 2026-10-12: "Step 4" of the long-transit plan (CLAUDE.md, "THE LONG-TRANSIT PLAN"): a two-level passage
// planner. The console's own planner (passage.js routePlan: lanes, the chart image, moored AIS) reads ONE chart box of
// at most 1.5 degrees, the guard's own, and plans on the page's one thread - 15-31 s for a Go-To 1.5-2 degrees off. A
// 500 nm passage is neither. So the passage is planned COARSE here, in a worker (coarse_worker.js), over the grid the
// server keeps for every chart tile (asv_console.py "THE PASSAGE GRID": 256 x 256 cells a tile, ~80-108 m), and the
// console's own planner is left the water where the detail is - round each PORT (her departure, every fuel stop, the
// arrival) and the NARROW stretches, where the coarse route had to pass cells a danger touches. Those are planned in
// detail as she approaches them, against the guard's own chart; this plan says where they are.
//
// A CELL, AT THE VESSEL'S FLOOR (tileLevels), from the grid's two layers - the shallowest danger at its center (C) and
// touching it anywhere (T), in decimeters, judged as the page's keep-out model judges:
//   LV_CLEAR    nothing under the floor touches it
//   LV_NEAR     clear, beside a cell that is not                   (a cell's width from any danger is not promised)
//   LV_PARTLY   a danger touches it, its center is water
//   LV_BLOCKED  its center is land, shallow, a float, or a structure - or something overhead is lower than she needs
//   LV_UNREAD   no chart covers it - or its tile was not read
// The search (searchLeg) is an 8-neighbor A* across the tiles, cost per meter by level (COST), no corner cut past a
// cell it may not enter. A blocked cell is never entered - except inside a port's circle (PORT_R_M), where the detail
// is the console planner's and the coarse route only has to leave by water. The path is then pulled taut (pullTaut):
// a shortcut is taken only over cells no worse than the stretch of path it replaces.
//
// OPEN WATER FIRST (Andy, 2026-10-14; openwater.js, where the detail planner does the same): every cell also costs
// more the nearer it lies to a cell a danger touches or blocks - OPEN_WATER.WEIGHT x nearCost(its clearance), the same
// price the detail planner's open-water search pays, nothing past CLEAR_M - so a passage keeps that far off the
// coast, the islands and the ledges wherever the water allows, rather than threading them by the shortest way: "the
// chart may have a positional error or unmarked feature", and "safety is always better than efficiency for path
// planning". The pull then takes a shortcut only where it costs no more than the stretch it replaces, so the berth
// the search kept is not cut back to the shore. Not inside a port's circle (the detail planner's water), and not
// with `openWater: false` (the operator's Route rules: the costs by level alone, as before).
//
// Everything here is PURE: grids in, a plan out. Nothing here reads the page or commands anything.

import { OPEN_WATER, nearCost } from "./openwater.js";

export const GRID_N = 256;
export const TILE_DEG = 0.25;
export const CELL_DEG = TILE_DEG / GRID_N;               // 2^-10 degrees: exact in binary
export const GRID_HARD = -30000, GRID_NODATA = -31000, GRID_UNREAD = -32000;
export const LV_CLEAR = 0, LV_NEAR = 1, LV_PARTLY = 2, LV_BLOCKED = 3, LV_UNREAD = 4;
const M_PER_DEG = 111320;

/** Cost per meter, by level: clear water is the meter itself; a cell beside a danger a little more, one a danger
 *  touches three times as much, so the route keeps off them when water allows. Blocked and unread: never. */
export const COST = [1, 1.25, 3, Infinity, Infinity];

/** Round each port, the water the console's own planner plans in detail - the coarse route only has to leave it. */
export const PORT_R_M = 4000;

/** Inside a port's circle, a blocked cell may be crossed at this cost per meter: the harbor's way out is the detail
 *  planner's, and the coarse route needs only to reach open water by the cheapest way it can see. */
export const PORT_BLOCKED_COST = 8;

/** A narrow stretch closer than this to the next is the same one. */
export const NARROW_MERGE_M = 1000;

/** The most cells one leg's search may take off its queue before it is refused as too long to search. */
export const SEARCH_POP_CAP = 30000000;

/**
 * A tile's grid file (asv_console.py _grid_bytes, v2) -> {head, C, T, A}: Int16Arrays over the file's own bytes.
 * A (2026-10-12) is the lowest overhead clearance touching each cell, decimeters (0: a span or line with no charted
 * clearance; 32767: nothing overhead) - the third layer the v2 file carries.
 */
export function decodeGrid(buf) {
  const u8 = new Uint8Array(buf);
  if (u8.length < 8 || u8[0] !== 65 || u8[1] !== 83 || u8[2] !== 86 || u8[3] !== 71) throw new Error("not a grid file");
  const n = new DataView(buf).getUint32(4, true), N2 = GRID_N * GRID_N;
  if (u8.length !== 8 + n + 6 * N2) throw new Error("a grid file of the wrong size");
  const head = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + n)));
  return { head, C: new Int16Array(buf, 8 + n, N2), T: new Int16Array(buf, 8 + n + 2 * N2, N2),
           A: new Int16Array(buf, 8 + n + 4 * N2, N2) };
}

/**
 * A tile's cells as levels at the floor `floorDm` (decimeters of water) - before LV_NEAR, which needs the neighbors.
 * `A`/`airDm` (2026-10-12): a cell something overhead crosses lower than `airDm` (her air draft plus her overhead
 * clearance, decimeters - chart.js airNeedM) is BLOCKED, as keepouts.js holds such a span; airDm 0 judges nothing
 * overhead, the hull that declares no air draft.
 */
export function tileLevels(C, T, floorDm, A = null, airDm = 0) {
  const out = new Uint8Array(C.length);
  const air = A && airDm > 0;
  for (let j = 0; j < C.length; j++) {
    const c = C[j];
    out[j] = c === GRID_UNREAD ? LV_UNREAD : c < floorDm || (air && A[j] < airDm) ? LV_BLOCKED
           : T[j] < floorDm ? LV_PARTLY : LV_CLEAR;
  }
  return out;
}

const tileKey = (tx, ty) => tx * 4096 + ty;
/** The global cell a point is in: whole cells counted from (-180, -90). */
export function cellOf(ll) {
  return { gx: Math.floor((ll.lon + 180) / CELL_DEG), gy: Math.floor((ll.lat + 90) / CELL_DEG) };
}
/** A cell's center. */
export function cellLL(gx, gy) {
  return { lat: (gy + 0.5) * CELL_DEG - 90, lon: (gx + 0.5) * CELL_DEG - 180 };
}

/**
 * THE FIELD: the passage's tiles, each a level per cell, LV_NEAR marked across tile edges. `grids` [{head, C, T}].
 * A cell of no tile here is unread. `opts.openWater` (default on): each tile's open-water cost too (openWaterCosts).
 */
export function buildField(grids, floorDm, airDm = 0, opts = {}) {
  const tiles = new Map(), list = [];
  for (const g of grids) {
    const [W, S] = g.head.tile;
    const tx = Math.round((W + 180) / TILE_DEG), ty = Math.round((S + 90) / TILE_DEG);
    const t = { i: list.length, tx, ty, lv: tileLevels(g.C, g.T, floorDm, g.A, airDm), cosLat: Math.cos((S + TILE_DEG / 2) * Math.PI / 180) };
    tiles.set(tileKey(tx, ty), t);
    list.push(t);
  }
  const field = { tiles, list };
  const raw = (gx, gy) => {
    const t = tiles.get(tileKey(Math.floor(gx / GRID_N), Math.floor(gy / GRID_N)));
    return t ? t.lv[(gy - t.ty * GRID_N) * GRID_N + (gx - t.tx * GRID_N)] : LV_UNREAD;
  };
  for (const t of list) {
    const near = new Uint8Array(GRID_N * GRID_N);
    for (let r = 0; r < GRID_N; r++) {
      for (let c = 0; c < GRID_N; c++) {
        const j = r * GRID_N + c;
        if (t.lv[j] !== LV_CLEAR) continue;
        const gx = t.tx * GRID_N + c, gy = t.ty * GRID_N + r;
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const inT = c + dx >= 0 && c + dx < GRID_N && r + dy >= 0 && r + dy < GRID_N;
            const v = inT ? t.lv[j + dy * GRID_N + dx] : raw(gx + dx, gy + dy);
            if (v >= LV_PARTLY) { hit = true; break; }
          }
        if (hit) near[j] = 1;
      }
    }
    for (let j = 0; j < near.length; j++) if (near[j]) t.lv[j] = LV_NEAR;
  }
  field.level = raw;
  field.openWater = opts.openWater !== false;
  if (field.openWater) openWaterCosts(field);
  field.near = (gx, gy) => {
    const t = tiles.get(tileKey(Math.floor(gx / GRID_N), Math.floor(gy / GRID_N)));
    return t && t.nr ? OPEN_WATER.WEIGHT * t.nr[(gy - t.ty * GRID_N) * GRID_N + (gx - t.tx * GRID_N)] / 255 : 0;
  };
  return field;
}

/**
 * OPEN WATER FIRST, COARSE: each tile's `nr` - nearCost of every cell's clearance from the nearest cell a danger
 * touches or blocks (PARTLY, BLOCKED; unread water is no danger, it is only never entered), x 255 as a byte - or null
 * where no danger is within CLEAR_M of the tile. The clearance is a chamfer distance in meters over the tile and a halo
 * of its neighbors' cells CLEAR_M wide, center to center, at the tile's own latitude.
 */
function openWaterCosts(field) {
  const O = OPEN_WATER, ky = CELL_DEG * M_PER_DEG;
  for (const t of field.list) {
    t.nr = null;
    const kx = ky * Math.max(0.05, t.cosLat), kd = Math.hypot(kx, ky);
    const hx = Math.min(GRID_N, Math.ceil(O.CLEAR_M / kx) + 1), hy = Math.ceil(O.CLEAR_M / ky) + 1;
    const W = GRID_N + 2 * hx, H = GRID_N + 2 * hy, d = new Float32Array(W * H);
    const gx0 = t.tx * GRID_N - hx, gy0 = t.ty * GRID_N - hy;
    let any = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = x - hx, r = y - hy;
        const lv = c >= 0 && c < GRID_N && r >= 0 && r < GRID_N ? t.lv[r * GRID_N + c] : field.level(gx0 + x, gy0 + y);
        if (lv === LV_PARTLY || lv === LV_BLOCKED) { d[y * W + x] = 0; any = true; } else d[y * W + x] = Infinity;
      }
    }
    if (!any) continue;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let v = d[i];
        if (!v) continue;
        if (x > 0) v = Math.min(v, d[i - 1] + kx);
        if (y > 0) {
          v = Math.min(v, d[i - W] + ky);
          if (x > 0) v = Math.min(v, d[i - W - 1] + kd);
          if (x < W - 1) v = Math.min(v, d[i - W + 1] + kd);
        }
        d[i] = v;
      }
    }
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        let v = d[i];
        if (!v) continue;
        if (x < W - 1) v = Math.min(v, d[i + 1] + kx);
        if (y < H - 1) {
          v = Math.min(v, d[i + W] + ky);
          if (x < W - 1) v = Math.min(v, d[i + W + 1] + kd);
          if (x > 0) v = Math.min(v, d[i + W - 1] + kd);
        }
        d[i] = v;
      }
    }
    const nr = new Uint8Array(GRID_N * GRID_N);
    let some = false;
    for (let r = 0; r < GRID_N; r++) {
      for (let c = 0; c < GRID_N; c++) {
        const v = Math.round(255 * nearCost(d[(r + hy) * W + c + hx], O));
        if (v) { nr[r * GRID_N + c] = v; some = true; }
      }
    }
    if (some) t.nr = nr;
  }
}

/** Meters between two cells' centers, flat at their mean latitude. */
function cellDistM(ax, ay, bx, by) {
  const lat = ((ay + by) / 2 + 0.5) * CELL_DEG - 90;
  const k = CELL_DEG * M_PER_DEG;
  return Math.hypot((bx - ax) * k * Math.cos(lat * Math.PI / 180), (by - ay) * k);
}

/** Is cell (gx, gy) within PORT_R_M of any of `ports` [{gx, gy}]? */
function inPort(ports, gx, gy) {
  for (const p of ports) if (cellDistM(gx, gy, p.gx, p.gy) <= PORT_R_M) return true;
  return false;
}

/** The cost per meter of entering a cell, or Infinity: `ports` the circles a blocked cell may be crossed in - and where
 *  the open-water cost is not added (buildField). */
function cellCost(field, ports, gx, gy) {
  const lv = field.level(gx, gy);
  if (lv === LV_BLOCKED) return ports.length && inPort(ports, gx, gy) ? PORT_BLOCKED_COST : Infinity;
  if (lv === LV_UNREAD) return Infinity;
  const nr = field.near ? field.near(gx, gy) : 0;
  return COST[lv] + (nr && !(ports.length && inPort(ports, gx, gy)) ? nr : 0);
}

// A binary heap of (f, id).
function makeHeap() {
  let f = new Float64Array(1024), id = new Float64Array(1024), n = 0;
  return {
    get size() { return n; },
    push(fv, iv) {
      if (n === f.length) { const f2 = new Float64Array(n * 2), i2 = new Float64Array(n * 2); f2.set(f); i2.set(id); f = f2; id = i2; }
      let k = n++;
      while (k > 0) { const p = (k - 1) >> 1; if (f[p] <= fv) break; f[k] = f[p]; id[k] = id[p]; k = p; }
      f[k] = fv; id[k] = iv;
    },
    pop() {
      const top = id[0], lf = f[--n], li = id[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && f[c + 1] < f[c]) c++;
        if (f[c] >= lf) break;
        f[k] = f[c]; id[k] = id[c]; k = c;
      }
      f[k] = lf; id[k] = li;
      return top;
    },
  };
}

/**
 * ONE LEG'S SEARCH: the cheapest 8-neighbor path of cells from `a` to `b` ({gx, gy}), or {error}. `ports` the circles
 * a blocked cell may be crossed in (this leg's own ends, when they are ports). The two end cells are always entered.
 */
export function searchLeg(field, a, b, ports, popCap = SEARCH_POP_CAP) {
  const N2 = GRID_N * GRID_N, store = new Map();
  const tileOf = (gx, gy) => field.tiles.get(tileKey(Math.floor(gx / GRID_N), Math.floor(gy / GRID_N)));
  const slot = (t) => {
    let s = store.get(t.i);
    if (!s) { s = { g: new Float32Array(N2).fill(Infinity), from: new Int32Array(N2).fill(-1), done: new Uint8Array(N2) }; store.set(t.i, s); }
    return s;
  };
  const ta = tileOf(a.gx, a.gy), tb = tileOf(b.gx, b.gy);
  if (!ta || !tb) return { error: "unread", at: !ta ? a : b };
  // a cell's number: its tile's index in the field, then its place in the tile (fits 32 bits up to 32,768 tiles)
  const idOf = (t, gx, gy) => t.i * N2 + (gy - t.ty * GRID_N) * GRID_N + (gx - t.tx * GRID_N);
  const xyOf = (id) => {
    const t = field.list[Math.floor(id / N2)], j = id % N2;
    return { gx: t.tx * GRID_N + (j % GRID_N), gy: t.ty * GRID_N + Math.floor(j / GRID_N), t, j };
  };
  const H = makeHeap();
  slot(ta).g[idOf(ta, a.gx, a.gy) % N2] = 0;
  H.push(cellDistM(a.gx, a.gy, b.gx, b.gy), idOf(ta, a.gx, a.gy));
  const goal = idOf(tb, b.gx, b.gy);
  let pops = 0;
  const open = (gx, gy) => (gx === b.gx && gy === b.gy) || cellCost(field, ports, gx, gy) < Infinity;
  while (H.size) {
    const id = H.pop();
    if (++pops > popCap) return { error: "too_long", pops };
    const { gx, gy, t, j } = xyOf(id), s = slot(t);
    if (s.done[j]) continue;
    s.done[j] = 1;
    if (id === goal) {
      const cells = [];
      for (let cur = id; cur >= 0;) {
        const p = xyOf(cur);
        cells.push({ gx: p.gx, gy: p.gy });
        cur = slot(p.t).from[p.j];
      }
      return { cells: cells.reverse(), cost: s.g[j], pops };
    }
    const g0 = s.g[j], here = (gx === a.gx && gy === a.gy) ? 1 : cellCost(field, ports, gx, gy);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = gx + dx, ny = gy + dy;
        const tn = tileOf(nx, ny);
        if (!tn) continue;
        if (!open(nx, ny)) continue;
        if (dx && dy && (!open(gx + dx, gy) || !open(gx, gy + dy))) continue;   // no corner cut
        const there = (nx === b.gx && ny === b.gy) ? Math.min(1, cellCost(field, ports, nx, ny)) : cellCost(field, ports, nx, ny);
        const gn = g0 + cellDistM(gx, gy, nx, ny) * (here + there) / 2;
        const nid = idOf(tn, nx, ny), sn = slot(tn), jn = nid % N2;
        if (sn.done[jn] || gn >= sn.g[jn]) continue;
        sn.g[jn] = gn; sn.from[jn] = id;
        H.push(gn + 1.2 * cellDistM(nx, ny, b.gx, b.gy), nid);
      }
    }
  }
  return { error: "blocked", pops };
}

/** The cells a straight segment between two cells' centers passes through (sampled at a quarter cell). */
export function lineCells(a, b) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.gx - a.gx), Math.abs(b.gy - a.gy)) * 4));
  const out = [];
  let lx = null, ly = null;
  for (let k = 0; k <= n; k++) {
    const x = Math.floor(a.gx + 0.5 + (b.gx - a.gx) * k / n), y = Math.floor(a.gy + 0.5 + (b.gy - a.gy) * k / n);
    if (x !== lx || y !== ly) { out.push({ gx: x, gy: y }); lx = x; ly = y; }
  }
  return out;
}

/** The level a cell counts as on the route: a blocked cell inside a port's circle counts as partly (it was crossed). */
function routeLevel(field, ports, gx, gy) {
  const lv = field.level(gx, gy);
  return lv === LV_BLOCKED && ports.length && inPort(ports, gx, gy) ? LV_PARTLY : lv;
}

/**
 * PULLED TAUT: the search's cells to the fewest straight segments, each over cells no worse than the stretch of the
 * path it replaces (the worst level along that stretch), the ends' own cells excepted - and, on an open-water field
 * (buildField), costing no more than that stretch did, its cost per meter integrated along the segment against the
 * path's own as the search priced it: a shortcut nearer the coast than the path ran is taken only where the meters it
 * saves pay for it, so the berth the search kept is not cut back. Returns the kept cells.
 */
export function pullTaut(field, cells, ports) {
  if (cells.length <= 2) return cells.slice();
  const lv = cells.map((c) => routeLevel(field, ports, c.gx, c.gy));
  // the cost rule: the leg's own end cells cost a meter, as the search's do
  const last = cells.length - 1;
  const costOf = (gx, gy) => ((gx === cells[0].gx && gy === cells[0].gy) || (gx === cells[last].gx && gy === cells[last].gy)
    ? 1 : cellCost(field, ports, gx, gy));
  const cum = new Float64Array(cells.length);
  if (field.openWater) {
    let pc = costOf(cells[0].gx, cells[0].gy);
    for (let k = 1; k < cells.length; k++) {
      const c = costOf(cells[k].gx, cells[k].gy);
      cum[k] = cum[k - 1] + cellDistM(cells[k - 1].gx, cells[k - 1].gy, cells[k].gx, cells[k].gy) * (pc + c) / 2;
      pc = c;
    }
  }
  const lineCost = (a, b) => {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.gx - a.gx), Math.abs(b.gy - a.gy)) * 4));
    let s = 0;
    for (let q = 0; q < n; q++) {
      const f = (q + 0.5) / n;
      s += costOf(Math.floor(a.gx + 0.5 + (b.gx - a.gx) * f), Math.floor(a.gy + 0.5 + (b.gy - a.gy) * f));
    }
    return s * cellDistM(a.gx, a.gy, b.gx, b.gy) / n;
  };
  // the stretch a shortcut replaces is the cells BETWEEN its two ends: an end that is itself partly (a corner of the
  // path beside a danger) is no licence for the shortcut to run on along other such cells (tests/passage_plan.js 9)
  const worstBetween = (i, j) => { let w = 0; for (let k = i + 1; k < j; k++) if (lv[k] > w) w = lv[k]; return w; };
  const clearSeg = (i, j) => {
    const allow = worstBetween(i, j);
    for (const c of lineCells(cells[i], cells[j])) {
      if ((c.gx === cells[i].gx && c.gy === cells[i].gy) || (c.gx === cells[j].gx && c.gy === cells[j].gy)) continue;
      const v = routeLevel(field, ports, c.gx, c.gy);
      if (v > allow || v >= LV_BLOCKED) return false;
    }
    return !field.openWater || lineCost(cells[i], cells[j]) <= cum[j] - cum[i] + 1e-6;
  };
  const out = [cells[0]];
  let i = 0;
  while (i < cells.length - 1) {
    // the furthest j it can see: double the reach while it sees, then halve back to the last it saw
    let lo = i + 1, step = 1;
    while (lo + step < cells.length && clearSeg(i, lo + step)) { lo += step; step *= 2; }
    let hi = Math.min(cells.length - 1, lo + step);
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (clearSeg(i, mid)) lo = mid; else hi = mid; }
    if (hi !== lo && clearSeg(i, hi)) lo = hi;
    out.push(cells[lo]);
    i = lo;
  }
  return out;
}

/**
 * The stretches of a route where it passes cells a danger touches (LV_PARTLY), outside the ports' circles - the
 * NARROW water the console's own planner must plan in detail. `pts` [{gx, gy}] the route's vertices. Returns
 * [{fromM, toM, lenM, at: {lat, lon}}], along the route, merged within NARROW_MERGE_M.
 */
export function narrowStretches(field, pts, ports) {
  const runs = [];
  let along = 0, cur = null;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], L = cellDistM(a.gx, a.gy, b.gx, b.gy);
    const cs = lineCells(a, b);
    cs.forEach((c, q) => {
      const m = along + L * (cs.length > 1 ? q / (cs.length - 1) : 0);
      const narrow = field.level(c.gx, c.gy) >= LV_PARTLY && !inPort(ports, c.gx, c.gy);
      if (narrow) {
        if (cur && m - cur.toM <= NARROW_MERGE_M) cur.toM = m;
        else { cur = { fromM: m, toM: m }; runs.push(cur); }
      }
    });
    along += L;
  }
  return runs.map((r) => {
    const mid = (r.fromM + r.toM) / 2;
    return { fromM: r.fromM, toM: r.toM, lenM: r.toM - r.fromM, at: pointAlong(pts, mid) };
  });
}

/** The point `m` meters along a route of cells [{gx, gy}], as {lat, lon}. */
export function pointAlong(pts, m) {
  let along = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], L = cellDistM(a.gx, a.gy, b.gx, b.gy);
    if (along + L >= m && L > 0) {
      const t = (m - along) / L, A = cellLL(a.gx, a.gy), B = cellLL(b.gx, b.gy);
      return { lat: A.lat + (B.lat - A.lat) * t, lon: A.lon + (B.lon - A.lon) * t };
    }
    along += L;
  }
  const z = pts[pts.length - 1];
  return cellLL(z.gx, z.gy);
}

/** A route's length in meters. */
export function routeLengthM(pts) {
  let m = 0;
  for (let k = 1; k < pts.length; k++) m += cellDistM(pts[k - 1].gx, pts[k - 1].gy, pts[k].gx, pts[k].gy);
  return m;
}

/**
 * THE PASSAGE: `points` [{lat, lon, port}] - her start, the drawn points, the arrival; `port` true for her start, the
 * fuel stops and the arrival - planned leg by leg over `grids` (decoded) at the floor `floorDm`. Returns
 *
 *   {legs: [{i, from, to, pts: [{lat, lon}], lengthM, narrow: [...], error?, at?}], lengthM, ports: [{lat, lon}]}
 *
 * A leg that cannot be planned carries `error` ("unread": an end off the chart read; "blocked": no water way within
 * the tiles read; "too_long") and `at`, the point it is about; the rest are still planned.
 */
export function planPassage({ grids, floorDm, airDm = 0, points, sectionM = SECTION_M, openWater = true }) {
  const field = buildField(grids.map((g) => (g.head ? g : decodeGrid(g))), floorDm, airDm, { openWater });
  const cells = points.map((p) => ({ ...cellOf(p), port: !!p.port, lat: p.lat, lon: p.lon }));
  const legs = [];
  let total = 0;
  for (let i = 0; i + 1 < cells.length; i++) {
    const a = cells[i], b = cells[i + 1];
    const ports = [a, b].filter((c) => c.port);
    const r = searchLeg(field, a, b, ports);
    if (r.error) {
      legs.push({ i, from: points[i], to: points[i + 1], pts: [], lengthM: 0, narrow: [], error: r.error,
                  at: r.at ? cellLL(r.at.gx, r.at.gy) : points[i] });
      continue;
    }
    const taut = pullTaut(field, r.cells, ports);
    const lengthM = routeLengthM(taut);
    total += lengthM;
    legs.push({ i, from: points[i], to: points[i + 1], lengthM, pops: r.pops,
                pts: taut.map((c, k) => (k === 0 ? { lat: a.lat, lon: a.lon } : k === taut.length - 1 ? { lat: b.lat, lon: b.lon } : cellLL(c.gx, c.gy))),
                narrow: narrowStretches(field, taut, ports) });
  }
  const out = { legs, lengthM: total, ports: points.filter((p) => p.port).map((p) => ({ lat: p.lat, lon: p.lon })),
                openWater: field.openWater };
  if (!legs.some((g) => g.error)) out.sections = cutSections(field, legs, points, sectionM);
  return out;
}

// ── THE SECTIONS SHE SAILS IN (2026-10-12, step 5 of the long-transit plan) ──────────────────────────────────────
// The passage is sailed a SECTION at a time: each planned in detail by the console's own planner as she comes to it,
// against the guard's own chart, and sent ahead of her (asv.html "THE PASSAGE, SAILED"). A section ends at every PORT
// (a fuel stop, the arrival: there she waits for Continue) and otherwise about every SECTION_M - at a point she can be
// left HOLDING at safely, because that is where she waits if the next section is not sent in time (Andy, 2026-10-12:
// "she should hold"): every cell within HOLD_SAFE_M clear water, outside every port's circle. A stretch with no such
// point makes a longer section; nothing makes one shorter than SECTION_MIN_FRAC of SECTION_M before a port.

/** A section's length, about. */
export const SECTION_M = 20000;
/** Water clear all round a section's end, at least this far. */
export const HOLD_SAFE_M = 250;
/** How far from the target length an end is looked for, as a fraction of SECTION_M. */
export const SECTION_SLACK = 0.4;
/** No section shorter than this fraction of SECTION_M is cut before a port: the remainder joins the last one. */
export const SECTION_MIN_FRAC = 0.25;
/** The step at which ends are looked for along the route. */
const SECTION_STEP_M = 100;

/** Is the water round a point clear for a hold: every cell within HOLD_SAFE_M clear, and no port's circle round it? */
export function holdSafe(field, ll, ports) {
  const c = cellOf(ll);
  const k = CELL_DEG * M_PER_DEG, dy = Math.ceil(HOLD_SAFE_M / k);
  const dx = Math.ceil(HOLD_SAFE_M / (k * Math.max(0.05, Math.cos(ll.lat * Math.PI / 180))));
  for (let y = -dy; y <= dy; y++)
    for (let x = -dx; x <= dx; x++)
      if (field.level(c.gx + x, c.gy + y) !== LV_CLEAR) return false;
  for (const p of ports) if (cellDistM(c.gx, c.gy, p.gx, p.gy) <= PORT_R_M) return false;
  return true;
}

/**
 * THE SECTIONS: the planned legs, joined, cut at every port and about every `sectionM` at a hold-safe point. Returns
 * [{from, to, via: [the route's turning points between], end: "port" | "hold", port: the point's index or null,
 * lengthM}], or null when the route cannot be cut (no legs).
 */
export function cutSections(field, legs, points, sectionM = SECTION_M) {
  if (!legs.length) return null;
  // the whole route, with the along-distance of every vertex and where each drawn point falls
  const verts = [{ ll: legs[0].pts[0], m: 0, pi: 0 }];
  let m = 0;
  legs.forEach((g, i) => {
    for (let k = 1; k < g.pts.length; k++) {
      m += flatM(g.pts[k - 1], g.pts[k]);
      verts.push({ ll: g.pts[k], m, pi: k === g.pts.length - 1 ? i + 1 : null });
    }
  });
  const total = m;
  const ports = points.map((p, i) => ({ ...cellOf(p), i, port: !!p.port })).filter((p) => p.port);
  const at = (mm) => {                          // the point mm along, and the vertex index it falls after
    for (let k = 1; k < verts.length; k++) {
      if (verts[k].m >= mm) {
        const a = verts[k - 1], b = verts[k], t = b.m > a.m ? (mm - a.m) / (b.m - a.m) : 0;
        return { ll: { lat: a.ll.lat + (b.ll.lat - a.ll.lat) * t, lon: a.ll.lon + (b.ll.lon - a.ll.lon) * t }, k };
      }
    }
    return { ll: verts[verts.length - 1].ll, k: verts.length - 1 };
  };
  // the cuts: each port (after the start), and the hold-safe ends between them
  const cuts = [];
  const portStops = verts.filter((v) => v.pi != null && v.pi > 0 && points[v.pi].port);
  let from = 0;
  for (const ps of portStops) {
    let target = from + sectionM;
    while (target < ps.m - sectionM * SECTION_MIN_FRAC) {
      let best = null;
      const lo = Math.max(from + sectionM * SECTION_MIN_FRAC, target - sectionM * SECTION_SLACK);
      const hi = Math.min(ps.m - sectionM * SECTION_MIN_FRAC, target + sectionM * SECTION_SLACK);
      for (let d = 0; target - d >= lo || target + d <= hi; d += SECTION_STEP_M) {
        for (const mm of [target - d, target + d]) {
          if (mm < lo || mm > hi) continue;
          if (holdSafe(field, at(mm).ll, ports)) { best = mm; break; }
        }
        if (best != null) break;
      }
      if (best == null) { target += sectionM * SECTION_SLACK; continue; }    // none near: a longer section
      cuts.push({ m: best, end: "hold", port: null });
      from = best;
      target = from + sectionM;
    }
    cuts.push({ m: ps.m, end: "port", port: ps.pi });
    from = ps.m;
  }
  // the sections between the cuts
  const out = [];
  let prev = { m: 0, ll: verts[0].ll };
  for (const c of cuts) {
    const end = c.end === "port" ? { ll: points[c.port], k: null } : at(c.m);
    const via = verts.filter((v) => v.m > prev.m + 1 && v.m < c.m - 1).map((v) => ({ lat: v.ll.lat, lon: v.ll.lon }));
    out.push({ from: { lat: prev.ll.lat, lon: prev.ll.lon }, to: { lat: end.ll.lat, lon: end.ll.lon }, via, end: c.end,
               port: c.port, lengthM: c.m - prev.m });
    prev = { m: c.m, ll: end.ll };
  }
  return total > 0 ? out : null;
}

/** Meters between two points, flat at their mean latitude. */
function flatM(a, b) {
  return Math.hypot((b.lat - a.lat) * M_PER_DEG, (b.lon - a.lon) * M_PER_DEG * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180));
}

// ── HOME ALONG THE PASSAGE (2026-10-12, step 6 of the long-transit plan) ─────────────────────────────────────────
// An RTH from a passage's water, with home at one end of it (where it left from, or where it arrives), goes home the
// way the passage runs: over the water its chart was read along and its sections were cut on, a section at a time,
// each planned in detail as she comes to it (asv.html sailSend) - not on the straight line no chart box can hold
// (asv.html RTH_MAX_M). The sections home ARE the passage's, the other way round when home is where it left from, so
// each still ends at water clear all round to hold in, or at a port. She rejoins it at the point nearest her (of those
// within REJOIN_SLACK_M of the nearest, the one nearest home along it); the last section ends at home itself.

/** Home this near an end of the passage is AT that end: the water between is planned in detail, as a port's circle is. */
export const HOME_AT_END_M = PORT_R_M;
/** She rejoins the passage from no farther off it than this: one section's planning from wherever she is. */
export const REJOIN_MAX_M = SECTION_M;
/** A point of the passage this much farther from her than its nearest is not where she rejoins it. */
export const REJOIN_SLACK_M = HOLD_SAFE_M;

/** The point of the segment a-b nearest p, flat at p's latitude. */
function nearestOnSeg(p, a, b) {
  const k = Math.cos(p.lat * Math.PI / 180);
  const ax = (a.lon - p.lon) * k, ay = a.lat - p.lat, bx = (b.lon - p.lon) * k, by = b.lat - p.lat;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

/** The turning points between a line's first and last point, any closer than a meter to the one before dropped. */
function between(line) {
  return line.filter((p, i) => i === 0 || flatM(line[i - 1], p) >= 1).slice(1, -1).map((p) => ({ lat: p.lat, lon: p.lon }));
}

/**
 * THE SECTIONS HOME, from her position `at` along the passage's `sections` to `home`:
 *
 *   {sections: [{from, to, via, end: "hold" | "port" | "home", port, lengthM}], homeEnd: "start" | "end",
 *    rejoin: {sec, at, offM}, lengthM}
 *
 * - or {why: "ends"} when home is at neither end of the passage, {why: "far", offM} when she is farther than
 * REJOIN_MAX_M from it. A passage that comes back where it left from goes home whichever way is shorter from her.
 */
export function homeSections(sections, at, home) {
  if (!sections || !sections.length || !at || !home) return { why: "ends" };
  const ends = [];
  if (flatM(home, sections[0].from) <= HOME_AT_END_M) ends.push("start");
  if (flatM(home, sections[sections.length - 1].to) <= HOME_AT_END_M) ends.push("end");
  if (!ends.length) return { why: "ends" };
  // every stretch of the passage: the point of it nearest her, and how far along the passage that point lies
  const lines = sections.map((c) => [c.from, ...c.via, c.to]);
  const starts = [], cand = [];
  let along = 0;
  lines.forEach((line, j) => {
    starts.push(along);
    for (let s = 1; s < line.length; s++) {
      const a = line[s - 1], b = line[s], q = nearestOnSeg(at, a, b);
      cand.push({ j, s, q, d: flatM(at, q), m: along + flatM(a, q) });
      along += flatM(a, b);
    }
  });
  const total = along;
  starts.push(total);
  const offM = Math.min(...cand.map((c) => c.d));
  if (offM > REJOIN_MAX_M) return { why: "far", offM };
  // where she rejoins it: off it about as little as she can be, and of those the nearest home along it (her way to it
  // and its way home) - so at the end of a section she sails the next one home whole, never back into the one she left
  // nor a few meters to the port she is at. At a section's end the two sections' costs TIE: going home the way it
  // came, the earlier section wins (the first found); going on, the later one (found after it, and taken).
  let best = null;
  for (const e of ends) {
    for (const c of cand) {
      if (c.d > offM + REJOIN_SLACK_M) continue;
      const cost = c.d + (e === "start" ? c.m : total - c.m);
      if (!best || cost < best.cost - 1e-6 || (e === "end" && best.e === "end" && cost <= best.cost + 1e-6)) best = { ...c, e, cost };
    }
  }
  const { j, s, q, e } = best;
  const line = lines[j], out = [];
  if (e === "start") {
    out.push({ from: { lat: at.lat, lon: at.lon }, to: { lat: line[0].lat, lon: line[0].lon },
               via: between([at, q, ...line.slice(1, s).reverse(), line[0]]),
               end: j === 0 ? "home" : sections[j - 1].end, port: j === 0 ? null : sections[j - 1].port,
               lengthM: best.d + best.m - starts[j] });
    for (let i = j - 1; i >= 0; i--) {
      const c = sections[i];
      out.push({ from: { lat: c.to.lat, lon: c.to.lon }, to: { lat: c.from.lat, lon: c.from.lon },
                 via: c.via.slice().reverse().map((p) => ({ lat: p.lat, lon: p.lon })),
                 end: i === 0 ? "home" : sections[i - 1].end, port: i === 0 ? null : sections[i - 1].port, lengthM: c.lengthM });
    }
  } else {
    const z = line[line.length - 1];
    out.push({ from: { lat: at.lat, lon: at.lon }, to: { lat: z.lat, lon: z.lon }, via: between([at, q, ...line.slice(s)]),
               end: sections[j].end, port: sections[j].port, lengthM: best.d + starts[j + 1] - best.m });
    for (let i = j + 1; i < sections.length; i++) {
      const c = sections[i];
      out.push({ from: { lat: c.from.lat, lon: c.from.lon }, to: { lat: c.to.lat, lon: c.to.lon },
                 via: c.via.map((p) => ({ lat: p.lat, lon: p.lon })), end: c.end, port: c.port, lengthM: c.lengthM });
    }
  }
  const last = out[out.length - 1];                // the last ends at home itself, the water between planned in detail
  last.lengthM += flatM(last.to, home);
  last.to = { lat: home.lat, lon: home.lon }; last.end = "home"; last.port = null;
  out.forEach((c) => { c.lengthM = Math.round(c.lengthM); });
  return { sections: out, homeEnd: e, rejoin: { sec: j, at: q, offM: best.d }, lengthM: out.reduce((a, c) => a + c.lengthM, 0) };
}

// ── HOME, COARSE: HER WATER DISTANCE HOME PAST THE CHART BOX (2026-10-12) ────────────────────────────────────────
// Andy: "build the coarse home field". The fuel monitor's water distance home (home_field.js) is a field over the
// chart box round her, ~10 km; past it, with no passage leading home, it was the straight line - short of the way home
// wherever land is in the way, so her RTH point came LATE. This is the same question asked of the tiles' planning grids
// (the passage planner's): a search outward from HOME over every cell of the tiles read, at the coarse planner's own
// costs (searchLeg's - each level's COST per meter, a blocked cell crossed only in home's own port circle at
// PORT_BLOCKED_COST, unread water never entered, no corner cut), with the 16 moves of home_field.js (knight's moves
// too, so a way across open water is within ~3% of straight, where 8 neighbors alone run up to 8% long). Each cell
// keeps the LENGTH, in meters, of the cheapest way home from it - the way the coarse planner would take, measured.

/** The 16 moves: [dx, dy, the cells it passes between or through, as [dx, dy] pairs] (home_field.js HF_MOVES). */
const CH_MOVES = (() => {
  const out = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push([dx, dy, []]);
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) out.push([dx, dy, [[dx, 0], [0, dy]]]);
  for (const [dx, dy] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]])
    out.push([dx, dy, Math.abs(dx) === 2 ? [[dx / 2, 0], [dx / 2, dy]] : [[0, dy / 2], [dx, dy / 2]]]);
  return out;
})();

/**
 * THE COARSE HOME FIELD over `field` (buildField's) from `home` {lat, lon}: {tiles: [{tx, ty, len: Float32Array}],
 * reached} - each cell's length home in meters (Infinity: no way home through the tiles read) - or {error: "unread"}
 * when home's own tile is not among them.
 */
export function coarseHomeField(field, home) {
  const N2 = GRID_N * GRID_N, h = cellOf(home);
  const th = field.tiles.get(tileKey(Math.floor(h.gx / GRID_N), Math.floor(h.gy / GRID_N)));
  if (!th) return { error: "unread" };
  // ONE DENSE PLANE over the tiles' bounding box (a cell of no tile: unread, never entered): the search reads flat
  // arrays, as home_field.js does - per-cell tile lookups held 30 tiles for 14 s
  let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity, ty1 = -Infinity;
  for (const t of field.list) { tx0 = Math.min(tx0, t.tx); ty0 = Math.min(ty0, t.ty); tx1 = Math.max(tx1, t.tx); ty1 = Math.max(ty1, t.ty); }
  const W = (tx1 - tx0 + 1) * GRID_N, H = (ty1 - ty0 + 1) * GRID_N, gx0 = tx0 * GRID_N, gy0 = ty0 * GRID_N;
  const cc = new Float32Array(W * H).fill(Infinity);           // the cost per meter of entering each cell
  for (const t of field.list) {
    const ox = t.tx * GRID_N - gx0, oy = t.ty * GRID_N - gy0;
    for (let r = 0; r < GRID_N; r++) {
      for (let c = 0; c < GRID_N; c++) {
        const j = r * GRID_N + c;
        cc[(oy + r) * W + ox + c] = COST[t.lv[j]] + (t.nr ? OPEN_WATER.WEIGHT * t.nr[j] / 255 : 0);
      }
    }
  }
  // home's port circle: a blocked cell there is crossed at PORT_BLOCKED_COST (searchLeg's cellCost), and no cell carries
  // the open-water cost; home itself, 1
  const hx = h.gx - gx0, hy = h.gy - gy0, ry = Math.ceil(PORT_R_M / (CELL_DEG * M_PER_DEG)) + 1;
  const rx = Math.ceil(ry / Math.max(0.05, Math.cos(home.lat * Math.PI / 180)));
  for (let y = Math.max(0, hy - ry); y <= Math.min(H - 1, hy + ry); y++)
    for (let x = Math.max(0, hx - rx); x <= Math.min(W - 1, hx + rx); x++) {
      const i = y * W + x, gx = x + gx0, gy = y + gy0;
      if (cellDistM(gx, gy, h.gx, h.gy) > PORT_R_M) continue;
      const lv = field.level(gx, gy);
      cc[i] = lv === LV_BLOCKED ? PORT_BLOCKED_COST : COST[lv];
    }
  cc[hy * W + hx] = 1;
  // each row's move lengths in meters (its latitude's), and the moves as flat offsets
  const M = CH_MOVES.length, off = new Int32Array(M), v1 = new Int32Array(M), v2 = new Int32Array(M);
  const mdx = new Int32Array(M), mdy = new Int32Array(M), nv = new Uint8Array(M);
  CH_MOVES.forEach(([dx, dy, via], m) => {
    mdx[m] = dx; mdy[m] = dy; off[m] = dy * W + dx; nv[m] = via.length;
    if (via.length) { v1[m] = via[0][1] * W + via[0][0]; v2[m] = via[1][1] * W + via[1][0]; }
  });
  const ky = CELL_DEG * M_PER_DEG, mlen = new Float64Array(H * M);
  for (let y = 0; y < H; y++) {
    const kx = ky * Math.cos(((y + gy0) + 0.5) * CELL_DEG * Math.PI / 180 - Math.PI / 2);
    for (let m = 0; m < M; m++) mlen[y * M + m] = Math.hypot(mdx[m] * kx, mdy[m] * ky);
  }
  const cost = new Float64Array(W * H).fill(Infinity), len = new Float64Array(W * H).fill(Infinity), done = new Uint8Array(W * H);
  const Hp = makeHeap(), s0 = hy * W + hx;
  cost[s0] = 0; len[s0] = 0; Hp.push(0, s0);
  let reached = 0;
  while (Hp.size) {
    const i = Hp.pop();
    if (done[i]) continue;
    done[i] = 1; reached++;
    const x = i % W, y = (i - x) / W, here = cc[i], c0 = cost[i], l0 = len[i];
    for (let m = 0; m < M; m++) {
      const nx = x + mdx[m], ny = y + mdy[m];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = i + off[m], there = cc[j];
      if (there === Infinity || done[j]) continue;
      if (nv[m] && (cc[i + v1[m]] === Infinity || cc[i + v2[m]] === Infinity)) continue;   // no corner cut
      const d = mlen[y * M + m], cn = c0 + d * (here + there) / 2;
      if (cn >= cost[j]) continue;
      cost[j] = cn; len[j] = l0 + d; Hp.push(cn, j);
    }
  }
  const tiles = field.list.map((t) => {
    const out = new Float32Array(N2), ox = t.tx * GRID_N - gx0, oy = t.ty * GRID_N - gy0;
    for (let r = 0; r < GRID_N; r++) for (let c = 0; c < GRID_N; c++) out[r * GRID_N + c] = len[(oy + r) * W + ox + c];
    return { tx: t.tx, ty: t.ty, len: out };
  });
  return { tiles, reached };
}

/** Her length home from `ll` on a coarse home field `hf` ({tiles: [{tx, ty, len}]}): the length from her cell, and from
 *  her to that cell's center; null where the field has no way home (off its tiles, or no water way from there). */
export function coarseHomeDistM(hf, ll) {
  if (!hf || !hf.tiles || !ll) return null;
  if (!hf.byKey) hf.byKey = new Map(hf.tiles.map((t) => [tileKey(t.tx, t.ty), t]));
  const c = cellOf(ll), t = hf.byKey.get(tileKey(Math.floor(c.gx / GRID_N), Math.floor(c.gy / GRID_N)));
  if (!t) return null;
  const v = t.len[(c.gy - t.ty * GRID_N) * GRID_N + (c.gx - t.tx * GRID_N)];
  return Number.isFinite(v) ? v + flatM(ll, cellLL(c.gx, c.gy)) : null;
}
