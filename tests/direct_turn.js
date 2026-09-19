// tests/direct_turn.js - the DIRECT (racetrack) reversal, and where it sits in the ladder.
//
// Andy, 2026-09-01, looking at a punched plan against the Erie shoreline:
//
//   "The turn away from threat functionality is working, but the turns are implemented as
//    inverted teardrop turns. Consider a more direct, curvilinear format for this
//    implementation."
//
// ⚠ WHAT HE WAS LOOKING AT WAS AN INBOARD SEMICIRCLE, AND THE NUMBER THAT EXPLAINS IT IS
// THE RADIUS. `teardropTurn` sweeps a semicircle of radius HALF THE LINE OFFSET whenever
// the hull can hold that radius. Measured on his plan: a Z-Boat at survey speed holds
// 2.06 m, the line spacing was 31.5 m, so every reversal was flown round a 15.75 m
// half-circle - SEVEN TIMES wider than the boat needed. Such an arc has to bulge
// somewhere. It needs 15.75 m of clear water past the end of the line to bulge outboard,
// and where a wharf took that water away the only rung left was the same arc swept the
// other way: back across 33 m of just-surveyed water. That is what draws on the chart as
// an inverted teardrop.
//
// The racetrack asks for the radius the hull actually has - two quarter-circles at minR
// joined by a straight across the gap. Measured, at the plan's own 31.5 m spacing:
//
//     semicircle   49.5 m long, 15.75 m of outboard water needed
//     racetrack    33.8 m long,  2.06 m of outboard water needed
//
// The outboard figure is the half that matters: IT DOES NOT GROW WITH THE SPACING (check
// 3). A turn that had to invert for want of 15 m of water now asks for 2 m and stays
// outboard, away from the feature - which is what "turn away from the threat" was always
// trying to buy.
//
//   node tests/direct_turn.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ⚠ RUNG 1 IS DELIBERATELY UNCHANGED, AND CHECK 8 IS WHAT HOLDS IT THAT WAY. A lazy
// half-circle is gentler on a towed body and on the survey, it is what every unobstructed
// turn in every existing plan already flies, and nobody reported a problem with those.
// This shape is what to fly when the gentle one has been REFUSED.
//
// TEETH - ten mutations RUN against a sidecar copy, and the predictions were corrected by
// what the runs printed rather than the other way round:
//
//   racetrack centred on the midpoint (loses its anchor) -> 1b, 12
//   arc step back to a flat 3 m                          -> 1b, 12
//   accepts a pair tighter than 2R                       -> 6
//   accepts a skew pair                                  -> 7
//   punchOut tallies a racetrack as a semicircle         -> 13
//   lane capture radius scaled by hw again (buoy_lane)   -> 30
//
// ⚠ THE LADDER-ORDER AND INBOARD LINES WERE RE-RUN ON 2026-09-19, because check 10 now
// asserts the opposite of what it did (see its own note) and three of them named it. These
// are the results that run printed, not the old predictions - cg = clearance_guard:
//
//   BOTH racetrack rungs removed from the ladder         -> both suites CRASH
//        (it used to read "racetrack rung removed -> 9, 9b, 10". Removing only the
//        survey-speed one is INERT: the minRSlow racetrack below it still answers.)
//   racetrack rungs moved BELOW the inboard one          -> 9      (was 8, 9, 9b, 10)
//   BOTH inboard rungs deleted                           -> 10b, 11; cg 10, 11
//   only ONE inboard rung deleted                        -> the first: INERT;
//                                                           the slow one: cg 10
//   turnJoinable dropped from the ladder                 -> 10
//   turnJoinable always true                             -> 10, 10c
//   an omitted `fly` opts out of the join test           -> 10
//
// ⚠ AND DELETING BOTH INBOARD RUNGS NO LONGER CHANGES A PLAN, only these fixtures.
// turnJoinable refuses every shape they produce (tests/turn_geometry.js 50-57), so the
// rungs are kept for two reasons only: the ladder still ASKS, and they are the suites'
// one specimen of a shape that joins neither line.
//
// ⚠ TWO OF THOSE FOUND HOLES IN THIS FILE, NOT IN THE CODE. Centring both arcs on the
// midpoint produces a shape that does not START AT THE LINE END, and checks 1-5 all stayed
// GREEN - every one of them measures the path's extent and not one measured where it is
// anchored. Check 1b exists because of that run. And buoy_lane's check 30 first used the
// 50 m-half fixture channel, where the old capture rule (125 m) and the new one (110 m)
// barely differ, so reverting the defect changed nothing the check could see; it needs the
// wide channel the bug was actually reported on.
//
// ⚠ AND ONE MUTATION IS INERT BY DESIGN: making the standoff a no-op-wrapped constant
// kills nothing, correctly. Deleting only the FIRST inboard rung is inert too, but the
// reason has changed: it used to be "the slow rung still inverts, so the safety property
// survives". It no longer inverts - turnJoinable refuses it - so what survives is only the
// REFUSAL, which the remaining rung reaches by the same path. Deleting the slow one alone
// still reds clearance_guard 10, which counts the rungs.

