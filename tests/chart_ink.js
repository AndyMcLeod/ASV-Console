// tests/chart_ink.js - reading the CHART ITSELF, where the ENC has nothing to say.
//
// Andy, 2026-09-04, with a Go-To drawn straight through a finger pier at New Castle:
//
//   "A pier feature should be impeding travel. The GOTO command drives right through it. I
//    do not believe this feature is identified as a finger pier or any other structure in
//    the ENC. This is exactly the situation that requires an image capture and comparison to
//    ENC features to prevent a crash. In this particular case the finger pier uses the same
//    color and width as the 11' contour line next to it which must be recognized as a
//    different component (contour). ... use an identification process that finds
//    PERPENDICULAR features on the graphic attached to ENC features and include them as
//    viable features added to NOGO."
//
// ⚠⚠ HE IS RIGHT, AND THREE CHEAPER ANSWERS WERE RULED OUT FIRST, because a missing CLASS
// would have been one line in ENC_ROLES and image processing is not:
//   * the console's extract already holds EVERY layer ENCDirect publishes for the area, and
//     the nearest object of ANY class to that drawn pier is 4.3 m away - the MAIN pier's
//     own outline, not the finger;
//   * ENCDirect's `identify` at the same point returns seven results and every one is an
//     AREA (depth, quality-of-data, restricted, sea-area). No structure, no line, nothing;
//   * `enc_berthing` - usage band 6, the finest S-57 defines, one this console has never
//     asked for - has NO COVERAGE at New Castle. Even its Coverage_area comes back empty.
// NOAA's RENDERER draws the finger pier. NOAA's VECTOR service does not carry it.
//
//   node tests/chart_ink.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// THE RULES THIS SUITE ENCODES:
//   * ink is LUMINANCE, not a palette match - every fill on this chart is light and every
//     stroke is dark, and a colour list would break the first time NOAA restyled;
//   * a mark within EXPLAIN_PX of a charted object is that object's own stroke, and the
//     explained mask is painted from the SAME feature list the keep-out model is built from;
//   * a structure is LONG, THIN, ATTACHED and PERPENDICULAR. The last is the one that tells
//     a finger pier from a depth contour drawn in the same grey at the same width - a
//     contour runs ALONG the shore, a pier runs OUT from it (checks 6, 7);
//   * THIN IS AN ASPECT RATIO, not a width. A 4.9 x 1.9 m chart symbol passed a 4 m width
//     gate on the live sweep and was reported as a structure (check 5);
//   * detached marks are REPORTED, never enforced (check 9);
//   * and what is read off a picture is never presented as if it came from the ENC - its own
//     kind, its own colour, its own line on the readout (checks 12-15).
//
// MEASURED on the live chart before any of this was written: 670 x 670 m of New Castle at
// 0.22 m/px gives 1,825 components, of which TWO survive - both real finger piers, 88° and
// 89° off the pier they stand on, attached to within a metre. 715 x 715 m of Lewes gives
// ZERO. The same scan ported to this module reproduces the New Castle pair exactly, in
// 103 ms over 1280 x 1280 px.
//
// ⚠⚠ SECOND ROUND, AND ANDY WAS RIGHT AGAIN: *"The fix applies partially. In the attached
// image the planned path cuts through these small piers attached to shore. ... consider shore
// attached linear and segmented linear features also a target for added nogo."* Auditing the
// rejects over the west shore said exactly why, and none of it was the sieve misunderstanding
// what a pier looks like:
//   * THE PERPENDICULAR TEST WAS MEASURED AGAINST THE WRONG THING. A charted foreshore is
//     dozens of short zig-zags, so the ONE segment nearest a pier's root can lie along the
//     pier - two obvious piers came back "runs ALONG the structure (0°)" and "(21°)". The
//     general form of Andy's rule is REACH: one end attached, the other out in open water.
//     A contour fails it by construction, and needs no angle at all (checks 7, 7b).
//   * THE GAP TO THE SHORE IS REAL. A float reached by an uncharted ramp stands 6-19 m off,
//     and one flat radius cannot serve that and a finger on a quay. The allowance scales
//     with the mark's own length now (17d).
//   * A MARINA IS NOT ONE LINE. Its spine is attached to the FINGERS, not to the shore, so
//     the pool GROWS: a mark square to an accepted mark is accepted too (19).
//   * AND 15.9% OF THE "INK" WAS MAGENTA - aids, limits, cable runs. Dark enough to pass a
//     luminance test, and never a structure (18).
// Measured after: New Castle's west shore went from 4 structures to 10, every one a real
// pier on inspection; Lewes stayed at ZERO.
//
// ⚠⚠ THIRD ROUND: THE MARINA IS ENFORCED. Andy: *"enforce the marina footprints too."* A
// comb of floats arrives as ONE wide component that no line can honestly describe, so it
// becomes a POLYGON - the convex hull of its own ink - in `ko.polys` beside the ENC's docks.
// The hull OVER-CLAIMS on purpose: it fills in the water between the fingers, which is the
// right direction to be wrong in, because those gaps are metres wide and hold moored boats
// the chart does not draw. The gates are stricter than a line's, because an area refuses more
// water: wide, LARGE, SPARSE (the two real marinas fill 7% and 10% of their own bounding box
// against a 35% ceiling) and ATTACHED on the same proportional rule a pier obeys.
//
// TEETH: THIRTY mutations RUN against a sidecar copy of chartink.js and the page, all thirty
// killed. The check numbers are the ones that actually went red.
//   ink threshold ignored (everything is ink)                 -> 1, 2, 4, 5, 5b, 5c, 6-9, 16
//   the explained mask is not subtracted                      -> 2, 4, 5, 5b, 5c, 8, 16
//   components are 4-connected, not 8                         -> 3
//   the LENGTH gate dropped                                   -> 5c
//   the ASPECT gate dropped (the reported false positive)     -> 5
//   the WIDTH gate dropped                                    -> 5b
//   the ATTACHMENT gate dropped                               -> 6
//   the PERPENDICULAR gate dropped (a contour becomes a pier) -> 7
//   the axis fit returns the MINOR axis                       -> 4, 5, 5b, 5c, 6-9, 11, 16
//   detached marks are enforced instead of reported           -> 6, 7, 9
//   the nearest structure is the FIRST in the list            -> 4, 5, 5b, 5c, 7, 8, 16
//   the page folds ink outside rebuildNogo                    -> 12, 13
//   the fold ignores the structure-enforcement toggle         -> 13
//   a refusal is cached as if it were a clean read            -> 14
//   chart-read lines are drawn in the ENC's own red           -> 15
//
// ⚠ FIVE OF THESE CHECKS COULD NOT FAIL WHEN THEY WERE FIRST WRITTEN, and mutation found
// every one. The pattern is the same each time - the FIXTURE, not the assertion:
//   * the length, width and aspect gates had NOTHING that reached them. The only fat mark in
//     the scene sat on the quay, which the explained mask paints EXPLAIN_PX either side, so
//     it was subtracted before it was ever a component. There are now three marks hanging
//     off the quay that each fail exactly ONE gate (`tick`, `stub`, `slab`), so each gate is
//     the only thing standing between its mark and a keep-out.
//   * `nearestSeg` was handed a ONE-SEGMENT list, where "nearest" and "first" are the same
//     object and the search cannot be wrong. FAR is listed first now, and is 44 m away.
//   * the readout check was a source grep for `chartInk.note`, and the mutation that
//     disables that sentence leaves the text sitting in a branch it no longer reaches. It
//     moved to tests/nogo_readout.js 17/18, where the function is actually EXECUTED.
//
// ⚠ AND ONE FIXTURE HELPER WAS SIMPLY BROKEN: a zero-length span made n = 0, t = 0/0 = NaN,
// and `stroke` drew nothing at all - so a one-pixel-wide mark was absent and the check that
// needed it passed for want of anything to reject. Math.max(1, ...) now.
//
// ⚠ AND ONE MUTATION HAD TO BE REWRITTEN, the trap tests/in_extremis.js records: the first
// version of "detached marks are enforced" produced a double `else` - invalid code, which
// crashes the suite through its guard rather than failing a check, and a crash is not the
// same evidence as a red check.
//
// ⚠ THE SECOND ROUND FOUND FOUR MORE HOLES, three in the checks and one in the CODE:
//   * nothing tested that chaining REFUSES - deleting either the offset or the gap test left
//     every check green. 17b (two parallel piers stay two) and 17c (two distant collinear
//     marks stay two) are those cases.
//   * nothing tested the proportional attachment allowance, so it could be flattened back to
//     a constant unnoticed. 17d is a 20 m pier standing 8 m off.
//   * the marina fixture straddled this suite's OWN charted contour, whose explained band
//     cut the comb's fingers in two - the scan saw a short spine and seven 3 m stubs, and
//     every number the check read was of a different shape. It sits clear of it now.
//   * nothing tested that a footprint must be LARGE, so AREA_MIN_M could be deleted unseen
//     (20e is a 5 x 6 m comb).
//   * check 15 searched the WHOLE drawing function for the magenta, and passed with the LINE
//     colour mutated back to the ENC's red - the FOOTPRINT fill a few lines above still
//     carried the magenta. One colour standing in for the other's check. It slices each
//     block now.
//   * and the offset test itself was written TWICE - g's centre off f's axis, then f's off
//     g's - and mutation could not tell them apart, because inside the 20 deg direction cap
//     the two are all but equal and whichever survived still fired. Two statements where one
//     always implies the other is one statement nobody can test; it is a single symmetric
//     MAX now.

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const fs = require("fs");
const path = require("path");
const C = require("../static/js/chartink.js");
// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes
// its mutants to a file this suite never reads and scores every one as SURVIVED (audited
// 2026-09-21: 21 of the 53 suites reading this page had no override).
const H = fs.readFileSync(process.env.ASV_HTML
                || path.join(__dirname, "..", "static", "asv.html"), "utf8");
