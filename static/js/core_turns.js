/* ========================================================================
 * ⚠⚠ ASV OWNS THIS FILE NOW (2026-08-31). DO NOT RE-VENDOR IT.
 *
 * Andy: "stop updating other projects. We concentrate only on ASV Console
 * moving forward. There may be components of other projects that we pull over."
 *
 * So the flow is ONE WAY from here: asv_core is a place to pull FROM, never a
 * place this repo writes back to. The vendor header below is kept for
 * PROVENANCE -- it records where this body came from -- but its instruction is
 * now wrong for this repo, and dangerously so:
 *
 *   ⚠ RUNNING `python tools/vendor.py` IN THE asv_core REPO WOULD OVERWRITE
 *     THIS FILE AND SILENTLY DELETE TWO SAFETY FIXES. This copy carries:
 *
 *     1. the `side` option on teardropTurn's semicircle branch, which is
 *        what lets a refused turn go AWAY from a dock instead of being
 *        abandoned (2026-08-31);
 *     2. THE SEMICIRCLE BUILT FROM THE TWO POSES rather than from the E-F
 *        chord (2026-09-08), with the run-out epsilon, the lateral branch
 *        gate, and `outboard` MEASURED off the points in both this shape and
 *        racetrackTurn instead of asserted. Upstream still centers the arc on
 *        the midpoint of E-F and takes its radius from half that chord, which
 *        is correct only while the two line ends are ABEAM. Give the pair any
 *        along-track offset -- which lead-in / lead-out extensions produce at
 *        every reversal, and which the chart clip produces on its own -- and
 *        the tangents are wrong by atan(along / lateral) at BOTH ends.
 *        MEASURED at 40 m spacing: a 40 m lead-in against a 25 m lead-out
 *        threw the boat off the line at 19 degrees and put it onto the next at
 *        22; a 40 m lead-in with no lead-out, 44 and 46.
 *
 *     asv_core has neither. If a `--check` there reports this copy as
 *     DRIFTED, that is correct and expected: it has drifted, on purpose.
 *
 * Both are covered by suites in this repo's own pre-commit hook --
 * tests/clearance_guard.js for the first, tests/turn_geometry.js 31-36 for the
 * second. If either is ever wanted upstream, carry it there as its own
 * deliberate piece of work -- never by syncing in this direction.
 * ======================================================================== */
/* ========================================================================
 * VENDORED FROM asv_core -- DO NOT EDIT THIS COPY.
 *
 *   source : asv_core_js/turns.js
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
 * THIS CONSOLE IS WHERE THE SHAPES CAME FROM -- WorldView's mission.js says
 * so in its own header -- and they came back MEASURED. static/js/turns.js
 * against this file, handed this console's flat frame, its flat metric,
 * arcStepM 3 and maxHalfM 60, 2026-08-20:
 *
 *     teardropTurn   0.000e+0 m over 3,240 cases, R and outboard exact, 0
 *                    shape or point-count mismatches, with all five outcomes
 *                    exercised: 954 semicircle, 201 teardrop, 1,080
 *                    degenerate, 441 skew, 564 nogo
 *     arcPts         0.000e+0 m over 4,000, point counts identical
 *     shortenSeg     0.000e+0 m over 6,000
 *     minTurnRadiusM 7.105e-15 m -- one ULP, from (rate*PI)/180 here against
 *                    rate*(PI/180) there. Stated rather than rounded to 0.
 *
 * ADOPTION HERE IS BY WRAPPER FOR ALL FOUR, AND THAT IS THE POINT OF THE
 * SEAM. minTurnRadiusM reads V.SPEED_KN and V.MAX_TURN_RATE_DEG_S where the
 * core takes numbers; teardropTurn takes (ref, ko, buf) where the core takes
 * a frame and an injected `clear`; arcPts and shortenSeg pin this console's
 * arc step and its FLAT metric. Same trade as chart.js: every call site in
 * asv.html and the suites keeps its own signature, at the price of one
 * closure per call.
 *
 * THE METRIC IS PASSED, NOT TAKEN FROM THE FRAME, AND THAT IS LOAD-BEARING.
 * planeFrame.distTo is trueDistTo since Andy's "standardize" ruling, while
 * this console's line shortening has always used the module-level FLAT
 * distTo, in the same flat plane the line is drawn in. A core that read
 * frame.distTo would move every survey line end by up to 1.113 m -- measured
 * -- and put the drawn length 0.131 per cent from the trimmed one.
 *
 * ONE ANSWER CHANGED ON PURPOSE, AND IT IS A DEFECT THE MERGE FOUND.
 * teardropTurn's reversal-pair guard was a bare 60 m here -- a hull-scale
 * assumption. A 7.7 m USV at 122 m line spacing (ordinary deep-water multibeam
 * spacing) got NO TURN AT ALL, and the console told the operator the loop
 * "would enter a keep-out ... it needs 61.0 m of radius there and has
 * 14.4 m" -- both false, and the advisory alongside it said WIDEN THE LINES,
 * which makes it strictly worse. punchOut now passes
 * Math.max(60, spacing * 1.6), the same 1.6 its own reversal gate uses, so
 * the judgment is made once instead of twice at two different scales. Below
 * 120 m of spacing nothing moves.
 *
 * TWO HARDENINGS CAME WITH THE BODIES AND NEITHER IS REACHABLE FROM THE UI.
 * minTurnRadiusM returns 0 rather than Infinity on a zero turn rate (this
 * console's version drove teardropTurn to NaN waypoints), and shortenSeg
 * refuses a zero, negative or NaN margin rather than EXTENDING the line past
 * both ends. applyVesselToUI guards the first on truthiness and punchOut's
 * margin is Math.max(2, ...), so both are unreachable -- checked, not assumed,
 * and pinned in tests/turns.py rather than left as prose.
 *
 * Edit the core file and re-run the sync. Everything below is verbatim.
 */

