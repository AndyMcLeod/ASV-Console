// tests/turn_geometry.js - line-to-line SURVEY TURN regression test.
//
// The contract teardropTurn() owes the operator, for every reversal it returns:
//
//   * it ENDS ON THE NEXT LINE, aligned with that line's heading (the whole reason
//     a turn is generated at all instead of a straight hop)
//   * NO PART OF IT IS TIGHTER THAN THE BOAT'S MINIMUM TURN RADIUS at the plan
//     speed - not the entry, not the loop, not the roll-out
//   * it is validated against the nogo model before it is handed back
//
// The second clause is the one that used to be violated by omission. The old
// implementation had exactly one shape - a semicircle whose radius was HALF THE LINE
// SPACING - so a boat whose minimum radius exceeded that got no turn at all, and the
// plan fell back to a "straight" hop between anti-parallel line ends. That hop is a
// 180 deg reversal at half the spacing: the very radius that had just been rejected as
// unflyable, only now unmodelled. The teardrop branch decouples the turn radius from
// the line offset (three tangent circles at minR) so the turn exists at ANY spacing.
//
// Concretely, at survey speed: a 4 m USV needs 2.1 m of radius and a semicircle serves
// it at any spacing; an 8 m USV at 7 kn needs 14.4 m, which a 15 m line spacing can
// never supply. Both vessels are exercised below against the REAL page functions.
//
//   node tests/turn_geometry.js      # exit 0 = pass, 1 = fail   (stdlib Node, no deps)
//
// TEETH: restore the old "return null when half the offset is under minR" clamp and
// checks 5-9 fail (no turn is produced for the big boat at all). Keep the teardrop but
// build it at half the offset instead of minR, or flip either outer arc's direction,
// and the curvature / alignment / turn-away checks fail. Drop the legClear sweep and
// check 15 fails.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy and shares
// one global scope; the eval below reproduces that.

const fs = require("fs");
const path = require("path");

// LAYER-0 HELPERS COME FROM THE REAL MODULES, not from asv.html's source text.
// These moved out of the page on 2026-08-09. Requiring them means a renamed or
// deleted export fails HERE, loudly, instead of silently reverting to a stale copy;
// and the checks below exercise the shipped function rather than an eval of its text.
// Top-level so the suite's DIRECT eval() of page functions still resolves them.
const { azTo, distTo, fromEN, llEN } = require("../static/js/geodesy.js");
const { dSeg, inBB, pinp } = require("../static/js/geometry.js");

// The vessel-derived parameter block moved to static/js/state.js (2026-08-09). The page
// functions eval'd below read V.NOGO_MIN_DEPTH_M / V.WRECK_RADIUS_M / ..., so the suite
// needs the SAME object the page mutates - and gets it, rather than a stub, so a check
// that leans on a vessel default is reading the real one.
const { V } = require("../static/js/state.js");

const STATIC = path.join(__dirname, "..", "static");
const H = fs.readFileSync(path.join(STATIC, "asv.html"), "utf8");

