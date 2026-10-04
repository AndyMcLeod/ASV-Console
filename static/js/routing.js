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
 *
 * ⚠ AND SINCE 2026-10-03/04 IT CARRIES LANE STAGES asv_core DOES NOT HAVE:
 *     `chartOwnership` / `chartedChannelLane` / `chartedRide` - the Rule 9 lane
 *       across a CHARTED fairway or dredged area, measured on the chart's own
 *       polygon, run LAST and overriding only the water it rides, and what it
 *       delivered measured on the route that ships;
 *     `markPassRoute` / `marksKept` - lateral marks in water the chart does not
 *       ride, each left on its proper hand, a buoy kept to starboard passed close;
 *   with `buoyChannelLane` returning the stretch it rode (`laned`, `others`; its
 *   capture is as it was), `smoothTrack` and `pruneStitch` taking a `keep` list,
 *   and `channelLaneRoute` returning `how`, `marks` and `keep` beside `lane` and
 *   `partial`. Covered by tests/enc_channel.js and tests/buoy_lane.js.
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
 *
 * `opts.keep` (2026-10-04): EN points never dropped - the run past a lateral mark. Where two
 * runs met it dropped a pass point, and buoy 4 shipped 5-14 m on her wrong hand.
 */
export function pruneStitch(full, frame, ko, buf, opts = {}) {
  const out = full.slice();
  const keep = opts.keep || [];
  const kept = (p) => {
    if (!keep.length) return false;
    const q = frame.toEN(p);
    return keep.some((k) => Math.hypot(k.e - q.e, k.n - q.n) < 0.75);
  };
  const turnOf = (r, j) => Math.abs(((frame.azTo(r[j], r[j + 1]) - frame.azTo(r[j - 1], r[j]) + 540) % 360) - 180);
  const near = (r, a, b) => { let m = 0; for (let q = Math.max(1, a); q <= Math.min(r.length - 2, b); q++) m = Math.max(m, turnOf(r, q)); return m; };
  const STUB_M = Math.max(20, 5 * buf);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      if (turnOf(out, i) <= 60) continue;
      if (!kept(out[i]) && legClear(out[i - 1], out[i + 1], frame, ko, buf)) {
        out.splice(i, 1);
        changed = true;
        break;
      }
      // ⚠ A STUB BESIDE IT (`opts.stubs`: the Rule 9 lane's routes only - the router's own
      // stitches and a maneuver's lane prune as they always did). Where the sharp vertex cannot
      // go (it is kept, or the corner it would cut is foul) a neighbor a grid cell or two off it
      // (STUB_M) can, if that leg is clear and the sharpest turn there falls. Where the gate
      // rejoined a patch a 3 m stub was left before a 99 degree turn (seeded fuzz, 19.5 m
      // standoff); without it the turn is 48.
      if (!opts.stubs) continue;
      for (const j of [i - 1, i + 1]) {
        if (j < 1 || j > out.length - 2 || kept(out[j]) || frame.distTo(out[j], out[i]) > STUB_M) continue;
        if (!legClear(out[j - 1], out[j + 1], frame, ko, buf)) continue;
        const trial = out.slice(0, j).concat(out.slice(j + 1));
        if (near(trial, j - 2, j + 1) < near(out, j - 2, j + 2)) { out.splice(j, 1); changed = true; break; }
      }
      if (changed) break;
    }
  }
  return out;
}

/** How near a keep-out a leg into (or out of) an endpoint inside the margin may come, beyond the blocked water the
 *  endpoint itself lies in: through none of it (see legPath). */
export const END_CLEAR_M = 0.05;

/** The leg P->Q is clear at `r` but for the blocked water contiguous with P (`pIn`) or with Q (`qIn`): sampled to find
 *  those runs, the rest asked with the exact `legClear`. */
export function clearButEnds(P, Q, frame, ko, r, pIn, qIn) {
  const a = frame.toEN(P), b = frame.toEN(Q), n = Math.max(1, Math.ceil(Math.hypot(b.e - a.e, b.n - a.n) / 0.25));
  const s = (k) => ({ e: a.e + (b.e - a.e) * k / n, n: a.n + (b.n - a.n) * k / n });
  let lo = 0, hi = n;
  if (pIn) while (lo <= hi && blocked(s(lo), ko, r)) lo++;
  if (qIn) while (hi >= lo && blocked(s(hi), ko, r)) hi--;
  if (lo > hi) return true;
  if (lo === 0 && hi === n) return legClear(P, Q, frame, ko, r);
  const p = s(lo), q = s(hi);
  return legClear(frame.fromEN(p.e, p.n), frame.fromEN(q.e, q.n), frame, ko, r);
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
 *
 * ⚠ AN ENDPOINT INSIDE THE MARGIN IS SNAPPED TO A FREE CELL, AND THE LEG FROM THAT CELL TO
 * IT IS ASKED (`ends`): it may run through no keep-out but the blocked water the endpoint
 * itself lies in (`clearButEnds`, at END_CLEAR_M). The cell nearest a goal 9.8 m off the shore,
 * inside a 19.5 m standoff, lay on the far side of a point of land, and the last 62 m leg ran
 * over 12 m of it - shipped to the vessel as a resume-from-here. Refused here, the search goes
 * on up the ladder; refused at every rung, the leg is unroutable at this margin, and the
 * planners route it at the buffer.
 */
export function legPath(A, B, frame, ko, buf, opts = {}) {
  if (legClear(A, B, frame, ko, buf)) return [{ lon: B.lon, lat: B.lat }];
  const aIn = blocked(frame.toEN(A), ko, buf), bIn = blocked(frame.toEN(B), ko, buf);
  const ends = (pts) => {
    if (!pts || !pts.length) return null;
    if (aIn && !clearButEnds(A, pts[0], frame, ko, END_CLEAR_M, true, false)) return null;
    if (bIn && !clearButEnds(pts.length > 1 ? pts[pts.length - 2] : A, B, frame, ko, END_CLEAR_M, false, true)) return null;
    return pts;
  };

  const via = routeAroundSeg(A, B, frame, ko, buf);
  if (via && via.length) {
    const r = ends([...via.map((p) => ({ lon: p.lon, lat: p.lat })), { lon: B.lon, lat: B.lat }]);
    if (r) return r;
  }

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

  // `opts.quick` (the marks stage's legs out to a pass point and back): one wider region and
  // no escape. A leg that needs more is not one worth having, and a search bounded by its
  // regions, not by a clock, gives the same answer on a busy machine as on an idle one.
  if (opts.quick) {
    const q = routeAround(A, B, frame, ko, buf, 2700, 2000);
    return q ? ends(compose([A, ...q, B])) : null;
  }
  let c = wide(A, B);                                        // (1) wider regions
  if (c) { const r = ends(compose([A, ...c, B])); if (r) return r; }

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
    if (c2) { const r = ends(compose([A, ...e1, E, ...c2, B])); if (r) return r; }
  }
  for (const F of ringB) {                                   // (3) a tight GOAL
    if (spent()) break;
    const f1 = fromF(F);
    if (!f1) continue;
    const c2 = wide(A, F);
    if (c2) { const r = ends(compose([A, ...c2, F, ...f1, B])); if (r) return r; }
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
      if (c2) { const r = ends(compose([A, ...e1, E, ...c2, F, ...f1, B])); if (r) return r; }
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
  return { pts: out, total, at: atS };
}

// ── The marked lane ─────────────────────────────────────────────────────────

/**
 * Ride the Rule 9 lane along a BUOYED channel, spliced into a routed path.
 *
 * ⚠ ITS CAPTURE IS AS IT ALWAYS WAS (2026-10-04). A first cut stopped it capturing in charted
 * water, so that the chart's lane could have it; where the chart's lane then declined that
 * water (a side channel opening abeam, a basin) nothing laned her at all - outbound at Pearl
 * Harbor she went 54 m to port of the buoy line this lane had held her 91-97 m to starboard of.
 * The chart's lane now runs after it and overrides only the water it rides (`chartOwnership`),
 * which also undoes what this lane makes of a charted channel's buoys (it once replaced 3.5 km
 * of the charted Piscataqua with the buoy centerline, to within 0.05 of the port edge).
 *
 * @returns {{path:Array, used:boolean, partial:boolean, patchy:boolean, laned:?object,
 *            others:Array}} `laned` is the system ridden and the stretch of its centerline
 *   the lane was built on; `others` are the systems that qualified and were NOT ridden;
 *   `patchy` is the part of `partial` that is about this lane's own delivery.
 */
export function buoyChannelLane(pathLL, frame, ko, buf, opts = {}) {
  const nil = { path: pathLL, used: false, partial: false, patchy: false, laned: null, others: [] };
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
  let pick = null;
  const qualified = [];
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
    qualified.push(sy);
    if (!pick || runM > pick.runM) pick = { cl, i0, i1, runM, sy };
  }
  if (!pick) return nil;
  const partialSystems = qualified.length > 1;
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
  const patchy = rescues > 0 || flat > want.length / 4;
  return { path: out, used: true, partial: partialSystems || patchy, patchy,
           laned: { sys: pick.sy, cl, u0: Math.min(pa.u, pb.u), u1: Math.max(pa.u, pb.u) },
           others: qualified.filter((sy) => sy !== pick.sy) };
}

// ── The chart's own channels, and the marks that stand alone ─────────────────
//
// ⚠⚠ THE CHART COMES FIRST, THE BUOYS SECOND (Andy, 2026-10-03, on a Go-To from New Castle
// up the Piscataqua to Adams Point: "the ASV does not run to the right side of the ENC
// marked channel for most of the run. It seems to run to the right of a channel only when
// there are buoy pairs. Any given ASV should recognize a channel from the ENC before
// relying on buoy placement." And of the buoys: "using the red-right-returning paradigm a
// vessel should keep red buoys to the right and green buoys to the left when returning to
// port. Often this means keeping the buoy close to the track rather than at great
// distance ... Often, there are not paired buoys but single buoys of a particular color.").
//
// MEASURED on that route, replayed on his chart: 5.5 km of its 18 km lies in a charted
// fairway (Badgers Island to the Turning Basin). A charted polygon only ever decided
// WHETHER the unmarked lane might fire; the lane's edges came from the banks, both of which
// had to answer within max(120, buf*30) m, and the Piscataqua is wider than that. So no
// lane was built in the charted channel at all, and on its bends the route lay along the
// PORT edge (0.03 to 0.11 of the way across).
//
// HIS THREE CALLS, asked before any of this was written: a channel on the ENC is a charted
// Fairway or Dredged Area and nothing else (not the deep-water band); where none is charted
// the buoys shape the route, singles included; and a buoy kept to starboard is passed at
// 10 m, or twice the buffer where that is more.
//
// ⚠⚠ THE SHAPE OF IT (v3, 2026-10-04), AND WHY. The first cut (v2) made every other stage
// STAND DOWN wherever a point lay inside a charted ring, then laid the chart's lane over
// what was left, pinned to the routed path wherever it declined a sample. Its review found
// that wrong at the root: the chart's lane declines a sample wherever side water opens
// abeam (a side channel, a berth, a basin, a sharp bend), and then NOTHING laned her there -
// Pearl Harbor outbound went 54 m to port of the buoy line the old pipeline held 91-97 m to
// starboard of. So now:
//   1. the pair lane and the unmarked lane run EXACTLY as they did before any of this;
//   2. `chartOwnership` decides which samples the chart's lane RIDES - measured, not
//      point-in-ring - carrying the edges over an opening or a short gap between rings;
//   3. the marks stage keeps the marks of the water the chart does NOT ride (in a wide
//      fairway or a basin it declines, too);
//   4. the chart's lane runs LAST and overrides only the samples it owns, leaving every
//      other vertex of the path where the stages before put it;
//   5. what it delivered is measured on the route that SHIPS (`chartedRide`), and a lane it
//      did not deliver is said (PARTIAL), never claimed.

/** How far a charted channel is marched for, across her track or along it, in meters. */
export const CHART_MARCH_MAX_M = 2000;

/**
 * How far OUTSIDE a charted channel a path may run between two stretches of it and still be
 * following it, in meters.
 *
 * The router takes the inside of a bend. At Boiling Rock the Go-To above ran 13 to 90 m
 * outside the charted fairway for 1.7 km between two stretches inside it, further than the
 * 60 m a path beside a channel is captured at (LANE_CAPTURE_STANDOFF_M), so the lane would
 * have let go of her round the whole bend. A path that leaves a channel and never comes back
 * to it is not bridged: only the water BETWEEN two stretches of the channel is.
 */
export const CHART_BRIDGE_REACH_M = 200;

/**
 * "PROCEEDING ALONG THE COURSE OF" A CHANNEL (Rule 9(a)'s own words): the charted water must
 * run this many times further ALONG her track than it does ACROSS it.
 *
 * A path crossing a fairway is in it too, and so is one cutting a corner of a turning basin
 * on its way somewhere else. Shifting either to the starboard quarter slides it hundreds of
 * meters along the channel. 1.5 is a track within about 34 degrees of the channel's axis.
 */
export const CHART_ALONG_RATIO = 1.5;

/** The steepest a lane may ease across her track: lateral meters per meter along. */
export const LANE_SLEW = 0.35;

/**
 * THE EDGES ARE CARRIED OVER WATER THE MEASUREMENT CANNOT READ, up to this far, in meters.
 *
 * ⚠ THIS IS THE FIX FOR THE BLOCKING FINDING. Measured across her track, a fairway with a side
 * channel, a berth, a turning basin or a sharp bend opening off it reads as kilometers wide,
 * so it fails the "along" test and the first cut let go of her there and eased her back onto
 * the routed path for ~370 m each side: through a synthetic T-junction she ran 630 m west of
 * the centerline, past five berths 2,995 m of 3,000, and outbound at Pearl Harbor she went
 * 54 m to PORT of the buoy line. The channel's two edges either side of an opening are where
 * they were; the lane is carried across it on the edges measured before and after it.
 */
export const CHART_INTERP_M = 600;

/** ... of which this much may lie outside charted water altogether: a gap between two rings
 *  end to end (22 m dropped the first cut's lane for 455 m). */
export const CHART_GAP_M = 200;

/**
 * A SIDE OPENS where it stands further out than that side's median over the window round it
 * by this much (CHART_OPENING_M, or this fraction of the median width where that is more).
 * Such a sample is read as an opening and carried over like one the measurement declined - a
 * dredged berth beside the fairway moved the first cut's lane up to 13 m outside the fairway.
 * The fraction was a quarter at first: a berth 40 m deep off a 200 m channel stood inside it
 * and drew the lane 17 m toward itself. (Read too eagerly, a real widening is only carried as
 * the narrower channel for a while - the carried edge is a bound, never a widening.)
 */