/**
 * asv_core · turns — THE SHAPE OF A REVERSAL, and the radius the hull can hold.
 *
 * Line-to-line turn geometry: the semicircle and the teardrop, the arc sampler under
 * both, the radius floor they are built at, and the end-shortening that leaves room for
 * them. No DOM, no fetch, no mission state, and — unusually for this repo — no imports
 * at all: a geometry question in, a waypoint list out.
 *
 * ── WHY THIS FILE EXISTS (2026-08-20) ──────────────────────────────────────────────
 *
 * The estate's LAST file-level duplicate of consequence. ASV's `static/js/turns.js` and
 * WorldView's `globe/mission.js` carried the same four bodies; WorldView's header says it
 * was ported from ASV's page, and for three sessions the handoff recorded that nothing
 * could be compared until ASV's came out of `asv.html`. It came out on 2026-08-20, and
 * this is the merge.
 *
 * ⚠ IT IS A MERGE, NOT A MOVE, AND THE MEASUREMENT SAYS WHERE. Both files handed ASV's
 * flat frame, 2026-08-20, before anything was written here:
 *
 *     teardropTurn   0.000e+0 m over 3,240 cases, R and outboard exact, 0 shape or
 *                    point-count mismatches — with all five outcomes exercised
 *                    (954 semicircle, 201 teardrop, 1,080 degenerate, 441 skew,
 *                    564 nogo) and the arc step pinned to ASV's 3 m
 *     arcPts         0.000e+0 m over 3,000, point counts identical, same pin
 *     shortenSeg     0.000e+0 m over 6,000 once the METRIC is shared
 *     the constants  SKEW_LIMIT_DEG 15, TRACKING_MARGIN 1.4, ANTI_PARALLEL_DEG 50,
 *                    both sides
 *
 * So the shapes were never in question. THREE THINGS WERE, and each is a parameter here
 * rather than a literal, because each one is a genuine difference between the consoles
 * rather than an accident:
 *
 *   • THE METRIC IS AN ARGUMENT TO `shortenSeg`, AND DELIBERATELY NOT READ OFF THE
 *     FRAME. Every other function here takes the frame and the frame carries `distTo` —
 *     that is the design `routing.js` documents at length. `shortenSeg` must NOT use it.
 *     ASV's `planeFrame.distTo` is `trueDistTo` (the geodesic) since Andy's "standardize"
 *     ruling, while ASV's line shortening has always used the module-level FLAT `distTo`,
 *     in the same flat plane the line is drawn in. Reading the metric off the frame would
 *     move every ASV survey line end by up to 1.113 m — measured — and would put the
 *     drawn length and the trimmed length 0.131 % apart. Passing it explicitly keeps the
 *     choice at the call site, where it is visible.
 *
 *   • THE ARC STEP SCALES WITH THE RADIUS (`arcStepFor`), and `stepM` overrides it.
 *     ASV's flat 3 m is sized for a 4 m USV turning in 2 m; at a survey ship's 250 m
 *     radius it emits 260 waypoints per turn to hold a 4 mm sagitta. Scaling keeps
 *     ASV's 3 m at ASV's radii — the two are identical below R = 60 m — and stays sane
 *     at survey scale. ASV pins `stepM: 3` so its answers did not move on the merge;
 *     that is its decision to revisit, not this file's.
 *
 *   • `maxHalfM` — the "these two line ends are not a reversal pair" guard — IS AN
 *     OPTION, and its default of 60 is kept only for callers that do not pass one.
 *     ⚠ THAT LITERAL WAS A DEFECT IN ASV AND THE MERGE IS WHAT FOUND IT. 60 m is a
 *     hull-scale assumption: a 7.7 m USV at 122 m line spacing — ordinary deep-water
 *     multibeam spacing — got NO TURN AT ALL, and the console told the operator the loop
 *     "would enter a keep-out … it needs 61.0 m of radius there and has 14.4 m". Both
 *     halves false: nothing was blocked, and a 61 m semicircle is well inside what a
 *     boat with a 14.4 m minimum can hold. The advisory alongside it said WIDEN THE
 *     LINES, which makes it strictly worse. Both consoles now derive the cap from the
 *     spacing — `Math.max(60, spacing * 1.6)`, the same 1.6 the callers' own "is this a
 *     reversal pair" gate uses — so the judgment is made once instead of twice at two
 *     different scales.
 *
 * WHAT IS *NOT* HERE. `regionOrder`, `junctionKnot`, `pruneJunctionKnots`, `KNOT_TURN_DEG`
 * and `KNOT_STEP_M` are the MISSION layer, one level up, and `pruneJunctionKnots`
 * genuinely differs between the consoles (WorldView injects a `clear` predicate where ASV
 * passes a keep-out model). That is a design decision to settle, not a body to move.
 * `punchOut` is further out still and is not one function in two repos at all: WorldView's
 * is a pure assembler with injected seams, ASV's takes no arguments and is the button
 * handler. A shared name that is not a shared quantity, at the architecture level.
 */

const D2R = Math.PI / 180;
const KTS = 0.514444;                 // knots → m/s

/** Tracking margin on the physical turn radius. See `minTurnRadiusM`. */
export const TRACKING_MARGIN = 1.4;

/** How far off anti-parallel a pair may be and still count as a reversal. */
export const ANTI_PARALLEL_DEG = 50;

/** The teardrop's closed form assumes a true reversal; decline beyond this. */
export const SKEW_LIMIT_DEG = 15;

/** The reversal-pair guard's fallback, for a caller that passes no `maxHalfM`. */
export const MAX_HALF_M = 60;

// ⚠ HOW MUCH ALONG-TRACK OFFSET IS WORTH A WAYPOINT (2026-09-08). All three shapes below
// absorb an offset between the two line ends with a straight run ON the line, guarded by
// `along > 0`. On a pair that is genuinely abeam `along` is not 0, it is ~1e-14 — so the
// guard fires and pushes a waypoint sitting on top of the line end. The plan then carries
// a duplicate the boat "arrives" at instantly, and any bearing taken across it is noise:
// it read as a 90° kink out of a turn that was in fact perfect. Below a fingernail's width
// there is no run-out, there is rounding.
const ALONG_EPS_M = 0.05;

// The shortest spiral worth building. Below it the eased reversal IS the plain semicircle
// to within a waypoint, and `spiralTurn` says so rather than returning a shape the caller
// cannot tell apart from the one it already has.
export const SPIRAL_MIN_LS_M = 0.5;