const SRC = fs.readFileSync(path.join(__dirname, "..", "static", "js", "chartink.js"), "utf8");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = "THREW: " + e.message; }
  // ⚠ THE DETAIL IS A THUNK TOO, AND IT IS EVALUATED LATE ON PURPOSE. Several of these read
  // the scan's own result, which is exactly what the mutation under test breaks - an eager
  // string would crash the suite instead of failing the check, and a crash scores as
  // SURVIVED in a runner that reads stdout (the trap tests/in_extremis.js records).
  let d = detail;
  if (typeof d === "function") { try { d = d(); } catch (e) { d = "(detail threw: " + e.message + ")"; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   [" + d + "]" : ""));
  if (!ok) fails++;
}

// ── A CHART, DRAWN THE WAY NOAA DRAWS ONE ───────────────────────────────────────────
// Light fills, dark strokes. 0.2 m/px, so the numbers below are the real scale: a 10 m
// finger pier is 50 px, exactly what the live scan works with.
const W = 320, H2 = 320, MPP = 0.2;
function blank() {
  const a = new Uint8ClampedArray(W * H2 * 4);
  for (let i = 0; i < W * H2; i++) {                 // water: the chart's own 209,221,239
    a[i * 4] = 209; a[i * 4 + 1] = 221; a[i * 4 + 2] = 239; a[i * 4 + 3] = 255;
  }
  return a;
}
function stroke(a, x0, y0, x1, y1, v = 114) {        // the chart's grey
  // ⚠ Math.max(1, ...): a ZERO-LENGTH span made n = 0, t = 0/0 = NaN, and the whole stroke
  // was silently skipped by the bounds check. A one-pixel-wide fillRect drew NOTHING and the
  // check that depended on it passed for want of a component to reject.
  const n = Math.max(1, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4);
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
    if (x < 0 || y < 0 || x >= W || y >= H2) continue;
    const p = (y * W + x) * 4;
    a[p] = a[p + 1] = a[p + 2] = v;
  }
}
function maskOf(fn) {
  const m = new Uint8Array(W * H2);
  fn((x, y, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H2) m[ny * W + nx] = 1;
    }
  });
  return m;
}
function paintSeg(paint, x0, y0, x1, y1, r) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    paint(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), r);
  }
}

