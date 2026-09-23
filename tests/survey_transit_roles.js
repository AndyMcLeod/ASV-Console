// tests/survey_transit_roles.js - a coverage line is not a transit, and the hop to the next
// coverage region is not a turn.
//
// Andy, 2026-09-05:
//
//   "The lines within a survey (survey pattern) are not transit lines. They should be
//    defined as survey lines and accept survey speed inputs. Lines from home to the first
//    survey line waypoint and from the last survey waypoint to home or the next survey are
//    transit lines and accept transit speed inputs."
//
// Three of those four cases already held. MEASURED over a real two-region survey at Lewes -
// a live console, the real governor, the commanded key read back off /api/state:
//
//     approach home -> L1     high    (transit)   correct
//     LINE 1..5               survey              correct
//     reversals in-region     low     (turn)      correct
//     HOP region A -> B       low     (turn)      >>> 304.2 s of it, and WRONG
//     RTH -> home             high    (transit)   correct
//
// 618 m flown at the TURN speed, 4.0 kn, on a leg he names outright as a transit. At the
// transit speed the same hop is 84.9 s: 219 seconds of survey endurance spent going
// nowhere, per hop, on every multi-region plan this console has ever run.
//
// ⚠⚠ AND tests/speed_modes.js CHECK 2b ALREADY CLAIMED THIS, BY NAME: "anywhere else -
// approach, REGION HOP, Go-To, RTH - it is TRANSIT". It passed throughout, because it set
// `runLineIdx = -1, curTurn = -1` by hand and asked currentActivity() what that meant.
// currentActivity() answered correctly. The fault was that accumLineTime COULD NOT PRODUCE
// THAT STATE: `curTurn` was cleared only when a line was ENTERED, so the first frame near a
// line end opened a turn that then survived the whole hop. The classifier was never wrong;
// the state handed to it was. A check that hand-builds its subject's input can only test
// half a mechanism, and this suite is the other half - it drives the REAL accumLineTime,
// tick by tick, along a real two-region plan, and reads the role out of the real
// currentActivity() at every step.
//
//   node tests/survey_transit_roles.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// THE RULE, and it is decided from the PLAN rather than from where the boat happens to be:
// a gap between consecutive lines is a REVERSAL when it is within four times the plan's own
// median end-to-start gap, and a TRANSIT otherwise. Four times, so that a gap where a line
// was struck or dropped - two or three times the spacing - is still flown as the reversal it
// is, while a hop to another region, which is many times it, is not.
//
//   ⚠ NOT turnZoneM()'s scale, which measures a-to-a. Consecutive lines of a boustrophedon
//   alternate direction, so their `a` ends are at OPPOSITE ends of the pattern and that
//   number is ~the LINE LENGTH. Fine for "am I manoeuvring near a line end", which is all
//   turnZoneM is asked; useless for "is this gap a reversal". Check 8 pins the difference.

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
const HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(HTML, "utf8");
// llEN and fmtDist join the list for check 15: linePhase measures the boat's along-track
// position with the real geodesy, and the lead-in detail quotes the distance still to run.
const { toEN, llEN, distTo, azTo, alignDeg, M_PER_DEG_LAT } = require("../static/js/geodesy.js");
function fmtDist(m) { return Math.round(m) + " m"; }

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!cond(); note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("anchor gone: function " + name + " (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("anchor gone: declaration " + name);
}

// --- the page's world, as accumLineTime reads it ---------------------------- //
// EVERYTHING under test is the page's own source. The geodesy comes from the module the
// page imports, not from a restatement here: a suite that recomputes its subject's
// distances is a reference reading the subject's numbers back to it.
const V = { SPEED_KN: { low: 4.0, survey: 7.0, high: 14.0 } };
var mission, runRoute = null, asv = null, S = null;
var runLineIdx = -1, turnSeg = [], curTurn = -1, lastRunLine = -1;
var lineActual = [], lineClock = null, lineStatsKey = null;
var clearance = { slowed: false }, commandedSpeedSent = [];
function cmd(p, b) { commandedSpeedSent.push(b && b.speed); }
globalThis.window = globalThis;
globalThis.performance = globalThis.performance || { now: () => Date.now() };