/**
 * The minimum turn radius the vessel can actually HOLD at a given speed.
 *
 * A turn tighter than this cannot be tracked: the vessel overshoots OUTBOARD — into
 * whatever the arc was hugging — even though the idealised arc validates clear. This is
 * the FLOOR every generated turn is built at; it is never the reason a turn is skipped
 * (see `teardropTurn`).
 *
 * The 1.4 is line-following margin on the physical `v/ω`.
 *
 * ⚠ ZERO IS AN ANSWER, NOT A CRASH, and that is the behavior ASV did not have. With no
 * speed or no turn rate this returns 0 and the caller's `Math.max(0.75, minR)` floor
 * takes over. ASV's own version divided by ω unguarded, so a vessel file with
 * `max_turn_rate_deg_s: 0` returned Infinity and drove `teardropTurn` to NaN waypoints;
 * its speed lookup ALSO fell back to 3 kn on a zero, silently planning a different boat's
 * turns. Neither is reachable through `applyVesselToUI` — it guards both on truthiness —
 * which is why this is a hardening rather than a fix, and why it is written down.
 */
export function minTurnRadiusM(speedKts, maxTurnRateDegS = 20, margin = TRACKING_MARGIN) {
  const v = (speedKts || 0) * KTS;
  const w = (maxTurnRateDegS || 0) * D2R;
  if (!(v > 0) || !(w > 0)) return 0;
  return (v / w) * margin;
}

/**
 * Arc point spacing for a radius, in meters.
 *
 * Held as a fraction of the radius rather than a constant, so the chord sagitta
 * (≈ step²/8R) stays proportionate: 3 m at a 2 m radius, 12.5 m at a 250 m one. The
 * floor is 3 m, which is what a small USV's follower needs to round the arc smoothly,
 * and it is what this returns for every R below 60 m.
 */
export const arcStepFor = (R) => Math.max(3, R / 20);

/**
 * Shorten a survey segment by `m` meters at BOTH ends: settle on-line, and leave room
 * for the turn to loop in. Left untouched if that would make it too short to be worth
 * running.
 *
 * `dist(a, b)` is the metric — SEE THE HEADER. It is an argument and not `frame.distTo`
 * because the two consoles legitimately measure a survey line differently, and because
 * ASV's frame carries a different metric from the plane its lines are drawn in.
 *
 * ⚠ THE INTERPOLATION IS RAW lon/lat, AND SAYING SO IS THE POINT. WorldView's body ran
 * this through `tangentFrame(a).toEN` and back, with a comment claiming the raw lerp "is
 * not the line at any latitude that matters". IT IS THE SAME ANSWER: `toEN` then `fromEN`
 * is affine, so the scale divides straight back out. Measured over 8,000 cases against
 * ASV's raw lerp — 1.233e-9 m through WorldView's ellipsoidal frame, 1.233e-9 m through
 * ASV's flat one, i.e. floating-point round-trip noise and nothing else. (A frame
 * anchored 40 km away lands 6.4e+4 m out, so the check can see a frame that matters.)
 * The frame was doing no work and is gone; the comment that said otherwise would have
 * stopped someone from ever looking.
 *
 * `!(m > 0)` refuses a zero, a negative and a NaN alike. ASV had no such guard: a
 * negative margin EXTENDED the line past both ends, and a NaN produced NaN waypoints.
 * Neither is reachable through `punchOut` (its margin is `Math.max(2, …)`), so this too
 * is hardening rather than a fix — but a refusal that returns the caller's own points is
 * the only sane answer to a nonsense margin.
 */
export function shortenSeg(a, b, m, dist) {
  const d = dist(a, b);
  if (!(m > 0) || d < 2 * m + 2) return [a, b];
  const t0 = m / d, t1 = 1 - m / d;
  return [{ lat: a.lat + (b.lat - a.lat) * t0, lon: a.lon + (b.lon - a.lon) * t0 },
          { lat: a.lat + (b.lat - a.lat) * t1, lon: a.lon + (b.lon - a.lon) * t1 }];
}

/**
 * Interior points of a circular arc: center `C`, radius `R`, from angle `a0` sweeping
 * `sweep` radians (signed, + = CCW). EXCLUDES both endpoints.
 *
 * Chords cut INBOARD — away from the arc's own center — and every chord is validated by
 * the caller's `clear`, so a sparse arc stays clear of anything the arc curves around.
 * `map(x, y)` takes frame coordinates to a lat/lon point.
 *
 * `stepM` overrides `arcStepFor(R)`. ASV passes 3 to hold the answers it had before the
 * merge; below R = 60 m the two are the same number anyway.
 */
export function arcPts(C, R, a0, sweep, minSeg, map, stepM) {
  const step = stepM || arcStepFor(R);
  const n = Math.max(minSeg || 2, Math.ceil(Math.abs(sweep) * R / step));
  const out = [];
  for (let i = 1; i < n; i++) {
    const a = a0 + sweep * (i / n);
    out.push(map(C.x + R * Math.cos(a), C.y + R * Math.sin(a)));
  }
  return out;
}

