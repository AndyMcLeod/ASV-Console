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
// 2026-08-10 fault - and 27 fails. THE JOIN GATE (50-57, added 2026-09-19): its own
// recorded mutation table sits above check 50, nine mutations, nothing surviving.
//
// ⚠ AND THE FIRST CLAUSE OF THE CONTRACT ABOVE WENT UNENFORCED FOR THE LADDER'S WHOLE
// LIFE. "It ENDS ON THE NEXT LINE, aligned with that line's heading" was tested of the
// shapes the CONSTRUCTORS return and never of the shape `turnWithRetry` hands back - and
// two of its rungs hand back one that joins neither line. See checks 50-57.
//
// NOTE: this suite evaluates page code SLOPPY - a direct eval, so the page's function declarations bind into this
// file. The page itself is <script type="module">, which runs STRICT: an assignment to an undeclared name passes
// here and throws in the page. tests/page_strict.js parses the page and its modules as strict modules; that runtime
// difference is not checked anywhere.

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
const { arcPts, minTurnRadiusM, racetrackTurn: rtt, shortenSeg, spiralTurn: spt, teardropTurn,
        thinTrack, trackGapM, turnFlyable, turnJoinable,
        turnWithRetry: twr } = require("../static/js/turns.js");
const { bbOf } = require("../static/js/geometry.js");

// The junction-seam guard (2026-08-10, mission wpt 551) ships in passage.js beside
// pruneStitch - the interior prune it completes. Required, not grabbed: real module.
const { KNOT_STEP_M, KNOT_TURN_DEG, junctionKnot, pruneJunctionKnots } = require("../static/js/passage.js");

const STATIC = path.join(__dirname, "..", "static");
// ⚠ ASV_HTML POINTS THIS AT A SIDECAR, and this suite was counted as HAVING that override
// by a grep that matched the WORD in the two comments below. It did not have one: every
// mutant written to a sidecar was scored SURVIVED. Measured the honest way instead - point
// every suite at a 53-byte page and see which ones stay green (2026-09-21).
const H = fs.readFileSync(process.env.ASV_HTML || path.join(STATIC, "asv.html"), "utf8");

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
// ⚠⚠ A THUNK IS EVALUATED, NOT COUNTED AS TRUTHY - AND THAT COST SIX CHECKS THEIR TEETH
// (2026-09-19). This helper used to take `cond` as a plain value only. Every other turn
// suite in this repo (tests/direct_turn.js, tests/turn_refusal.js) takes `() => ...`, so
// checks 50-56 were written that way out of habit - and an arrow function IS TRUTHY, so
// all six printed "ok" without evaluating anything at all. They were caught by the
// mutation run that was supposed to confirm them: loosening the rule they exist to hold
// changed nothing, three separate mutations SURVIVED, and the detail lines went on
// printing measured numbers beside a condition nobody had run.
//
// So: evaluate a function, and turn a throw inside it into a FAILED check rather than a
// dead process - the same contract direct_turn.js's has. A plain value still works, which
// is what the 49 checks above pass.
function check(name, cond, detail) {
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? detail + " — " : "") + "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
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
  const page = fs.readFileSync(process.env.ASV_HTML
                               || path.join(__dirname, "..", "static", "asv.html"), "utf8");
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