eval([
  grabDecl("LINE_MATCH_M"), grabDecl("_legLine"), grabDecl("SPEED_ROLES"),
  grab("lineSetKey"), grab("syncLineStats"), grab("turnZoneM"), grab("nearestEndpointM"),
  // the DRAWN-LINE numbering "line N of M" now goes through (review #18) - the page's own, not a stub
  grabDecl("LINE_PART_OFFSET_M"), grabDecl("_drawnLines"), grab("linePartContinues"), grab("drawnLines"),
  grab("lineNo"), grab("lineCount"), grab("linePartTxt"),
  grab("reversalScaleM"), grab("isReversalGap"),
  grab("indexedRoute"), grab("currentLegLine"), grab("accumLineTime"),
  // linePhase splits a committed line into lead-in / coverage / lead-out; currentActivity
  // asks it before reporting coverage. The fixtures here carry no lead, so every line is
  // all coverage and the answer is the one it always was — which is the point: adding the
  // feature must not move a single role on a plan that does not use it.
  grab("alongLineM"), grab("linePhase"),
// R8: currentActivity() returns role "depart" while a launch grant stands, so the symbol
// must exist in this world too. Null here - no berth is latched - so the classifier answers
// exactly as it always did, which is what makes these checks evidence that the OPEN regime
// is unchanged (DEPARTURE_PARADIGM.md R8; tests/berth_grant.js is where a grant stands).
  "let grant = null;",
  grab("currentActivity"), grab("speedRole"), grab("roleSpeed"), grab("roleSpeedMS"),
  grab("committedRoleLengths"),
  // A `const` declared inside a direct eval stays in the EVAL's scope; only the function
  // declarations bind out here. This is how check 15e reads the page's OWN tolerance
  // instead of restating 5 in this file, where it could drift from what ships.
  "function __matchM(){ return LINE_MATCH_M; }",
  "function __zone(){ return turnZoneM(); }",
  "function __scale(){ return reversalScaleM(); }",
].join("\n"));

// --- a real two-region plan, in metres off a local origin -------------------- //
const LAT0 = 38.8000, LON0 = -75.1300;
const MLON = M_PER_DEG_LAT * Math.cos(LAT0 * Math.PI / 180);
const P = (dn, de) => ({ lat: LAT0 + dn / M_PER_DEG_LAT, lon: LON0 + de / MLON });
// 150 m lines, 60 m spacing, three in region A and two in region B 600 m north.
const LINES = [
  [P(0, 0),    P(0, 150)],
  [P(60, 150), P(60, 0)],
  [P(120, 0),  P(120, 150)],
  [P(720, 0),  P(720, 150)],
  [P(780, 150),P(780, 0)],
];
function plan(over) {
  mission = {
    lines: LINES.map(([a, b]) => ({ a, b })),
    waypoints: LINES.flatMap(([a, b]) => [a, b]),
    arrival_radius_m: 8, speed: "survey",
    speeds: { transit: "high", turn: "low", survey: "survey" },
    ...(over || {}),
  };
  runRoute = null; window._wpIndex = 0;
  runLineIdx = -1; turnSeg = []; curTurn = -1; lastRunLine = -1;
  lineActual = []; lineClock = null; lineStatsKey = null;
  S = { run: "running", armed: true, estop: false, behavior: "survey",
        status: { holding: false, sog_kn: 6, cog_deg: 0 } };
}