// THE WORLD: a quay running east-west at y = 100 (charted, so the ENC explains it), a FINGER
// PIER dropping south from it at x = 120 (drawn, NOT charted), and a DEPTH CONTOUR running
// east-west at y = 150 (drawn AND charted). The contour is the whole point of check 7: same
// grey, same width, and the only thing that separates it from the pier is its direction.
const QUAY = { a: { x: 20, y: 80 }, b: { x: 300, y: 80 } };
// ⚠ A SECOND, DISTANT STRUCTURE, LISTED FIRST. With only one segment in the list "the
// nearest structure" and "the first structure" are the same object, so the search that picks
// it cannot be tested at all - a mutation that returned the first survived every check.
const FAR = { a: { x: 20, y: 300 }, b: { x: 300, y: 300 } };
function scene(opts = {}) {
  const a = blank();
  stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);              // the charted quay
  stroke(a, FAR.a.x, FAR.a.y, FAR.b.x, FAR.b.y);                  // the charted far shore
  if (opts.finger !== false) stroke(a, 120, 81, 120, 131);         // 50 px = 10 m, due south
  stroke(a, 20, 170, 300, 170);                                   // a charted depth contour
  if (opts.label) { for (let y = 30; y < 38; y++) stroke(a, 60, y, 66, y, 0); }  // a sounding
  // EACH OF THESE FAILS EXACTLY ONE GATE, hanging off the quay at 90° so that attachment and
  // perpendicularity are both satisfied and only the shape can reject it. Without them the
  // length, width and aspect gates could all be deleted with every check still green.
  // ⚠ 13 px, NOT 10. The quay's explained band is painted EXPLAIN_PX either side, so it
  // eats the first four pixels of anything touching it; at 10 px the remainder was 6 px,
  // under MIN_PX, and the tick was dropped as NOISE before the length gate ever saw it -
  // which made the check pass for a reason that had nothing to do with what it tests.
  if (opts.tick)   fillRect(a, 200, 81, 1, 13);       //  1.8 m x 0.2 m  -> only LENGTH rejects
  if (opts.stub)   fillRect(a, 230, 81, 12, 40);      //  8.0 m x 2.4 m, 3.3:1 -> only ASPECT
  if (opts.slab)   fillRect(a, 255, 81, 25, 140);     // 28.0 m x 5.0 m, 5.6:1 -> only WIDTH
  return a;
}
function fillRect(a, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) stroke(a, x0, y, x0 + w - 1, y);
}
// What the ENC explains: the quay and the contour, painted EXPLAIN_PX thick, plus a disc on
// the sounding's position - a sounding's ink is its LABEL, drawn beside the point.
function explainedOf(opts = {}) {
  return maskOf((paint) => {
    paintSeg(paint, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y, C.EXPLAIN_PX);
    paintSeg(paint, FAR.a.x, FAR.a.y, FAR.b.x, FAR.b.y, C.EXPLAIN_PX);
    paintSeg(paint, 20, 170, 300, 170, C.EXPLAIN_PX);
    if (opts.label) paint(63, 34, 14);
    if (opts.explainFinger) paintSeg(paint, 120, 81, 120, 131, C.EXPLAIN_PX);
  });
}
// FAR IS FIRST. See the note on FAR: a one-segment list cannot test a search.
const SEGS = [{ a: FAR.a, b: FAR.b }, { a: QUAY.a, b: QUAY.b }];
const run = (opts = {}, cls = {}) =>
  C.scanChart(scene(opts), W, H2, explainedOf(opts), SEGS, MPP, cls);