// ── 31-36. A REVERSAL IS BUILT FROM THE TWO POSES, NOT FROM THE CHORD ──────────────
// Andy, 2026-09-08, looking at a punched plan with lead-in / lead-out extensions on it:
// "The turns for the lead-in / lead-out don't make great sense."
//
// They did not. The semicircle branch put its centre on the MIDPOINT OF E-F and its radius
// at HALF THAT CHORD, so its tangents came out perpendicular to the chord rather than to
// the lines. While the two line ends are abeam those are the same thing, which is why the
// shape was right for as long as nothing produced an along-track offset. A lead-in longer
// than the lead-out produces one at every reversal, and the error is exactly
// atan(along / lateral) at BOTH ends: the boat is thrown off the line it has just run and
// arrives on the next one crabbing. The fix is what racetrackTurn and the teardrop branch
// have always done - run the offset out ON THE LINE, arc between the abeam points.
//
// TEETH - 18 mutations across this suite, strike_run, survey_lead and clearance_guard,
// 2026-09-08; core_turns.js has no ASV_HTML override, so those were applied to a COPY that
// is restored in a `finally` and confirmed with `git diff` at the end of the run. The six
// graded here:
//   R back to half the CHORD (the control)                 -> 31, 32, 33, 34
//   arc re-centred on the E-F midpoint                     -> 31, 32, 34
//   branch gated on the chord again                        -> 33b
//   semicircle asserts its reach as R                      -> 12, 34
//   racetrack asserts its reach as R                       -> 35
//   the run-out guard loses its epsilon                    -> 36
//
// ⚠ ONE MUTATION SURVIVED AND IT IS NOT A DEFECT — dropping the run-out WAYPOINT (leaving
// the arc, which already starts at the abeam point). MEASURED on a 40 m offset: the boat
// would fly a 42.98 m chord from E straight to the first arc point, whose far end is
// 0.22 m off the line — 0.11 m of cross-track, against a keep-out buffer of metres. The
// waypoint is worth having because it says on the chart where the run-out ends, not
// because the geometry needs it. Recorded here rather than answered with a check that
// would only be pinning the source text.
//
// ⚠ AND 33b IS THERE BECAUSE THE FIRST SWEEP MISSED IT. Every fixture here was 40 m
// spacing, where half the crossing (20 m) clears the 8.3 m floor comfortably, so gating on
// the chord instead made no difference and the mutation survived. The corner is a TIGHT
// crossing with a LONG offset, and there the chord-gated branch hands the boat a radius
// below the radius it can hold.
{
  const { racetrackTurn } = require("../static/js/turns.js");
  const refP = planeFrame({ lat: 43.07, lon: -70.76 });
  const llP = (e, n) => fromEN(e, n, refP);
  const SPACING = 40, MINR = 8.3;
  const koOpen = { polys: [], lines: [], points: [], marks: [] };   // open water: geometry only
  // E ends line k on 090; F starts line k+1 on 270, `along` metres further east.
  const turnFor = (along, fn) =>
    fn(llP(0, 0), llP(along, SPACING), 90, 270, refP, koOpen, 1, MINR, 200);
  const dd = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  // The tangent at each end, over the FIRST and LAST generated step. A sampled arc reports
  // its own half-chord angle here, so the comparison is against the NO-OFFSET case rather
  // than against zero: the question is whether an offset makes it worse, not whether a
  // polyline is a circle.
  const ends = (r, along) => { const p = [llP(0,0), ...r.pts, llP(along, SPACING)];
    return [dd(azTo(p[0], p[1]), 90), dd(azTo(p[p.length-2], p[p.length-1]), 270)]; };

  const base = turnFor(0, teardropTurn),  b = ends(base, 0);
  const skew = turnFor(15, teardropTurn), s = ends(skew, 15);
  const hard = turnFor(40, teardropTurn), h = ends(hard, 40);

  check("31. an along-track offset no longer skews the semicircle's tangents",
        !!(base.pts && skew.pts) && s[0] <= b[0] + 0.2 && s[1] <= b[1] + 0.2,
        "abeam " + f1(b[0],1) + "/" + f1(b[1],1) + " deg (that is the arc's half-chord at a "
        + "3 m step), 15 m offset " + f1(s[0],1) + "/" + f1(s[1],1) + " deg — it was 19.2/21.9");
  check("32. ... including a lead-in with no lead-out, which is the worst of it",
        !!hard.pts && h[0] <= b[0] + 0.2 && h[1] <= b[1] + 0.2,
        "40 m offset " + f1(h[0],1) + "/" + f1(h[1],1) + " deg — it was 44.0/46.0");
  // ⚠ AND THE BRANCH GATE HAS TO MEASURE THE CROSSING TOO, WHICH IS A DIFFERENT CORNER.
  // The semicircle is only available when the offset itself supplies a radius the hull can
  // hold — and "the offset" is the CROSSING. Gated on the chord, an along-track offset can
  // carry a pair over the gate that the crossing alone would not, and the branch then
  // builds at half the crossing anyway: a radius BELOW the hull's minimum, handed to the
  // boat as a turn. 12 m of spacing with a 30 m offset is R = 6.0 m against a floor of
  // 8.3 m. The teardrop is the right answer there, and it loops at the floor.
  const tight = teardropTurn(llP(0, 0), llP(30, 12), 90, 270, refP, koOpen, 1, MINR, 200);
  check("33b. a crossing too tight for the hull takes the TEARDROP, whatever the chord",
        !!tight.pts && tight.kind === "teardrop" && near(tight.R, MINR, 0.01),
        "spacing 12 m, offset 30 m: crossing/2 = 6.00 m, chord/2 = 16.16 m, hull floor "
        + f1(MINR) + " m → " + tight.kind + " at R " + f1(tight.R)
        + " m (chord-gated it is a semicircle at R 6.00, under the floor)");

  check("33. R is half the CROSSING, not half the chord",
        near(base.R, SPACING/2, 0.01) && near(skew.R, SPACING/2, 0.01) && near(hard.R, SPACING/2, 0.01),
        "R " + f1(base.R) + " / " + f1(skew.R) + " / " + f1(hard.R)
        + " m at offsets 0 / 15 / 40 — the chord gives 20.00 / 21.36 / 28.28");
  // The reach past the line end is the number the operator answers "is that water clear?"
  // with. Both branches used to ASSERT it, and the semicircle asserted R.
  check("34. the reach past the line end is MEASURED, and grows with the offset",
        near(base.outboard, SPACING/2, 0.25) && near(skew.outboard, 15 + SPACING/2, 0.25)
        && near(hard.outboard, 40 + SPACING/2, 0.25),
        "outboard " + f1(base.outboard) + " / " + f1(skew.outboard) + " / " + f1(hard.outboard)
        + " m — asserting R would have said 20.00 for all three");
  const rt0 = turnFor(0, racetrackTurn), rt40 = turnFor(40, racetrackTurn);
  check("35. ... and the racetrack reports its reach the same way",
        !!(rt0.pts && rt40.pts) && near(rt0.outboard, MINR, 0.4)
        && near(rt40.outboard, 40 + MINR, 0.4),
        "outboard " + f1(rt0 && rt0.outboard) + " m abeam, " + f1(rt40 && rt40.outboard)
        + " m at a 40 m offset — the constant said " + f1(MINR) + " for both");
  // ⚠ AND AN ABEAM PAIR MUST NOT HAVE MOVED. Every plan without a lead has abeam ends, so
  // this is only allowed to be a no-op for them — including no duplicate waypoint, which
  // is what the run-out guard pushed before it was thresholded (`along` is 1e-14, not 0).
  const onCircle = base.pts.map(p => llEN(p.lat, p.lon, refP))
                           .every(p => near(Math.hypot(p.e, p.n - SPACING/2), SPACING/2, 0.02));
  check("36. an abeam pair is untouched — same circle, and no duplicate point at E",
        onCircle && distTo(base.pts[0], llP(0,0)) > 0.05,
        base.pts.length + " points, all within 20 mm of the R" + (SPACING/2)
        + " circle centred between the ends; first point " + f1(distTo(base.pts[0], llP(0,0)))
        + " m off E — 0.00 there is the duplicate waypoint the un-thresholded guard pushed");
}

