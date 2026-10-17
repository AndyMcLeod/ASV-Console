// tests/raster_exact.js - the routing grid, built faster, is the same grid, bit for bit.
//
// Andy, 2026-10-17: "implement 4 and 5" of the performance review. Item 5 was the route search's raster: profiled on the
// real chart, rasterKeepouts was 37% of a 13 km search (the open-water field and the home field build their grids with it
// too), its polygon fill testing EVERY edge of a ring against EVERY row of its box, its dilation scanning each cell's whole window. Both are
// done another way now (static/js/raster.js): each edge to the rows it crosses; the dilation from the nearest filled cell
// before and after along each pass. Neither may change one cell - this grid is what routing.js trusts to over-approximate
// the keep-outs ("a raster-clear shortcut is genuinely clear"), and a cell lost is a leg the search would ship.
//
// So this suite holds the fill and the dilation AS THEY WERE (copied from raster.js at 1be10e0, below) and compares the
// grids cell for cell: over seeded random worlds - concave and self-touching rings, rings with vertices EXACTLY on a row's
// center and level edges at it, rings crossing the window's edges and lying wholly off it, lines, point hazards with and
// without an extent, buffers from under a cell to many cells - and the margin layer (`ko.deep`) with its released
// stretches. stampSeg is unchanged and shared.
//
//   node tests/raster_exact.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH: the reference IS the old code, so a difference is a cell. Five mutants of the new code, five caught (2026-10-17):
// an edge's rows starting one late, the strict row test loosened, the dilation's reach one short along a row and down a
// column, a level edge skipped by a tolerance. A sixth - an edge's rows ENDING one sooner - is the same grid in exact
// arithmetic (the row level with an edge's top is never crossed under the strict test), so it cannot be caught; that
// row of slack is for the rounding of a row's center, and stays.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const path = require("path");
const R = require(path.join(process.env.ASV_JS || path.join(__dirname, "..", "static", "js"), "raster.js"));

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond); note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}

