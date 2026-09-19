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
//   * A reversal with no turn left on any rung is UNSAFE and is not shipped: it is recorded
//     red, and Add to plan refuses the pattern while it stands (tests/turn_refusal.js).
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
//   page: the refused reversal not recorded red (2026-09-16) -> 12 (and turn_refusal)
//   page: ... recorded as a hop                              -> 12 (and turn_refusal)
//   page: the red banner drops the refusal                   -> 12b (and turn_refusal 13)
//   page: the hop banner back to "would cross the obstacle"  -> 12b (and turn_refusal 7b)
//   page: slow-down with no autonomy gate                    -> 14
//   page: hand the speed back at the buffer edge             -> 15
//   page: the guard also commands a HEADING                  -> 16
//   page: the guard is never called from the tick            -> 17
//   page: the clearance row never reaches the Intent card    -> 18
//
// TEETH, 2026-09-19 - THE HELM RUNG'S DWELL AND ITS BANNER (Andy: *"no dwell... and a cause
// the banner asserts that the code hasn't established"*). Five mutations landing here, run
// against a sidecar page with every guard suite re-run; nothing survived:
//   the dwell unwired from the action                       -> 15r, 15t
//   helmSettled always true                                 -> 15r, 15t
//   the dwell ACCUMULATES instead of restarting             -> 15t
//   the dwell moved so it gags the ALARM as well            -> 15r
//   the banner asserting a set again                        -> 16c
//   firstOfEpisode reverted to `escalated`                  -> 15u
//   firstOfEpisode always true (re-solve throttle gone)     -> 15v
//   the first-action clause dropped (throttle only)         -> 15u
//
// TEETH, 2026-09-19 - THE BLIND READOUT (stage 0 of the departure work). Seven mutations,
// all four guard suites plus frame_health, off_track, end_action and page_strict re-run for
// each; nothing survived:
//   blind substituted back to clear (the defect itself)    -> 15w, 15y, 15z
//   blind counted as clear for the release dwell           -> 15e
//   blind ranked as an escalation rather than level        -> 15z
//   the blind bar removed                                  -> 15z2
//   the blind bar stops naming the state                   -> 15z2
//   the blind bar still offers PROCEED                     -> 15z2
//   the 8 s banner un-gated for blind                      -> 15z
//
// ⚠⚠ AND THREE OF THOSE FIRST SCORED AS *SURVIVED* BECAUSE THE MUTATION RUNNER COULD NOT
// READ ITS OWN OUTPUT. Its id pattern was `[0-9]+[a-z]*\.`, which parses "15z2." as "15z"
// followed by junk and matches nothing - so a real FAIL on check 15z2 was reported as a
// surviving mutation, three times, and each looked like a coverage gap in this file. The
// pattern must allow digits AFTER the letters. A runner that misreads a FAIL as a pass is
// a broken instrument, not a weak check, and it fails in the direction that costs you.
//
// ⚠ AND 15z2's FIRST DRAFT BUILT ITS BUTTON TEST AS A CONSTRUCTED RegExp, lost the
// backslashes in the concatenation, and so tested `$("#gb_low")...` with `$` meaning
// end-of-string. It could never match. A literal is compared with indexOf.
// Five more are on guard.js's side of the same change and red in tests/in_extremis.js 5,
// 5c, 6 and 6b.
//
// ⚠ AND THREE LATENT HARNESS BUGS CAME OUT OF WIRING THOSE. `guardEscapeAt` was never
// reset between scenarios, so the SECOND scenario to reach the helm had its escape silently
// throttled - invisible while every fixture escaped on its first frame, which is exactly why
// it survived until a dwell made a second frame necessary. `runRoute` likewise persisted, so
// a frame steaming directly AWAY from the wall was judged along a stale route and read
// `hold`. And 16c's first draft matched the page's own COMMENT recording the old wording and
// reported the defect as still present; it strips comments now.
//
// THE LAST ONE SURVIVED THE FIRST PASS and is why 18 exists: every check here passed with
// the operator-facing half of the feature deleted. A guard acting on a quantity nobody can
// see is most of the way back to the defect it was written for.
//
// NOTE: this suite evaluates page code SLOPPY - a direct eval, so the page's function declarations bind into this
// file. The page itself is <script type="module">, which runs STRICT: an assignment to an undeclared name passes
// here and throws in the page. tests/page_strict.js parses the page and its modules as strict modules; that runtime
// difference is not checked anywhere.

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

