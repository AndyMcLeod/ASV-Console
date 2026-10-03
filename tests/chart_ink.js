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
// ⚠⚠ FOURTH ROUND (2026-10-01, Bellingham): A DASH THAT ENDS IN A DOT IS A LINE SYMBOL. Andy: *"identified a cable
// way as a shore attached feature to be avoided ... visually identified as a cable way by the segmented line, but each
// segment has a dot on one end."* Chaining joined 103 of its dashes into a 1,440 m "pier". Checks 23-23g. TEETH: 13
// mutations of endDot / dashDotWhy / the chain's dot count / the verdict, all 13 killed:
//   the dash-dot verdict never fires -> 23, 23f    no fraction gate -> 23d      no minimum count -> 23c, 23f
//   a T-head is compact enough -> 23e              no ratio gate -> 17, 17d, 23e, 6
//   no extra margin -> 23e                         only one end looked at -> 23, 23c, 23d, 23e
//   a chain forgets its dots -> 23, 23d, 23f       a symbol may be a footprint -> 23f
//   no piece is ever read -> 23, 23c, 23d, 23f     no minimum length -> 23e
//   only a KEPT mark is judged a symbol -> 23f     the stroke's width is its widest bin -> 23e
// The last first SURVIVED: every fixture's dash was clean, so its median and its widest bin agreed. 23e's blemish -
// two stray pixels in the stroke - is the case where they do not.
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
      // ⚠ TWO MODELS SINCE 2026-09-22, AND BOTH MUST BE FOLDED. punchOut builds koCov at
      // the operator's coverage window (the CLIP reads it) and `ko` at the floor alone (the
      // turns, leads and region hops read it) - see min_depth_floor 17/17b. Folding one only
      // would leave the other blind to the piers all over again, which is this finding back
      // on whichever half was missed. The ORDER still matters for the same reason: both
      // folds have to precede the spreads that make koClip and koTurn.
      () => {
        const po = H.slice(H.indexOf("async function punchOut"),
                           H.indexOf("async function punchOut") + 6000);
        const both = /const koCov=buildKeepouts\(ref, enf, dr, nogo\.features\);/.test(po)
            && /const ko=buildKeepouts\(ref, enf, \{min: dr\.min, max: 0\}, nogo\.features\);/.test(po);
        const folded = /foldChartInk\(koCov, ref\);/.test(po) && /foldChartInk\(ko, ref\);/.test(po);
        const beforeSpreads = po.indexOf("foldChartInk(ko, ref)") > po.indexOf("const ko=buildKeepouts")
            && po.indexOf("foldChartInk(koCov, ref)") > po.indexOf("const koCov=buildKeepouts")
            && Math.max(po.indexOf("foldChartInk(ko, ref)"), po.indexOf("foldChartInk(koCov, ref)"))
               < po.indexOf("channelSpanKeepouts");
        return both && folded && beforeSpreads;
      },
      "Go-To, RTH and transit read nogo.ko and went round the piers; a punched survey LINE " +
      "was clipped straight through them. koClip spreads koCov and koTurn spreads ko, so " +
      "BOTH folds have to happen before either spread is made");
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
// 14. A REFUSAL IS NOT CACHED AS A CLEAN READ - it is EXECUTED now, beside 14b at the end of this file, because since
// 2026-10-02 the reads are KEPT (chartReads) and a refusal must also take nothing AWAY from the reads of other water;
// a source grep for the line that used to empty the read could only have held the old rule.
check("15. what was read off a picture is DRAWN DIFFERENTLY from what the ENC published — " +
      "both the lines and the footprints",
      () => {
        // ⚠ SLICED TO EACH BLOCK. A file-wide search for the magenta passed with the LINE
        // colour mutated back to the ENC's red, because the FOOTPRINT fill still carried the
        // magenta a few lines above - one colour standing in for the other's check.
        // "function drawNogo(" exactly: drawNogoCached (2026-09-29) sits above it and names chartInk.lines/areas too.
        const dn = H.slice(H.indexOf("function drawNogo("), H.indexOf("function drawMarks"));
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


// ── 21. THE PUNCH MEMO KNOWS WHEN THE CHART HAS BEEN READ ────────────────────────────
//
// The scan folds its own polygons into the SAME keep-out model the ENC features are in
// (foldChartInk), but `patStrikeKey` named only `nogo.features` - the ENC snapshot - so a
// punch taken BEFORE the tiles arrived and one taken AFTER produced the identical key, and
// the memo served the pre-scan runs back.
//
// MEASURED, driving the real punch phase over a 60x20 m float system: the first punch
// clipped with 0 chart areas and returned 4 runs crossing the footprint; the operator
// re-commanded, the scan had by then found the structure, and the memo HIT - the same 4
// runs, still crossing. A fresh clip of that water gives 8 runs and none crossing. The
// survey was planned straight through a structure the console had just read off the chart.
//
// ⚠ THE READ IS NAMED BY ITS KEY AND ITS COUNTS, NOT BY THE AREAS THEMSELVES. `chartInk.key`
// is the box and band the scan was taken over, and the two counts move whenever the scan
// finds something - between them they change on every transition that matters, and neither
// costs a walk of the geometry on a key that is built on every punch.
{
  const i = H.indexOf("function patStrikeKey(){");
  const strike = H.slice(i, H.indexOf("\n}", i));
  check("21. the punch key names the CHART READ, not just the ENC features - a punch before "
        + "the tiles arrived and one after must not share a memo",
        () => /chartInk\.key/.test(strike)
              && /chartInk\.lines\.length/.test(strike)
              && /\(chartInk\.areas\|\|\[\]\)\.length/.test(strike),
        "the key carries chartInk.key and the line/area counts. Without them the memo hit "
          + "after the scan landed and served the pre-scan runs: 4 runs crossing a 60x20 m "
          + "float system where a fresh clip gives 8 and none crossing");
  // The separator has to survive being embedded: chartInk.key is built from a bbox and a
  // band and could contain the "|" this key joins on, which would silently merge two fields
  // and make two different reads produce one key.
  check("21b. ... and the read's own key cannot break the field separator",
        () => /\(chartInk\.key\|\|"-"\)\.replace\(\/\\\|\/g,"~"\)/.test(strike),
        "chartInk.key is embedded with its pipes replaced; a raw key with a '|' in it would "
          + "merge two fields and let two different reads collide");
}

// ── 22. THE NEAREST STRUCTURE FROM A GRID, AND A SCAN THAT GIVES THE PAGE BACK (2026-09-29) ─
//
// THE WALK WAS THE FREEZE. `classify` asks `nearestSeg` about both ends of every mark, and the
// pool is every structural segment in the extract: on his New Castle chart 97,753 of them for 70
// marks, ~1.9 s of the single 3.0 s task that stopped the page - and the clearance guard with it -
// on every RTH, Go-To and Upload that read the chart. `segIndex` answers the same question from the
// cells round the point outward, and it must answer it EXACTLY, ties included: which of two equally
// near segments is named sets the angle `classify` measures. So every check here asks the grid and
// the walk the same question and demands the same OBJECT back, not a close number.
(async () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const world = [];
  for (let k = 0; k < 60; k++) {                       // polylines: every inner vertex is on TWO segments
    let x = rnd() * 2000 - 500, y = rnd() * 2000 - 500;
    for (let j = 0; j < 12; j++) {
      const nx = x + (rnd() - 0.5) * 120, ny = y + (rnd() - 0.5) * 120;
      world.push({ a: { x, y }, b: { x: nx, y: ny } }); x = nx; y = ny;
    }
  }
  for (let k = 0; k < 6; k++)                          // long enough to go to the list every query reads
    world.push({ a: { x: -60000 + rnd() * 1000, y: rnd() * 2000 }, b: { x: 60000, y: rnd() * 2000 } });
  for (let k = 0; k < 20; k++) { const x = rnd() * 3000, y = rnd() * 3000; world.push({ a: { x, y }, b: { x, y } }); }
  for (let k = 0; k < 200; k++) {                      // a cluster far from everything else
    const x = 40000 + rnd() * 500, y = 40000 + rnd() * 500;
    world.push({ a: { x, y }, b: { x: x + 30, y: y + 10 } });
  }
  const probes = [];
  for (let k = 0; k < 1500; k++) probes.push({ x: rnd() * 5000 - 1500, y: rnd() * 5000 - 1500 });
  for (const s of world.slice(0, 720)) probes.push({ x: s.a.x, y: s.a.y }, { x: s.b.x, y: s.b.y });
  probes.push({ x: 41000, y: 41000 }, { x: -1e6, y: 3e5 }, { x: NaN, y: 5 });
  const ix = C.segIndex(world);
  const same = (w, g) => (w.d === g.d || (Number.isNaN(w.d) && Number.isNaN(g.d))) && w.seg === g.seg;
  let diff = 0, vertexTies = 0; const firstDiff = [];
  for (const p of probes) {
    const w = C.nearestSeg(p, world), g = ix.nearest(p);
    if (!same(w, g)) { diff++; if (firstDiff.length < 2) firstDiff.push(JSON.stringify(p) + " walk " + w.d + " grid " + g.d); }
    if (w.d === 0) vertexTies++;
  }
  const empty = C.segIndex([]).nearest({ x: 0, y: 0 }), emptyWalk = C.nearestSeg({ x: 0, y: 0 }, []);
  check("22. the grid answers EXACTLY as the walk - the same distance and the SAME segment: ties at shared "
        + "vertices go to the lowest index, and the long segments, the zero-length ones, the far cluster, a "
        + "point far off, a non-finite point and an empty pool all agree",
        () => diff === 0 && vertexTies > 1000 && same(emptyWalk, empty) && empty.seg === null,
        () => probes.length + " probes (" + vertexTies + " on a vertex, where two segments tie), " + diff
              + " disagreements" + (firstDiff.length ? ": " + firstDiff.join("; ") : ""));

  // 22b. ... and so the VERDICTS are the walk's: `classify` through the grid and through the list.
  let vdiff = 0, kept = 0, n = 0;
  for (let k = 0; k < 400; k++) {
    const x0 = rnd() * 2500 - 600, y0 = rnd() * 2500 - 600, ang = rnd() * Math.PI, len = 5 + rnd() * 120;
    const xs = [], ys = [];
    for (let t = 0; t <= len; t++) for (let w = 0; w < 2; w++) {
      xs.push(Math.round(x0 + Math.cos(ang) * t - Math.sin(ang) * w)); ys.push(Math.round(y0 + Math.sin(ang) * t + Math.cos(ang) * w));
    }
    const fit = C.fitAxis(xs, ys);
    const a = C.classify(fit, world, MPP), b = C.classify(fit, C.segIndex(world), MPP);
    n++; if (a.keep) kept++;
    if (JSON.stringify(a) !== JSON.stringify(b)) vdiff++;
  }
  check("22b. ... so `classify` reaches the SAME verdict through the grid as through the list - reason, "
        + "attachment, reach and angle included",
        () => vdiff === 0 && kept > 0 && kept < n,
        () => n + " marks, " + kept + " kept, " + vdiff + " verdicts different");

  // 22c. THE POOL GROWS BY `add`, AT THE NEXT INDEX - exactly as the list's push did.
  const g2 = C.segIndex([{ a: { x: 0, y: 10 }, b: { x: 100, y: 10 } }]);
  const tie = { a: { x: 0, y: -10 }, b: { x: 100, y: -10 } }, nearer = { a: { x: 50, y: 3 }, b: { x: 60, y: 3 } };
  g2.add(tie);
  const t1 = g2.nearest({ x: 50, y: 0 });              // 10 px from both: the FIRST one is named
  g2.add(nearer);
  const t2 = g2.nearest({ x: 50, y: 0 });              // 3 px: the newcomer
  // ⚠ AND THE TIE-BREAK HAS TO BE STATED, NOT INHERITED FROM THE ORDER THE CELLS ARE READ IN. Here the
  // LATER segment lies in the point's own cell and is read first; the earlier one, exactly as near, is
  // only reached in the next ring - so "keep the first one read" names the wrong one, and the walk's
  // answer is the lower index. Without this the explicit tie clause could be deleted with 22 still green:
  // at a shared vertex both segments sit in the same cell, in index order.
  const lowFar = { a: { x: 0, y: 54 }, b: { x: 40, y: 54 } }, highNear = { a: { x: 0, y: 94 }, b: { x: 40, y: 94 } };
  const pTie = { x: 20, y: 74 };                          // 20 px from both; its cell holds only the later one
  const g3 = C.segIndex([lowFar, highNear], 64), t3 = g3.nearest(pTie), w3 = C.nearestSeg(pTie, [lowFar, highNear]);
  check("22c. a segment ADDED later ties behind the ones before it and wins when it is nearer, the pool "
        + "counts it - and a tie is the LOWER index even when the later segment is the one read first",
        () => t1.d === 10 && t1.seg !== tie && t2.seg === nearer && g2.length === 3
              && w3.seg === lowFar && t3.seg === lowFar && t3.d === w3.d,
        () => "tie named " + (t1.seg === tie ? "the NEWCOMER" : "the first") + " at " + t1.d
              + " px; nearer " + (t2.seg === nearer ? "named" : "missed") + "; " + g2.length + " in the pool; "
              + "cross-cell tie named " + (t3.seg === lowFar ? "the lower index" : "the LATER one") + " (walk: "
              + (w3.seg === lowFar ? "lower" : "later") + ")");

  // 22g. AND A POINT FAR FROM EVERYTHING COSTS ONE PASS, NOT A SQUARE OF EMPTY CELLS. The rings cost
  // (2r+1)^2 cells however few hold anything: this point's nearest segment is 781 rings off, some 2.4 M
  // empty lookups, where reading the two segments there are costs two. (Found by 22's own far probe, which
  // took the suite from 2 s to over a minute before the fallback.)
  const sparse = [{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, { a: { x: 1e5, y: 0 }, b: { x: 1e5 + 10, y: 0 } }];
  const gs = C.segIndex(sparse), pf = { x: -5e4, y: 3 };
  const ans = gs.nearest(pf), ws = C.nearestSeg(pf, sparse);
  check("22g. a point far from every segment costs about one pass over the grid, not a square of empty "
        + "cells - and it is still the walk's answer",
        () => ans.seg === ws.seg && ans.d === ws.d && gs.visits <= gs.cells + 16,
        () => gs.visits + " cells visited for a grid of " + gs.cells + " (without the fallback: "
              + Math.round(5e4 / C.SEG_CELL_PX) + " rings)");

  // 22d. AND IT IS NOT A WALK: the fixture scene with 20,000 structural segments far off the canvas
  // gives the same answer, and the searches read a sliver of them. Counted (segReads), not timed.
  const farSegs = SEGS.slice();
  for (let k = 0; k < 20000; k++) { const x = 50000 + (k % 200) * 40, y = 50000 + Math.floor(k / 200) * 40;
    farSegs.push({ a: { x, y }, b: { x: x + 30, y: y + 5 } }); }
  const base = C.scanChart(scene({ tick: true, stub: true }), W, H2, explainedOf(), SEGS, MPP);
  const far = C.scanChart(scene({ tick: true, stub: true }), W, H2, explainedOf(), farSegs, MPP);
  const strip = (r) => JSON.stringify({ ...r, segReads: 0 });
  const walkReads = 2 * far.marks * farSegs.length;       // one round, both ends, every segment
  check("22d. the attachment searches are an INDEX, not a walk: 20,000 structural segments off the canvas "
        + "change nothing and cost almost nothing",
        () => strip(base) === strip(far) && far.structures.length > 0 && far.segReads < walkReads / 100,
        () => far.marks + " marks, " + far.segReads + " segment distances read against " + walkReads
              + " for the walk; the same result: " + (strip(base) === strip(far)));

  // 22e. THE SLICED SCAN IS THE SAME SCAN. One body (scanSteps), two drivers - and it pauses.
  let pauses = 0;
  const scenes = [{ label: true, tick: true, stub: true, slab: true }, {}, { finger: false }];
  let sdiff = 0;
  for (const o of scenes) {
    const a = C.scanChart(scene(o), W, H2, explainedOf(o), SEGS, MPP);
    const b = await C.scanChartSliced(scene(o), W, H2, explainedOf(o), SEGS, MPP, {},
                                      () => { pauses++; return Promise.resolve(); });
    if (JSON.stringify(a) !== JSON.stringify(b)) sdiff++;
  }
  check("22e. scanChartSliced answers exactly as scanChart, and gives the page a turn between its steps",
        () => sdiff === 0 && pauses >= 3 * scenes.length,
        () => scenes.length + " scenes, " + sdiff + " different; " + pauses + " pauses");

  // 22f. THE PAGE USES THEM. The painting skips only what cannot light the canvas and still gathers every
  // structure segment; every step is a turn of its own; the read and the rebuild, the read and the Upload's
  // routing, are separate turns.
  {
    const i = H.indexOf("async function scanChartInk(bb){");
    const scan = H.slice(i, H.indexOf("\n}", i));
    const j = H.indexOf("async function ensureChartInk(bb){");
    const ens = H.slice(j, H.indexOf("\n}", j));
    const k = H.indexOf("async function doUpload(");
    const up = H.slice(k, H.indexOf("\n}", k));
    check("22f. the page scans through scanChartSliced, paints only what can reach the canvas but gathers "
          + "EVERY structure segment, slices the painting, and yields between the read, the rebuild and the "
          + "Upload's routing",
          () => /await scanChartSliced\(rgba, W, H, explained, segs, mPerPx, \{\}, inkYield\)/.test(scan)
                && /if\(!paint && !isStruct\) continue;/.test(scan)
                && /eachPath\(g, q=>\{ if\(paint\) paintPath\(q\); if\(isStruct\) addSegs\(q\); \}\);/.test(scan)
                && /eachRing\(g, r=>\{ if\(paint\) paintPath\(r\); if\(isStruct\) addSegs\(r\); \}\);/.test(scan)
                && /performance\.now\(\) - slice > INK_SLICE_MS\)\{ await inkYield\(\)/.test(scan)
                && (scan.match(/await inkYield\(\)/g) || []).length >= 4
                && /await scanChartInk\(bb\);\s*await inkYield\(\);/.test(ens)
                && /await ensureNogoCovers\(\[\{lat:asv\.lat, lon:asv\.lon\}, \.\.\.wps\], null, \{plan: true\}\);[\s\S]{0,400}?await inkYield\(\);[\s\S]{0,300}?const plan = routePlan\(/.test(up),
          "scanChartInk, ensureChartInk and doUpload in static/asv.html");
  }

  // 14, 14b-14f. THE READS ARE KEPT, AND A REFUSAL OR A THROW ADDS NOTHING AND TAKES NOTHING AWAY (2026-10-02).
  // The page held ONE read: a new one replaced it and a refused one EMPTIED it, so every structure found over other
  // water left the model the planners and the guard use - the punch's piers, the moment an Upload's box over a spread
  // plan was refused. Now every read of the extract is kept (chartReads) and merged (refoldInk, static/js/inkreads.js)
  // into `chartInk`. 14 and 14b are the old rules, kept: a refusal is not cached as a clean read ("I found nothing" and
  // "I could not look" must never be the same sentence) and neither is a read that THREW (2026-09-30: the catch kept
  // the key, so the same water was never read again) - plus, now, that neither takes the other reads with it.
  // THE SHIPPED FUNCTIONS, their leaves stubbed: ensureChartInk, refoldInk, inkNote and inkTileGrid from the page, the
  // merge and the coverage test from static/js/inkreads.js, and a scan that answers what each check needs.
  {
    const G = require("../static/js/geodesy.js");
    const IR = require("../static/js/inkreads.js");
    const { bboxContains } = require("../static/js/geometry.js");
    const fnSrc = (name) => {
      let i = H.indexOf("function " + name + "(");
      if (i < 0) throw new Error("anchor gone: function " + name);
      if (H.slice(i - 6, i) === "async ") i -= 6;
      let k = H.indexOf("{", i), depth = 0;
      for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
      return H.slice(i, k + 1);
    };
    const declOf = (re) => { const m = H.match(re); if (!m) throw new Error("anchor gone: " + re); return m[0]; };
    const PAGE = [declOf(/^const CHART_INK_Z = [^;]*;/m), declOf(/^const CHART_INK_MIN_Z = [^;]*;/m),
                  declOf(/^const CHART_INK_MAX_TILES = [^;]*;/m),
                  "let chartInk = {key:null, lines:[], areas:[], detached:[], note:null, z:null, ms:0, busy:false};",
                  declOf(/^let chartReads = [^;]*;/m),
                  fnSrc("inkTileGrid"), fnSrc("refoldInk"), fnSrc("inkNote"), fnSrc("ensureChartInk")].join("\n");
    const inkWorld = (scan) => {
      const banners = [];
      let scans = 0, rebuilt = 0;
      // eslint-disable-next-line no-new-func
      const w = new Function("nogo", "scanChartInk", "inkYield", "rebuildNogo", "updateNogoUI", "render", "showBanner",
        "worldPx", "TILE", "coveringRead", "mergeReads", "INK_READS_MAX", "bboxContains",
        "\"use strict\";\n" + PAGE + "\nreturn { run: ensureChartInk, ink: () => chartInk, reads: () => chartReads };")(
        { ready: true, band: "enc_harbour" }, async (bb) => { scans++; return scan(bb); }, async () => {},
        () => { rebuilt++; }, () => {}, () => {}, (t) => banners.push(t),
        G.worldPx, G.TILE, IR.coveringRead, IR.mergeReads, IR.INK_READS_MAX, bboxContains);
      return { ...w, banners, scans: () => scans, rebuilt: () => rebuilt };
    };
    // Boxes small enough to read at the finest zoom, and one only the coarsest will take.
    const box = (lat, lon, d) => ({ W: lon, S: lat, E: lon + d, N: lat + d });
    // BIG holds A (and the small boxes inside A below); B lies apart from both.
    const A = box(43.080, -70.710, 0.003), B = box(43.120, -70.650, 0.003), BIG = box(43.070, -70.720, 0.025);
    const pier = (lat, lon, m) => ({ a: { lat, lon }, b: { lat: lat + m / 111320, lon }, lengthM: m });
    const read = (z, lines, extra) => ({ z, tiles: 48, got: 48, ms: 5, lines, areas: [], detached: [], ...(extra || {}) });

    let bTries = 0;                      // B is refused the first time it is asked for, and read the second
    const w14 = inkWorld((bb) => bb === A ? read(19, [pier(43.081, -70.709, 40)])
                                          : (++bTries === 1 ? { refused: "only 3 of 48 chart tiles arrived in 15 s" }
                                                            : read(19, [])));
    await w14.run(A);
    await w14.run(B);
    const after = { lines: w14.ink().lines.length, reads: w14.reads().length, note: w14.ink().note,
                    banner: w14.banners.find((b) => /NOT COMPARED/.test(b)) || "" };
    await w14.run(B);
    const readNow = w14.ink().note || "";
    check("14. a REFUSAL is not cached as a clean read - the same water is read again next time - and, since the reads "
          + "are kept, it takes NOTHING from the others: the pier read over other water stays in the model, the banner "
          + "and the readout both say this water was not read, and once it IS read the readout stops saying so",
          after.lines === 1 && after.reads === 1 && w14.scans() === 3
          && /already read over other water are kept/.test(after.banner)
          && /the last water asked for was NOT read \(only 3 of 48 chart tiles arrived/.test(after.note || "")
          && w14.reads().length === 2 && !/NOT read/.test(readNow),
          () => JSON.stringify({ after, scans: w14.scans(), readNow }));

    const throws = async () => { throw new TypeError("Failed to fetch"); };
    const w14b = inkWorld(throws);
    await w14b.run(A);
    const lone = { ...w14b.ink() };      // a COPY: the next run sets `busy` on the same object before replacing it
    await w14b.run(A);
    const w14bk = inkWorld((bb) => bb === A ? read(19, [pier(43.081, -70.709, 40)]) : throws());
    await w14bk.run(A);
    await w14bk.run(B);
    check("14b. ... nor is a read that THREW: nothing kept for that water, a banner, the same water read again - and with "
          + "a read of other water in hand, that read stays",
          lone.key === null && lone.lines.length === 0 && /^chart read failed: TypeError: Failed to fetch$/.test(lone.note || "")
          && lone.busy === false && w14b.rebuilt() >= 1 && w14b.banners.some((b) => /CHART IMAGE NOT COMPARED/.test(b))
          && w14b.scans() === 2
          && w14bk.ink().lines.length === 1 && /NOT read \(chart read failed/.test(w14bk.ink().note || ""),
          () => JSON.stringify({ key: lone.key, lines: lone.lines.length, note: lone.note, rebuilt: w14b.rebuilt(),
                                 scans: w14b.scans(), kept: w14bk.ink().lines.length }));

    // 14c. Water already read is not read again - unless only a COARSER read holds it.
    const w14c = inkWorld((bb) => bb === BIG ? read(17, []) : bb === A ? read(18, []) : read(19, []));
    await w14c.run(BIG);
    const inA = box(43.0805, -70.7095, 0.001);
    await w14c.run(inA);                 // inside BIG, but BIG was read at z17 and this water reads at z19
    const n1 = w14c.scans();
    await w14c.run(A);                   // read at z18 here...
    const insideA = box(43.0810, -70.7090, 0.001);
    await w14c.run(insideA);             // ...which is detail enough for any finer request inside it
    await w14c.run(A);                   // and the same box again
    check("14c. water already read is NOT read again - inside a z18 read, or the same box - while water only a COARSE "
          + "read holds (z17) is read again at its own detail",
          n1 === 2 && w14c.scans() === 3,
          () => "after BIG and a small box inside it: " + n1 + " scans (2 wanted); at the end " + w14c.scans()
                + " (3 wanted)");

    // 14d. Two reads that found one pier count it once - the finer read's - and nothing only one read found is lost.
    const fine = pier(43.0810, -70.7090, 40), coarse = pier(43.08103, -70.70903, 42), onlyCoarse = pier(43.0815, -70.7085, 30);
    const w14d = inkWorld((bb) => bb === BIG ? read(17, [coarse, onlyCoarse]) : read(19, [fine]));
    await w14d.run(BIG);
    await w14d.run(A);
    const L = w14d.ink().lines;
    check("14d. two reads that found ONE pier count it once - the finer read's - while a pier only the coarse read found "
          + "is KEPT even inside the fine read's box (an unread tile is blank paper); the key names both reads",
          L.length === 2 && L.includes(fine) && L.includes(onlyCoarse) && !L.includes(coarse)
          && (w14d.ink().key || "").split(";").length === 2 && /2 structure\(s\) .* over 2 chart areas/.test(w14d.ink().note),
          () => L.length + " lines; key " + w14d.ink().key + "; " + w14d.ink().note);

    // 14e. A long session cannot grow the reads without bound: the oldest goes past INK_READS_MAX.
    const w14e = inkWorld(() => read(19, []));
    const boxes = Array.from({ length: IR.INK_READS_MAX + 1 }, (_, n) => box(43.0 + n * 0.004, -70.7, 0.003));
    for (const bx of boxes) await w14e.run(bx);
    check("14e. past INK_READS_MAX reads the OLDEST goes - a plan over its water simply reads it again",
          w14e.reads().length === IR.INK_READS_MAX && w14e.reads()[0].bb === boxes[1],
          () => w14e.reads().length + " kept, the first is box " + boxes.indexOf(w14e.reads()[0].bb));

    // 14f. A new extract drops every read: each was taken over the old one's explained mask.
    const rn = fnSrc("refreshNogo");
    check("14f. a NEW EXTRACT drops every read, not only the merged view of them",
          /chartInk = \{key:null, lines:\[\], areas:\[\], detached:\[\], note:null, z:null, ms:0, busy:false\};\s*chartReads = \[\]; inkRefused = null;/.test(rn),
          "refreshNogo in static/asv.html");
  }

  // ── 23. A DASH THAT ENDS IN A DOT IS A LINE SYMBOL, NOT A STRUCTURE ─────────────────────────────────────────────
  // Andy, 2026-10-01, at Bellingham: "The path planner punch out for this survey has identified a cable way as a
  // shore attached feature to be avoided. This particular feature is visually identified as a cable way by the
  // segmented line, but each segment has a dot on one end." The live symbol, measured on the tiles the scan read: a
  // 2 px stroke 31 px long with a 5 px dot on one end, every 36 px. Drawn here at that pixel size, hanging off a
  // charted quay exactly as a pier drawn in pieces would - which is what chaining joined it into, 1,440 m of it.
  {
    const DQ = { a: { x: 10, y: 10 }, b: { x: 310, y: 10 } };
    const DSEGS = [{ a: DQ.a, b: DQ.b }];
    // dotsAt: which pieces carry a dot (default all); bend: radians each piece turns from the one before.
    const dashScene = ({ x = 160, dash = 31, period = 36, dots = true, dotsAt = null, bend = 0 } = {}) => {
      const a = blank();
      stroke(a, DQ.a.x, DQ.a.y, DQ.b.x, DQ.b.y);
      let px = x, py = 11, ang = Math.PI / 2;
      for (let k = 0; ; k++) {
        const ex = px + Math.cos(ang) * (dash - 1), ey = py + Math.sin(ang) * (dash - 1);
        if (ey > 300 || ex < 3 || ex > 316) break;
        stroke(a, px, py, ex, ey); stroke(a, px + 1, py, ex + 1, ey);
        if (dots && (!dotsAt || dotsAt.includes(k))) fillRect(a, Math.round(ex) - 2, Math.round(ey) - 2, 5, 5);
        px += Math.cos(ang) * period; py += Math.sin(ang) * period; ang -= bend;
      }
      return a;
    };
    const dashExplained = () => maskOf((paint) => paintSeg(paint, DQ.a.x, DQ.a.y, DQ.b.x, DQ.b.y, C.EXPLAIN_PX));
    const dashRun = (o = {}, cls = {}) => C.scanChart(dashScene(o), W, H2, dashExplained(), DSEGS, MPP, cls);
    const sym = (r) => r.rejected.filter((x) => x.symbol === "dash-dot");

    const r23 = dashRun();
    check("23. THE CABLE WAY: a segmented line off a charted quay whose every piece ends in a DOT is refused as a "
          + "dash-dot line symbol - not a structure, not a footprint, and not reported as a detached structure",
          () => r23.structures.length === 0 && r23.areas.length === 0
                && sym(r23).some((x) => x.pieces >= 7 && x.dots >= 7)
                && !r23.unexplained.some((u) => /not attached/.test(u.why) && u.pieces > 1),
          () => r23.structures.length + " structure(s), " + r23.areas.length + " footprint(s); "
                + (sym(r23)[0] ? sym(r23)[0].why : "no dash-dot reject"));
    const r23b = dashRun({ dots: false });
    check("23b. ... and the SAME line with no dots is still ONE PIER IN PIECES - the segmented-pier rule stands, and "
          + "only the dots make it a symbol",
          () => r23b.structures.length === 1 && r23b.structures[0].pieces >= 7 && r23b.structures[0].dots === 0,
          () => r23b.structures.map((s) => s.lengthM.toFixed(1) + " m, " + s.pieces + " pieces, " + s.dots + " dots")
                .join("; ") || "nothing kept");
    const r23c = dashRun({ dash: 60, period: 400 });
    check("23c. a pier with ONE dot at its head is still a pier - a single piece is never judged a symbol",
          () => r23c.structures.length === 1 && r23c.structures[0].pieces === 1 && r23c.structures[0].dots === 1,
          () => r23c.structures.map((s) => s.lengthM.toFixed(1) + " m, dots " + s.dots).join("; ") || "nothing kept");
    const r23d = dashRun({ dotsAt: [0, 4] });
    check("23d. ... nor is a pier in pieces with a dot on FEWER THAN HALF of them (2 of 8): a symbol repeats",
          () => r23d.structures.length === 1 && r23d.structures[0].dots === 2 && r23d.structures[0].pieces >= 7,
          () => r23d.structures.map((s) => s.pieces + " pieces, " + s.dots + " dots").join("; ") || "nothing kept");
    // endDot on its own, on pixel sets built directly - each refusal is refused by exactly one of its gates.
    const P = () => { const s = new Set(); return { s, add(x, y) { s.add(x + "," + y); } }; };
    const ln = (p, x0, y0, x1, y1, w = 2) => {
      const n = Math.max(1, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4);
      for (let i = 0; i <= n; i++) {
        const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
        for (let k = 0; k < w; k++) p.add(x + k, y);
      }
    };
    const sq = (p, cx, cy, s) => { for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) p.add(cx - (s >> 1) + dx, cy - (s >> 1) + dy); };
    const dot = (p) => { const xs = [], ys = []; for (const k of p.s) { const [x, y] = k.split(",").map(Number); xs.push(x); ys.push(y); }
                         return C.endDot(xs, ys, C.fitAxis(xs, ys)); };
    const cases = {};
    { const p = P(); ln(p, 10, 10, 10, 40); sq(p, 10, 40, 5); cases.far = dot(p); }
    { const p = P(); ln(p, 10, 10, 10, 40); sq(p, 10, 10, 5); cases.near = dot(p); }
    { const p = P(); ln(p, 10, 40, 32, 18); sq(p, 33, 17, 5); cases.diag = dot(p); }
    { const p = P(); ln(p, 10, 10, 10, 40); cases.plain = dot(p); }
    { const p = P(); ln(p, 10, 10, 10, 40); ln(p, 3, 40, 17, 40, 1); ln(p, 3, 41, 17, 41, 1); cases.tHead = dot(p); }
    { const p = P(); ln(p, 10, 10, 10, 40, 4); sq(p, 12, 41, 6); cases.wideHead = dot(p); }
    { const p = P(); ln(p, 10, 10, 10, 40, 1); sq(p, 11, 41, 2); cases.knob = dot(p); }
    { const p = P(); ln(p, 10, 10, 10, 15, 1); sq(p, 10, 16, 3); cases.short = dot(p); }
    // A BLEMISH in the stroke - two stray pixels where it brushes other ink - must not set its width: the stroke is
    // read by its MEDIAN width, and its widest bin would make the dot look no wider than the stroke.
    { const p = P(); ln(p, 10, 10, 10, 40); p.add(12, 25); p.add(13, 25); sq(p, 10, 40, 5); cases.blemish = dot(p); }
    check("23e. endDot reads a dot at EITHER end, at 45 deg and past a blemish in the stroke, and refuses a plain "
          + "stroke, a T-HEADED pier (not compact), a head only 1.5x its stroke (ratio), a 1 px knob (too slight) and a "
          + "mark too short to have both",
          () => cases.far && cases.near && cases.diag && cases.blemish && !cases.plain && !cases.tHead && !cases.wideHead
                && !cases.knob && !cases.short,
          () => JSON.stringify(cases));
    // A CURVING dash-dot line chains into a mark too wide to read as one line - and the footprint path would then
    // claim the water inside the bend as a marina. The control first: with the dash-dot rule off it IS a footprint.
    const curveOff = dashRun({ x: 40, bend: 0.09 }, { dashDotMinDots: Infinity });
    const curveOn = dashRun({ x: 40, bend: 0.09 });
    check("23f. a CURVING dash-dot line is not a footprint either - with the rule off its hull IS one, so the "
          + "exclusion is what stands between the bend and a keep-out",
          () => curveOff.areas.length >= 1 && curveOn.areas.length === 0 && curveOn.structures.length === 0
                && sym(curveOn).length >= 1,
          () => "rule off: " + curveOff.areas.length + " footprint(s); rule on: " + curveOn.areas.length
                + " footprint(s), " + sym(curveOn).length + " dash-dot reject(s)");
    // and the existing scene, which holds every real pier this suite knows, is untouched by the rule
    const base = run({ tick: true, stub: true, slab: true });
    const baseOff = run({ tick: true, stub: true, slab: true }, { dashDotMinDots: Infinity });
    check("23g. ... and the rule changes nothing in a chart with no dash-dot line in it",
          () => JSON.stringify(base.structures) === JSON.stringify(baseOff.structures)
                && base.areas.length === baseOff.areas.length && !base.rejected.some((x) => x.symbol),
          () => base.structures.length + " structure(s) either way");
  }

  console.log("");
  console.log(fails ? (fails + " CHECK(S) FAILED of " + ran) : ("all " + ran + " checks pass"));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("  FAIL 22. CRASHED: " + (e && e.stack || e)); process.exit(1); });
