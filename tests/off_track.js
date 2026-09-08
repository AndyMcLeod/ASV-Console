// tests/off_track.js - "off track" must be displacement from the leg being FLOWN.
//
// Andy's report, 2026-08-29: "On the Intent card the 'off track' value is measure current
// position to the nearest survey line. This is nonsensical. 'off track' should measure
// displacement from active planned line of advance." And then, on the one state where the
// old number happened to be defensible: "if the ASV is on a survey line in active survey
// mode then it makes sense."
//
// He is right on both counts, and the second is not a special case - it is the general rule
// landing on the state he named. While the boat is running a coverage line, the active leg
// IS that line (currentLegLine matches BOTH endpoints, so it knows rather than guesses), so
// the general answer and the sensible one coincide there. Everywhere else they did not:
//
//   * approach out to the survey area - reported a coverage line the boat had not reached
//   * a reversal between lines      - reported whichever line the turn swung nearest
//   * Go-To / Transit / RTH         - mission.lines was empty, so the row VANISHED entirely
//   * a lawnmower plan, mid-line    - the reading jumped to the neighbouring line at every
//                                     midpoint crossing: the number moved because the
//                                     geometry moved, not because the boat had gone anywhere
//
//   node tests/off_track.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// The rules it encodes, each of which is a way to get this wrong again:
//   * The subject is the ACTIVE LEG - rr[idx-1] -> rr[idx] - never the nearest anything.
//     A line 10 m away that the boat is not following is not the boat's track.
//   * PERPENDICULAR to that leg's infinite line, not point-to-SEGMENT. Clamping turns the
//     reading into range-to-waypoint as the boat closes a turn, which is a different
//     quantity that already has its own row, and would hide a boat holding its track but
//     carried past the end of the leg.
//   * SIGNED, positive to starboard, and the sign follows the leg's DIRECTION. The old
//     value came out of Math.hypot, so the card's "left" branch was unreachable code.
//   * It must NAME its subject. The nearest-line reading survived this long because the row
//     was a bare number: nothing on the card said which line it meant.
//   * No leg passed yet, a finished route, or a zero-length leg -> no reading at all. A
//     displacement from a line of advance that does not exist is not zero, it is absent.
//
// TEETH. Ten mutations of offTrack, each RUN against a sidecar copy of the page - the check
// numbers below are the ones that actually went red, not the ones that looked likely:
//   clamp t to [0,1] - point-to-SEGMENT, as the old value did  -> 3a, 3b, 4, 5, 6, 7
//   wrap the result in Math.abs (the old Math.hypot)           -> 3a, 3b, 4, 6, 7
//   negate the sign (port positive)                            -> 1, 2, 3a, 3b, 4, 5, 6, 7, 12, 13
//   measure rr[idx] -> rr[idx+1], the leg AHEAD                -> 1, 2, 3a, 3b, 4, 5, 6, 7, 10, 12, 13
//   label from the NEAREST line, not currentLegLine()          -> 1, 6, 7
//   drop the idx < 1 guard                                     -> 8
//   drop the idx >= rr.length guard                            -> 9
//   drop the zero-length-leg guard                             -> 10
//   drop the !asv guard                                        -> 11
//   RESTORE THE BUG WHOLESALE (nearest line, clamped, unsigned) -> 1, 2, 3a, 3b, 4, 5, 6, 7, 8, 9, 12, 13
//
// The last one is the regression this suite exists for, and it is a WHOLE-FUNCTION swap.
// The first attempt at it spliced fragments, left a name undeclared, and the suite died
// with a ReferenceError - caught by the crash guard, which is a non-zero exit that proves
// nothing about whether any CHECK encodes the rule. A mutation that does not run is not
// evidence. Checks 14-16 guard the page's source text and no mutation of offTrack's body
// can reach them; they are what fails if the old global or the old row is pasted back.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy, and this
// suite eval()s page functions into that same sloppy scope.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// "No FAIL lines" and "the process died" are indistinguishable to anything reading stdout,
// so a mutation that CRASHES this suite must not score as survived.
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

// LAYER-0 HELPERS COME FROM THE REAL MODULES, not from asv.html's source text - a renamed
// or deleted export fails HERE, loudly, rather than silently reverting to a stale copy.
// toEN is the frame offTrack itself works in, so the checks below are computed in the
// SAME projection the shipped function uses; fromEN is its exact inverse, which is what
// lets a scenario be written in metres and read back in metres.
const { toEN, fromEN, distTo } = require("../static/js/geodesy.js");

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

