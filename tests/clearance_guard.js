// tests/clearance_guard.js - the buffer enforced on the BOAT, and a turn that never
// gives up while a shape remains.
//
// Andy, 2026-08-31, with a screenshot of a recorded track passing through a wharf:
//
//   "This image shows a path line intersecting a pier without any reaction from the
//    system. This is very bad. During this sort of maneuver and when extreme close range
//    is an issue, the turn should be AWAY from the shoreline or dock or other feature
//    rather than through it. Speed MAY be modified temporarily to slow and reduce impact
//    damage if a turn will not resolve. This may be a buffer related situation improperly
//    set by the user in the GUI but the 5m setting in the recent instance seems to have
//    been ignored."
//
// ⚠ THE BUFFER WAS NOT IGNORED - IT WAS NEVER APPLIED TO THE VEHICLE, and the numbers say
// so. Measured off that screenshot (Pago Pago, DriX H-8, z18 = 0.5787 m/px, buffer 5 m):
//
//     the commanded ROUTE cleared the pier by  24.8 px = 14.3 m
//     the recorded TRACK  cleared the pier by   1.0 px =  0.6 m
//
// The planner had done its job. What was missing was everything after it. And the reason
// the boat was there at all is the second measurement from the same image:
//
//     WEST end of the block, turn generated:  26 route waypoints (a teardrop)
//     EAST end, beside the pier:               4 route waypoints (the two line ends)
//
// teardropTurn refused at the pier, and punchOut's fallback for a refused reversal was a
// STRAIGHT leg between the line ends - which legClear passes, because the straight line
// genuinely is clear. What shipped was a 180 in ~26 m the hull cannot track. The boat then
// looped on its own, uncommanded, OUTBOARD - into the very feature that refused the turn.
// Refusing the turn is what put the boat on the pier: it removed the only geometry that
// was steering it away.
//
//   node tests/clearance_guard.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// The rules this suite encodes:
//   * clearanceM is a DISTANCE from the same model `blocked` is a yes/no from. The two may
//     never disagree about what a keep-out is, or the number the operator watches is not
//     the rule the route was cleared against.
//   * A refused turn is retried on the OTHER SIDE before it is given up - that is Andy's
//     "turn away from the dock", and it is the whole fix.
//   * ... and then at the SLOW radius, which is his second lever.
//   * Every rung answers to the SAME keep-out model (also pinned in turn_channel 10b).
//   * A reversal with no turn left on any rung is UNSAFE and is not shipped.
//   * The console slows, and never steers. It commands nothing unless the boat is under
//     autonomous command.
//
// TEETH: FIFTEEN mutations run against a sidecar copy of the page and the two modules;
// the check numbers are the ones that actually went red, not the ones that looked likely.
//   clearanceM: drop the "inside a poly is zero" test        -> 1, 2
//   clearanceM: ignore ko.lines                              -> 1, 3
//   clearanceM: ignore ko.points                             -> 1, 4
//   clearanceM: measure a point hazard from its CENTRE       -> 1, 4, 5
//   clearanceM: forget the cap                               -> 6
//   turns: OUTBOARD ONLY - the behaviour that hit the pier   -> 8, 10, 11
//   turns: never try the slow radius                         -> 10, 11
//   turns: report the LAST refusal instead of the first      -> 11
//   turns: a later rung gets a LOOSER keep-out model         -> 10, 11
//   page: ship the straight leg again - THE REPORTED DEFECT  -> 12
//   page: slow-down with no autonomy gate                    -> 14
//   page: hand the speed back at the buffer edge             -> 15
//   page: the guard also commands a HEADING                  -> 16
//   page: the guard is never called from the tick            -> 17
//   page: the clearance row never reaches the Intent card    -> 18
//
// THE LAST ONE SURVIVED THE FIRST PASS and is why 18 exists: every check here passed with
// the operator-facing half of the feature deleted. A guard acting on a quantity nobody can
// see is most of the way back to the defect it was written for.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

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

