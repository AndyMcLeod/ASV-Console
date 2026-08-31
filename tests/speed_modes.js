// tests/speed_modes.js - one speed became three, and the console governs which one.
//
// Andy, 2026-08-31: "Vessel speed should be selectable for various modes. Allow separate
// speed selection for transits, turns, and survey. These values may be temporarily
// over-ridden for safety of vessel situations. Remove the old speed selection function
// from the chart bar and implement in the survey card."
//
// A survey run is THREE JOBS and they do not want one speed. The coverage lines want the
// speed the sensor is specified at; the reversals want a speed whose radius the hull can
// hold - and a slower turn reaches LESS FAR outboard, which is what the wharf incident
// earlier the same day was short of; the transits out and home want whatever wastes least
// time. So the console now commands the speed the CURRENT JOB wants, as the run moves
// between them.
//
//   node tests/speed_modes.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// The rules this suite encodes, each of which is a way to get it wrong:
//   * THE ROLE IS NOT RE-DERIVED. It comes off runLineIdx and curTurn - the same two
//     variables accumLineTime maintains and currentActivity reads. A second classifier
//     would be free to disagree with the one that bills the time, and then the speed the
//     boat runs and the activity the recorder logs would describe different moments.
//   * `speeds` is the OPERATOR'S SETTING; `speed` beside it is WHAT THE BOAT IS COMMANDED
//     NOW. Two fields on purpose: the governor changes the commanded value several times a
//     minute, and folding that back into the setting would eat the operator's choice. That
//     is the completion-field lesson, one field over.
//   * SAFETY OUTRANKS THE ROLE. While the clearance guard holds the boat slow, the
//     governor does nothing at all.
//   * IT SENDS ONLY ON CHANGE, and only under autonomous command.
//   * MIGRATION IS A NO-OP. A mission that predates this starts all three roles at the
//     legacy single value, so nobody's boat changes speed because they pulled a build.
//   * THE TURN RADIUS BELONGS TO THE TURN SPEED. This is the one that is a safety change
//     rather than a convenience: a hull holds v/omega, so the radius a reversal is BUILT at
//     must be the speed it is FLOWN at.
//
// TEETH: FOURTEEN mutations run against a sidecar copy of the page; the check numbers are
// the ones that actually went red, not the ones that looked likely.
//   speedRole: report "survey" whenever a plan is running      -> 2, 2b, 5, 5b, 6
//   speedRole: ignore curTurn, so a turn reads as a transit    -> 2, 5, 5b, 6
//   governor: send every frame instead of only on change       -> 6
//   governor: ignore the clearance override                    -> 7
//   governor: drop the autonomous-command gate                 -> 8, 8b
//   governor: ignore the per-gap slow-turn flag                -> 5
//   governor: command a heading as well as a speed             -> 5, 6, 9
//   governor: write the operator's setting back                -> 14
//   roleSpeed: fall back to "survey" instead of the legacy key -> 4
//   page: the turn radius reads the SURVEY speed again         -> 10
//   page: the line-table times read the TURN speed             -> 11
//   page: an approach estimate reads the survey speed          -> 11b
//   page: the chart bar keeps its own speed selector           -> 12
//   page: the survey card loses its speed selects              -> 13
//
// TWO SURVIVED THE FIRST PASS, AND BOTH WERE FIXTURES THAT COULD NOT DISCRIMINATE:
//   * check 5 drove the default world, whose TURN speed already is "low" - so a governor
//     that ignored the slow-turn flag entirely still produced "low" and the check passed
//     against code that had never heard of the flag. It sets the operator's turn speed to
//     something else now, so the flag is the only thing that can produce "low".
//   * check 11b asserted ONE approach estimate. There are two - punchOut's, for a pattern
//     still being drawn, and recalcCommittedForSpeed's, for one committed - and a mutation
//     that changed the first left the second matching. It counts them now.

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
const { V } = require("../static/js/state.js");

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}

let fails = 0;
function check(name, cond, detail) {
  let ok = false, err = "";
  try { ok = (typeof cond === "function") ? !!cond() : !!cond; }
  catch (e) { ok = false; err = " THREW " + (e && e.message ? e.message : e); }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : "") + err);
  if (!ok) fails++;
}