// Fly the boat to a point and tick the REAL accumLineTime, then read the REAL role.
// `wp` is the waypoint index the vessel reports - the same input currentLegLine() gets.
function tick(dn, de, cogDeg, wp) {
  asv = { ...P(dn, de), hdg: cogDeg };
  S.status.cog_deg = cogDeg; S.status.sog_kn = 6;
  window._wpIndex = wp;
  lineClock = performance.now() / 1000 - 0.25;      // a quarter-second frame, like the sim
  accumLineTime();
  return speedRole();
}
// Walk a straight path and report every role seen along it, in order.
function fly(from, to, wp, steps) {
  const seen = [];
  const cog = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI + 360) % 360;
  for (let i = 0; i <= (steps || 12); i++) {
    const t = i / (steps || 12);
    const r = tick(from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1]), cog, wp);
    if (!seen.length || seen[seen.length - 1] !== r) seen.push(r);
  }
  return seen;
}

console.log("Survey lines are survey, the hop to the next region is a transit:");

// --- 1. the shape the fix rests on ----------------------------------------- //
plan();
check("1. the plan's reversal scale is the SPACING, not the line length",
      () => Math.abs(__scale() - 60) < 1,
      () => "reversal scale " + __scale().toFixed(1) + " m (lines are 150 m, spacing 60 m)");

check("2. a gap between neighbouring lines is a REVERSAL",
      () => isReversalGap(0) && isReversalGap(1) && isReversalGap(3),
      () => "gaps 0,1,3 = " + [0,1,3].map(k=>distTo(LINES[k][1], LINES[k+1][0]).toFixed(0)+" m").join(", "));

check("3. THE REPORT: the gap to the next coverage REGION is not",
      () => !isReversalGap(2),
      () => "gap 2 = " + distTo(LINES[2][1], LINES[3][0]).toFixed(0) + " m");

check("4. ... and the LAST line has no next line, so nothing after it is a reversal",
      () => !isReversalGap(4) && !isReversalGap(9),
      "the manoeuvre after the final line is the RTH, or a loiter");

// --- 5-7. the roles the boat actually gets, driving the REAL accumLineTime -- //
// Region A: line 1 (wp 1), reversal to line 2, line 2 (wp 3), reversal, line 3 (wp 5).
plan();
const onL1 = fly([0, 5], [0, 145], 1);
check("5. on a coverage line the role is SURVEY",
      () => onL1.length === 1 && onL1[0] === "survey",
      () => "roles seen along line 1: " + onL1.join(" -> "));

const rev12 = fly([5, 152], [55, 152], 2);       // the swing from line 1's end onto line 2
check("6. in a reversal between neighbouring lines it is TURN",
      () => rev12.every(r => r === "turn"),
      () => "roles seen in the reversal: " + rev12.join(" -> "));

fly([60, 145], [60, 5], 3);                       // run line 2 so lastRunLine is real
fly([65, 0], [115, 0], 4);                        // reversal onto line 3
const onL3 = fly([120, 5], [120, 145], 5);
check("6b. ... and the next line is SURVEY again, so the turn actually closed",
      () => onL3.length === 1 && onL3[0] === "survey",
      () => "roles seen along line 3: " + onL3.join(" -> "));

// The hop: line 3's end (120,150) to line 4's start (720,0), 613 m.
const hop = fly([130, 148], [710, 5], 6, 40);
check("7. THE REPORT: the hop to the next coverage region is TRANSIT the whole way",
      () => hop.length === 1 && hop[0] === "transit",
      () => "roles seen across the 618 m hop: " + hop.join(" -> "));

check("7b. ... and it is the TRANSIT SPEED that gets commanded, not the turn speed",
      () => roleSpeed(speedRole()) === "high" && V.SPEED_KN[roleSpeed(speedRole())] === 14.0,
      () => "commanded " + roleSpeed(speedRole()) + " = "
            + V.SPEED_KN[roleSpeed(speedRole())].toFixed(1) + " kn"
            + " (the fault flew it at " + V.SPEED_KN.low.toFixed(1) + ")");

const onL4 = fly([720, 5], [720, 145], 7);
check("7c. ... and region B's first line is SURVEY, so the hop did not eat it",
      () => onL4.length === 1 && onL4[0] === "survey",
      () => "roles seen along line 4: " + onL4.join(" -> "));

