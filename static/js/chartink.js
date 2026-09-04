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
/** Degrees off the structure it springs from. Below this it is a contour or an edge. */
export const PERP_MIN_DEG = 30.0;

const R2D = 180 / Math.PI;

/**
 * Ink: one pass over RGBA, one threshold.
 *
 * ⚠ LUMINANCE, NOT "IS IT GREY". The strokes this is after are grey 114 AND black text AND
 * the darker blue of a heavy contour; a colour match would need one rule per palette entry
 * and would break the first time NOAA restyled. What every fill on this chart has in common
 * is that it is LIGHT, and that is a single number.
 */
export function inkMask(rgba, w, h, lum = INK_LUM) {
  const m = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < m.length; i++, p += 4) {
    if (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2] < lum) m[i] = 1;
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
  const near = na.d <= nb.d ? na : nb;
  r.attachM = near.d * mPerPx;
  if (!near.seg || r.attachM > attach) {
    r.why = "not attached (" + r.attachM.toFixed(1) + " m off anything charted)";
    return r;
  }
  const sx = near.seg.b.x - near.seg.a.x, sy = near.seg.b.y - near.seg.a.y;
  const sl = Math.hypot(sx, sy) || 1;
  const dot = Math.abs((sx / sl) * fit.ux + (sy / sl) * fit.uy);
  r.angleDeg = Math.acos(Math.min(1, dot)) * R2D;
  if (r.angleDeg < perpMin) {
    r.why = "runs ALONG the structure (" + r.angleDeg.toFixed(0) + "°) — a contour or an edge";
    return r;
  }
  r.keep = true;
  r.why = lengthM.toFixed(1) + " m, " + r.angleDeg.toFixed(0) + "° off a charted structure "
        + "it touches within " + r.attachM.toFixed(1) + " m";
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
 * @returns {{structures, unexplained, rejected, inkPx, unexplainedPx, components}}
 *   `structures` are the keep-outs. `unexplained` are line-like marks that failed only the
 *   ATTACHED test - reported, never enforced. `rejected` is EVERY verdict including those,
 *   with its reason: auditing the rejects is how the aspect gate was found in the first
 *   place, and a sieve whose discards cannot be read is a sieve nobody can tune.
 */
export function scanChart(rgba, w, h, explained, segs, mPerPx, opts = {}) {
  const ink = inkMask(rgba, w, h, opts.inkLum);
  const un = unexplainedMask(ink, explained);
  let inkPx = 0, unPx = 0;
  for (let i = 0; i < ink.length; i++) { if (ink[i]) inkPx++; if (un[i]) unPx++; }
  const comps = components(un, w, h, opts.minPx);
  const structures = [], unexplained = [], rejected = [];
  for (const c of comps) {
    const fit = fitAxis(c.xs, c.ys);
    const v = classify(fit, segs, mPerPx, opts);
    const rec = { a: fit.a, b: fit.b, px: c.xs.length, ...v };
    if (v.keep) structures.push(rec);
    else {
      rejected.push(rec);
      if (v.attachM != null) unexplained.push(rec);      // line-like, but standing alone
    }
  }
  return { structures, unexplained, rejected,
           inkPx, unexplainedPx: unPx, components: comps.length };
}