// ---- the page's world, as the governor reads it ------------------------------------- //
V.SPEED_KN = { low: 4.0, survey: 7.0, high: 14.0 };
var mission, runLineIdx = -1, curTurn = -1, turnSeg = [], turnSlowAt = {};
var S = null, clearance = { slowed: false }, asv = { lat: 0, lon: 0 };
var sent = [];
function cmd(path, body) { sent.push({ path, body }); }

// eslint-disable-next-line no-eval
eval(grabDecl("SPEED_ROLES") + "\n" + grab("speedRole") + "\n" +
     grab("roleSpeed") + "\n" + grab("roleSpeedMS") + "\n" +
     grabDecl("commandedSpeed") + "\n" + grab("speedGovernor") + "\n" +
     "function __setCommanded(v){ commandedSpeed = v; }\n" +
     "function __commanded(){ return commandedSpeed; }\n" +
     // A `const` declared inside a direct eval stays in the EVAL's scope - only the
     // function declarations bind out here - so this is how the checks below read the
     // page's OWN SPEED_ROLES rather than a copy restated in this file, which would be a
     // reference reading its subject's numbers back to it.
     "function __roles(){ return SPEED_ROLES; }");
const SPEED_ROLES = __roles();

const THREE = { transit: "high", turn: "low", survey: "survey" };
function world(over) {
  mission = { speed: "survey", speeds: { ...THREE }, ...(over || {}) };
  runLineIdx = -1; curTurn = -1; turnSeg = []; turnSlowAt = {};
  clearance = { slowed: false };
  S = { run: "running", armed: true, estop: false, status: { holding: false } };
  sent = []; __setCommanded(null);
}
const onLine = () => { runLineIdx = 3; curTurn = -1; };
const inTurn = (from) => { runLineIdx = -1; curTurn = 0; turnSeg = [{ from: from == null ? 2 : from, to: -1, sec: 0 }]; };
const onTransit = () => { runLineIdx = -1; curTurn = -1; };

console.log("Speed by mode - three settings, and the console governs which one is live:");

