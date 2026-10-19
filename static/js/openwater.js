/**
 * OPEN WATER FIRST (Andy, 2026-10-14). "I am noticing the ASV always tends to thread its way through
 * islands/rocks/shoals to reach its destination on the most efficient way possible. This is technically a good
 * solution, but it enhances danger when the chart may have a positional error or unmarked feature. For open
 * ocean/or large bay, etc paths consider a more direct and less complex path as a default consideration" - and,
 * mid-build, "pay attention to marker buoys that should help safe passage calculations".
 *
 * WHY THE ROUTER THREADS. `legPath` searches a long leg as `routeAroundSeg` does: the straight line cut into 2.2 km
 * pieces, each searched within 900 m of the line, every cell costing its length and nothing else. A route can bend
 * round what lies ON the bee-line and nothing more - the open water beyond an island group is never looked at - and
 * among the ways it does look at, the shortest wins however close it runs to a ledge. His Go-To Castine -> the Fox
 * Islands Thorofare (2026-10-14, 42.1 km) ran 20.7 km of its length within 250 m of a charted hazard, through the
 * island chain and the Thorofare, where the water west of North Haven was open.
 *
 * WHAT THIS DOES. One search over the whole leg on a coarse raster, the A-B box widened by OPEN_WATER.MARGIN_* so the
 * way round an island group is in it, where every meter COSTS MORE THE NEARER IT RUNS TO A CHARTED HAZARD - a
 * clearance-weighted A*. Beyond CLEAR_M it is plain distance, so the route keeps that far off everything where the
 * water allows and does not wander for more. Then a string pull that never brings the route nearer a hazard than the
 * search's own path ran there - long straight legs in open water, the "less complex" path - and each leg made exact by
 * the router's own `legPath` wherever it is not already clear at the buffer.
 *
 * THE BUOYS (his second message). A buoy is the part of the chart that is in the water, and what he trusts when the
 * chart may be wrong - and, his rule (2026-10-12), CHANNEL buoys define a path, OFFSHORE buoys guide away from danger:
 *   - water a MARKED or CHARTED channel covers (`ko.chans`: fairways, dredged areas, and the corridors swept between
 *     paired lateral marks) is a surveyed, maintained passage - its penalty is cut by TRUST, so a buoyed channel is not
 *     priced like an unmarked gap between ledges;
 *   - so is the water a LATERAL mark buoys where the chart draws no channel: within LATERAL_TRUST_R_M of each, and of
 *     the reach between two marks of one system numbered one after the other (`ko.sys`), up to LATERAL_REACH_MAX_M
 *     apart. A row of single red and green marks IS a channel: priced as a hazard, the open water beside it drew the
 *     route out of it, a kilometer off every buoy (tests/enc_channel.js 34, the first cut). The marks stage after the
 *     search keeps each on its proper hand, as it always did;
 *   - a SAFE-WATER buoy (RW, Mo(A)) says the water round it is clear: within SAFE_WATER_R_M it is trusted the same way;
 *   - an ISOLATED-DANGER buoy stands over a danger of unknown extent: kept clear as a hazard in its own right,
 *     ISOLATED_DANGER_R_M out, in the clearance the search prices - never as a keep-out.
 *
 * WHEN IT IS USED. On a passage leg (Go-To, RTH, a transit's legs) of MIN_LEG_M or more. It is taken over the
 * router's own route only where it cuts that route's EXPOSURE - its length weighted by how near it runs, the same
 * price the search pays - by GAIN_MIN or more, at no more than DETOUR_MAX longer; otherwise the router's route stands
 * exactly as before. Everything after the search - deep water first, the Rule 9 lanes, the marks, the smoothing, the
 * gate - runs on whichever it is, unchanged.
 *
 * ENDS FIRST, THEN INWARD (Andy, 2026-10-14: "The open ocean planning does not seem to be applied. The ASV is winding its
 * way among shoals and islands rather than standing offshore for a clean transit"; then "do it in segments starting
 * with beginning and end and then working inward"). The field's cell grows with the leg (MAX_DIM cells along the long
 * side): 152 m on his 120 km Go-To from a Portland wharf, where every cell within 900 m of her was blocked by the
 * harbor's docks and banks - the search could not start, and said "no open-water path" whatever chart was read
 * (replayed on his charts: the same over the box the page read and the wider one it asked for). So the ends are the
 * ROUTER's: its own route, which threads a harbor at full resolution, is kept from each end out to where it first
 * reaches the open water the field can search - the connected water it runs the longest through - and the search runs
 * between those two points. A leg whose ends are both in that water is searched end to end, exactly as before.
 */
import { rasterKeepouts } from './raster.js';
import { legClear } from './keepouts.js';
import { legPath } from './routing.js';
import { pinp } from './geometry.js';

export const OPEN_WATER = {
  MIN_LEG_M: 3000,          // a leg shorter than this is planned as before: there is no island group to go round
  CLEAR_M: 1000,            // the clearance the search wants from every charted hazard; beyond it, plain distance
  WEIGHT: 4,                // what a meter at no clearance costs beyond its length (x (1 - d/CLEAR_M)^2)
  TRUST: 0.75,              // the share of that taken off in water a buoy or the chart vouches for
  MARGIN_FRAC: 0.35,        // how far beside the A-B box the search may look, as a share of the leg
  MARGIN_MIN_M: 2000,
  MARGIN_MAX_M: 15000,
  MAX_DIM: 900,             // raster cells along the region's long side
  MIN_CELL_M: 20,
  BERTHS_FRAC: [1, 0.5, 0.25],   // the berths tried, as shares of CLEAR_M: the widest first
  // SAFETY BEFORE EFFICIENCY (Andy, 2026-10-14: "safety is always better than efficiency for path planning"): the widest
  // berth is taken unless it would be more than DETOUR_MAX longer - an absurd detour, not a long one - and any real cut in
  // exposure is reason enough. (0.30 and 0.25 when first written: a 12 km coastal run 1 km off was refused at 31 %.)
  DETOUR_MAX: 1.0,          // the longest it may be beside the router's own route: twice it
  GAIN_MIN: 0.10,           // and the share of that route's exposure it must take away
  SAFE_WATER_R_M: 400,
  ISOLATED_DANGER_R_M: 150,
  LATERAL_TRUST_R_M: 250,   // the water round a lateral (channel) mark, and either side of a reach between two of them
  LATERAL_REACH_MAX_M: 2500,
  WAY_OUT_R_M: 12000,       // ENDS FIRST: the fine search round an end the leg's field cannot search from, this far each way
  WAY_OUT_MAX_DIM: 900,     // ... in cells along its side (27 m) - its own, whatever the leg's MAX_DIM makes the leg's cells
  MARK_HOLD_M: 1500,        // A BUOY OUTRANKS OPEN WATER (passage.js buoysOutrankOpenWater): the router's own route kept
                            // within this of a mark the open water would leave on its wrong hand
};