export const CHART_OPENING_M = 30;
export const CHART_OPENING_FRAC = 0.15;
export const CHART_EDGE_WINDOW_M = 600;
/** ... and only the samples of that window running within 10 degrees of its own track are
 * read, each moved by where it stands across that track (see chartOwnership's OPENINGS). */
export const CHART_OPEN_PARALLEL_COS = Math.cos(10 * Math.PI / 180);
/** The search's path is rounded over this much either way before the lane is measured
 * across it (see chartOwnership's `lat`). */
export const CHART_BASE_ROUND_M = 50;
/** The chart's cross-sections are square to her course over this much either way (see
 * chartOwnership's tangents). */
export const CHART_TAN_M = 75;
/** A run's end samples whose cross-section is narrower than this share of the run's median
 *  width are the channel's END, not the channel (see chartOwnership). */
export const CHART_END_SLIVER = 0.5;
/** The cone (chartOwnership) reads a sample's band from the owned neighbors no further off along
 *  her path than this, each neighbor's limits as it measured them across its own track. */
export const CHART_CONE_REACH_M = 600;
/** ... where her path runs straight (within 3 degrees) through the neighbor; and only a neighbor
 *  on the stretch she runs straight along with the sample may take its lane to port of the
 *  middle (see chartOwnership's cone). */
export const CHART_CONE_STRAIGHT_COS = Math.cos(3 * Math.PI / 180);

/** The charted channels of a model: its Fairway and Dredged Area rings, not the buoy-gate corridors. */
const chartRings = (ko) => ((ko && ko.chans) || []).filter((c) => c.charted);

/** The unit tangent and its starboard normal at each point of an EN polyline, over `h`
 *  points either way. */
function tangentsEN(samp, h = 1) {
  const SB = [], TAN = [], N = samp.length;
  for (let i = 0; i < N; i++) {
    const a = samp[Math.max(0, i - h)], b = samp[Math.min(N - 1, i + h)];
    let te = b.e - a.e, tn = b.n - a.n;
    const tl = Math.hypot(te, tn) || 1; te /= tl; tn /= tl;
    TAN.push([te, tn]); SB.push([tn, -te]);
  }
  return { SB, TAN };
}

/**
 * Follow the wanted offset `T` no steeper than `g` per sample, eased the same going in as
 * coming out, and ZERO at every pinned sample.
 *
 * ⚠ THE PINS ARE WHY SHE DOES NOT OVERSHOOT A CHANNEL SHE IS LEAVING THROUGH ITS SIDE. Eased
 * freely, a lane 300 m to starboard of a path that turns out of the channel through its port
 * side was still 150 m off the routed path where the channel ended (drawn at the Turning
 * Basin). Where she runs off the END of a channel the pin is put beyond it instead
 * (`chartOwnership`'s ramps), so she holds the lane to the end and eases off in the water
 * past it - not, as the first cut did, 350 m early, left of center, before a 208 m swing.
 *
 * `jog` (optional): how far the path itself moves across the SEARCH's path between samples
 * i-1 and i (chartOwnership's `lat`). The shift may change by that much more there, so a lane
 * whose line is straight is not eased in short of it where the path it shifts jogs: where the
 * pair lane hands a straight fairway to the chart after easing back 130 m across it, the slew
 * alone swung the lane 34-75 m about its +50 line. (Made the lane's own across the search's
 * path outright, it also reshaped the lane at a square corner of that path, where "across it"
 * means little: the bay into Roosevelt Inlet.)
 */
function slewField(T, g, pin, jog) {
  const N = T.length, F = new Float64Array(N), B = new Float64Array(N), E = new Float64Array(N);
  const gi = (i) => g + ((jog && jog[i]) || 0);                    // between i-1 and i
  for (let i = 1; i < N; i++) F[i] = Math.max(F[i - 1] - gi(i), Math.min(F[i - 1] + gi(i), T[i]));
  for (let i = N - 2; i >= 0; i--) B[i] = Math.max(B[i + 1] - gi(i + 1), Math.min(B[i + 1] + gi(i + 1), T[i]));
  const ub = new Float64Array(N).fill(Infinity);
  let d = Infinity;
  for (let i = 0; i < N; i++) { d = pin[i] ? 0 : d + gi(i); ub[i] = d; }
  d = Infinity;
  for (let i = N - 1; i >= 0; i--) { d = pin[i] ? 0 : d + gi(i + 1); ub[i] = Math.min(ub[i], d); }
  for (let i = 0; i < N; i++) E[i] = Math.max(-ub[i], Math.min(ub[i], (F[i] + B[i]) / 2));
  return E;
}

function median(a) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort(), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * WHICH SAMPLES OF A PATH THE CHART'S OWN LANE RIDES, and where on each.
 *
 * The path is resampled every max(25, buf*7) m. A sample is the chart's (`own`) where she is
 * proceeding ALONG a charted channel (CHART_ALONG_RATIO) in a stretch at least
 * max(120, buf*30) m long that is inside it somewhere; a path beside the channel is captured
 * within LANE_CAPTURE_STANDOFF_M, and a bend cut between two stretches of it within
 * CHART_BRIDGE_REACH_M. Its cross-section is the POLYGON's, marched across her track - on
 * the FAIRWAY's rings wherever she is in one, so a dredged berth beside it is not part of
 * it - and the lane is three quarters of the way across, a quarter of the width in from the
 * starboard edge (`T`, meters to starboard of the sample).
 *
 * Over an opening, a sample the measurement declines, or a short gap between rings, the
 * edges either side are CARRIED (CHART_INTERP_M, CHART_GAP_M). The lane is capped so that,
 * eased no steeper than LANE_SLEW, it is inside a narrower stretch ahead or behind by the time
 * she reaches it (the first cut overshot a width step by 16 m, with 70-90 m jumps where a bank
 * stood) - to port of the middle only for a narrowing on the stretch she runs straight along. And
 * where she runs off the END of the channel the samples beyond it carry the lane on (`ramp`)
 * long enough to ease back to the path in the water past it.
 *
 * Shared, so the marks stage and the lane agree about which water is the chart's.
 *
 * @returns {?object} {samp, st, N, STEP, SB, TAN, ch, own, ramp, T, en} or null with no
 *   charted channel in reach.
 */
