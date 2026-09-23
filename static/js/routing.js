/* ========================================================================
 * ⚠⚠ ASV OWNS THIS FILE NOW (2026-09-04). DO NOT RE-VENDOR IT.
 *
 * Andy, 2026-08-31: "stop updating other projects. We concentrate only on ASV
 * Console moving forward. There may be components of other projects that we
 * pull over." The flow is ONE WAY: asv_core is a place to pull FROM, never a
 * place this repo writes back to. The vendor header below is kept for
 * PROVENANCE -- it records where this body came from -- and its instruction is
 * now wrong for this repo, in the same dangerous way it was already wrong for
 * keepouts.js and core_turns.js:
 *
 *   ⚠ RUNNING `python tools/vendor.py` IN THE asv_core REPO WOULD OVERWRITE
 *     THIS FILE AND SILENTLY DELETE A SAFETY FIX. This copy carries
 *     gateLegClear's ENDPOINT EXEMPTION, narrowed so it waives a block near an
 *     endpoint only when that endpoint is ITSELF inside the buffer -- see the
 *     note on the function. Measured before the change: across 475 Go-To routes
 *     from one spawn at New Castle the obstacle search never shipped a fouling
 *     leg, and ONE shipped route passed 0.47 m from a charted pier with a 3 m
 *     buffer set, because the block happened to fall 5.8 m from a destination
 *     that had 3.45 m of clear water round it.
 *
 * A `--check` over there that reports this file as DRIFTED is CORRECT, and is
 * not something to "fix" by re-vendoring.
 * ========================================================================
 *
 * VENDORED FROM asv_core -- DO NOT EDIT THIS COPY.
 *
 *   source : asv_core_js/routing.js
 *   sync   : python tools/vendor.py            (from the asv_core repo)
 *   verify : python tools/vendor.py --check    (fails if this copy drifted)
 *
 * NO ABSOLUTE PATH APPEARS ABOVE, AND THAT IS DELIBERATE. Two of these repos
 * publish scrubbed PUBLIC mirrors, and Transit's exporter ABORTS on anything
 * matching [A-Z]:\Claude -- absolute paths name private sibling projects and
 * point a cloner at a drive they do not have. A header naming a path would be
 * publish-safe only for as long as somebody maintained a substitution rule for
 * it in each exporter separately. Naming the repo instead is safe by
 * construction, in every consumer, including ones that do not exist yet.
 *
 * A copy rather than an import because this repo has to stand on its own: it is
 * a separate repository, and this file is opened by path rather than imported
 * as a package. The old trade was drift -- a vendored file did not follow its
 * source, which is how the estate grew three copies of currents.py. The --check
 * above removes that trade: this copy cannot diverge without failing a suite.
 *
 * THIS CONSUMER, SPECIFICALLY:
 * THIS CONSOLE IS WHERE THE LAYER CAME FROM -- WorldView's router.js says so
 * in its own header -- and the bodies came back MEASURED. passage.js against
 * WorldView's router.js + channel.js, both handed this console's flat frame
 * and the SAME keep-out model object, 2026-08-20: all fourteen shared
 * symbols at 0.000e+0 m. snapClearLL over 300 cases (187 moved, 113
 * refused), routeAround/routeAroundSeg over six legs plus nine margin and
 * maxDim overrides, legPath through its escalation ladder, pruneStitch,
 * smoothTrack, both lane producers, gateLegClear with `abandoned` and
 * `splices` agreeing, channelLaneRoute end to end, and both survey channel
 * rules.
 *
 * ⚠ AND THOSE ZEROS WERE TRUE BUT LUCKY. A SHARED NAME IS NOT A SHARED
 * QUANTITY: `distTo` is the FLAT model here and VINCENTY in WorldView, a
 * steady 0.278 % apart, and `azTo` up to 0.120 deg. The shared bodies call
 * both -- legPath's escape ring filters and sorts by distTo, pruneStitch
 * folds past 150 deg of azTo -- and the gap changes 92 of 20,000 keep/drop
 * calls and 3.0 % of orderings. The fixture never landed near a threshold.
 * So planeFrame now carries this console's OWN distTo and azTo, the shared
 * bodies call frame.distTo, and nothing here moves.
 *
 * WHETHER THIS ROUTER SHOULD KEEP MEASURING FLAT IS A SEPARATE QUESTION AND
 * AN OPEN ONE. The flat model is 0.278 % short of the true distance;
 * adopting Vincenty would move real routes on the water, so it is not a
 * change to make as a side effect of an extraction.
 *
 * THE LANE PRODUCERS RETURN THEIR FLAGS NOW. buoyChannelLane and
 * narrowChannelLane wrote `sea.laneUsed` / `sea.lanePartial` here -- a
 * module-level scratch flag set by three producers and read by one
 * consumer -- where WorldView returns {path, used, partial}. The core takes
 * the returned form; passage.js mirrors it back into `sea.*` at the one
 * seam so nothing that reads that state goes stale.
 *
 * V.CHANNEL_REACH_M IS opts.channelReachM. Same number, same meaning, same
 * is-a-maximum-never-a-substitute rule; passage.js passes it through.
 *
 * NOT ADOPTED: regionOrder, buoyageNote, junctionKnot, pruneJunctionKnots,
 * planNogoRoute and routePlan stay here. The first four exist in WorldView
 * too (in mission.js) but pruneJunctionKnots genuinely DIFFERS -- it takes
 * an injected `clear` predicate there and a keep-out model here -- so the
 * mission layer is a merge to decide, not the next vendoring.
 *
 * Edit the core file and re-run the sync. Everything below is verbatim.
 */

