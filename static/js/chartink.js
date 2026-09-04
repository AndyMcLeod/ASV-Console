// static/js/chartink.js - reading the CHART ITSELF, where the ENC has nothing to say.
//
// Andy, 2026-09-04, with a Go-To drawn straight through a finger pier at New Castle:
//
//   "A pier feature should be impeding travel. The GOTO command drives right through it.
//    I do not believe this feature is identified as a finger pier or any other structure in
//    the ENC. ... In this particular case the finger pier uses the same color and width as
//    the 11' contour line next to it which must be recognized as a different component
//    (contour). ... use an identification process that finds PERPENDICULAR features on the
//    graphic attached to ENC features and include them as viable features added to NOGO."
//
// ⚠⚠ HE IS RIGHT, AND IT IS WORSE THAN A MISSING CLASS. The console fetches every layer
// ENCDirect publishes for the area - 203 of them, the named ones role-tagged and the rest
// carried as `extra` - and it still has nothing there. Measured at that pier: the nearest
// ENC object of ANY class to the drawn finger pier is 4.3 m away, and that is the MAIN
// pier's own outline. ENCDirect's `identify` at the same point returns seven results and
// every one of them is an area (depth, quality-of-data, restricted, sea-area). NOAA's
// Maritime Chart Service DRAWS the finger pier; NOAA's vector service does not carry it.
//
// ⚠ AND THERE IS NO FINER BAND TO FALL BACK ON. `enc_berthing` exists - usage band 6, the
// finest S-57 defines, and one this console never asked for - so that was checked first as
// the cheaper answer. It has NO COVERAGE at New Castle: even `Coverage_area` comes back
// empty. The harbour band is the finest cell there is here, and the feature is not in it.
//
// So the chart image is a real source of navigational fact that the vector extract does not
// contain, and this module reads it. NOTHING HERE TOUCHES A CANVAS OR THE NETWORK - it takes
// pixels and geometry that the caller has already assembled, exactly the split guard.js and
// hold.js have, so the whole decision can be tested without a browser.
//
// THE METHOD, and each step is a different question:
//
//   ink          what is DRAWN. The chart's fills are all light (water 209-221, land 255,
//                a pier's tan 232) and its strokes and text are grey 114 or black, so one
//                luminance threshold separates them. Measured on the live tiles.
//   explained    what the ENC ALREADY ACCOUNTS FOR. Every vector the console holds, painted
//                thick; ink within a few pixels of a charted object is that object's own
//                stroke and is not news. At New Castle this removes 89% of the ink.
//   components   what is left, grouped.
//   the sieve    which of those are STRUCTURES rather than chart furniture.
//
// ⚠⚠ THE SIEVE IS THE WHOLE SAFETY ARGUMENT, BECAUSE THIS MODULE ADDS KEEP-OUTS. A false
// positive refuses water the vessel is entitled to; a false negative is the pier it was
// written for. Five gates, and Andy named the two that matter:
//
//   long enough      MIN_LEN_M - under it, a label, a tick, a symbol stroke.
//   THIN             MIN_ASPECT - length over width. ⚠ A WIDTH LIMIT ALONE IS NOT ENOUGH
//                    and the sweep proved it: a 4.9 m x 1.9 m chart symbol on the Fort
//                    Point shore passed a 4 m width gate and was reported as a structure.
//                    Aspect is scale-free and killed it without touching either pier
//                    (they are 20:1 and 30:1).
//   ATTACHED         one END within ATTACH_M of a charted structure. A finger pier springs
//                    from a quay; that is what makes it a finger pier.
//   PERPENDICULAR    at least PERP_MIN_DEG off the thing it springs from. ⚠ THIS IS THE ONE
//                    THAT SEPARATES A PIER FROM A CONTOUR, which is exactly the confusion
//                    Andy called out - they are drawn in the same grey at the same width,
//                    and what tells them apart is that a depth contour runs ALONG the shore
//                    and a pier runs OUT from it.
//
// MEASURED over 670 x 670 m of New Castle at 0.22 m/px: 1,825 components, TWO kept - both
// of them real finger piers, 88 deg and 89 deg off the pier they stand on, attached to
// within a metre. Over 715 x 715 m of Lewes: ZERO kept, zero false positives.
//
// ⚠ WHAT THIS DELIBERATELY DOES NOT DO IS DETACHED INK. Five candidates at New Castle were
// line-like but stood 11-19 m off anything charted; on inspection every one was foreshore or
// marsh symbology, not a structure over navigable water. They are RETURNED as `unexplained`
// rather than enforced, so the operator is told they exist and the console does not act on a
// guess. Andy's rule was "attached", and attached is what is enforced.