// Pull a `function NAME(...) { ... }` definition out of a source file by brace matching.
function grab(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = src.indexOf("{", start), depth = 0;
  for (;;) { const c = src[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return src.slice(start, k + 1);
}

// The turn cluster plus everything its nogo validation reaches.
const HELPERS = ["blocked",
                 "legClear", "minTurnRadiusM", "arcPts", "teardropTurn"];
const M_PER_DEG_LAT = 111320.0;

// V.SPEED_KN / V.MAX_TURN_RATE_DEG_S are the vessel mirrors loadVessel() fills from
// /api/vessel; declared mutable here so each vessel below can be swapped in.
// eslint-disable-next-line no-eval
eval("const M_PER_DEG_LAT=" + M_PER_DEG_LAT + ";\n" +
     "V.SPEED_KN = {low:1.5,survey:3.0,high:6.0};\nV.MAX_TURN_RATE_DEG_S=60;\n" +
     HELPERS.map((n) => grab(H, n)).join("\n"));

// --- synthetic world ------------------------------------------------------- //
// Survey lines running due NORTH/SOUTH. The boat finishes line k heading north at E,
// and must pick up line k+1 heading south at F, `spacing` metres to the EAST. So the
// turn's outboard direction (+n) is "past the north end of the lines".
const ref = { lat: 38.7896, lon: -75.1609 };                       // the DriX's Lewes base
const cosr = Math.cos(ref.lat * Math.PI / 180);
const enLL = (e, n) => ({ lat: ref.lat + n / M_PER_DEG_LAT, lon: ref.lon + e / (M_PER_DEG_LAT * cosr) });
const toE = (p) => (p.lon - ref.lon) * M_PER_DEG_LAT * cosr;
const toN = (p) => (p.lat - ref.lat) * M_PER_DEG_LAT;
const CLEAR = { polys: [], lines: [], points: [], marks: [] };     // open water
const BUF = 3;

// A rectangular keep-out in local E/N, in the shape blocked() expects.
function box(e0, n0, e1, n1) {
  const ring = [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }];
  return { polys: [{ ring, bb: { x0: e0, y0: n0, x1: e1, y1: n1 }, kind: "test" }],
           lines: [], points: [], marks: [] };
}

// Run a reversal: E at the origin heading north, F `spacing` east and `ahead` north.
// Returns the full path in local E/N (E ... turn ... F) plus the raw result.
function turn(vessel, spacing, opts) {
  opts = opts || {};
  V.SPEED_KN = vessel.speeds; V.MAX_TURN_RATE_DEG_S = vessel.rate;
  const minR = minTurnRadiusM(opts.speed || "survey");
  const E = enLL(0, 0), F = enLL(spacing, opts.ahead || 0);
  const hF = opts.hF === undefined ? 180 : opts.hF;
  const t = teardropTurn(E, F, 0, hF, ref, opts.ko || CLEAR, BUF, minR);
  const pts = t.pts ? [E, ...t.pts, F].map((p) => ({ e: toE(p), n: toN(p) })) : null;
  return { t, pts, minR };
}

// Smallest radius the path ever asks the boat to hold: the circumradius of every
// consecutive triple. Collinear triples give Infinity (a straight run), reversals at a
// tangent point give a large value - only genuine over-tight curvature comes out small.
function minPathRadius(pts) {
  let worst = Infinity;
  for (let i = 2; i < pts.length; i++) {
    const A = pts[i - 2], B = pts[i - 1], C = pts[i];
    const a = Math.hypot(B.e - C.e, B.n - C.n), b = Math.hypot(A.e - C.e, A.n - C.n),
          c = Math.hypot(A.e - B.e, A.n - B.n);
    const area2 = Math.abs((B.e - A.e) * (C.n - A.n) - (C.e - A.e) * (B.n - A.n));
    if (area2 < 1e-9) continue;                        // straight - no curvature demand
    worst = Math.min(worst, (a * b * c) / (2 * area2));
  }
  return worst;
}
const chordAz = (A, B) => (Math.atan2(B.e - A.e, B.n - A.n) * 180 / Math.PI + 360) % 360;
const angDiff = (x, y) => Math.abs(((x - y + 540) % 360) - 180);
const maxStep = (pts) => pts.reduce((m, p, i) => i ? Math.max(m, Math.hypot(p.e - pts[i-1].e, p.n - pts[i-1].n)) : m, 0);

// --- assertions ------------------------------------------------------------ //
let fails = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!cond) fails++;
}
const near = (x, y, tol) => Math.abs(x - y) <= tol;
const f1 = (x, d) => (typeof x === "number" ? x.toFixed(d === undefined ? 2 : d) : "--");   // survives a refused turn

