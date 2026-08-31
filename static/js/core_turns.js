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
 *     THIS FILE AND SILENTLY DELETE A SAFETY FIX. This copy carries
 *     the `side` option on teardropTurn's semicircle branch, which is
 *     what lets a refused turn go AWAY from a dock instead of being
 *     abandoned.
 *     asv_core does not have it. If a `--check` there reports this copy as
 *     DRIFTED, that is correct and expected: it has drifted, on purpose.
 *
 * The fix is covered by tests/clearance_guard.js, which runs in this repo's own
 * pre-commit hook. If it is ever wanted upstream, carry it there as its own
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
 * the judgement is made once instead of twice at two different scales. Below
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
 *     reversal pair" gate uses — so the judgement is made once instead of twice at two
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
 * ⚠ ZERO IS AN ANSWER, NOT A CRASH, and that is the behaviour ASV did not have. With no
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
 * Arc point spacing for a radius, in metres.
 *
 * Held as a fraction of the radius rather than a constant, so the chord sagitta
 * (≈ step²/8R) stays proportionate: 3 m at a 2 m radius, 12.5 m at a 250 m one. The
 * floor is 3 m, which is what a small USV's follower needs to round the arc smoothly,
 * and it is what this returns for every R below 60 m.
 */
export const arcStepFor = (R) => Math.max(3, R / 20);

/**
 * Shorten a survey segment by `m` metres at BOTH ends: settle on-line, and leave room
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
 * Interior points of a circular arc: centre `C`, radius `R`, from angle `a0` sweeping
 * `sweep` radians (signed, + = CCW). EXCLUDES both endpoints.
 *
 * Chords cut INBOARD — away from the arc's own centre — and every chord is validated by
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
 * circle-centre midpoints, because the radii are equal. Net heading change is −180° by
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
  const en2ll = (e, n) => frame.fromEN(e, n);

  let pts, kind, R, outboard, side = 'outboard';
  if (half >= minRc) {
    // ── SEMICIRCLE: the offset itself supplies a radius the vessel can hold ─────────
    R = half; kind = 'semicircle'; outboard = R;
    const C = { x: (Ee.e + Fe.e) / 2, y: (Ee.n + Fe.n) / 2 };
    const a0 = Math.atan2(Ee.n - C.y, Ee.e - C.x);
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
    pts = arcPts(C, R, a0, dir * Math.PI, 4, en2ll, opts.arcStepM);
  } else {
    // ── TEARDROP: loop at the vessel's own minimum radius ───────────────────────────
    // The closed form assumes a true reversal; the caller's anti-parallel gate is far
    // looser than that, so re-check here and decline the skew cases rather than roll out
    // on a heading that misses the next line.
    if (Math.abs(((hF - hE + 360) % 360) - 180) > SKEW_LIMIT_DEG) return { why: 'skew' };
    R = minRc; kind = 'teardrop';
    const rgt = { e: fwd.n, n: -fwd.e };                  // starboard of the exit heading
    const D = { e: Fe.e - Ee.e, n: Fe.n - Ee.n };
    const along = D.e * fwd.e + D.n * fwd.n;
    const lateral = D.e * rgt.e + D.n * rgt.n;
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
    const T2 = { x: (C2.x + C3.x) / 2, y: (C2.y + C3.y) / 2 };   // is the midpoint of the centres
    const n2pi = (a) => { a %= 2 * Math.PI; return a < 0 ? a + 2 * Math.PI : a; };
    const ang = (Pt, Ct) => Math.atan2(Pt.y - Ct.y, Pt.x - Ct.x);
    const s1 = n2pi(ang(T1, C1));                         // arc 1: CCW from angle 0 (the entry)
    const a2 = ang(T1, C2), s2 = -n2pi(a2 - ang(T2, C2)); // arc 2: CW over the top (>180°)
    const a3 = ang(T2, C3), s3 = n2pi(Math.PI - a3);      // arc 3: CCW onto the next line

    const step = opts.arcStepM;
    pts = [];
    if (along > 0) pts.push(en2ll(P.e, P.n));             // run-out to the abeam point
    pts.push(...arcPts(C1, R, 0, s1, 2, map, step), map(T1.x, T1.y));
    pts.push(...arcPts(C2, R, a2, s2, 2, map, step), map(T2.x, T2.y));
    pts.push(...arcPts(C3, R, a3, s3, 2, map, step));
    if (along < 0) pts.push(en2ll(Q.e, Q.n));             // roll out early, straight in to F

    // How far past the line end the loop actually reaches, measured on the exit heading
    // from E — this is the water the operator has to have clear.
    outboard = 0;
    for (const p of pts) {
      const pe = frame.toEN(p);
      outboard = Math.max(outboard, (pe.e - Ee.e) * fwd.e + (pe.n - Ee.n) * fwd.n);
    }
  }

  let prev = E;
  for (const p of [...pts, F]) {
    if (!clear(prev, p)) return { why: 'nogo', seg: [prev, p] };
    prev = p;
  }
  return { pts, kind, R, outboard, side };
}