// ── 37-43. THE EASED REVERSAL: clothoid - arc - clothoid ──────────────────────────
// Andy, 2026-09-08: "build the clothoid version too."
//
// Every other shape here steps its curvature from 0 to 1/R the instant the vessel leaves
// the line - an infinite rudder rate, which the hull answers by overshooting and settling.
// This one ramps: curvature rises linearly over a spiral of length Ls, holds through a
// circular core, and ramps back, so the helm rate is constant and finite and the boat rolls
// out onto the next line already straight.
//
// TEETH - 19 mutations, 17 killed, 2026-09-08 (core_turns.js and turns.js have no
// ASV_HTML override, so those were applied to COPIES restored in a `finally`):
//   the entry ramp is a step / the exit ramp never comes off   -> 37, 39
//   the core is not shortened for what the spirals turned      -> 37, 39, 43
//   the seed is never refined against the integrated crossing  -> 39
//   the spirals are sampled at the ordinary arc step           -> 38, 39
//   a trailing waypoint lands on F again                       -> 39b
//   the hull's floor stops refusing / a NaN radius is built    -> 42, 43
//   easing REPLACES the plain arc rather than sitting above it -> 43, 43b
//   an eased refusal becomes the reason the operator is shown  -> 43b
//
// ⚠ TWO SURVIVED AND BOTH ARE INERT, WHICH IS WORTH MORE HERE THAN A KILL. Deleting the
// spiral term from the discriminant, and dropping the halving so the seed comes out at
// TWICE the right radius, both still converge to the same R: the three Newton steps do
// the work and the closed form only saves iterations. That is a real property of the
// code, and it is now written into core_turns.js's header — where it corrects a comment
// of mine that had claimed R "comes from a closed form, not a search". The mutation run
// is what established it; reading the code had not.
//
// ⚠ AND THE CONTROL MUTATION CRASHED THE SUITE BEFORE THIS BLOCK WAS TOTAL. Making the
// shape always refuse turned check 37 red exactly as intended, and then check 38's DETAIL
// string read `es.pts.length` on a refusal and threw — losing every check after it, which
// the runner scores as SURVIVED. This suite evaluates details eagerly, so a detail has to
// be as total as its condition; see `nPts` and `kappaSteps`.
//
// The properties below are the ones that make this that curve and not a differently-drawn
// arc.
{
  const { spiralTurn } = require("../static/js/turns.js");
  const refS = planeFrame({ lat: 43.07, lon: -70.76 });
  const llS = (e, n) => fromEN(e, n, refS);
  const koS = { polys: [], lines: [], points: [], marks: [] };
  const D = 40, MINR2 = 8.3, LS = 8;
  const ease = (Ls, along, d, minR) =>
    spiralTurn(llS(0, 0), llS(along || 0, d || D), 90, 270, refS, koS, 1, minR ?? MINR2, 400, Ls);

  // Discrete curvature at each interior vertex of a polyline, in the local EN frame, and
  // the largest STEP between neighbouring vertices. The straights either side are included
  // deliberately: the line -> turn junction is where a plain arc's discontinuity lives.
  // ⚠ TOTAL. A mutation that makes the shape REFUSE hands this a {why:...} with no `pts`,
  // and a bare spread would throw — killing the run before a single FAIL line printed,
  // which scores as SURVIVED. The control mutation in the sweep did exactly that.
  const kappaSteps = (r, along) => {
    if (!r || !r.pts) return Infinity;                 // no shape = no smoothness to claim
    const pts = [llS(-8, 0), llS(-4, 0), ...r.pts, llS((along || 0) - 4, D), llS((along || 0) - 8, D)]
      .map(p => { const e = llEN(p.lat, p.lon, refS); return [e.e, e.n]; });
    const k = [];
    for (let i = 1; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], [x3, y3] = pts[i + 1];
      const A = Math.hypot(x2 - x1, y2 - y1), B = Math.hypot(x3 - x2, y3 - y2), C = Math.hypot(x3 - x1, y3 - y1);
      const ar = Math.abs((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1));
      k.push(A * B * C > 0 ? (2 * ar) / (A * B * C) : 0);
    }
    let m = 0; for (let i = 1; i < k.length; i++) m = Math.max(m, Math.abs(k[i] - k[i - 1]));
    return m;
  };

  const es = ease(LS, 0), plain = teardropTurn(llS(0, 0), llS(0, D), 90, 270, refS, koS, 1, MINR2, 400);
  const kE = kappaSteps(es, 0), kP = kappaSteps(plain, 0);
  check("37. the eased turn's curvature CHANGES more gently than the plain arc's",
        !!es.pts && kE < kP,
        "worst curvature step between waypoints: eased " + kE.toFixed(4) + " /m against the "
        + "arc's " + kP.toFixed(4) + " /m — " + (kP / kE).toFixed(1) + "x. Analytically the arc "
        + "STEPS 0→" + (1 / 20).toFixed(3) + " (an infinite derivative) while the clothoid is "
        + "bounded at 1/(R·Ls) = " + (1 / (es.R * LS)).toFixed(5) + "; a polyline can only "
        + "approach either, so this is what the boat is actually handed");

  // ⚠ AND IT COSTS WAYPOINTS, WHICH IS THE PRICE OF THE ABOVE. A curvature ramp sampled too
  // coarsely is an arc wearing the word "eased" — 8 chords per spiral is what buys the row
  // above, and the count is reported to the operator rather than hidden.
  // ⚠ THE DETAIL IS EVALUATED EAGERLY IN THIS SUITE, so it has to be as total as the
  // condition. `es.pts.length` in a detail string killed the whole run under the control
  // mutation — check 37 went red exactly as intended and then nothing after it ran, which
  // reads as SURVIVED to the mutation runner.
  const nPts = r => (r && r.pts) ? r.pts.length : 0;
  check("38. ... and pays for it in waypoints, about double",
        !!es.pts && nPts(es) > nPts(plain) * 1.5,
        "eased " + nPts(es) + " waypoints against the plain arc's " + nPts(plain));

  // ⚠ THE ACROSS ERROR OF THE LAST WAYPOINT IS WHAT THE NEWTON SOLVE BUYS, and it is
  // only visible at a LONG spiral: the closed-form seed is 0.2 mm out at Ls 8 and 23.7 mm
  // at Ls 25, so a fixture at Ls 8 alone cannot tell a solved radius from a seeded one.
  const acrossErr = (r) => {
    if (!r || !r.pts) return Infinity;
    const p = llEN(r.pts[r.pts.length - 1].lat, r.pts[r.pts.length - 1].lon, refS);
    return Math.abs(p.n - D);                          // the next line lies at n = D
  };
  // ⚠ THE TOLERANCE IS 20 mm AND THE REASON IS SAMPLING, NOT SOLVING. The last waypoint
  // sits up to one emit step short of the shape's end by construction, and the curve is
  // still creeping across over that step — so a few millimetres here is the emitter, and
  // it does not shrink monotonically with Ls (0.02 mm at 8, 2.9 at 16, 0.5 at 20, 9.7 at
  // 25, following how the length happens to divide by the step). What WOULD dominate it is
  // a radius left at the closed-form seed: 47 mm at Ls 25, comfortably outside this.
  const long = ease(25, 0);
  check("39. it lands ON the next line, at a short spiral AND a long one",
        !!es.pts && !!long.pts && near(es.R, 19.87, 0.05)
        && acrossErr(es) < 0.02 && acrossErr(long) < 0.02,
        "across error of the last waypoint: " + (acrossErr(es) * 1000).toFixed(2)
        + " mm at Ls 8, " + (acrossErr(long) * 1000).toFixed(2) + " mm at Ls 25 (one emit "
        + "step of creep); the closed-form seed without the Newton steps would put the "
        + "second at 47 mm. R " + f1(es.R) + " m");

  // ...and no waypoint may LAND on F. Whether the last emitted point coincides with the
  // shape's end is an accident of how the length divides by the step: Ls 16 is the case
  // that did, and the caller appending F on top of it read as a 90 deg join.
  const dup = (r, along) => !!r.pts && distTo(r.pts[r.pts.length - 1], llS(along || 0, D));
  check("39b. ... and never ON it, whatever way the length divides by the step",
        [0.6, 4, 8, 12, 16, 20, 25].every(L => dup(ease(L, 0), 0) > 0.05),
        "closest last-waypoint approach to the line start across Ls 0.6-25: "
        + Math.min(...[0.6, 4, 8, 12, 16, 20, 25].map(L => dup(ease(L, 0), 0))).toFixed(3)
        + " m (Ls 16 is the one that used to land exactly on it)");

  // THE FAMILY IS CONTINUOUS: shrink the spiral and the shape must become the semicircle it
  // is a generalisation of. That is the strongest single statement that the integration and
  // the closed form agree with the rest of this file.
  const tiny = ease(0.6, 0);
  check("40. as the spiral shrinks it becomes the plain semicircle",
        !!tiny.pts && near(tiny.R, D / 2, 0.02) && near(tiny.outboard, D / 2, 0.35),
        "Ls 0.6 m → R " + f1(tiny.R) + " and outboard " + f1(tiny.outboard)
        + " against the semicircle's " + (D / 2).toFixed(2) + " and " + f1(plain.outboard)
        + "; at Ls 8 they are R " + f1(es.R) + " and outboard " + f1(es.outboard));

  const off = ease(LS, 25);
  check("41. the along-track offset is absorbed on the line, exactly as the other shapes",
        !!off.pts && near(off.outboard, 25 + es.outboard, 0.05),
        "offset 25 m → outboard " + f1(off.outboard) + " m = 25 + " + f1(es.outboard)
        + ", so a lead does to this shape precisely what it does to a plain arc");

  // ⚠ EASING DOES NOT MAKE A RADIUS FLYABLE. The eased R is always a little TIGHTER than
  // the plain semicircle's, because the spirals contribute crossing of their own — so it
  // has to answer to the hull's floor like everything else, and refuse when it cannot.
  check("42. it refuses rather than handing over a radius the hull cannot hold",
        ease(LS, 0, D, 25).why === "tight" && ease(60, 0).why === "tight"
        && ease(0.2, 0).why === "no-spiral",
        "minR 25 on a 40 m crossing → " + ease(LS, 0, D, 25).why
        + "; a 60 m spiral across 40 m → " + ease(60, 0).why
        + " (no radius spans a crossing under Ls·√6/2 = " + (60 * Math.sqrt(6) / 2).toFixed(0)
        + " m); a 0.2 m spiral → " + ease(0.2, 0).why + ", because that IS the plain arc");

  // ...and the ladder must never let easing cost a plan its turn.
  const { turnWithRetry } = require("../static/js/turns.js");
  const withEase = turnWithRetry(llS(0, 0), llS(0, D), 90, 270, refS, koS, 1, MINR2, 400, 4.1, LS);
  const noEase = turnWithRetry(llS(0, 0), llS(0, D), 90, 270, refS, koS, 1, MINR2, 400, 4.1, 0);
  const refused = turnWithRetry(llS(0, 0), llS(0, 12), 90, 270, refS, koS, 1, MINR2, 400, 4.1, LS);
  const refusedOff = turnWithRetry(llS(0, 0), llS(0, 12), 90, 270, refS, koS, 1, MINR2, 400, 4.1, 0);
  check("43. easing is a rung ON TOP of the ladder, so it can never cost a plan its turn",
        withEase.kind === "eased" && noEase.kind === "semicircle"
        && refused.kind === refusedOff.kind && refused.rung === refusedOff.rung + 1,
        "easeLs 8 → " + withEase.kind + " (rung " + withEase.rung + "), easeLs 0 → "
        + noEase.kind + " (rung " + noEase.rung + "); on a 12 m crossing the eased rung is "
        + "refused and the ladder returns " + refused.kind + " — the same shape easing-off "
        + "returns, one rung later");

  // ⚠ AND THE EASED RUNG IS NEVER THE REFUSAL THE OPERATOR IS SHOWN. When every rung is
  // refused the caller reports the FIRST one's `why` and `seg`, because rung 1 is the turn
  // the operator expected to see and its chord names the feature that actually blocked it.
  // With easing on, rung 1 is a comfort shape whose refusal answers a question nobody
  // asked — and worse, it refuses for reasons ('no-spiral', a crossing too tight for the
  // spiral) that have nothing to do with the water.
  {
    // Foul water on BOTH sides of the pair, so every rung is refused and the caller has to
    // choose whose refusal to report. `seg` is the half that matters: it is the chord the
    // console hands to firstBlockAlong to name the feature on the card.
    const { buildKeepouts } = require("../static/js/chart.js");
    const ring = pts => [pts.map(([e, n]) => { const p = llS(e, n); return [p.lon, p.lat]; })];
    const wall = buildKeepouts(refS, { land: true, depth: true, haz: true, area: false },
      { min: 2, max: 0 },
      [{ role: "land", cls: "Land_Area", props: {},
         geometry: { type: "Polygon", coordinates: ring(
           [[-200, -200], [200, -200], [200, 200], [-200, 200], [-200, -200]]) } }]);
    const wEase  = turnWithRetry(llS(0, 0), llS(0, D), 90, 270, refS, wall, 1, MINR2, 400, 4.1, LS);
    const wPlain = turnWithRetry(llS(0, 0), llS(0, D), 90, 270, refS, wall, 1, MINR2, 400, 4.1, 0);
    const segEq = !!(wEase.seg && wPlain.seg)
      && distTo(wEase.seg[0], wPlain.seg[0]) < 0.01 && distTo(wEase.seg[1], wPlain.seg[1]) < 0.01;
    check("43b. ... and a refusal is still reported by the rung the operator expected",
          !wEase.pts && !wPlain.pts && wEase.why === wPlain.why && segEq,
          "every rung refused: easing on reports '" + wEase.why + "' and easing off '"
          + wPlain.why + "', on the SAME blocking chord — so 'why is there no turn here' is "
          + "answered by the arc the operator expected, not by a comfort shape refusing "
          + "for reasons of its own");
  }
}