/** Below this luminance a chart pixel is INK - a stroke or text, never a fill. */
export const INK_LUM = 170;
/**
 * ... and it must be NEUTRAL. Max channel minus min channel, above which the mark is a
 * COLOURED one and belongs to a different alphabet.
 *
 * ⚠ THIS IS NOT A TIDY-UP, IT REMOVED A WHOLE CLASS OF FALSE CANDIDATE. NOAA draws physical
 * things in greys and black and reserves magenta for aids, limits, cable and pipeline runs
 * and anchorage symbology - none of which is a structure a hull can hit. Measured over the
 * west shore at New Castle: structure ink runs 0-26 of saturation, the magenta furniture
 * runs 110-146, and 15.9% of everything the luminance test called ink was that furniture. A
 * 41 m "line" the sieve had to argue with turned out to be the pink anchorage-limit dashes.
 */
export const INK_SAT_MAX = 60;
/** Ink within this many pixels of a charted object is that object's own stroke. */
export const EXPLAIN_PX = 4;
/** A component smaller than this is noise, not a mark. */
export const MIN_PX = 8;
/** Shorter than this and it is a label, a tick or part of a symbol. */
export const MIN_LEN_M = 3.0;
/** Wider than this and it is not a drawn line at all. */
export const MAX_WIDTH_M = 4.0;
/** Length over width. A drawn line is long and thin; a symbol is neither. */
export const MIN_ASPECT = 5.0;
/** How near a charted structure an end must be for the mark to be ATTACHED to it. */
export const ATTACH_M = 6.0;
/**
 * Degrees off the structure it springs from - REPORTED ALWAYS, and the gate only where the
 * mark does not visibly reach away. See REACH_FRAC.
 */
export const PERP_MIN_DEG = 30.0;
/**
 * ⚠⚠ WHAT ACTUALLY SEPARATES A PIER FROM A CONTOUR IS THAT A PIER GOES SOMEWHERE.
 *
 * Andy's rule was PERPENDICULAR, and perpendicular is the right idea measured the wrong way:
 * it asks the angle against the ONE nearest structure segment, and a charted foreshore is a
 * dotted line of dozens of short wiggles whose local direction is noise. Two real piers on
 * the west shore at New Castle - 16.9 m and 27.6 m, both plainly running out into the water
 * off the beach - were refused at "0°" and "21°" because the shoreline segment nearest their
 * root happened to lie along them.
 *
 * The general form of his rule is the one the water understands: ONE END IS ATTACHED AND THE
 * OTHER IS OUT IN OPEN WATER. That is what a pier is. A depth contour fails it by
 * construction - it runs at a roughly constant offset for its whole length, so neither end
 * reaches anywhere - and it needs no angle at all.
 *
 * `attachM` is the near end's distance to anything charted; `reachM` is the far end's. The
 * far end must stand off by at least this fraction of the mark's own length.
 */
export const REACH_FRAC = 0.5;
/** ... and by at least this, so a very short mark still has to go somewhere. */
export const REACH_MIN_M = 3.0;

// ── SEGMENTED MARKS, AND MARKS ATTACHED TO OTHER MARKS ──────────────────────────────
//
// Andy, on the first cut: *"The fix applies partially. In the attached image the planned
// path cuts through these small piers attached to shore. ... consider shore attached linear
// and segmented linear features also a target for added nogo."*
//
// He is right twice, and the audit of the rejects says exactly why. Over the west shore at
// New Castle the piers that were missed came back as:
//
//     detached   9.0 m x 0.6 m,  8.1 m off      detached  10.8 m x 1.4 m, 10.8 m off
//     detached   6.1 m x 0.5 m, 10.3 m off      detached  14.2 m x 1.9 m, 34.0 m off
//     along     13.2 m x 0.6 m,  0.1 deg        along      7.3 m x 0.6 m,  0.1 deg
//
// TWO DIFFERENT FAILURES, and neither is the sieve being wrong about what a pier looks like:
//
//   * THE GAP IS REAL. A float or a finger reached by a ramp starts in the water, and the
//     ENC's coastline is drawn at the high-water line - so the mark genuinely stands 6-19 m
//     off anything charted. A single 6 m allowance cannot serve both a finger growing off a
//     charted quay and a float system off a beach.
//   * A MARINA IS NOT ONE LINE. Its spine runs ALONG the shore and its fingers run out from
//     it; the spine is 0.1 deg off the shoreline and is refused by the very test that keeps
//     depth contours out. The spine is not attached to the shore at all - it is attached to
//     the FINGERS.
//
// So two additions, and both are conservative:
//
//   CHAINING     collinear pieces separated by a small gap are ONE mark before anything is
//                judged. That is Andy's "segmented linear", and it also repairs the first
//                failure for free: a pier drawn as two strokes reaches the shore once its
//                pieces are joined.
//   GROWTH       a mark attached and perpendicular to an ALREADY-ACCEPTED mark is accepted
//                too, and joins the pool. A finger off the shore seeds; the spine attaches to
//                the finger at 90 deg; a further finger attaches to the spine. ⚠ EVERY STEP
//                STILL PAYS THE PERPENDICULAR TEST, which is what stops the growth walking
//                along a contour - a contour parallel to a pier can never attach to it.