// THE REAL MODULES. clearanceM must be the shipped one, and it must sit beside the
// shipped `blocked` - checks 1-2 compare them against each other, which only means
// anything if both come from the file the console loads.
const { blocked, clearanceM } = require("../static/js/keepouts.js");
const { planeFrame } = require("../static/js/geodesy.js");
const { bbOf } = require("../static/js/geometry.js");
const { teardropTurn, turnWithRetry, minTurnRadiusM } = require("../static/js/turns.js");

// ASV_HTML points this at a SIDECAR copy for a mutation run. Without it the only way to
// mutate what this suite reads is to edit static/asv.html itself — and a suite that ignores
// the override scores every mutation as SURVIVED, which is a broken instrument rather than
// weak checks. Caught here the same way it was caught in ais_table.js on 2026-09-08: a
// mutation that deletes a counter this suite explicitly greps for came back green. Check
// 12's regex names `nUnsafeTurn++` outright, so the SUITE was never the problem — the
// instrument was reading a file nothing had written to, and reporting that as coverage.
const H = fs.readFileSync(process.env.ASV_HTML ||
                          path.join(__dirname, "..", "static", "asv.html"), "utf8");
const T = fs.readFileSync(path.join(__dirname, "..", "static", "js", "turns.js"), "utf8");

function grab(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = src.indexOf("{", start), depth = 0;
  for (;;) { const c = src[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return src.slice(start, k + 1);
}

let fails = 0;
function check(name, cond, detail) {
  let ok = false, err = "";
  try { ok = (typeof cond === "function") ? !!cond() : !!cond; }
  catch (e) { ok = false; err = " THREW " + (e && e.message ? e.message : e); }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : "") + err);
  if (!ok) fails++;
}

console.log("Clearance guard - the buffer applied to the boat, and a turn that keeps trying:");

// ---- A WORLD, in metres. A square "pier" 20 m on a side, a shoreline, and a pile. ----
const ORG = { lat: -14.2721, lon: -170.6944 };          // Pago Pago, where this happened
const F = planeFrame(ORG);
const sq = (e, n, half) => [
  { e: e - half, n: n - half }, { e: e + half, n: n - half },
  { e: e + half, n: n + half }, { e: e - half, n: n + half },
];
// ⚠ THE BOUNDING BOX COMES FROM THE REAL `bbOf`, NOT FROM A HAND-WRITTEN LITERAL, and
// this suite's first draft is why that is written down. `bbOf` returns {x0,y0,x1,y1};
// the obvious guess is {w,e,s,n}. With the wrong keys `inBB` rejected every feature, so
// `blocked` AND `clearanceM` both skipped the polys and lines entirely - and check 1,
// which compares the two, PASSED, because they agreed about a world containing nothing.
// A fixture that is easier to write than the real shape will agree with broken code.
const poly = (kind, ring) => ({ kind, ring, bb: bbOf(ring) });
const line = (kind, pts) => ({ kind, pts, bb: bbOf(pts) });
const PIER = poly("a dock / pier", sq(0, 0, 10));
const SHORE = line("the shoreline", [{ e: -200, n: 60 }, { e: 200, n: 60 }]);
const PILE = { kind: "a pile", e: 80, n: 0, r: 4 };
const KO = { polys: [PIER], lines: [SHORE], points: [PILE], marks: [], sys: [], chans: [] };

const near = (v, w, tol) => Math.abs(v - w) <= (tol || 0.05);