const SAFE_WATER = /Safe_Water/;
const ISOLATED_DANGER = /Isolated_Danger/;

/** The penalty factor of clearance `d` (meters): 1 at the buffer, 0 at CLEAR_M and beyond. */
export function nearCost(d, O = OPEN_WATER) { const x = Math.max(0, 1 - d / O.CLEAR_M); return x * x; }

/**
 * The open-water field over a region: the conservative raster of the keep-outs at `buf`, each free cell's clearance
 * to the nearest of them and the soft hazards (meters), and how far a buoy or the chart vouches for it (0..1).
 * {x0, y0, cell, W, H, blk, dist, trust, offChart}.
 *
 * ⚠⚠ ONLY WATER THE CHART WAS READ OVER (`chart`: {F, box, unread, edgeM, from}, passage.js's nogo.bbox, nogo.unread and
 * CHART_EDGE_M). The model holds nothing past the box the chart was read over, or in a square no chart covers - and
 * nothing is exactly what this search prizes most: open water at no cost. Unchecked, it drew the route OUT of the read
 * water on every long leg, to be refused as uncharted and read again round after round. So a cell less than `edgeM`
 * inside the box, or within `edgeM` of an unread square (beyondChart's own rule, the cells within `edgeM` of `from`
 * - her own way out of where she is - aside, since 2026-10-18), is BLOCKED for the search and the pull - but it is no danger: the clearance is measured
 * from the chart's keep-outs alone, so the route is not pushed off the box's edge for being an edge. The page reads
 * the chart over the water this searches before it plans a long leg (asv.html planInsideChart, openWaterBox). With
 * no box - the suites' own worlds - nothing is cut.
 */