console.log("Reading the chart itself, where the ENC has nothing to say:");

// ── 1-3. THE PIXELS ─────────────────────────────────────────────────────────────────
check("1. ink is what is DRAWN — every fill on this chart is light, every stroke is dark, " +
      "and one luminance threshold separates them",
      () => {
        const m = C.inkMask(scene(), W, H2);
        let n = 0; for (let i = 0; i < m.length; i++) n += m[i];
        // the water fill is 209/221/239 and must contribute nothing at all
        return n > 200 && n < W * H2 * 0.05;
      },
      "a colour list would break the first time NOAA restyled");
check("2. what the ENC already explains is SUBTRACTED — the quay and the contour are its " +
      "own strokes and are not news",
      () => {
        const ink = C.inkMask(scene(), W, H2);
        const un = C.unexplainedMask(ink, explainedOf());
        let i0 = 0, u0 = 0;
        for (let i = 0; i < ink.length; i++) { i0 += ink[i]; u0 += un[i]; }
        return u0 > 40 && u0 < i0 * 0.5;
      },
      "on the live chart this removes 89% of the ink");
check("3. marks are grouped EIGHT-connected — a diagonal stroke is one mark, not a dotted " +
      "line of them",
      () => {
        const a = blank();
        stroke(a, 40, 40, 90, 90);                    // a pure diagonal
        const ink = C.inkMask(a, W, H2);
        const comps = C.components(ink, W, H2, 4);
        return comps.length === 1;
      },
      () => "");

// ── 4-8. THE SIEVE ──────────────────────────────────────────────────────────────────
check("4. THE FINGER PIER IS FOUND: long, thin, attached to the quay and square to it",
      () => {
        const r = run();
        return r.structures.length === 1
            && Math.abs(r.structures[0].lengthM - 10) < 1.5
            && r.structures[0].angleDeg > 80
            && r.structures[0].attachM < 1.5;
      },
      () => { const s = run().structures[0];
              return s ? s.lengthM.toFixed(1) + " m, " + s.angleDeg.toFixed(0) + "°, attached "
                         + s.attachM.toFixed(1) + " m" : "nothing found"; });
check("5. A CHART SYMBOL IS NOT A STRUCTURE, and the gate that catches it is the ASPECT " +
      "ratio — a width limit alone let a 4.9 × 1.9 m symbol through on the live sweep",
      () => {
        // 8.0 x 2.4 m: long enough, narrow enough, attached, square to the quay. ONLY its
        // 3.3:1 shape says it is a symbol and not a finger pier.
        const r = run({ stub: true });
        return r.structures.length === 1
            && r.rejected.some(u => /not thin enough/.test(u.why));
      },
      () => "with the 3.3:1 stub on the quay: " + run({ stub: true }).structures.length
            + " structure(s) kept");
check("5b. ... and a mark can be thin enough and still be too WIDE to be a drawn line",
      () => {
        // 28 x 5 m: 5.6:1, so aspect passes. A five-metre-wide stroke is a filled shape.
        const r = run({ slab: true });
        return r.structures.length === 1
            && r.rejected.some(u => /not a line/.test(u.why));
      },
      () => "with the 28 × 5 m slab: " + run({ slab: true }).structures.length + " kept");
check("5c. ... and a 2 m tick is too SHORT to be a structure at all",
      () => {
        const r = run({ tick: true });
        return r.structures.length === 1
            && r.rejected.some(u => /too short/.test(u.why));
      },
      () => "with the 2 m tick: " + run({ tick: true }).structures.length + " kept");
check("6. IT MUST BE ATTACHED — the same mark standing off in open water is reported, not " +
      "enforced",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        stroke(a, 120, 140, 120, 190);                 // 40 px = 8 m clear of the quay
        const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
        return r.structures.length === 0
            && r.unexplained.some(u => /not attached/.test(u.why));
      },
      "a finger pier springs from a quay; that is what makes it a finger pier");