// --- crash guard: a throw outside a check() must still REPORT --------------------------
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const { azTo, planeFrame } = require("../static/js/geodesy.js");
const { bbOf } = require("../static/js/geometry.js");
const { SKEW_LIMIT_DEG } = require("../static/js/core_turns.js");
const { racetrackTurn, teardropTurn, turnJoinable,
        turnWithRetry } = require("../static/js/turns.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? detail + " — " : "") + "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}

// Erie, and the plan's own numbers: a Z-Boat holding 2.06 m at survey speed, 1.03 m slow.
const F = planeFrame({ lat: 42.1396, lon: -80.0902 });
// ⚠ THE VESSEL MODEL HAS TO MATCH THE RADII, since turnWithRetry now asks the runtime
// guard's own projection whether each shape is flyable (turns.js turnFlyable) and that
// projection integrates at V.MAX_TURN_RATE_DEG_S. MIN_R 2.06 m IS 3 kn at 60 deg/s with the
// 1.4 tracking margin - these constants were always this hull's, they were just never said
// out loud, and a projection run at some other rate would be judging a different boat.
const { V } = require("../static/js/state.js");
V.SPEED_KN = { low: 1.5, survey: 3.0, high: 6.0 };
V.MAX_TURN_RATE_DEG_S = 60;
V.VESSEL = { maneuvering: { approach_m: 1.0 } };
const MIN_R = 2.06, MIN_R_SLOW = 1.03, BUF = 3, SPACING = 31.5;
const MAXHALF = Math.max(60, SPACING * 1.6);
const CLEAR = { polys: [], lines: [], points: [], marks: [], sys: [], chans: [] };

// Line k runs due north and ends at E; line k+1 starts `d` to starboard, heading south.
const E = F.fromEN(0, 0);
const at = (d) => F.fromEN(d, 0);

/** Forward reach past the line end, and how far the shape sweeps BACK over the survey. */
function reach(r) {
  if (!r || !r.pts) return null;
  let fwd = -1e9, back = 1e9, len = 0, prev = E;
  for (const p of [...r.pts, at(SPACING)]) {
    const a = F.toEN(prev), b = F.toEN(p);
    len += Math.hypot(b.e - a.e, b.n - a.n); prev = p;
  }
  for (const p of r.pts) { const q = F.toEN(p); fwd = Math.max(fwd, q.n); back = Math.min(back, q.n); }
  return { fwd: +fwd.toFixed(2), backOverSurvey: +Math.max(0, -back).toFixed(2), len: +len.toFixed(1) };
}
/** A slab of keep-out water lying between `y0` and `y1`, spanning the whole gap. */
function slab(y0, y1) {
  const ring = [{ e: -40, n: y0 }, { e: 80, n: y0 }, { e: 80, n: y1 }, { e: -40, n: y1 }];
  return { polys: [{ ring, bb: bbOf(ring), kind: "a dock / pier" }],
           lines: [], points: [], marks: [], sys: [], chans: [] };
}

console.log("Direct (racetrack) reversal — the shape a boat with a tight helm actually flies:");