const rev45 = fly([725, 150], [775, 150], 8);
check("7d. ... and the reversal INSIDE region B is a turn like any other",
      () => rev45.every(r => r === "turn"),
      () => "roles seen: " + rev45.join(" -> "));

// --- 6c. the OTHER half: a turn that is never finished must not stick ------- //
// The gap test stops a region hop from ever OPENING a turn, so it alone left the sticky
// `curTurn` untested - the mutation that restores it SURVIVED the first cut of this suite.
// It is a real state: a reversal opens, and then the boat does not reach the next line
// because a routed detour, a commanded deviation or a set carries it wide. Without the
// close branch the role stays TURN for as long as that lasts, however far it goes.
{
  plan();
  fly([0, 5], [0, 145], 1);                       // run line 1, so lastRunLine is real
  const inRev = tick(5, 152, 0, 2);
  const wide  = fly([5, 152], [400, 600], 2, 20); // carried well clear of every endpoint
  check("6c. a reversal the boat never completes does not stay a TURN for ever",
        () => inRev === "turn" && wide[wide.length - 1] === "transit",
        () => "opened as " + inRev + ", then " + wide.join(" -> ") + " as it went wide");
}

// --- 6d. ON a line is not RUNNING it: the chart highlight ------------------- //
// Andy, 2026-09-07: "Do not highlight survey lines in the active survey pattern when merely
// crossing said line in a transit or turn or some such. Only highlight the line when actually
// running said line." The chart used to stroke whichever line was NEAREST, so crossing one in
// a reversal or on the hop to the next region lit it as though it were being surveyed. It
// strokes `runLineIdx` now - the same value the LINES table, the line-end hover tip and the
// per-line timings read - so this is the check that holds the highlight as well as the clock.
//
// The boat is put EXACTLY on line 2, aligned with it, and only the route leg is varied. That
// is the whole distinction: geometry says "on the line", the leg says whether it is being run.
{
  plan();
  fly([0, 5], [0, 145], 1);                       // run line 1 first, so a reversal is possible
  const L2mid = [60, 75];                         // dead centre of line 2, which runs 150 -> 0 m east
  const onL2Leg  = (tick(L2mid[0], L2mid[1], 270, 3), runLineIdx);   // wp 3 IS line 2's own leg
  const crossing = (tick(L2mid[0], L2mid[1], 270, 6), runLineIdx);   // wp 6 is the region HOP
  check("6d. THE REPORT: sitting ON a line while running a different leg highlights nothing",
        () => onL2Leg === 1 && crossing === -1,
        () => "same position and heading, dead centre of line 2 - on its own leg runLineIdx="
              + onL2Leg + ", merely crossing it runLineIdx=" + crossing
              + " (-1 = no line highlighted)");

  check("6e. ...and the chart stroke reads that value, with no nearest-line notion left",
        () => /act = \(i===runLineIdx\)/.test(H) && !/function updateActiveLine\(/.test(H),
        "one answer to 'which line is being run' - timings, table, tip and stroke all read it");
}

// --- 8. the two scales are not the same number ----------------------------- //
plan();
check("8. turnZoneM's scale is NOT the reversal scale, and must not be used as one",
      () => __zone() > 2 * __scale(),
      () => "turn zone " + __zone().toFixed(0) + " m vs reversal scale " + __scale().toFixed(0)
            + " m — a-to-a on a boustrophedon is the LINE LENGTH");

// --- 9. a struck line widens a gap without making it a transit ------------- //
{
  // ⚠ FIVE lines, not three. With three the gaps are [60, 120] and the median IS 120 - the
  // widened gap becomes its own yardstick, so the check passed at ANY multiplier and the
  // "1x instead of 4x" mutation survived it. Five lines with one struck leave the median at
  // the true spacing, which is what makes this a test of the multiplier.
  const L = [LINES[0], LINES[1], [P(180, 0), P(180, 150)],      // ← the line at 120 is struck
             [P(240, 150), P(240, 0)], [P(300, 0), P(300, 150)]];
  plan({ lines: L.map(([a,b])=>({a,b})), waypoints: L.flatMap(([a,b])=>[a,b]) });
  check("9. a gap where a line was struck is still a REVERSAL, not a transit",
        () => Math.abs(__scale() - 60) < 1 && isReversalGap(1),
        () => "gap " + distTo(L[1][1], L[2][0]).toFixed(0) + " m over a "
              + __scale().toFixed(0) + " m median - the card already names these "
              + '"reversal(s) swing across a gap where a line is missing"');
}

// --- 10-12. the estimate is billed by the same rule ------------------------ //
plan();
{
  const R = committedRoleLengths();
  check("10. the committed plan totals BY ROLE, not all at the survey speed",
        () => R && Math.abs(R.survey - 750) < 2,
        () => R ? "survey " + R.survey.toFixed(0) + " m, turn " + R.turn.toFixed(0)
                  + " m, transit " + R.transit.toFixed(0) + " m" : "null");

  check("11. ... the region hop lands in TRANSIT, where the boat will fly it",
        () => R && Math.abs(R.transit - 618) < 3 && R.transit > 0,
        () => R ? "transit " + R.transit.toFixed(0) + " m (the 618 m hop)" : "null");

  check("11b. ... and the three reversals in TURN",
        () => R && Math.abs(R.turn - 180) < 3,
        () => R ? "turn " + R.turn.toFixed(0) + " m (3 x 60 m)" : "null");

  check("11c. ... and the three totals account for the whole chain",
        () => { const wps = mission.waypoints; let all = 0;
                for (let i = 1; i < wps.length; i++) all += distTo(wps[i-1], wps[i]);
                return Math.abs((R.survey + R.turn + R.transit) - all) < 1; },
        () => "roles sum vs chain length");

  // The number the operator reads. Billed at one speed it was 1543/3.60 = 429 s.
  const sec = R.survey/roleSpeedMS("survey") + R.turn/roleSpeedMS("turn")
            + R.transit/roleSpeedMS("transit");
  check("12. ... so the estimate the operator reads changes, and toward the truth",
        () => sec < 400 && sec > 340,
        () => "by role " + sec.toFixed(0) + " s vs " + (1543/roleSpeedMS("survey")).toFixed(0)
              + " s billed wholly at the survey speed");
}

// --- 13. a plan this walk does not recognise falls back, it does not zero --- //
{
  plan({ waypoints: [P(0,0), P(0,150), P(999,999)] });     // not the shape commitPattern builds
  check("13. an unrecognised waypoint chain returns null, never a silent zero",
        () => committedRoleLengths() === null,
        "a zero would read as 'no survey' on the card; null makes the caller fall back");
  // BOTH refusals, because there are two and asserting one let a mutation change the other
  // and stay green - found by exactly that mutation.
  plan({ lines: [], waypoints: [] });
  const empty = committedRoleLengths();
  plan({ lines: mission.lines, waypoints: [P(0,0)] });
  check("13b. ... and so does a plan with no lines, or too few waypoints to have a leg",
        () => empty === null && committedRoleLengths() === null,
        () => "no lines -> " + JSON.stringify(empty) + ", one waypoint -> "
              + JSON.stringify(committedRoleLengths()));
}

// --- 14. the Lines card times its two TRANSIT rows at the transit speed ----- //
{
  // (?!label) skips the DEFINITION - it was counted as a third row, which is a check
  // reporting on its own subject's signature rather than on its call sites.
  const rows = (H.match(/transitRowHtml\((?!label)[^)]*\)/g) || []);
  check("14. both Lines-card transit rows are timed at the TRANSIT speed",
        () => rows.length === 2 && rows.every(r => /trSpd/.test(r)) &&
              /const trSpd\s*=\s*roleSpeedMS\("transit"\)/.test(H),
        () => rows.length + " row(s): " + rows.map(r=>r.slice(0,46)).join(" | ")
              + " — they are the two legs Andy names, and they used estSpd (survey)");
}