check("7. ⚠ A CONTOUR GOES NOWHERE, AND THAT IS WHAT TELLS IT FROM A PIER — same grey, " +
      "same width, and only where it LEADS differs",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        stroke(a, 60, 106, 160, 106);                  // parallel to the quay, 26 px off it
        const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
        return r.structures.length === 0
            && r.unexplained.some(u => /goes nowhere/.test(u.why));
      },
      "the confusion Andy named. ⚠ The gate is REACH, not the raw angle: asking the angle " +
      "against the ONE nearest segment refused two real piers on a wiggly foreshore at 0° " +
      "and 21°, because the shoreline happened to lie along them");
// ⚠ 7b IS THE WIGGLY FORESHORE, WHICH IS THE CASE THAT MATTERS. A charted foreshore is
// dozens of short zig-zags, so the ONE segment nearest a pier's root can lie along the pier
// - and on the real chart that refused two obvious piers at 0° and 21°. ZIG is that zig: a
// short charted segment parallel to the pier standing on it.
const ZIG = { a: { x: 112, y: 84 }, b: { x: 126, y: 128 } };
check("7b. ... so a pier whose ROOT sits on a zig of shoreline that happens to run along it " +
      "is still a pier, because it leaves everything charted behind",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        stroke(a, 118, 86, 150, 190);                  // out into the water, along the zig
        const r = C.scanChart(a, W, H2, explainedOf(),
                              SEGS.concat([{ a: ZIG.a, b: ZIG.b }]), MPP);
        return r.structures.length === 1
            && r.structures[0].angleDeg < C.PERP_MIN_DEG
            && r.structures[0].reachM > r.structures[0].reachNeedM;
      },
      () => { const a = blank();
              stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
              stroke(a, 118, 86, 150, 190);
              const r = C.scanChart(a, W, H2, explainedOf(),
                                    SEGS.concat([{ a: ZIG.a, b: ZIG.b }]), MPP);
              const s = r.structures[0] || r.rejected[0];
              return s ? s.angleDeg + "°, attached " + (s.attachM||0).toFixed(1)
                         + " m, reaching " + (s.reachM||0).toFixed(1) + " m of "
                         + (s.reachNeedM||0).toFixed(1) + " needed" : "nothing at all"; });
check("8. a sounding's LABEL is not a structure — its ink is drawn beside the point, and " +
      "the explained mask has to cover the text, not the position",
      () => {
        const r = run({ label: true });
        return r.structures.length === 1;
      },
      "the commonest unexplained mark on any chart");
check("9. line-like marks that fail ONLY the attachment test are returned to be REPORTED, " +
      "never silently dropped and never enforced",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        stroke(a, 60, 150, 110, 150);
        const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
        return r.structures.length === 0 && r.unexplained.length >= 1
            && r.unexplained.every(u => u.keep === false);
      },
      "five such marks at New Castle: every one was foreshore or marsh symbology");
check("10. and a chart with nothing unexplained on it finds nothing — a scan that always " +
      "finds something is a scan nobody can trust",
      () => run({ finger: false, explainFinger: false }).structures.length === 0,
      "Lewes: 715 × 715 m, zero found, zero false positives");

// ── 11. THE AXIS ────────────────────────────────────────────────────────────────────
check("11. the axis fit returns the LONG direction, and its ends are the mark's own ends",
      () => {
        const xs = [], ys = [];
        for (let i = 0; i < 60; i++) { xs.push(10 + i); ys.push(50); }
        const f = C.fitAxis(xs, ys);
        return Math.abs(Math.abs(f.ux) - 1) < 1e-6 && Math.abs(f.uy) < 1e-6
            && Math.abs(f.alongPx - 59) < 1e-6 && f.acrossPx < 1e-6
            && Math.abs(Math.min(f.a.x, f.b.x) - 10) < 1e-6
            && Math.abs(Math.max(f.a.x, f.b.x) - 69) < 1e-6;
      },
      "a minor-axis fit reports a 10 m pier as a 0 m one and every gate then misfires");

// ── 12-15. THE PAGE ─────────────────────────────────────────────────────────────────
// The fold moved into `foldChartInk` when punchOut had to share it - see 12b/12c. These
// three now slice the HELPER; slicing rebuildNogo would have gone red for the refactor
// rather than for a fault.
const FOLD = H.slice(H.indexOf("function foldChartInk"),
                     H.indexOf("function foldChartInk") + 1400);
check("12. the fold is CALLED from rebuildNogo, so it survives a buffer or enforcement " +
      "change instead of being silently discarded",
      () => {
        const rb = H.slice(H.indexOf("function rebuildNogo"),
                           H.indexOf("async function refreshNogo"));
        return rb.length > 400 && /foldChartInk\(nogo\.ko, nogo\.frame\)/.test(rb)
            && FOLD.length > 400
            && /ko\.lines\.push\(\{pts, bb: bbOf\(pts\), kind: CHART_INK_KIND/.test(FOLD);
      },
      "every path that changes a control rebuilds ko from scratch");
check("13. ... and it follows the STRUCTURE enforcement toggle, because that is what these " +
      "are",
      () => /nogo\.enf && nogo\.enf\.land === false\)\) return 0;/.test(FOLD),
      "an operator who turned structures off has said what they mean");