// Two of the vessel profiles the console ships, at the values in vessels/*.json.
// Named by SIZE, not by vendor: the console core carries no brand identity, and these
// are the two ends of the turn-radius range that make the two turn shapes appear.
// (The labels used to read "4 m USV" / "8 m USV"; the small one is 1.9 m LOA and these
// are its numbers - a 4 m profile also exists and has neither of these values.)
const SMALL = { name: "1.9 m ASV", speeds: { low: 1.5, survey: 3.0, high: 6.0 }, rate: 60 };
const LARGE = { name: "7.7 m USV", speeds: { low: 4.0, survey: 7.0, high: 14.0 }, rate: 20 };

console.log("Survey turn geometry — every reversal ends on the next line, at a radius the boat can hold:");

// 1-4. SMALL BOAT, ordinary spacing: half the offset already clears the minimum
// radius, so the turn is the plain semicircle and nothing about it changed.
{
  const { t, pts, minR } = turn(SMALL, 15);
  check("1. small boat @ 15 m spacing -> semicircle", t.kind === "semicircle", "kind=" + t.kind);
  check("2. semicircle radius = half the line offset", near(t.R, 7.5, 0.05), "R=" + t.R.toFixed(2));
  check("3. semicircle reaches exactly R past the line ends", near(t.outboard, 7.5, 0.05),
        "outboard=" + f1(t.outboard));
  check("4. semicircle is inside the boat's turn limit", minPathRadius(pts) >= minR * 0.95,
        "minR=" + minR.toFixed(2) + " path=" + minPathRadius(pts).toFixed(2));
}

// 5-11. BIG BOAT, THE SAME SPACING - the case the old code could not serve at all.
// 15 m of spacing offers a 7.5 m semicircle; this boat needs 14.4 m.
{
  const { t, pts, minR } = turn(LARGE, 15);
  check("5. big boat @ 15 m spacing -> a turn EXISTS", !!t.pts, t.pts ? "" : "why=" + t.why);
  check("6. ... and it is a teardrop, not a semicircle", t.kind === "teardrop", "kind=" + t.kind);
  check("7. teardrop radius = the boat's minimum, NOT half the offset",
        near(t.R, minR, 0.01) && t.R > 7.5 * 1.5, "R=" + f1(t.R) + " minR=" + f1(minR));
  check("8. no point of the path is tighter than the boat can hold",
        minPathRadius(pts) >= minR * 0.95,
        "minR=" + minR.toFixed(2) + " tightest=" + minPathRadius(pts).toFixed(2));
  check("9. rolls out ALIGNED with the next line (heading 180)",
        angDiff(chordAz(pts[pts.length - 2], pts[pts.length - 1]), 180) < 12,
        "exit=" + chordAz(pts[pts.length - 2], pts[pts.length - 1]).toFixed(1) + "°");
  check("10. leaves the line on its own heading (000)",
        angDiff(chordAz(pts[0], pts[1]), 0) < 12, "entry=" + chordAz(pts[0], pts[1]).toFixed(1) + "°");
  check("11. first turns AWAY from the next line", pts[1].e < 0.5 && pts[2].e < 0,
        "e=" + pts[1].e.toFixed(2) + ", " + pts[2].e.toFixed(2));
}

// 12-13. What the teardrop COSTS, which is what the operator is being asked to approve:
// water outboard of the line ends. The loop tops out at q+R, between one and ~2.75
// minimum radii past the end, and it never wanders more than R either side.
{
  const { t, pts, minR } = turn(LARGE, 15);
  const maxN = Math.max(...pts.map((p) => p.n));
  check("12. outboard excursion is reported, and it is what the path does",
        near(t.outboard, maxN, 0.5) && t.outboard > minR && t.outboard < 2.8 * minR,
        "outboard=" + f1(t.outboard,1) + " path max=" + f1(maxN,1) + " minR=" + f1(minR,1));
  check("13. path is continuously sampled (no waypoint gaps)", maxStep(pts) <= 4.5,
        "max step=" + maxStep(pts).toFixed(2) + " m");
}

