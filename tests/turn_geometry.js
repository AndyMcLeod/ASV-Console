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
// check 15 fails. THE JUNCTION SEAM (22-27): loosen KNOT_TURN_DEG or KNOT_STEP_M and
// 22/23 fail; neuter pruneJunctionKnots (return the via unchanged) and 23/24 fail;
// drop its legClear bridge guard and 25 fails (an obstacle-forced fold gets pruned
// into an unlawful leg); unwire it from punchOut's routed branch - the shipped
// 2026-08-10 fault - and 27 fails.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy and shares
// one global scope; the eval below reproduces that.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// check() turns a throw inside its own thunk into a failed check. Scenario SETUP is not
// inside one - building a world, eval-ing page code, awaiting a fetch - and a throw there
// would kill the process before a single FAIL line printed. "No FAIL lines" and "the
// process died" are indistinguishable to anything reading stdout, so a mutation that
// crashes this suite would score as SURVIVED. Report it instead, in the normal format.
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

// LAYER-0 HELPERS COME FROM THE REAL MODULES, not from asv.html's source text.
// These moved out of the page on 2026-08-09. Requiring them means a renamed or
// deleted export fails HERE, loudly, instead of silently reverting to a stale copy;
// and the checks below exercise the shipped function rather than an eval of its text.
// Top-level so the suite's DIRECT eval() of page functions still resolves them.
const { azTo, distTo, fromEN, llEN, planeFrame } = require("../static/js/geodesy.js");
const { dSeg, inBB, pinp } = require("../static/js/geometry.js");

// The vessel-derived parameter block moved to static/js/state.js (2026-08-09). The page
// functions eval'd below read V.NOGO_MIN_DEPTH_M / V.WRECK_RADIUS_M / ..., so the suite
// needs the SAME object the page mutates - and gets it, rather than a stub, so a check
// that leans on a vessel default is reading the real one.
const { V, nogo } = require("../static/js/state.js");

// THE REAL MODULE, not its source text lifted out of the page. A renamed or
// deleted export now fails HERE, at load, instead of quietly resolving to a stale
// copy - and the checks below exercise the function that actually ships.
const { blocked, legClear } = require("../static/js/chart.js");
// The turn geometry itself, from the module it moved to out of asv.html.
const { arcPts, minTurnRadiusM, shortenSeg, teardropTurn } = require("../static/js/turns.js");

// The junction-seam guard (2026-08-10, mission wpt 551) ships in passage.js beside
// pruneStitch - the interior prune it completes. Required, not grabbed: real module.
const { KNOT_STEP_M, KNOT_TURN_DEG, junctionKnot, pruneJunctionKnots } = require("../static/js/passage.js");

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

// THE TURN CLUSTER IS A MODULE NOW (2026-08-20), so this suite no longer lifts it out
// of the page as source text and eval()s it. minTurnRadiusM, arcPts and teardropTurn are
// REQUIRED above, which means a rename or a deletion fails HERE, at load, instead of
// quietly resolving to a stale copy of a function the console no longer runs.
const M_PER_DEG_LAT = 111320.0;

// V.SPEED_KN / V.MAX_TURN_RATE_DEG_S are the vessel mirrors loadVessel() fills from
// /api/vessel; set here so each vessel below can be swapped in. They are read THROUGH V
// by the real module, so writing them is all it takes.
V.SPEED_KN = { low: 1.5, survey: 3.0, high: 6.0 };
V.MAX_TURN_RATE_DEG_S = 60;

// --- synthetic world ------------------------------------------------------- //
// Survey lines running due NORTH/SOUTH. The boat finishes line k heading north at E,
// and must pick up line k+1 heading south at F, `spacing` metres to the EAST. So the
// turn's outboard direction (+n) is "past the north end of the lines".
// A FRAME, not a bare point: the clearance bodies teardropTurn calls are asv_core's now
// and convert through `frame.toEN`. planeFrame still carries lat/lon, so nothing else moves.
const ref = planeFrame({ lat: 38.7896, lon: -75.1609 });           // the DriX's Lewes base
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