check("12b. ⚠ AND THE SURVEY CLIP SEES THEM TOO. punchOut builds its OWN keep-out model, " +
      "so it can carry the survey's coverage depth window — and that rebuild used to drop " +
      "every structure the chart scan had found",
      () => {
        const po = H.slice(H.indexOf("async function punchOut"),
                           H.indexOf("async function punchOut") + 4000);
        return /const ko=buildKeepouts\(ref, enf, dr, nogo\.features\);/.test(po)
            && /foldChartInk\(ko, ref\);/.test(po)
            && po.indexOf("foldChartInk(ko, ref)") > po.indexOf("const ko=buildKeepouts")
            && po.indexOf("foldChartInk(ko, ref)") < po.indexOf("channelSpanKeepouts");
      },
      "Go-To, RTH and transit read nogo.ko and went round the piers; a punched survey LINE " +
      "was clipped straight through them. koClip and koTurn are spreads of this ko, so the " +
      "fold has to happen before they are made");
check("12c. ... and BOTH callers fold through the one helper, so they cannot disagree about " +
      "what a chart-read keep-out is",
      () => /function foldChartInk\(ko, frame\)\{/.test(H)
            && /const inkN = foldChartInk\(nogo\.ko, nogo\.frame\);/.test(H)
            && (H.match(/ko\.lines\.push\(\{pts, bb: bbOf\(pts\), kind: CHART_INK_KIND/g) || []).length === 1,
      "two folds is two chances to drift - the same fault clearanceM was written to prevent");
check("13b. A FOOTPRINT IS FOLDED AS A POLYGON, not as a line — `blocked` tests a ring with " +
      "a point-in-polygon, so the water INSIDE a marina is refused and not merely its edge",
      () => /ko\.polys\.push\(\{ring, bb: bbOf\(ring\), kind: CHART_INK_AREA_KIND/.test(FOLD)
            && /A\.ring\.length < 3/.test(FOLD),
      "a line would let the router thread between the fingers");
check("14. a REFUSAL is not cached as a clean read — \"I found nothing\" and \"I could not " +
      "look\" must never be the same sentence",
      () => {
        const ec = H.slice(H.indexOf("async function ensureChartInk"),
                           H.indexOf("async function ensureChartInk") + 1800);
        return /chartInk = \{\.\.\.chartInk, key:null,/.test(ec)
            && /CHART_INK_MIN_COVER/.test(H) && /CHART_INK_DEADLINE_MS/.test(H);
      },
      "an unread tile is blank paper and reads exactly like clear water");
check("15. what was read off a picture is DRAWN DIFFERENTLY from what the ENC published — " +
      "both the lines and the footprints",
      () => {
        // ⚠ SLICED TO EACH BLOCK. A file-wide search for the magenta passed with the LINE
        // colour mutated back to the ENC's red, because the FOOTPRINT fill still carried the
        // magenta a few lines above - one colour standing in for the other's check.
        const dn = H.slice(H.indexOf("function drawNogo"), H.indexOf("function drawMarks"));
        const areaBlk = dn.slice(dn.indexOf("chartInk.areas"), dn.indexOf("chartInk.lines"));
        const lineBlk = dn.slice(dn.indexOf("chartInk.lines"));
        return areaBlk.length > 100 && lineBlk.length > 100
            && /rgba\(224,64,208,0\.28\)/.test(areaBlk)
            && /rgba\(224,64,208,0\.95\)/.test(lineBlk)
            && !/rgba\(217,83,79/.test(lineBlk);
      },
      "drawing them in the ENC's own red would claim a warrant the console does not have");
// 16. WHETHER THE CHART WAS COMPARED is said on the Nogo readout, and it is checked in
// tests/nogo_readout.js (17, 18) where that function is actually EXECUTED. A source grep
// here could not fail: the first version matched `chartInk.note`, and the mutation that
// disables the sentence leaves that text sitting in the branch it no longer reaches.
check("16. the nearest charted structure is SEARCHED FOR, not taken as the first in the list",
      () => {
        // FAR is listed first and is 44 m away; the quay is second and is touching.
        const r = run();
        return r.structures.length === 1 && r.structures[0].attachM < 2;
      },
      () => { const s = run().structures[0];
              return s ? "attached " + s.attachM.toFixed(1) + " m" : "nothing found"; });

// ── 17-20. SEGMENTED, COLOURED, GROWN, AND THE ONE THAT IS NOT A LINE ───────────────
// Andy, on the first cut: "The fix applies partially. ... consider shore attached linear and
// segmented linear features also a target for added nogo."
check("17. A PIER DRAWN IN PIECES IS ONE PIER — collinear marks with a small gap are chained " +
      "before anything is judged",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        // the same 50 px finger, drawn as three dashes with 4 px gaps
        stroke(a, 120, 82, 120, 96); stroke(a, 120, 101, 120, 115); stroke(a, 120, 120, 120, 133);
        const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
        return r.structures.length === 1 && r.structures[0].pieces >= 2
            && r.structures[0].lengthM > 8;
      },
      () => { const a = blank();
              stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
              stroke(a, 120, 82, 120, 96); stroke(a, 120, 101, 120, 115); stroke(a, 120, 120, 120, 133);
              const s = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP).structures[0];
              return s ? s.pieces + " pieces, " + s.lengthM.toFixed(1) + " m" : "nothing found"; });
// ⚠ 17b AND 17c ARE THE TWO WAYS CHAINING GOES WRONG, and mutation is what asked for them:
// deleting either the OFFSET or the GAP test left every other check green. Chaining that is
// too eager is worse than none - it fuses separate piers into one wide shape the sieve then
// throws away, or strings unrelated marks into an invented structure.
check("17b. ... but two PARALLEL piers are two piers. Chaining needs a small offset from " +
      "each other's axis, not merely the same direction",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        stroke(a, 120, 81, 120, 131);
        stroke(a, 133, 81, 133, 131);                   // 2.6 m to the side: a NEIGHBOUR
        const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
        return r.structures.length === 2 && r.structures.every(x => x.pieces === 1);
      },
      () => { const a = blank();
              stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
              stroke(a, 120, 81, 120, 131); stroke(a, 133, 81, 133, 131);
              const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
              return r.structures.length + " structure(s), widths "
                     + r.structures.map(x => x.widthM.toFixed(1)).join("/"); });
check("17c. ... and two collinear marks a long way apart are not one mark either",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        stroke(a, 250, 81, 250, 93);                    // 2.4 m
        stroke(a, 250, 133, 250, 145);                  // 2.4 m, 8 m further on
        const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
        return r.structures.length === 0;               // both too short to be anything
      },
      () => { const a = blank();
              stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
              stroke(a, 250, 81, 250, 93); stroke(a, 250, 133, 250, 145);
              const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
              return r.structures.length + " kept; chained into "
                     + (r.structures[0] ? r.structures[0].pieces + " pieces" : "nothing"); });
check("17d. THE ATTACHMENT ALLOWANCE SCALES WITH THE MARK — a 20 m pier standing 8 m off " +
      "the charted shore is a pier reached by a ramp nobody charted",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        stroke(a, 250, 120, 250, 220);                  // 20 m long, its near end 8 m off
        const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
        const tight = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP, { attachFrac: 0 });
        return r.structures.length === 1 && r.structures[0].attachM > C.ATTACH_M
            && tight.structures.length === 0;
      },
      () => { const a = blank();
              stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
              stroke(a, 250, 120, 250, 220);
              const x = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP).structures[0];
              return x ? "attached " + x.attachM.toFixed(1) + " m, allowed "
                         + x.attachMaxM.toFixed(1) + " m" : "nothing found"; });