// 1-2. THE DISTANCE AND THE YES/NO ARE THE SAME MODEL. If clearanceM and blocked can
// disagree about where a keep-out is, then the number on the card is not the rule the
// route was cleared against, and watching it teaches the operator the wrong thing.
{
  const pts = [];
  for (let e = -40; e <= 120; e += 3) for (let n = -40; n <= 80; n += 3) pts.push({ e, n });
  const BUF = 5;
  const disagree = pts.filter(p => (clearanceM(p, KO) < BUF) !== blocked(p, KO, BUF));
  // ⚠ AND THE SWEEP MUST ACTUALLY HIT SOMETHING. Agreement is worthless if neither
  // function can see the world: the first draft of this fixture had the wrong bounding-box
  // keys, every feature was skipped, and this check passed with 0 disagreements over 2,214
  // points of nothing. The counts below are what makes it a check.
  const inside = pts.filter(p => blocked(p, KO, BUF)).length;
  check("1. clearanceM < buffer agrees with blocked(buffer) at every point tested",
        () => disagree.length === 0 && inside > 20 && inside < pts.length - 20,
        pts.length + " points swept, " + inside + " of them inside the buffer, "
          + disagree.length + " disagreements"
          + (disagree.length ? " e.g. " + JSON.stringify(disagree[0]) : ""));
  check("2. a point INSIDE a keep-out is zero clear, not the distance to its edge",
        () => clearanceM({ e: 0, n: 0 }, KO) === 0 && clearanceM({ e: 9, n: 0 }, KO) === 0,
        "the pier centre and a point 1 m inside its edge both read 0");
}

// 3-6. EACH OF THE THREE KINDS COUNTS, and the point hazard is measured from its EDGE.
{
  check("3. a keep-out LINE (a shoreline) is measured, not skipped",
        () => near(clearanceM({ e: 0, n: 45 }, KO), 15, 0.01),
        "15 m south of a shoreline at n=60 -> " + clearanceM({ e: 0, n: 45 }, KO).toFixed(2) + " m");
  check("4. a keep-out POINT (a pile) is measured, not skipped",
        () => near(clearanceM({ e: 100, n: 0 }, KO), 16, 0.01),
        "20 m from a pile of radius 4 -> " + clearanceM({ e: 100, n: 0 }, KO).toFixed(2) + " m");
  check("5. ... from its OWN EDGE, matching blocked's `buf + r` test",
        () => !near(clearanceM({ e: 100, n: 0 }, KO), 20, 0.01),
        "measuring from the centre would read 20 m and call a 4 m pile clear water");
  // The CAP is the function's own default (500); CLEAR_CAP_M (400) is what the PAGE
  // chooses to pass. Two different numbers, and asserting the page's against the
  // function's default is how the first draft of this check failed - correctly.
  check("6. open water is capped rather than walked to the horizon",
        () => clearanceM({ e: 5000, n: 5000 }, KO, 50) === 50 &&
              clearanceM({ e: 5000, n: 5000 }, KO, 400) === 400,
        "any cap is honoured; the module default is "
          + clearanceM({ e: 5000, n: 5000 }, KO)
          + " and the page passes CLEAR_CAP_M");
  check("6b. ... and the page passes its own constant rather than taking the default",
        () => /const CLEAR_CAP_M = 400;/.test(H) && /clearanceM\(p, nogo\.ko, CLEAR_CAP_M\)/.test(H),
        "so the cost of the guard is a decision in the page, visible beside the tick");
}

// ---- THE TURN LADDER ---------------------------------------------------------------- //
// A reversal pair at the end of a line, with the pier sitting in the OUTBOARD water - the
// Pago Pago geometry, reduced to its bones. E is the end of the line just run, heading
// east; F is the start of the next line, heading back west, 26 m to the north.
const LL = (e, n) => F.fromEN(e, n);
const CLEAR = { polys: [], lines: [], points: [], marks: [], sys: [], chans: [] };
const E = LL(-30, -13), Fp = LL(-30, 13);        // the two line ends, 26 m apart
const hE = 90, hF = 270;                          // out east on one line, back west on the next
const SPACING = 26, MAXHALF = Math.max(60, SPACING * 1.6);
const BUF = 5;
const minR = 10, minRSlow = 3;