export function openWaterField(x0, y0, x1, y1, ko, buf, O = OPEN_WATER, chart = null) {
  const span = Math.max(x1 - x0, y1 - y0);
  const cell = Math.max(O.MIN_CELL_M, buf / 2, span / O.MAX_DIM);
  const W = Math.floor((x1 - x0) / cell) + 1, H = Math.floor((y1 - y0) / cell) + 1, N = W * H;
  const blk = new Uint8Array(N);
  // A BUOY IS NOT WHAT IT MARKS (routing.js's own rule): a floating aid - a channel buoy, any Buoy_ class - is never to be
  // hit, so it is blocked; but it is no hidden danger, so its nearness is not priced - the clearance is measured from the
  // rest. Priced, a buoyed channel's own buoys drew the route out of it into open water beside it (2026-10-14, the first
  // cut: tests/enc_channel.js 60c). An isolated-danger buoy's danger is its soft hazard, below.
  const isBuoy = (q) => q.kind === "a channel buoy" || /^Buoy_/.test(q.cls || "");
  const buoys = (ko.points || []).filter(isBuoy);
  rasterKeepouts(blk, W, H, x0, y0, cell, buoys.length ? { ...ko, points: ko.points.filter((q) => !isBuoy(q)) } : ko, buf);
  // chamfer distance (orthogonal 1, diagonal sqrt 2) from the blocked cells, in cells
  const INF = 1e9, D = new Float32Array(N), R2 = Math.SQRT2;
  for (let i = 0; i < N; i++) D[i] = blk[i] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let v = D[i];
    if (x > 0) v = Math.min(v, D[i - 1] + 1);
    if (y > 0) { v = Math.min(v, D[i - W] + 1); if (x > 0) v = Math.min(v, D[i - W - 1] + R2); if (x < W - 1) v = Math.min(v, D[i - W + 1] + R2); }
    D[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let v = D[i];
    if (x < W - 1) v = Math.min(v, D[i + 1] + 1);
    if (y < H - 1) { v = Math.min(v, D[i + W] + 1); if (x < W - 1) v = Math.min(v, D[i + W + 1] + R2); if (x > 0) v = Math.min(v, D[i + W - 1] + R2); }
    D[i] = v;
  }
  const dist = new Float32Array(N);
  for (let i = 0; i < N; i++) dist[i] = Math.min(D[i] * cell, 1e7);
  if (buoys.length) {                                // ... and the buoys blocked, on a grid of their own (one dilation each)
    const bb = new Uint8Array(N);
    rasterKeepouts(bb, W, H, x0, y0, cell, { polys: [], lines: [], points: buoys }, buf);
    for (let i = 0; i < N; i++) if (bb[i] && !blk[i]) blk[i] = 1;
  }
  // THE BUOYS. The soft hazards first: an isolated-danger buoy.
  const soft = [];
  for (const q of ko.points || []) if (ISOLATED_DANGER.test(q.cls || "")) soft.push({ e: q.e, n: q.n, r: O.ISOLATED_DANGER_R_M + (q.r || 0) });
  const reach = O.CLEAR_M;
  for (const s of soft) {
    const gx0 = Math.max(0, Math.floor((s.e - s.r - reach - x0) / cell)), gx1 = Math.min(W - 1, Math.ceil((s.e + s.r + reach - x0) / cell));
    const gy0 = Math.max(0, Math.floor((s.n - s.r - reach - y0) / cell)), gy1 = Math.min(H - 1, Math.ceil((s.n + s.r + reach - y0) / cell));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const i = gy * W + gx;
      const d = Math.max(0, Math.hypot(x0 + gx * cell - s.e, y0 + gy * cell - s.n) - s.r);
      if (d < dist[i]) dist[i] = d;
    }
  }
  // Trust: the marked and charted channels, and the water round a safe-water buoy.
  const trust = new Float32Array(N);
  for (const c of ko.chans || []) {
    const gx0 = Math.max(0, Math.floor((c.bb.x0 - x0) / cell)), gx1 = Math.min(W - 1, Math.ceil((c.bb.x1 - x0) / cell));
    const gy0 = Math.max(0, Math.floor((c.bb.y0 - y0) / cell)), gy1 = Math.min(H - 1, Math.ceil((c.bb.y1 - y0) / cell));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const i = gy * W + gx;
      if (!trust[i] && pinp({ e: x0 + gx * cell, n: y0 + gy * cell }, c.ring)) trust[i] = 1;
    }
  }
  // within r of the segment a-b (a point: a === b)
  const trustNear = (a, b, r) => {
    const gx0 = Math.max(0, Math.floor((Math.min(a.e, b.e) - r - x0) / cell)), gx1 = Math.min(W - 1, Math.ceil((Math.max(a.e, b.e) + r - x0) / cell));
    const gy0 = Math.max(0, Math.floor((Math.min(a.n, b.n) - r - y0) / cell)), gy1 = Math.min(H - 1, Math.ceil((Math.max(a.n, b.n) + r - y0) / cell));
    const dx = b.e - a.e, dy = b.n - a.n, l2 = dx * dx + dy * dy;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const pe = x0 + gx * cell, pn = y0 + gy * cell;
      const t = l2 ? Math.max(0, Math.min(1, ((pe - a.e) * dx + (pn - a.n) * dy) / l2)) : 0;
      if (Math.hypot(pe - a.e - t * dx, pn - a.n - t * dy) <= r) trust[gy * W + gx] = 1;
    }
  };
  for (const q of ko.points || []) if (SAFE_WATER.test(q.cls || "")) trustNear(q, q, O.SAFE_WATER_R_M);
  for (const m of ko.marks || []) trustNear(m, m, O.LATERAL_TRUST_R_M);
  for (const sy of ko.sys || []) {
    const ms = [...(sy.port || []), ...(sy.stbd || [])].filter((m) => m.num != null).sort((a, b) => a.num - b.num);
    for (let k = 1; k < ms.length; k++) {
      const a = ms[k - 1], b = ms[k];
      if (Math.hypot(b.e - a.e, b.n - a.n) <= O.LATERAL_REACH_MAX_M) trustNear(a, b, O.LATERAL_TRUST_R_M);
    }
  }
  let offChart = 0;
  if (chart && chart.F && (chart.box || (chart.unread && chart.unread.length))) {
    const { F, box, edgeM = 100 } = chart;
    const M = 111320, inside = (q) => {
      const k = M * Math.cos(q.lat * Math.PI / 180);
      return Math.min((q.lat - box.S) * M, (box.N - q.lat) * M, (q.lon - box.W) * k, (box.E - q.lon) * k);
    };
    const near = (q, r) => {
      const k = M * Math.cos(q.lat * Math.PI / 180);
      return Math.max((r.S - q.lat) * M, (q.lat - r.N) * M, (r.W - q.lon) * k, (q.lon - r.E) * k);   // <= 0 inside
    };
    // ONLY HER OWN FIRST edgeM IS LET BE, NOT THE SQUARE SHE IS IN (2026-10-18, A2 - passage.js unreadAlong's note): the
    // square round the Canaveral lock was a whole chart tile, and letting it be let a route run 6.6 km through it.
    const from = chart.from || null;
    const unread = chart.unread || [];
    const herWayOut = (q) => {
      if (!from) return false;
      const k = M * Math.cos(from.lat * Math.PI / 180);
      return Math.hypot((q.lat - from.lat) * M, (q.lon - from.lon) * k) <= edgeM;
    };
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const i = gy * W + gx;
        if (blk[i]) continue;
        const q = F.fromEN(x0 + gx * cell, y0 + gy * cell);
        if ((box && inside(q) < edgeM) || (!herWayOut(q) && unread.some((r) => near(q, r) < edgeM))) { blk[i] = 2; offChart++; }
      }
    }
  }
  return { x0, y0, cell, W, H, blk, dist, trust, offChart };
}

/** The water an open-water search between consecutive `pts` (LL) would look over, as {W, S, E, N} - each leg of
 *  MIN_LEG_M or more, its two ends' box widened by the search's own margin, joined - or null when no leg is that long.
 *  What the page reads the chart over before it plans (asv.html planInsideChart). */
export function openWaterBox(pts, O = OPEN_WATER) {
  let out = null;
  const M = 111320;
  for (let i = 1; i < (pts || []).length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (!a || !b) continue;
    const k = M * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
    const d = Math.hypot((b.lat - a.lat) * M, (b.lon - a.lon) * k);
    if (!(d >= O.MIN_LEG_M)) continue;
    const m = Math.min(O.MARGIN_MAX_M, Math.max(O.MARGIN_MIN_M, O.MARGIN_FRAC * d));
    const bx = { W: Math.min(a.lon, b.lon) - m / k, S: Math.min(a.lat, b.lat) - m / M, E: Math.max(a.lon, b.lon) + m / k, N: Math.max(a.lat, b.lat) + m / M };
    out = out ? { W: Math.min(out.W, bx.W), S: Math.min(out.S, bx.S), E: Math.max(out.E, bx.E), N: Math.max(out.N, bx.N) } : bx;
  }
  return out;
}