/**
 * asv_core · routing — turning a request for a passage into a lawful waypoint list.
 *
 * `keepouts.js` answers "may the vessel be here". This answers "then how does it
 * get from here to there", and "which side of the channel does it keep to on the
 * way" — the obstacle search and the COLREGS Rule 9 lane, which are mutually
 * recursive and therefore one module:
 *
 *   `routeAround(A, B, frame, ko, buf)`   A* around the keep-outs, rasterised
 *   `routeAroundSeg(...)`                 the same, split so a long leg keeps a fine grid
 *   `legPath(A, B, frame, ko, buf)`       the escalation ladder, or null
 *   `pruneStitch(full, frame, ko, buf)`   drop a vertex whose neighbors connect clear
 *   `channelLaneRoute(path, frame, ko, buf)`  the whole Rule 9 pipeline
 *
 * ─ WHY THIS FILE EXISTS ─
 *
 * Both consoles had this layer. Measured 2026-08-20 BEFORE the move, ASV's
 * `passage.js` against WorldView's `router.js` + `channel.js`, both handed ASV's
 * flat frame and the SAME keep-out model object, every one of the fourteen
 * shared symbols agreed at 0.000e+0 m: snapClearLL over 300 cases (187 moved,
 * 113 refused), routeAround and routeAroundSeg over six legs plus nine
 * margin/maxDim overrides, legPath through its escalation ladder, pruneStitch,
 * smoothTrack, both lane producers, gateLegClear (with `abandoned` and `splices`
 * agreeing), channelLaneRoute end to end, and the two survey channel rules.
 *
 * ─ ⚠ AND THE ZEROS WERE TRUE BUT LUCKY, WHICH IS THE FINDING ─
 *
 * A SHARED NAME IS NOT A SHARED QUANTITY. These bodies call `distTo` and `azTo`,
 * and the two consoles mean different functions by them: ASV's are the FLAT
 * model, WorldView's are Vincenty on the ellipsoid. At Lewes they disagree by a
 * steady 0.278 % — 4.4 m at 1600 m and 22.5 m at 8100 m, the widest margin the
 * search uses — with `azTo` up to 0.120° apart. That is not noise at these
 * thresholds:
 *
 *   `legPath` escape-ring keep/drop      92 of 20,000 decisions differ
 *   `legPath` escape-ring best-first     118 of 4,000 top-six orderings differ
 *   `pruneStitch` 150° fold test         11 of 20,000
 *   `gateLegClear` within-2·buf exemption  9 of 20,000
 *
 * The fixture simply never landed near a threshold. So a core that IMPORTED one
 * of the two would silently move the other console's routing, and no
 * differential built from ordinary legs would report it.
 *
 * THE METRIC THEREFORE TRAVELS WITH THE FRAME, exactly as the plane does. Every
 * call here is `frame.distTo(...)` / `frame.azTo(...)`, and each console supplies
 * its own — which is what let the divergence be seen at all.
 *
 * ✓ AND ANDY THEN RULED "standardize" (2026-08-20). Both `planeFrame` and
 * `tangentFrame` now supply the TRUE pair, `geodesicDistanceM` and
 * `geodesicBearingDeg` — literally the same core functions, not merely close —
 * so a route search asks the same question in both consoles.
 *
 * ⚠ THE FRAME STILL CARRIES IT, AND THAT IS NOT VESTIGIAL. Two values agreeing
 * today is not a reason to hard-wire one of them: carrying the metric is what
 * made the divergence visible, and it is what lets tests/routing.py probe this
 * design with a deliberately absurd metric. A frame claiming every turn is 0°
 * must stop `pruneStitch` folding; if these calls ever became imports again,
 * that check is the only thing in the estate that would notice.
 *
 * ⚠ AND ASV'S PLANE IS STILL FLAT WHILE ITS METRIC IS NOW TRUE — 0.278 % apart,
 * on purpose. A point placed r meters out through `fromEN` measures 0.9972·r by
 * `frame.distTo`. Safe because of WHERE the metric is used here: the escape-ring
 * filter and sort, the 60° fold, the within-2·buf exemption. All three are
 * HEURISTICS — which candidate to prefer, which vertex to drop, which block to
 * excuse. NOT ONE IS A CLEARANCE BOUND: every route is still proved by
 * `legClear`, which works in the plane through `toEN` and never reads the metric.
 *
 * ─ WHAT IS NOT HERE ─
 *
 * `makeRouter`, `surveyChannels`, `laneLeg` and `laneRouter` are WorldView's:
 * they take its `model` object and share one time budget across a mission.
 * `regionOrder`, `junctionKnot`, `pruneJunctionKnots`, `planNogoRoute` and
 * `routePlan` are the MISSION layer, and `pruneJunctionKnots` genuinely differs
 * between the consoles (an injected `clear` predicate against a passed model),
 * so it is a merge to decide rather than a body to move.
 *
 * ─ THE INVARIANT EVERYTHING RESTS ON ─
 *
 * THE RASTER IS CONSERVATIVE: it over-approximates the keep-outs and never
 * under-approximates. That is what makes a raster-clear shortcut genuinely
 * clear, and why the string-pull may trust it instead of re-testing exactly.
 * Break the dilation, drop the polygon edge stamps, or let A* cut a diagonal
 * corner, and the guarantee is gone while every route still looks plausible.
 */

// The planar primitives come from the geometry module and the keep-out behavior
// from the keep-out one, rather than everything through the latter's re-export.
// `./geometry.js` and `./keepouts.js` both resolve to the core copy in either
// destination -- WorldView's vendored `core/` dir keeps the natural names, and
// ASV's flat layout renames them to `core_*` while its own `geometry.js` and
// `chart.js` re-export from those. tests/geometry.py asserts that hop BY IDENTITY.
import { inBB, pinp, segSamplesEN } from './geometry.js';
import {
  blocked, legClear, firstBlockAlong,
  extendCenterline, systemCenterline, channelPolys,
} from './keepouts.js';
import { stampSeg, dilateGrid, rasterKeepouts } from './raster.js';

export { stampSeg, dilateGrid, rasterKeepouts };

/**
 * Sub-leg length for a long transit.
 *
 * The grid spans the whole A–B box at a cell capped by `maxDim`, so past a few
 * kilometers the cell coarsens until it can no longer thread a channel. Split a
 * long leg into fine-grid-sized pieces, route each, and stitch.
 */
export const SEG_LEN_M = 2200;

/** A* heuristic weight: greedier search, near-optimal detour, far fewer nodes. */
const HEURISTIC_WEIGHT = 1.6;

/** Bound on a no-path search, so an unroutable leg fails fast instead of hanging. */
const POP_CAP = 900000;

/** Default grid dimension cap — the cell coarsens only when the region is huge. */
const MAX_DIM = 1400;

// ── Occupancy raster ────────────────────────────────────────────────────────

// ── The search ──────────────────────────────────────────────────────────────

/**
 * Route a blocked transit A→B around the keep-outs.
 *
 * @returns {Array|null} intermediate waypoints in lon/lat, EXCLUDING A and B —
 *   the shape `punchOut`'s `routeAround` option wants — or null when no clear
 *   route exists in a bounded region, in which case the transit stays flagged.
 */