// --- 15. A LEAD-CARRYING LINE IS STILL A LINE, AND ITS SPEED NEVER CHANGES -- //
// The lead extension (tests/survey_lead.js) makes the RUN longer than the COVERAGE, and
// the two things that must survive it are exactly the two this suite is about:
//
//   * currentLegLine matches a leg on BOTH endpoints within LINE_MATCH_M. The committed
//     endpoints are the EXTENDED ones, and the waypoints pushed beside them are the same
//     points, so the match should be untouched — but "should be" is how the region hop got
//     flown at the turn speed for 304 s, so it is driven here rather than argued.
//   * the SPEED must not change at the coverage boundary. The whole purpose of a lead is
//     to arrive at the first usable ping already settled at the survey speed; a governor
//     that changed speed on entering the coverage would undo the feature at the exact
//     moment it is meant to be paying off.
{
  const LEAD_IN = 30, LEAD_OUT = 20;
  // The waypoints are COPIES of the endpoints, the way commitPattern writes them — not the
  // same objects. Sharing identity would make distTo exactly zero and leave check 15d
  // unable to feel any error at all, which is how it first passed against a mutated
  // LINE_MATCH_M of a ten-thousandth of a metre.
  const cp = p => ({ lat: p.lat, lon: p.lon });
  plan({
    lines: LINES.map(([a, b]) => ({ a: cp(a), b: cp(b), lead_in_m: LEAD_IN, lead_out_m: LEAD_OUT })),
    waypoints: LINES.flatMap(([a, b]) => [cp(a), cp(b)]),
  });
  // Fly line 1 end to end (150 m, wp index 1 = the leg a→b), reading the ACTIVITY.
  const phases = [], roles = [];
  for (let i = 0; i <= 30; i++) {
    const de = (150 * i) / 30;
    tick(0, de, 90, 1);
    const a = currentActivity();
    if (!phases.length || phases[phases.length - 1].act !== a.activity)
      phases.push({ act: a.activity, at: Math.round(de), surveying: a.surveying });
    if (!roles.length || roles[roles.length - 1] !== a.role) roles.push(a.role);
  }
  check("15. flying a lead-carrying line reports lead-in, then coverage, then lead-out",
        () => phases.length === 3 && phases[0].act === "lead-in"
              && phases[1].act === "surveying" && phases[2].act === "lead-out",
        () => phases.map(p => p.act + "@" + p.at + "m").join(" → ")
              + " on a 150 m run with a " + LEAD_IN + " m lead-in and a " + LEAD_OUT
              + " m lead-out — driven through accumLineTime and currentLegLine, not asserted");
  check("15b. ... and only the middle stretch is acquiring coverage",
        () => phases[0].surveying === false && phases[1].surveying === true
              && phases[2].surveying === false,
        () => phases.map(p => p.act + ":" + p.surveying).join(" ")
              + " — `surveying` is the flag that titles the readout \"acquiring coverage\"");
  check("15c. ... and the SPEED ROLE never changes across either boundary",
        () => roles.length === 1 && roles[0] === "survey",
        () => roles.length + " role(s) over the whole run: " + roles.join(" → ")
              + ". A change here would have the boat settling onto one speed and "
              + "surveying at another, which is the fault the lead exists to prevent");

  // ...and the line is still FOUND. A lead moves both committed endpoints outboard, and
  // currentLegLine matches on both of them.
  const found = LINES.map((_, k) => { window._wpIndex = 2 * k + 1; _legLine = { key: "", line: -1 };
                                      return currentLegLine(); });
  check("15d. every lead-carrying line is still matched by its own route leg",
        () => found.every((v, k) => v === k),
        () => "legs 1,3,5,7,9 → lines " + found.map(v => v + 1).join(", ")
              + " (all " + LINES.length + " found; -1 anywhere means the boat would fly "
              + "that line reported as an approach transit)");

  // ⚠ AND WHAT 15d IS ACTUALLY GUARDING AGAINST, shown rather than described. If a commit
  // wrote the COVERAGE ends as waypoints while the line kept its RUN ends — the obvious
  // way to get this wrong, since the coverage is what the operator drew — the endpoints
  // would be a lead apart and NOTHING would match. That is a whole survey flown and
  // reported as an approach transit, at the transit speed, with no error anywhere.
  const covWps = LINES.flatMap(([a, b]) => {
    const len = distTo(a, b);
    const at = (p, q, t) => ({ lat: p.lat + (q.lat - p.lat) * t, lon: p.lon + (q.lon - p.lon) * t });
    return [at(a, b, LEAD_IN / len), at(a, b, 1 - LEAD_OUT / len)];
  });
  const err = distTo(covWps[0], LINES[0][0]);
  mission.waypoints = covWps;
  const foundCov = LINES.map((_, k) => { window._wpIndex = 2 * k + 1; _legLine = { key: "", line: -1 };
                                         return currentLegLine(); });
  check("15e. ... and coverage ends written as waypoints would match NOTHING",
        () => foundCov.every(v => v === -1) && err > __matchM(),
        () => "coverage-end waypoints sit " + err.toFixed(0) + " m from the committed line "
              + "ends against a " + __matchM() + " m tolerance → lines "
              + foundCov.join(", ") + ". This is why the RUN ends are what is committed.");
  mission.waypoints = LINES.flatMap(([a, b]) => [cp(a), cp(b)]);
}