/** A route's EXPOSURE on a field: its length weighted by the penalty the search pays, sampled every cell. */
export function exposureOn(fld, en, O = OPEN_WATER) {
  let E = 0;
  for (let i = 1; i < en.length; i++) {
    const a = en[i - 1], b = en[i], L = Math.hypot(b.e - a.e, b.n - a.n), n = Math.max(1, Math.ceil(L / fld.cell));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, gx = Math.round((a.e + (b.e - a.e) * t - fld.x0) / fld.cell), gy = Math.round((a.n + (b.n - a.n) * t - fld.y0) / fld.cell);
      if (gx < 0 || gy < 0 || gx >= fld.W || gy >= fld.H) continue;
      const i2 = gy * fld.W + gx;
      E += (L / n) * O.WEIGHT * (1 - O.TRUST * fld.trust[i2]) * nearCost(fld.dist[i2], O);
    }
  }
  return E;
}

/** The free cell nearest EN (e, n), within the larger of 6 cells and 400 m - where a search may start - or -1. */
function freeNear(fld, e, n) {
  const { x0, y0, cell, W, H, blk } = fld;
  const gx = Math.round((e - x0) / cell), gy = Math.round((n - y0) / cell);
  const R = Math.max(6, Math.ceil(400 / cell));
  for (let r = 0; r <= R; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = gx + dx, y = gy + dy;
    if (x >= 0 && y >= 0 && x < W && y < H && !blk[y * W + x]) return y * W + x;
  }
  return -1;
}

/** The field's free cells labelled by the connected water they lie in (1, 2, ...; 0 blocked), moving as the search
 *  moves - eight ways, never cutting a blocked corner - so two cells share a label exactly when a search joins them. */
function waterLabels(fld) {
  const { W, H, blk } = fld, N = W * H, lab = new Int32Array(N), q = new Int32Array(N);
  let next = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (blk[s0] || lab[s0]) continue;
    lab[s0] = ++next;
    let qh = 0, qt = 0;
    q[qt++] = s0;
    while (qh < qt) {
      const c = q[qh++], cx = c % W, cy = (c / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (blk[i] || lab[i]) continue;
        if (dx && dy && (blk[cy * W + x] || blk[y * W + cx])) continue;
        lab[i] = next;
        q[qt++] = i;
      }
    }
  }
  return lab;
}

/**
 * ENDS FIRST (the design note above): where along the router's route `en` (EN, A first) the open-water search takes
 * over and hands back. The route sampled every half cell; the connected water it runs the longest through is the
 * search's; the search starts at A when A's own free cell is in it, else at the route's first sample in it, and ends at
 * B likewise, else at its last. {entry, exit} - each {i, t, e, n}: on the route's segment en[i-1] -> en[i] at t (i 0: A
 * itself; i en.length - 1, t 1: B) - or null when the route never reaches searchable water.
 */
function searchEnds(fld, en) {
  const { x0, y0, cell, W, H } = fld, lab = waterLabels(fld);
  const at = (e, n) => { const gx = Math.round((e - x0) / cell), gy = Math.round((n - y0) / cell);
    return gx < 0 || gy < 0 || gx >= W || gy >= H ? 0 : lab[gy * W + gx]; };
  const samples = [], runM = new Map();
  for (let i = 1; i < en.length; i++) {
    const a = en[i - 1], b = en[i], L = Math.hypot(b.e - a.e, b.n - a.n), n = Math.max(1, Math.ceil(L / (cell / 2)));
    for (let k = 0; k <= n; k++) {
      const t = k / n, e = a.e + (b.e - a.e) * t, nn = a.n + (b.n - a.n) * t, l = at(e, nn);
      samples.push({ i, t, e, n: nn, l });
      if (l && k < n) runM.set(l, (runM.get(l) || 0) + L / n);
    }
  }
  let main = 0, best = 0;
  for (const [l, m] of runM) if (m > best) { best = m; main = l; }
  if (!main) return null;
  const endIn = (p) => { const c = freeNear(fld, p.e, p.n); return c >= 0 && lab[c] === main; };
  const A = en[0], B = en[en.length - 1];
  const first = samples.find((q) => q.l === main), last = [...samples].reverse().find((q) => q.l === main);
  const entry = endIn(A) ? { i: 0, t: 0, e: A.e, n: A.n } : first;
  const exit = endIn(B) ? { i: en.length - 1, t: 1, e: B.e, n: B.n } : last;
  return { entry, exit, lab, main, entryIn: endIn(A), exitIn: endIn(B) };
}

/**
 * THE WAY OUT OF A HARBOR (ends first, in detail). An end the leg's field cannot search from - its cells too coarse for
 * the harbor round it - is searched on a FINE field of its own, WAY_OUT_R_M each way round it (cells of
 * 2 * WAY_OUT_R_M / WAY_OUT_MAX_DIM: 27 m), at the same clearance-weighted price, ALL of it: every cell of the leg's searchable
 * water (`big`'s `lab` === `main`) it reaches is an EXIT, and carries what the harbor cost to get there into the leg's
 * own search (searchField's `seeds`, or `goals` at the far end). So the way out is whichever does the WHOLE leg best -
 * not the nearest open water, nor the router's shortest. The first cut took the nearest by price: on his Portland Go-To
 * that was Hussey Sound, 22 m off a charted shoal 7.2 km out, before the leg's own search had a say; and the router's own
 * route, before that, threaded north-east among the Casco Bay islands for 17.9 km.
 * {seeds: Map(big cell -> {g: the cost there, in the big field's cell units, lc: the fine cell}), pathTo(lc)}; pathTo is
 * the way out to fine cell `lc`, string-pulled on the fine field and made exact leg by leg by the router, as the leg's
 * spine is: {path: LL from the end (excluded) to the join (included), join} - or null where a leg would not route.
 * null when the end has no free cell of its own.
 */