// ── 1-4. THE SHAPE ──────────────────────────────────────────────────────────────────
{
  const r = racetrackTurn(E, at(SPACING), 0, 180, F, CLEAR, BUF, MIN_R, MAXHALF);
  const g = reach(r);
  check("1. it is a racetrack, and it says so",
        () => r.pts && r.kind === "racetrack" && r.side === "outboard",
        "kind=" + (r.kind || r.why) + " side=" + r.side + " pts=" + (r.pts || []).length);
  // ⚠ 1b EXISTS BECAUSE A MUTATION WALKED PAST EVERYTHING ELSE. Moving both arc centres to
  // the midpoint produced a shape that no longer STARTS AT THE LINE END — it began a
  // radius away — and checks 1 to 5 all stayed green, because every one of them measures
  // the path's EXTENT and not one measured where it is anchored. A turn that begins
  // somewhere other than where the vessel is is not a turn, it is a teleport with an arc
  // drawn after it. The caller validates E->first and last->F through `clear`, which
  // catches this only when the water it skips over happens to be foul.
  const ends = (() => {
    if (!r.pts) return null;
    const a = F.toEN(r.pts[0]), b = F.toEN(r.pts[r.pts.length - 1]);
    const e0 = F.toEN(E), f0 = F.toEN(at(SPACING));
    return { fromE: Math.hypot(a.e - e0.e, a.n - e0.n), toF: Math.hypot(b.e - f0.e, b.n - f0.n) };
  })();
  check("1b. ... and it is ANCHORED: it starts at the line end and finishes on the next line",
        () => ends && ends.fromE < 1.5 && ends.toF < 1.5,
        ends ? ends.fromE.toFixed(2) + " m from the line end, " + ends.toF.toFixed(2)
               + " m from the next line's start (one arc step is ~0.4 m)" : "no turn");
  // The reach past the line end IS the radius. This is the operator-facing number: it is
  // the water that has to be clear beyond the end of every line.
  check("2. it reaches exactly the hull's own radius past the line end",
        () => g && Math.abs(g.fwd - MIN_R) < 0.02,
        "reached " + (g && g.fwd) + " m for a " + MIN_R + " m radius");
  // ⚠ THE CHECK THE WHOLE CHANGE RESTS ON. The semicircle's reach is half the spacing, so
  // it grows without bound as the lines spread; the racetrack's does not move at all.
  const spans = [10, 31.5, 60, 120, 240].map((d) => {
    const rr = racetrackTurn(E, at(d), 0, 180, F, CLEAR, BUF, MIN_R, Math.max(60, d * 1.6));
    const sc = teardropTurn(E, at(d), 0, 180, F, CLEAR, BUF, MIN_R, Math.max(60, d * 1.6));
    let fwdR = -1e9; for (const p of (rr.pts || [])) fwdR = Math.max(fwdR, F.toEN(p).n);
    let fwdS = -1e9; for (const p of (sc.pts || [])) fwdS = Math.max(fwdS, F.toEN(p).n);
    return { d, racetrack: +fwdR.toFixed(2), semicircle: +fwdS.toFixed(2) };
  });
  check("3. ... and that reach does NOT grow with the line spacing, while the arc's does",
        () => spans.every((s) => Math.abs(s.racetrack - MIN_R) < 0.02)
              && spans[spans.length - 1].semicircle > 100,
        spans.map((s) => s.d + "m:" + s.racetrack + "/" + s.semicircle).join("  ")
          + "  (racetrack/semicircle outboard reach)");
  const sc = teardropTurn(E, at(SPACING), 0, 180, F, CLEAR, BUF, MIN_R, MAXHALF);
  check("4. ... and it is shorter than the arc it replaces",
        () => g && reach(sc) && g.len < reach(sc).len * 0.75,
        "racetrack " + (g && g.len) + " m vs semicircle " + (reach(sc) || {}).len + " m");
}