export function chartOwnership(pathLL, frame, ko, buf, baseLL = null, clr = buf) {
  const rings = chartRings(ko);
  if (!pathLL || pathLL.length < 2 || !rings.length) return null;
  const en = pathLL.map((p) => frame.toEN(p));
  const STEP = Math.max(25, buf * 7), MS = Math.max(2, buf / 2), STANDOFF = Math.max(buf + 2, 6);
  const rs = resampleEN(en, STEP);
  if (!rs || !(rs.total > 3 * STEP)) return null;
  const samp = rs.pts, N = samp.length;
  if (N < 4) return null;
  // ⚠ WHERE EACH SAMPLE STANDS ACROSS THE SEARCH'S OWN PATH (`baseLL`), meters to starboard.
  // The lane's cone and its slew are its own across THAT path: measured as shifts from a path
  // the pair lane had jogged 130 m across a straight fairway, a straight lane looked steep, and
  // was eased in 20-30 m short of its line where the pairs handed over to the chart.
  //   Measured against that path ROUNDED (CHART_BASE_ROUND_M either way, three passes): at a
  // square corner of it - the bay into Roosevelt Inlet at Lewes - the offset from the bare
  // corner ran 39, 21, 0, 18, 40 m over five samples, and the lane eased to and fro with it.
  const lat = new Float64Array(N);
  const brs = baseLL && baseLL.length >= 2 ? resampleEN(baseLL.map((p) => frame.toEN(p)), 10) : null;
  if (brs && brs.pts.length >= 3) {
    let b = brs.pts;
    const h = Math.max(1, Math.round(CHART_BASE_ROUND_M / 10));
    for (let pass = 0; pass < 3; pass++) {
      b = b.map((p, i) => {
        if (i === 0 || i === b.length - 1) return p;
        let se = 0, sn = 0, c = 0;
        for (let k = Math.max(0, i - h); k <= Math.min(b.length - 1, i + h); k++) { se += b[k].e; sn += b[k].n; c++; }
        return { e: se / c, n: sn / c };
      });
    }
    const bc = cumEN(b);
    for (let i = 0; i < N; i++) lat[i] = projectEN(b, bc, samp[i]).x;
  }
  const st = samp.map((_, i) => (i < N - 1 ? i * STEP : rs.total));
  const fair = rings.filter((c) => c.src === 'fairway');
  const inSet = (p, set) => {
    for (const c of set) if (inBB(p, c.bb, 0) && pinp(p, c.ring)) return true;
    return false;
  };
  const inAny = (p) => inSet(p, rings);
  // THE FAIRWAY BEFORE A DREDGED AREA BESIDE IT: a cross-section begun in a fairway is
  // measured on the fairway's rings alone.
  const setAt = (p) => (fair.length && inSet(p, fair) ? fair : rings);
  // INVARIANT 1, as in the unmarked lane: a mark is not a wall.
  const koWall = {
    polys: ko.polys || [], lines: ko.lines || [],
    points: (ko.points || []).filter((p) => p.kind !== 'a channel buoy'),
  };
  // ACROSS HER COURSE, NOT HER LEG: each cross-section is taken square to the path over
  // CHART_TAN_M either way. Square to a 100 m leg that stepped 120 m across a fairway, the
  // three-quarter point was right across the channel and 150 m up it, and the lane folded back.
  const { SB, TAN } = tangentsEN(samp, Math.max(1, Math.round(CHART_TAN_M / STEP)));
  const at = (i, x) => ({ e: samp[i].e + SB[i][0] * x, n: samp[i].n + SB[i][1] * x });

  // Across her track from sample i. An edge lies between the last step on one side of it and
  // the first on the other, so it is put half a step back (taken at the step that found it,
  // both edges read a step wide and the lane sat 1.5 m to starboard of the three-quarter line).
  const edge = (i, sg, from, S) => {
    for (let d = from + MS; d <= from + CHART_MARCH_MAX_M; d += MS) if (!inSet(at(i, sg * d), S)) return d - MS / 2;
    return null;
  };
  const chord = (i, reach) => {
    if (inAny(samp[i])) {
      const S = setAt(samp[i]);
      // ⚠ ... AND A DREDGED AREA BESIDE THE FAIRWAY IS STILL NOT THE CHANNEL. A sample in one
      // whose cross-section runs on, in charted water all the way, into a fairway (within
      // CHART_BRIDGE_REACH_M) is measured on the fairway: measured on both, a path that stepped
      // into a dredged patch beside a 200 m fairway took the 400 m of the two together for the
      // channel, and the lane ran down the fairway's middle past it.
      if (S !== fair && fair.length) {
        let best = null;
        for (const sg of [1, -1]) {
          for (let d = MS; d <= CHART_BRIDGE_REACH_M; d += MS) {
            const p = at(i, sg * d);
            if (!inAny(p)) break;
            if (!inSet(p, fair)) continue;
            const end = edge(i, sg, d, fair);
            if (end != null && (!best || d < best.d)) best = { d, sg, end };
            break;
          }
        }
        if (best) {
          const g = best.d - MS / 2;
          return best.sg > 0 ? { xL: g, xR: best.end, inside: true, S: fair } : { xL: -best.end, xR: -g, inside: true, S: fair };
        }
      }
      const r = edge(i, 1, 0, S), l = edge(i, -1, 0, S);
      return r != null && l != null ? { xL: -l, xR: r, inside: true, S } : null;
    }
    // Outside: the nearest charted water across her track, within `reach`, over open water.
    const look = (sg) => {
      let d = MS;
      for (; d <= reach; d += MS) if (inAny(at(i, sg * d))) break;
      if (d > reach) return null;
      for (let w = MS; w < d; w += MS) if (blocked(at(i, sg * w), koWall, buf)) return null;
      const S = setAt(at(i, sg * d)), end = edge(i, sg, d, S);
      return end == null ? null : { g: d - MS / 2, end, S };
    };
    const r = look(1), l = look(-1);
    if (r && (!l || r.g <= l.g)) return { xL: r.g, xR: r.end, inside: false, S: r.S };
    if (l) return { xL: -l.end, xR: -l.g, inside: false, S: l.S };
    return null;
  };
  const AS = Math.max(MS, 10), MIN_RUN = Math.max(120, buf * 30);
  // ... and never less than a real stretch of it (MIN_RUN): a dredged patch 55 x 90 m, 15 m off
  // a fairway, was 1.6 of its width long - "along" - and her path, stepping into it, was laned
  // three quarters across THE PATCH, 216 m to port of the fairway's middle.
  const along = (i, c) => {
    const m = at(i, (c.xL + c.xR) / 2), need = Math.max(CHART_ALONG_RATIO * (c.xR - c.xL), MIN_RUN);
    let ext = 0;
    for (const sg of [1, -1]) {
      for (let d = AS; d <= CHART_MARCH_MAX_M; d += AS) {
        if (!inSet({ e: m.e + TAN[i][0] * sg * d, n: m.n + TAN[i][1] * sg * d }, c.S)) break;
        ext += AS;
        if (ext >= need) return true;
      }
    }
    return false;
  };

  // 'good': measured; 'in': in charted water and not measured (or an opening); 'out': neither.
  const CAPTURE = LANE_CAPTURE_STANDOFF_M(buf);
  const ch = new Array(N).fill(null), kind = new Array(N).fill('out');
  for (let i = 1; i < N - 1; i++) {
    const c = chord(i, CAPTURE);
    if (c && along(i, c)) { ch[i] = c; kind[i] = 'good'; }
    else if (inAny(samp[i])) kind[i] = 'in';
  }
  // The bend cut: see CHART_BRIDGE_REACH_M.
  for (let i = 1; i < N - 1; i++) {
    if (kind[i] !== 'out' || kind[i - 1] !== 'good') continue;
    let j = i;
    while (j < N - 1 && kind[j] === 'out') j++;
    if (j < N - 1 && kind[j] === 'good') {
      const fill = [];
      for (let k = i; k < j; k++) {
        const c = chord(k, CHART_BRIDGE_REACH_M);
        if (!(c && along(k, c))) break;
        fill.push(c);
      }
      if (fill.length === j - i) for (let k = i; k < j; k++) { ch[k] = fill[k - i]; kind[k] = 'good'; }
    }
    i = j;
  }
  // OPENINGS: a side standing further out than it does along the window round it.
  //   ⚠ Read in sample i's own frame: a neighbor's edges are moved by where IT stands across
  // i's track, and only a neighbor running the same way (CHART_OPEN_PARALLEL_COS) is read at
  // all. Read as bare offsets from each sample, a path that jogs across a straight fairway (a
  // pair lane easing back to the search's path, 130 m) made its straight edges look like an
  // opening, and the stretch was the chart's no longer.
  const W = Math.max(2, Math.round(CHART_EDGE_WINDOW_M / STEP));
  const open = new Uint8Array(N);
  for (let i = 1; i < N - 1; i++) {
    if (kind[i] !== 'good') continue;
    const R = [], L = [], Wd = [];
    for (let j = Math.max(1, i - W); j <= Math.min(N - 2, i + W); j++) {
      if (kind[j] !== 'good' || TAN[j][0] * TAN[i][0] + TAN[j][1] * TAN[i][1] < CHART_OPEN_PARALLEL_COS) continue;
      const dj = (samp[j].e - samp[i].e) * SB[i][0] + (samp[j].n - samp[i].n) * SB[i][1];
      R.push(ch[j].xR + dj); L.push(ch[j].xL + dj); Wd.push(ch[j].xR - ch[j].xL);
    }
    if (R.length < 3) continue;
    const tol = Math.max(CHART_OPENING_M, CHART_OPENING_FRAC * median(Wd));
    if (ch[i].xR > median(R) + tol || ch[i].xL < median(L) - tol) open[i] = 1;
  }
  for (let i = 0; i < N; i++) if (open[i]) kind[i] = 'in';
  // CARRY THE EDGES over every stretch the measurement could not read, between good samples.
  for (let i = 1; i < N - 1; i++) {
    if (kind[i] === 'good') continue;
    let j = i, outM = 0;
    while (j < N - 1 && kind[j] !== 'good') { if (kind[j] === 'out') outM += STEP; j++; }
    const a = i - 1, b = j;
    if (kind[a] === 'good' && b < N - 1 && kind[b] === 'good'
        && (b - a) * STEP <= CHART_INTERP_M && outM <= CHART_GAP_M) {
      for (let k = i; k < j; k++) {
        const t = (k - a) / (b - a);
        let xL = ch[a].xL + (ch[b].xL - ch[a].xL) * t, xR = ch[a].xR + (ch[b].xR - ch[a].xR) * t;
        // ⚠ A CARRIED EDGE IS A BOUND, NOT A REPLACEMENT. Where she is in charted water the
        // polygon's own edge is still measured, and the nearer of the two is the edge: an
        // opening cannot widen the channel, and a channel that really narrows or bends there
        // is not laid over (carried straight through Portsmouth's bridges, the first carry
        // put the quarter-width line over land and the piers for 200 m).
        //   Measured from INSIDE the carried channel: from her sample where it is between the
        // carried edges, else from their middle where that is charted water. (Measured from a
        // sample that stood in other charted water beside it - outbound above Badgers Island -
        // the edge of THAT water clipped the channel's starboard edge to 1 m with its port edge
        // at 44, and the lane's cap carried the inverted chord 400 m either way.)
        const m = xL <= 0 && xR >= 0 ? 0 : (xL + xR) / 2, S = setAt(at(k, m));
        if (kind[k] === 'in' && xR > xL && inSet(at(k, m), S)) {
          const r = edge(k, 1, m, S), l = edge(k, -1, -m, S);
          if (r != null) xR = Math.min(xR, r);
          if (l != null) xL = Math.max(xL, -l);
        }
        // (`inside` is where she IS: a sample read as an opening is 'in' and may stand outside
        // the polygon - beside a fairway, one such sample at a turn had a path that never
        // entered it laned as if it had)
        ch[k] = { xL, xR, inside: inAny(samp[k]), S: ch[a].S, carried: true };
        kind[k] = 'good';
      }
    }
    i = j;
  }

  // A real stretch, with her actually IN the channel somewhere along it (MIN_RUN, above).
  const T = new Float64Array(N), own = new Uint8Array(N);
  for (let i = 1; i < N - 1; i++) {
    if (kind[i] !== 'good') continue;
    let j = i, anyIn = false;
    while (j < N - 1 && kind[j] === 'good') { if (ch[j].inside) anyIn = true; j++; }
    if (anyIn && (j - i) * STEP >= MIN_RUN) {
      for (let k = i; k < j; k++) {
        const c = ch[k], w = c.xR - c.xL;
        let x = c.xL + w * (0.5 + LANE_FRAC / 2);
        x = w > 2 * STANDOFF ? Math.max(c.xL + STANDOFF, Math.min(c.xR - STANDOFF, x)) : (c.xL + c.xR) / 2;
        // INVARIANT 4: where the quarter-width point is foul (a pier, a bridge's pier, a shoal),
        // the nearest to it that is clear either way, never to port of the middle of the channel
        // nor nearer its starboard edge than the standoff. Where none is, the sample is still
        // the lane's, and only it is eased toward the path below - pinned, it dragged a stretch
        // of the lane down with it at every pier of Portsmouth's bridges.
        const xs = x;
        const cands = [0];
        for (let f = 0.05; f <= 0.45 + 1e-9; f += 0.05) cands.push(-f, f);
        x = xs;
        // (in a set, one clear of the guard's standoff first - `clr` - and failing that one clear
        // of the buffer, as before: the standoff's re-gate splices what is left)
        found: for (const r of clr > buf ? [clr, buf] : [buf]) {
          for (const df of cands) {
            const f = 0.5 + LANE_FRAC / 2 + df, xc = c.xL + w * f;
            if (f < 0.5 - 1e-9 || (w > 2 * STANDOFF && (xc < c.xL + STANDOFF - 1e-9 || xc > c.xR - STANDOFF + 1e-9))) continue;
            if (!blocked(at(k, df === 0 ? xs : xc), ko, r)) { x = df === 0 ? xs : xc; break found; }
          }
        }
        T[k] = x; own[k] = 1;
      }
    }
    i = j;
  }
  // AN END'S OWN RING is the charted ring her lane stands in at the end of a run (the channel's
  // set where it stands in none). An END is HER LANE leaving it (`endsBy`, below), whatever
  // charted water lies past it: a fairway that ran into a dredged turning basin had no end (the
  // basin is charted), and the lane was eased back inside the fairway's last 250 m.
  //   ⚠ AND HER PATH LEAVING THE RUN'S END WATER TOO - the rings her lane and her path stand in
  // there - before her route ends (`pathLeaves`). Where her route ends in that water she leaves
  // the lane inside it: at Pearl Harbor, her destination 100 m on in the fairway and 190 m across
  // it, her lane already in the next ring of it past a junction, the lane was carried on to that
  // ring's end and hooked back round to her destination - a green light passed on her wrong hand.
  const ringsAt = (p, S) => S.filter((c) => inBB(p, c.bb, 0) && pinp(p, c.ring));
  const endRing = (i) => {
    const S = ch[i].S || rings, here = ringsAt(at(i, T[i]), S);
    return here.length ? here : S;
  };
  const pathLeaves = (i, sg) => {
    const S = ch[i].S || rings, W = [...new Set([...ringsAt(at(i, T[i]), S), ...ringsAt(samp[i], S)])];
    const water = W.length ? W : S;
    for (let k = i + sg; k >= 0 && k < N; k += sg) if (!inSet(samp[k], water)) return true;
    return false;
  };
  // ⚠ A CROSS-SECTION CUT BY THE CHANNEL'S END IS NOT THE CHANNEL. Where her path turns within
  // CHART_TAN_M of an end, the last (or first) sample's cross-section, square to the coming
  // turn, clips the end's corner - a sliver 20-60 m wide of a 200 m fairway. Owned, the cone
  // took it for a narrower stretch ahead and dragged the lane to the port edge over the last
  // 135-250 m. A run's end samples narrower than CHART_END_SLIVER of its median are the end's,
  // where her path goes on out of it.
  //   ⚠ ONLY WHERE THE COMING TURN CUT IT: within CHART_TAN_M of the run's end, and only a
  // cross-section that is NOT thin measured square to the run's own direction there (`across`,
  // from its chord's middle). A channel that really narrows at its end - an entrance channel
  // 150 m wide off a 400 m fairway - is the channel: trimmed as a sliver, it was not laned at
  // all, the end ramp carried the wide part's lane into it past its starboard edge, and she ran
  // its last 500 m on its port side under "right of center in the charted channel".
  const H = Math.ceil(CHART_TAN_M / STEP);
  const across = (q, t) => {
    const c = ch[q], S = c.S || rings, m = at(q, (c.xL + c.xR) / 2), nx = t[1], ny = -t[0];
    const reach = (sg) => {
      for (let d = MS; d <= CHART_MARCH_MAX_M; d += MS) if (!inSet({ e: m.e + nx * sg * d, n: m.n + ny * sg * d }, S)) return d - MS / 2;
      return CHART_MARCH_MAX_M;
    };
    return reach(1) + reach(-1);
  };
  for (let i = 1; i < N - 1; i++) {
    if (!own[i]) continue;
    let j = i;
    while (j < N - 1 && own[j]) j++;
    const med = median(Array.from({ length: j - i }, (_, q) => ch[i + q].xR - ch[i + q].xL));
    const thin = (q) => ch[q].xR - ch[q].xL < CHART_END_SLIVER * med;
    const r0 = Math.min(j - 1, i + H), r1 = Math.max(i, j - 1 - H);         // the run's own direction, each end
    const sliver = (q, r) => thin(q) && across(q, TAN[r]) >= CHART_END_SLIVER * med;
    if (pathLeaves(i, -1)) for (let q = i; q < j && q < i + H && sliver(q, r0); q++) own[q] = 0;
    if (pathLeaves(j - 1, 1)) for (let q = j - 1; q >= i && q > j - 1 - H && own[q] && sliver(q, r1); q--) own[q] = 0;
    i = j;
  }

  // THE CONE: eased no steeper than LANE_SLEW, the lane is brought inside a narrower stretch
  // ahead or behind before she reaches it.
  //   ⚠ IN EACH SAMPLE'S OWN FRAME, ROUND A BEND TOO: a sample's band is the nearest of its own
  // limits (its chord's edges, standoff in, across its own track) and of every SETTLED owned
  // neighbor's within CHART_CONE_REACH_M, each as that neighbor measured it across its own
  // track, eased off at LANE_SLEW a step. Those are the offsets chartedChannelLane eases the
  // lane in (slewField, along her path, whichever way it runs), so the cone reads them as the
  // lane will be built from them.
  //   ⚠ SETTLED: her path runs straight through it (CHART_CONE_STRAIGHT_COS) and its cross-section
  // holds her. Where two charted rings join at a bend, a cross-section square to her TURNING
  // track is cut short by the end of the ring she is leaving (or, in the gap between them, is
  // a corner of it wholly to one side); read as a narrowing, one such sample held the lane at
  // the middle 250 m either side and the blend took the route 23-42 m to PORT of both
  // channels' middles at a 40 degree port bend, under "right of center".
  //   ⚠ THE MIDDLE YIELDS ONLY TO THE STRETCH SHE RUNS STRAIGHT ALONG: a neighbor's limit takes
  // the lane to port of the sample's own chord's middle only where her path runs straight
  // from the sample to it (there her frame IS the plane, and the narrowing is real); any
  // other neighbor's eases it to the middle and no further (INVARIANT 4). Clamped at the
  // middle everywhere, a fairway whose narrow part's starboard edge stepped in past the wide
  // part's middle was eased to that middle and no further, and the lane ran 8-33 m past the
  // narrow part's starboard edge, out of the charted water, for 30-160 m.
  //   Measured across the SEARCH's path (`lat`), a search path that stepped 400 m off a fairway
  // beside its port-hand greens moved the channel's edges in that frame by the size of the step:
  // the band narrowed and held the lane 90 m to port of its chord's middle for 870 m; where it
  // moved faster the band INVERTED, and its middle - tied to no chord - put the lane 114 m
  // outside the channel, and at a 19.5 m standoff 1,048 m off (a 2.4 km Go-To shipped as 10.3
  // km), under "right of center in the charted channel". Projected across a sample's own track,
  // the limits of the stretches either side of a bend stood toward its inside and a winding
  // fairway was laned left of its middle; measured from the chord's middle, a channel whose
  // starboard edge alone stepped in moved its middle with it, and the lane ran past the narrow
  // part's starboard edge. Read from the neighbors running its own way alone (within 3
  // degrees), a narrowing just round a bend was not seen before the bend: the wide part's lane
  // was carried into the narrow part 12-25 m past its starboard edge, out of the charted water,
  // at every bend from 5 to 45 degrees. (A jog of her path across the channel moves the frame
  // the far side's limits are read in, and holds the lane toward the middle for up to
  // CHART_CONE_REACH_M beside it - never to port of it.)
  const g = LANE_SLEW * STEP;
  const offH = new Float64Array(N), offL = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    if (!own[i]) continue;
    const c = ch[i], w = c.xR - c.xL;
    offH[i] = w > 2 * STANDOFF ? c.xR - STANDOFF : (c.xL + c.xR) / 2;
    offL[i] = w > 2 * STANDOFF ? c.xL + STANDOFF : (c.xL + c.xR) / 2;
  }
  const reachSteps = Math.max(1, Math.round(CHART_CONE_REACH_M / STEP));
  const runsWith = (a, b) => TAN[a][0] * TAN[b][0] + TAN[a][1] * TAN[b][1] >= CHART_CONE_STRAIGHT_COS;
  const settled = new Uint8Array(N);
  for (let j = 0; j < N; j++) {
    settled[j] = own[j] && ch[j].xL <= 0 && ch[j].xR >= 0 && runsWith(Math.max(0, j - 1), Math.min(N - 1, j + 1)) ? 1 : 0;
  }
  for (let i = 0; i < N; i++) {
    if (!own[i]) continue;
    let h = offH[i], l = offL[i], hStraight = offH[i];
    for (const sg of [-1, 1]) {
      let straight = true;
      for (let d = 1; d <= reachSteps; d++) {
        const j = i + sg * d;
        if (j < 0 || j >= N) break;
        if (straight && !runsWith(i, j)) straight = false;
        if (!settled[j]) continue;
        h = Math.min(h, offH[j] + g * d);
        l = Math.max(l, offL[j] - g * d);
        if (straight) hStraight = Math.min(hStraight, offH[j] + g * d);
      }
    }
    h = Math.min(Math.max(h, (ch[i].xL + ch[i].xR) / 2), hStraight);   // (INVARIANT 4, but for a straight narrowing)
    if (h >= l) T[i] = Math.min(h, Math.max(l, T[i]));
  }

  // THE ENDS: off the END of a channel she holds the lane to the end and eases off past it.
  // Through its SIDE she eases inside it, as before (the pins in `slewField`).
  const ramp = new Uint8Array(N);
  const K = (x) => Math.ceil(Math.abs(x) / g) + 1;
  // An END is where the channel runs out ahead of her LANE within the water she needs to ease
  // back in anyway (K steps). The first cut looked two steps ahead only: on his Go-To, outbound
  // past Badgers Island, her path ran just outside the fairway's north edge, the chord was lost
  // 60 m short of the end of the lane 143 m to starboard, and the lane was eased back across
  // the channel inside it for 400 m.
  const endsBy = (i, sg) => {
    const p = at(i, T[i]), S = endRing(i);
    for (let d = MS; d <= Math.max(2, K(T[i])) * STEP; d += MS) {
      if (!inSet({ e: p.e + TAN[i][0] * sg * d, n: p.n + TAN[i][1] * sg * d }, S)) return true;
    }
    return false;
  };
  for (let i = 1; i < N - 1; i++) {
    if (!own[i]) continue;
    let j = i;
    while (j < N - 1 && own[j]) j++;
    const i0 = i, i1 = j - 1;
    if (i1 + 1 < N - 1 && pathLeaves(i1, 1) && endsBy(i1, 1)) {
      for (let k = i1 + 1; k < Math.min(N - 1, i1 + 1 + K(T[i1])); k++) {
        if (own[k] || blocked(at(k, T[i1]), ko, buf)) break;
        T[k] = T[i1]; ramp[k] = 1;
      }
    }
    if (i0 - 1 > 0 && pathLeaves(i0, -1) && endsBy(i0, -1)) {
      for (let k = i0 - 1; k > Math.max(0, i0 - 1 - K(T[i0])); k--) {
        if (own[k] || ramp[k] || blocked(at(k, T[i0]), ko, buf)) break;
        T[k] = T[i0]; ramp[k] = 1;
      }
    }
    i = j;
  }
  return { samp, st, N, STEP, SB, TAN, ch, own, ramp, T, lat, en, at, total: rs.total };
}