function turn(ko, mR, mRs) {
  return turnWithRetry(E, Fp, hE, hF, F, ko, BUF, mR, MAXHALF, mRs);
}
// ⚠ OBSTACLES ARE PLACED FROM THE MEASURED REACH OF THE TURN, NOT FROM ARITHMETIC ON
// PAPER. The first draft of this suite worked the semicircle's reach out by hand, put the
// pier where it "should" be blocked, and every ladder check passed for the wrong reason:
// the arc stopped 7 m short of the buffer, nothing was ever refused, and the checks were
// measuring an unobstructed turn. `reach` flies the real turn in clear water and reports
// how far east and west it actually goes, so a wall can be put where it will be met.
function reach(mR) {
  const t = teardropTurn(E, Fp, hE, hF, F, CLEAR, BUF, mR, MAXHALF);
  const es = (t.pts || []).map(p => F.toEN(p).e);
  return { east: Math.max(...es), west: Math.min(...es), kind: t.kind, ok: !!t.pts };
}
const R_PLAN = reach(minR), R_SLOW = reach(minRSlow);
// A wall standing across the turn's path at `atE`, tall enough that the loop cannot go
// round the end of it.
const wall = (kind, atE) => poly(kind, [
  { e: atE - 1, n: -80 }, { e: atE + 1, n: -80 }, { e: atE + 1, n: 80 }, { e: atE - 1, n: 80 },
]);
const world = (...polys) => ({ polys, lines: [], points: [], marks: [], sys: [], chans: [] });