export function routeAround(A, B, frame, ko, buffer, marginOv, maxDimOv) {
  const ae = frame.toEN(A), be = frame.toEN(B);
  let x0 = Math.min(ae.e, be.e), x1 = Math.max(ae.e, be.e);
  let y0 = Math.min(ae.n, be.n), y1 = Math.max(ae.n, be.n);

  // Region = the A–B box plus a BOUNDED swing margin. It deliberately does not
  // scale with the whole transit length: that made the cell coarsen until it
  // could no longer thread a channel, and long legs got wrongly refused.
  // `marginOv`/`maxDimOv` are `legPath`'s escalation retries asking for a wider
  // window when the default cannot round a large landmass.
  const dist = Math.hypot(be.e - ae.e, be.n - ae.n);
  const margin = marginOv || Math.max(40, buffer * 4, Math.min(dist, 900));
  x0 -= margin; x1 += margin; y0 -= margin; y1 += margin;

  const maxDim = maxDimOv || MAX_DIM;
  const cell = Math.max(3, buffer / 2, (x1 - x0) / maxDim, (y1 - y0) / maxDim);
  const W = Math.floor((x1 - x0) / cell) + 1, H = Math.floor((y1 - y0) / cell) + 1;
  if (W < 2 || H < 2) return null;

  const EX = (gx) => x0 + gx * cell;
  const NY = (gy) => y0 + gy * cell;
  const blk = new Uint8Array(W * H);
  rasterKeepouts(blk, W, H, x0, y0, cell, ko, buffer);

  // Start and goal may themselves sit in the buffer — a vessel alongside a
  // dock, or a line end at marginal charted depth. Snap to the nearest free
  // cell rather than refusing; the route's job is to lead it out.
  const snapR = Math.max(6, Math.ceil(90 / cell));
  const freeNear = (gx, gy) => {
    for (let r = 0; r <= snapR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = gx + dx, y = gy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          if (!blk[y * W + x]) return [x, y];
        }
      }
    }
    return null;
  };
  const s = freeNear(Math.round((ae.e - x0) / cell), Math.round((ae.n - y0) / cell));
  const g = freeNear(Math.round((be.e - x0) / cell), Math.round((be.n - y0) / cell));
  if (!s || !g) return null;

  const gS = s[1] * W + s[0], gG = g[1] * W + g[0], N = W * H;
  const gc = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const hh = (i) => Math.hypot((i % W) - g[0], ((i / W) | 0) - g[1]);

  // TWO PARALLEL ARRAYS, NOT AN ARRAY OF PAIRS. Every comparison reads only
  // the f-value and every swap moves both, so the pop order — ties included —
  // is identical to the pair version; what changes is that a push is two
  // number appends and zero allocations. The old `heap.push([f, i])` made a
  // short-lived object per push, and lazy deletion pushes a duplicate on every
  // g-improvement: an unroutable leg runs to POP_CAP by design (fails fast
  // instead of hanging), which is exactly the worst allocation case, and then
  // the escalation ladder repeats it at two wider margins.
  const heapF = [], heapI = [];
  const hpush = (f, i) => {
    heapF.push(f); heapI.push(i);
    let k = heapF.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= heapF[k]) break;
      const tf = heapF[p]; heapF[p] = heapF[k]; heapF[k] = tf;
      const ti = heapI[p]; heapI[p] = heapI[k]; heapI[k] = ti;
      k = p;
    }
  };
  const hpop = () => {
    const top = heapI[0];
    const lastF = heapF.pop(), lastI = heapI.pop();
    if (heapF.length) {
      heapF[0] = lastF; heapI[0] = lastI;
      let k = 0; const n = heapF.length;
      for (;;) {
        const l = 2 * k + 1, r = 2 * k + 2;
        let m = k;
        if (l < n && heapF[l] < heapF[m]) m = l;
        if (r < n && heapF[r] < heapF[m]) m = r;
        if (m === k) break;
        const tf = heapF[m]; heapF[m] = heapF[k]; heapF[k] = tf;
        const ti = heapI[m]; heapI[m] = heapI[k]; heapI[k] = ti;
        k = m;
      }
    }
    return top;
  };

  gc[gS] = 0;
  hpush(HEURISTIC_WEIGHT * hh(gS), gS);
  const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
              [1, 1, 1.41421], [1, -1, 1.41421], [-1, 1, 1.41421], [-1, -1, 1.41421]];
  let found = false, pops = 0;
  while (heapF.length) {
    if (++pops > POP_CAP) break;
    const cur = hpop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === gG) { found = true; break; }
    const cgx = cur % W, cgy = (cur / W) | 0;
    for (const [dx, dy, w] of nb) {
      const nx = cgx + dx, ny = cgy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (blk[ni]) continue;
      // No diagonal CORNER-CUT: squeezing between two blocked cells that touch
      // only at a corner is a path through a gap of zero width.
      //
      // THIS GUARD IS CONSERVATIVE, AND THE SUITE DOES NOT PIN IT — removing it
      // turns no check red, and that was checked rather than assumed. The reason
      // is `rasterKeepouts` always dilating by at least one cell: two blocked
      // cells can then never touch at only a corner, so in practice this only
      // forbids a diagonal that HUGS a wall (one orthogonal neighbor blocked),
      // and the raster's own conservatism already keeps that exactly clear. It
      // stays because it is the standard correctness condition for grid A* and
      // costs nothing; it is not load-bearing here. Do not add a mutation for it
      // expecting red.
      if (dx && dy && (blk[cgy * W + nx] || blk[ny * W + cgx])) continue;
      const cand = gc[cur] + w;
      if (cand < gc[ni]) { gc[ni] = cand; came[ni] = cur; hpush(cand + HEURISTIC_WEIGHT * hh(ni), ni); }
    }
  }
  if (!found) return null;

  const path = [];
  for (let c = gG; c !== -1; c = came[c]) path.push(c);
  path.reverse();

  // Collapse collinear runs, so the O(n²) string-pull below runs over a few
  // dozen TURN points rather than the hundreds a fine grid produces.
  const key = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1], b = path[i], c = path[i + 1];
    const ax = a % W, ay = (a / W) | 0, bx = b % W, by = (b / W) | 0, cx = c % W, cy = (c / W) | 0;
    if ((bx - ax) * (cy - by) !== (by - ay) * (cx - bx)) key.push(b);
  }
  if (path.length > 1) key.push(path[path.length - 1]);
  const pts = [A, ...key.map((c) => frame.fromEN(EX(c % W), NY((c / W) | 0))), B];

  // Line-of-sight against the RASTER, at O(1) per sample. The raster
  // over-approximates the keep-outs, so a raster-clear shortcut is genuinely
  // clear — which is what makes this cheap enough to run on a long transit.
  const rasterClear = (p, q) => {
    const pe = frame.toEN(p), qe = frame.toEN(q);
    const L = Math.hypot(qe.e - pe.e, qe.n - pe.n);
    const n = Math.max(1, Math.ceil(L / cell));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const e = pe.e + (qe.e - pe.e) * t, nn = pe.n + (qe.n - pe.n) * t;
      const gx = Math.round((e - x0) / cell), gy = Math.round((nn - y0) / cell);
      if (gx < 0 || gy < 0 || gx >= W || gy >= H || blk[gy * W + gx]) return false;
    }
    return true;
  };

  const simp = [pts[0]];
  let ci = 0;
  while (ci < pts.length - 1) {
    let nx = ci + 1;
    for (let j = pts.length - 1; j > ci; j--) {
      if (rasterClear(pts[ci], pts[j])) { nx = j; break; }
    }
    simp.push(pts[nx]);
    ci = nx;
  }

  // A route whose first leg is not clear is NOT rejected: the vessel's own
  // position can legitimately sit inside the buffer, and leading it out is
  // exactly the job. The interior legs came from the conservative raster, so
  // they are already clear.
  return simp.slice(1, -1);
}

/** Nudge a point along ±(pe, pn) until it reaches clear water, or give up. */
export function snapClearLL(p, frame, ko, buf, pe, pn) {
  if (!blocked(frame.toEN(p), ko, buf)) return p;
  const base = frame.toEN(p), lim = Math.max(150, buf * 20);
  for (let d = Math.max(3, buf); d <= lim; d += Math.max(3, buf)) {
    for (const s of [1, -1]) {
      const e = base.e + pe * d * s, n = base.n + pn * d * s;
      if (!blocked({ e, n }, ko, buf)) return frame.fromEN(e, n);
    }
  }
  return null;
}

/**
 * Route a transit, keeping a FINE grid however long it is.
 *
 * `routeAround` grids the whole A–B box at a cell capped by `maxDim`, so past
 * about 4 km the cell coarsens and can no longer thread local features. Split
 * the leg into fine-grid-sized sub-legs, route each, and stitch. The stitched
 * path is clear by construction — each sub-leg's interior is clear to and from
 * its endpoints, and the split points are nudged to clear water first.
 *
 * Falls back to a single `routeAround` whenever a split point cannot be cleared
 * or any sub-leg is unroutable, so it can never do worse than not splitting.
 */
export function routeAroundSeg(A, B, frame, ko, buf) {
  const ae = frame.toEN(A), be = frame.toEN(B);
  const dist = Math.hypot(be.e - ae.e, be.n - ae.n);
  const margin = Math.max(40, buf * 4, Math.min(dist, 900));
  const cellSingle = Math.max(3, buf / 2, (dist + 2 * margin) / 1400);
  if (cellSingle <= 4.5) return routeAround(A, B, frame, ko, buf);   // already fine enough

  let te = be.e - ae.e, tn = be.n - ae.n;
  const tl = Math.hypot(te, tn) || 1;
  te /= tl; tn /= tl;
  const pe = tn, pn = -te;                       // perpendicular, for the split nudge

  const K = Math.max(2, Math.ceil(dist / SEG_LEN_M));
  const bpts = [A];
  for (let i = 1; i < K; i++) {
    const t = i / K;
    const raw = frame.fromEN(ae.e + (be.e - ae.e) * t, ae.n + (be.n - ae.n) * t);
    const snapped = snapClearLL(raw, frame, ko, buf, pe, pn);
    if (!snapped) return routeAround(A, B, frame, ko, buf);
    bpts.push(snapped);
  }
  bpts.push(B);

  const out = [];
  for (let i = 0; i < bpts.length - 1; i++) {
    const via = routeAround(bpts[i], bpts[i + 1], frame, ko, buf);
    if (via === null) return routeAround(A, B, frame, ko, buf);
    out.push(...via);
    if (i < bpts.length - 2) out.push(bpts[i + 1]);      // the shared split point
  }
  // The split points leave hairpins where two sub-legs meet; prune them.
  return pruneStitch([A, ...out, B], frame, ko, buf).slice(1, -1);
}

/**
 * Drop any waypoint forming a sharp turn (>60°) whose neighbors connect clear.
 *
 * A stitched or refined path keeps only the turns an obstacle actually forces.
 * This can only ever SHORTEN a path that is already clear by construction —
 * every drop is validated with the exact `legClear`, not the raster.
 */