// ── 5. IT NEVER SWEEPS BACK OVER THE SURVEY ─────────────────────────────────────────
// The complaint in one number. The inboard arc pays for turning away from a feature by
// re-crossing surveyed water; this shape does not pay it.
// ⚠ AND SINCE 2026-09-19 THAT IS THE LESSER OF THE INBOARD ARC'S TWO PROBLEMS. It never
// turned away from anything: it is the arc for the OPPOSITE transition, joining neither
// line, and turnJoinable now refuses it (tests/turn_geometry.js 50-57). This check still
// compares the two EXTENTS - the shape is still constructible and still sweeps back - but
// it is no longer a comparison between two turns the ladder might ship. It is one turn
// against a shape that cannot ship at all.
{
  const rt = racetrackTurn(E, at(SPACING), 0, 180, F, CLEAR, BUF, MIN_R, MAXHALF);
  const inb = teardropTurn(E, at(SPACING), 0, 180, F, CLEAR, BUF, MIN_R, MAXHALF, "inboard");
  check("5. it does not sweep back across the water just surveyed — the inboard arc does",
        () => reach(rt).backOverSurvey < 0.5 && reach(inb).backOverSurvey > 10,
        "racetrack " + reach(rt).backOverSurvey + " m back, inboard arc "
          + reach(inb).backOverSurvey + " m back");
}

// ── 6-7. WHAT IT REFUSES, AND WHY THAT IS RIGHT ─────────────────────────────────────
// Pair every refusal with its acceptance, or "refuses everything" passes too.
{
  const tight = racetrackTurn(E, at(2 * MIN_R - 0.5), 0, 180, F, CLEAR, BUF, MIN_R, MAXHALF);
  const wide = racetrackTurn(E, at(2 * MIN_R + 0.5), 0, 180, F, CLEAR, BUF, MIN_R, MAXHALF);
  check("6. below twice the radius there is no straight to run, so it refuses — that is a teardrop",
        () => !tight.pts && tight.why === "tight" && !!wide.pts,
        "d=" + (2 * MIN_R - 0.5).toFixed(2) + " -> " + tight.why
          + ", d=" + (2 * MIN_R + 0.5).toFixed(2) + " -> " + (wide.kind || wide.why));
  const skew = racetrackTurn(E, at(SPACING), 0, 180 - (SKEW_LIMIT_DEG + 5), F, CLEAR, BUF, MIN_R, MAXHALF);
  const square = racetrackTurn(E, at(SPACING), 0, 180, F, CLEAR, BUF, MIN_R, MAXHALF);
  check("7. a skew pair is refused — the construction assumes an actual reversal",
        () => !skew.pts && skew.why === "skew" && !!square.pts,
        (SKEW_LIMIT_DEG + 5) + "° off anti-parallel -> " + skew.why + ", 0° off -> " + square.kind);
}