/**
 * Ride the Rule 9 lane along a CHARTED channel - the samples `chartOwnership` gives the
 * chart - and leave every other vertex of the path exactly where it was.
 *
 * ⚠ IT RUNS LAST OF THE LANES AND OVERRIDES ONLY WHAT IT OWNS. Where the chart rides, its
 * line is the line, whatever the pair lane or the banks made of that water; where it does
 * not, their route and the marks' runs stand as they were laid, vertex for vertex. No
 * sample the chart does not own within a smoothing step of a mark's run is moved
 * (`opts.hold`): the lane easing off past a channel's end must not bend it.
 *
 * ⚠ AND WHERE THE CHART OWNS A RUN'S WATER, THE CHART'S LINE IS THE LINE. A mark judged from a
 * path the chart did not own (250 m outside a fairway, beside its port-hand greens) has its run
 * laid INTO the fairway; held there, the run pinned the lane 20 m inside the fairway's port
 * edge for 1.7 km. The run is what brings her into the channel; the chart says where in it.
 *
 * @returns {{path:Array, used:boolean, own:?object, E:?Float64Array}}
 */
export function chartedChannelLane(pathLL, frame, ko, buf, opts = {}) {
  const nil = { path: pathLL, used: false, own: null, E: null };
  // (the marks stage measured this same path already when it moved nothing: `opts.own`)
  const O = opts.own || chartOwnership(pathLL, frame, ko, buf, opts.base, opts.clr);
  if (!O || !O.own.some((v) => v)) return { ...nil, own: O };
  const { samp, N, STEP, TAN, en, st } = O;
  const HOLD = Math.max(45, buf * 13);
  const hold = opts.hold || [];
  const pin = new Uint8Array(N), Tb = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const held = hold.some((q) => Math.hypot(samp[i].e - q.e, samp[i].n - q.n) < HOLD);
    pin[i] = (!(O.own[i] || O.ramp[i]) || (held && !O.own[i])) ? 1 : 0;
  }
  // Blend ONLY across samples that are the lane's (the unmarked lane's rule).
  for (let i = 0; i < N; i++) {
    if (pin[i]) continue;
    let s = 0, c = 0;
    for (let k = -1; k <= 1; k++) {
      const j = i + k;
      if (j >= 0 && j < N && !pin[j]) { s += O.T[j]; c++; }
    }
    Tb[i] = s / c;
  }
  const jog = new Float64Array(N);
  for (let i = 1; i < N; i++) jog[i] = Math.abs(O.lat[i] - O.lat[i - 1]);
  const E = slewField(Tb, LANE_SLEW * STEP, pin, jog);
  const pts = [];
  for (let i = 0; i < N; i++) {
    let d = E[i], p = O.at(i, d), k = 0;
    while (Math.abs(d) > 0.5 && blocked(p, ko, buf) && k < 8) { d *= 0.6; p = O.at(i, d); k++; }
    if (blocked(p, ko, buf)) { E[i] = 0; p = samp[i]; } else E[i] = d;
    pts.push(p);
  }
  if (!E.some((v) => Math.abs(v) > 0.5)) return { ...nil, own: O };
  // SPLICED, NOT RESAMPLED: the path's own vertices stand outside every stretch the lane moved.
  const cum = cumEN(en), out = [];
  const push = (p) => {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.e - q.e, p.n - q.n) > 0.25) out.push(p);
  };
  let vi = 0;
  for (let i = 0; i < N; i++) {
    if (!(Math.abs(E[i]) > 0.5)) continue;
    let j = i;
    while (j < N && Math.abs(E[j]) > 0.5) j++;
    const p = Math.max(0, i - 1), q = Math.min(N - 1, j);
    while (vi < en.length && cum[vi] < st[p] - 0.01) push(en[vi++]);
    push(samp[p]);
    // A shift toward the inside of a bend bunches the samples and can fold them back on
    // themselves: only a point that still makes way along her track is kept.
    for (let k = i; k < j; k++) {
      const r = out[out.length - 1];
      if ((pts[k].e - r.e) * TAN[k][0] + (pts[k].n - r.n) * TAN[k][1] > 0.2 * STEP) push(pts[k]);
    }
    push(samp[q]);
    while (vi < en.length && cum[vi] <= st[q] + 0.01) vi++;
    i = j;
  }
  while (vi < en.length) push(en[vi++]);
  return { path: out.map((p) => frame.fromEN(p.e, p.n)), used: true, own: O, E };
}

/**
 * WHAT THE CHART'S LANE DELIVERED, measured on the route that SHIPS: at every sample the
 * chart owns, how far across its cross-section the finished route lies.
 *
 * ⚠ A LANE IS CLAIMED ONLY WHERE IT WAS DELIVERED. The first cut said "right of center in the
 * charted channel", partial false, of a route left of center for 2,995 m of 3,000; the
 * smoothing, the gate and a foul quarter-width point can all take her off the line after the
 * lane put her on it. `shortM` is the owned water she crosses at less than half way.
 *
 * @returns {{ownedM:number, shortM:number, least:number}}
 */
export function chartedRide(routeLL, frame, O) {
  const out = { ownedM: 0, shortM: 0, least: 1 };
  if (!O || !routeLL || routeLL.length < 2) return out;
  const r = routeLL.map((p) => frame.toEN(p));
  for (let i = 0; i < O.N; i++) {
    if (!O.own[i]) continue;
    out.ownedM += O.STEP;
    const s = O.samp[i], t = O.TAN[i], sb = O.SB[i], c = O.ch[i];
    let best = null;
    for (let k = 1; k < r.length; k++) {
      const aP = (r[k - 1].e - s.e) * t[0] + (r[k - 1].n - s.n) * t[1];
      const aQ = (r[k].e - s.e) * t[0] + (r[k].n - s.n) * t[1];
      if ((aP > 0 && aQ > 0) || (aP < 0 && aQ < 0) || aP === aQ) continue;
      const u = aP / (aP - aQ);
      const X = { e: r[k - 1].e + (r[k].e - r[k - 1].e) * u, n: r[k - 1].n + (r[k].n - r[k - 1].n) * u };
      const x = (X.e - s.e) * sb[0] + (X.n - s.n) * sb[1];
      if (x < c.xL - 150 || x > c.xR + 150) continue;
      if (best == null || Math.abs(x - O.T[i]) < Math.abs(best - O.T[i])) best = x;
    }
    const f = best == null ? 0 : (best - c.xL) / ((c.xR - c.xL) || 1);
    out.least = Math.min(out.least, f);
    if (f < 0.45) out.shortM += O.STEP;
  }
  return out;
}

// ── Marks that stand alone ───────────────────────────────────────────────────

/**
 * How far off her track a lateral mark may be and still be one she is passing, in meters.
 *
 * ⚠ A POLICY NUMBER, SAID OUT LOUD. Nothing on the chart says which marks belong to the
 * water a route is using where no channel is charted. On the Piscataqua the marks a vessel
 * keeping right has to honor stood up to 330 m off the route the search found (Little Bay
 * Buoy 4A, on whose WRONG side that route ran), and the nearest mark of another water was
 * over 800 m off. Half a kilometer takes the first and leaves the second; a mark this far
 * off still has to pass every other test below before it moves anything.
 */
export const MARK_REACH_M = 500;

/** How far away the mark numbered next may be and still say whether her channel goes on with her. */
export const MARK_NEIGHBOR_M = 1500;

/**
 * THE MARKS THAT SAY WHICH WAY THE BUOYAGE RUNS are the nearest numbered ones before and after
 * a mark ALONG HER ROUTE, this far either way at most, in meters.
 *
 * ⚠ ALONG THE ROUTE, NOT BY DISTANCE. The first cut read a mark's channel from whatever mark
 * was numbered next within 1.5 km, and Wood Island Lighted Buoy 2's "next" was Jaffrey Point
 * Light 4, another system across the harbor: a Go-To to Little Harbor was taken 391 m off its
 * line to pass the buoy 10 m off, from the wrong side. And a route-wide vote on the numbers
 * gave a lone red buoy a hand from a river crossing the route a kilometer on, whose own marks
 * the stage had rejected. Now only marks she passes, in the order she passes them, whose
 * line to this one runs ALONG her track, speak for it - and singles 2.6 km apart are read
 * (the vote's 2.5 km window never read them).
 */
export const MARK_ROUTE_NEIGHBOR_M = 4000;

/** Numbers this close are one channel's count; a bigger step is another's. */
export const MARK_STEP_MAX = 6;

/** She is running ALONG a line when it is within 60 degrees of her track. */
export const MARK_ALONG_COS = 0.5;

/** ... and a neighbor this nearly along it (37 degrees) gives the channel's course past the mark. */
export const MARK_COURSE_COS = 0.8;

/** How far before and after a mark her own heading is read. */
export const MARK_COURSE_LOOK_M = 150;

/** How many legs out to a pass point, or back from it, the whole stage may route (each with
 *  `legPath`'s `quick` search: one wider region, no escape); past it the rest of the marks are
 *  counted where they stand. Counted in WORK, so the same Go-To gives the same route on any
 *  machine: a limit of 4 s of wall-clock time made which marks were placed depend on the
 *  load, and at 4x it left 6 of his Go-To's marks on their wrong hand. (His 29 km Go-To from
 *  offshore to Adams Point routes 20.) */
export const MARK_STAGE_LEGS = 80;

/** How much further off a mark than her pass distance clear water is looked for. */
export const MARK_CLEAR_SEARCH_M = 150;

/**
 * A mark left to PORT is given this many calm-water pass distances (and never less than
 * the pass distance in the set she is in), so she is not on the line a vessel coming the
 * other way takes close to the same mark.
 */
export const MARK_PORT_BERTH = 3;

/**
 * How close she passes a buoy she keeps to starboard, in meters.
 *
 * Andy's number: "10m, or 2x buffer". A set widens it to the guard's standoff and a little
 * more, because a leg inside the standoff of the buoy's own keep-out point is one the
 * standoff gate hands back to the router, and the guard would slow for it on the water.
 */
export const MARK_PASS_M = (buf, standoffM) => Math.max(10, 2 * (buf || 0), standoffM > 0 ? standoffM + 2 : 0);

/** No vertex of the run past a mark turns her more than this, in degrees. */
export const MARK_RUN_TURN_DEG = 30;

/**
 * ... and no vertex where her route meets a run turns her more than this.
 *
 * ⚠ THE REVIEW'S SECOND BLOCKING FINDING. Two red buoys 33-128 m apart (4 and 4A) gave runs
 * that met at 70-130 degrees on KEPT vertices; the smoothing could not round them and the
 * knot prune then dropped a pass point, and buoy 4 shipped 5-14 m on her WRONG hand. A mark
 * whose run cannot be joined this gently is not passed close; it is counted where it stands.
 */
export const MARK_JOIN_MAX_DEG = 45;
/** A mark too near her route's own start or end to be moved for is excused the count too where it stands BESIDE that
 *  end: no further along from it than this many times it stands off her route (see markPassRoute's `reach`). */
export const MARK_BESIDE_RATIO = 1.5;
/** A gate partner - the other hand's mark numbered one off, standing across her track - is
 *  read as one within this (pairGates' own widest gate). */
export const MARK_GATE_M = 400;
/** A pass run laid along the channel's course is tried along her own track as well where
 *  the two differ by more than this (see markPassRoute's two ways past a mark). */
export const MARK_TRACK_COS = Math.cos(10 * Math.PI / 180);

/**
 * THE RUN PAST A MARK: straight water into it along the channel's course, round on an arc
 * where the channel turns there, and straight water out, its nearest point `off` from the
 * mark on the hand she keeps it (`sg` -1: the mark to starboard of her; +1: to port).
 *
 * ⚠ IT FOLLOWS THE CHANNEL'S TURN, AND NO VERTEX OF IT TURNS MORE THAN MARK_RUN_TURN_DEG.
 * The first cut laid three points in a straight line along the mean of the two courses. At
 * Fox Point Rock the channel turns a hundred degrees, so that line pointed at neither, and
 * what survived was a single point with a right-angle turn ON the buoy; smoothTrack cut it
 * to 6 m off where 30 was asked, and pruneStitch dropped it. A run with no vertex over 30
 * degrees gives neither anything to cut.
 *
 * @returns {{pts:Array, apex:{e:number,n:number}, len:number}}
 */