// 14. THE SHARED BOUNDARY. At exactly twice the minimum radius the teardrop's middle
// circle degenerates (q -> 0) and the two shapes are the same semicircle, so the
// families agree where they meet rather than jumping.
{
  const minR = (() => { V.SPEED_KN = LARGE.speeds; V.MAX_TURN_RATE_DEG_S = LARGE.rate; return minTurnRadiusM("survey"); })();
  const below = turn(LARGE, 2 * minR - 0.001), above = turn(LARGE, 2 * minR + 0.001);
  check("14. teardrop and semicircle agree at spacing = 2 x minR",
        below.t.kind === "teardrop" && above.t.kind === "semicircle" &&
        near(below.t.R, above.t.R, 0.05) && near(below.t.outboard, above.t.outboard, 0.5),
        "R " + below.t.R.toFixed(2) + "/" + above.t.R.toFixed(2) +
        ", outboard " + below.t.outboard.toFixed(2) + "/" + above.t.outboard.toFixed(2));
}

// 15-16. NOGO VALIDATION IS LIVE. The same 15 m reversal, with and without a keep-out
// lying across the water the loop needs. Both halves matter: a turn that is always
// refused would pass a one-sided test.
{
  const clear = turn(LARGE, 15);
  const blockedRun = turn(LARGE, 15, { ko: box(-80, 25, 80, 90) });
  check("15. a keep-out over the loop refuses the turn",
        !blockedRun.t.pts && blockedRun.t.why === "nogo",
        blockedRun.t.pts ? "returned a path THROUGH the keep-out" : "why=" + blockedRun.t.why);
  check("16. ... and the identical turn is produced in clear water", !!clear.t.pts,
        "kind=" + clear.t.kind);
}

// 17-18. Clipped lines of unequal length leave the two ends offset ALONG track. The
// turn absorbs that with a straight run collinear with a survey line and still lands
// on the next line, aligned.
{
  const { t, pts } = turn(LARGE, 15, { ahead: 8 });
  check("17. along-track offset (F 8 m ahead) still produces a teardrop",
        !!t.pts && t.kind === "teardrop", t.pts ? "" : "why=" + t.why);
  check("18. ... ending on the next line, aligned, still continuous",
        near(pts[pts.length - 1].e, 15, 0.01) && near(pts[pts.length - 1].n, 8, 0.01) &&
        angDiff(chordAz(pts[pts.length - 2], pts[pts.length - 1]), 180) < 12 && maxStep(pts) <= 9,
        "end=(" + pts[pts.length-1].e.toFixed(2) + "," + pts[pts.length-1].n.toFixed(2) + ")");
}

// 19. SKEW REFUSAL. The caller's anti-parallel gate is 50 deg wide; the closed form
// assumes a true reversal. A genuinely skewed pair must be declined, not rolled out
// onto a heading that misses the line.
{
  const skew = turn(LARGE, 15, { hF: 140 });
  check("19. a skewed line pair is declined, not fudged",
        !skew.t.pts && skew.t.why === "skew", skew.t.pts ? "produced a turn anyway" : "why=" + skew.t.why);
}

// 20-21. SPEED IS THE OTHER LEVER, and the one the advisory offers the operator: the
// same geometry at low speed needs a much smaller radius, so a spacing that forces a
// teardrop at survey speed can be a plain semicircle at low speed.
{
  const surv = turn(LARGE, 20), low = turn(LARGE, 20, { speed: "low" });
  check("20. 20 m spacing @ survey speed -> teardrop", surv.t.kind === "teardrop",
        "minR=" + surv.minR.toFixed(1) + " kind=" + surv.t.kind);
  check("21. ... the same lines @ low speed -> semicircle", low.t.kind === "semicircle",
        "minR=" + low.minR.toFixed(1) + " kind=" + low.t.kind);
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