export function pruneStitch(full, frame, ko, buf) {
  const out = full.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const t = ((frame.azTo(out[i], out[i + 1]) - frame.azTo(out[i - 1], out[i]) + 540) % 360) - 180;
      if (Math.abs(t) > 60 && legClear(out[i - 1], out[i + 1], frame, ko, buf)) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * A clear waypoint list from A to B, ENDING AT B — or null.
 *
 * The escalation ladder, in sections with a safe fallback. The fast search
 * region is the A–B box plus at most 900 m, which cannot round a LARGE
 * landmass: the detour leaves that window by kilometers, so a long transit was
 * refused while short ones worked. Two stacked constraints:
 *
 *   1. the swing needs a WIDER region → retry at 2700 m and 8100 m (the grid
 *      coarsens, but the raster over-approximates, so any path found is clear);
 *   2. at that coarse cell a tight basin or marina closes over the start or the
 *      goal and the free-cell snap fails → ESCAPE first, fine-routing to nearby
 *      open water, then escalate from there.
 *
 * Coarse legs are refined against the fine default region and the stitches
 * pruned. The whole thing is bounded by a time budget, because an unroutable
 * leg must cost a moment, not a minute.
 */
export function legPath(A, B, frame, ko, buf, opts = {}) {
  if (legClear(A, B, frame, ko, buf)) return [{ lon: B.lon, lat: B.lat }];

  const via = routeAroundSeg(A, B, frame, ko, buf);
  if (via && via.length) return [...via.map((p) => ({ lon: p.lon, lat: p.lat })), { lon: B.lon, lat: B.lat }];

  const budgetMs = opts.budgetMs ?? 9000;
  const deadline = opts.deadline ?? (Date.now() + budgetMs);
  const spent = () => Date.now() > deadline;

  const wide = (P0, P1) => {
    for (const m of [2700, 8100]) {
      if (spent()) return null;
      const c = routeAround(P0, P1, frame, ko, buf, m, 2000);
      if (c) return c;
    }
    return null;
  };

  // Open-water escape candidates, best-first.
  const openRing = (C, toward) => {
    const out = [];
    const dC = frame.distTo(C, toward);
    for (const r of [400, 800, 1600]) {
      for (let a = 0; a < 360; a += 30) {
        const e = frame.toEN(C);
        const p = frame.fromEN(e.e + r * Math.sin(a * Math.PI / 180),
          e.n + r * Math.cos(a * Math.PI / 180));
        if (blocked(frame.toEN(p), ko, buf * 2)) continue;   // want genuinely open water
        if (frame.distTo(p, toward) > dC + r) continue;            // and not away from the goal
        out.push(p);
      }
    }
    return out.sort((p, q) => frame.distTo(p, toward) - frame.distTo(q, toward)).slice(0, 6);
  };

  const compose = (pts) => {
    const fine = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      if (i) fine.push(pts[i]);
      const sub = routeAroundSeg(pts[i], pts[i + 1], frame, ko, buf);
      if (sub && sub.length) fine.push(...sub);
    }
    fine.push(pts[pts.length - 1]);
    return pruneStitch(fine, frame, ko, buf).slice(1).map((p) => ({ lon: p.lon, lat: p.lat }));
  };

  let c = wide(A, B);                                        // (1) wider regions
  if (c) return compose([A, ...c, B]);

  // THE RINGS AND THE END-LEGS ARE COMPUTED ONCE. Step (4) used to rebuild
  // openRing(A,B), re-route the same first three A→E legs, and rebuild
  // openRing(B,A) on every outer iteration (it was the inner loop's iterable
  // expression), re-routing the same three F→B legs up to three times each —
  // every one a byte-identical recomputation of what steps (2) and (3) had
  // just done. All of it was charged to the ONE budget the whole mission
  // shares, so tens to hundreds of ms burned on one hard leg came straight
  // out of the ladder time left for every later blocked leg, which then
  // stayed flagged. Same candidates, same order, same deterministic search:
  // the routes are identical; only what is left in the budget changes.
  const ringA = openRing(A, B), ringB = openRing(B, A);
  const startLeg = new Map(), goalLeg = new Map();
  const toE = (E) => {
    if (!startLeg.has(E)) startLeg.set(E, routeAround(A, E, frame, ko, buf));
    return startLeg.get(E);
  };
  const fromF = (F) => {
    if (!goalLeg.has(F)) goalLeg.set(F, routeAround(F, B, frame, ko, buf));
    return goalLeg.get(F);
  };

  for (const E of ringA) {                                   // (2) a tight START
    if (spent()) break;
    const e1 = toE(E);
    if (!e1) continue;
    const c2 = wide(E, B);
    if (c2) return compose([A, ...e1, E, ...c2, B]);
  }
  for (const F of ringB) {                                   // (3) a tight GOAL
    if (spent()) break;
    const f1 = fromF(F);
    if (!f1) continue;
    const c2 = wide(A, F);
    if (c2) return compose([A, ...c2, F, ...f1, B]);
  }
  for (const E of ringA.slice(0, 3)) {                       // (4) both ends tight
    if (spent()) break;
    const e1 = toE(E);
    if (!e1) continue;
    for (const F of ringB.slice(0, 3)) {
      if (spent()) break;
      const f1 = fromF(F);
      if (!f1) continue;
      const c2 = wide(E, F);
      if (c2) return compose([A, ...e1, E, ...c2, F, ...f1, B]);
    }
  }
  return null;
}

/** How far off the centerline the lane rides, as a fraction of the half-width. */
export const LANE_FRAC = 0.5;

/**
 * How far OUTSIDE the buoy line a transit may be and still count as using that channel.
 *
 * ⚠ THIS IS A STANDOFF FROM THE BUOYS, NOT A MULTIPLE OF THE CHANNEL. It was
 * `Math.max(hw * 2.5, 60)` — two and a half times the channel's own HALF-width — and that
 * scaling is what Andy reported on 2026-09-01: *"The route taken from home to the first
 * point of the survey pattern is wildly circuitous."*
 *
 * Measured on the Erie plan he was looking at. Home to the first survey line is 681 m and
 * the router returns it as ONE waypoint — the straight run is already clear, there is no
 * obstacle anywhere on it. The buoyed channel there has a 150 m half-width, so the old
 * test captured anything within 375 m of the centerline: 225 m BEYOND the buoys. Sampled
 * along that straight run, only 7 of 21 points were actually inside the channel — it
 * leaves the buoy line about a third of the way along and ends 279 m off the centerline,
 * 129 m outside it — yet 21 of 21 were captured. So a route that had left the channel was
 * treated as a full channel transit and pinned to its starboard edge for the whole leg,
 * arriving 196 m off the direct line and then cutting back across. 681 m of clear water
 * became 20 waypoints and 829 m.
 *
 * The lane itself was never wrong, and that is worth recording because it looked wrong:
 * measured against the centerline's own direction every sample read "port", which is the
 * WRONG SIDE for Rule 9 — but a buoyed centerline runs in the direction of BUOYAGE, and
 * this transit was outbound against it. Measured against the direction of travel, all of
 * it is 75 m to STARBOARD at exactly LANE_FRAC of the half-width. Correct, all along.
 *
 * So the fix is scope, not geometry: keep right while genuinely in the channel, and let
 * the splice hand the rest of the leg back to the routed path — which is what Andy asked
 * for, *"stay right and then aim right at the beginning of the survey."*
 *
 * Scaled off the operator's BUFFER, so it tracks how much room this vessel is being given
 * rather than how wide the water happens to be. A boat running inside this of the buoys
 * is using the channel; one further out than this is in open water alongside it.
 */
export const LANE_CAPTURE_STANDOFF_M = (buf) => Math.max(60, (buf || 0) * 10);

/**
 * How wide the water may be and still be a NARROW CHANNEL for COLREGS Rule 9,
 * in meters, edge to edge.
 *
 * ⚠ THIS IS A POLICY NUMBER AND IT IS SAID OUT LOUD, because COLREGS defines no
 * width. Rule 9 speaks of "a narrow channel or fairway" and Rule 9(b) of a vessel
 * "which can safely navigate only within a narrow channel or fairway" — a test
 * about the OTHER vessel's room to maneuver, not a measurement. So a threshold
 * has to be chosen, and the honest thing is to name it, state the reasoning, and
 * let it be overridden rather than bury it in a comparison.
 *
 * 150 m is chosen so that a large vessel is genuinely constrained: a ship of
 * 30-40 m beam has under four beam-widths of water and no room to maneuver
 * around a small craft. Above it, a bay may be shaped like a channel without
 * being one, and that is exactly the over-application this bound exists to stop —
 * the previous code had NO width test at all and treated any water with edges
 * within max(120, buf*30) on both sides as a channel, which at the shipped buffer
 * is 300 m of open bay.
 *
 * A CHARTED channel (FAIRWY / DRGARE / a buoyed lateral system) is Rule 9 water
 * whatever its width — the chart's declaration outranks this number, and this is
 * only the test for water nothing has charted as a channel.
 */
