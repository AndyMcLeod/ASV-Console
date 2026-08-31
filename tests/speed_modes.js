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
//   * THE ROLE IS NOT RE-DERIVED - speedRole() ASKS currentActivity(), the classifier that
//     already decides what the boat is doing and that bills the line time. A second reading
//     of runLineIdx / curTurn would be free to disagree with it, and then the speed the boat
//     runs and the activity the recorder logs would describe different moments. It is not
//     hypothetical: `curTurn` survives a run stopped mid-reversal, so the direct reading
//     flies the Return-to-Home home at the TURN speed (check 16).
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
// TEETH: TWENTY-ONE mutations run against a sidecar copy of the page; the check numbers
// are the ones that actually went red, not the ones that looked likely.
//   speedRole: hard-code survey, ignoring the classifier      -> 2, 2b, 5, 6, 15, 15b, 16
//   speedRole: RE-DERIVE the role instead of asking it        -> 16
//   currentActivity: a chained RTH keeps a stale turn role    -> 16
//   currentActivity: a Go-To takes the survey speed           -> 15, 15b, 16
//   currentActivity: the approach out takes the survey speed  -> 2b, 15
//   governor: send every frame instead of only on change      -> 6
//   governor: ignore the clearance override                   -> 7
//   governor: drop the autonomous-command gate                -> 8, 8b
//   governor: ignore the per-gap slow-turn flag               -> 5
//   governor: command a heading as well as a speed            -> 5, 6, 9
//   governor: write the operator's setting back               -> 14
//   roleSpeed: fall back to "survey" not the legacy key       -> 4
//   page: the turn radius reads the SURVEY speed again        -> 10
//   page: the line-table times read the TURN speed            -> 11
//   page: an approach estimate reads the survey speed         -> 11b
//   page: the chart bar keeps its own speed selector          -> 12
//   page: the survey card loses its speed selects             -> 13
//   card: drops the commanded speed / the role row /          -> 17 / 17b /
//         the safety-override wording / the three settings       17c / 17d
//
// ⚠ "RE-DERIVE THE ROLE" IS CAUGHT BY CHECK 16 AND BY NOTHING ELSE, which is the point of
// having it: reading runLineIdx and curTurn directly gives the SAME answer everywhere
// except a run stopped mid-reversal, where `curTurn` is stale and the Return-to-Home that
// follows would be flown at the turn speed the whole way home.
//
// FOUR SURVIVED EARLIER PASSES, AND EVERY ONE WAS THE CHECK'S FAULT, NOT THE MUTATION'S:
//   * check 5 drove a world whose TURN speed already was "low", so a governor that ignored
//     the slow-turn flag still produced "low". The flag has to be the only thing that can.
//   * check 11b asserted ONE approach estimate where there are two (drawn and committed),
//     so a mutation changing the first left the second matching. It counts them now.
//   * check 17b matched the label "for", which the SAFETY OVERRIDE row one line up also
//     carries - so renaming only the role row left it green. It pins the whole statement.
//   * check 17d matched `row("speeds"`, which is still in the source when the statement is
//     disabled behind `if(false)`. It pins that the line STARTS with the emit. That is the
//     same "a fragment can be present while the code is dead" trap, twice in one card.


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
var mission, runLineIdx = -1, curTurn = -1, turnSeg = [], turnSlowAt = {}, lastRunLine = -1;
var S = null, clearance = { slowed: false }, asv = { lat: 0, lon: 0 };
var sent = [];
function cmd(path, body) { sent.push({ path, body }); }