/** Collinear pieces closer than this along their own axis are one mark. */
export const CHAIN_GAP_M = 5.0;
/** ... and no further off each other's axis than this. A parallel neighbour is not a piece. */
export const CHAIN_OFFSET_M = 1.6;
/** ... and no more than this many degrees apart in direction. */
export const CHAIN_DEG = 20.0;
/** Only marks at least this long by this ratio are worth trying to chain. */
export const CHAIN_MIN_ASPECT = 1.5;
/**
 * How far a mark may stand off the thing it belongs to, as a MULTIPLE OF ITS OWN LENGTH.
 *
 * ⚠ THE ALLOWANCE IS PROPORTIONAL BECAUSE THE EVIDENCE IS. A 15 m pier lying 10 m off a
 * charted shore is a structure reached by a ramp nobody charted; a 3 m mark lying 10 m off
 * is a symbol, and no reading of the picture makes it anything else. A flat radius big
 * enough for the first is far too big for the second, which is how a single ATTACH_M ended
 * up refusing every float at New Castle's west shore.
 */
export const ATTACH_FRAC = 1.0;
/** How many times the accepted set may seed further marks. */
export const GROW_ROUNDS = 3;

// ── THE ONE CLASS THIS STILL WILL NOT ENFORCE ───────────────────────────────────────
//
// A MARINA IS NOT A LINE. Its floats form a comb - a spine with fingers - which arrives as
// ONE connected component 20 x 21 m across, and no reading of it as a line is honest. Two of
// them sit on the west shore at New Castle and the sieve calls them both "not a line", which
// is correct and useless.
//
// They ARE structures, and they are reported: a component that is WIDE, LARGE and SPARSE is
// a network of drawn lines, not a filled symbol - measured, the two marinas fill 7% and 10%
// of their own bounding box. But turning one into a keep-out means emitting an AREA from an
// image, which is a wider authority than emitting a line, and two samples is not enough
// evidence to set a threshold that would refuse water. So they are counted and named for the
// operator, and the console does not act on them. That is the same call the detached marks
// get, and for the same reason.
export const AREA_MIN_M = 10.0;
export const AREA_MAX_FILL = 0.35;

const R2D = 180 / Math.PI;

/**
 * Ink: one pass over RGBA, one threshold.
 *
 * ⚠ LUMINANCE, NOT "IS IT GREY". The strokes this is after are grey 114 AND black text AND
 * the darker blue of a heavy contour; a colour match would need one rule per palette entry
 * and would break the first time NOAA restyled. What every fill on this chart has in common
 * is that it is LIGHT, and that is a single number.
 */
export function inkMask(rgba, w, h, lum = INK_LUM, sat = INK_SAT_MAX) {
  const m = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < m.length; i++, p += 4) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    if (0.299 * r + 0.587 * g + 0.114 * b >= lum) continue;
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    if (mx - mn > sat) continue;                  // coloured: an aid, a limit, a cable
    m[i] = 1;
  }
  return m;
}

/** Ink the ENC does not account for. `explained` is 1 where a charted object was painted. */
export function unexplainedMask(ink, explained) {
  const m = new Uint8Array(ink.length);
  for (let i = 0; i < ink.length; i++) if (ink[i] && !explained[i]) m[i] = 1;
  return m;
}

/**
 * Eight-connected components, iteratively.
 *
 * ⚠ AN EXPLICIT STACK, NOT RECURSION. A single shoreline stroke can run for tens of
 * thousands of pixels and a recursive flood fill blows the JS stack long before that - which
 * on a safety scan means an exception where a keep-out should have been.
 */