// ── 44-49. A ROUTE HAS TO BE FOLLOWABLE BY WHATEVER FOLLOWS IT ─────────────────────────
//
// Andy, 2026-09-10, on a survey the clearance guard stopped eleven metres into line 1 of 17:
// *"the ASV is on hold and there is no way to release the hold and continue without
// resetting the entire survey."* The hold was correct. The PLAN was not, and not for the
// reason anyone would guess: its reversal was emitted with vertices 0.20 m apart, while both
// the vessel and the guard's projection advance to the next waypoint the moment they are
// within the APPROACH RADIUS (1.0 m on this hull). Nine vertices are consumed in one step,
// the boat is left steering at a point half way round the loop, and it flies a chord across
// the inside of its own turn.
//
// The drawn polyline was 3.75 m off the keep-out either way. Sampling it eighteen times
// finer moved the FLOWN track 2.6 m closer - from 4.01 m to 1.42 m, inside a 3 m buffer.
{
  const gap = 1.0;
  const straight = [];
  for (let i = 0; i <= 20; i++) straight.push(enLL(i * 0.2, 0));   // 0.2 m apart, like the spirals
  const thin = thinTrack(straight, gap, ref);
  const gaps = [];
  for (let i = 1; i < thin.length; i++)
    gaps.push(Math.hypot(toE(thin[i]) - toE(thin[i-1]), toN(thin[i]) - toN(thin[i-1])));
  check("44. thinTrack floors the spacing at the approach radius that consumes it",
        thin.length < straight.length && Math.min(...gaps) >= gap - 1e-6
        && distTo(thin[0], straight[0]) < 1e-6
        && distTo(thin[thin.length-1], straight[straight.length-1]) < 1e-6,
        straight.length + " waypoints 0.20 m apart -> " + thin.length + ", min gap "
        + Math.min(...gaps).toFixed(2) + " m. First and last are where the shape meets the "
        + "lines and are never dropped");

  // ⚠ THE LAST POINT IS NOT OPTIONAL, so when it crowds its neighbour the NEIGHBOUR goes.
  const crowd = [enLL(0, 0), enLL(5, 0), enLL(5.1, 0)];
  const ct = thinTrack(crowd, gap, ref);
  check("45. ... and a crowded END drops the point before it, never itself",
        ct.length === 2 && distTo(ct[1], crowd[2]) < 1e-6,
        "3 waypoints with the last 0.1 m behind the middle -> " + ct.length
        + ", ending at the " + (distTo(ct[1], crowd[2]) < 1e-6 ? "LAST" : "middle")
        + " one. Keeping the middle would leave the shape short of the line it joins");
}