// currentActivity IS the role classifier - speedRole just asks it. Grabbed rather than
// stubbed for that reason: a stub would let this suite pass against a page whose speed and
// whose recorded activity had drifted apart, which is the exact failure the single
// classifier exists to prevent.
// eslint-disable-next-line no-eval
eval(grabDecl("SPEED_ROLES") + "\n" + grab("currentActivity") + "\n" + grab("speedRole") + "\n" +
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
  mission = { speed: "survey", speeds: { ...THREE }, lines: [], ...(over || {}) };
  runLineIdx = -1; curTurn = -1; turnSeg = []; turnSlowAt = {}; lastRunLine = -1;
  clearance = { slowed: false };
  S = { run: "running", armed: true, estop: false, behavior: "survey", status: { holding: false } };
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
// 15. ANDY'S FOUR TRANSIT CASES, NAMED AND PINNED. He specified them outright: "Transit
// speed applies to goto, rth, and transits to the beginning of a survey and after the
// survey to home." Each is a different route into the same answer, and each is a place a
// future change could take a wrong turn - so each gets its own line rather than one check
// that happens to cover them all.
{
  const cases = [
    ["a Go-To", () => { world(); S.behavior = "goto"; onTransit(); }],
    ["an RTH", () => { world(); S.behavior = "rth"; onTransit(); }],
    ["the approach OUT to the survey", () => { world(); S.behavior = "survey"; onTransit(); }],
    ["a hop BETWEEN coverage regions", () => { world(); S.behavior = "survey"; onTransit(); lastRunLine = 4; }],
    ["a drawn transit line", () => { world(); S.behavior = "transit"; onTransit(); }],
  ];
  const wrong = cases.filter(([, set]) => { set(); return speedRole() !== "transit"; })
                     .map(([n]) => n + "=" + speedRole());
  check("15. every case Andy named takes the TRANSIT speed",
        () => wrong.length === 0,
        wrong.length ? wrong.join(", ") : cases.map(c => c[0]).join(" · ") + " — all transit");
  // ... and the RTH that chains at the end of a survey is the SAME branch as a commanded
  // one, which is what makes "after the survey to home" true without a special case.
  world(); S.behavior = "rth"; runLineIdx = -1; curTurn = -1;
  check("15b. ... including the RTH that CHAINS at the end of a survey",
        () => speedRole() === "transit" && roleSpeed("transit") === "high",
        "it arrives as behavior 'rth', so it is the same branch as a commanded RTH");
}
// 16. ⚠ AND A STALE TURN DOES NOT LEAK INTO IT. `curTurn` is cleared only when a line is
// ENTERED or a fresh run resets the stats, so a survey STOPPED MID-REVERSAL leaves it set.
// A speedRole() that read curTurn directly - which the first cut of this feature did -
// would then fly the whole way home at the TURN speed. The classifier asks what the
// BEHAVIOUR is before it looks at either variable, and this check is that claim.
{
  world(); inTurn(2);                       // a reversal is under way ...
  const during = speedRole();
  S.behavior = "rth";                       // ... the run stops and an RTH chains
  check("16. a run stopped MID-TURN does not fly the RTH home at the turn speed",
        () => during === "turn" && speedRole() === "transit",
        "in the reversal: " + during + "; then behavior 'rth' with curTurn still "
          + curTurn + " -> " + speedRole());
}
// 17. THE INTENT CARD CARRIES THE VALUES. Andy: "Add speed values to the intent card."
// Three layers, because a single number answers none of the questions once there are three
// speeds: what the boat is MAKING GOOD, what it was TOLD and for which role, and the
// operator's three settings - so a value can be checked without opening the survey card.
{
  const RI = grab("renderIntent");
  check("17. the Intent card shows the commanded speed beside the actual one",
        () => /row\("speed"/.test(RI) && /st\.sog_kn\.toFixed\(1\)/.test(RI) &&
              /told " \+ st\.speed_key/.test(RI),
        "actual + 'told <key> (<kn>)' - two different quantities, and both matter");
  // ⚠ PINNED TO THE ROW THAT CARRIES THE ROLE, not to the label "for" - which also appears
  // on the SAFETY OVERRIDE row one line up, so a mutation that renamed only the role row
  // left this green. A fragment can be present while the code that uses it is dead.
  check("17b. ... names the ROLE it is running, and why",
        () => /html \+= row\("for", spRole\.toUpperCase\(\) \+ " — " \+ act\.detail/.test(RI),
        "so 14 kn in the middle of a survey reads as TRANSIT — approach to the survey area");
  check("17c. ... and says SAFETY OVERRIDE instead when the clearance guard has the throttle",
        () => /row\("for", "SAFETY OVERRIDE/.test(RI) && /if\(clearance\.slowed\)/.test(RI),
        "because then the role is not why the boat is slow, and naming it would mislead");
  // ⚠ AND IT IS EMITTED UNCONDITIONALLY. `row("speeds"` was still in the source with the
  // statement disabled behind `if(false)`, and this check passed - the same trap as 17b.
  // The assertion is that the line STARTS with the emit, so a guard in front of it fails.
  const speedsRow = (RI.split(/\r?\n/).find(l => /row\("speeds"/.test(l)) || "");
  check("17d. ... and lists all three settings, marking the live one",
        () => /^\s*html \+= row\("speeds",\s*SPEED_ROLES\.map/.test(speedsRow) &&
              /r === spRole && !clearance\.slowed/.test(RI),
        "emitted unconditionally: " + JSON.stringify(speedsRow.trim().slice(0, 52)));
}
// 18. ⚠ THE SETTING SURVIVES A LOAD - a real bug found in a running console, not a
// hypothetical. loadMission() rebuilds `mission` from an EXPLICIT WHITELIST of fields, so
// anything missing from that list is silently dropped, and `speeds` was. The migration
// below it then refilled all three roles from `mission.speed` - which is NOT the operator's
// setting but the last value the GOVERNOR commanded. A mission holding
// {transit:high, turn:low, survey:survey} came back as {high, high, high} the moment the
// boat had been told "high" once, and the next save wrote that over the real setting.
//
// EVERY CHECK ABOVE PASSED THROUGHOUT. They drive `mission` directly and none of them goes
// through the rebuild - which is exactly why it took reading the Intent card's own speeds
// row in a live console to see it.
{
  const LM = grab("loadMission");
  check("18. loadMission carries `speeds` through its field whitelist",
        () => /speeds:\s*m\.speeds/.test(LM),
        "a field absent from that rebuild is DROPPED, and the migration then refills it "
          + "from mission.speed — the COMMANDED value, not the setting");
  // ... and the migration fills only what is MISSING, so a role that arrived from the
  // server is never overwritten by the commanded value.
  check("18b. ... and the migration fills only the roles that are absent",
        () => /if\(!mission\.speeds\[r\]\) mission\.speeds\[r\] = mission\.speed/.test(LM),
        "`if (!...)` — a role that arrived from the server keeps what it arrived with");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
