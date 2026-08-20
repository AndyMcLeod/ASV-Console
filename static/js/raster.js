/* ========================================================================
 * VENDORED FROM asv_core -- DO NOT EDIT THIS COPY.
 *
 *   source : asv_core_js/raster.js
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
 * stampSeg, dilateGrid and rasterKeepouts. passage.js re-exports them, so
 * asv.html and the two suites that require them are untouched.
 *
 * MEASURED IDENTICAL BEFORE THE MOVE: stampSeg 0 of 60 grids differ,
 * dilateGrid 0 of 40, rasterKeepouts 0 of 3072 cells (948 blocked). The
 * signatures matched on both sides too, so nothing needed adapting.
 *
 * THE REST OF passage.js DID NOT MOVE, AND THE REASON IS ONE PARAMETER.
 * legPath, routeAround, routeAroundSeg, smoothTrack, gateLegClear,
 * pruneStitch, buoyChannelLane, narrowChannelLane, channelLaneRoute,
 * channelSpanKeepouts and channelTurnKeepouts are the same functions as
 * WorldView's except that this console passes a bare ref POINT where it
 * passes a frame. That is a calling convention to settle, not a merge.
 *
 * Edit the core file and re-run the sync. Everything below is verbatim.
 */

/**
 * The routing grid: turning a keep-out model into cells a search can walk.
 *
 * `rasterKeepouts` paints the model into a byte grid, `stampSeg` draws one
 * segment into it, and `dilateGrid` grows the painted cells by the keep-clear
 * buffer. Nothing here knows about latitude, longitude or a frame — the model
 * arrives already in ENU metres and the grid is indexed in cells. That is why
 * these three could be shared when the rest of the routing layer could not.
 *
 * MEASURED IDENTICAL BEFORE THE MOVE, 2026-08-19. The ASV console and WorldView
 * each had all three with the SAME signatures, and run side by side:
 *
 *     stampSeg         0 of 60 grids differ
 *     dilateGrid       0 of 40 grids differ
 *     rasterKeepouts   0 of 3072 cells differ (948 blocked)
 *
 * The bodies here are WorldView's, which are the same code with the reasoning
 * written down.
 *
 * THE REST OF THE ROUTING LAYER IS NOT LIKE THESE, and the difference is one
 * parameter. `legPath`, `routeAround`, `routeAroundSeg`, `smoothTrack`,
 * `gateLegClear`, `pruneStitch`, `buoyChannelLane`, `narrowChannelLane`,
 * `channelLaneRoute`, `channelSpanKeepouts` and `channelTurnKeepouts` are the
 * same functions in both consoles except that ASV takes a bare `ref` point where
 * WorldView takes a `frame`. Settling that is a calling-convention decision, not
 * a merge — see the handoff.
 */

/** Stamp a segment into the grid, one cell per step, with no gaps. */
export function stampSeg(blk, W, H, x0, y0, cell, a, b) {
  const ax = (a.e - x0) / cell, ay = (a.n - y0) / cell;
  const bx = (b.e - x0) / cell, by = (b.n - y0) / cell;
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const gx = Math.round(ax + (bx - ax) * t);
    const gy = Math.round(ay + (by - ay) * t);
    if (gx >= 0 && gy >= 0 && gx < W && gy < H) blk[gy * W + gx] = 1;
  }
}

/**
 * Separable box dilation by `rad` cells, in place.
 *
 * This is what turns the keep-out stamps into keep-out-plus-clearance, so the
 * search never has to test the buffer itself. Two 1-D passes rather than one
 * 2-D pass: same result, O(rad) instead of O(rad²) per cell.
 */
export function dilateGrid(blk, W, H, rad) {
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

/**
 * Burn the keep-out model into an occupancy grid.
 *
 * Scanline-fill the polygons, stamp the lines and the hazard discs, then dilate
 * by the buffer. Build cost is about O(edges + filled cells) rather than the
 * O(cells × polygons) of testing every cell against every polygon — which is
 * what used to force a cell so coarse it could not thread a channel.
 */
export function rasterKeepouts(blk, W, H, x0, y0, cell, ko, buffer) {
  const X1 = x0 + W * cell, Y1 = y0 + H * cell;
  const gxOf = (e) => (e - x0) / cell;
  const gyOf = (n) => (n - y0) / cell;

  for (const poly of ko.polys) {
    const bb = poly.bb;
    if (bb.x1 < x0 || bb.x0 > X1 || bb.y1 < y0 || bb.y0 > Y1) continue;   // window cull
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
    // The EDGES as well as the fill: a sliver narrower than a cell has no
    // scanline crossing pair to fill, so without this it is simply not there.
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
      stampSeg(blk, W, H, x0, y0, cell, rg[j], rg[i]);
    }
  }

  for (const ln of ko.lines) {
    const bb = ln.bb;
    if (bb.x1 < x0 || bb.x0 > X1 || bb.y1 < y0 || bb.y0 > Y1) continue;
    for (let i = 1; i < ln.pts.length; i++) {
      stampSeg(blk, W, H, x0, y0, cell, ln.pts[i - 1], ln.pts[i]);
    }
  }

  // Each point hazard as a DISC of its OWN extent; the dilation below then adds
  // the margin. A single-cell stamp would let the search plan straight through
  // a 50 m wreck that `legClear` then rejects — and the leg would just fail,
  // with the router insisting there was a way through.
  for (const pt of ko.points) {
    const gx = Math.round(gxOf(pt.e)), gy = Math.round(gyOf(pt.n));
    const rc = Math.round((pt.r || 0) / cell);
    if (rc <= 0) {
      if (gx >= 0 && gy >= 0 && gx < W && gy < H) blk[gy * W + gx] = 1;
      continue;
    }
    for (let dy = -rc; dy <= rc; dy++) {
      const gyy = gy + dy;
      if (gyy < 0 || gyy >= H) continue;
      const half = Math.floor(Math.sqrt(Math.max(0, rc * rc - dy * dy)));
      const gxa = Math.max(0, gx - half), gxb = Math.min(W - 1, gx + half);
      for (let gxx = gxa; gxx <= gxb; gxx++) blk[gyy * W + gxx] = 1;
    }
  }

  dilateGrid(blk, W, H, Math.max(1, Math.round(buffer / cell)));
}