function runPast(m, uIn, uOut, sg, off, half, seg) {
  const a0 = Math.atan2(uIn[0], uIn[1]), a1 = Math.atan2(uOut[0], uOut[1]);
  const th = ((((a1 - a0) * 180 / Math.PI) + 540) % 360 - 180) * Math.PI / 180;      // her turn there, + to starboard
  const n = Math.max(1, Math.ceil(Math.abs(th) * 180 / Math.PI / MARK_RUN_TURN_DEG));
  const pts = [{ e: 0, n: 0 }], cum = [0];
  for (let j = 0; j <= n; j++) {
    const a = a0 + th * (j / n), L = (j === 0 || j === n) ? half : seg, q = pts[pts.length - 1];
    pts.push({ e: q.e + Math.sin(a) * L, n: q.n + Math.cos(a) * L });
    cum.push(cum[cum.length - 1] + L);
  }
  // Its middle is its nearest point to the mark, and she is heading the mean of the two courses there.
  const len = cum[cum.length - 1];
  let i = 1;
  while (i < cum.length - 1 && cum[i] < len / 2) i++;
  const t = (len / 2 - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  const mid = { e: pts[i - 1].e + (pts[i].e - pts[i - 1].e) * t, n: pts[i - 1].n + (pts[i].n - pts[i - 1].n) * t };
  const ab = a0 + th / 2;
  const apex = { e: m.e + sg * Math.cos(ab) * off, n: m.n - sg * Math.sin(ab) * off };
  const de = apex.e - mid.e, dn = apex.n - mid.n;
  return { pts: pts.map((p) => ({ e: p.e + de, n: p.n + dn })), apex, len };
}

/** Cumulative length along an EN polyline. */
function cumEN(p) {
  const c = [0];
  for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i].e - p[i - 1].e, p[i].n - p[i - 1].n));
  return c;
}

/**
 * The nearest point of an EN polyline to `q`: its station `s`, the signed offset `x`
 * (positive when q lies to STARBOARD of the polyline's direction), and whether q lies off
 * either end of it.
 */
function projectEN(poly, cum, q) {
  let bd = 1e18, x = 0, s = 0, seg = 1, tt = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i], dx = b.e - a.e, dy = b.n - a.n, l2 = dx * dx + dy * dy;
    if (!(l2 > 0)) continue;
    const t0 = ((q.e - a.e) * dx + (q.n - a.n) * dy) / l2, t = Math.max(0, Math.min(1, t0));
    const d = Math.hypot(q.e - a.e - t * dx, q.n - a.n - t * dy);
    if (d < bd) {
      bd = d; seg = i; tt = t0;
      x = dx * (q.n - a.n) - dy * (q.e - a.e) > 0 ? -d : d;
      s = cum[i - 1] + t * Math.sqrt(l2);
    }
  }
  return { x, s, beyond: (seg === 1 && tt < 0) || (seg === poly.length - 1 && tt > 1) };
}

/** One entry per charted lateral mark: a buoy is often charted twice (see markSystems). */
// A mark as a reason names it: its channel's name and number, as the chart has them.
const markName = (m) => ((m.sys || '') + (m.num != null ? ' ' + m.num : '')).trim() || 'another mark';