// 22-27. THE JUNCTION SEAM (session 20260810-131214, mission wpt 551). A ROUTED
// inter-line transit meets the survey line AT the line's own endpoint, and the
// line's heading is outside the route - so channelLaneRoute's interior knot prune
// (pruneStitch) cannot unfold a reversal folded at the junction, at this or any
// version. The generator shipped a via whose first point sat 4.5 m BEHIND a 22 m
// sliver line end (176° fold); a boat with any real turn radius orbits trying to
// capture it. pruneJunctionKnots runs in punchOut's transit loop - the one place
// holding both the via and the line endpoints. NO SYNTHETIC WORLD FOLDS THE SEAM
// through the real router here (same finding as buoy_lane 19/19b): the real-geometry
// proof is the session-log replay - logged 23-line plan + real Lewes ENC at the live
// parameters (buffer 5, plan speed high) still assembles the exact 175.9°/4.46 m
// knot from the RAW route at HEAD, and none with the prune, every other routed via
// untouched (8->8, 3->3, 4->4 points; the folded one 2->1). The checks below
// rebuild the CLASS hermetically on hand-built vias, in the logged knot's own
// geometry, and pin the wiring.
{
  // The logged shape, scaled into the suite's frame: line k arrives at Ap heading
  // north; the next line lies BEHIND (a genuine reversal gap); the routed via's
  // first point v1 folds 160° within 4.5 m of Ap.
  const lineIn = enLL(0, -50), Ap = enLL(0, 0);
  const v1 = enLL(1.5, -4.2), v2 = enLL(4, -35);
  const Bp = enLL(6, -45), lineOut = enLL(6, -105);

  check("22. junctionKnot: the flown fold (160° in 4.5 m) IS a knot; the same reversal " +
        "over the full 45 m gap is NOT (that is the flyable wide swing)",
        junctionKnot(lineIn, Ap, v1) && !junctionKnot(lineIn, Ap, Bp),
        "thresholds " + KNOT_TURN_DEG + "°/" + KNOT_STEP_M + " m");

  const clear = pruneJunctionKnots(lineIn, Ap, [v1, v2], Bp, lineOut, ref, CLEAR, BUF);
  check("23. in clear water the folding entry point goes, the lawful one stays, and no " +
        "junction knot remains on the assembled seam",
        clear.length === 1 && near(toE(clear[0]), 4, 0.01) &&
        !junctionKnot(lineIn, Ap, clear[0]) && !junctionKnot(clear[0], Bp, lineOut),
        "via 2 -> " + clear.length);

  // exit-side mirror: the route overshoots Bp and folds back onto the line start
  const w1 = enLL(4, -35), w2 = enLL(6, -49.5);          // w2 = 4.5 m PAST Bp, 180° fold
  const ex = pruneJunctionKnots(lineIn, Ap, [w1, w2], Bp, lineOut, ref, CLEAR, BUF);
  check("24. the mirrored fold at the EXIT junction is pruned the same way",
        ex.length === 1 && near(toE(ex[0]), 4, 0.01) && !junctionKnot(ex[0], Bp, lineOut),
        "via 2 -> " + ex.length);

  // an obstacle across the bridge Ap->v2 forbids the drop: the fold is FORCED, the
  // via ships intact (unpruned), and junctionKnot still reports it for the caller
  const forced = pruneJunctionKnots(lineIn, Ap, [v1, v2], Bp, lineOut, ref, box(-2, -20, 6, -15), BUF);
  check("25. an obstacle-forced fold is KEPT (the bridge refuses), and still reads as a " +
        "knot for the caller to report",
        forced.length === 2 && near(toE(forced[0]), 1.5, 0.01) && junctionKnot(lineIn, Ap, forced[0]),
        "via stays " + forced.length);

  // the drop keys on the VIA's own step: a wide fold (steep angle, long first leg)
  // is the straight-hop class, not a knot - pruning it would drain lane discipline
  const wide = pruneJunctionKnots(lineIn, Ap, [v2], Bp, lineOut, ref, CLEAR, BUF);
  check("26. a wide fold (35 m first leg) is NOT pruned - only the unflyable step is",
        wide.length === 1 && near(toE(wide[0]), 4, 0.01), "via stays " + wide.length);
}

// 27. THE WIRING (a pure helper proves nothing about who calls it): punchOut's routed
// branch runs the lane route's via through pruneJunctionKnots WITH the line context,
// pushes the PRUNED via, and reports a surviving fold instead of shipping it silently.
{
  const P = grab(H, "punchOut");
  check("27. punchOut prunes the routed via's junction seams and reports a survivor",
        P.includes("pruneJunctionKnots(patClip[k][0], Ap, kr.slice(1,-1), Bp, patClip[k+1][1], ref, koHere, buffer)") &&
        P.includes("patTransits.push(via); patRoutes.push([Ap,...via,Bp]);") &&
        /junctionKnot\(patClip\[k\]\[0\], Ap, via\[0\]\|\|Bp\)[\s\S]{0,220}?nNoTurn\+\+/.test(P));
}