/**
 * Line-to-line reversal turn.
 *
 * TWO SHAPES, ONE CONTRACT: both roll the vessel onto the next line ALIGNED with its
 * heading, both are built at a radius the vessel can actually HOLD at the plan speed, and
 * both are validated against `clear` before they are returned.
 *
 *   SEMICIRCLE — line offset ≥ 2·minR. One 180° arc, radius = HALF THE LINE OFFSET,
 *     bulging outboard. The classic boustrophedon turn: shortest, and it never reaches
 *     more than R beyond the line ends.
 *
 *   TEARDROP — line offset < 2·minR. The semicircle would be tighter than the vessel can
 *     hold, so loop at its OWN minimum radius instead: a short arc AWAY from the next
 *     line, a >180° loop back over the top, and a short arc onto the line — three tangent
 *     circles of radius minR. DECOUPLING THE TURN RADIUS FROM THE LINE OFFSET is the
 *     entire point. An 8 m USV at 7 kn needs ~14 m of radius, which a 15 m line spacing
 *     can never supply as a semicircle; without this such a vessel gets no turn at all
 *     and falls back to a "straight" hop between anti-parallel line ends — which is a
 *     180° reversal at half the spacing, i.e. exactly the radius just rejected as
 *     unflyable. The teardrop costs outboard water (up to ~2.75·minR past the line ends,
 *     vs R for the semicircle), which is why it is the fallback and not the default, and
 *     why the caller reports the excursion to the operator.
 *
 * Teardrop geometry, in a frame with the turn entry at the origin, +y = the exit heading
 * and +x = towards the next line, offset d = |lateral|, R = minR:
 *
 *     C1 = (-R, 0)        left  circle at the entry (turn AWAY from the next line)
 *     C3 = (d + R, 0)     left  circle at the exit
 *     C2 = (d/2, +q)      right circle over the top, q = √(4R² − ((d+2R)/2)²)
 *
 * C2 is tangent to both outer circles (|C1−C2| = |C2−C3| = 2R), solvable exactly when
 * d ≤ 2R — precisely the case the semicircle cannot serve. Tangent points are the
 * circle-center midpoints, because the radii are equal. Net heading change is −180° by
 * construction, and at d = 2R it degenerates (q = 0, outer arcs vanish) into the plain
 * semicircle, so the two shapes agree on their shared boundary.
 *
 * Any ALONG-TRACK offset between E and F (lines of unequal length) is absorbed by a
 * straight run collinear with a survey line — before the loop if F is ahead of E, after
 * it if F is behind — so the arcs always see a clean abeam pair and the extra geometry is
 * the safest shape available.
 *
 * @param {{lat:number,lon:number}} E exit of the line just run
 * @param {{lat:number,lon:number}} F entry of the next line
 * @param {number} hE heading of the line just run, degrees true
 * @param {number} hF heading of the next line, degrees true
 * @param {{toEN:Function, fromEN:Function}} frame local plane; anchor it AT the turn
 * @param {object} [opts] { minR, clear, arcStepM, maxHalfM, side }
 *   `side: 'inboard'` sweeps a SEMICIRCLE the other way round the chord — see the note
 *   at the semicircle branch. It has no effect on a teardrop, whose loop side is fixed
 *   by which side the next line is on; the teardrop's lever is `minR` instead.
 * @returns {{pts:Array, kind:string, R:number, outboard:number, side:string}
 *          | {why:'degenerate'|'skew'|'nogo', seg?:Array}}
 *   `pts` EXCLUDES E and F. `outboard` is how far past the line end the turn reaches —
 *   the water the operator has to have clear. On a `nogo` refusal `seg` is the failing
 *   chord, so the caller can ask WHAT blocked it and name it: a "keep-out" the operator
 *   is staring at can be open-looking water, such as a navigation channel. `side` is
 *   which way the turn actually went, so a caller that had to fall back to the inboard
 *   sweep can SAY so rather than shipping a turn that is not where the operator expects.
 */
/**
 * A RACETRACK REVERSAL: two quarter-circles at the vessel's own radius, joined by a
 * straight run across the gap. Arc - straight - arc, tangent-continuous throughout.
 *
 * Andy, 2026-09-01, looking at a punched plan beside the Erie shoreline: *"the turns are
 * implemented as inverted teardrop turns. Consider a more direct, curvilinear format for
 * this implementation."*
 *
 * ⚠ WHAT HE WAS LOOKING AT WAS AN INBOARD SEMICIRCLE, AND THE NUMBER THAT EXPLAINS IT IS
 * THE RADIUS. `teardropTurn` sweeps a semicircle of radius HALF THE LINE OFFSET whenever
 * the hull can hold it. On the small-class boat at survey speed the hull can hold 2.06 m; at 31.5 m
 * line spacing it was being flown round a 15.75 m half-circle - seven times wider than
 * anything the boat needed. That arc has to bulge SOMEWHERE, it needs 15.75 m of clear
 * water past the end of the line to bulge outboard, and when a wharf takes that water
 * away the only rung left was the same arc swept the other way: back across the water
 * just surveyed, 33 m of it, which is what reads on the chart as an inverted teardrop.
 *
 * The racetrack asks for the radius the hull actually has. Measured on that plan:
 *
 *     spacing   semicircle          racetrack           saving
 *     31.5 m    49.5 m, 15.8 m out  33.9 m, 2.1 m out   32% shorter, 13.7 m less water
 *     60 m      94.2 m, 30.0 m out  62.4 m, 2.1 m out   34% shorter, 27.9 m less water
 *
 * The outboard reach is the half that matters here: it does not grow with the spacing at
 * all, so a turn that had to invert for want of 15 m of water now needs 2 m and stays
 * outboard, away from the feature - which is what "turn away from the threat" was always
 * trying to buy. It is the shape a boat with a tight helm actually flies; the semicircle
 * is the shape a boat flies when its turning circle IS the line spacing.
 *
 * NOT a replacement for the semicircle, and deliberately not the first rung of the
 * ladder. A lazy half-circle is gentler on a towed body and on the survey itself, and
 * nobody has complained about the turns that are not up against something. This is what
 * to fly when the gentle one is refused - see `turnWithRetry`.
 *
 * Geometry, in the same local frame the teardrop builds (origin at the abeam point, +y
 * along the exit heading, +x toward the next line, `d` = the lateral offset):
 *
 *     start (0,0) heading +y
 *       arc 1: center (R,0), pi->pi/2      ends (R, R) heading +x
 *       straight                            to  (d-R, R)
 *       arc 2: center (d-R,0), pi/2->0      ends (d, 0) heading -y
 *
 * Needs `d >= 2R` for the straight to exist; below that the loop has to overshoot and
 * `teardropTurn`'s three-arc form is the right answer, so this refuses and says so.
 */