console.log("\n" + (fails ? fails + " CHECK(S) FAILED" : "all " + ran + " checks passed"));
process.exit(fails ? 1 : 0);

// TEETH - run against a SIDECAR copy of static/asv.html, never the real file, with
// `git diff` checked clean after each. Numbers are the checks that actually went red.
//
//   restore the sticky curTurn (drop the close branch)     -> 6c
//   drop isReversalGap from accumLineTime's turn test      -> 7, 7b   (THE REPORTED DEFECT)
//   make isReversalGap always true                         -> 3, 7, 7b, 11, 11b, 12
//   make isReversalGap always false                        -> 2, 6, 6c, 7d, 9, 11, 11b, 12
//   reversalScaleM measures a-to-a (turnZoneM's scale)     -> 1, 3, 7, 7b, 8, 9, 11, 11b, 12
//   1x the reversal scale instead of 4x                    -> 9
//   committedRoleLengths bills every gap as survey         -> 10, 11, 11b, 12
//   committedRoleLengths zeros instead of null, empty plan -> 13b
//   committedRoleLengths zeros instead of null, bad chain  -> 13
//   the Lines card's transit rows back to estSpd (survey)  -> 14
//
// 10 mutations, 10 killed, none survived and none crashed the suite.
//
// ⚠ THREE OF THEM SURVIVED THE FIRST CUT, AND EACH ONE WAS A HOLE WORTH THE RUN:
//
//   * "restore the sticky curTurn" survived, WHICH IS THE REPORTED DEFECT. The gap test
//     stops a region hop from ever opening a turn, so with it in place the close branch is
//     never reached along that path - the suite was testing one of the two halves of the
//     fix and scoring it as both. Check 6c drives the other: a reversal that opens and is
//     then carried wide without reaching a line.
//   * "1x instead of 4x" survived because check 9's first fixture had THREE lines, so the
//     gaps were [60, 120] and the median was 120 - the widened gap was its own yardstick
//     and the check passed at every multiplier. Five lines keep the median at the true
//     spacing, which is what makes it a test of the multiplier at all.
//   * "zeros instead of null" survived because committedRoleLengths refuses in TWO places
//     and check 13 only ever reached one of them. Both are asserted now, and the runner
//     carries a mutation for each.
