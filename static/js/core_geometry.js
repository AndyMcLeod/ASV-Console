/* ========================================================================
 * VENDORED FROM asv_core -- DO NOT EDIT THIS COPY.
 *
 *   source : asv_core_js/geometry.js
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
 * The planar primitives under the keep-out layer: bbOf, inBB, dSeg, pinp,
 * the three GeoJSON walkers and segSamplesEN. static/js/geometry.js
 * re-exports them and keeps its own bboxContains, bboxAround, lerpLL,
 * segInt and ptInGeom, which WorldView does not have.
 *
 * segSamplesEN ARRIVED WITH THE ROUTING EXTRACTION (2026-08-20), and the
 * note here used to say WorldView had no equivalent. It does -- PRIVATE
 * inside globe/channel.js, line for line the same function differing only
 * by the conversion call. It takes a FRAME now, and nothing in this repo
 * outside passage.js ever called it: asv.html and tests/turn_channel.js
 * import the name and never use it. Putting it in the geometry module
 * rather than leaving a copy inside the routing one is the difference
 * between removing a duplicate and making a third.
 *
 * THE BODIES ARE WORLDVIEW'S -- THE SAME CODE WITH THE REASONING WRITTEN
 * DOWN. Measured before adopting, not after: dSeg, bbOf and inBB are
 * BIT-IDENTICAL over 500/300/300 random cases, pinp agrees over 400, and
 * the three walkers yield identically across Polygon, MultiPolygon,
 * LineString and Point. A textual diff claims every body differs; it is
 * reading whitespace.
 *
 * NOTHING ELSE IN THE KEEP-OUT LAYER CAME WITH THEM. blocked, blockedInfo,
 * buildKeepouts, legClear, firstBlockAlong and channelPolys are parallel
 * implementations with different seams -- three of them take a bare ref
 * POINT here where WorldView takes a Frame, which is the same split that
 * stopped the geodesy adoption at the ENU boundary.
 *
 * Edit the core file and re-run the sync. Everything below is verbatim.
 */

/**
 * Planar geometry primitives — the layer underneath every keep-out decision.
 *
 * All take and return `{e, n}` in metres, in whatever tangent frame the caller
 * is working in. Nothing here knows about latitude, longitude or a projection;
 * that is the caller's business and is exactly why these are shared.
 *
 * WHY THESE SEVEN AND NOT THE REST OF THE KEEP-OUT LAYER. The ASV console and
 * WorldView both have a keep-out implementation, they share 22 symbol names, and
 * a textual comparison says NONE of the bodies match. That reading is misleading
 * for these seven: run side by side over the same inputs on 2026-08-19, `dSeg`,
 * `bbOf` and `inBB` are bit-identical over 500/300/300 random cases, `pinp`
 * agrees on 400, and `eachRing`/`eachPath`/`eachPoint` yield identically across
 * Polygon, MultiPolygon, LineString and Point. They differ in whitespace and in
 * how much they explain themselves, and in nothing else.
 *
 * THE REST OF THE KEEP-OUT LAYER IS NOT LIKE THIS, AND MUST NOT BE ASSUMED TO
 * BE. `buildKeepouts` is `(ref, enf, dr, feats)` in one and `(frame, feats,
 * opts)` in the other; `legClear`, `firstBlockAlong` and `channelPolys` take a
 * bare ref POINT in one and a `Frame` in the other — the same ref-vs-Frame split
 * that stopped ASV's geodesy adoption at the ENU boundary. Those need a merge
 * and a decision, not a vendoring. See the handoff.
 *
 * The bodies here are WorldView's, which are the same code with the reasoning
 * written down. WorldView's own comment said they were "used nowhere else, so
 * they live here rather than in a module that would exist for one caller" —
 * true when written, and this is that module now that there are two callers.
 */