// ── THE REFERENCE: raster.js's dilateGrid and rasterKeepouts as they were at 1be10e0 (stampSeg is shared, unchanged) ──
function refDilateGrid(blk, W, H, rad) {
  if (rad < 1) return;
  const tmp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let dx = -rad; dx <= rad; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < W && blk[row + xx]) { v = 1; break; }
      }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let v = 0;
      for (let dy = -rad; dy <= rad; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < H && tmp[yy * W + x]) { v = 1; break; }
      }
      blk[y * W + x] = v;
    }
  }
}
function refRasterKeepouts(blk, W, H, x0, y0, cell, ko, buffer) {
  const stampSeg = R.stampSeg;
  const X1 = x0 + W * cell, Y1 = y0 + H * cell;
  const gxOf = (e) => (e - x0) / cell;
  const gyOf = (n) => (n - y0) / cell;
  const rad = Math.max(1, Math.ceil(buffer / cell - 1e-9));
  const pad = rad + 1, PM = pad * cell;
  for (const poly of ko.polys) {
    const bb = poly.bb;
    if (bb.x1 < x0 - PM || bb.x0 > X1 + PM || bb.y1 < y0 - PM || bb.y0 > Y1 + PM) continue;
    const rg = poly.ring;
    const gy0 = Math.max(0, Math.floor(gyOf(bb.y0)));
    const gy1 = Math.min(H - 1, Math.ceil(gyOf(bb.y1)));
    for (let gy = gy0; gy <= gy1; gy++) {
      const yc = y0 + (gy + 0.5) * cell;
      const xs = [];
      for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
        const yi = rg[i].n, yj = rg[j].n;
        if ((yi > yc) !== (yj > yc)) xs.push(rg[j].e + (rg[i].e - rg[j].e) * (yc - yj) / (yi - yj));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const gxa = Math.max(0, Math.floor(gxOf(xs[k])));
        const gxb = Math.min(W - 1, Math.ceil(gxOf(xs[k + 1])));
        for (let gx = gxa; gx <= gxb; gx++) blk[gy * W + gx] = 1;
      }
    }
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) stampSeg(blk, W, H, x0, y0, cell, rg[j], rg[i], pad);
  }
  for (const ln of ko.lines) {
    const bb = ln.bb;
    if (bb.x1 < x0 - PM || bb.x0 > X1 + PM || bb.y1 < y0 - PM || bb.y0 > Y1 + PM) continue;
    for (let i = 1; i < ln.pts.length; i++) stampSeg(blk, W, H, x0, y0, cell, ln.pts[i - 1], ln.pts[i], pad);
  }
  for (const pt of ko.points) {
    const gx = Math.round(gxOf(pt.e)), gy = Math.round(gyOf(pt.n));
    const rc = Math.round((pt.r || 0) / cell);
    if (rc <= 0) { stampSeg(blk, W, H, x0, y0, cell, pt, pt, pad); continue; }
    for (let dy = -rc; dy <= rc; dy++) {
      const gyy = gy + dy;
      if (gyy < 0 || gyy >= H) continue;
      const half = Math.floor(Math.sqrt(Math.max(0, rc * rc - dy * dy)));
      const gxa = Math.max(0, gx - half), gxb = Math.min(W - 1, gx + half);
      for (let gxx = gxa; gxx <= gxb; gxx++) blk[gyy * W + gxx] = 1;
    }
  }
  refDilateGrid(blk, W, H, rad);
  if (ko.deep) {
    const d = new Uint8Array(W * H);
    refRasterKeepouts(d, W, H, x0, y0, cell, ko.deep, buffer);
    for (const c of ko.deep.release || []) {
      const r = c.r - 1.5 * cell;
      if (!(r > 0)) continue;
      const gx0 = Math.max(0, Math.floor((c.bb.x0 - r - x0) / cell)), gx1 = Math.min(W - 1, Math.ceil((c.bb.x1 + r - x0) / cell));
      const gy0 = Math.max(0, Math.floor((c.bb.y0 - r - y0) / cell)), gy1 = Math.min(H - 1, Math.ceil((c.bb.y1 + r - y0) / cell));
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = gy * W + gx;
          if (!d[i]) continue;
          const e = x0 + gx * cell, n = y0 + gy * cell;
          for (let k = 1; k < c.pts.length; k++) {
            const a = c.pts[k - 1], b = c.pts[k], dx = b.e - a.e, dy = b.n - a.n, l2 = dx * dx + dy * dy || 1;
            let t = ((e - a.e) * dx + (n - a.n) * dy) / l2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            if (Math.hypot(e - (a.e + t * dx), n - (a.n + t * dy)) < r) { d[i] = 0; break; }
          }
        }
      }
    }
    for (let i = 0; i < W * H; i++) if (d[i]) blk[i] = 1;
  }
}

// ── THE WORLDS ─────────────────────────────────────────────────────────────────────────────────────────────────────
let seed = 20261017;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const bbOf = (pts) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p.e < x0) x0 = p.e; if (p.e > x1) x1 = p.e; if (p.n < y0) y0 = p.n; if (p.n > y1) y1 = p.n; }
  return { x0, y0, x1, y1 }; };