// 7. THE CONTROL CASE. In clear water the turn is the ordinary outboard one, on rung 1,
// and nothing here may change that. Without it, "always turn inboard" would pass every
// other check in this file.
{
  const t = turn(CLEAR, minR, minRSlow);
  check("7. in clear water the turn is the ordinary OUTBOARD one, on the first rung",
        () => t.pts && t.side === "outboard" && t.rung === 1 && !t.slow,
        "rung " + t.rung + ", " + t.side + ", " + t.kind + ", reaching "
          + R_PLAN.east.toFixed(1) + " m east of the line end at -30");
}
// 8-9. THE FIX. A pier standing in the OUTBOARD water - the Pago Pago geometry reduced to
// its bones. The old single attempt refuses and the plan ships a 180 the hull cannot fly;
// the ladder turns AWAY instead.
{
  const PIERWALL = wall("a dock / pier", R_PLAN.east - 1);
  const W = world(PIERWALL);
  const t = turn(W, minR, minRSlow);
  const old = teardropTurn(E, Fp, hE, hF, F, W, BUF, minR, MAXHALF);   // one attempt, as before
  // ⚠ THIS CHECK ASSERTED THE MECHANISM AND THE MECHANISM CHANGED (2026-09-01). It read
  // `t.side === "inboard" && t.rung === 2`, i.e. "the answer is the SAME arc swept the
  // other way, on the second rung". Andy then reported what that shape looks like on the
  // chart - *"the turns are implemented as inverted teardrop turns"* - and the ladder grew
  // a rung above it: a RACETRACK, which needs the hull's own radius of outboard water
  // (2.06 m on a Z-Boat) instead of half the line spacing, and so still turns AWAY from
  // the pier without sweeping back across the survey.
  //
  // What this check exists to defend is not the side and not the rung number. It is that
  // there IS a turn, and that it does not go through the pier - refusing was what put the
  // boat on the wharf. Asserted as those properties now, so the next better shape does not
  // have to fight the test that guards the incident.
  check("8. THE REPORTED CASE: outboard is blocked by the pier, and a turn is still produced",
        () => t.pts && t.pts.length > 2 && t.rung > 1,
        "pier at " + (R_PLAN.east - 1).toFixed(1) + " m east, in the way of a turn that "
          + "reaches " + R_PLAN.east.toFixed(1) + " -> ladder rung " + t.rung + " "
          + t.side + " " + t.kind);
  // ...and the ladder prefers the DIRECT shape to inverting, which is the change itself.
  check("8b. ... and it is the direct racetrack, NOT the inverted loop back over the survey",
        () => t.kind === "racetrack" && t.side === "outboard",
        "got " + t.kind + "/" + t.side + " on rung " + t.rung
          + " (inverting is still available below it, and check 11 proves it is reached)");
  check("9. ... where the old single attempt produced NO TURN at all",
        () => !old.pts && old.why === "nogo" && t.pts && t.pts.length > 2,
        "old: refused (" + old.why + ") -> punchOut shipped a straight 180. new: "
          + t.pts.length + " waypoints, swept the other way");
  const foul = (t.pts || []).filter(p => clearanceM(F.toEN(p), W) < BUF);
  check("9b. ... and every waypoint of the inboard turn is outside the buffer",
        () => t.pts && foul.length === 0,
        (t.pts || []).length + " waypoints, " + foul.length + " inside the " + BUF + " m buffer");
}
// 10. THE SECOND LEVER: slow for a tighter loop. This only reshapes a TEARDROP -- see
// turnWithRetry's note and check 10b -- so the fixture is a teardrop pair: minR 20 m
// against a 13 m half-offset, the branch a tightly-spaced plan actually takes. ONE wall,
// on the outboard side, placed BETWEEN the two measured spans: outside the tight loop and
// inside the wide one, so the only way through it is to slow down.
//
// One wall and not two, because a teardrop loops OUTBOARD ONLY -- both radii start at the
// line ends and never reach west of them -- so there is no inboard extent to discriminate
// on. Walling both sides (this check's previous draft) puts the west wall exactly on the
// line ends and refuses everything, for a reason that has nothing to do with the lever.
{
  const mR = 20, mRs = 14;                      // both > half (13) => teardrop, two sizes
  const RP = reach(mR), RS = reach(mRs);
  const eWall = (RS.east + RP.east) / 2;
  const W = world(wall("a dock / pier", eWall));
  const tSlow = turnWithRetry(E, Fp, hE, hF, F, W, BUF, mR, MAXHALF, mRs);
  const tNoSlow = turnWithRetry(E, Fp, hE, hF, F, W, BUF, mR, MAXHALF, 0);
  check("10. walled outboard, a TIGHTER (slower) loop is tried before giving up",
        () => RP.kind === "teardrop" && RS.kind === "teardrop" && RS.east < RP.east &&
              tSlow.pts && tSlow.slow === true && tSlow.rung > 2 && !tNoSlow.pts,
        "plan-speed " + RP.kind + " reaches " + RP.east.toFixed(1) + " m, slow reaches "
          + RS.east.toFixed(1) + ", wall at " + eWall.toFixed(1)
          + "; with a slow rung: rung " + tSlow.rung + " slow=" + tSlow.slow
          + ", without one: " + (tNoSlow.why || "a turn"));
  // ... and `side` is INERT on a teardrop: its loop side is fixed by which side the next
  // line is on, so rungs 1 and 2 fly the same shape. Pinned so that a future reader does
  // not conclude the inboard rung is what saved this case - the RADIUS is.
  const r1 = teardropTurn(E, Fp, hE, hF, F, W, BUF, mR, MAXHALF);
  const r2 = teardropTurn(E, Fp, hE, hF, F, W, BUF, mR, MAXHALF, "inboard");
  check("10a. ... and it is the RADIUS that saved it: `side` is inert on a teardrop",
        () => !r1.pts && !r2.pts && r1.why === r2.why,
        "outboard and inboard rungs both '" + r1.why + "' at R=" + mR
          + " - the loop side of a teardrop is fixed by which side the next line is on");
}
// 10b. ... AND IT DOES NOTHING ON A SEMICIRCLE, WHICH IS WRITTEN DOWN RATHER THAN HIDDEN.
// Where half the line offset already clears the hull's radius, the turn is a semicircle of
// radius `half` -- set by the SPACING, not the speed -- so the slow rungs fly the identical
// arc. Asserted so that "slow down and it will fit" is never offered as advice on a plan
// where it is false, and so nobody later deletes the rungs believing they always help.
{
  const RP = reach(minR), RS = reach(minRSlow);
  check("10b. ... but a SEMICIRCLE's radius is the line spacing, so slowing cannot reshape it",
        () => RP.kind === "semicircle" && RS.kind === "semicircle" &&
              Math.abs(RP.east - RS.east) < 1e-9,
        "minR " + minR + " and " + minRSlow + " both reach " + RP.east.toFixed(2)
          + " m: widening the spacing is the lever here, not slowing");
}
// 11. WHEN EVERY RUNG FAILS, the reason the operator reads is RUNG 1's - why the turn they
// expected was refused, not why a tighter inboard loop was. Walls tight enough that even
// the slow radius cannot thread them.
{
  const W = world(wall("a dock / pier", R_SLOW.east - 1),
                  wall("the shoreline", R_SLOW.west + 1));
  const t = turn(W, minR, minRSlow);
  const rung1 = teardropTurn(E, Fp, hE, hF, F, W, BUF, minR, MAXHALF);
  check("11. when every rung fails, the reason reported is the FIRST rung's",
        () => !t.pts && !rung1.pts && t.why === rung1.why &&
              JSON.stringify(t.seg) === JSON.stringify(rung1.seg) && t.rung >= 4,
        // ⚠ NOT AN EXACT RUNG COUNT. It was `=== 4`, and adding the racetrack rungs broke
        // it for a reason that has nothing to do with what it tests. The properties are
        // that the ladder kept going (a truncated ladder is the wharf bug returning) and
        // that what it reports is rung ONE's refusal - the turn the operator expected and
        // the feature that actually took it away. How many shapes it tried on the way is
        // an implementation count, and pinning it just makes the test brittle.
        "reported '" + t.why + "' with rung 1's own blocking chord, after " + t.rung + " rungs");
}