/**
 * Bounding box of a point list.
 *
 * The 1e18 seeds stand in for infinities so an EMPTY list gives an inverted box
 * that `inBB` rejects for every point — rather than one that accepts all of them.
 */
export function bbOf(pts) {
  let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
  for (const p of pts) {
    if (p.e < x0) x0 = p.e;
    if (p.e > x1) x1 = p.e;
    if (p.n < y0) y0 = p.n;
    if (p.n > y1) y1 = p.n;
  }
  return { x0, y0, x1, y1 };
}

export const inBB = (p, bb, buf) =>
  p.e >= bb.x0 - buf && p.e <= bb.x1 + buf && p.n >= bb.y0 - buf && p.n <= bb.y1 + buf;

/**
 * Distance from a point to a SEGMENT, not to the infinite line.
 *
 * `t` is clamped to [0,1], which is what makes this a clearance test rather
 * than bearing maths: a point off the end of a pier is measured to the pier's
 * end, not to where the pier would be if it kept going.
 */
export function dSeg(p, a, b) {
  const dx = b.e - a.e, dy = b.n - a.n;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((p.e - a.e) * dx + (p.n - a.n) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.e - (a.e + t * dx), p.n - (a.n + t * dy));
}

/**
 * Ray-casting point-in-polygon over a ring.
 *
 * Boundary cases are undefined, and that is acceptable because every caller has
 * already added a keep-clear buffer — a point exactly on the edge is inside the
 * buffer either way.
 *
 * IT READS `.e` AND `.n`, SO IT WORKS ON ANY PAIR-LIKE RING with those fields.
 * The ASV console passes rings of `{lat, lon}` in some paths; those have no `e`
 * or `n`, every comparison is against `undefined`, and the answer is a
 * consistent `false` in BOTH implementations. Consistent, and consistently
 * useless — if a caller wants a geographic ring tested, it converts first.
 */
export function pinp(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].e, yi = ring[i].n, xj = ring[j].e, yj = ring[j].n;
    if (((yi > p.n) !== (yj > p.n)) && (p.e < (xj - xi) * (p.n - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// GeoJSON walkers. Each is a no-op on a geometry of the wrong type, so one
// caller can run all three over a mixed feature list without testing `type`.
export function eachRing(g, fn) {
  if (!g) return;
  if (g.type === 'Polygon') g.coordinates.forEach(fn);
  else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly) => poly.forEach(fn));
}

export function eachPath(g, fn) {
  if (!g) return;
  if (g.type === 'LineString') fn(g.coordinates);
  else if (g.type === 'MultiLineString') g.coordinates.forEach(fn);
}

export function eachPoint(g, fn) {
  if (!g) return;
  if (g.type === 'Point') fn(g.coordinates);
  else if (g.type === 'MultiPoint') g.coordinates.forEach(fn);
}

/**
 * ~5 m EN samples along one line `[a, b]` given as lon/lat points.
 *
 * THE KEEP-OUT TESTS ARE POINT TESTS, so a line is only as well tested as it is
 * densely sampled; 5 m is finer than the smallest hazard the model carries. The
 * survey channel rules use it to ask whether a line crosses a fairway.
 *
 * ARRIVED WITH THE ROUTING EXTRACTION (2026-08-20), already present in both
 * consoles: exported from ASV's `geometry.js` as `segSamplesEN(l, ref)` and
 * PRIVATE inside WorldView's `channel.js` as `segSamplesEN(line, frame)`. Line
 * for line the same function, differing only by the conversion call — the
 * calling convention Andy had already ruled on. Putting it HERE rather than
 * leaving a copy inside the routing module is the difference between removing a
 * duplicate and making a third one.
 */
export function segSamplesEN(line, frame) {
  const a = frame.toEN(line[0]), b = frame.toEN(line[1]);
  const L = Math.hypot(b.e - a.e, b.n - a.n);
  const n = Math.max(2, Math.ceil(L / 5)), out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t });
  }
  return out;
}