check("18. MAGENTA IS NOT A STRUCTURE — an aid, a limit or a cable run is dark enough to be " +
      "ink by luminance and must be refused by its COLOUR",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        stroke(a, 120, 81, 120, 131);                       // a real grey finger, for contrast
        // NOAA's own magenta, luminance 125 - well under the ink threshold - drawn as an
        // identical finger. If colour were not read, this would be a second structure.
        for (let y = 82; y < 132; y++) {
          const p = (y * W + 200) * 4;
          a[p] = 219; a[p + 1] = 73; a[p + 2] = 150;
        }
        const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
        return r.structures.length === 1                    // the grey finger, and only it
            && r.structures.every(x => Math.abs(x.a.x - 200) > 5);
      },
      "15.9% of everything the luminance test called ink at New Castle was magenta furniture");
check("19. THE POOL GROWS: a pier HEAD square to an accepted finger is accepted too, " +
      "though it is out of reach of anything the ENC charts",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        stroke(a, 120, 81, 120, 131);                       // the finger: seeds at round 0
        // the pier HEAD: square to the finger, 10.8 m off the quay - too far to attach to
        // anything charted on its own, and reachable only through the finger.
        stroke(a, 95, 136, 145, 136);
        const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
        const head = r.structures.find(x => x.round >= 1);
        // ... and with growth switched off it is NOT found, which is the whole mechanism.
        const off = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP, { growRounds: 0 });
        return r.structures.length === 2 && !!head && off.structures.length === 1;
      },
      () => { const a = blank();
              stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
              stroke(a, 120, 81, 120, 131); stroke(a, 95, 136, 145, 136);
              const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
              return r.structures.map(x => x.lengthM.toFixed(1) + " m @ round " + x.round).join(", ")
                     || "nothing found"; });