// ---- THE CALLER, AND THE RUNTIME GUARD ---------------------------------------------- //
const PO = grab(H, "punchOut");
// 12. THE STRAIGHT LEG IS NO LONGER SHIPPED. This is the line that put the boat on the
// pier: a refused reversal fell through to `legSafe(Ap,Bp)` and pushed an empty transit,
// with a comment admitting it was "a 180 the boat cannot track". It must be UNSAFE now -
// flagged red, blocking Upload - because the console has just established that the water
// for that loop is foul on every side and at every radius it can fly.
check("12. a reversal with no turn on ANY rung is flagged unsafe, not shipped straight",
      () => /if\(reversalRefused\)\{ patTransits\.push\(\[\]\); patUnsafe\.push\(\[Ap,Bp\]\); nUnsafeTurn\+\+; continue; \}/.test(PO) &&
            PO.indexOf("reversalRefused") < PO.indexOf("if(legSafe(Ap,Bp))"),
      "and the guard sits BEFORE the legSafe straight-leg fallback, or it would never run");
// 12b. ...AND THE BANNER SAYS WHICH OF THE TWO FAULTS IT IS. A red leg means either a
// transit blocked by a keep-out or a reversal with no flyable turn, and until 2026-09-08
// the banner called every one of them the first: "the ASV would cross the obstacle on
// those legs". For a refused reversal both halves of that are false — check 12 above
// exists precisely because the straight line between those ends IS clear — and the
// remedies differ: a blocked transit wants the line moved, a refused reversal wants
// spacing, turn speed, or lead. It went unnoticed while refused reversals were rare;
// building the turn from the two poses made the console honest about the water a turn
// really needs, and they are not rare any more.
{
  // ⚠ SCOPED TO THE BRANCH, NOT THE FILE. The comment ABOVE that branch quotes the old
  // sentence in order to explain why it was wrong, so a whole-function indexOf finds the
  // explanation rather than the code and orders them backwards. First cut of this check
  // failed for exactly that reason.
  const body = PO.slice(PO.indexOf("const nUnsafeLeg = nU - nUnsafeTurn;"));
  const iLeg = body.indexOf("nUnsafeLeg?"), iCross = body.indexOf("would cross the obstacle on those legs");
  check("12b. ... and named as its own fault, counted apart from a blocked transit",
        () => /let nUnsafeTurn=0;/.test(PO) && iLeg >= 0
              && /reversal\(s\) have NO FLYABLE TURN/.test(body)
              && /The straight line between those line ends is clear/.test(body)
              && iCross > iLeg,
        "two counts, two sentences — and 'would cross the obstacle' sits INSIDE the "
        + "blocked-transit branch instead of being said about every red leg");
}
check("13. punchOut climbs the ladder rather than making one attempt",
      () => /turnWithRetry\(Ap, Bp, hE, hF, ref, koTurn, buffer, minTurnR, turnMaxHalf, minTurnRSlow\)/.test(PO) &&
            /const minTurnRSlow = minTurnRadiusM\("low"\)/.test(PO),
      "the slow radius is derived from the vessel model beside the plan radius");

