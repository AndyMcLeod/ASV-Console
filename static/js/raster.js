/* ========================================================================
 * ⚠⚠ ASV OWNS THIS FILE NOW (2026-09-21). DO NOT RE-VENDOR IT.
 *
 * Andy, 2026-08-31: "stop updating other projects. We concentrate only on ASV
 * Console moving forward. There may be components of other projects that we
 * pull over." The flow is ONE WAY: asv_core is a place to pull FROM, never a
 * place this repo writes back to. The vendor header below is kept for
 * PROVENANCE -- it records where this body came from -- and its instruction is
 * now wrong for this repo, in the same dangerous way it was already wrong for
 * keepouts.js, routing.js and core_turns.js:
 *
 *   ⚠ RUNNING `python tools/vendor.py` IN THE asv_core REPO WOULD OVERWRITE
 *     THIS FILE. If a `--check` there reports this copy as DRIFTED, that is
 *     correct and expected: it has drifted, on purpose, and here is the whole
 *     of it.
 *
 *       1. `stampSeg` takes a `pad` and CLAMPS instead of dropping, and both
 *          window culls are padded to match (2026-09-21). Grid points span
 *          [x0, x0+(W-1)*cell] while the cull ran to x0+W*cell, so a feature
 *          just outside was culled AND every sample of it rounded to -1, and
 *          one inside the window past the last row's center rounded to H. The
 *          dilation had nothing to grow and the boundary row stayed FREE --
 *          which is the one direction this grid must never be wrong in, because
 *          routing.js relies on it over-approximating and legPath never
 *          re-checks a raster-clear leg. Measured: three commanded legs whose
 *          closest approach was 1.80 m at a 3 m buffer.
 *
 * The body here is asv_core's own, pulled across at 2a0b53d, so this copy is
 * NOT carrying a private fix -- it is ahead of nothing. The header is what
 * stops a future `vendor.py` run from being harmless-looking.
 * ======================================================================== */
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
 * arrives already in ENU meters and the grid is indexed in cells. That is why
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

/**
 * Stamp a segment into the grid, one cell per step, with no gaps.
 *
 * `pad` is a margin IN CELLS. A sample landing inside it is CLAMPED to the edge
 * rather than dropped, which is what keeps the boundary rows honest: the grid's
 * own points span [x0, x0+(W-1)*cell], so a hazard just outside that — or inside
 * the window but past the last row's center — rounded to gx/gy = -1 or W/H and
 * was thrown away, leaving the boundary row FREE with the dilation then having
 * nothing to grow. Measured on a 100x100 grid at 3 m: a quay 1.8 m below the
 * first row left 100 cells the exact `blocked()` test refuses, and `legPath`
 * shipped three commanded legs whose closest approach was 1.80 m at a 3 m buffer.
 *
 * ⚠ THE TEST IS PER SAMPLE, NOT PER FEATURE, and that is what stops the clamp
 * dragging distant geometry onto the edge: a landmass 5 km outside still paints
 * exactly what it painted before. Clamping over-approximates by up to `pad` cells
 * on the outermost rows, which is the direction routing.js already relies on —
 * "over-approximates the keep-outs, so a raster-clear shortcut is genuinely
 * clear". Under-approximating is the one thing this grid must never do.
 */
export function stampSeg(blk, W, H, x0, y0, cell, a, b, pad = 0) {
  const ax = (a.e - x0) / cell, ay = (a.n - y0) / cell;
  const bx = (b.e - x0) / cell, by = (b.n - y0) / cell;
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const gx = Math.round(ax + (bx - ax) * t);
    const gy = Math.round(ay + (by - ay) * t);
    if (gx < -pad || gy < -pad || gx >= W + pad || gy >= H + pad) continue;
    const cx = gx < 0 ? 0 : (gx >= W ? W - 1 : gx);
    const cy = gy < 0 ? 0 : (gy >= H ? H - 1 : gy);
    blk[cy * W + cx] = 1;
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
  // THE DILATION RADIUS, HOISTED — the pad has to be at least it, or a feature
  // clamped onto the boundary row would still not reach the water the buffer
  // covers. Both window culls below widen by the same margin in world units:
  // culling a feature that the clamp would have painted is the same hole one
  // gate up, and it was the half that made case (a) invisible.
  const rad = Math.max(1, Math.round(buffer / cell));
  const pad = rad + 1, PM = pad * cell;

  for (const poly of ko.polys) {
    const bb = poly.bb;
    if (bb.x1 < x0 - PM || bb.x0 > X1 + PM
        || bb.y1 < y0 - PM || bb.y0 > Y1 + PM) continue;   // window cull
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
      stampSeg(blk, W, H, x0, y0, cell, rg[j], rg[i], pad);
    }
  }

  for (const ln of ko.lines) {
    const bb = ln.bb;
    if (bb.x1 < x0 - PM || bb.x0 > X1 + PM
        || bb.y1 < y0 - PM || bb.y0 > Y1 + PM) continue;
    for (let i = 1; i < ln.pts.length; i++) {
      stampSeg(blk, W, H, x0, y0, cell, ln.pts[i - 1], ln.pts[i], pad);
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
      // through the padded stamp, or a zero-radius hazard just off the grid
      // drops the same way a polygon edge used to
      stampSeg(blk, W, H, x0, y0, cell, pt, pt, pad);
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

  dilateGrid(blk, W, H, rad);
}