// a ring round (cx, cy): star-shaped or not, some vertices snapped ONTO row centers and some edges made level there
function ringAt(cx, cy, rmax, grid, snap) {
  const n = 3 + Math.floor(rnd() * 40), pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI + (rnd() - 0.5) * 0.3, r = rmax * (0.15 + rnd() * 0.85);
    let e = cx + r * Math.cos(a), nn = cy + r * Math.sin(a);
    if (snap && rnd() < 0.35) nn = grid.y0 + (Math.round((nn - grid.y0) / grid.cell - 0.5) + 0.5) * grid.cell;   // exactly a row center
    if (snap && rnd() < 0.15 && pts.length) nn = pts[pts.length - 1].n;                                          // a level edge
    if (snap && rnd() < 0.1) e = grid.x0 + Math.round((e - grid.x0) / grid.cell) * grid.cell;                     // on a column line
    pts.push({ e, n: nn });
  }
  if (rnd() < 0.2 && n > 6) pts.splice(Math.floor(n / 2), 0, { ...pts[0] });                                    // self-touching
  return pts;
}
function world(grid, opts = {}) {
  const span = Math.max(grid.W, grid.H) * grid.cell, ko = { polys: [], lines: [], points: [] };
  const at = () => ({ x: grid.x0 - 0.3 * span + rnd() * 1.6 * span, y: grid.y0 - 0.3 * span + rnd() * 1.6 * span });
  const np = Math.floor(rnd() * 14), nl = Math.floor(rnd() * 8), nq = Math.floor(rnd() * 12);
  for (let i = 0; i < np; i++) { const c = at(), ring = ringAt(c.x, c.y, span * (0.02 + rnd() * 0.5), grid, true); ko.polys.push({ ring, bb: bbOf(ring), kind: "land" }); }
  for (let i = 0; i < nl; i++) { const c = at(), pts = [];
    for (let k = 0, m = 2 + Math.floor(rnd() * 8); k < m; k++) pts.push({ e: c.x + (rnd() - 0.5) * span * 0.6, n: c.y + (rnd() - 0.5) * span * 0.6 });
    ko.lines.push({ pts, bb: bbOf(pts), kind: "line" }); }
  for (let i = 0; i < nq; i++) { const c = at(); ko.points.push({ e: c.x, n: c.y, r: rnd() < 0.4 ? 0 : rnd() * span * 0.08, kind: "rock" }); }
  if (opts.deep) {
    const dk = world(grid, {});
    dk.release = [];
    for (let i = 0, m = 1 + Math.floor(rnd() * 3); i < m; i++) {
      const c = at(), pts = [{ e: c.x, n: c.y }, { e: c.x + (rnd() - 0.5) * span * 0.5, n: c.y + (rnd() - 0.5) * span * 0.5 }];
      dk.release.push({ pts, bb: bbOf(pts), r: grid.cell * (1 + rnd() * 12) });
    }
    ko.deep = dk;
  }
  return ko;
}
function same(grid, ko, buffer) {
  const a = new Uint8Array(grid.W * grid.H), b = new Uint8Array(grid.W * grid.H);
  refRasterKeepouts(a, grid.W, grid.H, grid.x0, grid.y0, grid.cell, ko, buffer);
  R.rasterKeepouts(b, grid.W, grid.H, grid.x0, grid.y0, grid.cell, ko, buffer);
  let diff = 0, set = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) diff++; if (a[i]) set++; }
  return { diff, set, cells: a.length };
}

console.log("The routing grid, built faster, is the same grid:");

// 1. the dilation alone, over random grids and every reach from 1 to 40 cells
{
  let bad = 0, cases = 0, worst = null;
  for (let t = 0; t < 400; t++) {
    const W = 1 + Math.floor(rnd() * 90), H = 1 + Math.floor(rnd() * 90), rad = 1 + Math.floor(rnd() * 40);
    const dens = pick([0, 0.001, 0.01, 0.05, 0.3, 0.9]);
    const a = new Uint8Array(W * H); for (let i = 0; i < a.length; i++) a[i] = rnd() < dens ? 1 : 0;
    const b = a.slice();
    refDilateGrid(a, W, H, rad); R.dilateGrid(b, W, H, rad);
    cases++;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { bad++; worst = worst || { W, H, rad, dens, at: i }; break; }
  }
  const z = new Uint8Array(12); R.dilateGrid(z, 4, 3, 0);
  check("1. THE DILATION from the nearest filled cell is the window scan's, cell for cell: 400 random grids (1-90 cells a "
        + "side, densities from empty to 90% filled, reaches 1-40 cells) and a reach under one left alone",
        () => bad === 0 && cases === 400 && z.every((v) => v === 0), () => bad ? JSON.stringify(worst) : "0 of 400 differ");
}