export const NARROW_MAX_M = 150;


/**
 * The centerline the lane is built on: the buoy-pair midline, extended past
 * both ends to the charted extent of the fairway.
 *
 * Every consumer goes through this, so "where does the channel reach to" cannot
 * mean one thing to the lane builder and another to the unmarked-water rule
 * that skips already-laned stretches.
 */
export const laneCenterline = (sy, ko) => extendCenterline(systemCenterline(sy), ko && ko.chans);

/** Arc-length resample of an EN polyline at `step`, ending on the last point. */
function resampleEN(en, step) {
  const cum = [0];
  for (let i = 1; i < en.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(en[i].e - en[i - 1].e, en[i].n - en[i - 1].n));
  }
  const total = cum[cum.length - 1];
  if (!(total > 0)) return null;
  const atS = (s) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const a = en[i - 1], b = en[i], seg = (cum[i] - cum[i - 1]) || 1;
    const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
    return { e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t };
  };
  const out = [];
  for (let s = 0; s < total - 1e-6; s += step) out.push(atS(s));
  out.push(en[en.length - 1]);
  return { pts: out, total };
}

// ── The marked lane ─────────────────────────────────────────────────────────

/**
 * Ride the Rule 9 lane along a BUOYED channel, spliced into a routed path.
 *
 * @returns {{path:Array, used:boolean, partial:boolean}}
 */