// ── 20-20c. THE MARINA, ENFORCED. Andy: "enforce the marina footprints too." ─────────
// ⚠ y = 100-150, CLEAR OF THE CHARTED CONTOUR AT y = 170. The first version put the comb
// across it, and the contour's explained band (EXPLAIN_PX either side) CUT THE FINGERS IN
// TWO - the scan then saw a short spine and seven 3 m stubs, and the "marina" it found was
// 5 m tall instead of 10. Every number the check read was of a different shape.
function marina() {
  const a = blank();
  stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
  stroke(a, 60, 100, 200, 100);                             // a spine...
  for (let x = 70; x <= 190; x += 20) stroke(a, x, 100, x, 150);      // ...and its fingers
  return a;
}
check("20. A MARINA IS A FOOTPRINT, NOT A LINE — the comb is refused by the line sieve and " +
      "comes back as an AREA carrying the convex hull of its own ink",
      () => {
        const r = C.scanChart(marina(), W, H2, explainedOf(), SEGS, MPP);
        return r.areas.length === 1 && r.areas[0].hull.length >= 3
            && !r.structures.some(x => x.widthM > C.MAX_WIDTH_M);
      },
      () => { const r = C.scanChart(marina(), W, H2, explainedOf(), SEGS, MPP);
              return r.areas.length + " area(s)"
                     + (r.areas[0] ? ", hull " + r.areas[0].hull.length + " pts, "
                        + r.areas[0].lengthM.toFixed(1) + "x" + r.areas[0].widthM.toFixed(1)
                        + " m, fill " + (100*r.areas[0].fill).toFixed(0) + "%" : ""); });
check("20b. ... and the hull ENCLOSES the water between the fingers, which is the whole " +
      "reason it is an area and not a set of lines",
      () => {
        const r = C.scanChart(marina(), W, H2, explainedOf(), SEGS, MPP);
        const ring = r.areas[0] && r.areas[0].hull;
        if (!ring) return false;
        // a point in the middle of a bay between two fingers
        const q = { x: 80, y: 130 };
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          if ((ring[i].y > q.y) !== (ring[j].y > q.y) &&
              q.x < (ring[j].x - ring[i].x) * (q.y - ring[i].y) / (ring[j].y - ring[i].y) + ring[i].x)
            inside = !inside;
        }
        return inside;
      },
      "the gaps between floats are metres wide and hold moored boats the chart does not draw");
check("20c. ... but a DENSE blob of the same size is a symbol or a block of text, and is " +
      "refused by the fill test alone",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        for (let y = 100; y <= 150; y++) stroke(a, 60, y, 200, y);      // solid, 100% filled
        const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
        return r.areas.length === 0 && r.structures.length === 0;
      },
      () => { const a = blank();
              stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
              for (let y = 100; y <= 150; y++) stroke(a, 60, y, 200, y);
              const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
              const w = r.rejected.find(x => x.widthM > C.MAX_WIDTH_M);
              return w ? "fill " + (100 * w.fill).toFixed(0) + "%, "
                         + r.areas.length + " area(s)" : "no wide mark at all"; });
check("20d. ... and a footprint that touches nothing charted is refused, on the same " +
      "proportional rule a pier obeys",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        // a SMALL comb far from anything charted: 12 m long, so its allowance is 12 m, and
        // the nearest charted thing is 17.6 m away.
        stroke(a, 100, 200, 160, 200);
        for (let x = 110; x <= 150; x += 20) stroke(a, x, 200, x, 225);
        const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
        return r.areas.length === 0;
      },
      () => { const a = blank();
              stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
              stroke(a, 100, 200, 160, 200);
              for (let x = 110; x <= 150; x += 20) stroke(a, x, 200, x, 225);
              const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
              const w = r.rejected.find(x => x.widthM > C.MAX_WIDTH_M);
              return w ? "attached " + w.attachM.toFixed(1) + " of "
                         + w.attachMaxM.toFixed(1) + " m allowed" : "none"; });

check("20e. ... and a SMALL comb is not a footprint either — a keep-out area has to be big " +
      "enough to be a place, or every cluster of chart furniture becomes one",
      () => {
        const a = blank();
        stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
        stroke(a, 120, 100, 150, 100);                      // 6 m of spine...
        for (let x = 125; x <= 145; x += 10) stroke(a, x, 100, x, 125);   // ...5 m fingers
        const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
        return r.areas.length === 0;
      },
      () => { const a = blank();
              stroke(a, QUAY.a.x, QUAY.a.y, QUAY.b.x, QUAY.b.y);
              stroke(a, 120, 100, 150, 100);
              for (let x = 125; x <= 145; x += 10) stroke(a, x, 100, x, 125);
              const r = C.scanChart(a, W, H2, explainedOf(), SEGS, MPP);
              const w = r.rejected.find(x => x.widthM > C.MAX_WIDTH_M);
              return w ? w.lengthM.toFixed(1) + " x " + w.widthM.toFixed(1) + " m, needs "
                         + C.AREA_MIN_M + " m" : "no wide mark"; });

console.log("");
console.log(fails ? (fails + " CHECK(S) FAILED of " + ran) : ("all " + ran + " checks pass"));
process.exit(fails ? 1 : 0);