// ── 8-11. THE LADDER ────────────────────────────────────────────────────────────────
{
  // 8. THE CONTROL. Clear water still gets the gentle arc on rung 1. Without this,
  // "always fly the racetrack" would pass every other ladder check in this file.
  const clear = turnWithRetry(E, at(SPACING), 0, 180, F, CLEAR, BUF, MIN_R, MAXHALF, MIN_R_SLOW);
  check("8. in clear water the turn is UNCHANGED: the gentle semicircle, on rung 1",
        () => clear.pts && clear.kind === "semicircle" && clear.rung === 1 && clear.side === "outboard",
        "rung " + clear.rung + ", " + clear.kind + ", " + clear.side
          + " — existing plans must not change shape");

  // 9. THE FIX. A wharf 6 m past the line end: too close for the 15.75 m arc, ample for
  // the 2.06 m racetrack. This is the Erie geometry reduced to its bones.
  const W = slab(6, 40);
  const t = turnWithRetry(E, at(SPACING), 0, 180, F, W, BUF, MIN_R, MAXHALF, MIN_R_SLOW);
  const old = teardropTurn(E, at(SPACING), 0, 180, F, W, BUF, MIN_R, MAXHALF);
  check("9. with the wide arc refused, the ladder flies the DIRECT shape — not the inverted one",
        () => t.pts && t.kind === "racetrack" && t.side === "outboard" && t.rung === 2,
        "gentle arc: " + (old.pts ? "ok" : "refused (" + old.why + ")")
          + " -> ladder gives " + t.kind + "/" + t.side + " on rung " + t.rung);
  check("9b. ... it stays clear of the wharf, and never crosses back over the survey",
        () => t.pts && t.pts.every((p) => F.toEN(p).n < 6 - BUF) && reach(t).backOverSurvey < 0.5,
        (t.pts || []).length + " waypoints, max reach " + reach(t).fwd
          + " m against a wharf at 6 m, " + reach(t).backOverSurvey + " m back over the survey");

  // 10. ⚠⚠ THIS CHECK USED TO DEMAND THE OPPOSITE, AND IT WAS PASSING FOR THE WRONG
  // REASON (rewritten 2026-09-19). It read "when even the tight shape will not fit, it
  // STILL inverts rather than refusing", and asserted `inv.side === "inboard"` - so it
  // certified as the wharf fix a shape the boat cannot join. The inboard semicircle
  // reverses the SWEEP about a center that does not move, which keeps the two endpoints
  // and reverses BOTH tangents: the boat is told to turn 176 deg at the line end, fly the
  // arc backwards, and turn 176 deg again onto the next line. `turnFlyable` passed it
  // (a cusp in open water projects clean - measured, 120 of 120) and `legClear` passed it
  // (every chord is lawful water), so both of this suite's existing tests said yes.
  //
  // IT WAS NOT HYPOTHETICAL. Re-deriving every turn in Andy's own plans from their stored
  // lines and matching each to its rung, 2026-09-19: mission.json.bak5 shipped 4 of 17
  // reversals on this rung, bak1 1, bak4 1, and the Honolulu route of 2026-09-16 4 of 62 -
  // and the in-extremis escape at 19:11:50 fired at route vertex 18, the 4th arc vertex of
  // one of them, after the boat had lost half its way at the join (sog 1.98 -> 0.94 kn).
  //
  // SO THE SAFE ANSWER HERE IS THE REFUSAL, and that is only true because `035878f1` made
  // a refused reversal a VISIBLE plan defect rather than a silent straight leg: punchOut
  // flags it UNSAFE, the card says which pair and why, and Add to plan refuses the pattern
  // until the operator moves the line ends, strikes a run or widens the spacing. The wharf
  // incident was never "the ladder refused" - it was "the ladder refused and punchOut
  // shipped a straight 180 anyway". What still answers Andy's "turn AWAY from the dock"
  // are rungs 2 and 3, checked at 9/9b above: they reach minR and minRSlow past the line
  // end instead of half the line spacing, and they DO join.
  //
  // ⚠ THE WINDOW IS NARROW AND BOTH EDGES COST A WRONG RESULT. The slab must sit far
  // enough out that the LINE END itself is clear (else the first chord of every shape is
  // refused and this reddens for a reason that is not the ladder - the first draft used
  // 0.6 m and did exactly that), and close enough to refuse the racetrack at BOTH radii:
  // 2.06 + BUF = 5.06 m at survey speed, 1.03 + BUF = 4.03 m slowed. A draft at 4.5 m left
  // the SLOW racetrack fitting, so the ladder rightly took rung 3 and never reached the
  // rung under test.
  const TIGHT = 4.0;                       // > BUF, < MIN_R_SLOW + BUF, and flyable
  const tightW = slab(TIGHT, 40);
  const inv = turnWithRetry(E, at(SPACING), 0, 180, F, tightW, BUF, MIN_R, MAXHALF, MIN_R_SLOW);
  check("10. with every joining shape refused, the ladder REFUSES — it does not ship the one that cannot join",
        () => !inv.pts && inv.why === "nogo",
        "outboard water cut to " + TIGHT + " m -> " + (inv.pts ? "SHIPPED " + inv.kind + "/"
          + inv.side + " on rung " + inv.rung + " — a shape the boat cannot join"
          : "refused (" + inv.why + ") after " + inv.rung + " rungs"));
  // 10a. THE ACCEPTANCE THAT MAKES 10 MEAN SOMETHING. "Refuses everything" would pass 10
  // on its own; give the same pair the water back and the turn must return, unchanged.
  const roomy = turnWithRetry(E, at(SPACING), 0, 180, F, slab(20, 40), BUF, MIN_R, MAXHALF, MIN_R_SLOW);
  check("10a. ... and with the water back it is the ordinary turn again, on rung 1",
        () => roomy.pts && roomy.side === "outboard" && roomy.rung === 1,
        "slab moved to 20 m -> " + (roomy.pts ? roomy.kind + "/" + roomy.side + " on rung "
          + roomy.rung + ", " + roomy.pts.length + " waypoints" : "REFUSED (" + roomy.why + ")"));
  // 10c. AND THE GATE IS WHAT DOES IT, not the keep-out. Same geometry, NO keep-out at all,
  // the inboard shape asked for directly: it is still refused, because the defect is the
  // shape's own tangents and has nothing to do with the water.
  const inbOnly = turnWithRetry(E, at(SPACING), 0, 180, F, slab(-40, -0.6), BUF,
                                MIN_R, MAXHALF, MIN_R_SLOW);
  const inbShape = teardropTurn(E, at(SPACING), 0, 180, F, CLEAR, BUF, MIN_R, MAXHALF, "inboard");
  check("10c. the mirrored semicircle is refused for its TANGENTS, in water that refuses nothing",
        () => inbShape.pts && !turnJoinable(E, at(SPACING), inbShape.pts, 0, 180,
                                            { spdKey: "survey", approachM: 1 }),
        "the shape is drawn (" + (inbShape.pts || []).length + " waypoints, all clear) and "
          + "leaves E on " + azTo(E, inbShape.pts[0]).toFixed(0) + "° where the line runs 0° — "
          + "turnJoinable says " + turnJoinable(E, at(SPACING), inbShape.pts, 0, 180,
                                                { spdKey: "survey", approachM: 1 })
          + "; with the survey water walled off instead the ladder answers "
          + (inbOnly.pts ? inbOnly.kind + "/" + inbOnly.side : "refused (" + inbOnly.why + ")"));

  // 10b. A DRAWN SHAPE THAT FITS IS NOT A TURN THE BOAT CAN MAKE. Squeeze the water to
  // where the polyline still fits and the ladder must still refuse. That is only safe
  // because a refused reversal does not ship at all: punchOut flags it UNSAFE, and Add to
  // plan refuses the pattern until the operator moves the line ends or strikes a run
  // (tests/turn_refusal.js). This comment used to say it "blocks Upload" - it never did, and
  // until 2026-09-16 the refusal here was shipped as the straight leg after all. Shipping an
  // unflyable loop next to the one feature that refused it is the wharf incident itself.
  //
  // ⚠⚠ THIS CHECK NO LONGER ISOLATES `turnFlyable`, AND SAYING SO IS THE POINT (2026-09-19).
  // It was written as "where nothing can be TRACKED it refuses" and its fixture reaches
  // that verdict through the INBOARD shape - the only one whose extent fits at 3.5 m. Now
  // that turnJoinable refuses that shape first, on its tangents, the flyability test is no
  // longer what decides here: MEASURED, neutering turnFlyable entirely leaves this check
  // GREEN. What still holds the flyability property is tests/turn_geometry.js 46, 47 and
  // 47b, which exercise it directly and DO red under that mutation. A fixture that isolates
  // it at the LADDER level - a shape that joins both lines but whose flown track cuts into
  // something - was looked for and not found in the obvious places (a pile inside the loop
  // just pushes the ladder to the racetrack); it is worth building, and is not built.
  const noneFly = turnWithRetry(E, at(SPACING), 0, 180, F, slab(3.5, 40), BUF,
                                MIN_R, MAXHALF, MIN_R_SLOW);
  const geomOnly = turnWithRetry(E, at(SPACING), 0, 180, F, slab(3.5, 40), BUF,
                                 MIN_R, MAXHALF, MIN_R_SLOW, 0, false);
  check("10b. ... and where the drawn polyline fits but nothing can be FLOWN, it still refuses",
        () => !noneFly.pts && geomOnly.pts && geomOnly.side === "inboard",
        "at 3.5 m the drawn shape is clear (" + (geomOnly.pts ? geomOnly.kind + "/"
          + geomOnly.side + ", " + geomOnly.pts.length + " waypoints, no fouled chord" : "?")
          + ") and the ladder still gives up: "
          + (noneFly.pts ? "SHIPPED ANYWAY" : "refused (" + noneFly.why + ")")
          + " — though it is now the JOIN gate refusing it, not the flyability one");

  // 11. And when there is genuinely nothing, it is refused as unsafe with rung ONE's
  // reason - the turn the operator expected, and the feature that took it away.
  const boxed = { polys: [...slab(0.6, 40).polys, ...slab(-40, -0.6).polys],
                  lines: [], points: [], marks: [], sys: [], chans: [] };
  const none = turnWithRetry(E, at(SPACING), 0, 180, F, boxed, BUF, MIN_R, MAXHALF, MIN_R_SLOW);
  check("11. walled both sides, every rung refuses and rung 1's reason is what is reported",
        () => !none.pts && none.why === "nogo" && none.rung >= 4,
        "refused '" + none.why + "' after " + none.rung + " rungs");
}