function endField(endLL, F, ko, buf, O, chart, big, lab, main) {
  const e = F.toEN(endLL), R = O.WAY_OUT_R_M;
  const loc = openWaterField(e.e - R, e.n - R, e.e + R, e.n + R, ko, buf, { ...O, MAX_DIM: O.WAY_OUT_MAX_DIM }, chart);
  const { x0, y0, cell, W, H, blk, dist, trust } = loc, N = W * H;
  const s0 = freeNear(loc, e.e, e.n);
  if (s0 < 0) return null;
  const cost = (i) => 1 + O.WEIGHT * (1 - O.TRUST * trust[i]) * nearCost(dist[i], O);
  const gc = new Float64Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const hF = [], hI = [];
  const push = (f, i) => { hF.push(f); hI.push(i); let k = hF.length - 1;
    while (k > 0) { const q = (k - 1) >> 1; if (hF[q] <= hF[k]) break; [hF[q], hF[k]] = [hF[k], hF[q]]; [hI[q], hI[k]] = [hI[k], hI[q]]; k = q; } };
  const pop = () => { const top = hI[0], lf = hF.pop(), li = hI.pop();
    if (hF.length) { hF[0] = lf; hI[0] = li; let k = 0; const n = hF.length;
      for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < n && hF[l] < hF[m]) m = l; if (r < n && hF[r] < hF[m]) m = r; if (m === k) break;
        [hF[m], hF[k]] = [hF[k], hF[m]]; [hI[m], hI[k]] = [hI[k], hI[m]]; k = m; } }
    return top; };
  gc[s0] = 0; push(0, s0);
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  const seeds = new Map(), unit = cell / big.cell;
  while (hF.length) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const gx = Math.round((x0 + (cur % W) * cell - big.x0) / big.cell), gy = Math.round((y0 + ((cur / W) | 0) * cell - big.y0) / big.cell);
    if (gx >= 0 && gy >= 0 && gx < big.W && gy < big.H) {
      const bi = gy * big.W + gx;
      if (lab[bi] === main) {                        // an exit: the leg's own water. Not searched on from - the leg's search is
        const g = gc[cur] * unit, had = seeds.get(bi);
        if (!had || g < had.g) seeds.set(bi, { g, lc: cur });
        continue;
      }
    }
    const cx = cur % W, cy = (cur / W) | 0, cc = cost(cur);
    for (const [dx, dy, w] of NB) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (blk[ni] || closed[ni]) continue;
      if (dx && dy && (blk[cy * W + nx] || blk[ny * W + cx])) continue;
      const cand = gc[cur] + w * (cc + cost(ni)) / 2;
      if (cand < gc[ni]) { gc[ni] = cand; came[ni] = cur; push(cand, ni); }
    }
  }
  const pathTo = (lc) => {
    const cells = [];
    for (let c = lc; c !== -1; c = came[c]) cells.push(c);
    cells.reverse();
    const join = F.fromEN(x0 + (lc % W) * cell, y0 + ((lc / W) | 0) * cell);
    const spine = cells.length > 1 ? spineOf(loc, cells, endLL, join, F, O) : [endLL, join];
    const path = [];
    for (let i = 0; i < spine.length - 1; i++) {
      const p = spine[i], q = spine[i + 1];
      if (legClear(p, q, F, ko, buf)) { path.push({ lat: q.lat, lon: q.lon }); continue; }
      const sub = legPath(p, q, F, ko, buf, { quick: true }) || legPath(p, q, F, ko, buf);
      if (!sub) return null;
      path.push(...sub.map((r) => ({ lat: r.lat, lon: r.lon })));
    }
    return { path, join };
  };
  return { seeds, pathTo };
}

/** The clearance-weighted search over `fld` from EN `a` to `b`: the cells' EN path, or null. ENDS FIRST (endField):
 *  `ends.seeds` (Map cell -> what reaching it cost) begins it from a harbor's exits instead of `a`'s own cell, and
 *  `ends.goals` (Map cell -> what it costs on from there to `b`) ends it at the far harbor's entries - the search then
 *  stops at the cheapest whole (a virtual end node reached from each entry at its own cost on), its heuristic the
 *  straight way to `b` itself, which no entry's cost on can undercut. */