// 1-2. THE ROLE, off the two variables that already answer this question. Not a second
// classifier: accumLineTime maintains these every tick and currentActivity reads the same
// pair, so the speed the boat runs and the activity the recorder logs cannot describe
// different moments.
{
  world(); onLine();
  check("1. on a coverage line the role is SURVEY", () => speedRole() === "survey", speedRole());
  inTurn();
  check("2. in a reversal between lines the role is TURN", () => speedRole() === "turn", speedRole());
  onTransit();
  check("2b. anywhere else - approach, region hop, Go-To, RTH - it is TRANSIT",
        () => speedRole() === "transit", speedRole());
}
// 3. ... and each role resolves to ITS OWN key, which is the whole point of the feature.
{
  world(); onLine();
  const s = roleSpeed("survey"); inTurn(); const t = roleSpeed("turn");
  onTransit(); const x = roleSpeed("transit");
  check("3. the three roles resolve to three different speeds",
        () => s === "survey" && t === "low" && x === "high" &&
              roleSpeedMS("transit") > roleSpeedMS("survey") &&
              roleSpeedMS("survey") > roleSpeedMS("turn"),
        `survey ${s} ${roleSpeedMS("survey").toFixed(2)} m/s · turn ${t} `
          + `${roleSpeedMS("turn").toFixed(2)} · transit ${x} ${roleSpeedMS("transit").toFixed(2)}`);
}
// 4. MIGRATION IS A NO-OP. A mission that predates this has no `speeds`, and every role
// must answer with the legacy single value - not with a default, which would silently
// change what somebody's boat does the day they pull a new build.
{
  world({ speed: "high", speeds: undefined });
  check("4. a mission with only the legacy `speed` answers every role with it",
        () => SPEED_ROLES.every(r => roleSpeed(r) === "high"),
        SPEED_ROLES.map(r => r + "=" + roleSpeed(r)).join(" "));
  // ... and an unknown key (a vessel that has no such speed) falls back rather than being
  // commanded: /api/cmd/speed REFUSES a key the vessel lacks, so sending it is a dead end.
  world({ speed: "survey", speeds: { transit: "warp", turn: "low", survey: "survey" } });
  check("4b. ... and a key this vessel does not have falls back instead of being commanded",
        () => roleSpeed("transit") === "survey" && roleSpeed("turn") === "low",
        "transit 'warp' -> " + roleSpeed("transit"));
}
// 5. A TURN THE PLANNER COULD ONLY FIT AT THE SLOW RADIUS IS FLOWN AT THE SLOW SPEED.
// The radius that made it fit is the radius the hull holds at that speed; running it any
// faster flies a turn the boat cannot track, which is the failure the whole day was about.
{
  // ⚠ THE OPERATOR'S TURN SPEED IS DELIBERATELY NOT "low" HERE. The first draft of this
  // check used the default fixture, whose turn speed already IS low - so ignoring the flag
  // entirely produced "low" anyway and the check could not tell the two apart. It passed
  // against a governor that had never heard of the flag. The flag has to be the ONLY thing
  // that can produce "low", or this proves nothing.
  const HIGHTURN = { transit: "high", turn: "survey", survey: "survey" };
  world({ speeds: { ...HIGHTURN } }); inTurn(2); turnSlowAt[2] = true;
  const got = speedGovernor();
  check("5. a turn that only fitted at the slow radius is FLOWN slow",
        () => got === "low" && sent.length === 1 && sent[0].body.speed === "low",
        "operator's turn speed is '" + HIGHTURN.turn + "'; gap 2 flagged -> commanded " + got);
  world({ speeds: { ...HIGHTURN } }); inTurn(2);            // same turn, NOT flagged
  check("5b. ... and one that did not is flown at the operator's turn speed",
        () => speedGovernor() === "survey",
        "unflagged gap -> " + roleSpeed("turn") + ", the operator's own choice");
}
// 6. IT SENDS ONLY ON CHANGE. /api/cmd/speed is a real command the server persists and the
// session log records; four a second would fill the recording with noise for nothing.
{
  world(); onLine();
  speedGovernor(); speedGovernor(); speedGovernor();
  const after = sent.length;
  inTurn();
  speedGovernor(); speedGovernor();
  check("6. the governor commands only when the wanted speed CHANGES",
        () => after === 1 && sent.length === 2 &&
              sent[0].body.speed === "survey" && sent[1].body.speed === "low",
        "three frames on line -> " + after + " command(s); then two in a turn -> "
          + sent.length + " total: " + sent.map(s => s.body.speed).join(","));
}
// 7. SAFETY OUTRANKS THE ROLE. While the clearance guard holds the boat slow the governor
// does nothing at all - it does not re-assert the role speed underneath it, which would be
// the guard and the governor fighting over the throttle at 4 Hz.
{
  world(); onLine(); clearance.slowed = true;
  const got = speedGovernor();
  check("7. while the clearance guard holds the boat slow, the governor stands off",
        () => got === null && sent.length === 0,
        "commanded " + JSON.stringify(sent.map(s => s.body.speed)));
}
// 8. AND IT COMMANDS NOTHING UNLESS THE BOAT IS UNDER AUTONOMOUS COMMAND - the same gate
// the clearance guard uses. A speed sent while the operator is driving on RC is the console
// taking a control it was never given.
{
  const cases = [["not running", { run: "stopped" }], ["disarmed", { armed: false }],
                 ["E-STOP", { estop: true }], ["holding", { status: { holding: true } }]];
  const bad = [];
  for (const [why, over] of cases) {
    world(); onLine(); S = { ...S, ...over };
    if (speedGovernor() !== null || sent.length) bad.push(why);
  }
  check("8. it commands nothing unless running, armed, not E-STOPped and not holding",
        () => bad.length === 0, bad.length ? "commanded while " + bad.join(", ") : "silent in all four");
  // ... and a stopped boat forgets what it commanded, so a fresh run re-asserts from zero
  // rather than assuming the boat still holds a speed from the last run.
  world(); onLine(); speedGovernor(); S.run = "stopped"; speedGovernor();
  check("8b. ... and a stopped boat is re-governed from scratch on the next start",
        () => __commanded() === null, "commandedSpeed after stop: " + __commanded());
}
// 9. THE CONSOLE NEVER STEERS. The whole intervention is a speed; anything commanding a
// heading, a waypoint or a behaviour from here is out of scope by design.
{
  const G = grab("speedGovernor");
  check("9. the governor's only command is a SPEED - it never steers",
        () => (G.match(/cmd\("[^"]+"/g) || []).every(c => c === 'cmd("/api/cmd/speed"'),
        "commands issued: " + JSON.stringify([...new Set(G.match(/cmd\("[^"]+"/g) || [])]));
}
// 10. THE TURN RADIUS BELONGS TO THE TURN SPEED, and this is the one that is a safety
// change rather than a convenience. A hull holds v/omega, so the radius every generated
// reversal is BUILT at has to be the speed it is FLOWN at - and a slower turn is tighter
// and reaches less far outboard, which is exactly the clearance the wharf incident lacked.
{
  const PO = grab("punchOut"), RC = grab("recalcCommittedForSpeed");
  check("10. every turn radius is derived from the TURN speed, not the survey speed",
        () => /const minTurnR = minTurnRadiusM\(roleSpeed\("turn"\)\)/.test(PO) &&
              /minTurnRadiusM\(roleSpeed\("turn"\)\)/.test(RC) &&
              !/minTurnRadiusM\(mission\.speed/.test(H),
        "punchOut builds them and recalcCommittedForSpeed re-checks them; both read the turn role");
}
// 11. AND EACH ESTIMATE IS QUOTED AT THE SPEED THAT GOVERNS IT. A per-line plan time is
// coverage; an approach is a transit. Quoting one speed for both was right only while
// there was one speed.
{
  check("11. the per-line plan times are computed at the SURVEY speed",
        () => /function buildLineTable\(\)\{ const spd=roleSpeedMS\("survey"\)/.test(H),
        "a LINE is coverage, by construction");
  // BOTH of them: punchOut computes the approach for a pattern still being drawn, and
  // recalcCommittedForSpeed for one already committed. Asserting a single occurrence let a
  // mutation change one and leave the other matching - found by exactly that mutation.
  const approaches = (H.match(/fmtDur\(approachLen\s*\/\s*\w+\)/g) || []);
  check("11b. ... and EVERY approach estimate at the TRANSIT speed",
        () => /const spd=roleSpeedMS\("survey"\), spdT=roleSpeedMS\("transit"\)/.test(H) &&
              approaches.length === 2 && approaches.every(a => /spdT\)$/.test(a)),
        approaches.length + " approach estimate(s): " + approaches.join(", ")
          + " - drawn and committed, both timed as the transit they are");
}
// 12-13. THE UI MOVED, WHICH IS HALF OF WHAT WAS ASKED FOR. One selector on the command bar
// became three, and three selects on a bar that has to stay readable at a glance is the
// wrong home; they belong with the rest of the plan's parameters.
{
  check("12. the old speed selector is GONE from the chart command bar",
        () => !/id="c_speed"/.test(H) && !/\$\("#c_speed"\)/.test(H),
        "no markup and no handler left behind");
  check("13. ... and the survey card carries one select per role",
        () => SPEED_ROLES.every(r => new RegExp('id="sp_spd_' + r + '"').test(H)) &&
              /id="linePanel"/.test(H) &&
              H.indexOf('id="sp_spd_survey"') > H.indexOf('id="linePanel"'),
        "sp_spd_survey / sp_spd_turn / sp_spd_transit, inside #linePanel");
  // The card is BRIDGED to the controls window, so the split layout gets them too - a
  // control only reachable in one of the two windows is how the split grows a hole.
  check("13b. ... and #linePanel is bridged, so the controls window has them as well",
        () => /UI_BRIDGED = \[[^\]]*"#linePanel"/.test(H),
        "otherwise the speeds are unreachable whenever the operator splits the windows");
}
// 14. THE OPERATOR'S SETTING AND THE COMMANDED VALUE ARE TWO FIELDS. The governor writes
// the second several times a minute; if that fed back into the first it would eat the
// operator's choice. Same shape as the completion field, one over.
{
  const gov = grab("speedGovernor"), guard = grab("clearanceGuard");
  check("14. neither the governor nor the safety override writes the operator's setting",
        () => !/mission\.speeds\s*=/.test(gov) && !/mission\.speeds\s*=/.test(guard) &&
              !/saveMission\(\)/.test(gov) && !/saveMission\(\)/.test(guard),
        "mission.speeds is written by the survey card's handler and by nothing else");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