// ── 12. THE ARC IS RESOLVED FINELY ENOUGH TO ARRIVE ON THE LINE ─────────────────────
// ⚠ THIS ONE FOUND A REAL DEFECT AND IS KEPT FOR THAT REASON. `arcStepFor` floors at 3 m
// and ASV passes a flat 3 m, which is ample on a 15.75 m semicircle and useless on a 90°
// arc at R = 2.06 m — that arc is 3.2 m long, so a 3 m step resolves it with ONE chord and
// the vessel rolled out 11° off the next line. The step is a fraction of R now.
{
  const errs = [10, 31.5, 60, 120].map((d) => {
    const r = racetrackTurn(E, at(d), 0, 180, F, CLEAR, BUF, MIN_R, Math.max(60, d * 1.6));
    const a = F.toEN(r.pts[r.pts.length - 1]), b = F.toEN(at(d));
    const h = (Math.atan2(b.e - a.e, b.n - a.n) * 180 / Math.PI + 360) % 360;
    return { d, err: +Math.abs(((h - 180 + 540) % 360) - 180).toFixed(1) };
  });
  check("12. the vessel arrives within 8° of the next line's heading, at every spacing",
        () => errs.every((e) => e.err < 8),
        errs.map((e) => e.d + "m:" + e.err + "°").join("  ")
          + "  (was 11° off at a flat 3 m arc step)");
}