export function racetrackTurn(E, F, hE, hF, frame, opts = {}) {
  const clear = opts.clear || (() => true);
  const maxHalf = opts.maxHalfM ?? MAX_HALF_M;
  const Ee = frame.toEN(E), Fe = frame.toEN(F);
  const half = Math.hypot(Ee.e - Fe.e, Ee.n - Fe.n) / 2;
  if (half > maxHalf || half < 0.25) return { why: 'degenerate' };
  // A reversal, not a dogleg - the same gate the teardrop applies, and for the same
  // reason: the construction below assumes the exit and entry headings are opposed, and
  // a skew pair rolled out on this shape would miss the next line.
  if (Math.abs(((hF - hE + 360) % 360) - 180) > SKEW_LIMIT_DEG) return { why: 'skew' };

  const R = Math.max(0.75, opts.minR || 0);
  const fwd = { e: Math.sin(hE * D2R), n: Math.cos(hE * D2R) };
  const rgt = { e: fwd.n, n: -fwd.e };
  const en2ll = (e, n) => frame.fromEN(e, n);

  const Dv = { e: Fe.e - Ee.e, n: Fe.n - Ee.n };
  const along = Dv.e * fwd.e + Dv.n * fwd.n;
  const lateral = Dv.e * rgt.e + Dv.n * rgt.n;
  const s = lateral >= 0 ? 1 : -1, d = Math.abs(lateral);
  if (d < 2 * R) return { why: 'tight' };            // no straight fits; that is a teardrop

  // Absorb the along-track offset on the line itself, exactly as the teardrop does: run
  // out to the abeam point, or roll out early and run straight in to F.
  const P = { e: Ee.e + (along > 0 ? along * fwd.e : 0), n: Ee.n + (along > 0 ? along * fwd.n : 0) };
  const Q = { e: Fe.e - (along < 0 ? along * fwd.e : 0), n: Fe.n - (along < 0 ? along * fwd.n : 0) };
  const map = (x, y) => en2ll(P.e + x * s * rgt.e + y * fwd.e, P.n + x * s * rgt.n + y * fwd.n);

  const C1 = { x: R, y: 0 }, C2 = { x: d - R, y: 0 };
  // ⚠ THE STEP HAS TO SCALE WITH THE RADIUS, and this arc is the reason the general rule
  // was not enough. `arcStepFor` floors at 3 m, and ASV passes a flat 3 m, which is ample
  // on a 15.75 m semicircle (49.5 m of arc, 16 chords) and useless here: a 90-degree arc
  // at R = 2.06 m is 3.2 m long, so a 3 m step resolves it with ONE chord. Measured
  // before this line existed - the shape was right but the vessel rolled out on 168.8
  // degrees instead of 180, an 11-degree error walked straight into the next survey line.
  // A chord subtending ~11 degrees keeps the secant error under R/50 at any radius.
  const step = Math.min(opts.arcStepM ?? arcStepFor(R), Math.max(0.2, R * 0.2));
  const pts = [];
  if (along > ALONG_EPS_M) pts.push(en2ll(P.e, P.n));
  pts.push(...arcPts(C1, R, Math.PI, -Math.PI / 2, 2, map, step), map(C1.x, R));
  pts.push(map(C2.x, R));                                   // the straight across the gap
  pts.push(...arcPts(C2, R, Math.PI / 2, -Math.PI / 2, 2, map, step));
  if (along < -ALONG_EPS_M) pts.push(en2ll(Q.e, Q.n));

  let prev = E;
  for (const p of [...pts, F]) {
    if (!clear(prev, p)) return { why: 'nogo', seg: [prev, p] };
    prev = p;
  }
  // ⚠ MEASURED, NOT ASSERTED (2026-09-08). The reach past the end of the line is the arc
  // radius "and nothing more" only while the two ends are ABEAM. This shape has always
  // absorbed an along-track offset with the run-out above, and when it does the arcs start
  // `along` meters further down the line and reach `along + R` — so the constant under-
  // reported by exactly the offset. Nothing produced offsets routinely until lead-in /
  // lead-out extensions did, which is why it stood. It is the figure the operator decides
  // "is that water clear?" against, so it is counted off the points like every other shape.
  let outboard = 0;
  for (const p of pts) {
    const pe = frame.toEN(p);
    outboard = Math.max(outboard, (pe.e - Ee.e) * fwd.e + (pe.n - Ee.n) * fwd.n);
  }
  return { pts, kind: 'racetrack', R, outboard, side: 'outboard' };
}

/**
 * THE EASED REVERSAL: clothoid - arc - clothoid, so the CURVATURE is continuous.
 *
 * Every other shape in this file steps its curvature from 0 to 1/R the instant the vessel
 * leaves the line: an infinite rate of change, which is a rudder movement no hull can make.
 * The boat answers it by overshooting and settling, and settling is exactly what the
 * lead-in exists to hide. This shape ramps instead - curvature rises linearly from 0 to
 * 1/R over a spiral of length `Ls`, holds through a circular core, and ramps back to 0 -
 * so the rudder rate is constant and finite, and the vessel rolls out onto the next line
 * with the helm already amidships.
 *
 * ── THE GEOMETRY ───────────────────────────────────────────────────────────────────
 * One spiral turns tau = Ls / 2R, so the core is left with theta = pi - 2 tau, and the
 * three phases sum to pi exactly, by construction, for any Ls and R.
 *
 * The shape is symmetric about its own half-way point, so - like the plain semicircle - it
 * ends ABEAM of where it started (VERIFIED: the integrated along-track displacement comes
 * out at 1e-13 m, and the heading at 180.000000 deg). That is what lets the along-track
 * offset be absorbed with an on-line straight here exactly as in the other two shapes.
 *
 * R is SOLVED against the integrated crossing; the closed form below only seeds it. A
 * transition curve shifts its circular core outward by p ~= Ls^2 / 24R, so a 180-degree
 * reversal spans d = 2(R + p) across:
 *
 *     R^2 - (d/2) R + Ls^2/24 = 0   ->   R = [ d/2 + sqrt(d^2/4 - Ls^2/6) ] / 2
 *
 * `p` is the first term of a series, so that lands 0.2 mm out at Ls 8 and 23.7 mm at
 * Ls 25 (MEASURED, d = 40) - which is why three Newton steps follow it, on the integrated
 * crossing, with the analytic derivative d(crossing)/dR = 2.
 *
 * ⚠ AND THE SOLVE IS WHAT DECIDES R, NOT THE SEED - established by mutation, not by
 * reading. Deleting the spiral term from the discriminant, and even dropping the halving
 * so the seed comes out at twice the right radius, both still converge to the same answer
 * in three steps: the seed is a convenience that saves iterations, and only the
 * FEASIBILITY test genuinely depends on the closed form. So do not "simplify" by trusting
 * the seed - at a long spiral it is tens of millimetres out, and nothing downstream would
 * say so.
 *
 * The discriminant is that feasibility test: no radius spans a crossing narrower than
 * Ls * sqrt(6) / 2, and there the caller falls back to the shapes that do.
 *
 * ⚠⚠ AND THE EMIT STEP IS PART OF THE SHAPE, NOT A DETAIL. A polyline cannot express
 * curvature continuity; the boat gets WAYPOINTS, and at the console's ordinary 3 m arc
 * step the sampling swamps the thing this shape exists for. MEASURED on a 40 m crossing
 * with Ls 8 m, worst curvature change between consecutive waypoints:
 *
 *     3 m step   eased 0.0188 /m   plain 0.0286 /m    1.5x   <- a label, not a feature
 *     1 m step   eased 0.0065 /m   plain 0.0400 /m    6.2x
 *     0.5 m      eased 0.0034 /m   plain 0.0445 /m   13.2x
 *
 * Note which way each column moves: refining the sampling drives the PLAIN arc's figure UP
 * toward its true discontinuity (1/R = 0.05) and the eased one DOWN toward its true bounded
 * derivative 1/(R Ls). That divergence is the proof the two shapes differ at all, and it
 * only appears once the step is fine enough to resolve the ramp. So this shape is emitted
 * at `Ls / 8` - eight chords per spiral - and pays for it in waypoints (69 rather than 22
 * on that geometry). The caller reports the count; it is not hidden.
 *
 * ⚠ WHAT IS NOT KNOWN: how the vessel's own controller interpolates BETWEEN waypoints. If
 * it flies chord to chord the polyline is the path and the step above is what matters; if
 * it smooths, the easing survives a coarser one. Nobody has measured it on this hull, so
 * the step is chosen for the pessimistic case and this comment says which.
 *
 * Same call shape as racetrackTurn. Returns {pts, kind:'eased', R, Ls, tau, outboard} with
 * `pts` EXCLUDING E and F, or {why, seg?}.
 */