// 2. the whole grid: random worlds over random grids and buffers
{
  let bad = 0, cases = 0, cells = 0, set = 0, worst = null;
  for (let t = 0; t < 600; t++) {
    const cell = pick([0.5, 1, 1.7, 3, 7.3, 20.4]);
    const grid = { W: 10 + Math.floor(rnd() * 160), H: 10 + Math.floor(rnd() * 160), cell,
                   x0: (rnd() - 0.5) * 5000, y0: (rnd() - 0.5) * 5000 };
    const ko = world(grid), buffer = pick([0.2, cell * 0.5, cell, 3, 5, cell * 3.7, 25]);
    const r = same(grid, ko, buffer);
    cases++; cells += r.cells; set += r.set;
    if (r.diff) { bad++; worst = worst || { t, ...grid, buffer, diff: r.diff }; }
  }
  check("2. THE WHOLE GRID - polygon fill, edges, lines, point hazards, dilation - is the old one's over 600 random worlds "
        + "(concave and self-touching rings, vertices on row centers, level edges, rings across and off the window; cells "
        + "0.5-20.4 m; buffers 0.2-25 m)",
        () => bad === 0 && cases === 600 && set > 0, () => (bad ? "DIFFER: " + JSON.stringify(worst) + "; " : "") + bad + " of " + cases
          + " differ; " + cells + " cells compared, " + set + " blocked");
}

// 3. the margin layer and its released stretches
{
  let bad = 0, worst = null;
  for (let t = 0; t < 150; t++) {
    const cell = pick([1, 3, 7.3]);
    const grid = { W: 20 + Math.floor(rnd() * 120), H: 20 + Math.floor(rnd() * 120), cell, x0: (rnd() - 0.5) * 3000, y0: (rnd() - 0.5) * 3000 };
    const r = same(grid, world(grid, { deep: true }), pick([3, 5, 9]));
    if (r.diff) { bad++; worst = worst || { t, ...grid, diff: r.diff }; }
  }
  check("3. ... and with the margin layer armed (ko.deep, deep water first) and its released stretches cleared: 150 worlds",
        () => bad === 0, () => bad ? JSON.stringify(worst) : "0 of 150 differ");
}

// 4. the cases the arithmetic turns on, by hand
{
  const grid = { W: 40, H: 30, cell: 2, x0: 100, y0: -50 };
  const yc = (k) => grid.y0 + (k + 0.5) * grid.cell;
  const sq = (x0, y0, x1, y1) => [{ e: x0, n: y0 }, { e: x1, n: y0 }, { e: x1, n: y1 }, { e: x0, n: y1 }];
  const rings = [
    sq(110, yc(3), 140, yc(9)),                        // its top and bottom edges ON row centers (level edges)
    [{ e: 120, n: yc(12) }, { e: 150, n: yc(12) }, { e: 135, n: yc(20) }],   // a level base on a row center
    [{ e: 104, n: -49.999 }, { e: 104.5, n: 9.999 }, { e: 104.6, n: -49.999 }],   // a sliver narrower than a cell
    sq(60, -100, 300, 100),                            // wider than the whole window
    sq(400, 400, 500, 500),                            // wholly off it
    [{ e: 160, n: yc(2) }, { e: 170, n: yc(2) + 1e-12 }, { e: 175, n: yc(25) }, { e: 160, n: yc(25) - 1e-12 }],   // a hair off center
  ];
  let bad = [];
  rings.forEach((ring, i) => { for (const buffer of [0.5, 2, 2.0000001, 7]) {
    const r = same(grid, { polys: [{ ring, bb: bbOf(ring), kind: "x" }], lines: [], points: [] }, buffer);
    if (r.diff) bad.push(i + "@" + buffer + ":" + r.diff); } });
  check("4. BY HAND, where the arithmetic turns: edges level ON a row's center, a sliver narrower than a cell, a ring wider "
        + "than the window, one off it, vertices a hair off a row's center - the same cells at four buffers",
        () => bad.length === 0, () => bad.join(", ") || "all the same");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