export function components(mask, w, h, minPx = MIN_PX) {
  const seen = new Uint8Array(mask.length);
  const out = [];
  const stack = new Int32Array(mask.length);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    const xs = [], ys = [];
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i / w) | 0;
      xs.push(x); ys.push(y);
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (mask[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
        }
      }
    }
    if (xs.length >= minPx) out.push({ xs, ys });
  }
  return out;
}

/**
 * The line a component lies along: its principal axis, and its extent along and across it.
 *
 * A 2x2 covariance has a closed-form principal direction, so there is no SVD here and no
 * matrix library - `theta = ½·atan2(2Sxy, Sxx − Syy)` is the whole of it.
 */
export function fitAxis(xs, ys) {
  const n = xs.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(th), uy = Math.sin(th);
  let a0 = Infinity, a1 = -Infinity, p0 = Infinity, p1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    const a = dx * ux + dy * uy, p = -dx * uy + dy * ux;
    if (a < a0) a0 = a; if (a > a1) a1 = a;
    if (p < p0) p0 = p; if (p > p1) p1 = p;
  }
  return { mx, my, ux, uy, alongPx: a1 - a0, acrossPx: p1 - p0,
           a: { x: mx + ux * a0, y: my + uy * a0 },
           b: { x: mx + ux * a1, y: my + uy * a1 } };
}

/** Signed distance from a point to an infinite line through `c` with unit direction `u`. */
function offAxis(p, c, ux, uy) {
  return Math.abs(-(p.x - c.x) * uy + (p.y - c.y) * ux);
}

/** The gap between two segments' nearest ENDS, in pixels. */
function endGap(f, g) {
  let best = Infinity;
  for (const a of [f.a, f.b]) for (const b of [g.a, g.b]) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Are these two marks pieces of ONE line?
 *
 * Three tests, and all three are needed: the same DIRECTION (a cross is not a chain), a
 * small OFFSET from each other's axis (a parallel neighbour ten metres away is a different
 * structure, not the rest of this one), and a small GAP between their nearest ends.
 */
export function chainable(f, g, mPerPx, opts = {}) {
  const gap = (opts.chainGapM ?? CHAIN_GAP_M) / mPerPx;
  const off = (opts.chainOffsetM ?? CHAIN_OFFSET_M) / mPerPx;
  const degMax = opts.chainDeg ?? CHAIN_DEG;
  const dot = Math.abs(f.ux * g.ux + f.uy * g.uy);
  if (Math.acos(Math.min(1, dot)) * R2D > degMax) return false;
  // ⚠ ONE SYMMETRIC TEST, NOT TWO. This was written as a pair - g's centre off f's axis, and
  // f's centre off g's - and mutation showed the pair indistinguishable: deleting either left
  // every check green, because within the 20° direction cap the two are all but equal and
  // the survivor always fired. Two statements where one always implies the other is one
  // statement nobody can test. The MAX is the same rule, stated once.
  const offset = Math.max(offAxis({ x: g.mx, y: g.my }, { x: f.mx, y: f.my }, f.ux, f.uy),
                          offAxis({ x: f.mx, y: f.my }, { x: g.mx, y: g.my }, g.ux, g.uy));
  if (offset > off) return false;
  return endGap(f, g) <= gap;
}

/**
 * Join collinear pieces into single marks - Andy's "segmented linear features".
 *
 * ⚠ UNION-FIND IN ONE PASS, NOT MERGE-AND-RESTART. A chart tile yields on the order of two
 * thousand components; re-scanning the whole list after every merge is O(merges x n²) and
 * turns a 100 ms scan into a frozen tab. One O(n²) pass over the CHAINABLE SUBSET - marks
 * with enough elongation to be a piece of a line at all - is a few hundred squared.
 */