export function spiralTurn(E, F, hE, hF, frame, opts = {}) {
  const clear = opts.clear || (() => true);
  const maxHalf = opts.maxHalfM ?? MAX_HALF_M;
  const Ee = frame.toEN(E), Fe = frame.toEN(F);
  const half = Math.hypot(Ee.e - Fe.e, Ee.n - Fe.n) / 2;
  if (half > maxHalf || half < 0.25) return { why: 'degenerate' };
  // A reversal, not a dogleg - the same gate the other two shapes apply, for the same
  // reason: the construction assumes the exit and entry headings are opposed.
  if (Math.abs(((hF - hE + 360) % 360) - 180) > SKEW_LIMIT_DEG) return { why: 'skew' };

  const Ls = opts.Ls || 0;
  // Below a spiral worth building this IS the plain semicircle, and the caller already has
  // one. Saying so is better than returning a shape indistinguishable from it.
  if (Ls < SPIRAL_MIN_LS_M) return { why: 'no-spiral' };

  const fwd = { e: Math.sin(hE * D2R), n: Math.cos(hE * D2R) };
  const rgt = { e: fwd.n, n: -fwd.e };
  const en2ll = (e, n) => frame.fromEN(e, n);
  const Dv = { e: Fe.e - Ee.e, n: Fe.n - Ee.n };
  const along = Dv.e * fwd.e + Dv.n * fwd.n;
  const lateral = Dv.e * rgt.e + Dv.n * rgt.n;
  const s = lateral >= 0 ? 1 : -1, d = Math.abs(lateral);
  if (d < 0.5) return { why: 'degenerate' };

  const disc = (d * d) / 4 - (Ls * Ls) / 6;
  if (disc < 0) return { why: 'tight' };            // no radius spans this crossing
  let R = (d / 2 + Math.sqrt(disc)) / 2;

  // Walk the three phases, returning either the crossing reached (probe) or the points.
  const fine = Math.min(0.25, Ls / 16, R / 40);
  const walk = (Rw, step, emit) => {
    const tau = Ls / (2 * Rw), theta = Math.PI - 2 * tau;
    if (theta < 0) return null;                     // the spirals alone over-rotate
    const Lc = Rw * theta;
    let u = 0, w = 0, psi = 0, acc = 0;             // u across, w forward, psi from +fwd
    const out = emit ? [] : null;
    const phase = (L, kOf, every) => {
      const n = Math.max(1, Math.ceil(L / step)), h = L / n;
      for (let i = 1; i <= n; i++) {
        const k = kOf(h * (i - 0.5));               // midpoint rule: second order in h
        const mid = psi + k * h / 2;
        psi += k * h; w += Math.cos(mid) * h; u += Math.sin(mid) * h;
        if (emit) { acc += h; if (acc >= every) { out.push([u, w]); acc = 0; } }
      }
    };
    // ⚠ THE SPIRALS ARE SAMPLED FINELY AND THE CORE IS NOT, because the core is a plain
    // arc and there is nothing there to resolve. MEASURED at a 40 m crossing: a uniform
    // fine step buys nothing over this and costs 60% more waypoints (67 against 42 at
    // Ls 8, identical curvature figures) — and at a SHORT spiral it is far worse, because
    // eight chords of a 2 m spiral is a 0.25 m step imposed on 60 m of core that does not
    // want it. The core step is held within 2x the spiral step all the same: a chord
    // length that jumps is a per-vertex heading change that jumps, which is the very
    // thing this shape is built to avoid.
    phase(Ls, x => x / (Rw * Ls), emit);
    phase(Lc, () => 1 / Rw, emit ? Math.min(opts.arcStepM ?? arcStepFor(Rw), 2 * emit) : emit);
    phase(Ls, x => (Ls - x) / (Rw * Ls), emit);
    // ⚠ DROP A TRAILING POINT THAT LANDS ON F. The emitter fires on accumulated distance,
    // so whether the last one falls on the shape's end is an accident of how the length
    // divides by the step — and when it does, the caller appends F on top of it and every
    // bearing taken across that pair is noise. It read as a 90 deg join out of a turn that
    // was in fact tangent to 0.1 deg. Same fault the run-out guard has, same threshold.
    if (out) while (out.length && Math.hypot(out[out.length - 1][0] - d,
                                             out[out.length - 1][1]) < ALONG_EPS_M) out.pop();
    return { u, w, psi, tau, len: 2 * Ls + Lc, pts: out };
  };

  for (let i = 0; i < 3; i++) {                     // close the seed's series error
    const probe = walk(R, fine, 0);
    if (!probe) return { why: 'tight' };
    const err = probe.u - d;
    if (Math.abs(err) < 1e-4) break;
    R -= err / 2;                                   // d(crossing)/dR = 2
  }
  // ⚠ THE HULL STILL HAS THE LAST WORD. Easing does not make a radius flyable, and the
  // eased R is always a little TIGHTER than the plain semicircle's (the spirals contribute
  // crossing of their own), so this can refuse where the plain arc would not.
  if (R < Math.max(0.75, opts.minR || 0)) return { why: 'tight' };

  // EIGHT CHORDS PER SPIRAL - see the header. Capped by the caller's ordinary arc step so
  // a long spiral is not sampled more finely than anything else, floored so a short one
  // cannot explode the waypoint count.
  const stepOut = Math.max(0.35, Math.min(opts.arcStepM ?? arcStepFor(R), Ls / 8));
  const built = walk(R, fine, stepOut);
  if (!built) return { why: 'tight' };

  const P = { e: Ee.e + (along > 0 ? along * fwd.e : 0), n: Ee.n + (along > 0 ? along * fwd.n : 0) };
  const Q = { e: Fe.e - (along < 0 ? along * fwd.e : 0), n: Fe.n - (along < 0 ? along * fwd.n : 0) };
  const map = (x, y) => en2ll(P.e + x * s * rgt.e + y * fwd.e, P.n + x * s * rgt.n + y * fwd.n);

  const pts = [];
  if (along > ALONG_EPS_M) pts.push(en2ll(P.e, P.n));
  for (const [u, w] of built.pts) pts.push(map(u, w));
  if (along < -ALONG_EPS_M) pts.push(en2ll(Q.e, Q.n));

  let prev = E;
  for (const p of [...pts, F]) {
    if (!clear(prev, p)) return { why: 'nogo', seg: [prev, p] };
    prev = p;
  }
  let outboard = 0;
  for (const p of pts) {
    const pe = frame.toEN(p);
    outboard = Math.max(outboard, (pe.e - Ee.e) * fwd.e + (pe.n - Ee.n) * fwd.n);
  }
  return { pts, kind: 'eased', R, Ls, tau: built.tau, len: built.len, outboard, side: 'outboard' };
}