const G = grab(H, "clearanceGuard");
// 14. IT COMMANDS NOTHING UNLESS THE BOAT IS UNDER AUTONOMOUS COMMAND. A slow-down sent
// while the operator is driving on RC is the console taking a control it was never given -
// and on this vessel the RC transmitter is master and is the true failsafe.
// ⚠⚠ 14-16 ASSERTED THE PRE-2026-09-02 CONTRACT AND ALL THREE ARE DELIBERATELY DIFFERENT
// NOW. Andy, having watched a DriX trace a station-keeping loop through a pier at Eastport:
// *"A vessel must consider what is ahead of it and modify trajectory or speed or final
// target to ENSURE nogo areas are never entered"*, and then, asked directly, *"console
// should take the helm in extremis."*
//
// What changed, and why each was not merely a rename:
//
//   14  THE GATE WAS THE BUG. `run === "running" && !holding` refuses to act on a boat
//       STATION-KEEPING at the end of a run - which is exactly the boat in the photograph.
//       The gate is now the console's actual authority: armed, not e-stopped.
//   15  The release margin was a DISTANCE (1.5x the buffer). It is now the counterfactual:
//       would the speed we are about to restore put the keep-out back inside the horizon?
//       Same predicate, asked of the state being proposed. See the note in the guard.
//   16  "IT NEVER STEERS" IS NO LONGER TRUE, ON INSTRUCTION - but only at the last rung,
//       and only when stopping provably would not answer. 16b is the guard that keeps that
//       narrow.
check("14. the guard acts whenever the console HAS authority — armed and not e-stopped — " +
      "and not only while a plan is running",
      () => /const act = !!\(S && S\.armed && !S\.estop\)/.test(G)
            && !/run === "running"/.test(G) && !/st\.holding/.test(G),
      "the old gate excluded a station-keeping boat, which is the case that was reported");