export function searchField(fld, a, b, O, ends = null) {
  const { x0, y0, cell, W, H, blk, dist, trust } = fld, N = W * H;
  const seeds = ends && ends.seeds && ends.seeds.size ? ends.seeds : null;
  const goals = ends && ends.goals && ends.goals.size ? ends.goals : null;
  const s = seeds ? -2 : freeNear(fld, a.e, a.n), g = goals ? -2 : freeNear(fld, b.e, b.n);
  if (s === -1 || g === -1) return null;
  const gxG = g >= 0 ? g % W : (b.e - x0) / cell, gyG = g >= 0 ? (g / W) | 0 : (b.n - y0) / cell;
  const cost = (i) => 1 + O.WEIGHT * (1 - O.TRUST * trust[i]) * nearCost(dist[i], O);
  const gc = new Float64Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const hF = [], hI = [];
  const push = (f, i) => { hF.push(f); hI.push(i); let k = hF.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (hF[p] <= hF[k]) break; [hF[p], hF[k]] = [hF[k], hF[p]]; [hI[p], hI[k]] = [hI[k], hI[p]]; k = p; } };
  const pop = () => { const top = hI[0], lf = hF.pop(), li = hI.pop();
    if (hF.length) { hF[0] = lf; hI[0] = li; let k = 0; const n = hF.length;
      for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < n && hF[l] < hF[m]) m = l; if (r < n && hF[r] < hF[m]) m = r; if (m === k) break;
        [hF[m], hF[k]] = [hF[k], hF[m]]; [hI[m], hI[k]] = [hI[k], hI[m]]; k = m; } }
    return top; };
  const hh = (i) => Math.hypot((i % W) - gxG, ((i / W) | 0) - gyG);
  if (seeds) { for (const [c, g0] of seeds) if (!blk[c] && g0 < gc[c]) { gc[c] = g0; push(g0 + hh(c), c); } }
  else { gc[s] = 0; push(hh(s), s); }
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  const END = N;                                     // the virtual end, reached from a goal at its own cost on
  let found = false, endAt = g, endBest = Infinity;
  while (hF.length) {
    const cur = pop();
    if (cur === END) { found = true; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (!goals && cur === g) { found = true; break; }
    if (goals && goals.has(cur)) {
      const tot = gc[cur] + goals.get(cur);
      if (tot < endBest) { endBest = tot; endAt = cur; push(tot, END); }
    }
    const cx = cur % W, cy = (cur / W) | 0, cc = cost(cur);
    for (const [dx, dy, w] of NB) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (blk[ni] || closed[ni]) continue;
      if (dx && dy && (blk[cy * W + nx] || blk[ny * W + cx])) continue;
      const cand = gc[cur] + w * (cc + cost(ni)) / 2;
      if (cand < gc[ni]) { gc[ni] = cand; came[ni] = cur; push(cand + hh(ni), ni); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = endAt; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  return cells;
}

/**
 * The open-water spine of a leg A -> B (LL): [A, ...turns, B], the search's cell path string-pulled. A shortcut between
 * two of its points is taken only where it is clear on the raster AND costs no more than the path it replaces - the
 * same price the search paid, length weighted by nearness - so it can straighten the path's grid zig-zag but never
 * bring it nearer a hazard to save distance. (A rule on clearance alone let the first leg out of a harbor, where the
 * path itself runs close, hug the shore for kilometers: its own start set the bar.)
 * ⚠ AND NO NEARER THAN THE STRETCH IT REPLACES (2026-10-14). The price alone did not hold the line it claims above: a
 * shortcut can pay more per meter for running closer and still cost less for being shorter. On his Portland Go-To the
 * way out through Hussey Sound came out 22 m off a charted shoal. So a shortcut is taken only where its least
 * clearance is no less than the least of the path it replaces - the price decides among the ways that pass that.
 */
export function spineOf(fld, cells, aLL, bLL, F, O) {
  const { x0, y0, cell, W, H, blk, dist, trust } = fld;
  const costAt = (i) => 1 + O.WEIGHT * (1 - O.TRUST * trust[i]) * nearCost(dist[i], O);
  // the path's cumulative cost, in meters, cell to cell as the search priced it
  const cum = [0];
  for (let k = 1; k < cells.length; k++) {
    const p = cells[k - 1], q = cells[k];
    const step = Math.hypot((q % W) - (p % W), ((q / W) | 0) - ((p / W) | 0)) * cell;
    cum.push(cum[k - 1] + step * (costAt(p) + costAt(q)) / 2);
  }
  // only the turn points of the cell path are candidates (a straight run of cells adds nothing)
  const key = [0];
  for (let k = 1; k < cells.length - 1; k++) {
    const a = cells[k - 1], b = cells[k], c = cells[k + 1];
    if (((b % W) - (a % W)) * (((c / W) | 0) - ((b / W) | 0)) !== (((b / W) | 0) - ((a / W) | 0)) * ((c % W) - (b % W))) key.push(k);
  }
  key.push(cells.length - 1);
  const en = (k) => ({ e: x0 + (cells[k] % W) * cell, n: y0 + ((cells[k] / W) | 0) * cell });
  // the straight leg's cost, or Infinity where the raster blocks it or it runs nearer a hazard than `floor`
  const shortcut = (p, q, floor) => {
    const L = Math.hypot(q.e - p.e, q.n - p.n), n = Math.max(1, Math.ceil(L / (cell / 2)));
    let c = 0;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, gx = Math.round((p.e + (q.e - p.e) * t - x0) / cell), gy = Math.round((p.n + (q.n - p.n) * t - y0) / cell);
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) return Infinity;
      const i = gy * W + gx;
      if (blk[i] || dist[i] < floor) return Infinity;
      c += (L / n) * costAt(i);
    }
    return c;
  };
  const out = [0];
  let ki = 0;
  while (ki < key.length - 1) {
    let best = ki + 1;
    // the least clearance of the path from key[ki] on - what no shortcut from there may go below
    const least = new Float64Array(cells.length);
    for (let k = key[ki], m = Infinity; k < cells.length; k++) { m = Math.min(m, dist[cells[k]]); least[k] = m; }
    for (let kj = key.length - 1; kj > ki + 1; kj--) {
      const i = key[ki], j = key[kj];
      if (shortcut(en(i), en(j), least[j]) <= cum[j] - cum[i] + cell) { best = kj; break; }
    }
    out.push(best);
    ki = best;
  }
  const spine = out.map((kk) => { const p = en(key[kk]); return F.fromEN(p.e, p.n); });
  spine[0] = { lat: aLL.lat, lon: aLL.lon };
  spine[spine.length - 1] = { lat: bLL.lat, lon: bLL.lon };
  return spine;
}

/**
 * OPEN WATER FIRST for one passage leg: from `A` to `B` (LL), in frame `F`, keep-out model `ko` at clearance `buf`,
 * beside the router's own route `leg` (legPath's: excluding A, ending at B). {leg, used, why, lenM, lenRouterM,
 * exposure, exposureRouter, ms, ends} - `leg` the open-water route where it is taken, else the router's, unchanged.
 * `ends` {startM, endM, startBy, endBy}: the meters at each end planned before the open water (ENDS FIRST, above; 0
 * where the search reaches the end itself), and by what - "fine" (endField's search) or "router" (its own route, where
 * the fine search found no way) - or null.
 * `opts.chart` {box, unread, edgeM}: the water the chart was read over (openWaterField); `opts.params` overrides.
 */