function uniqueMarks(marks) {
  const seen = new Set(), out = [];
  for (const m of marks || []) {
    if (!m.side) continue;
    const k = `${Math.round(m.e / 3)},${Math.round(m.n / 3)},${m.side}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

/**
 * LATERAL MARKS IN WATER THE CHART DOES NOT RIDE, each left on its proper hand: a
 * starboard-hand mark (red, in these waters) to starboard and a port-hand mark to port when
 * she runs with the direction of buoyage, the other way round against it. A BUOY she keeps to
 * starboard is passed close, MARK_PASS_M off it; any other mark is only moved for when the
 * path would leave it on the wrong hand or closer than that.
 *
 * ⚠ THE PATH IS ROUTED BUOY TO BUOY, NOT SHIFTED TOWARD THEM. Each mark gives a short run
 * past its own pass point (`runPast`) along the channel's course there, and the path between
 * is the search's own, so every leg is clear water by the same test as any other route.
 *
 * WHICH MARKS ARE HERS. One within MARK_REACH_M of the path, with open water between, at a
 * station the chart's lane does not ride (`opts.own`, from `chartOwnership`), not one the
 * pair lane rode past, not a junction (CATLAM 3/4: which branch she takes is not known), and
 * whose direction of buoyage the marks along her route agree on (MARK_ROUTE_NEIGHBOR_M): a
 * lone mark, or one with no number, says nothing and is left alone. A mark whose channel goes
 * on without her - the mark numbered next stands off her route and off her heading - is one
 * she is leaving, and its hand is not hers to keep (Piscataqua River Buoy 15 leads north to
 * Dover; a route bound west into Little Bay is not sent up to it).
 *
 * ⚠⚠ ONE MARK AT A TIME, AND ONLY WHERE IT BREAKS NOTHING. Every pass is built and kept only
 * if every mark that was on its proper hand before it still is, every mark passed still is,
 * and no join turns her more than MARK_JOIN_MAX_DEG. The first cut built the close passes
 * first, all together, and never asked: bringing her 10 m off a buoy put a daybeacon between
 * the two on her WRONG hand (Palmer Cove Channel Buoy 3 at Salem the same way). A mark whose
 * pass cannot be had is not dropped from the count: it is counted where it stands.
 *
 * @param {object} [opts]
 * @param {number} [opts.standoffM]  the guard's standoff in this set (see MARK_PASS_M)
 * @param {object} [opts.laned]      the pair lane's own stretch, whose marks are not these
 * @param {object} [opts.own]        `chartOwnership` of this same path
 * @returns {{path:Array, used:boolean, marks:Array, keep:Array, passM:number}} `marks` is every
 *   mark near the path, each with the hand it is kept on or the reason it was left alone
 *   (`skip`); `keep` the vertices of every run laid (for the smoothing and the knot prune).
 */
export function markPassRoute(pathLL, frame, ko, buf, opts = {}) {
  let legs = 0;                                              // (MARK_STAGE_LEGS)
  const nil = { path: pathLL, used: false, marks: [], keep: [], passM: 0 };
  if (!pathLL || pathLL.length < 2 || !ko || !(ko.marks || []).length) return nil;
  const en = pathLL.map((p) => frame.toEN(p));
  const STEP = Math.max(25, buf * 7), SMOOTH = Math.max(45, buf * 13), MS = Math.max(2, buf / 2);
  const rs = resampleEN(en, STEP);
  if (!rs || !(rs.total > 3 * STEP)) return nil;
  const samp = rs.pts, N = samp.length, cum = cumEN(samp), total = cum[N - 1];
  if (N < 4) return nil;
  // ONE STATION SCALE: every station here is measured along the samples (the first cut mixed
  // this with the input path's own arc length, 35 m apart over 18 km, and folded its output).
  const atS = (s) => {
    const v = Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < N - 1 && cum[i] < v) i++;
    const a = samp[i - 1], b = samp[i], t = (v - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return { e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t };
  };
  const unit = (a, b) => {
    const L = Math.hypot(b.e - a.e, b.n - a.n);
    return L > 1e-6 ? [(b.e - a.e) / L, (b.n - a.n) / L] : null;
  };
  const tanAt = (s) => unit(atS(s - STEP), atS(s + STEP)) || [0, 1];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const O = opts.own && opts.own.N === N ? opts.own : null;       // the same path at the same step: the same samples
  const ownedAt = (s) => {
    if (!O) return false;
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m; else hi = m; }
    const i = s - cum[lo] < cum[hi] - s ? lo : hi;
    // (the ramp past a channel's end is water the chart does not own: a buoy 20-50 m beyond
    // the end, on her wrong hand, was left to the lane easing off and shipped 135 m wrong)
    return !!O.own[i];
  };
  // Land between her and a mark puts it on other water. Shoals and rocks do not: the mark
  // is there BECAUSE of them, and a route on its wrong hand has them in between.
  const koLand = {
    polys: (ko.polys || []).filter((p) => p.kind === 'land'),
    lines: (ko.lines || []).filter((l) => l.kind === 'the shoreline'), points: [],
  };
  const D = MARK_PASS_M(buf, opts.standoffM), clr = Math.max(buf, opts.standoffM || 0);
  const marks = uniqueMarks(ko.marks);
  const clearEN = (P, Q, margin) => {
    const L = Math.hypot(Q.e - P.e, Q.n - P.n), n = Math.max(1, Math.ceil(L / MS));
    for (let k = 0; k <= n; k++) {
      if (blocked({ e: P.e + (Q.e - P.e) * k / n, n: P.n + (Q.n - P.n) * k / n }, ko, margin)) return false;
    }
    return true;
  };
  const lanedMark = (m) => {
    const L = opts.laned;
    if (!L) return false;
    const mine = [...(L.sys.port || []), ...(L.sys.stbd || [])];
    if (!mine.some((k) => k.side === m.side && Math.hypot(k.e - m.e, k.n - m.n) < 3)) return false;
    let bd = 1e18, bu = 0;
    for (let i = 1; i < L.cl.length; i++) {
      const a = L.cl[i - 1], b = L.cl[i], dx = b.e - a.e, dy = b.n - a.n, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((m.e - a.e) * dx + (m.n - a.n) * dy) / l2));
      const d = Math.hypot(m.e - a.e - t * dx, m.n - a.n - t * dy);
      if (d < bd) { bd = d; bu = (i - 1) + t; }
    }
    return bu >= L.u0 - 0.5 && bu <= L.u1 + 0.5;
  };

  // The marks along this path, in the order she passes them.
  const near = [];
  for (const m of marks) {
    const pr = projectEN(samp, cum, m);
    if (pr.beyond || Math.abs(pr.x) > MARK_REACH_M) continue;
    near.push({ m, x: pr.x, s: pr.s });
  }
  if (!near.length) return nil;
  near.sort((a, b) => a.s - b.s);
  // The nearest numbered mark of her channel's count behind and ahead of k ALONG HER ROUTE,
  // the line to it along her track (same hand preferred: a gate partner is across).
  //
  // ⚠ A MARK'S OWN NAMED CHANNEL SPEAKS FIRST. Where marks of its own name stand within
  // MARK_NEIGHBOR_M, only they are read - and if none of them lies along her route, that
  // channel CROSSES it, and its marks are not hers (`crosses`). On his chart Pierce Island
  // Buoys 3 and 5 stand nearly abeam of each other across the route up the Piscataqua; read
  // from South Beacon Shoal 11, another count, buoy 5 was "leaving", sent to starboard, and
  // counted wrong. A single with a name of its own (Cod Rock 5, Goat Island Ledge 9) has no
  // such marks and is read from the harbor's numbering as before.
  // ⚠ A GATE PARTNER IS NEITHER THE MARK BEFORE IT NOR THE ONE AFTER, NOR ITS CHANNEL. The
  // other hand's mark numbered one off, within MARK_GATE_M - however her track crosses the line
  // between them. (An oblique crossing of an entrance gate put the partner 33 m along her route,
  // and the entrance red was read as one whose channel she joins beyond it, wrong hand, unsaid;
  // judged then as "across HER track" - within 30 degrees of square to it - a gate crossed 32
  // degrees off square, and the Ala Wai entrance from the southeast at 50, read the same.)
  const gatePartner = (k, q) => q.side !== k.m.side && q.num != null && k.m.num != null
    && Math.abs(q.num - k.m.num) === 1 && Math.hypot(q.e - k.m.e, q.n - k.m.n) <= MARK_GATE_M;
  const kin = (k) => {
    const m = k.m;
    return m.sys ? marks.filter((q) => q !== m && q.sys === m.sys && q.num != null && q.num !== m.num && !gatePartner(k, q)
      && Math.abs(q.num - m.num) <= MARK_STEP_MAX && Math.hypot(q.e - m.e, q.n - m.n) <= MARK_NEIGHBOR_M) : [];
  };
  // ANOTHER NAMED CHANNEL SPEAKS FOR A MARK ONLY WHERE ITS COUNT CONTINUES THAT MARK'S - every
  // one of its numbers on one side of this mark's (or at it). A cove channel numbered again from 1 read
  // a harbor's red 4 as "leaving" from its own red 2, and she was taken across it and it was
  // counted kept; an entrance gate's 1 and 2 still read the channel's 3 to 8 that follow them.
  //   ⚠ AND NUMBERED ON FROM IT: the count's mark nearest this one carries the count's number
  // nearest this one's. At Bellingham the I and J Street Waterway, 1 to 4 from its entrance
  // beside Starr Rock Buoy 4, lay all below 4 and read the red as "leaving" whichever way she
  // went - and she was taken across it both ways, counted kept.
  const sysMarks = new Map();
  for (const q of marks) if (q.sys && q.num != null) { if (!sysMarks.has(q.sys)) sysMarks.set(q.sys, []); sysMarks.get(q.sys).push(q); }
  //   ... and the same the other way: a single of another name speaks for a mark of a COUNT only
  // where the count's mark nearest it carries the count's number facing the single's (a harbor's
  // single red 4 read a cove's entrance red 2 as "leaving", 1 km on, and counted it wrong).
  const facing = (ms, p, num) => {
    const ns = ms.map((x) => x.num), below = ns.every((x) => x <= num), above = ns.every((x) => x >= num);
    if (!below && !above) return false;
    const d = (x) => Math.hypot(x.e - p.e, x.n - p.n);
    return ms.reduce((a, b) => (d(b) < d(a) ? b : a)).num === (below ? Math.max(...ns) : Math.min(...ns));
  };
  const continues = (k, q) => {
    if (q.sys && q.sys === k.m.sys) return true;                         // its own name
    const qs = q.sys ? sysMarks.get(q.sys) || [] : [], ks = k.m.sys ? sysMarks.get(k.m.sys) || [] : [];
    if (qs.length >= 2) return facing(qs, k.m, k.m.num);
    if (ks.length >= 2 && q.num != null) return facing(ks, q, q.num);
    return true;                                                         // a single and a single
  };
  const neighbors = (k) => {
    let behind = null, ahead = null;
    const own = kin(k);
    const pool = own.length ? near.filter((j) => own.includes(j.m))
      : near.filter((j) => !gatePartner(k, j.m) && continues(k, j.m));
    for (const j of pool) {
      if (j === k || j.m.num == null || j.m.junction) continue;
      const dn = j.m.num - k.m.num, ds = j.s - k.s;
      if (!dn || Math.abs(dn) > MARK_STEP_MAX || Math.abs(ds) < 30 || Math.abs(ds) > MARK_ROUTE_NEIGHBOR_M) continue;
      const line = ds > 0 ? unit(k.m, j.m) : unit(j.m, k.m), trk = ds > 0 ? unit(atS(k.s), atS(j.s)) : unit(atS(j.s), atS(k.s));
      if (!line || !trk) continue;
      // along her route in BOTH senses: in the plane, and in her own stations (a pair 34 m
      // apart along her route and 92 m across it stands ACROSS it, however the 34 m of track
      // between them happens to bend - Pierce Island Buoys 5 and 3 passed the plane test alone)
      const a = Math.min(dot(line, trk), Math.abs(ds) / Math.hypot(ds, j.x - k.x));
      if (a < MARK_ALONG_COS) continue;
      const score = (j.m.side === k.m.side ? 0 : 1e6) + Math.abs(ds);
      const rec = { j, a, score, dir: Math.sign(dn * ds) };
      if (ds > 0) { if (!ahead || score < ahead.score) ahead = rec; }
      else if (!behind || score < behind.score) behind = rec;
    }
    return { behind, ahead, crosses: own.length > 0 && !behind && !ahead };
  };
  // The mark numbered next in the direction she runs (her own hand first): does her channel
  // go on with her? And, `back`, the one numbered before it: did her channel come with her,
  // or does she join it below this mark? (Out of Little Bay at Dover Point she joins the
  // Piscataqua's count at 13; Piscataqua River Buoy 15, 470 m up the river beside her, is not
  // hers, and was sent to starboard close by a 480 m detour.)
  const offChannel = (k, dir, back) => {
    const way = back ? -dir : dir;
    // (a mark abeam of it is its gate partner, not the one before or after it: the green
    // across from the first red of a buoyed channel read as "she joins its channel beyond it")
    const abeam = (m) => {
      if (gatePartner(k, m)) return true;
      const pr = projectEN(samp, cum, m);
      return !pr.beyond && Math.abs(pr.x) <= MARK_REACH_M && Math.abs(pr.s - k.s) < 30;
    };
    const cands = marks.filter((m) => m !== k.m && m.num != null && [1, 2].includes((m.num - k.m.num) * way)
      && Math.hypot(m.e - k.m.e, m.n - k.m.n) < MARK_NEIGHBOR_M && !abeam(m));
    const passes = (m) => {
      const pr = projectEN(samp, cum, m);
      return !pr.beyond && Math.abs(pr.x) <= MARK_REACH_M && (back ? pr.s < k.s - 30 : pr.s > k.s + 30);
    };
    // ITS OWN NAME SPEAKS FOR IT WHERE IT HAS ONE (kin of that name about it): only they say
    // where its channel goes, and where none comes next its channel ends there. (The last
    // green of a second buoyed channel was read from the first channel's red 6, 1.2 km back,
    // and left alone as one she was leaving.) Otherwise any mark of the count that she passes
    // on that side of it says her channel is with her there (Goat Island Ledge 9 has Clark
    // Island Light 8 behind it on her route, and was read from a green 7 off it).
    const pool = kin(k).length ? cands.filter((m) => m.sys === k.m.sys) : cands.filter((m) => continues(k, m));
    if (!pool.length || pool.some(passes)) return false;
    let succ = null, best = MARK_NEIGHBOR_M;
    // its own name and hand first, then its own name, then its hand, then any
    for (const [sys, hand] of [[true, true], [true, false], [false, true], [false, false]]) {
      for (const m of pool) {
        if (sys && !(k.m.sys && m.sys === k.m.sys)) continue;
        if (hand && m.side !== k.m.side) continue;
        const d = Math.hypot(m.e - k.m.e, m.n - k.m.n);
        if (d < best) { best = d; succ = m; }
      }
      if (succ) break;
    }
    if (!succ) return false;
    const u = back ? unit(succ, k.m) : unit(k.m, succ);
    return !!u && dot(u, tanAt(back ? k.s - MARK_COURSE_LOOK_M : k.s + MARK_COURSE_LOOK_M)) < MARK_ALONG_COS;
  };

  const gov = [];
  for (const k of near) {
    // ⚠ A MARK OF THE PAIRS SHE RODE IS THE PAIR LANE'S ONLY WHERE THAT LANE LEFT IT ON ITS
    // PROPER HAND. Up the Piscataqua the pair lane ended between Buoys 12 and 13 and she cut
    // into Little Bay south of 13, a green, 204 m on her starboard hand; it was "ridden as a
    // pair" and nothing said. Such a mark is governed like any other; one the lane did keep
    // is watched (`guard`), so no pass point put in after it moves her across it.
    const laned = lanedMark(k.m);
    const why = (w) => gov.push({ ...k, skip: laned ? 'ridden as a pair' : w });
    if (k.m.junction) { gov.push({ ...k, skip: 'a junction mark: which branch she takes is not known' }); continue; }
    // (a pair's mark in water the chart owns is the chart's, and says so)
    if (ownedAt(k.s)) { gov.push({ ...k, skip: 'in a charted channel (the chart\'s lane governs)' }); continue; }
    const here = atS(k.s);
    const L = Math.abs(k.x), ux = (k.m.e - here.e) / (L || 1), uy = (k.m.n - here.n) / (L || 1);
    let open = true;
    for (let d = 0; d < L - D && open; d += MS) {
      if (blocked({ e: here.e + ux * d, n: here.n + uy * d }, koLand, 0)) open = false;
    }
    if (!open) { why('land between'); continue; }
    if (k.m.num == null) { why('direction of buoyage not known'); continue; }
    const nb = neighbors(k);
    if (nb.crosses) { why('its own channel crosses her route'); continue; }
    const dirs = [nb.behind, nb.ahead].filter(Boolean).map((r) => r.dir);
    if (!dirs.length) { why('direction of buoyage not known'); continue; }
    if (dirs.length === 2 && dirs[0] !== dirs[1]) { why('the numbers either side of it disagree'); continue; }
    const dir = dirs[0];
    // the channel's course past it, as SHE runs it: from the mark behind, to the mark ahead
    const uIn = nb.behind && nb.behind.a >= MARK_COURSE_COS ? unit(nb.behind.j.m, k.m) : tanAt(k.s - MARK_COURSE_LOOK_M);
    const uOut = nb.ahead && nb.ahead.a >= MARK_COURSE_COS ? unit(k.m, nb.ahead.j.m) : tanAt(k.s + MARK_COURSE_LOOK_M);
    const keepStbd = k.m.side * dir > 0, onHand = keepStbd ? k.x > 0 : k.x < 0;
    // ⚠ LEFT ALONE IS NOT LEFT TO BE CROSSED. A mark whose hand is known and that she already
    // has on it is watched (`guard`) though it is not hers to be brought to: no pass point put
    // in for another mark may move her across it, and it has a pass point of its own to be
    // brought in with one that would. Crossing the mouth of Palmer Cove (Salem), the pass at
    // Derby Channel Buoy 4 took her across Palmer Cove Buoy 4, a mark she joins the count of
    // only beyond it, and nothing was said.
    const left = (w) => gov.push({ ...k, dir, uIn, uOut, keepStbd, skip: w, guard: onHand });
    // (a mark the pair lane rides is in HER channel: "it goes on without her" and "she joins it
    // beyond" are not asked of it - asked, and relabeled "ridden as a pair", a red the pair lane
    // left 61 m on its wrong hand was neither governed nor counted)
    if (!laned && offChannel(k, dir, false)) { left('her channel goes on without her here'); continue; }
    if (!laned && offChannel(k, dir, true)) { left('she joins its channel beyond it'); continue; }
    if (laned && onHand) { left('ridden as a pair'); continue; }
    gov.push({ ...k, dir, uIn, uOut, keepStbd, pull: keepStbd && !k.m.fixed });
  }

  // Her pass point at each: D off a mark kept to starboard; a wider berth off one kept to
  // port, but never across the pass line of a buoy kept to starboard beside it (a gate).
  const pulls = gov.filter((k) => k.pull);
  for (const k of gov) {
    if (k.skip && !k.guard) continue;
    let want = D;
    if (!k.keepStbd) {
      want = Math.max(D, MARK_PORT_BERTH * MARK_PASS_M(buf, 0));
      for (const p of pulls) {
        const gap = Math.hypot(p.m.e - k.m.e, p.m.n - k.m.n);
        if (gap < want + D) want = Math.max(D, gap - D);
      }
    }
    // The run past her is two smoothing steps of straight water each way (see runPast), and
    // there is no shorter one than 1.5: where the water has no room for that she is not
    // brought to the mark.
    const place = (uIn, uOut) => {
      for (const half of [2 * SMOOTH, 1.5 * SMOOTH]) {
        for (let off = want; off <= want + MARK_CLEAR_SEARCH_M; off += MS) {
          const r = runPast(k.m, uIn, uOut, k.keepStbd ? -1 : 1, off, half, SMOOTH);
          let ok = r.pts.every((p) => !blocked(p, ko, clr));
          for (let i = 1; ok && i < r.pts.length; i++) ok = clearEN(r.pts[i - 1], r.pts[i], clr);
          if (ok) return { via: r.pts, apex: r.apex, len: r.len, off,
                           span: Math.max(2 * STEP, Math.abs(projectEN(samp, cum, r.apex).x) / LANE_SLEW) + r.len / 2 };
        }
      }
      return null;
    };
    // ⚠ TWO WAYS PAST IT: along the channel's course (from the marks either side), and along
    // HER OWN track there. The first is tried first; the second is there for a pass whose run,
    // laid along a course up to 37 degrees off her track, meets her route at more than
    // MARK_JOIN_MAX_DEG - with the DriX's 5 m buffer on his Go-To, Gangway Rocks Lighted Buoy
    // 13 was left on its wrong hand for want of it.
    const tIn = tanAt(k.s - MARK_COURSE_LOOK_M), tOut = tanAt(k.s + MARK_COURSE_LOOK_M);
    k.runs = [place(k.uIn, k.uOut)];
    if (dot(k.uIn, tIn) < MARK_TRACK_COS || dot(k.uOut, tOut) < MARK_TRACK_COS) k.runs.push(place(tIn, tOut));
    k.runs = k.runs.filter(Boolean);
    k.min = D;                                               // nearer than this is not "kept"
    if (!k.runs.length) { k.unplaced = 'no clear water to pass her in'; continue; }
    Object.assign(k, k.runs[0]);
  }
  const live = gov.filter((k) => !k.skip);
  if (!live.length) return { ...nil, marks: gov };
  // ⚠ A ROUTE THAT BEGINS OR ENDS BESIDE A MARK IS NOT PASSING IT. She goes out to a pass
  // point and comes back no steeper than any other lane eases (LANE_SLEW), and where the
  // route has not that much water before the mark and after it, her berth or her
  // destination is what lies inside the line of marks (Andy, 2026-09-01: "stay right and
  // then aim right at the beginning of the survey"). Asked only of a mark she would have to
  // be MOVED for; one already on its proper hand is counted wherever it stands.
  // ⚠ ... BUT AT A WAYPOINT OF A DRAWN TRANSIT, EXCUSED THE MOVE, NEVER THE COUNT. A transit
  // lanes each leg alone, so every waypoint is a route's end; the marks it ships on their wrong
  // hand there went into neither leg's count, and the banner said "2 marks left to starboard,
  // 2 marks left to port" over a red 100 m on her wrong hand. Which end a mark is near is
  // kept (`nearStart`, `nearEnd`), and `routePlan` counts it where that end is a waypoint
  // between two legs (`markVerdicts`' `ends`); at the route's own start or end - her berth,
  // his destination - it is excused as above where it stands BESIDE that end, no further along
  // from it than MARK_BESIDE_RATIO times it stands off her route (`besideStart`, `besideEnd`: counted there, Cod Rock 5,
  // 133 m along and 216 m off the start of his Go-To, was "1 mark NOT left on the proper hand"),
  // and counted where it does not (a red 266 m on her wrong hand, 900 m on from her start, was
  // excused as her berth's).
  const reach = (k) => {
    if (k.s - k.span >= 0 && k.s + k.span <= total) return true;
    k.skip = 'too near the start or the end of the route';
    k.nearStart = k.s - k.span < 0;
    k.nearEnd = k.s + k.span > total;
    k.besideStart = k.nearStart && k.s <= MARK_BESIDE_RATIO * Math.abs(k.x);
    k.besideEnd = k.nearEnd && total - k.s <= MARK_BESIDE_RATIO * Math.abs(k.x);
    return false;
  };
  const turn = (p, q, r) => {
    const a1 = Math.atan2(q.e - p.e, q.n - p.n), a2 = Math.atan2(r.e - q.e, r.n - q.n);
    return Math.abs((((a2 - a1) * 180 / Math.PI + 540) % 360) - 180);
  };

  // The path through a set of pass points: each mark's run in turn, the search's own path
  // between. A leg that is not clear is routed; one that cannot be drops its mark (counted
  // where it stands) and the rest are tried again. `joins` are the out-indices where her
  // route meets a run, or one run the next.
  const build = (set) => {
    let use = set.slice();
    for (let tries = 0; tries <= set.length; tries++) {
      use.sort((a, b) => a.s - b.s);
      const groups = [];
      for (const k of use) {
        const s0 = Math.max(0, k.s - k.span), s1 = Math.min(total, k.s + k.span);
        const g = groups[groups.length - 1];
        if (g && s0 <= g.s1) { g.s1 = Math.max(g.s1, s1); g.ks.push(k); }
        else groups.push({ s0, s1, ks: [k] });
      }
      const out = [], joins = [];
      const push = (p) => {
        const q = out[out.length - 1];
        if (!q || Math.hypot(p.e - q.e, p.n - q.n) > 0.5) out.push(p);
      };
      let cursor = 0, bad = null;
      for (const g of groups) {
        for (let i = 0; i < N && cum[i] < g.s0; i++) if (cum[i] >= cursor) push(samp[i]);
        // WHERE TWO RUNS MEET, AN END GIVES WAY AND THE PASS POINT NEVER DOES: the end of the
        // first run, the start of the second, or both are dropped, whichever keeps the most of
        // the runs with no turn over MARK_RUN_TURN_DEG (and failing that, the gentlest). The
        // runs are judged in the plane, not by their stations on the routed path.
        const runs = g.ks.map((k) => k.via.map((pt, j) => ({ p: pt, k, mid: j > 0 && j < k.via.length - 1 })));
        for (let j = 1; j < runs.length; j++) {
          const A = runs[j - 1], B = runs[j];
          const As = [A], Bs = [B];
          if (A.length > 1 && !A[A.length - 1].mid) As.push(A.slice(0, -1));
          if (B.length > 1 && !B[0].mid) Bs.push(B.slice(1));
          let best = null;
          for (const x of As) {
            for (const y of Bs) {
              const seq = [...x.slice(-2), ...y.slice(0, 2)];
              let m = 0;
              for (let i = 1; i < seq.length - 1; i++) m = Math.max(m, turn(seq[i - 1].p, seq[i].p, seq[i + 1].p));
              const n = x.length + y.length;
              const better = !best || (m <= MARK_RUN_TURN_DEG ? (best.m > MARK_RUN_TURN_DEG || n > best.n) : (best.m > MARK_RUN_TURN_DEG && m < best.m));
              if (better) best = { x, y, m, n };
            }
          }
          runs[j - 1] = best.x;
          runs[j] = best.y;
        }
        const first = runs[0], last = runs[runs.length - 1];
        if (first.length > 1 && !first[0].mid && projectEN(samp, cum, first[0].p).s <= g.s0) first.shift();
        if (last.length > 1 && !last[last.length - 1].mid && projectEN(samp, cum, last[last.length - 1].p).s >= g.s1) last.pop();
        const chain = [{ p: atS(g.s0) }, ...runs.flat(), { p: atS(g.s1) }];
        push(chain[0].p);
        for (let i = 1; i < chain.length; i++) {
          const A = out[out.length - 1], B = chain[i].p;
          if (clearEN(A, B, buf)) { push(B); if (chain[i].k) joins.push(out.length - 1); continue; }
          // (a leg to a pass point that takes more than a moment to route is not one worth having)
          legs++;
          const sub = legPath(frame.fromEN(A.e, A.n), frame.fromEN(B.e, B.n), frame, ko, buf, { quick: true });
          if (!sub) { bad = chain[i].k || chain[i - 1].k || g.ks[0]; break; }
          for (const q of sub) push(frame.toEN(q));
          if (chain[i].k) joins.push(out.length - 1);
        }
        if (bad) break;
        cursor = g.s1;
      }
      if (bad) {
        bad.unplaced = 'no clear way to her pass point';
        use = use.filter((k) => k !== bad);
        continue;
      }
      for (let i = 0; i < N; i++) if (cum[i] > cursor) push(samp[i]);
      out[0] = samp[0];
      out[out.length - 1] = samp[N - 1];
      return { out, use, joins };
    }
    return { out: samp.slice(), use: [], joins: [] };
  };
  // every mark a pass point must not move her across: the governed, and the pairs' (`guard`)
  const watch = live.concat(gov.filter((k) => k.guard));
  const xsOf = (out) => {
    const c = cumEN(out), m = new Map();
    for (const k of watch) m.set(k, projectEN(out, c, k.m).x);
    return m;
  };
  const proper = (k, x) => (k.keepStbd ? x > 0 : x < 0);
  // Asked AT the kept vertices only (every run point is one): a vertex of her own route beside
  // them is the smoothing's to round. (The first cut asked one either side as well, and refused
  // Little Bay Buoy 4A for a 50 degree bend in her route 600 m on, where the run rejoined it.)
  const joinsOK = (t) => {
    for (const j of t.joins) {
      if (j < 1 || j > t.out.length - 2) continue;
      if (turn(t.out[j - 1], t.out[j], t.out[j + 1]) > MARK_JOIN_MAX_DEG) return false;
    }
    return true;
  };
  // What a mark still wants: the buoys she keeps close, brought to their pass distance;
  // everything else, off the wrong hand or out from nearer than it should be.
  const wants = (k, x) => {
    if (k.unplaced || k.skip) return false;
    if (k.pull) return !(x >= k.off - 0.5 && x <= k.off + 5);
    return !proper(k, x) || (k.keepStbd ? x < k.min - 0.5 : x > -(k.min - 0.5));
  };
  let res = { out: samp.slice(), use: [], joins: [] };
  let xs = xsOf(res.out);
  // ⚠ A MARK ON ITS WRONG HAND IS SEEN TO BEFORE ONE THAT IS ONLY NOT CLOSE: the wrong hand
  // is the breach, the close pass a courtesy. With the set at 1.75 kn Eight-Foot Rock Buoy 2's
  // close pass was placed first, and Fox Point Rock Buoy 3, round the bend 210 m on, could no
  // longer be joined and was left on its wrong hand.
  for (const wrongOnly of [true, false]) for (let round = 0; round < 2; round++) {
    let grew = false;
    for (const k of live) {
      if (res.use.includes(k) || k.clash || !wants(k, xs.get(k)) || (wrongOnly && proper(k, xs.get(k))) || !reach(k)) continue;
      if (legs >= MARK_STAGE_LEGS) { k.unplaced = 'past the stage\'s limit of routed legs'; continue; }
      let done = null;
      for (const run of k.runs) {
        Object.assign(k, run); delete k.unplaced; delete k.clash;   // (each way past it judged afresh)
        let t = build(res.use.concat(k));
        if (!t.use.includes(k)) continue;                       // unplaced: counted where it stands (or the next way)
        let nx = xsOf(t.out);
        // ⚠ A PASS POINT THAT WOULD PUT A MARK SHE ALREADY KEEPS ON ITS WRONG HAND BRINGS THAT
        // MARK'S OWN PASS POINT WITH IT, and the two are tried together. Out of Little Bay the run
        // to Fox Point Rock Buoy 3 began before The Rocks Buoy 4 and crossed her to its wrong
        // side; The Rocks 4 had needed no pass point of its own, so the first cut dropped buoy 3.
        // (Asked as a pure test: `reach` marks a mark it fails as skipped, and a mark already
        // kept is counted where it stands.)
        const fits = (q) => q.via && !q.unplaced && (!q.skip || q.guard) && q.s - q.span >= 0 && q.s + q.span <= total;
        for (let more = 0; more < 2; more++) {
          const broken = watch.filter((q) => !t.use.includes(q) && proper(q, xs.get(q)) && !proper(q, nx.get(q)));
          if (!broken.length || !broken.every(fits)) break;
          const t2 = build(t.use.concat(broken));
          if (!t2.use.includes(k)) break;
          t = t2; nx = xsOf(t.out);
        }
        const breaks = watch.find((q) => proper(q, xs.get(q)) && !proper(q, nx.get(q)));
        const clash = breaks ? 'it would put ' + markName(breaks.m) + ' on the wrong hand'
          : !t.use.every((q) => proper(q, nx.get(q))) ? 'its pass point and another\'s cannot both be kept'
          : !joinsOK(t) ? 'no join to her route under ' + MARK_JOIN_MAX_DEG + ' degrees' : null;
        if (clash) { k.clash = clash; continue; }
        done = { t, nx }; break;
      }
      if (!done) { Object.assign(k, k.runs[0]); continue; }
      delete k.clash;
      res = done.t; xs = done.nx; grew = true;
    }
    if (!grew) break;
  }
  const used = res.use.length > 0;
  return { path: used ? res.out.map((p) => frame.fromEN(p.e, p.n)) : pathLL, used, marks: gov,
           keep: res.use.flatMap((k) => k.via), pass: res.use.flatMap((k) => (k.via.length > 2 ? k.via.slice(1, -1) : k.via)),
           passM: D };
}

/**
 * Where each mark the route was shaped for ended up against a FINISHED route: `kept` on
 * its proper hand (`stbd` of them to starboard, `port` to port) or `wrong`.
 *
 * Asked of the route that ships, after the smoothing, the gate and the knot prune, because
 * a claim about which side of a buoy she passes is only worth making about the track she
 * will run.
 */
export function marksKept(routeLL, frame, marks) {
  return tallyMarks(markVerdicts(routeLL, frame, marks));
}

/** Each counted mark against a route: `{k, x, proper}` (x positive to starboard). `ends`
 *  ({start, end}) says which of the route's ends is a waypoint between two legs of a drawn
 *  transit, where a mark too near it to be moved for is counted all the same (`markCounted`). */
export function markVerdicts(routeLL, frame, marks, ends = null) {
  const live = (marks || []).filter((k) => markCounted(k, ends));
  if (!live.length || !routeLL || routeLL.length < 2) return [];
  const en = routeLL.map((p) => frame.toEN(p)), cum = cumEN(en);
  return live.map((k) => {
    const x = projectEN(en, cum, k.m).x;
    return { k, x, proper: k.keepStbd ? x > 0 : x < 0 };
  });
}

/** The count of a set of verdicts: `kept` (`stbd` / `port`), `wrong`, and the buoys kept to
 *  starboard (`buoys`) of which `close` are passed within MARK_PASS_M (+5 m) - the pass
 *  distance the stage asks for (`k.min`), not wherever it found clear water: "passed close"
 *  was said of a buoy there was none to bring her to, shipped 35 m off. */
export function tallyMarks(verdicts) {
  const out = { kept: 0, wrong: 0, stbd: 0, port: 0, buoys: 0, close: 0 };
  for (const { k, x, proper } of verdicts || []) {
    if (!proper) { out.wrong++; continue; }
    out.kept++;
    if (k.keepStbd) out.stbd++; else out.port++;
    if (k.pull) { out.buoys++; if (k.min != null && x <= k.min + 5) out.close++; }
  }
  return out;
}

/** A mark the count speaks for: one the marks stage governed, or one it would not move her for
 *  because the route begins or ends too near it (`reach`) - excused the move, never the count -
 *  unless it stands beside the route's own start or end (her berth, his destination; `ends`
 *  says which of the route's ends is instead a waypoint between two legs of a drawn transit). */
export function markCounted(k, ends = null) {
  if (!k.skip) return true;
  const start = k.nearStart && ((ends && ends.start) || !k.besideStart);
  const end = k.nearEnd && ((ends && ends.end) || !k.besideEnd);
  return !!(start || end);
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
 *
 * `opts.keep` (2026-10-03): EN points that are VERTICES of the path and stay exactly where
 * they are - the run past a lateral mark (`markPassRoute`). The path is resampled between
 * them, so each is still a vertex afterwards, and the rounding leaves them alone. A run is
 * built with nothing sharp enough to need rounding; what it cannot survive is being
 * resampled across, which moved a 40 m step round a mark to 1 m off it on the other hand.
 * With no `keep` this is the function it always was.
 */
export function smoothTrack(pathLL, frame, ko, buf, opts = {}) {
  if (!pathLL || pathLL.length < 2) return pathLL;
  const en = pathLL.map((p) => frame.toEN(p));
  const STEP = Math.max(45, buf * 13);
  const keep = opts.keep || [];
  const kept = (p) => keep.some((q) => Math.hypot(p.e - q.e, p.n - q.n) < 0.75);
  // Resampled piece by piece between the kept vertices (one piece, the whole path, with none).
  let pts = [];
  const fixed = [];
  for (let i = 0, from = 0; i < en.length; i++) {
    if (i < en.length - 1 && !(i > from && kept(en[i]))) continue;
    const rs = resampleEN(en.slice(from, i + 1), STEP);
    const piece = rs ? rs.pts : [en[i]];
    for (let j = pts.length ? 1 : 0; j < piece.length; j++) { pts.push(piece[j]); fixed.push(false); }
    if (i < en.length - 1) fixed[pts.length - 1] = true;
    from = i;
  }
  if (keep.length && kept(en[0])) fixed[0] = true;
  if (pts.length < 3) return pathLL;
  const hit = (e, n) => blocked({ e, n }, ko, buf);
  for (let pass = 0; pass < 2; pass++) {
    const np = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const s = {
        e: 0.25 * pts[i - 1].e + 0.5 * pts[i].e + 0.25 * pts[i + 1].e,
        n: 0.25 * pts[i - 1].n + 0.5 * pts[i].n + 0.25 * pts[i + 1].n,
      };
      np.push(fixed[i] || hit(s.e, s.n) ? pts[i] : s);
    }
    np.push(pts[pts.length - 1]);
    pts = np;
  }
  return pts.map((p) => frame.fromEN(p.e, p.n));
}

/** A gate patch longer than this many times the search's own way between the same two points
 *  (plus GATE_PATCH_SLACK_M) is not taken: that way is spliced instead (see gateLegClear). */
export const GATE_PATCH_RATIO = 2;
export const GATE_PATCH_SLACK_M = 200;

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
 * ⚠⚠ AND IT COVERS THE BLOCKED WATER SHE IS LED OUT OF, NOT THE LEG THAT LEADS HER. The test
 * after that was "the FIRST block along the leg is within 2·buf of the blocked endpoint", and
 * from a berth inside the buffer the first block along any leg out of it is the berth itself,
 * 0 m from the start - so the whole leg was waved through, and whatever it crossed further on
 * was never asked about. Out of a berth up a charted fairway the chart's lane bent the first
 * leg past a pile 1.7 m off with a 3 m buffer, and with the pile a 6 x 6 m dolphin the leg ran
 * THROUGH it, 27.8 m from the start. Now the exempt water is the run of blocked water her
 * route is in, contiguous with the blocked start (or goal) along the route itself (`inLead`,
 * `inTrail`), AND NEVER NEARER WHAT BLOCKS IT THAN THAT ENDPOINT IS (less a quarter of the
 * buffer): she is led out of the water she lies in, not along it closer in. The rest of the
 * leg is asked like any other, and spliced where it fails. (Capped at 2·buf from the endpoint
 * instead, a Go-To starting 11 m off the land inside a 19.5 m standoff - its first leg leaving
 * that land's standoff at 51 m - was spliced into a 110 degree turn 34 m from the start.)
 *
 * A spliced patch is the router's own product and is NOT re-checked: the gate exists to
 * catch the lane's inventions, and re-checking a patch whose ends sit in-buffer would loop.
 */
export function gateLegClear(route, fallback, frame, ko, buf, opts = {}) {
  if (!route || route.length < 2) return { route, abandoned: false, splices: 0 };
  const start = route[0], goal = route[route.length - 1];
  // Asked ONCE, and they are the whole of the exemption's warrant - see the note above.
  const startIn = blocked(frame.toEN(start), ko, buf);
  const goalIn = blocked(frame.toEN(goal), ko, buf);
  const out = route.slice();
  const STEP = Math.max(0.25, buf / 6);
  const pts = (A, B) => {
    const a = frame.toEN(A), b = frame.toEN(B), n = Math.max(1, Math.ceil(Math.hypot(b.e - a.e, b.n - a.n) / STEP));
    return Array.from({ length: n + 1 }, (_, k) => ({ e: a.e + (b.e - a.e) * k / n, n: a.n + (b.n - a.n) * k / n }));
  };
  // every point of her route from the start to out[j] (from out[j] to the goal) is blocked
  const allBlocked = (P, Q) => pts(P, Q).every((q) => blocked(q, ko, buf));
  const inLead = (j) => { for (let k = 1; k <= j; k++) if (!allBlocked(out[k - 1], out[k])) return false; return true; };
  const inTrail = (j) => { for (let k = j + 1; k < out.length; k++) if (!allBlocked(out[k - 1], out[k])) return false; return true; };
  // the leg out[i-1] -> out[i] is clear but for the blocked run it begins in at a blocked start, or
  // ends in at a blocked goal, no nearer what blocks it than that endpoint is (`clearOf`: the
  // largest radius clear round a point, to 0.05 m)
  const clearOf = (p) => { let lo = 0, hi = buf; for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (blocked(p, ko, m)) hi = m; else lo = m; } return lo; };
  const S0 = frame.toEN(start), G0 = frame.toEN(goal);
  const sNear = startIn ? clearOf(S0) - buf / 4 : 0, gNear = goalIn ? clearOf(G0) - buf / 4 : 0;
  // ... and in a gate whose margin stands above the law the route has already passed (the
  // standoff's re-gate, `opts.floor` the buffer), the run may come as near as that law: asked
  // there no nearer than the endpoint less a quarter of the standoff, a start 10.8 m off land
  // whose leg came in to 4.9 m was spliced into a 3 m dog-leg and a 101 degree turn.
  const lowFloor = opts.floor != null && opts.floor < buf;
  const sLim = lowFloor ? opts.floor : sNear, gLim = lowFloor ? opts.floor : gNear;
  const noNearer = (q, r) => r <= 0 || !blocked(q, ko, r);
  // the search's own way from (near) A to (near) B, joined to them by clear legs, or null
  const fbEN = (fallback || []).map((p) => frame.toEN(p)), fbCum = fbEN.length > 1 ? cumEN(fbEN) : null;
  const lenLL = (r) => { let L = 0; for (let k = 1; k < r.length; k++) L += frame.distTo(r[k - 1], r[k]); return L; };
  const viaFallback = (A, B) => {
    if (!fbCum) return null;
    const sa = projectEN(fbEN, fbCum, frame.toEN(A)).s, sb = projectEN(fbEN, fbCum, frame.toEN(B)).s;
    if (!(sb > sa)) return null;
    const atS = (s) => {
      let k = 1;
      while (k < fbEN.length - 1 && fbCum[k] < s) k++;
      const a = fbEN[k - 1], b = fbEN[k], L = fbCum[k] - fbCum[k - 1] || 1, t = Math.max(0, Math.min(1, (s - fbCum[k - 1]) / L));
      return frame.fromEN(a.e + (b.e - a.e) * t, a.n + (b.n - a.n) * t);
    };
    const pts = [atS(sa)];
    for (let k = 1; k < fbEN.length - 1; k++) if (fbCum[k] > sa && fbCum[k] < sb) pts.push(fallback[k]);
    pts.push(atS(sb));
    if (frame.distTo(pts[pts.length - 1], B) < 0.5) pts.pop();          // (B is put back by the splice)
    if (pts.length && frame.distTo(A, pts[0]) < 0.5) pts.shift();
    if (!pts.length || !legClear(A, pts[0], frame, ko, buf) || !legClear(pts[pts.length - 1], B, frame, ko, buf)) return null;
    return { pts, len: sb - sa };
  };
  const exempt = (i) => {
    const s = pts(out[i - 1], out[i]), bl = s.map((q) => blocked(q, ko, buf));
    let lo = 0, hi = s.length - 1;
    if (startIn && bl[0] && inLead(i - 1)) while (lo <= hi && bl[lo] && noNearer(s[lo], sLim)) lo++;
    if (goalIn && bl[hi] && inTrail(i)) while (hi >= lo && bl[hi] && noNearer(s[hi], gLim)) hi--;
    if (lo === 0 && hi === s.length - 1) return false;                   // in neither run
    if (lo > hi) return true;                                            // all of it is
    return legClear(frame.fromEN(s[lo].e, s[lo].n), frame.fromEN(s[hi].e, s[hi].n), frame, ko, buf);
  };
  let splices = 0;
  for (let i = 1; i < out.length;) {
    if (legClear(out[i - 1], out[i], frame, ko, buf)) { i++; continue; }
    if ((startIn || goalIn) && exempt(i)) { i++; continue; }
    if (++splices > 20) return { route: fallback.slice(), abandoned: true, splices };
    let j = i;
    while (j < out.length - 1 && !legClear(out[j], out[j + 1], frame, ko, buf)) j++;
    // ⚠ A PATCH OUT OF HER BLOCKED START (OR INTO HER BLOCKED GOAL) IS ROUTED AT THAT ENDPOINT'S
    // OWN EXEMPT RADIUS (`sNear` / `gNear`, no nearer than `opts.floor`, the buffer), not at the
    // full margin: there legPath snaps the endpoint to a free cell, often behind it, and in a
    // 19.5 m standoff the patch hooked round its start - 157 degrees 14 m out, 172 at a goal. At
    // the buffer the floor is the margin, and nothing changes.
    const floor = Math.min(buf, opts.floor ?? buf);
    const fromStart = startIn && inLead(i - 1), toGoal = goalIn && j === out.length - 1;
    const pr = Math.max(floor, Math.min(buf, fromStart ? sNear : buf, toGoal ? gNear : buf));
    let patch = legPath(out[i - 1], out[j], frame, ko, pr);
    if (!patch) return { route: fallback.slice(), abandoned: true, splices };
    // (and knot-pruned at that radius: the router's first point, its start cell's middle, can lie
    // 3 m behind her, a 101 degree turn the prune at the margin cannot cut - from inside the
    // margin no corner is clear at it)
    if (pr < buf) patch = pruneStitch([out[i - 1], ...patch], frame, ko, pr).slice(1);
    // ⚠ A PATCH IS BOUNDED BY THE WAY THE SEARCH ITSELF WENT. Two lane points 89 m apart, a
    // leg between them inside a 19.5 m standoff, and the patch went round the land: 10.6 km,
    // and a 2.4 km Go-To shipped as 12.5 km, 550 m behind its start. Where a patch is longer
    // than GATE_PATCH_RATIO times the search's own way between the same two points (plus
    // GATE_PATCH_SLACK_M), that way is spliced instead, joined to them by clear legs - or,
    // where it cannot be, the lane is given up for the search's route, as when no patch is
    // found at all.
    const fb = viaFallback(out[i - 1], out[j]);
    const plen = lenLL([out[i - 1], ...patch]), ref = fb ? fb.len : frame.distTo(out[i - 1], out[j]);
    if (plen > GATE_PATCH_RATIO * ref + GATE_PATCH_SLACK_M) {
      if (!fb) return { route: fallback.slice(), abandoned: true, splices };
      patch = [...fb.pts, out[j]];
    }
    out.splice(i, j - i + 1, ...patch);
    i += patch.length;
  }
  return { route: out, abandoned: false, splices };
}


/**
 * The whole pipeline: the buoy-pair lane and the unmarked lane as they always were, the
 * marks in water the chart does not ride, the chart's own lane over the water it does,
 * then smooth, then the gate, then the knot prune.
 *
 * THE CHART COMES FIRST BY GOING LAST (2026-10-04, "any given ASV should recognize a channel
 * from the ENC before relying on buoy placement"). `chartOwnership` decides once which
 * samples the chart's lane rides; the marks stage leaves those marks to it; and
 * `chartedChannelLane` overrides those samples last, whatever the pair lane or the banks
 * made of them, leaving every other vertex - the pair lane's, the banks', the marks' runs -
 * where it was laid. Where the chart's lane declines water (a wide fairway, a basin), the
 * stages before it lane her there as they always did: nothing stands down for it.
 *
 * THE KNOT PRUNE LIVES IN THE PRODUCER. A gate SPLICE SEAM can fold a reversal
 * knot — the patch rejoins the lane a few meters BEHIND where it left, and the
 * shipped route then demands a ~180° turn in less water than any hull can turn
 * in. Flown at Lewes as a full 360° orbit at the mouth of Roosevelt Inlet.
 * Pruning here means every consumer inherits it, the same producer-not-consumers
 * rule as the gate itself. The marks' runs are KEPT through it (`keep`).
 *
 * @returns {{route:Array, lane:boolean, partial:boolean, how:object, marks:Array, keep:Array}}
 *   `partial` = a lane was ridden but NOT over every channel this route ran along, the
 *   chart's lane was not delivered over some of the water it owns, or a mark was left on the
 *   wrong hand. `how` says which: `pairs`, `charted`, `narrow`, the count of `marks` kept and
 *   wrong, `chartedShortM` (owned water crossed left of its middle) and `gaps` (the part of
 *   `partial` that is not about a mark). `marks` is `markPassRoute`'s own list, for a caller
 *   that changes the route afterwards and has to count again (`marksKept`); `keep` the runs'
 *   pass points (their ends give way), for the same caller's own knot prune.
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
  // ⚠ `opts.charted === false` and `opts.marks === false`: A MANEUVER IS LANED AS IT ALWAYS
  // WAS. A way round a contact, a way back onto a line and a way back onto station are a few
  // hundred meters of avoidance, not a passage up a channel: neither bulged toward a charted
  // channel's starboard quarter nor sent off to a buoy half a kilometer away. With both off
  // this is the pipeline of 2026-10-02 but for the gate's own law, which no lane owns and every
  // route shares: the water she is led out of (or into) at a blocked endpoint, the patch at its
  // own radius and bounded by the search's way, and no leg into a snapped endpoint through a
  // keep-out (gateLegClear, legPath, 2026-10-04). (passage.js sets them; nothing else does.)
  const chartOn = laneWanted && opts.charted !== false;
  const marksOn = laneWanted && opts.marks !== false;
  const marked = laneWanted ? buoyChannelLane(pathLL, frame, ko, buf)
                            : { path: pathLL, used: false };
  const unmarked = laneWanted ? narrowChannelLane(marked.path, frame, ko, buf, opts)
                              : { path: marked.path, used: false };
  // ⚠ IN A SET THE CHART'S LANE POINTS ARE LAID CLEAR OF THE GUARD'S STANDOFF where the channel
  // has one right of its middle, as the marks' runs are: laid at the buffer, its legs came 16
  // times inside a 19.5 m standoff where the banks' lane's came twice, and every one was the
  // standoff re-gate's to splice (see gateLegClear). Where it has none, at the buffer as before:
  // eased toward the search's path instead, she was taken left of the middle.
  const clr = Math.max(buf, opts.standoffM || 0);
  const own = chartOn ? chartOwnership(unmarked.path, frame, ko, buf, pathLL, clr) : null;
  const passed = marksOn
    ? markPassRoute(unmarked.path, frame, ko, buf, { standoffM: opts.standoffM, laned: marked.laned, own })
    : { path: unmarked.path, used: false, marks: [], keep: [] };
  const keep = passed.keep || [];
  const charted = chartOn
    ? chartedChannelLane(passed.path, frame, ko, buf, { hold: keep, own: passed.used ? null : own, base: pathLL, clr })
    : { path: passed.path, used: false, own: null };
  const smoothed = smoothTrack(charted.path, frame, ko, buf, { keep });
  const g = gateLegClear(smoothed, pathLL, frame, ko, buf);
  const stubs = marksOn || chartOn;                          // (see pruneStitch: a maneuver prunes as it did)
  // ⚠ THE KNOT PRUNE KEEPS A RUN'S PASS POINT, NOT ITS ENDS (`pass`) - an end gives way and the
  // pass point never does (markPassRoute). With every vertex kept, a standoff splice that
  // overshot a run's first vertex and turned back onto it shipped a Z: 101 degrees, 12.6 m,
  // 106 degrees; pruned, the marks are counted the same. (The smoothing and the chart's hold
  // keep them all: neither may bend a run.)
  const pass = passed.pass || keep;
  const clean = pruneStitch(g.route, frame, ko, buf, { keep: pass, stubs });
  const mk = marksKept(clean, frame, passed.marks);
  // An abandoned lane ships the pre-lane input, and no claim about it stands (see gateLegClear).
  const ridden = !g.abandoned;
  const ride = ridden && charted.used ? chartedRide(clean, frame, charted.own) : { ownedM: 0, shortM: 0 };
  const short = ride.shortM > Math.max(2 * (charted.own ? charted.own.STEP : 25), 0.05 * ride.ownedM);
  // (and the chart's lane is not CLAIMED where most of the water it owns was crossed short of
  // it: "right of center in the charted channel" over a route that rode 2,225 m of 2,225 m
  // short of it is a claim the operator would have checked - PARTIAL says the rest)
  const used = ridden && (marked.used || charted.used || unmarked.used || mk.kept > 0);
  // A SECOND BUOYED CHANNEL IS NO LONGER RIDDEN DOWN ITS MIDDLE UNSAID: its marks are kept
  // one by one, or the chart's lane rides it. It is still a gap where neither did.
  const sameMark = (a, b) => a.side === b.side && Math.hypot(a.e - b.e, a.n - b.n) < 3;
  const stray = (marked.others || []).filter((sy) => !passed.marks.some((k) => (!k.skip || /charted channel/.test(k.skip))
    && [...(sy.port || []), ...(sy.stbd || [])].some((m) => sameMark(m, k.m))));
  const gaps = !!marked.patchy || stray.length > 0 || g.splices > 0 || short;
  // ⚠ THE PAIR LANE IS CLAIMED ONLY WHERE IT STANDS. Where every vertex it moved lies in water
  // the chart's lane owns (or eases off past), the line she rides there is the chart's, and
  // "channel lane, centerline to port" was said of buoys 300 m apart round a 200 m fairway
  // whose quarter line she was actually on. AND THE BANKS' LANE THE SAME: a 60 m charted cut
  // between banks 120 m apart was ridden on the chart's quarter line and said as the banks'
  // lane too. (`stands(moved, from)`: some vertex `moved` moved off `from` lies in water the
  // chart does not ride.)
  const stands = (moved, from) => !(charted.used && charted.own && (() => {
    const O = charted.own, base = from.map((p) => frame.toEN(p)), bc = cumEN(base);
    for (const p of moved) {
      const q = frame.toEN(p);
      if (Math.abs(projectEN(base, bc, q).x) < 1) continue;                // not one the lane moved
      let bi = 0, bd = Infinity;
      for (let i = 0; i < O.N; i++) { const d = Math.hypot(O.samp[i].e - q.e, O.samp[i].n - q.n); if (d < bd) { bd = d; bi = i; } }
      if (!(O.own[bi] || O.ramp[bi])) return false;
    }
    return true;
  })());
  const pairsStand = !!marked.used && stands(marked.path, pathLL);
  const narrowStand = !!unmarked.used && stands(unmarked.path, marked.path);
  return {
    route: clean,
    lane: used,
    partial: (gaps || mk.wrong > 0) && used,
    how: { pairs: ridden && pairsStand, charted: ridden && !!charted.used && ride.shortM <= ride.ownedM / 2,
           narrow: ridden && narrowStand, marks: mk, gaps: gaps && used,
           chartedShortM: ride.shortM },
    marks: passed.marks,
    keep: pass,
    stubs,
    chartOwn: ridden && charted.used ? charted.own : null,   // (for a caller that re-gates: chartedRide)
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