// 46-47. THE REPORTED CASE, DRIVEN THROUGH THE GUARD'S OWN PROJECTION.
{
  const sav = { s: V.SPEED_KN, r: V.MAX_TURN_RATE_DEG_S, v: V.VESSEL };
  V.SPEED_KN = { low: 1.5, survey: 3.0, high: 6.0 };
  V.MAX_TURN_RATE_DEG_S = 60;
  V.VESSEL = { maneuvering: { approach_m: 1.0 } };
  const fly = { spdKey: "survey", approachM: 1.0 };

  // 46. WHAT SHIPS IS WHAT WAS VERIFIED. The eased shape emits its spirals at Ls/8 - 0.5 m
  // at Ls 4 - so it is the rung that exercises the thinning. Checking the dense shape and
  // shipping the thinned one would be verifying a different route from the one the boat is
  // given, which is this whole defect one layer down.
  const E1 = enLL(0, 0), F1 = enLL(0, 40);
  const eased = twr(E1, F1, 90, 270, ref, CLEAR, BUF, 8, 400, 4, 4, fly);
  const gapsOf = (r, A, B) => { const P = [A, ...(r.pts || []), B]; const g = [];
    for (let i = 1; i < P.length; i++) g.push(distTo(P[i-1], P[i])); return g; };
  const g46 = eased.pts ? gapsOf(eased, E1, F1) : [];
  check("46. what SHIPS is what was verified - thinned first, then checked",
        !!eased.pts && Math.min(...g46) >= trackGapM(fly) - 1e-6,
        (eased.pts ? eased.kind + ", " + eased.pts.length + " waypoints, tightest gap "
          + Math.min(...g46).toFixed(2) : "refused (" + eased.why + ")")
        + " m against a 1.0 m approach radius. The spirals are emitted at Ls/8 = 0.50 m and "
        + "the shape is thinned BEFORE legClear and the projection are asked about it");

  // 47. AND THE FLYABILITY VERDICT DOES NOT DEPEND ON HOW FINELY THE SAME CURVE WAS DRAWN.
  // One semicircle, sampled two ways, with a pile inside the loop. legClear passes both
  // polylines - they are the same curve - and so must the flown-track test.
  //
  // ⚠⚠ THIS CHECK USED TO ASSERT THE OPPOSITE, AND IT WAS PINNING A BUG AS A FEATURE.
  // It required the 0.2 m sampling to come back UNFLYABLE, and its own comment explained
  // why: the projection 'consumes a dozen [waypoints] per step ... and cuts across the
  // middle onto the pile'. It did the exact opposite. projectRoute advanced AT MOST ONE
  // waypoint per integration step while the position advanced twMs*step, so at 0.2 m
  // spacing the target fell further astern every step, turnToward swung the projection
  // round toward a point behind it, and the loop it flew was the bug's signature, not the
  // hull's. Corrected (guard.js consumes every waypoint a step passed), one curve gives
  // one answer whatever its spacing - which is the property worth pinning.
  //
  // ⚠ AND THE FIXTURE'S PREMISE WENT WITH IT: a hull that cannot hold an arc washes out
  // WIDE, not across the middle, so a pile INSIDE the loop is not what an unflyable turn
  // hits. Measured on this fixture at 3 kn (R=6 m needs 14.7 deg/s): at 10 deg/s the hull
  // cannot hold it and the pile inside is still missed, by both samplings.
  //
  // ⚠ RESIDUAL, NOT FIXED HERE AND NOT THIS CHECK'S CLAIM: with a pile OUTSIDE the arc at
  // low turn rates the two samplings can still disagree (measured 3 m off at 10 deg/s:
  // 0.2 m flyable, 1 m not). That is turnFlyable's own wash-out behaviour, not the
  // waypoint advance, and it is written up rather than quietly folded in here.
  const R = 6;
  const arcAt = (stepM) => { const out = [], n = Math.max(2, Math.ceil(Math.PI * R / stepM));
    for (let i = 1; i < n; i++) { const a = -Math.PI/2 + Math.PI * (i / n);
      out.push(enLL(R * Math.cos(a), R + R * Math.sin(a))); } return out; };
  const pile = { polys: [], lines: [],
                 points: [{ e: R * 0.35, n: R, r: 0, kind: "a pile" }],
                 marks: [], sys: [], chans: [] };
  const E2 = enLL(0, 0), F2 = enLL(0, 2 * R);
  const dense = arcAt(0.2);
  const thinned = thinTrack([E2, ...dense, F2], 1.0, ref).slice(1, -1);
  const okDense = turnFlyable(E2, F2, dense, 90, ref, pile, 3, fly);
  const okThin  = turnFlyable(E2, F2, thinned, 90, ref, pile, 3, fly);
  const chordsClear = (pts) => { const P = [E2, ...pts, F2];
    for (let i = 1; i < P.length; i++) if (!legClear(P[i-1], P[i], ref, pile, 3)) return false;
    return true; };
  check("47. ... and the flyability verdict is the SAME however finely that one curve was "
        + "drawn - sampling is not a fact about the water",
        okDense === okThin && chordsClear(dense) && chordsClear(thinned),
        "the SAME semicircle: " + dense.length + " waypoints 0.2 m apart -> flyable="
        + okDense + "; thinned to " + thinned.length + " at 1 m -> flyable=" + okThin
        + ". legClear passes both (" + chordsClear(dense) + "/" + chordsClear(thinned)
        + ") because they are one curve. Before the waypoint advance was fixed these read "
        + "false/true: the projection steered at a target that fell astern and flew a loop "
        + "the hull never would");
  V.SPEED_KN = sav.s; V.MAX_TURN_RATE_DEG_S = sav.r; V.VESSEL = sav.v;
}