export function openWaterLeg(A, B, F, ko, buf, leg, opts = {}) {
  const O = { ...OPEN_WATER, ...(opts.params || {}) };
  const t0 = Date.now();
  const a = F.toEN(A), b = F.toEN(B), dist = Math.hypot(b.e - a.e, b.n - a.n);
  const routerEN = [a, ...(leg || []).map((q) => F.toEN(q))];
  const lenOf = (en) => { let L = 0; for (let i = 1; i < en.length; i++) L += Math.hypot(en[i].e - en[i - 1].e, en[i].n - en[i - 1].n); return L; };
  const lenRouterM = leg ? lenOf(routerEN) : null;
  const say = (used, why, extra = {}) => ({ leg: used ? extra.leg : leg, used, why, lenRouterM, ms: Date.now() - t0, ...extra });
  if (!leg) return say(false, "no router route");
  if (dist < O.MIN_LEG_M) return say(false, "short");
  const m = Math.min(O.MARGIN_MAX_M, Math.max(O.MARGIN_MIN_M, O.MARGIN_FRAC * dist));
  const ex = routerEN.map((p) => p.e), nx = routerEN.map((p) => p.n);
  // ONE FIELD, built at the widest berth (its soft hazards reach CLEAR_M), searched at each berth in BERTHS_FRAC in turn:
  // the first that is short enough and safer enough is taken. Measured on a coastal run (New Castle -> York, 12 km): at
  // 1 km off it was 31 % longer and refused outright - all or nothing threw away the 500 m berth between them.
  const fld = openWaterField(Math.min(...ex) - m, Math.min(...nx) - m, Math.max(...ex) + m, Math.max(...nx) + m, ko, buf, O,
                             opts.chart ? { ...opts.chart, F, from: A } : null);
  // ENDS FIRST: the router's own route from each end out to the water the search can reach (searchEnds)
  const E = searchEnds(fld, routerEN);
  if (!E) return say(false, "no open-water path", { exposureRouter: exposureOn(fld, routerEN, O), clearM: O.CLEAR_M });
  const legLL = [A, ...leg];                         // routerEN's points, as LL
  const atLL = (q) => (q.i === 0 ? A : q.i === routerEN.length - 1 && q.t === 1 ? B : F.fromEN(q.e, q.n));
  const entryLL = atLL(E.entry), exitLL = atLL(E.exit);
  // A harbor end: its fine field, every exit into the leg's water offered to the leg's search (endField). An end with
  // none - no free water of its own, or none it reaches - keeps the router's own route out to the water (searchEnds).
  const chartOf = opts.chart ? { ...opts.chart, F, from: A } : null;
  const outF = E.entryIn ? null : endField(A, F, ko, buf, O, chartOf, fld, E.lab, E.main);
  const inF = E.exitIn ? null : endField(B, F, ko, buf, O, chartOf ? { ...chartOf, from: B } : null, fld, E.lab, E.main);
  const useOut = !!(outF && outF.seeds.size), useIn = !!(inF && inF.seeds.size);
  const rHead = [], rTail = [];                      // the router's own route kept, where no fine way was found
  if (!useOut && E.entry.i > 0) {
    for (let j = 1; j < E.entry.i; j++) rHead.push(legLL[j]);
    if (E.entry.t > 0) rHead.push(entryLL);
  }
  if (!useIn && !(E.exit.i === routerEN.length - 1 && E.exit.t === 1)) {
    for (let j = E.exit.t === 1 ? E.exit.i + 1 : E.exit.i; j < legLL.length; j++) rTail.push(legLL[j]);
  }
  const fromEN = useOut ? a : F.toEN(entryLL), toEN = useIn ? b : F.toEN(exitLL);
  if (Math.hypot(toEN.e - fromEN.e, toEN.n - fromEN.n) < O.MIN_LEG_M) return say(false, "short");
  const seeds = useOut ? new Map([...outF.seeds].map(([c, v]) => [c, v.g])) : null;
  const goals = useIn ? new Map([...inF.seeds].map(([c, v]) => [c, v.g])) : null;
  let last = null;
  for (const f of O.BERTHS_FRAC) {
    const Oc = { ...O, CLEAR_M: O.CLEAR_M * f };
    const exposureRouter = exposureOn(fld, routerEN, Oc);
    const cells = searchField(fld, fromEN, toEN, Oc, { seeds, goals });
    if (!cells) return say(false, "no open-water path", { exposureRouter, clearM: Oc.CLEAR_M });   // the same raster at every berth
    // the ends: the fine way out to the exit the search began at, and in from the entry it ended at
    let head = rHead, tail = rTail, startLL = entryLL, endLL = exitLL;
    if (useOut) {
      const w = outF.pathTo(outF.seeds.get(cells[0]).lc);
      if (!w) { last = say(false, "a spine leg would not route", { exposureRouter, clearM: Oc.CLEAR_M }); continue; }
      head = w.path; startLL = w.join;
    }
    if (useIn) {
      const w = inF.pathTo(inF.seeds.get(cells[cells.length - 1]).lc);
      if (!w) { last = say(false, "a spine leg would not route", { exposureRouter, clearM: Oc.CLEAR_M }); continue; }
      tail = [...w.path.slice(0, -1).reverse(), B]; endLL = w.join;
    }
    const ends = { startM: lenOf([a, ...head.map((q) => F.toEN(q))]), endM: lenOf([F.toEN(endLL), ...tail.map((q) => F.toEN(q))]),
                   startBy: useOut ? "fine" : rHead.length ? "router" : null, endBy: useIn ? "fine" : rTail.length ? "router" : null };
    const spine = spineOf(fld, cells, startLL, endLL, F, Oc);
    // EXACT, leg by leg: a spine leg the router's own test passes stands; one it does not is routed by the router
    const out = [];
    let ok = true;
    for (let i = 0; i < spine.length - 1 && ok; i++) {
      const p = spine[i], q = spine[i + 1];
      if (legClear(p, q, F, ko, buf)) { out.push({ lat: q.lat, lon: q.lon }); continue; }
      const sub = legPath(p, q, F, ko, buf, { quick: true }) || legPath(p, q, F, ko, buf);
      if (!sub) { ok = false; break; }
      out.push(...sub.map((r) => ({ lat: r.lat, lon: r.lon })));
    }
    if (!ok) { last = say(false, "a spine leg would not route", { exposureRouter, clearM: Oc.CLEAR_M, ends }); continue; }
    const full = [...head, ...out, ...tail];
    const owEN = [a, ...full.map((q) => F.toEN(q))];
    const lenM = lenOf(owEN), exposure = exposureOn(fld, owEN, Oc);
    const extra = { leg: full, lenM, exposure, exposureRouter, cell: fld.cell, spine, clearM: Oc.CLEAR_M, ends };
    if (lenM > (1 + O.DETOUR_MAX) * lenRouterM) { last = say(false, "too long", extra); continue; }
    // STRICTLY less: a router's route with nothing near it has nothing to take away, and "0 <= 0.9 x 0" took a different
    // route over open sea for no gain at all (tests/open_water.js 2, the first cut)
    if (!(exposure < (1 - O.GAIN_MIN) * exposureRouter)) { last = say(false, "no safer", extra); continue; }
    return say(true, "open water", extra);
  }
  return last;
}