export function buoyChannelLane(pathLL, frame, ko, buf) {
  const nil = { path: pathLL, used: false, partial: false };
  if (!pathLL || pathLL.length < 2 || !ko || !ko.sys || !ko.sys.length) return nil;
  const en = pathLL.map((p) => frame.toEN(p));

  // INVARIANT 2. Densify the ROUTED path, find the stretch of it that actually
  // runs along a channel, and replace only that stretch.
  const SSTEP = Math.max(15, buf * 4);
  const rs = resampleEN(en, SSTEP);
  if (!rs) return nil;
  const base = rs.pts;
  if (base.length < 3) return nil;

  const proj = (pt, cl) => {
    let bd = 1e18, bu = 0, bh = 0;
    for (let i = 1; i < cl.length; i++) {
      const a = cl[i - 1], b = cl[i], dx = b.e - a.e, dy = b.n - a.n;
      const l2 = dx * dx + dy * dy || 1;
      let t = ((pt.e - a.e) * dx + (pt.n - a.n) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(pt.e - (a.e + t * dx), pt.n - (a.n + t * dy));
      if (d < bd) {
        bd = d; bu = (i - 1) + t;
        const ha = a.hw ?? 0, hb = b.hw ?? ha;
        bh = ha + (hb - ha) * t;
      }
    }
    return { d: bd, u: bu, hw: bh };
  };
  const clLen = (cl, u0, u1) => {
    let L = 0;
    const a = Math.min(u0, u1), b = Math.max(u0, u1);
    for (let i = Math.floor(a); i < Math.ceil(b) && i < cl.length - 1; i++) {
      const lo = Math.max(a, i) - i, hi = Math.min(b, i + 1) - i;
      L += Math.hypot(cl[i + 1].e - cl[i].e, cl[i + 1].n - cl[i].n) * (hi - lo);
    }
    return L;
  };

  // Pick the system the ROUTED PATH ACTUALLY RUNS ALONG — the longest stretch
  // of it inside a channel — rather than guessing from a boat-to-target straight
  // line. That is what the splice needs.
  let pick = null, qualified = 0;
  for (const sy of ko.sys) {
    const cl = laneCenterline(sy, ko);
    if (cl.length < 2) continue;
    let i0 = -1, i1 = -1;
    for (let i = 0; i < base.length; i++) {
      const q = proj(base[i], cl);
      // A transit running just outside the buoys is still using that channel — but
      // "just outside" is a fixed standoff, NOT a multiple of the channel's own width.
      // See LANE_CAPTURE_STANDOFF_M for the 681 m leg that became 829 m.
      if (q.d <= q.hw + LANE_CAPTURE_STANDOFF_M(buf)) { if (i0 < 0) i0 = i; i1 = i; }
    }
    if (i0 < 0 || i1 <= i0) continue;
    const runM = (i1 - i0) * SSTEP;
    if (runM < Math.max(120, buf * 30)) continue;              // a real stretch, not a brush past
    const qa = proj(base[i0], cl), qb = proj(base[i1], cl);
    if (clLen(cl, qa.u, qb.u) < 0.5 * runM) continue;          // ALONG the channel, not across it
    // ONE SYSTEM IS LANED PER LEG. A transit down two successive buoyed
    // channels rides the second dead on its centerline — the head-on position —
    // and nothing downstream could tell, because the flag only recorded "a lane
    // was ridden". Count what qualified so the caller can say `partial`.
    qualified++;
    if (!pick || runM > pick.runM) pick = { cl, i0, i1, runM };
  }
  if (!pick) return nil;
  const partialSystems = qualified > 1;
  const { cl, i0, i1 } = pick;
  const pa = proj(base[i0], cl), pb = proj(base[i1], cl);

  // INVARIANT 5. A real ENC channel may have 2–3 buoy pairs over kilometers,
  // which leaves ONE interior vertex whose tangent is computed from itself — a
  // zero-length starboard vector, so no offset is applied at all. Measured on
  // the live Erie channel: 7% starboard, mean −0.08·hw.
  const CSTEP = Math.max(15, buf * 5);
  const ptAt = (u) => {
    const i = Math.max(0, Math.min(cl.length - 2, Math.floor(u))), t = u - i;
    const a = cl[i], b = cl[i + 1], ha = a.hw ?? 0, hb = b.hw ?? ha;
    return { e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t, hw: ha + (hb - ha) * t };
  };
  const runLen = clLen(cl, pa.u, pb.u);
  const NS = Math.max(2, Math.ceil(runLen / CSTEP));
  const mids = [];
  for (let k = 0; k <= NS; k++) mids.push(ptAt(pa.u + (pb.u - pa.u) * (k / NS)));  // travel order
  if (mids.length < 2) return nil;

  const STANDOFF = Math.max(buf + 2, 6);
  const clearEN = (P, Q) => {
    const L = Math.hypot(Q.e - P.e, Q.n - P.n);
    const n = Math.max(1, Math.ceil(L / Math.max(2, buf / 2)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (blocked({ e: P.e + (Q.e - P.e) * t, n: P.n + (Q.n - P.n) * t }, ko, buf)) return false;
    }
    return true;
  };

  // INVARIANT 4, pass 1 — the largest offset whose POINT is in clear water.
  // On the inbound side of Erie the starboard half is shoal and 22 of 54 lane
  // points genuinely could not take the full quarter-width.
  const SBv = [], want = new Float64Array(mids.length);
  for (let i = 0; i < mids.length; i++) {
    const a = mids[Math.max(0, i - 1)], b = mids[Math.min(mids.length - 1, i + 1)];
    let te = b.e - a.e, tn = b.n - a.n;
    const tl = Math.hypot(te, tn) || 1; te /= tl; tn /= tl;
    SBv.push([tn, -te]);                                    // starboard of travel
    const hw = mids[i].hw ?? 0;
    const at = (o) => ({ e: mids[i].e + tn * o, n: mids[i].n - te * o });
    let off = Math.min(hw * LANE_FRAC, Math.max(0, hw - STANDOFF)), k = 0;
    while (off > 0.5 && blocked(at(off), ko, buf) && k < 12) { off *= 0.7; k++; }
    want[i] = blocked(at(off), ko, buf) ? 0 : off;
  }
  // Pass 2 — SLEW-LIMIT so the lane eases in and out of foul stretches instead
  // of stepping. A step between neighbors laid a rung across a shoal corner;
  // a one-way forward sweep was sticky and collapsed the whole lane downstream
  // of the first tight spot (the inbound lane kept 54 of ~190 points). Both
  // passes only ever REDUCE, so no point is pushed past the clear-water limit.
  const segLen = runLen / Math.max(1, mids.length - 1), gSlew = 0.25 * segLen;
  for (let i = 1; i < mids.length; i++) want[i] = Math.min(want[i], want[i - 1] + gSlew);
  for (let i = mids.length - 2; i >= 0; i--) want[i] = Math.min(want[i], want[i + 1] + gSlew);

  const lane = [];
  for (let i = 0; i < mids.length; i++) {
    const p = { e: mids[i].e + SBv[i][0] * want[i], n: mids[i].n + SBv[i][1] * want[i] };
    lane.push(blocked(p, ko, buf) ? { e: mids[i].e, n: mids[i].n } : p);
  }
  if (!lane.length) return nil;

  // INVARIANT 2, the splice: routed approach + lane + routed departure.
  const post = base.slice(i1 + 1);
  if (!post.length) post.push(en[en.length - 1]);
  const seq = [en[0], ...base.slice(1, i0), ...lane, ...post];

  // INVARIANT 3. Verify every leg. A blocked one is re-routed; if it cannot be,
  // or the lane needs more than a couple of rescues (meaning it does not fit
  // this path), abandon the lane and hand back the routed path untouched.
  let rescues = 0;
  const out = [{ lon: pathLL[0].lon, lat: pathLL[0].lat }];
  for (let i = 0; i < seq.length - 1; i++) {
    const Pp = seq[i], Qp = seq[i + 1], Qll = frame.fromEN(Qp.e, Qp.n);
    if (clearEN(Pp, Qp)) { out.push({ lon: Qll.lon, lat: Qll.lat }); continue; }
    if (++rescues > 3) return nil;
    const sub = legPath(frame.fromEN(Pp.e, Pp.n), Qll, frame, ko, buf);
    if (!(sub && sub.length)) return nil;
    for (const p of sub) out.push({ lon: p.lon, lat: p.lat });
  }
  // A RESCUE IS AN UN-LANED PATCH: legPath's detour is lawful but carries no
  // starboard bias, so a lane that needed rescuing was not delivered end to end.
  //
  // ⚠⚠ AND AN OFFSET OF ZERO IS THE CENTERLINE - THE HEAD-ON POSITION - SO `used` MAY NOT
  // CLAIM A LANE THE GEOMETRY NEVER DELIVERED. `want[i]` reaches 0 two ways: the shrink loop
  // above can exit on `k < 12` with `off` still blocked, and pass 2's slew limit can drag a
  // neighbor down to it. Either way the lane point collapses ONTO the centerline while
  // `used: true` had the page banner "routed to starboard of the channel centerline
  // (Rule 9)" - a claim of keeping right, made about a route sitting exactly where a head-on
  // meeting happens. The two-system guard above counts SYSTEMS; this is the same failure one
  // level down, counted per POINT.
  //
  // STANDOFF / 2 is the "is this a lane at all" floor rather than a bare `> 0`, because the
  // shrink loop can also leave a near-zero survivor - off = 0.519 m when the final `blocked`
  // happens to clear - which is a centerline route by any operational reading.
  const flat = want.reduce((a, w) => a + (w > STANDOFF / 2 ? 0 : 1), 0);
  if (flat === want.length) return nil;    // nothing delivered: hand back the routed path
  return { path: out, used: true,
           partial: partialSystems || rescues > 0 || flat > want.length / 4 };
}

// ── The unmarked lane ───────────────────────────────────────────────────────

/**
 * The SAME rule in unmarked water.
 *
 * A channel does not stop being a channel because nobody buoyed it — a basin
 * exit, a canal, a dredged cut between banks all get identical treatment. Here
 * the centerline comes from the WATER ITSELF: march perpendicular to travel to
 * the first obstruction each side, and the local center is `(RC−LC)/2` to
 * starboard with half-width `(RC+LC)/2`.
 *
 * Fires ONLY where BOTH edges answer within `CONFINE` — genuinely channel-like
 * confined water, which is exactly where an edge march is trustworthy. Open
 * water and a single bank are left alone.
 */
export function narrowChannelLane(pathLL, frame, ko, buf, opts = {}) {
  const nil = { path: pathLL, used: false };
  if (!pathLL || pathLL.length < 2 || !ko) return nil;
  const en = pathLL.map((p) => frame.toEN(p));

  // Kept FINER than the emitted waypoint spacing on purpose: this is the
  // resolution the channel is MEASURED at, and a winding cut has short confined
  // stretches a coarse sampling steps straight over. `smoothTrack` thins after.
  const STEP = Math.max(25, buf * 7);
  // A WIDENING KNOB IS A MAXIMUM, NEVER A SUBSTITUTE. `channelReachM` exists to
  // reach FURTHER than the tight default; wiring it as `override ?? buf*30`
  // made it a replacement, and a hull whose value sat below its own `buf*30`
  // had the search silently narrowed — stretches flipped between laned and
  // unlaned with the water level.
  const CONFINE = Math.max(120, buf * 30, opts.channelReachM ?? 0);
  const STANDOFF = Math.max(buf + 2, 6);
  const MS = Math.max(2, buf / 2);

  const rs = resampleEN(en, STEP);
  if (!rs || !(rs.total > 3 * STEP)) return nil;
  const samp = rs.pts;
  const N = samp.length;
  if (N < 4) return nil;

  // Stretches already laned off the buoys are left exactly as they are — the
  // SAME extended centerline, so the stand-on past a mouth is recognized as
  // buoy-laned water and is not re-laned off the banks.
  const cls = (ko.sys || []).map((sy) => laneCenterline(sy, ko)).filter((cl) => cl.length >= 2);
  const inBuoyChannel = (p) => {
    for (const cl of cls) {
      for (let i = 1; i < cl.length; i++) {
        const a = cl[i - 1], b = cl[i], dx = b.e - a.e, dy = b.n - a.n;
        const l2 = dx * dx + dy * dy || 1;
        let t = ((p.e - a.e) * dx + (p.n - a.n) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(p.e - (a.e + t * dx), p.n - (a.n + t * dy));
        if (d < Math.max(a.hw || 0, b.hw || 0) * 1.3) return true;
      }
    }
    return false;
  };

  // WHERE THE CHART SAYS A CHANNEL IS. `ko.chans` is built by channelPolys from
  // S-57 FAIRWY and DRGARE plus the buoy gates — the objects COLREGS Rule 9 is
  // actually written about. This is the applicability test for the rule; see the
  // note at its use below for what it replaced and why.
  const chans = ko.chans || [];
  const inChartedChannel = (p) => {
    for (const c of chans) if (inBB(p, c.bb, 0) && pinp(p, c.ring)) return true;
    return false;
  };

  // INVARIANT 1. A lone buoy read as a channel edge shoved the track toward the
  // real wall opposite, then jogged it back as the buoy passed astern — seen
  // live as a loop by the breakwater on an RTH. The full `ko` is still used for
  // every clearance check below, so the lane never plans onto a buoy.
  const koWall = {
    polys: ko.polys || [], lines: ko.lines || [],
    points: (ko.points || []).filter((p) => p.kind !== 'a channel buoy'),
  };
  const march = (s, de, dn) => {
    for (let d = MS; d <= CONFINE; d += MS) {
      if (blocked({ e: s.e + de * d, n: s.n + dn * d }, koWall, buf)) return d;
    }
    return Infinity;
  };

  const SB = [], shift = new Float64Array(N), have = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const a = samp[Math.max(0, i - 1)], b = samp[Math.min(N - 1, i + 1)];
    let te = b.e - a.e, tn = b.n - a.n;
    const tl = Math.hypot(te, tn) || 1; te /= tl; tn /= tl;
    SB.push([tn, -te]);
    if (i === 0 || i === N - 1 || inBuoyChannel(samp[i])) continue;
    // ⚠⚠ RULE 9 APPLIES ONLY WITHIN A NARROW CHANNEL OR FAIRWAY, AND THE CHART
    // SAYS WHERE THOSE ARE. This gate is the whole of Andy's 2026-08-31
    // correction: "Rule 9 is being improperly applied ... It applies only within
    // narrow channels. ... In open bay or open ocean transits and while running
    // various survey patterns the rule should not be considered."
    //
    // What stood here was the ray-march below ON ITS OWN: if anything answered
    // within CONFINE on both sides, this was called a channel. CONFINE is
    // max(120, buf*30) — 150 m at the shipped buffer — so any water with banks
    // 300 m apart got a keep-right lane. That is not a narrow channel, it is most
    // of a bay, and the console was riding a lane down the middle of open water
    // while telling the operator it was complying with a rule of the road.
    //
    // A narrow channel is not a shape you can infer from two distances. It is a
    // CHARTED OBJECT — S-57's FAIRWY and DRGARE, which `channelPolys` collects,
    // plus the buoyed lateral system that `inBuoyChannel` above already handles.
    // So the march no longer decides WHETHER there is a channel; it only measures
    // the edges of one the chart has already declared. Every one of the six lane
    // invariants is untouched: this is SCOPE, not geometry.
    //
    // NO CHARTED CHANNEL, NO LANE — including where the chart simply has none for
    // this area. That is the honest answer rather than the safe-looking one: the
    // console cannot know a channel is there if nothing charts it, and inventing
    // one from two shorelines is precisely the fault being fixed.
    const rc = march(samp[i], tn, -te), lc = march(samp[i], -tn, te);
    if (!(rc < Infinity && lc < Infinity)) continue;   // no measurable edges ⇒ no offset to build
    // THE TEST IS "IS THIS A NARROW CHANNEL", AND IT HAS TWO WAYS TO BE TRUE.
    // Either the CHART says so — FAIRWY / DRGARE / a buoyed lateral system, the
    // objects Rule 9 is written about — or the water is genuinely narrow enough
    // that a large vessel can navigate safely only within it, which is Rule 9(b)'s
    // own words and does not require anything to be charted at all. A 100 m cut
    // between two banks is a narrow channel whether or not an ENC draws a fairway
    // over it; a 300 m bay is not, whatever its shape.
    if (!(inChartedChannel(samp[i]) || rc + lc <= NARROW_MAX_M)) continue;
    const hw = (rc + lc) / 2, ctr = (rc - lc) / 2;
    let d = ctr + LANE_FRAC * hw;
    d = Math.min(d, rc - STANDOFF);
    d = Math.max(d, -(lc - STANDOFF));
    if (Number.isFinite(d)) { shift[i] = d; have[i] = 1; }
  }

  // Blend, but ONLY across samples that actually measured a channel. Averaging
  // in the zeros of non-channel neighbors halved the lane in a short confined
  // stretch — 15/13/20 m of shift washed down to ~10 on the Canal Basin exit.
  const sm = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (!have[i]) continue;
    let s = 0, c = 0;
    for (let k = -1; k <= 1; k++) {
      const j = i + k;
      if (j >= 0 && j < N && have[j]) { s += shift[j]; c++; }
    }
    sm[i] = s / c;
  }
  sm[0] = 0; sm[N - 1] = 0;                            // pin the ends

  const out = [];
  for (let i = 0; i < N; i++) {
    let d = sm[i];
    let p = { e: samp[i].e + SB[i][0] * d, n: samp[i].n + SB[i][1] * d };
    let k = 0;
    while (Math.abs(d) > 0.5 && blocked(p, ko, buf) && k < 8) {
      d *= 0.6;
      p = { e: samp[i].e + SB[i][0] * d, n: samp[i].n + SB[i][1] * d };
      k++;
    }
    out.push(blocked(p, ko, buf) ? samp[i] : p);
  }
  const used = out.some((p, i) => Math.abs(sm[i]) > 0.5);
  return { path: out.map((p) => frame.fromEN(p.e, p.n)), used };
}

// ── Finishing ───────────────────────────────────────────────────────────────

/**
 * Resample and gently round a coarse waypoint list into a followable track.
 *
 * A buoy-pair centerline has one point per pair, so a bare path dog-legs at
 * each bend. Two steps: resample by ARC LENGTH onto ~STEP-spaced points that lie
 * exactly on the input polyline (so straight runs stay dead on it), then two
 * light [0.25, 0.5, 0.25] passes — identity on a straight run, so only the bends
 * round, and a point that would smooth into a keep-out is left alone.
 *
 * Resampling per SEGMENT rather than by arc length could only ever ADD points
 * (a sub-STEP segment still emitted one), so STEP was not actually a count dial.
 * It is now: STEP is the single waypoint-density control.
 */
export function smoothTrack(pathLL, frame, ko, buf) {
  if (!pathLL || pathLL.length < 2) return pathLL;
  const en = pathLL.map((p) => frame.toEN(p));
  const STEP = Math.max(45, buf * 13);
  const rs = resampleEN(en, STEP);
  if (!rs) return pathLL;
  let pts = rs.pts;
  if (pts.length < 3) return pathLL;
  const hit = (e, n) => blocked({ e, n }, ko, buf);
  for (let pass = 0; pass < 2; pass++) {
    const np = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const s = {
        e: 0.25 * pts[i - 1].e + 0.5 * pts[i].e + 0.25 * pts[i + 1].e,
        n: 0.25 * pts[i - 1].n + 0.5 * pts[i].n + 0.25 * pts[i + 1].n,
      };
      np.push(hit(s.e, s.n) ? pts[i] : s);
    }
    np.push(pts[pts.length - 1]);
    pts = np;
  }
  return pts.map((p) => frame.fromEN(p.e, p.n));
}