check("15. the release is the COUNTERFACTUAL, not a distance margin — it asks whether the " +
      "speed being restored would trigger it again",
      // ⚠ THE RULE ITSELF LIVES IN guard.js AND IS TESTED THERE (in_extremis 11b/11c). This
      // half only pins the WIRING, because a source check cannot see reachability: the first
      // version matched `guardAssess(p, velBack, drift` and a mutation that made the branch
      // dead with `if(false)` left that text in place and survived.
      () => /restoreVel\(vel, drift, back\)/.test(G) && /guardAssess\(p, velBack/.test(G)
            && !/c\.m > buf \* 1\.5/.test(G),
      "slowing changes the very quantity being tested, so releasing on it oscillates");
check("16. it steers ONLY at the helm rung, and NOT as a Go-To",
      () => /a\.level === "helm"/.test(G) && /cmd\("\/api\/cmd\/escape"/.test(G)
            && !/cmd\("\/api\/cmd\/goto"/.test(G)
            && G.indexOf('cmd("/api/cmd/escape"') > G.indexOf('a.level === "helm"'),
      "a Go-To-shaped escape used to arrive, hold, and re-chain the end-of-plan RTH " +
      "straight back toward the hazard it had just been steered clear of - see " +
      "tests/end_action.js 5b/16b");
// ⚠ 16b IS THE ONE THAT KEEPS THE REVERSAL NARROW. Steering is authorised in extremis, not
// generally. The helm rung is unreachable unless the DRIFT-ONLY track also enters, which is
// the test that says stopping would not answer - and that test lives in guard.js, so this
// check pins that the guard does not reach for the helm on its own account.
check("16b. ... and the helm rung is unreachable unless STOPPING would not answer",
      () => {
        const A = require("../static/js/guard.js");
        const wall = (n0) => { const r = [{e:-400,n:n0},{e:400,n:n0},{e:400,n:n0+300},{e:-400,n:n0+300}];
          return {polys:[{ring:r, bb:bbOf(r), kind:"a dock / pier"}], lines:[], points:[],
                  marks:[], sys:[], chans:[]}; };
        const W = wall(30), P = {e:0,n:0};
        const inShore = A.groundVel(0, 6);
        const setOff  = {e:0, n:-1.03};        // the stream carries us AWAY
        const setOn   = {e:0, n:+1.03};        // the stream carries us ON
        return A.assess(P, inShore, setOff, W, 5).level === "hold"
            && A.assess(P, inShore, setOn,  W, 5).level === "helm"
            && A.assess(P, {e:0,n:1.03}, setOn, W, 5).level === "helm";
      },
      "same approach, same speed: the tide decides whether stopping is an answer — and a " +
      "STOPPED boat being set on is the case that proves it");
// 17. And it is actually WIRED - a guard nothing calls is worse than none, because the
// card would still show a clearance while nothing acted on it.
check("17. the guard runs on every telemetry frame, before the readouts are drawn",
      // \r? because this file is CRLF: a literal \n here can never follow the \r that
      // actually sits between the two statements on disk.
      // updateActiveLine() used to sit between these two and was removed on 2026-09-07 with
      // the nearest-line highlight; accumLineTime is what the ordering was ever about, since
      // it is what maintains runLineIdx for everything drawn after it.
      () => /clearanceGuard\(\);\r?\n\s*accumLineTime\(\)/.test(H),
      "in onState, ahead of renderIntent so the card describes the frame it acted on");

// 18. AND THE NUMBER REACHES THE OPERATOR. Found by mutation: every check above passed
// with the Intent card's clearance row deleted, which would have shipped a guard acting on
// a quantity nobody can see. The row must be fed by the guard's OWN value - one that
// recomputed it could disagree with the thing that commanded the slow-down - and it must
// be drawn whenever the model is loaded, not only when it is tight: a number watched in
// open water is how an operator learns what normal looks like there.
{
  const RI = grab(H, "renderIntent");
  check("18. the Intent card shows the clearance, fed by the guard's own value",
        () => /row\("clearance"/.test(RI) && /clearance\.m != null/.test(RI) &&
              /clearance\.m\.toFixed\(1\)/.test(RI) && !/clearanceM\(/.test(RI),
        "gated on the model being loaded, not on the clearance being tight - and it reads "
          + "`clearance`, it does not call clearanceM a second time");
  check("18b. ... and it names the feature, and says when it is closing or has slowed",
        () => /clearance\.kind/.test(RI) && /clearance\.closing/.test(RI) &&
              /clearance\.slowed/.test(RI),
        "\"4.2 m to a dock / pier · CLOSING · SLOWED\" - the state, not just the number");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