// ⚠ SOURCE CHECKS READ CODE, NOT COMMENTS, AND TWO OF THEM LEARNED THAT THE HARD WAY.
// A check that counts `releaseSettled(` call sites, or greps for wording that was REMOVED,
// matches the note in the page that records the very thing it is looking for - so 15e went
// red for a comment that mentioned the call, and 16c reported a defect as still present
// when only its obituary was. Strip first, then match.
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
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
  // ⚠ THE NAME READ "the inboard turn" UNTIL 2026-09-19, AND `t` HAS NOT BEEN INBOARD
  // SINCE 2026-09-01 - it is the racetrack check 8b just pinned. Harmless while an inboard
  // turn was still something the ladder could return; misleading now that turnJoinable
  // refuses every one of them (tests/turn_geometry.js 50-57).
  check("9b. ... and every waypoint of that turn is outside the buffer",
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
// flagged red - because the console has just established that the water for that loop is
// foul on every side and at every radius it can fly.
// ⚠ AND THIS COMMENT USED TO SAY "blocking Upload", which was never true: the red was only
// drawn, commitPattern cleared it, and Upload found the straight leg clear (found 2026-09-16).
// The pair is recorded in patRed now, and Add to plan refuses while it stands - driven end to
// end in tests/turn_refusal.js; this check pins the statement that records it.
check("12. a reversal with no turn on ANY rung is flagged unsafe, not shipped straight",
      () => /if\(reversalRefused\)\{ patTransits\.push\(\[\]\); patUnsafe\.push\(\[Ap,Bp\]\); nUnsafeTurn\+\+;\s*patRed\.push\(\{run:k\+1, turn:true, why:refusedWhy, by:refusedBy, a:Ap, b:Bp\}\); continue; \}/.test(PO) &&
            PO.indexOf("reversalRefused") < PO.indexOf("if(legSafe(Ap,Bp))"),
      "recorded as a red REVERSAL, and the guard sits BEFORE the legSafe straight-leg fallback, or it would never run");
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
  // ⚠ AND BOTH OLD SENTENCES ARE GONE (2026-09-16). "Would cross the obstacle" is false for a
  // red hop too - Upload routes every hop again, or refuses the upload - and "the straight
  // line between those line ends is clear" was not always true: on Andy's Honolulu plan one
  // of the 18 straight legs got a detour at Upload. The refused reversal is said in
  // punchRefusal's words (tests/turn_refusal.js), the hop in its own sentence.
  const iBranch = PO.indexOf("const hopBlocks = patRed.filter(r=>!r.turn && r.block)");
  const body = iBranch < 0 ? "" : PO.slice(iBranch, PO.indexOf("else if(nNoTurn)", iBranch));
  check("12b. ... and named as its own fault, counted apart from a red hop - and neither sentence says the boat "
        + "would cross anything",
        () => /let nUnsafeTurn=0;/.test(PO) && /const nUnsafeLeg = nU - nUnsafeTurn;/.test(PO)
              && /\(nUnsafeTurn && refusal\?`\$\{refusal\.text\} `:``\)/.test(body)
              && /\(nUnsafeLeg\?`\$\{nUnsafeLeg\} hop\(s\) between runs are blocked by \$\{kindsSummary\(hopBlocks\)\}/.test(body)
              && !/would cross/.test(body) && !/straight line between those line ends is clear/.test(body),
        // A STRING: this suite's check() prints a function detail as its source rather than calling it.
        "two counts, two sentences: the refusal's text for the reversals, the hop sentence for the rest ("
        + body.length + " chars of branch read)");
}
check("13. punchOut climbs the ladder rather than making one attempt",
      () => /turnWithRetry\(Ap, Bp, hE, hF, ref, koTurn, buffer, minTurnR, turnMaxHalf, minTurnRSlow, easeLs, fly\)/.test(PO) &&
            /const minTurnRSlow = minTurnRadiusM\("low"\)/.test(PO) &&
            /const easeLs = easeLsM\(\);/.test(PO) &&
            /const fly = \{spdKey: roleSpeed\("turn"\), approachM: Math\.max\(0\.5, \+\(mission\.approach_radius_m\) \|\| 1\)\};/.test(PO),
      "the slow radius, the eased spiral length AND the hull that has to fly the shape are "
      + "all derived from the vessel model beside the plan radius — easeLs is 0 unless the "
      + "operator asked and the hull can, and `fly` carries the APPROACH RADIUS, which has to "
      + "be the identical expression guardTrack uses or the punch and the runtime guard are "
      + "judging different boats (2026-09-10)");

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
// ── 15b-15d. THE RELEASE IS DAMPED, AND THE DAMPING IS DRIVEN ─────────────────────────
// Andy's log, 2026-09-10, in the 35 s before a survey was stopped: 36 speed commands,
// alternating low / survey about once a second. The counterfactual above is the correctness
// test - "would the speed I am about to restore trigger it again?" - and it was not enough,
// because on that plan the question ITSELF was unstable: the route had waypoints 0.20 m
// apart, far finer than the approach radius projectRoute advances on, so 2.80 kn read `slow`
// and 2.99 kn read `clear` from the same position. The root is fixed upstream (turns.js
// thinTrack); this is the damping that should have been here anyway.
{
  const decl = H.slice(H.indexOf("const RELEASE_HOLD_MS"), H.indexOf("const RELEASE_HOLD_MS") + 120);
  const HOLD = +(decl.match(/RELEASE_HOLD_MS = (\d+)/) || [])[1];
  // eslint-disable-next-line no-eval
  const NL = String.fromCharCode(10);
  const drive = eval("(function(){ let clearHoldAt = 0; const RELEASE_HOLD_MS = " + HOLD + ";" + NL
                     + grab(H, "releaseSettled") + NL + " return releaseSettled; })()");
  let t = 1000;
  const steps = [];
  for (let i = 0; i < 12; i++) { t += 500; steps.push(drive(true, t)); }
  const firstTrue = steps.indexOf(true);
  check("15b. one frame of clear water does not hand the throttle back",
        HOLD >= 2000 && firstTrue > 0 && (firstTrue + 1) * 500 >= HOLD,
        "clear water every 500 ms: the release comes on frame " + (firstTrue + 1) + " at "
        + ((firstTrue + 1) * 500) + " ms, against a " + HOLD + " ms dwell. The ladder still "
        + "SLOWS on the frame it sees the trouble - fast to protect, slow to release");

  // The oscillation itself: clear, not clear, clear, ... must never release.
  let t2 = 1000, released = 0;
  for (let i = 0; i < 40; i++) { t2 += 1000; if (drive(i % 2 === 0, t2)) released++; }
  check("15c. ... and an alternating reading never releases at all",
        released === 0,
        "40 s of clear/not-clear at 1 Hz - the exact cadence recorded in his log - released "
        + released + " time(s). A single frame's opinion is what put 36 throttle commands "
        + "into 35 seconds");

  // And it is a DWELL, not a deadline: the clock restarts every time the water goes bad.
  let t3 = 1000;
  drive(true, t3); t3 += 3000; drive(true, t3);          // 3 s of clear, nearly there
  drive(false, t3);                                       // one bad frame
  t3 += 3000;
  check("15d. ... and one bad frame restarts the dwell rather than shortening it",
        drive(true, t3) === false,
        "3 s clear, one frame not clear, 3 s clear again -> still held. A dwell that only "
        + "counted total clear frames would be released by exactly the pattern it exists for");
}

// 15e. AND THE DWELL IS EVALUATED ONCE, UNCONDITIONALLY, ABOVE THE BRANCH. Written as a
// reset on the not-clear path it is a line anybody can delete with no check reddening -
// which it was, and a mutation sweep proved it: removing the reset let a dwell banked
// before a slow episode release the throttle on the first clear frame after it. Placed
// here the property holds by construction: the only way the dwell advances is for THIS
// frame to have read clear.
check("15e. the dwell is asked once a frame, above the branch, so no path can skip it",
      () => { const Gs = codeOnly(G);
        return (Gs.match(/releaseSettled\(/g) || []).length === 1
            && Gs.indexOf("releaseSettled(") < Gs.indexOf('if(a.level === "clear")')
            && /const clearRun = releaseSettled\(a\.level === "clear", Date\.now\(\)\);/.test(Gs)
            && /release = release && clearRun;/.test(Gs); },
      (codeOnly(G).match(/releaseSettled\(/g) || []).length + " call site(s) in CODE, "
      + ((codeOnly(G).indexOf("releaseSettled(") < codeOnly(G).indexOf('if(a.level === "clear")')) ? "above" : "BELOW")
      + " the clear branch. Two call sites, or one inside a branch, and the reset is "
      + "something a path has to remember rather than something it cannot avoid");

// ── 15f-15h. A DEVIATION CANNOT ANSWER A TURN, SO THE LADDER ASKS THE RUNG THAT CAN ────
//
// Andy, 2026-09-10: *"The deviation rung can't answer a turn. Re-generating the reversal
// tighter or further inboard is a real amendment; moving one arc vertex is not."* His log
// proves the diagnosis - not one /api/cmd/amend all session, with the whole deviation budget
// unspent, because edgeAround may move a CORNER and a reversal is a run of vertices a metre
// apart. But the answer to a turn was never a deviation: a turn's trouble is TRACKING, and
// the lever on tracking is SPEED. On his own plan, from where the guard stopped her:
//
//     3.0 kn (survey):  hold    "entry in 14 s under way"
//     1.5 kn (low):     clear   "nothing within 45 s on the route ahead"
//
// So before the ladder takes the way off it asks whether going slower answers it - the same
// shape as the release counterfactual, asked of the state being proposed.
//
// ⚠ DRIVEN, on tests/in_extremis.js's pier. A source check could not tell a rung that fires
// from one that is unreachable, and this rung's whole value is that it fires INSTEAD of the
// hold.
{
  const G4 = require("../static/js/guard.js");
  const V = { SPEED_KN: { low: 1.5, survey: 6.0, high: 12.0 }, MAX_TURN_RATE_DEG_S: 60 };
  let clearance = { m: 25, kind: "a dock / pier", slowed: false, prev: null, info: null };
  let guardLevel = "clear", clearAlarmAt = 0, guardActedAt = 0, guardEscapeAt = 0;
  let guardEdgeAt = 0, edgeSpentM = 1e9, edgeCount = 0, guardOverride = null, guardHeld = null;
  let clearHoldAt = 0, commandedSpeed = null, resumeSlow = false, slowLieu = null;
  let helmHoldAt = 0;
  const RELEASE_HOLD_MS = +(H.match(/RELEASE_HOLD_MS = (\d+)/) || [])[1];
  const SLOW_ANSWER_MS = +(H.match(/const SLOW_ANSWER_MS = (\d+)/) || [])[1];
  // READ FROM THE PAGE, NOT RETYPED — a dwell this suite believes is 1.5 s while the page
  // uses some other number is a suite testing a console that does not exist.
  const HELM_DWELL_MS = +(H.match(/const HELM_DWELL_MS = (\d+)/) || [])[1];
  let planIntent = { why: [] }, sent = [], notes = [];
  const guardAssess = G4.assess, groundVel = G4.groundVel, restoreVel = G4.restoreVel;
  const edgeCapM = G4.edgeCapM, edgeText = G4.edgeText, GUARD_HORIZON_S = G4.HORIZON_S;
  const escapeCourse = () => null;
  const cmd = (p2, b2) => { sent.push(p2 + (b2 && b2.speed ? ":" + b2.speed : "")); };
  const flashNote = (m) => notes.push(m);
  let banners = [];
  const showBanner = (m) => banners.push(m), setViolations = () => {}, renderGuardBar = () => {};
  const updateMissionCard = () => {}, render = () => {}, holdClearAt = () => 12;
  const markGuardHeld = () => {}, guardHeldOffer = () => null, guardOverrideOk = () => false;
  let roleKey = "survey", speedWant = null;          // 15p switches the CONFIGURED role speed
  const roleSpeed = () => roleKey, speedRole = () => "survey";
  const ref = planeFrame({ lat: 43.07, lon: -70.76 });
  const wall = (n0) => { const r = [{ e: -400, n: n0 }, { e: 400, n: n0 },
                                    { e: 400, n: n0 + 300 }, { e: -400, n: n0 + 300 }];
    return { polys: [{ ring: r, bb: bbOf(r), kind: "a dock / pier" }],
             lines: [], points: [], marks: [], sys: [], chans: [] }; };
  let nogo = { ready: true, frame: ref, ko: wall(30), buffer: 5 };
  let asv = null, S = null, runRoute = null;
  const mission = { approach_radius_m: 2 };
  const EDGE_REASSESS_MS = 2000, GUARD_REASSESS_MS = 6000;
  const edgeCapM2 = edgeCapM;
  const updateClearance = () => clearance;
  // review #14: the ladder ACTS only in the supervising tab, and this world is that tab. A view-only one is
  // tests/supervisor_page.js's subject: it assesses, draws and alarms, and commands nothing.
  const supervising = () => true;
  // eslint-disable-next-line no-eval
  const NL2 = String.fromCharCode(10);
  // ⚠ EVERY PAGE FUNCTION clearanceGuard CALLS HAS TO BE PULLED IN HERE, and a new one is
  // easy to forget: `helmSettled` (the in-extremis dwell, 2026-09-19) crashed this whole
  // suite with a bare ReferenceError until it was added, which the crash guard above reports
  // as one failed check rather than as silence.
  const guard = eval("(function(){ " + grab(H, "guardTrack") + NL2 + grab(H, "releaseSettled") + NL2
                     + grab(H, "helmSettled") + NL2
                     + grab(H, "commandSpeed") + NL2
                     + grab(H, "clearanceGuard").replace(/^function /, "return function ")
                     .replace("return function clearanceGuard", "const clearanceGuard = function")
                     + "; return clearanceGuard; })()");
  const runFrame = (sogKn, slowed) => {
    const NM = 111320;
    asv = { lat: ref.lat, lon: ref.lon };
    runRoute = [{ lat: ref.lat + 60 / NM, lon: ref.lon }, { lat: ref.lat + 120 / NM, lon: ref.lon }];
    S = { armed: true, estop: false, run: "running", behavior: "survey",
          status: { cog_deg: 0, sog_kn: sogKn, heading_deg: 0, env_set_deg: 0, env_set_kn: 0,
                    holding: false, drifting: false } };
    globalThis.window = globalThis; window._wpIndex = 0;
    clearance = { m: 25, kind: "a dock / pier", slowed, prev: null, info: null };
    guardLevel = "clear"; clearHoldAt = 0; sent = []; notes = []; planIntent = { why: [] };
    guard();
    return { sent: sent.slice(), notes: notes.slice(), why: planIntent.why.slice(), level: clearance.level };
  };
  const fast = runFrame(6.0, false);
  const already = runFrame(6.0, true);
  check("15f. standing at the pier, the ladder SLOWS instead of stopping when low would clear",
        fast.level === "hold" && fast.sent.includes("/api/cmd/speed:low")
        && !fast.sent.includes("/api/cmd/hold"),
        "the rung reads " + fast.level + " at 6 kn and the guard sent " + JSON.stringify(fast.sent)
        + ". A hold destroys the run and hands a stopped hull to the tide; slowing costs a few "
        + "metres of way, and 15k-15n hold her if it is not taken or stops answering");
  check("15g. ... and says WHY, on the note and on the Intent card",
        /SLOWED to low rather than stopping/.test(fast.notes.join(" "))
        && fast.why.some((w) => /SLOWED instead of holding/.test(w.s)),
        "\"" + (fast.notes[0] || "") + "\"");
  // ⚠ AND THE ANSWER HAS TO BE ONE SLOWING ACTUALLY GIVES. Two ways it does not, and both
  // must still stop the boat: the pier close enough that low speed is inside the hold time
  // as well, and a set carrying her on regardless - where stopping is not the answer either
  // and the helm rung is the one that is.
  const runAt = (n0, sogKn, setKn) => {
    nogo = { ready: true, frame: ref, ko: wall(n0), buffer: 5 };
    const NM = 111320;
    asv = { lat: ref.lat, lon: ref.lon };
    runRoute = [{ lat: ref.lat + 60 / NM, lon: ref.lon }, { lat: ref.lat + 120 / NM, lon: ref.lon }];
    S = { armed: true, estop: false, run: "running", behavior: "survey",
          status: { cog_deg: 0, sog_kn: sogKn, heading_deg: 0, env_set_deg: 0,
                    env_set_kn: setKn, holding: false, drifting: false } };
    globalThis.window = globalThis; window._wpIndex = 0;
    clearance = { m: n0 - 5, kind: "a dock / pier", slowed: false, prev: null, info: null };
    guardLevel = "clear"; clearHoldAt = 0; sent = []; notes = []; planIntent = { why: [] };
    guard();
    return { sent: sent.slice(), level: clearance.level };
  };
  const tooClose = runAt(18, 6.0, 0);
  // ⚠ 18 m, NOT 30 (2026-09-19). At 30 m a 2 kn set is no longer in extremis: stopping
  // postpones contact by 27 s, which is longer than a decision needs, so the ladder holds and
  // escalates instead. The rung this check is about starts at 18 m on the same set - see
  // tests/in_extremis.js 5 and 5b, which pin both sides of that boundary.
  const beingSet = runAt(18, 6.0, 2.0);
  check("15i. ... and never when slowing would NOT answer it - then it still stops",
        tooClose.sent.includes("/api/cmd/hold") && !tooClose.sent.includes("/api/cmd/speed:low"),
        "pier 18 m off: at 1.5 kn the entry is still inside the hold time, so low is not an "
        + "answer and the guard sent " + JSON.stringify(tooClose.sent) + ". A rung that slowed "
        + "here would leave the boat standing on, more slowly, into the same feature");
  check("15j. ... nor in extremis, where stopping is not the answer either",
        beingSet.level === "helm" && !beingSet.sent.includes("/api/cmd/speed:low"),
        "with a 2 kn set onto the pier the rung reads " + beingSet.level + " and the guard sent "
        + JSON.stringify(beingSet.sent) + ". The drift-only track enters too, so taking way off "
        + "- fast or slow - hands her to the tide; that is the helm's case, not this one");
  nogo = { ready: true, frame: ref, ko: wall(30), buffer: 5 };

  check("15h. ... but NOT when she is already slow - then low IS the state being assessed",
        already.sent.includes("/api/cmd/hold") && !already.sent.includes("/api/cmd/speed:low"),
        "already slowed -> " + JSON.stringify(already.sent) + ". Offering the answer that has "
        + "already been tried would leave the boat standing on at low speed with the ladder "
        + "believing it had acted");

  // ── 15k-15n. ...AND THE SLOW-DOWN HAS TO BE TAKEN, AND KEEP ANSWERING, OR SHE IS HELD ─────
  //
  // Review #2, 2026-09-14. Every check above runs ONE frame from a fresh guard, and the defect
  // was on the SECOND: the rung spends the escalation, so a boat that did not actually slow - a
  // speed command refused or lost - read `hold` on every later frame, never escalated, and was
  // never held ("low" at 30 m, then NOTHING from 30 m to 10 m at 6 kn). Driven here over
  // CONSECUTIVE frames with guardLevel and `slowed` carried and the clock stepped - the
  // transient a single-statement fixture never contains.
  //
  // TEETH, sidecar ASV_HTML, 8 mutations, 8 killed (numbers are the checks that went red):
  //   the in-lieu check removed                           -> 15k, 15m, 15n
  //   the slow-down always counted as taken               -> 15k, 15n
  //   the vessel's speed_key ignored, SOG only            -> 15o (SURVIVED until 15o was added:
  //                                                          in every other fixture key and SOG agree)
  //   slowing always counted as still answering           -> 15m
  //   slowLieu never recorded when the rung fires         -> 15k, 15m, 15n
  //   no deadline: hold on the first untaken frame        -> 15k
  //   the deadline fires whether or not it was taken      -> 15l, 15n
  //   the speed-over-ground fallback loses its 0.2 kn     -> 15n
  const realNow = Date.now;
  const T0 = 5e9;             // far from zero, or `settling` (now - guardEdgeAt < 2 s) gates the rung
  let clock = T0;
  Date.now = () => clock;
  const step = (ms, n0, sogKn, key, cogArg) => {
    clock = T0 + ms;
    nogo = { ready: true, frame: ref, ko: wall(n0), buffer: 5 };
    const NM = 111320;
    asv = { lat: ref.lat, lon: ref.lon };
    runRoute = [{ lat: ref.lat + 60 / NM, lon: ref.lon }, { lat: ref.lat + 120 / NM, lon: ref.lon }];
    // ⚠ `cog` NULL IS THE BLIND CASE, and it is what a STOPPED vessel reports. Passing
    // null here is how 15w-15y drive it; every existing caller omits the argument and gets 0.
    const status = { cog_deg: (cogArg === undefined ? 0 : cogArg), sog_kn: sogKn,
                     heading_deg: 0, env_set_deg: 0, env_set_kn: 0,
                     holding: false, drifting: false };
    if (key !== undefined) status.speed_key = key;
    S = { armed: true, estop: false, run: "running", behavior: "survey", status };
    globalThis.window = globalThis; window._wpIndex = 0;
    clearance = { m: n0 - 5, kind: "a dock / pier", slowed: clearance.slowed, prev: null, info: null };
    sent = []; notes = [];
    guard();
    return { sent: sent.slice(), notes: notes.slice(), level: clearance.level };
  };
  const fresh = () => { guardLevel = "clear"; clearance = { ...clearance, slowed: false };
    slowLieu = null; clearHoldAt = 0; clearAlarmAt = 0; planIntent = { why: [] };
    // ⚠ THE HELM DWELL RESETS WITH EVERYTHING ELSE (2026-09-19). Left armed, one
    // scenario's in-extremis frame would let the NEXT scenario's first frame steer the boat,
    // and the check that noticed would be an unrelated one three fixtures later.
    // ⚠ AND SO DOES guardEscapeAt, WHICH WAS ALREADY A LATENT BUG IN THIS HARNESS. It
    // throttles the escape to one per GUARD_REASSESS_MS; carried between scenarios it
    // silently suppressed the SECOND scenario's escape entirely. Invisible while every
    // fixture escaped on its first frame, which is exactly how it survived until the dwell
    // made a second frame necessary.
    helmHoldAt = 0; guardEscapeAt = 0; };
  const held = (r) => r.sent.includes("/api/cmd/hold");
  try {
    // A. the speed command never lands: the vessel keeps reporting survey, and keeps making 6 kn
    fresh();
    const a1 = step(0, 30, 6.0, "survey"), a2 = step(250, 29.5, 6.0, "survey");
    const a3 = step(2500, 25.5, 6.0, "survey");
    // 15w-15y. BLIND IS NOT CLEAR (2026-09-19, stage 0 of the departure work). `groundVel`
    // returns null for a null course, which is exactly what a STOPPED vessel reports, and
    // clearanceGuard substituted `{level:"clear"}` for it. The bar keys on `level === "clear"`,
    // so it went out, and the console showed the same nothing it shows in genuinely clear
    // water - at the one moment it could not see. A boat alongside a pier is in that state.
    fresh();
    const blind1 = step(0, 30, 0, "survey", null);
    check("15w. a frame with no course over the ground reads BLIND, not clear",
          blind1.level === "blind",
          "cog_deg null -> level '" + blind1.level + "'. `clear` there is the console telling "
          + "the operator the water ahead is clear on a frame where it projected nothing");
    check("15x. ... and it commands nothing, because nothing was measured",
          blind1.sent.length === 0,
          "sent " + JSON.stringify(blind1.sent) + " - there is no rung to act on and no "
          + "measurement to act from");
    // ⚠ 15y IS THE ONE THAT MATTERED MORE THAN THE READOUT. `releaseSettled` counted those
    // substituted `clear` frames, so a boat the guard had SLOWED and which then lost her
    // course had the throttle handed back after RELEASE_HOLD_MS of blindness, on the strength
    // of frames that had measured nothing at all.
    fresh();
    const s1 = step(0, 30, 6.0, "survey");                       // slowed by the guard
    const b1 = step(500, 30, 0, "low", null);                    // ...then blind
    const b2 = step(RELEASE_HOLD_MS + 1500, 30, 0, "low", null); // ...still blind, past the dwell
    check("15y. ... and a blind frame does not advance the release dwell: the throttle stays where it was",
          s1.sent.includes("/api/cmd/speed:low")
          && b1.level === "blind" && b2.level === "blind"
          && !b2.notes.join(" ").includes("Clear ahead again"),
          "slowed (" + JSON.stringify(s1.sent) + "), then blind for "
          + (RELEASE_HOLD_MS + 1500) + " ms: hand-back said "
          + (b2.notes.join(" ").includes("Clear ahead again") ? "YES - on frames that measured nothing"
                                                             : "nothing") );
    // 15z. BLIND IS A STATE, NOT AN EVENT, AND THE BAR IS WHERE IT BELONGS. A boat lying
    // stopped reports no course for as long as she lies there, so an 8-second banner would
    // repeat for the whole time she is alongside and teach the operator to ignore the banner
    // that matters. It must also never read as an ESCALATION - it is the absence of a
    // judgement, not a rung above one.
    fresh(); banners = [];
    const bz = step(0, 30, 0, "survey", null);
    const bz2 = step(9000, 30, 0, "survey", null);          // well past the 8 s re-say
    check("15z. blind never raises the 8 s banner, and never ranks as an escalation",
          bz.level === "blind" && bz2.level === "blind"
          && banners.filter((b) => /BLIND/i.test(b)).length === 0
          && /const RUNG = \{blind:0, clear:0,/.test(codeOnly(G)),
          "two blind frames " + (9000) + " ms apart raised "
          + banners.filter((b) => /BLIND/i.test(b)).length + " banner(s); RUNG ranks blind "
          + ((/const RUNG = \{blind:0,/.test(codeOnly(G))) ? "level with clear" : "ELSEWHERE")
          + ". The bar carries it instead - persistent, in view and silent");
    // 15z2. ...AND THE BAR ACTUALLY CARRIES IT. renderGuardBar is stubbed in this world, so
    // this is a source check: without it, deleting the blind branch puts the console back to
    // showing nothing at all and every behavioural check here stays green.
    check("15z2. ... and renderGuardBar has a BLIND state that is shown, not hidden",
          () => {
            const R = codeOnly(grab(H, "renderGuardBar"));
            const i = R.indexOf('a.level === "blind"');
            if (i < 0) return false;
            const branch = R.slice(i, i + 1400);
            // shown, named, and offering NOTHING: there is no rung to proceed past and
            // nothing to hand back, so PROCEED against a measurement that was never taken
            // is the worst button on the page.
            // ⚠ indexOf, NOT a constructed RegExp: the first cut built one by string
            // concatenation and lost its backslashes, so it tested `$("#gb_low")...` as a
            // REGEX - `$` as end-of-string - and could never match. A literal is a literal.
            const hides = (id) => branch.indexOf('$("#' + id + '").style.display = "none"') >= 0;
            return /bar\.style\.display = "block"/.test(branch)
                   && /GUARD BLIND/.test(branch)
                   && !/bar\.style\.display = "none"/.test(branch)
                   && hides("gb_low") && hides("gb_proceed")
                   && hides("gb_cancel") && hides("gb_drop");
          },
          "the blind branch shows the bar, names the state, and hides all four buttons. "
          + "Before stage 0 the bar keyed "
          + "on `level === \"clear\"` and simply went out, which is the same nothing it shows "
          + "in genuinely clear water");
    fresh();
    fresh();
    check("15k. THE REPORTED DEFECT: a slow-down that is never TAKEN is followed by the hold",
          a1.sent.includes("/api/cmd/speed:low") && !held(a1) && !held(a2) && held(a3)
          && /was not taken within/.test(a3.notes.join(" ")),
          "30 m " + JSON.stringify(a1.sent) + " -> 29.5 m at 250 ms " + JSON.stringify(a2.sent)
          + " -> 25.5 m at 2.5 s, still 6 kn and speed_key survey: " + JSON.stringify(a3.sent)
          + ". Before the fix every frame after the first sent nothing, down to 10 m");

    // B. it lands, and she comes down at the engine's 1.5 kn/s - the rung must still win
    fresh();
    const b = [step(0, 30, 6.0, "survey"), step(1000, 28.5, 4.5, "low"), step(2000, 27.2, 3.0, "low"),
               step(2500, 26.8, 2.25, "low"), step(3000, 26.3, 1.5, "low"), step(4000, 25.6, 1.5, "low")];
    check("15l. ... but a boat that really is coming down is left to do it - slowed, never stopped",
          b[0].sent.includes("/api/cmd/speed:low") && !b.some(held),
          "levels " + b.map((r) => r.level).join(" > ") + ", holds sent: " + b.filter(held).length
          + ". A deadline that fired on a hull still decelerating would undo the rung it guards");

    // C. it lands, but she closes faster than slowing can answer from where she now is
    fresh();
    const c1 = step(0, 30, 6.0, "survey"), c2 = step(500, 18, 5.0, "low");
    check("15m. ... and the moment slowing stops answering it from where she now is, she is held",
          c1.sent.includes("/api/cmd/speed:low") && held(c2) && /no longer answers/.test(c2.notes.join(" ")),
          "18 m at 5 kn, speed_key low: " + JSON.stringify(c2.sent)
          + " - low was an answer at 30 m and is not at 18 m");

    // D. a link that reports no speed_key: the speed over ground is the evidence
    fresh();
    const d1 = step(0, 30, 6.0), d2 = step(2500, 25.5, 5.95);
    fresh();
    const e1 = step(0, 30, 6.0), e2 = step(2500, 26.5, 4.0);
    check("15n. ... and on a link with no speed_key, the speed over ground decides whether it was taken",
          d1.sent.includes("/api/cmd/speed:low") && held(d2) && /was not taken within/.test(d2.notes.join(" "))
          && e1.sent.includes("/api/cmd/speed:low") && !held(e2),
          "6.0 -> 5.95 kn after 2.5 s: " + JSON.stringify(d2.sent) + "; 6.0 -> 4.0 kn: " + JSON.stringify(e2.sent));

    // E. where the vessel DOES report its key, the key is the evidence: a heavy hull that has
    // taken "low" but is still carrying its way is coming down, and holding it is a false hold
    fresh();
    const f1 = step(0, 30, 6.0, "survey"), f2 = step(2500, 25.5, 5.9, "low");
    check("15o. ... and where the vessel reports speed_key, the key decides: taken but still carrying way is not held",
          f1.sent.includes("/api/cmd/speed:low") && !held(f2),
          "speed_key low, still 5.9 kn after 2.5 s: " + JSON.stringify(f2.sent)
          + " - judged on speed over ground alone this would be held while it slows");

    // 15p. THE SLOW RUNG READS THE BOAT'S SPEED, NOT THE SETTING (review #6). TEETH: the gate reading the setting again -> 15p (killed). Its gate asked
    // whether the role was CONFIGURED low - so a boat whose role is set low but is actually
    // running faster (a lost command, a resume, a transit) was never slowed. At 70 m and 6 kn
    // this guard reads `slow`.
    fresh(); roleKey = "low";
    const p1 = step(0, 70, 6.0, "survey");
    fresh(); roleKey = "survey";
    const p2 = step(0, 70, 6.0, "low");
    check("15p. the slow rung reads the speed the vessel REPORTS: set low but running survey is slowed, and "
          + "already low is left alone",
          p1.level === "slow" && p1.sent.includes("/api/cmd/speed:low")
          && p2.level === "slow" && !p2.sent.includes("/api/cmd/speed:low"),
          "role low / vessel survey " + p1.level + " " + JSON.stringify(p1.sent)
          + "; role survey / vessel low " + p2.level + " " + JSON.stringify(p2.sent));

    // 15q. A REFUSED ESCAPE SAYS WHICH REFUSAL IT WAS (review #7). From inside the buffer every
    // heading "enters" at zero seconds by definition, so "every heading enters a keep-out"
    // explained nothing there - what escapeCourse refuses from inside is a way OUT. Driven
    // through the helm rung with the escape refused, from 30 m off and from 3 m off (inside).
    // TEETH, sidecar ASV_HTML, 2 mutations, 2 killed: the inside wording dropped -> 15q; the
    // inside test inverted -> 15q.
    const boxedIn = (n0) => {
      fresh(); banners = []; clock = T0 + 60000;
      nogo = { ready: true, frame: ref, ko: wall(n0), buffer: 5 };
      asv = { lat: ref.lat, lon: ref.lon };
      S = { armed: true, estop: false, run: "running", behavior: "survey",
            status: { cog_deg: 0, sog_kn: 6.0, heading_deg: 0, env_set_deg: 0, env_set_kn: 2.0,
                      holding: false, drifting: false } };
      clearance = { m: n0, kind: "a dock / pier", slowed: false, prev: null, info: null };
      sent = []; notes = [];
      // ⚠ TWO FRAMES, BECAUSE THE HELM RUNG NOW HAS A DWELL (2026-09-19). The first frame
      // arms HELM_DWELL_MS and alarms; the escape - and so the BOXED IN banner this check
      // reads - comes on a later frame. Driving one frame here tested a console that had just
      // started paying attention, and got an empty banner list for its trouble.
      guard();
      clock += HELM_DWELL_MS + 250;
      guard();
      return { level: clearance.level, said: banners.filter((b) => /BOXED IN/.test(b)).join(" | ") };
    };
    // 18 m rather than 30, for the same reason as 15j: at 30 m a 2 kn set is a hold now.
    const off30 = boxedIn(18), in3 = boxedIn(3);
    check("15q. a refused escape says WHICH refusal: from inside the buffer, no way OUT - not 'every heading enters'",
          off30.level === "helm" && /every heading enters a keep-out within 45 s/.test(off30.said)
          && in3.level === "helm" && /no heading gets out of the 5 m buffer and stays out for 45 s/.test(in3.said)
          && !/every heading enters/.test(in3.said),
          "30 m off (" + off30.level + "): \"" + off30.said + "\"; 3 m off, inside (" + in3.level + "): \""
          + in3.said + "\"");

    // 15r-15t. THE IN-EXTREMIS DWELL (2026-09-19). Andy: *"no dwell"*. Every gentler rung on
    // this ladder is damped and the one that TAKES THE BOAT was not: it steered on the first
    // frame it read. What follows pins the three properties that matter, and the third is the
    // one a reader would not think to write.
    const helmRun = (frames) => {          // frames = [ms offset from the first, ...]
      fresh(); banners = []; sent = []; notes = [];
      // ⚠ runRoute IS NOT RESET BY fresh(), and a stale one from an earlier scenario makes
      // guardTrack hand `assess` a ROUTE projection instead of the straight one - which read
      // `hold` on a frame steaming directly away from the wall. Cleared by name here rather
      // than in fresh(), because other scenarios in this block rely on theirs persisting.
      runRoute = null;
      nogo = { ready: true, frame: ref, ko: wall(18), buffer: 5 };
      asv = { lat: ref.lat, lon: ref.lon };
      clearance = { m: 13, kind: "a dock / pier", slowed: false, prev: null, info: null };
      const seen = [];
      for (const f of frames) {
        clock = T0 + 60000 + Math.abs(f);
        // a NEGATIVE offset means "this frame reads clear" - the water goes good for a beat
        S = { armed: true, estop: false, run: "running", behavior: "survey",
              status: { cog_deg: f < 0 ? 180 : 0, sog_kn: 6.0, heading_deg: f < 0 ? 180 : 0,
                        env_set_deg: f < 0 ? 180 : 0, env_set_kn: f < 0 ? 0 : 2.0,
                        holding: false, drifting: false } };
        guard();
        seen.push(clearance.level);
      }
      return { sent: sent.slice(), seen, said: banners.join(" | ") };
    };
    // ⚠ WHAT IS OBSERVABLE HERE IS THE BANNER, NOT THE COMMAND. `escapeCourse` is stubbed
    // to null for this whole block (it is what 15q is about), so no /api/cmd/escape can ever
    // be sent in it. The BOXED IN banner is emitted ONLY from inside the gated branch, which
    // makes it an exact witness for "the console got as far as taking the helm" - and using
    // the command instead would have made 15s unfalsifiable rather than passing.
    const one = helmRun([0]);
    check("15r. ONE frame of in extremis alarms but does not steer — the dwell is on the ACTION",
          one.seen[0] === "helm" && /HELM/.test(one.said) && !/BOXED IN/.test(one.said),
          "level " + one.seen[0] + "; the frame alarm fired ("
          + (/HELM/.test(one.said) ? "yes" : "NO") + ") and the helm branch did not ("
          + (/BOXED IN/.test(one.said) ? "IT DID" : "correct")
          + "). The operator is told on the frame the console knew; the helm waits a beat");
    const two = helmRun([0, HELM_DWELL_MS + 250]);
    check("15s. ... and a SECOND frame that still reads it does take the helm",
          /BOXED IN/.test(two.said),
          "after " + (HELM_DWELL_MS + 250) + " ms of continuous in extremis the helm branch "
          + (/BOXED IN/.test(two.said) ? "ran" : "DID NOT RUN"));
    // ⚠ 15t IS THE ONE WITH TEETH. The dwell must RESTART when the water reads good, not
    // merely accumulate: a clock that only counted up would let two in-extremis frames half a
    // minute apart, with clear water between them, steer the boat on the second.
    const broken = helmRun([0, -(HELM_DWELL_MS - 200), HELM_DWELL_MS + 250]);
    check("15t. ... but a frame that reads CLEAR in between restarts it, it does not accumulate",
          !/BOXED IN/.test(broken.said) && broken.seen[1] !== "helm",
          "in extremis, one clear frame (" + broken.seen[1] + "), then in extremis again "
          + (HELM_DWELL_MS + 250) + " ms from the FIRST: the helm branch "
          + (/BOXED IN/.test(broken.said) ? "RAN ANYWAY" : "did not run")
          + " — the clock restarted at the third frame");
    // 15u. ⚠ THE ESCAPE IS NOT THROTTLED OUT OF A *NEW* EPISODE. `escalated` used to be the
    // "first action" test, and the dwell moved the action off the escalating frame - so by the
    // time the dwell is satisfied, guardLevel already reads helm and `escalated` is false. On
    // its own that leaves the 6 s re-solve throttle deciding, which is wrong straight after a
    // previous escape: the boat would sit in extremis, alarm up, commanding nothing, for the
    // remainder of GUARD_REASSESS_MS. Driven here as two episodes 3 s apart - well inside the
    // 6 s throttle - with clear water between them.
    const twoEpisodes = helmRun([0, HELM_DWELL_MS + 250,          // episode 1: takes the helm
                                 -(HELM_DWELL_MS + 900),          // clear for a frame
                                 HELM_DWELL_MS + 1400, HELM_DWELL_MS + 2950]);
    check("15u. ... and a NEW episode inside the re-solve window is not throttled out of its escape",
          (twoEpisodes.said.match(/BOXED IN/g) || []).length >= 2,
          "two in-extremis episodes 3 s apart with clear water between: the helm branch ran "
          + (twoEpisodes.said.match(/BOXED IN/g) || []).length + " time(s). Judged on `escalated` "
          + "alone the second would have been suppressed by GUARD_REASSESS_MS");
    // 15v. ... AND THE OTHER EDGE: within ONE episode the escape is re-solved at most every
    // GUARD_REASSESS_MS. Without this, "first of episode" could simply be made always-true
    // and the console would re-command the escape on every telemetry frame - which is the
    // command-spam the governor's send-on-change rule exists to prevent, at the one rung that
    // can least afford it. MEASURED: that mutation SURVIVED until this check existed.
    const oneEpisode = helmRun([0, HELM_DWELL_MS + 250,          // takes the helm
                                HELM_DWELL_MS + 1250,            // 1 s later - must NOT re-solve
                                HELM_DWELL_MS + 2250,            // 2 s later - still not
                                HELM_DWELL_MS + 250 + 6500]);    // past GUARD_REASSESS_MS - does
    check("15v. ... but WITHIN one episode it re-solves on the throttle, not on every frame",
          (oneEpisode.said.match(/BOXED IN/g) || []).length === 2
          && oneEpisode.seen.slice(1).every((l) => l === "helm"),
          "five continuous in-extremis frames spanning "
          + (HELM_DWELL_MS + 250 + 6500) + " ms: the helm branch ran "
          + (oneEpisode.said.match(/BOXED IN/g) || []).length
          + " time(s) - once on the dwell and once past the " + GUARD_REASSESS_MS
          + " ms re-solve, not on all five");
  } finally { Date.now = realNow; roleKey = "survey"; }
}

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
        // 18 m, not 30: at 30 m a 2 kn set is a HOLD since 2026-09-19 (the rung asks
        // whether stopping buys a decision's worth of time, not whether the drift reaches at
        // all). The discrimination this check exists for - set off vs set on vs stopped - is
        // unchanged, and is now made where the rung actually lives.
        const W = wall(18), P = {e:0,n:0};
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
// 16c. AND THE BANNER SAYS WHAT WAS MEASURED (2026-09-19). Andy: *"a cause the banner
// asserts that the code hasn't established."* Both the operator banner and the Intent card
// read "IN EXTREMIS — being set onto <kind>", and the console had established no such
// thing: the rung measures that the DRIFT-ONLY projection reaches within half the buffer
// inside HELM_S, and never how much of the set closes the feature. MEASURED on the old rung
// with a synthetic wall: a set 98.9% PARALLEL to a pier, closing it at 0.02 kn, produced
// "being set onto a dock / pier". A SOURCE check because escapeCourse is stubbed to null in
// the driven block above, so the escape banner cannot be produced there - the behavioural
// half of this property is tests/in_extremis.js 6b, on assess's own reason string.
const Gc = codeOnly(G);   // see codeOnly at the top of this file
check("16c. the escape banner and the Intent card quote the drift, not an asserted set",
      () => !/being set onto/.test(Gc)
            && /const driftSay =/.test(Gc)
            && /the drift alone reaches within/.test(Gc)
            && (Gc.match(/driftSay/g) || []).length >= 3,   // declared + banner + intent card
      "\"being set onto\" in the guard's CODE: " + (/being set onto/.test(Gc) ? "STILL THERE" : "gone")
      + "; driftSay used " + ((Gc.match(/driftSay/g) || []).length - 1) + " place(s) after its "
      + "declaration (the banner and the Intent card must both read it, or one of them goes "
      + "on asserting a cause while the other reports one)");
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