/**
 * THE GATE: no route leaves the lane pipeline without passing the same
 * `legClear` the obstacle search obeyed.
 *
 * Found at Erie: `legPath` routed clear of every keep-out, then the lane
 * replaced that route with geometry which — where the charted channel hugs the
 * waterfront — crossed the seawall's land polygon in three places. Nothing
 * re-checked the substitution, so the banner reported a route that no longer
 * existed. THE LANE IS A PREFERENCE; THE KEEP-OUT MODEL IS LAW.
 *
 * A failing stretch is re-routed and spliced, so the lane survives everywhere it
 * is lawful. If the law cannot patch it, the pre-lane input ships instead (it
 * was router-clear by construction) and `abandoned` tells the caller the Rule 9
 * claim would be a lie.
 *
 * ⚠⚠ THE ENDPOINT EXEMPTION IS ABOUT THE ENDPOINT, NOT ABOUT THE BLOCK, AND IT USED TO
 * BE THE OTHER WAY ROUND. A vessel moored inside the buffer must still be led out, and an
 * arrival can end at a dock — so a block near such an endpoint is tolerated. But the test
 * was only "is the block within 2·buf of an endpoint", which says nothing at all about
 * whether that endpoint is anywhere it should not be.
 *
 * Measured at New Castle across 475 Go-To routes from one spawn: `legPath` never shipped a
 * fouling leg (0 of 475), and ONE shipped route passed 0.47 m FROM A CHARTED PIER WITH A 3 m
 * BUFFER SET. The chain was `narrowChannelLane` moving it 3.45 → 2.63 m, `smoothTrack`
 * taking it to 0.47 m (it tests whether the moved VERTEX is blocked and never the legs to
 * and from it), and then this gate — whose whole job is to catch exactly that — waving it
 * through, because the block sat 5.8 m from the goal against a 6 m radius. NEITHER ENDPOINT
 * WAS IN THE BUFFER: the destination had 3.45 m of clear water round it.
 *
 * So the exemption now requires the endpoint ITSELF to be blocked. The moored-boat and
 * arrive-at-a-dock cases are untouched — those endpoints ARE in the buffer, which is the
 * whole reason they need leading out of — and a tight pass that merely happens to fall near
 * the end of a route is spliced like any other.
 *
 * A spliced patch is the router's own product and is NOT re-checked: the gate exists to
 * catch the lane's inventions, and re-checking a patch whose ends sit in-buffer would loop.
 */