// a module-level `const NAME = ...;` / `let NAME = ...;` pulled out verbatim
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}
function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}

// The page globals the two functions read. `var` at module scope so the eval'd function
// declarations - which sloppy-mode direct eval binds HERE - can see them.
var asv = null, runRoute = null, mission = { waypoints: [], lines: [] };
var window = { _wpIndex: 0 };

// ONE eval, so currentLegLine and offTrack close over the SAME _legLine memo, and so
// __resetLegMemo can reach it. The memo is keyed on (index, route length, line count) -
// three scenarios can share that key while differing in geometry, which would serve a
// stale line label; the suite clears it between worlds rather than working around it.
// eslint-disable-next-line no-eval
eval(grabDecl("LINE_MATCH_M") + "\n" + grabDecl("_legLine") + "\n" +
     grab("currentLegLine") + "\n" + grab("offTrack") + "\n" +
     "function __resetLegMemo(){ _legLine = {key:'', line:-1}; }");

let fails = 0;
// Every condition is a thunk: a THROW is a failed check, never a dead process.
function check(name, cond, detail) {
  let ok = false, err = "";
  try { ok = (typeof cond === "function") ? !!cond() : !!cond; }
  catch (e) { ok = false; err = " THREW " + (e && e.message ? e.message : e); }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + err + "]" : err));
  if (!ok) fails++;
}

// --- the world, written in METRES -------------------------------------------------- //
// Home water. Every point below is placed as an east/north offset from it, so a scenario
// reads as the geometry it is rather than as eight decimal places of latitude.
const R = { lat: 38.78965, lon: -75.16094 };
const P = (e, n) => fromEN(e, n, R);

// Two parallel N-S coverage lines 25 m apart, run as a lawnmower: up line 1, across the
// top, down line 2. This is the plan Andy's report is about.
const L1 = { a: P(0, -200), b: P(0, 200) };
const L2 = { a: P(25, -200), b: P(25, 200) };
const LAWN = [L1.a, L1.b, L2.b, L2.a];

// Drive the two functions the way renderIntent does: set the world, set the reported
// waypoint index, ask. `at` is the boat, in metres from R.
function offAt(at, idx, world) {
  mission = Object.assign({ waypoints: [], lines: [] }, world || {});
  runRoute = (world && world.route) || LAWN;
  asv = Object.assign({ hdg: 0 }, at);
  window._wpIndex = idx;
  __resetLegMemo();
  return offTrack(runRoute, idx);
}
const SURVEY = { lines: [L1, L2], route: LAWN };
// point-to-segment range to the NEAREST mission line - the OLD reading, reproduced here
// so each check can print what the card used to say beside what it says now. Nothing in
// the page computes this any more; that is the point.
function nearestLineM(at, lines) {
  let best = Infinity;
  for (const L of lines) {
    const a = toEN(L.a, at), b = toEN(L.b, at);
    const dx = b.e - a.e, dy = b.n - a.n, len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, -(a.e * dx + a.n * dy) / len2));
    best = Math.min(best, Math.hypot(a.e + t * dx, a.n + t * dy));
  }
  return best;
}
const near = (v, want, tol) => Math.abs(v - want) <= (tol || 0.1);
const fmt = o => o ? (o.m.toFixed(1) + " m " + (o.m > 0 ? "right" : "left") + " of " + o.of) : "(none)";

console.log("Off track - displacement from the leg being flown, not from the nearest line:");

// 1. THE STATE ANDY SAYS IS SENSIBLE, and it must still read sensibly: on line 1,
//    northbound, 15 m to starboard. The number is the one he means AND it is named.
{
  const boat = P(15, 0), o = offAt(boat, 1, SURVEY);
  check("1. on a coverage line, it is the displacement from THAT line, and says so",
        () => o && near(o.m, 15) && o.of === "line 1",
        fmt(o));
}

// 2. THE REPORTED DEFECT, in the geometry that produces it. Same boat: it is 15 m from the
//    line it is RUNNING and 10 m from the neighbouring line it is not. The old reading took
//    the minimum over every line in the plan, so it answered 10 - a number describing a
//    line the boat had no relationship with, which is why it could not be reconciled with
//    anything on the chart. THIS is the check that fails if nearest-line is ever restored.
{
  const boat = P(15, 0), o = offAt(boat, 1, SURVEY);
  const old = nearestLineM(boat, [L1, L2]);
  check("2. a NEARER line the boat is not following does not capture the reading",
        () => o && near(o.m, 15) && !near(o.m, old, 1),
        "flown line 1 -> " + fmt(o) + "; nearest line was " + old.toFixed(1) + " m (line 2)");
}