// --- the suites read the modules, not copies of them ---------------------------------- //
// Every suite but ONE now require()s the real modules instead of lifting their source text
// out of a file and eval-ing it. The exception is tests/buoy_lane.js, which monkey-patches
// legPath to reach the "the law cannot patch this stretch" fallback - impossible through an
// import, because gateLegClear calls passage.js's OWN legPath and nothing outside the
// module can reach it. That suite's header explains why it keeps the old route.
//
// This guard exists because the eval route is easy to reintroduce and hard to notice: a
// COPY of a function passes every assertion right up until the shipped one changes. A
// missing import in geometry.js proved the point - ptInGeom called an llEN it never
// imported, the module LOADED fine, and only calling it through a require raised
// "llEN is not defined". Importing a module proves far less than calling one.
{
  const dir = __dirname;
  const allowed = new Set(["buoy_lane.js"]);
  // THE NEEDLE IS ASSEMBLED, NEVER WRITTEN OUT. Spelling it literally makes this file match
  // itself — first through the comment above (stripped), then through the regex itself,
  // which is CODE and cannot be stripped. Splitting it is the only version that is true of
  // the repo rather than of the checker. Fourth instance of this self-match trap here.
  const NEEDLE = "MOD" + "SRC";
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, " ")
                          .replace(/(^|[^:"'])\/\/.*$/gm, "$1");
  const users = fs.readdirSync(dir)
    .filter(f => f.endsWith(".js") && !allowed.has(f))
    .filter(f => strip(fs.readFileSync(path.join(dir, f), "utf8")).includes(NEEDLE));
  check("28. no suite lifts module source text any more - buoy_lane is the one exception",
        users.length === 0,
        users.length ? users.join(", ") : "checked every suite but the documented one");
}

// --- and the PAGE must run the module, not a copy of it -------------------------------- //
// THE HOLE THIS CLOSES. Every check above now calls turns.js directly, which is the whole
// point of taking the turn geometry out of asv.html (2026-08-20) -- but it also means this
// suite would stay green if the page quietly grew its own `teardropTurn` back and stopped
// importing the module. The tests would be exercising code the console no longer runs, and
// no comparison of ANSWERS could see it: a re-inlined copy starts out identical.
//
// Same instrument as asv_core's identity checks, in the only form available across an HTML
// boundary: the page must IMPORT the module, and must not DEFINE any of the four.
{
  const page = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");
  const imports = /from\s+"\/static\/js\/turns\.js"/.test(page);
  const redefined = ["arcPts", "minTurnRadiusM", "shortenSeg", "teardropTurn"]
    .filter(n => new RegExp("(^|\\n)\\s*function\\s+" + n + "\\s*\\(").test(page));
  check("29. the PAGE imports the turn module and does not define its own",
        imports && redefined.length === 0,
        !imports ? "asv.html no longer imports /static/js/turns.js"
                 : redefined.length ? "redefined in the page: " + redefined.join(", ")
                 : "imported, and none of the four is defined in the page");
}

// --- every suite must be able to REPORT its own death ---------------------------------- //
// check() turns a throw inside its thunk into a failed check, but scenario SETUP runs
// outside one, and a throw there used to end the process with no FAIL line at all. To
// anything reading stdout, "no FAIL lines" and "the process died" are the same, so a
// mutation that crashed a suite scored as SURVIVED. Three chart mutations were recorded
// that way before the guard existed.
//
// It also removes a fragility in the RUNNER: the suites end with five different summary
// wordings ("all checks passed", "PASSED n of m", "14 checks, 3 failed", ...), so anything
// sniffing summary text to decide "did this finish?" gets it wrong somewhere - and did,
// reading a healthy turn_channel failure as a crash. With the guard, a death always prints
// a FAIL line, so FAIL lines alone are a sufficient signal and the wording stops mattering.
{
  const dir = __dirname;
  const missing = { js: [], py: [] };
  for (const f of fs.readdirSync(dir)) {
    const src = () => fs.readFileSync(path.join(dir, f), "utf8");
    if (f.endsWith(".js") && !/process\.on\("uncaughtException"/.test(src())) missing.js.push(f);
    if (f.endsWith(".py") && !/sys\.excepthook = _crash_report/.test(src())) missing.py.push(f);
  }
  const gone = missing.js.concat(missing.py);
  check("30. every suite carries the crash guard, so a death is REPORTED not silent",
        gone.length === 0,
        gone.length ? gone.join(", ")
                    : "all " + fs.readdirSync(dir).filter(f => /\.(js|py)$/.test(f)).length + " suites guarded");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