export function gateLegClear(route, fallback, frame, ko, buf) {
  if (!route || route.length < 2) return { route, abandoned: false, splices: 0 };
  const start = route[0], goal = route[route.length - 1];
  const near = (at, P) => frame.distTo(at, P) <= buf * 2;
  // Asked ONCE, and they are the whole of the exemption's warrant - see the note above.
  const startIn = blocked(frame.toEN(start), ko, buf);
  const goalIn = blocked(frame.toEN(goal), ko, buf);
  const out = route.slice();
  let splices = 0;
  for (let i = 1; i < out.length;) {
    if (legClear(out[i - 1], out[i], frame, ko, buf)) { i++; continue; }
    const hit = firstBlockAlong(out[i - 1], out[i], frame, ko, buf)?.at;
    if (hit && ((startIn && near(hit, start)) || (goalIn && near(hit, goal)))) { i++; continue; }
    if (++splices > 20) return { route: fallback.slice(), abandoned: true, splices };
    let j = i;
    while (j < out.length - 1 && !legClear(out[j], out[j + 1], frame, ko, buf)) j++;
    const patch = legPath(out[i - 1], out[j], frame, ko, buf);
    if (!patch) return { route: fallback.slice(), abandoned: true, splices };
    out.splice(i, j - i + 1, ...patch);
    i += patch.length;
  }
  return { route: out, abandoned: false, splices };
}


/**
 * The whole pipeline: marked lane, then unmarked lane, then smooth, then the
 * gate, then the knot prune.
 *
 * THE KNOT PRUNE LIVES IN THE PRODUCER. A gate SPLICE SEAM can fold a reversal
 * knot — the patch rejoins the lane a few meters BEHIND where it left, and the
 * shipped route then demands a ~180° turn in less water than any hull can turn
 * in. Flown at Lewes as a full 360° orbit at the mouth of Roosevelt Inlet.
 * Pruning here means every consumer inherits it, the same producer-not-consumers
 * rule as the gate itself.
 *
 * @returns {{route:Array, lane:boolean, partial:boolean}} `partial` = a lane was
 *   ridden but NOT over every channel this route ran along.
 */
export function channelLaneRoute(pathLL, frame, ko, buf, opts = {}) {
  // ⚠ `opts.lane === false` RUNS THE PIPELINE WITHOUT RULE 9, and that is not the
  // same as not calling this function. Andy, 2026-08-31: "while running various
  // survey patterns the rule should not be considered" - but the four stages after
  // the lane are nothing to do with Rule 9 and a pattern needs every one of them:
  // smoothTrack thins the route, gateLegClear RE-CHECKS EVERY LEG against the
  // keep-out model, and pruneStitch removes the reversal knots a gate splice can
  // fold in (the seam that once sent the boat a 176-degree turn in 4.5 m). Skipping
  // the call to avoid the lane would silently drop a safety re-check to buy a legal
  // correction, so the lane is what gets skipped instead.
  const laneWanted = opts.lane !== false;
  const marked = laneWanted ? buoyChannelLane(pathLL, frame, ko, buf)
                            : { path: pathLL, used: false };
  const unmarked = laneWanted ? narrowChannelLane(marked.path, frame, ko, buf, opts)
                              : { path: marked.path, used: false };
  const smoothed = smoothTrack(unmarked.path, frame, ko, buf);
  const g = gateLegClear(smoothed, pathLL, frame, ko, buf);
  const clean = pruneStitch(g.route, frame, ko, buf);
  const used = (marked.used || unmarked.used) && !g.abandoned;
  return {
    route: clean,
    lane: used,
    partial: (marked.partial || g.splices > 0) && used,
  };
}

// ── The survey's own channel rules ──────────────────────────────────────────

/**
 * SURVEY COVERAGE ONLY: if a survey line SPANS ACROSS a channel, that channel
 * becomes a keep-out so the coverage lines clip out of it.
 *
 * "Spans across" = a line runs OUTSIDE → INSIDE → OUTSIDE again. A survey
 * CONTAINED within the channel excludes nothing — surveying a channel is a
 * normal thing to be asked for. The channel is often FRAGMENTED into adjacent
 * polygons, so a sample counts as inside if it is inside ANY of them; internal
 * poly-to-poly boundaries are not crossings.
 *
 * This augments ONLY the coverage clip, never the transit routing.
 */
export function channelSpanKeepouts(src, frame, feats, marks) {
  const chans = channelPolys(frame, feats, marks);
  if (!chans.length) return [];
  const inChan = (p) => {
    for (const c of chans) if (inBB(p, c.bb, 0) && pinp(p, c.ring)) return true;
    return false;
  };
  // THE ATTRIBUTION IS PER LINE, NOT ONE GLOBAL FLAG. This used to compute a
  // single `spans` boolean over every line and then exclude every channel ANY
  // line so much as entered — so a survey whose lines crossed a narrow entrance
  // channel ALSO lost a turning basin it was only ever surveying along the
  // inside of, with the note misattributing it as spanned. The stated rule is
  // "a channel is excluded only if a line CROSSES it": only the lines that
  // themselves span carry the exclusion, and a channel entered solely by
  // contained lines stays surveyable.
  //
  // The span test stays over the UNION of polygons (adjacent fragments of one
  // channel are not crossings), so a spanning line that merely ENDS inside a
  // second channel still excludes it — erring toward exclusion, which is the
  // visible direction: clipped coverage is a note on the card, a wrongly kept
  // line is a survey lane through traffic.
  const spanning = [];
  for (const l of src) {
    const samples = segSamplesEN(l, frame);
    let seenOut = false, inAfterOut = false, outAfterIn = false, inRun = false;
    for (const p of samples) {
      if (inChan(p)) { if (seenOut) inAfterOut = true; inRun = true; } else {
        if (inRun) outAfterIn = true;
        seenOut = true; inRun = false;
      }
    }
    if (inAfterOut && outAfterIn) spanning.push(samples);
  }
  if (!spanning.length) return [];
  const out = [];
  for (const c of chans) {
    let crossed = false;
    for (const samples of spanning) {
      for (const p of samples) {
        if (inBB(p, c.bb, 0) && pinp(p, c.ring)) { crossed = true; break; }
      }
      if (crossed) break;
    }
    if (crossed) out.push({ ring: c.ring, bb: c.bb, kind: 'a navigation channel' });
  }
  return out;
}

/**
 * TURN WATER: a reversal turn may only use channel water the survey's own
 * coverage lines occupy.
 *
 * Channel polygons containing NO sample of any CLIPPED coverage line become
 * keep-outs for the turns and the serpentine ordering — never for routed
 * region-hop transits, which may lawfully cross a channel under the lane.
 *
 * The grant is PER POLYGON and deliberately strict: a wrongly REFUSED turn is a
 * visible straight-hop flag, while a wrongly GRANTED one is a silent excursion
 * into traffic. The rule exists because generated teardrops arced 34 m into the
 * Lewes channel across a charted pile row — piles are charted as POINTS ~60 m
 * apart, so the arc threaded their keep-out disks perfectly lawfully.
 */
export function channelTurnKeepouts(clipped, frame, feats, marks) {
  const chans = channelPolys(frame, feats, marks);
  if (!chans.length) return [];
  const out = [];
  for (const c of chans) {
    let entered = false;
    for (const l of clipped) {
      for (const p of segSamplesEN(l, frame)) {
        if (inBB(p, c.bb, 0) && pinp(p, c.ring)) { entered = true; break; }
      }
      if (entered) break;
    }
    if (!entered) out.push({ ring: c.ring, bb: c.bb, kind: 'a navigation channel' });
  }
  return out;
}

/** A keep-out view with extra polygons folded in, for the survey rules above. */
export const withChannelKeepouts = (ko, extra) =>
  (extra && extra.length ? { ...ko, polys: [...ko.polys, ...extra] } : ko);