// 3. THE SIGN IS REAL AND FOLLOWS THE LEG'S DIRECTION. Two readings of the SAME side of the
//    water, taken on the two legs of the lawnmower, must come out opposite - which is only
//    possible if the value is a signed cross product rather than a magnitude. Before this
//    change the value came from Math.hypot and every reading in the console's life said
//    "right"; the card's "left" branch had never once executed.
{
  const boat = P(-8, 0), o = offAt(boat, 1, SURVEY);          // west of a NORTHBOUND line
  check("3a. west of a northbound leg reads LEFT",
        () => o && near(o.m, -8) && o.of === "line 1", fmt(o));
}
{
  const boat = P(40, 0), o = offAt(boat, 3, SURVEY);          // east of a SOUTHBOUND line
  check("3b. east of a SOUTHBOUND leg also reads LEFT - the sign is the leg's, not the map's",
        () => o && near(o.m, -15) && o.of === "line 2",
        fmt(o) + "; the same boat on the northbound leg reads right");
}

// 4. ... and the pair, stated as the invariant: run the identical offset up one leg and
//    down the next and the two readings are equal and opposite. A magnitude cannot do this.
{
  const up = offAt(P(10, 0), 1, SURVEY);                      // 10 m east of line 1
  const down = offAt(P(35, 0), 3, SURVEY);                    // 10 m east of line 2
  check("4. same offset, opposite legs -> equal and OPPOSITE readings",
        () => up && down && near(up.m, 10) && near(down.m, -10),
        "up " + fmt(up) + " / down " + fmt(down));
}

// 5. PERPENDICULAR TO THE LINE OF ADVANCE, NOT TO THE SEGMENT. The boat is 100 m past the
//    north end of line 1 and still 15 m to starboard of its track. Off track is 15 m. A
//    point-to-segment distance would say 101 - the range to the waypoint, wearing the
//    off-track label, at exactly the moment a boat overshooting a turn needs the truth.
{
  const boat = P(15, 300), o = offAt(boat, 1, SURVEY);
  const clamped = Math.hypot(15, 100);
  check("5. past the end of the leg, it is still the perpendicular - not range-to-waypoint",
        () => o && near(o.m, 15) && !near(o.m, clamped, 1),
        fmt(o) + "; clamped-to-segment would have said " + clamped.toFixed(1) + " m");
}

// 6. THE TURN BETWEEN LINES. The boat is on the cross-over leg at the top of the lawnmower,
//    5 m north of it. It is not on a coverage line and the console does not pretend it is:
//    the subject is the LEG, named as a leg. The old reading answered 11.2 m from line 2.
{
  const boat = P(15, 205), o = offAt(boat, 2, SURVEY);
  const old = nearestLineM(boat, [L1, L2]);
  check("6. turning between lines, the subject is the LEG - named as one",
        () => o && near(o.m, -5) && o.of === "leg 2→3",
        fmt(o) + "; the nearest line was " + old.toFixed(1) + " m away");
}

// 7. THE APPROACH LEG, with a coverage line 3 m off the boat's beam. This is the label half
//    of the same defect: a line being CLOSE must not capture either the number or the name.
//    The boat is 10 m off its approach leg and 3 m from line 1, and it is not on line 1 -
//    it has not started it. Old reading: "3.0 m right". True reading: 10 m to port.
{
  const APPR = [P(-100, -200), P(0, -200), P(0, 200)];
  const boat = P(-3, -190), o = offAt(boat, 1, { lines: [L1, L2], route: APPR });
  const old = nearestLineM(boat, [L1, L2]);
  check("7. on the approach, a line 3 m off the beam takes neither the number nor the name",
        () => o && near(o.m, -10) && o.of === "leg 1→2",
        fmt(o) + "; the nearest line was " + old.toFixed(1) + " m away");
}