export function chainMarks(marks, mPerPx, opts = {}) {
  const minAsp = opts.chainMinAspect ?? CHAIN_MIN_ASPECT;
  const idx = [];
  for (let i = 0; i < marks.length; i++) {
    const f = marks[i].fit;
    if (f.alongPx >= Math.max(1, f.acrossPx) * minAsp) idx.push(i);
  }
  const parent = marks.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const i = idx[a], j = idx[b];
      if (find(i) === find(j)) continue;
      if (chainable(marks[i].fit, marks[j].fit, mPerPx, opts)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < marks.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  const out = [];
  for (const members of groups.values()) {
    if (members.length === 1) { out.push(marks[members[0]]); continue; }
    let xs = [], ys = [];
    for (const i of members) { xs = xs.concat(marks[i].xs); ys = ys.concat(marks[i].ys); }
    out.push({ xs, ys, fit: fitAxis(xs, ys), pieces: members.length });
  }
  return out;
}

/** Distance from a point to a segment, and where along it - all in pixels. */
function dSegPx(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  const qx = a.x + dx * t, qy = a.y + dy * t;
  return Math.hypot(p.x - qx, p.y - qy);
}

/** The charted structure nearest this point, and how far off it is. */
export function nearestSeg(p, segs) {
  let best = Infinity, hit = null;
  for (const s of segs) {
    const d = dSegPx(p, s.a, s.b);
    if (d < best) { best = d; hit = s; }
  }
  return { d: best, seg: hit };
}

/**
 * Is this mark a STRUCTURE? Returns the verdict and, either way, WHY - because a scan that
 * silently drops candidates cannot be audited, and auditing the rejects is how the aspect
 * gate was found.
 */
export function classify(fit, segs, mPerPx, opts = {}) {
  const minLen = opts.minLenM ?? MIN_LEN_M;
  const maxW = opts.maxWidthM ?? MAX_WIDTH_M;
  const minAsp = opts.minAspect ?? MIN_ASPECT;
  const attach = opts.attachM ?? ATTACH_M;
  const perpMin = opts.perpMinDeg ?? PERP_MIN_DEG;
  const lengthM = fit.alongPx * mPerPx;
  const widthM = fit.acrossPx * mPerPx;
  const r = { keep: false, lengthM, widthM, attachM: null, angleDeg: null, why: "" };
  if (lengthM < minLen) { r.why = "too short (" + lengthM.toFixed(1) + " m)"; return r; }
  if (widthM > maxW) { r.why = "not a line (" + widthM.toFixed(1) + " m across)"; return r; }
  // ⚠ THE ASPECT GATE, AND THE WIDTH GATE ABOVE IS NOT A SUBSTITUTE FOR IT. A 4.9 x 1.9 m
  // chart symbol passed the width test and was reported as a structure until this was added.
  const aspect = lengthM / Math.max(widthM, mPerPx);
  if (aspect < minAsp) { r.why = "not thin enough (" + aspect.toFixed(1) + ":1)"; return r; }
  const na = nearestSeg(fit.a, segs), nb = nearestSeg(fit.b, segs);
  const near = na.d <= nb.d ? na : nb, far = na.d <= nb.d ? nb : na;
  r.attachM = near.d * mPerPx;
  r.reachM = far.d * mPerPx;
  // ⚠ THE ALLOWANCE SCALES WITH THE MARK. See ATTACH_FRAC: a float system reached by an
  // uncharted ramp stands metres off the coastline, and the longer the thing you have found
  // the more confident you may be that the gap is a gap in the CHART rather than open water.
  r.attachMaxM = Math.max(attach, (opts.attachFrac ?? ATTACH_FRAC) * lengthM);
  if (!near.seg || r.attachM > r.attachMaxM) {
    r.why = "not attached (" + r.attachM.toFixed(1) + " m off anything charted, allowed "
          + r.attachMaxM.toFixed(1) + " m)";
    return r;
  }
  const sx = near.seg.b.x - near.seg.a.x, sy = near.seg.b.y - near.seg.a.y;
  const sl = Math.hypot(sx, sy) || 1;
  const dot = Math.abs((sx / sl) * fit.ux + (sy / sl) * fit.uy);
  r.angleDeg = Math.acos(Math.min(1, dot)) * R2D;
  // ⚠ REACH OR SQUARE, NOT REACH AND SQUARE. Either is enough evidence that the mark leaves
  // the thing it is attached to; demanding both would refuse the two west-shore piers all
  // over again, since their fault was an angle measured against a wiggle of foreshore.
  r.reachNeedM = Math.max(opts.reachMinM ?? REACH_MIN_M,
                          (opts.reachFrac ?? REACH_FRAC) * lengthM);
  if (r.reachM < r.reachNeedM && r.angleDeg < perpMin) {
    r.why = "goes nowhere — it lies " + r.attachM.toFixed(1) + "-" + r.reachM.toFixed(1)
          + " m off what it touches at " + r.angleDeg.toFixed(0) + "°, so it follows a shape "
          + "rather than leaving it (a contour, or the far side of the same object)";
    return r;
  }
  r.keep = true;
  r.why = lengthM.toFixed(1) + " m, attached within " + r.attachM.toFixed(1) + " m and "
        + "reaching " + r.reachM.toFixed(1) + " m clear at " + r.angleDeg.toFixed(0) + "°";
  return r;
}

/**
 * The whole scan: pixels in, structures out.
 *
 * @param {Uint8ClampedArray} rgba   the chart image
 * @param {number} w,h               its size
 * @param {Uint8Array} explained     1 where a charted object was painted
 * @param {Array} segs               charted structure segments, {a:{x,y}, b:{x,y}}, in the
 *                                   SAME pixel frame as the image
 * @param {number} mPerPx            ground resolution
 * @returns {{structures, unexplained, areas, rejected, inkPx, unexplainedPx, components}}
 *   `structures` are the keep-outs. `unexplained` are line-like marks that failed only the
 *   ATTACHED test and `areas` are line NETWORKS too wide to read as one line - both are
 *   reported and NEITHER is enforced. `rejected` is EVERY verdict including those, with its
 *   reason: auditing the rejects is how the aspect gate was found in the first place, and a
 *   sieve whose discards cannot be read is a sieve nobody can tune.
 */
export function scanChart(rgba, w, h, explained, segs, mPerPx, opts = {}) {
  const ink = inkMask(rgba, w, h, opts.inkLum);
  const un = unexplainedMask(ink, explained);
  let inkPx = 0, unPx = 0;
  for (let i = 0; i < ink.length; i++) { if (ink[i]) inkPx++; if (un[i]) unPx++; }
  const comps = components(un, w, h, opts.minPx);
  const marks = chainMarks(comps.map(c => ({ xs: c.xs, ys: c.ys, fit: fitAxis(c.xs, c.ys) })),
                           mPerPx, opts);
  // ⚠ THE POOL GROWS. Seeded with the ENC's own structures, and every mark accepted joins
  // it, so a marina's spine can attach to a finger that attached to the shore. The
  // perpendicular test is paid at every step, which is what keeps a contour out of the
  // chain: a line running ALONG a pier is refused by the pier just as it was by the shore.
  const pool = segs.slice();
  const structures = [], unexplained = [], rejected = [], areas = [];
  let pending = marks;
  const rounds = opts.growRounds ?? GROW_ROUNDS;
  // ⚠ A PASS'S WINNERS JOIN THE POOL AT THE END OF THE PASS, NOT AS THEY ARE FOUND. Pushing
  // each acceptance immediately makes the result depend on the order components happen to be
  // scanned in - the same mark is a round-0 find or a round-1 one depending on which pixel
  // the flood fill reached first - and an order-dependent safety scan cannot be reasoned
  // about or tested. Round 0 is the pass against the ENC alone; every later round is growth.
  for (let round = 0; ; round++) {
    const left = [], verdicts = [], won = [];
    for (const m of pending) {
      const v = classify(m.fit, pool, mPerPx, opts);
      if (v.keep) won.push({ m, v });
      else { left.push(m); verdicts.push(v); }
    }
    for (const w of won)
      structures.push({ a: w.m.fit.a, b: w.m.fit.b, px: w.m.xs.length,
                        pieces: w.m.pieces || 1, round, ...w.v });
    if (!won.length || round >= rounds || !left.length) {
      for (let i = 0; i < left.length; i++) {
        const f = left[i].fit;
        const fill = left[i].xs.length / Math.max(1, f.alongPx * Math.max(1, f.acrossPx));
        const rec = { a: f.a, b: f.b, px: left[i].xs.length, fill,
                      pieces: left[i].pieces || 1, ...verdicts[i] };
        rejected.push(rec);
        if (verdicts[i].attachM != null) unexplained.push(rec);
        // A network of drawn lines rather than one line: reported, never enforced.
        if (!verdicts[i].keep && rec.widthM > (opts.maxWidthM ?? MAX_WIDTH_M)
            && rec.lengthM >= (opts.areaMinM ?? AREA_MIN_M)
            && fill <= (opts.areaMaxFill ?? AREA_MAX_FILL)) areas.push(rec);
      }
      break;
    }
    for (const w of won) pool.push({ a: w.m.fit.a, b: w.m.fit.b });
    pending = left;
  }
  return { structures, unexplained, areas, rejected, marks: marks.length,
           inkPx, unexplainedPx: unPx, components: comps.length };
}