// ── 13. THE CARD MUST NOT CALL IT A SEMICIRCLE ──────────────────────────────────────
// A racetrack appears only where the gentle arc was refused, so its presence on the card
// is the operator's signal that the water past those line ends is tight. Counting it as a
// semicircle would hide exactly the thing worth telling them.
{
  const fs = require("fs"), path = require("path");
  // ASV_HTML points this at a SIDECAR copy for a mutation run. Without it a mutation of
  // the page scores as SURVIVED whatever this check says — caught here on 2026-09-08 when
  // deleting the eased-turn tally, which the check below names outright, came back green.
  const H = fs.readFileSync(process.env.ASV_HTML ||
                            path.join(__dirname, "..", "static", "asv.html"), "utf8");
  // EVERY SHAPE IS COUNTED AS ITSELF. The same argument covers the EASED reversal added on
  // 2026-09-08: it is a curve the operator asked for by name, the eased rung refuses more
  // readily than the plain arc and falls back to it without complaint, so an eased turn
  // tallied as a semicircle would hide precisely what the card is for — how many of the
  // turns they asked to have eased actually were.
  const counter = /t\.kind===\"teardrop\" \? nTear\+\+ : t\.kind===\"racetrack\" \? nRace\+\+[\s\S]{0,60}?t\.kind===\"eased\" \? \(nEased\+\+[\s\S]{0,40}?\) : nSemi\+\+/;
  // ⚠ AND "ROUTED AROUND OBSTACLES" IS WHAT IS LEFT AFTER EVERY TURN IS SUBTRACTED, so a
  // new shape has to be taken out of it too. Adding the eased reversal without touching
  // that line reported all three eased turns as detours as well — MEASURED on a live punch,
  // where the eased run claimed "3 routed around obstacles" and the identical arc run
  // claimed none. This is the second half of the same fault the counter above guards.
  const routed = /const nRoute=patRoutes\.length-nSemi-nTear-nRace-nEased/;
  check("13. punchOut counts every turn shape as itself, and names each on the card",
        () => counter.test(H) && routed.test(H)
              && /\$\{nRace\} direct \(racetrack\) turn\(s\)/.test(H)
              && /\$\{nEased\} eased turn\(s\)/.test(H),
        counter.test(H) && routed.test(H)
          ? "semicircle, teardrop, racetrack and eased each counted apart, each named, and "
            + "every one of them subtracted from the routed-detour tally"
          : !routed.test(H) ? "a generated turn is also being counted as a routed detour"
                            : "a turn shape is being tallied as something it is not");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