export function teardropTurn(E, F, hE, hF, frame, opts = {}) {
  const clear = opts.clear || (() => true);
  // THE REVERSAL-PAIR GUARD. Not a hull constant — see the header. A caller that knows
  // its line spacing should pass `Math.max(60, spacing * 1.6)`; 60 alone refuses every
  // turn above 120 m of spacing and blames the keep-outs for it.
  const maxHalf = opts.maxHalfM ?? MAX_HALF_M;
  const Ee = frame.toEN(E), Fe = frame.toEN(F);
  const half = Math.hypot(Ee.e - Fe.e, Ee.n - Fe.n) / 2;
  if (half > maxHalf || half < 0.25) return { why: 'degenerate' };   // too far apart / coincident

  const minRc = Math.max(0.75, opts.minR || 0);
  const fwd = { e: Math.sin(hE * D2R), n: Math.cos(hE * D2R) };      // exit heading = outboard
  const rgt = { e: fwd.n, n: -fwd.e };                               // starboard of it
  const en2ll = (e, n) => frame.fromEN(e, n);

  // ⚠ THE PAIR IS DESCRIBED IN THE LINE'S OWN FRAME, AND BOTH BRANCHES READ IT. Splitting
  // E→F into ALONG (down the line just run) and LATERAL (across to the next one) is what
  // lets a turn be built from the two POSES rather than from the chord between them, and
  // it was hoisted out of the teardrop branch on 2026-09-08 because the semicircle branch
  // below was the one shape in this file that did not have it. See that branch.
  const Dv = { e: Fe.e - Ee.e, n: Fe.n - Ee.n };
  const along = Dv.e * fwd.e + Dv.n * fwd.n;
  const lateral = Dv.e * rgt.e + Dv.n * rgt.n;

  let pts, kind, R, outboard, side = 'outboard';
  // ⚠ GATED ON THE LATERAL OFFSET, NOT ON THE CHORD. They are the same number only while
  // the two ends are abeam; an along-track offset makes the chord longer than the crossing
  // and would let a pair take the semicircle at a radius the hull cannot hold.
  if (Math.abs(lateral) / 2 >= minRc) {
    // ── SEMICIRCLE: the offset itself supplies a radius the vessel can hold ─────────
    //
    // ⚠⚠ BUILT FROM THE TWO POSES, NOT FROM THE E–F CHORD (2026-09-08). This branch used
    // to set R = half and center the arc on the midpoint of E–F, which makes the tangents
    // perpendicular to the CHORD. While the two ends are abeam that is the same thing as
    // perpendicular to the LINES and the shape is right — which is why it stood for
    // months. Give the pair any along-track offset and it is wrong by exactly
    // atan(along / lateral) at BOTH ends: the boat is thrown off the line it has just run
    // and arrives on the next one crabbing.
    //
    // MEASURED on a 40 m-spaced plan the day lead-in/lead-out extensions made offsets
    // ordinary: a 40 m lead-in against a 25 m lead-out leaves the ends 15 m apart along
    // track, and the boat left the line 19° off and joined the next one 22° off. A 40 m
    // lead-in with no lead-out gave 44° and 46°. A feature whose whole purpose is to have
    // the boat SETTLED on the line was throwing it onto the line at 46°.
    //
    // The fix is what `racetrackTurn` and the teardrop branch below have always done, and
    // this was the one shape in the file without it: run the along-track offset out ON THE
    // LINE, and put the semicircle between the abeam points. R is then half the LATERAL
    // offset — the crossing distance — which is what the radius always meant. With no
    // offset every number here is identical to what it was, so a plan with no lead is
    // unchanged, point for point.
    R = Math.abs(lateral) / 2; kind = 'semicircle';
    const sSide = lateral >= 0 ? 1 : -1;
    // P = where the arc STARTS (E, run forward to the abeam point if F is further along);
    // Q = where it ENDS (F, or short of it if F is BEHIND E, then a straight run in).
    const P = { e: Ee.e + (along > 0 ? along * fwd.e : 0), n: Ee.n + (along > 0 ? along * fwd.n : 0) };
    const Q = { e: Fe.e - (along < 0 ? along * fwd.e : 0), n: Fe.n - (along < 0 ? along * fwd.n : 0) };
    const C = { x: P.e + sSide * R * rgt.e, y: P.n + sSide * R * rgt.n };
    const a0 = Math.atan2(P.n - C.y, P.e - C.x);
    // ⚠ TWO SWEEPS EXIST, AND THE CALLER MAY NEED THE OTHER ONE (2026-08-31).
    // A semicircle from E to F traces the same circle whichever way it is swept; the
    // direction only decides which SIDE of the E–F chord it bulges. Outboard — past the
    // end of the line just run — is the default and is right almost always, because
    // inboard sweeps back over water the plan has just surveyed.
    //
    // But when outboard is refused by a keep-out, inboard is not merely an alternative,
    // it is the only turn there is. The caller's fallback for a refused reversal is a
    // straight leg between the two line ends: clear of the model, and a 180° the vessel
    // cannot track. It will then loop on its own, uncommanded, and that loop goes
    // OUTBOARD — into the very feature that refused the turn. Refusing the turn removes
    // the only geometry that was steering the boat away from it.
    //
    // Andy, 2026-08-31, on precisely that outcome beside a wharf in Pago Pago (measured
    // off the recorded track: the plan cleared the pier by 14.3 m, the boat passed it at
    // 0.6 m): "the turn should be AWAY from the shoreline or dock or other feature
    // rather than through it."
    let dir = 1, bestProj = -Infinity;                    // pick the sweep that bulges outboard
    for (const cand of [1, -1]) {
      const am = a0 + cand * Math.PI / 2;
      const proj = Math.cos(am) * fwd.e + Math.sin(am) * fwd.n;
      if (proj > bestProj) { bestProj = proj; dir = cand; }
    }
    if (opts.side === 'inboard') { dir = -dir; side = 'inboard'; }
    // The run-out and the run-in bracket the arc, exactly as they do in racetrackTurn and
    // in the teardrop below. Both are on the line, so neither adds a degree of turning.
    pts = [];
    if (along > ALONG_EPS_M) pts.push(en2ll(P.e, P.n));
    pts.push(...arcPts(C, R, a0, dir * Math.PI, 4, en2ll, opts.arcStepM));
    if (along < -ALONG_EPS_M) pts.push(en2ll(Q.e, Q.n));
  } else {
    // ── TEARDROP: loop at the vessel's own minimum radius ───────────────────────────
    // The closed form assumes a true reversal; the caller's anti-parallel gate is far
    // looser than that, so re-check here and decline the skew cases rather than roll out
    // on a heading that misses the next line.
    if (Math.abs(((hF - hE + 360) % 360) - 180) > SKEW_LIMIT_DEG) return { why: 'skew' };
    R = minRc; kind = 'teardrop';
    // `rgt`, `along` and `lateral` are the hoisted ones now — this branch is where they
    // were written, and the semicircle above reads the same three.
    const s = lateral >= 0 ? 1 : -1, d = Math.abs(lateral);
    if (d < 0.5) return { why: 'degenerate' };            // lines on top of each other

    // Absorb the along-track offset with an on-line straight, then work in the local
    // frame (origin P, +x towards the next line, +y = exit heading) where F is abeam.
    const P = { e: Ee.e + (along > 0 ? along * fwd.e : 0), n: Ee.n + (along > 0 ? along * fwd.n : 0) };
    const Q = { e: Fe.e - (along < 0 ? along * fwd.e : 0), n: Fe.n - (along < 0 ? along * fwd.n : 0) };
    const map = (x, y) => en2ll(P.e + x * s * rgt.e + y * fwd.e, P.n + x * s * rgt.n + y * fwd.n);

    const qy2 = 4 * R * R - Math.pow((d + 2 * R) / 2, 2);
    if (qy2 < 0) return { why: 'degenerate' };            // unreachable while d ≤ 2R, but don't NaN
    const qy = Math.sqrt(qy2);
    const C1 = { x: -R, y: 0 }, C3 = { x: d + R, y: 0 }, C2 = { x: d / 2, y: qy };
    const T1 = { x: (C1.x + C2.x) / 2, y: (C1.y + C2.y) / 2 };   // equal radii → the tangent point
    const T2 = { x: (C2.x + C3.x) / 2, y: (C2.y + C3.y) / 2 };   // is the midpoint of the centers
    const n2pi = (a) => { a %= 2 * Math.PI; return a < 0 ? a + 2 * Math.PI : a; };
    const ang = (Pt, Ct) => Math.atan2(Pt.y - Ct.y, Pt.x - Ct.x);
    const s1 = n2pi(ang(T1, C1));                         // arc 1: CCW from angle 0 (the entry)
    const a2 = ang(T1, C2), s2 = -n2pi(a2 - ang(T2, C2)); // arc 2: CW over the top (>180°)
    const a3 = ang(T2, C3), s3 = n2pi(Math.PI - a3);      // arc 3: CCW onto the next line

    const step = opts.arcStepM;
    pts = [];
    if (along > ALONG_EPS_M) pts.push(en2ll(P.e, P.n));   // run-out to the abeam point
    pts.push(...arcPts(C1, R, 0, s1, 2, map, step), map(T1.x, T1.y));
    pts.push(...arcPts(C2, R, a2, s2, 2, map, step), map(T2.x, T2.y));
    pts.push(...arcPts(C3, R, a3, s3, 2, map, step));
    if (along < -ALONG_EPS_M) pts.push(en2ll(Q.e, Q.n));  // roll out early, straight in to F

  }

  // ⚠ HOW FAR PAST THE LINE END THE SHAPE ACTUALLY REACHES — MEASURED FROM THE POINTS,
  // FOR EVERY BRANCH. This is the water the operator has to have clear, and it is the
  // number the card quotes them. Both branches used to assert it instead: the semicircle
  // said `R` and the teardrop measured. `R` was right only while the two ends were abeam
  // — with the run-out above, the arc starts `along` meters further down the line and
  // reaches `along + R`. An asserted reach that is short is worse than none, because it
  // is the figure the operator decides "is that water clear?" against.
  outboard = 0;
  for (const p of pts) {
    const pe = frame.toEN(p);
    outboard = Math.max(outboard, (pe.e - Ee.e) * fwd.e + (pe.n - Ee.n) * fwd.n);
  }

  let prev = E;
  for (const p of [...pts, F]) {
    if (!clear(prev, p)) return { why: 'nogo', seg: [prev, p] };
    prev = p;
  }
  return { pts, kind, R, outboard, side };
}