// 8-10. NO LEG, NO READING. A displacement from a line of advance that does not exist is
// absent, not zero - and the card prints "no leg of advance yet" rather than a 0.0 the
// operator would read as "dead on track".
{
  check("8. nothing passed yet (index 0) - there is no leg to be off",
        () => offAt(P(15, 0), 0, SURVEY) === null);
  check("9. the route is finished - likewise",
        () => offAt(P(15, 0), LAWN.length, SURVEY) === null);
  check("10. a zero-length leg has no direction, so no side to be on",
        () => offAt(P(15, 0), 1, { lines: [], route: [P(0, 0), P(0, 0), P(50, 0)] }) === null,
        "duplicate waypoints must not divide by a ~0 length");
  check("11. no fix - no position to measure from",
        () => { const o = offAt(P(15, 0), 1, SURVEY); asv = null; return o && offTrack(LAWN, 1) === null; });
}

// 12. A GO-TO / TRANSIT / RTH HAS NO SURVEY LINES AT ALL, and used to print NOTHING: the
//     old value stayed at Infinity whenever mission.lines was empty, so the row silently
//     disappeared on the three behaviours where cross-track is most of what you want.
{
  const GOTO = [P(0, 0), P(200, 0)];
  const o = offAt(P(100, -30), 1, { lines: [], route: GOTO });
  check("12. a Go-To with no survey lines still has a track to be off",
        () => o && near(o.m, 30) && o.of === "leg 1→2",
        fmt(o) + " (the row used to vanish - no lines, no reading)");
}

// 13. THE INVARIANT IN ONE LINE. Move a line the boat is NOT following and the reading must
//     not budge; move the BOAT a metre and it must. The old value failed both halves.
{
  const boat = P(15, 0);
  const before = offAt(boat, 1, SURVEY);
  const L2moved = { a: P(75, -200), b: P(75, 200) };          // shove line 2 fifty metres away
  const after = offAt(boat, 1, { lines: [L1, L2moved], route: LAWN });
  const moved = offAt(P(16, 0), 1, SURVEY);                   // and now move the BOAT 1 m
  check("13. a line the boat is not following cannot move the reading; the BOAT can",
        () => before && after && moved && near(after.m, before.m, 0.01) && near(moved.m, 16),
        "line 2 moved 50 m: " + before.m.toFixed(2) + " -> " + after.m.toFixed(2) +
        "; boat moved 1 m: " + moved.m.toFixed(1));
}

// 14-16. THE PAGE ITSELF. The old global is gone, the row is fed by offTrack, and nothing
// has quietly re-grown a nearest-line distance - NOR a nearest-line INDEX. When these were
// written the chart highlight still picked the nearest line, and that was argued to be a
// legitimate drawing question; Andy overruled it on 2026-09-07 ("Only highlight the line
// when actually running said line"), so the whole nearest-line notion is gone and check 16
// asserts the stronger thing: nobody computes one at all.
{
  // SCOPED TO CODE, deliberately, and for the same reason CLAUDE.md's brand grep is: the
  // comment above updateActiveLine NAMES activeXTE, because a maintainer has to be able to
  // find out what used to be there and why it went. Strip line comments and look at what
  // actually runs - a check that flags the note explaining the fix is one people learn to
  // ignore. Stripping from `//` rightwards keeps everything to its LEFT, so a real use
  // sitting before a trailing comment is still caught.
  // ⚠ CRLF: split("\n") leaves a trailing \r on every line, and /\/\/.*$/ (no /m) cannot
  // reach past it - the same silent no-op as target_cpa's decomment. [^\n]* runs to the
  // true end of `l` on its own, \r included, so no $ anchor is needed.
  const code = H.split("\n").map(l => l.replace(/\/\/[^\n]*/, "")).join("\n");
  check("14. the nearest-line distance no longer exists in the page's CODE",
        () => !/activeXTE/.test(code) && /activeXTE/.test(H),
        "activeXTE was the value the card printed as off track; the comment that retired it stays");
  const rows = H.split("\n").filter(l => /row\("off track"/.test(l));
  check("15. every off-track row is fed by offTrack() or says there is no leg",
        () => rows.length > 0 && rows.every(l => /ot\.m|no leg of advance/.test(l)),
        rows.length + " row(s) built");
  check("16. no nearest-line INDEX either - the chart highlight is runLineIdx",
        () => !/function updateActiveLine\(/.test(H) && !/activeLine/.test(code)
              && /act = \(i===runLineIdx\)/.test(code),
        "one answer to \"which line is being run\": the timings, the table, the tip and the "
        + "chart stroke all read it, so none of them can disagree with the others");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