// 47b. AND THE HORIZON IS THE SHAPE'S OWN LENGTH, NOT THE GUARD'S 45 SECONDS. The guard
// looks 45 s ahead because that is how far it can see; a plan-time question is about one
// manoeuvre end to end, and a 45 s cap stops checking a big turn half way round it. At
// 3 kn that cap is 69 m of arc, and a 30 m semicircle is 94 m.
{
  const sav = { s: V.SPEED_KN, r: V.MAX_TURN_RATE_DEG_S, v: V.VESSEL };
  V.SPEED_KN = { low: 1.5, survey: 3.0, high: 6.0 };
  V.MAX_TURN_RATE_DEG_S = 60;
  V.VESSEL = { maneuvering: { approach_m: 1.0 } };
  const R = 30, fly = { spdKey: "survey", approachM: 1.0 };
  const pts = [];
  for (let i = 1; i < 60; i++) { const a = -Math.PI/2 + Math.PI * (i / 60);
    pts.push(enLL(R * Math.cos(a), R + R * Math.sin(a))); }
  const E = enLL(0, 0), Fp = enLL(0, 2 * R);
  // a pile inside the FAR half of the loop - past 69 m of arc, where a 45 s cap stops looking
  const far = { polys: [], lines: [],
                points: [{ e: R * Math.cos(1.2), n: R * (1 + Math.sin(1.2)), r: 0, kind: "a pile" }],
                marks: [], sys: [], chans: [] };
  const near = { polys: [], lines: [],
                 points: [{ e: R * Math.SQRT1_2, n: R * (1 - Math.SQRT1_2), r: 0, kind: "a pile" }],
                 marks: [], sys: [], chans: [] };
  const arcLen = Math.PI * R;
  check("47b. the flyability horizon covers the whole shape, not the guard's 45 s",
        turnFlyable(E, Fp, pts, 90, ref, near, 3, fly) === false
        && turnFlyable(E, Fp, pts, 90, ref, far, 3, fly) === false,
        "a " + arcLen.toFixed(0) + " m arc at 3 kn takes " + (arcLen / 1.543).toFixed(0)
        + " s to fly, against a 45 s guard horizon. A pile in the NEAR half is caught either "
        + "way; one in the FAR half is caught only because the horizon is the shape's own "
        + "length - and an unchecked far half is the end of the turn, where it rejoins the "
        + "next line");
  V.SPEED_KN = sav.s; V.MAX_TURN_RATE_DEG_S = sav.r; V.VESSEL = sav.v;
}

// 48. THE CHECK IS ARMED UNLESS IT IS TURNED OFF BY NAME. An absent argument must not
// silently disable a safety test - the fault chart.js's `enforce` whitelist was rewritten
// to remove. `false` is the only opt-out, and it exists for the pure-geometry suites.
{
  const src = fs.readFileSync(path.join(STATIC, "js", "turns.js"), "utf8");
  check("48. an omitted `fly` still checks; only an explicit false opts out",
        /if\(fly === false\) return true;/.test(src)
        && /trackGapM\(fly\)/.test(src)
        && !/if\(!fly\) return true/.test(src)
        && trackGapM(undefined) > 0 && trackGapM(false) === 0,
        "trackGapM(undefined) = " + trackGapM(undefined) + " m (armed), trackGapM(false) = "
        + trackGapM(false) + " (off). A caller who forgets gets the check, not the bug");
}

// 49. AND AN EASED TURN THE SPACING CANNOT EXPRESS IS NOT OFFERED AT ALL. Four vertices per
// spiral is the floor; below it what ships is an arc wearing the word "eased".
{
  const src = fs.readFileSync(path.join(STATIC, "js", "turns.js"), "utf8");
  check("49. the eased rung is withheld when the waypoint spacing cannot ramp",
        /easeLs > 0 && \(easeGap <= 0 \|\| easeLs >= 4 \* easeGap\)/.test(src),
        "a 2.31 m settle length thinned to a 1.0 m approach radius keeps two vertices, "
        + "which is an arc - the plain rung below takes the turn instead, exactly as it "
        + "would have before easing existed");
}