// ── THE WORDS (the Go-To, RTH and transit banners; the Intent card) ─────────────────────────────────────────────────
// `ow` is a plan's `openWater`: planNogoRoute's one verdict, or routePlan's list of them, one per transit leg it was asked
// of. Said where it was TAKEN - the route the operator sees is not the close-in one - and, on the Intent card, where a
// leg long enough to be asked kept the close-in route, and why.
const OW_KEPT = {
  "no safer": "no wider way cut its exposure by " + Math.round(OPEN_WATER.GAIN_MIN * 100) + "%",
  "too long": "every wider way more than " + (1 + OPEN_WATER.DETOUR_MAX) + " times its length",
  "no open-water path": "no wider way through the water read",
  "a spine leg would not route": "the wider way could not be made exact",
  "a buoy's proper hand": "the wider way would leave a buoy on its wrong hand that the close-in route keeps",
};
const owList = (ow) => (Array.isArray(ow) ? ow : ow ? [ow] : []).filter(Boolean);
const owBerth = (used, f) => {
  const c = used.map((l) => l.clearM).filter((x) => x != null);
  if (!c.length) return "";
  const lo = Math.min(...c), hi = Math.max(...c);
  return lo === hi ? f(lo) : f(lo) + " to " + f(hi);
};
// ENDS FIRST, said: a leg's harbor ends planned in detail before the open water, where the water was too tight for the
// wider search (under 50 m of it is not worth a word - a search that starts at her snaps that far anyway)
const owEnds = (used, f) => {
  const s = used.reduce((t, l) => t + ((l.ends && l.ends.startM) || 0), 0);
  const e = used.reduce((t, l) => t + ((l.ends && l.ends.endM) || 0), 0);
  if (used.length > 1) return s + e >= 50 ? f(s + e) + " at the legs' ends" : "";
  const parts = [];
  if (s >= 50) parts.push("the first " + f(s));
  if (e >= 50) parts.push("the last " + f(e));
  return parts.join(" and ");
};
const owAdded = (used, f) => {
  const d = used.reduce((s, l) => s + ((l.lenM ?? 0) - (l.lenRouterM ?? l.lenM ?? 0)), 0);
  return Math.abs(d) < 50 ? "about the close-in route's length"
    : f(Math.abs(d)) + (d > 0 ? " longer than" : " shorter than") + " the close-in route";
};
/** The banner's words: nothing unless open water was taken on some leg. `fmt` formats meters (the page's fmtDist). */
export function openWaterNote(ow, fmt) {
  const f = fmt || ((m) => Math.round(m) + " m"), used = owList(ow).filter((l) => l.used);
  if (!used.length) return "";
  const held = used.reduce((s, l) => s + (l.held || 0), 0);
  return "open water first: a " + owBerth(used, f) + " berth off charted dangers where the water allows"
    + (used.length > 1 ? ", on " + used.length + " legs" : "") + ", " + owAdded(used, f)
    + (held ? ", the close-in way kept past " + held + " buoy" + (held === 1 ? "" : "s") + " for " + (held === 1 ? "its" : "their") + " proper hand" : "")
    + (owEnds(used, f) ? ", in detail for " + owEnds(used, f) + " (harbor water too tight for the wider search)" : "");
}
/** The Intent card's lines: what was taken, and each leg long enough to be asked that kept the close-in route, and why. */
export function openWaterWhy(ow, fmt) {
  const f = fmt || ((m) => Math.round(m) + " m"), all = owList(ow), used = all.filter((l) => l.used);
  const kept = all.filter((l) => !l.used && OW_KEPT[l.why]);
  const out = [];
  if (used.length)
    out.push({ t: "lane", s: "open water first: a " + owBerth(used, f) + " berth off charted dangers where the water allows, "
      + "not threading the islands and ledges close in" + (used.length > 1 ? " (" + used.length + " legs)" : "")
      + " - " + owAdded(used, f)
      + (used.some((l) => l.held) ? "; the close-in way kept within " + OPEN_WATER.MARK_HOLD_M + " m of "
         + used.reduce((s, l) => s + (l.held || 0), 0) + " buoy(s) the wider way would have left on the wrong hand" : "")
      + (owEnds(used, f) ? "; planned in detail for " + owEnds(used, f) + ", harbor water too tight for the wider search - "
         + "the way out and in chosen with the open water beyond them" : "") });
  if (kept.length)
    out.push({ t: "route", s: "open water first: the close-in route kept" + (all.length > 1 ? " on " + kept.length + " leg" + (kept.length === 1 ? "" : "s") : "")
      + " - " + [...new Set(kept.map((l) => OW_KEPT[l.why]))].join("; ") });
  return out;
}