// ── 50-55. DOES THE TURN JOIN THE TWO LINES? ────────────────────────────────────────
//
// THE FIRST CLAUSE OF THIS FILE'S OWN CONTRACT, AND UNTIL 2026-09-19 NOTHING ENFORCED IT.
// The header says a reversal "ENDS ON THE NEXT LINE, aligned with that line's heading (the
// whole reason a turn is generated at all instead of a straight hop)". Every check above
// tests a shape the constructors PRODUCE; none tested the shape the LADDER hands back, and
// the ladder had two rungs that hand back a shape joining neither line.
//
// `teardropTurn(..., 'inboard')` reverses the semicircle's SWEEP about a center that stays
// midway between the two lines. That keeps both endpoints and reverses both tangents, so
// the shape is the arc for the OPPOSITE transition: it enters on hF and leaves on hE. The
// boat is told to reverse at the line end, fly the arc backwards, and reverse again onto
// the next line. `legClear` passed it (every chord is lawful water) and `turnFlyable`
// passed it (a cusp in open water projects clean - measured, 120 of 120), so both existing
// gates said yes.
//
// MEASURED IN ANDY'S OWN PLANS, 2026-09-19, by re-deriving every shipped turn from the
// stored survey lines and matching each to the rung that produced it, to the millimetre:
// mission.json.bak5 4 of 17 reversals on this rung, bak1 1, bak4 1, and the Honolulu route
// of 2026-09-16 4 of 62. The in-extremis escape at 19:11:50 fired at route vertex 18 - the
// 4th arc vertex of one of them.
//
// ⚠⚠ AND THE FIRST DRAFT OF THESE CHECKS HAD NO TEETH AT ALL - read `check` above. They
// were written as `() => ...` thunks, which this file's helper did not evaluate, so all
// six printed "ok" while testing nothing. Three mutations SURVIVED, and that is the only
// reason it was found. The TEETH list below is what the mutation run RECORDED after the
// helper was fixed - not what the checks were expected to do.
//
// TEETH (recorded 2026-09-19; each mutation applied to static/js/turns.js, all four turn
// suites re-run, source restored and verified byte-identical after each. tg =
// turn_geometry, dt = direct_turn; nothing survived):
//   drop `turnJoinable(...)` from turnWithRetry's accept condition  -> tg 50,53; dt 10
//   clause 1 loosened:  `turnDeg >= 90` -> `> 179`                  -> tg 56
//   clause 1 tightened: `turnDeg >= 90` -> `>= 20`                  -> tg 51; dt CRASHES
//   clause 2 (the hull-rate test) neutered                          -> tg 55
//   joins judged at the RUNG's speed (`f`) not the ladder's (`fly`) -> tg 50 ONLY, and
//       that is a source assertion rather than a behavioural one. Honest note: with
//       clause 1 in place the `f`/`fly` distinction changes no OUTCOME in these fixtures,
//       because clause 1 is speed-independent and already refuses the mirrored shape. It
//       still matters for a join that faces the right way and is merely too tight, which
//       is why the argument is `fly` - but only check 50 is holding it.
//   turnJoinable returns true unconditionally             -> tg 52,53,55,56,57; dt 10,10c
//   an omitted `fly` opts out (`!fly` for `fly === false`)          -> tg 48,53; dt 10
//   the EXIT join dropped (only the departure checked)              -> tg 57
//   the ENTRY join dropped (only the arrival checked)               -> tg 55
{
  const sav = { s: V.SPEED_KN, r: V.MAX_TURN_RATE_DEG_S, v: V.VESSEL };
  V.SPEED_KN = { low: 1.5, survey: 3.0, high: 6.0 };
  V.MAX_TURN_RATE_DEG_S = 60;
  V.VESSEL = { maneuvering: { approach_m: 1.0 } };
  const minR = minTurnRadiusM("survey"), minRSlow = minTurnRadiusM("low");
  const SP = 31.5, MAXH = Math.max(60, SP * 1.6), BUF = 3;
  const clear = { polys: [], lines: [], points: [], marks: [], sys: [], chans: [] };
  const Ej = enLL(0, 0), Fj = enLL(SP, 0);          // line k ends at Ej heading 0; k+1 starts SP east, heading 180
  const flyJ = { spdKey: "survey", approachM: 1 };
  const join = (r, fly) => turnJoinable(Ej, Fj, thinTrack([Ej, ...r.pts, Fj], trackGapM(fly || flyJ), ref)
                                          .slice(1, -1), 0, 180, fly || flyJ);
  const src = fs.readFileSync(path.join(STATIC, "js", "turns.js"), "utf8");

  check("50. the ladder asks whether the shape JOINS the lines, before asking about the water",
        /turnJoinable\(E, F, pts, hE, hF, fly\) && turnFlyable\(/.test(src)
        && /if\(fly === false\) return true;/.test(src),
        "turnWithRetry's accept condition is `ok && turnJoinable(...) && turnFlyable(...)`, "
        + "and an omitted `fly` still checks - only an explicit false opts out");

  // 51. THE ACCEPTANCE, AND IT COMES FIRST. A gate that refused everything would pass 52-55.
  const good = [["eased", spt(Ej, Fj, 0, 180, ref, clear, BUF, minR, MAXH, 2.31)],
                ["arc outboard", teardropTurn(Ej, Fj, 0, 180, ref, clear, BUF, minR, MAXH)],
                ["racetrack", rtt(Ej, Fj, 0, 180, ref, clear, BUF, minR, MAXH)],
                ["racetrack slow", rtt(Ej, Fj, 0, 180, ref, clear, BUF, minRSlow, MAXH)]];
  const slowFly = { spdKey: "low", approachM: 1 };
  check("51. every shape that is tangent to both lines passes it — at the plan speed and slowed",
        () => good.every(([, r]) => r.pts && join(r) && join(r, slowFly)),
        good.map(([n, r]) => n + ":" + (r.pts ? (join(r) ? "join" : "REFUSED") : "no shape")).join("  ")
        + "  (and the same four at the low turn speed: "
        + good.map(([, r]) => r.pts && join(r, slowFly) ? "join" : "REFUSED").join(" ") + ")");

  // 52. THE REFUSAL, in water that refuses nothing — so it is the TANGENTS being judged.
  const inb = teardropTurn(Ej, Fj, 0, 180, ref, clear, BUF, minR, MAXH, "inboard");
  check("52. the mirrored semicircle is refused, though every chord of it is lawful water",
        () => inb.pts && inb.kind === "semicircle" && !join(inb),
        (inb.pts || []).length + " waypoints, all clear; it leaves E on "
        + azTo(Ej, inb.pts[0]).toFixed(0) + "° where the line runs 0°, and arrives on "
        + azTo(inb.pts[inb.pts.length - 1], Fj).toFixed(0) + "° where the next line runs 180°");

  // 53. ⚠ THE HOLE THE FIRST CUT OF THE GATE HAD, and direct_turn.js 10 is what found it.
  // Judged at the rung's own speed the SLOW inboard rung passed: the same 175° reversal
  // over the same 2.91 m is 93 °/s at 3 kn and 46 °/s at 1.5 kn. A join is where the turn
  // meets the SURVEY LINE and the hull arrives at it doing the speed it ran the line at,
  // so the ladder passes `fly`, not the per-rung `f`.
  const wall = { polys: [{ ring: [{ e: -40, n: 4 }, { e: 80, n: 4 }, { e: 80, n: 40 }, { e: -40, n: 40 }],
                           bb: bbOf([{ e: -40, n: 4 }, { e: 80, n: 4 }, { e: 80, n: 40 }, { e: -40, n: 40 }]),
                           kind: "a dock / pier" }],
                 lines: [], points: [], marks: [], sys: [], chans: [] };
  const walled = twr(Ej, Fj, 0, 180, ref, wall, BUF, minR, MAXH, minRSlow);
  check("53. a rung may not buy a join by slowing down — every outboard shape refused means REFUSED",
        () => !walled.pts,
        "outboard water cut to 4 m -> " + (walled.pts
          ? "SHIPPED " + walled.kind + "/" + walled.side + " on rung " + walled.rung
          : "refused (" + walled.why + ") after " + walled.rung + " rungs")
        + "; the same pair in clear water still turns: "
        + (() => { const t = twr(Ej, Fj, 0, 180, ref, clear, BUF, minR, MAXH, minRSlow);
                   return t.pts ? t.kind + "/" + t.side + " rung " + t.rung : "REFUSED"; })());

  // 54. CLAUSE 1 IS A SIGN CHANGE, NOT A TUNED NUMBER. 90° is the boundary between leaving
  // the line forwards and leaving it backwards, and the margin either side is enormous.
  const joinDeg = (r) => { const c = thinTrack([Ej, ...r.pts, Fj], trackGapM(flyJ), ref);
    const d = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
    return Math.max(d(azTo(c[0], c[1]), 0), d(180, azTo(c[c.length - 2], c[c.length - 1]))); };
  const goodDeg = good.map(([n, r]) => [n, joinDeg(r)]);
  const worstGood = Math.max(...goodDeg.map(([, v]) => v)), worstBad = joinDeg(inb);
  // ⚠ THE BOUND IS 60, NOT THE MEASURED WORST. The first draft asserted `< 45` against a
  // population whose worst is 44.6 - a check sitting ON its own boundary, which reds on any
  // harmless re-sampling. 60 leaves 15° of headroom above the worst joining shape and still
  // sits 30° below the 90° rule and 115° below the shape being excluded.
  check("54. ... and the two populations are nowhere near the boundary",
        () => worstGood < 60 && worstBad > 150,
        goodDeg.map(([n, v]) => n + " " + v.toFixed(1) + "°").join(", ")
        + "  vs mirrored semicircle " + worstBad.toFixed(1) + "° — boundary 90°. "
        + "The steepest joining shape is the racetrack at the SLOW radius, whose corner is "
        + "tight by construction; it is still less than half the rule");

  // ── 55-56. EACH CLAUSE ON ITS OWN, because they mask each other and a masked clause is
  // one nothing is holding. Both of these were rewritten after the mutation run: the first
  // draft of 55 put its tight corner where clause 1 ALSO refused it (the exit join came out
  // at 89.4°), so deleting the rate test entirely changed nothing and the mutation SURVIVED.
  //
  // 55. CLAUSE 2 ALONE. A corner that faces the right way but is tighter than the hull is
  // invisible to clause 1. Entry 45° - well inside the 90° rule - over half a meter.
  const tight = [enLL(0.354, 0.354), enLL(SP, 30)];     // 45° out of E in 0.5 m, then 0° into F over 30 m
  check("55. a join that faces the right way but is tighter than the hull is refused — clause 1 sees nothing here",
        () => !turnJoinable(Ej, Fj, tight, 0, 180, flyJ)
              && turnJoinable(Ej, Fj, [enLL(0, 30), enLL(SP, 30)], 0, 180, flyJ),
        "entry 45° (inside the 90° rule) over 0.50 m needs "
        + (45 / (0.5 / (3.0 * 0.514444))).toFixed(0) + " °/s of a 60 °/s hull -> refused; "
        + "exit 0° over 30 m is clean, so ONLY the rate test can be refusing it. The same "
        + "pair joined straight -> accepted");

  // 56. CLAUSE 1 ALONE. At the LOW turn speed the mirrored semicircle is inside the hull's
  // rate - 175° over 2.91 m is 46 °/s of 60 - so the rate test passes it and only the 90°
  // rule refuses it. This is the configuration an operator reaches by setting the TURN
  // speed to low, which the punch card itself offers as an advisory (tests/turn_refusal 12).
  // ⚠ THE NUMBERS BELOW ARE MEASURED OFF THE SHAPE, NOT QUOTED. The first draft of this
  // check asserted "175° over 2.91 m is 46 °/s" as literal text beside a condition that
  // never computed it - so when the mutation run loosened clause 1 and the check went on
  // passing, its detail line still read as though it had proved something. Derive both.
  const inbChain = [Ej, ...inb.pts, Fj];
  const dJ = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const inbDeg = dJ(azTo(inbChain[0], inbChain[1]), 0);
  const inbLeg = distTo(inbChain[0], inbChain[1]);
  const lowRate = inbDeg / (inbLeg / (V.SPEED_KN.low * 0.514444));
  check("56. ... and the mirrored semicircle is still refused at the LOW turn speed, where the rate test passes it",
        () => lowRate < V.MAX_TURN_RATE_DEG_S
              && !turnJoinable(Ej, Fj, inb.pts, 0, 180, slowFly),
        inbDeg.toFixed(1) + "° over " + inbLeg.toFixed(2) + " m is " + lowRate.toFixed(0)
        + " °/s at " + V.SPEED_KN.low + " kn — inside a " + V.MAX_TURN_RATE_DEG_S
        + " °/s hull, so clause 2 says yes here and clause 1 is the only thing refusing it. "
        + "Measured before clause 1 existed: all 150 mirrored semicircles in the sweep "
        + "passed at this speed");
  // 57. BOTH ENDS, SEPARATELY. A turn that leaves the line perfectly and arrives at the
  // next one backwards is just as unflyable as the reverse, and every shape in 51-56 is
  // wrong at BOTH ends at once - so a gate that only looked at the entry would pass all of
  // them and nothing would notice. It did not notice: dropping the exit join from
  // turnJoinable SURVIVED the first mutation run. These two fixtures differ only in the
  // last chord.
  const goodExit = [enLL(0, 30), enLL(SP, 30)];               // ...arrives on 180, the next line's heading
  const badExit  = [enLL(0, 30), enLL(SP, 30), enLL(SP, -30)]; // ...arrives on 000, straight back up the line
  check("57. the ARRIVAL on the next line is judged too, not just the departure from this one",
        () => turnJoinable(Ej, Fj, goodExit, 0, 180, flyJ)
              && !turnJoinable(Ej, Fj, badExit, 0, 180, flyJ),
        "identical entry (0° over 30 m) in both; last chord 180° -> accepted, 000° -> refused. "
        + "Everything 51-56 is wrong at both ends at once, so only this tells the two joins apart");
  V.SPEED_KN = sav.s; V.MAX_TURN_RATE_DEG_S = sav.r; V.VESSEL = sav.v;
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
