// tests/speed_recalc.js - the plan speed is an INPUT to the plan, not a label on it.
//
// Andy's report: the speed selection is not monitored when a change of speed for a given
// plan is suggested; speed and end-of-plan settings should initiate recalculation on user
// input.
//
// The "suggested" part is what makes this sharp. Punch Out ALREADY advises on speed - when
// the line spacing is tighter than twice the minimum turn radius the boat can hold, it
// quotes the spacing a plain reversal would need at the plan speed AND the spacing needed
// at low speed, precisely so the operator can choose between widening the lines and slowing
// down. Acting on that advice changed nothing. `#c_speed` saved the value and recomputed
// NOTHING: the turn geometry, the survey and approach durations, the per-line planned
// times and the to-end estimate all still described the old speed.
//
// ADVICE THE CONSOLE THEN IGNORES IS WORSE THAN NO ADVICE.
//
//   node tests/speed_recalc.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// This suite covers the part that can hurt someone. Where a pattern is still drawn the
// recalculation is just punchOut() run again, which its own suites already cover. Where the
// plan is COMMITTED it cannot be re-punched - the anchors are gone - so the console has to
// decide whether the committed turns are still flyable at the new speed:
//
//   SLOWING DOWN  is always safe. The minimum radius shrinks, so every existing turn
//                 remains within what the boat can hold.
//   SPEEDING UP   can make a reversal untrackable, and THE PLAN LOOKS IDENTICAL ON THE
//                 CHART. That is the case that has to be reported.
//
// TEETH (verified by mutation, not assumed): compare the spacing against `minTurnRadiusM`
// instead of TWICE it and 2, 3 and 5b fail - the threshold is a DIAMETER, because a
// reversal has to fit a half-circle between the lines, not a radius. Warn on every speed
// change rather than only when the geometry fails and 1, 4, 5 and 5b fail (cry-wolf is a
// regression, not a safety margin). Never clear a raised warning and 5b fails. Compute the
// durations at a fixed speed instead of the mission's and 7 fails; stop recomputing them
// at all and 6, 7 and 7b fail.
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

// Layer-0 helpers come from the real modules now (2026-08-09), not lifted out of
// asv.html as source text: a renamed or deleted export fails HERE instead of quietly
// falling back to a stale copy. Top-level, so the DIRECT eval() below still resolves
// them through its lexical scope.
const { distTo, llEN } = require("../static/js/geodesy.js");
const { fmtDist, fmtDur, fmtMS } = require("../static/js/units.js");
const { nogo } = require("../static/js/state.js");   // transitEstKey reads the REAL model's identity

// The vessel-derived parameter block lives in static/js/state.js now (2026-08-09). The
// page functions eval'd below read V.NOGO_BUFFER_M / V.MAX_TURN_RATE_DEG_S / ..., so the
// suite hands them the SAME object the page mutates rather than a stub - a check that
// leans on a vessel default is then reading the real one.
const { V } = require("../static/js/state.js");
// minTurnRadiusM moved out of asv.html into its own module (2026-08-20). Required
// rather than grabbed, so the eval'd page functions below still see it by name.
const { minTurnRadiusM } = require("../static/js/turns.js");

// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes
// its mutants to a file this suite never reads and scores every one as SURVIVED (audited
// 2026-09-21: 21 of the 53 suites reading this page had no override).
const H = fs.readFileSync(process.env.ASV_HTML
                || path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
// A module-level `const X = ...;` pulled out verbatim - the REAL tuning value, not a copy.
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!cond) fails++;
}

// The two shipped hulls' figures, as the turn-geometry suite uses them.
var M_PER_DEG_LAT = 111320;
V.SPEED_KN = { low: 4.0, survey: 7.0, high: 14.0 }, MAX_TURN_RATE_DEG_S = 20;
var mission = { speed: "survey", speeds: { transit: "survey", turn: "survey", survey: "survey" },
                lines: [], waypoints: [] };
var speedWarnShown = false;   // the page declares this beside the function; the harness must too
// distUnit lives in units.js now - setDistUnit() is the only way in.   // fmtDist's globals - km keeps the legacy km shape here
var asv = null;
var banners = [], notes = [];
function showBanner(t) { banners.push(t); const b = $("#encbanner"); b.textContent = t; b.style.display = "block"; }
function flashNote(t) { notes.push(t); }
// the DOM the recalculation writes into
var EL = {};
function $(sel) { return (EL[sel] = EL[sel] || { textContent: "", style: {} }); }
// The transit/RTH estimator calls the page's planNogoRoute; the harness scripts it so a
// check can hand back a routed detour, a refusal, or a degraded direct answer at will —
// and RECORDS the endpoints each call was asked for, which is what checks 10/10b assert.
var S = null;
var planCalls = [], planScript = {};
function planNogoRoute(from, to) {
  planCalls.push({ from: { ...from }, to: { ...to } });
  const r = planScript;
  if (r.error) return { error: r.error };
  const route = (r.route || [to]).map(p => ({ ...p }));
  return { route, degraded: !!r.degraded, routed: route.length > 1, lane: false };
}
// eslint-disable-next-line no-eval
eval(
     grabDecl("TRANSIT_REKEY_M") + "\n" +
     // SPEED BY ROLE (2026-08-31): recalcCommittedForSpeed reads the TURN speed for its
     // radius check and the SURVEY / TRANSIT speeds for its two duration rows, all through
     // these two helpers. GRABBED, not stubbed - a stub would let this suite pass against
     // a page that had stopped honouring the roles at all.
     grabDecl("SPEED_ROLES") + "\n" +
     grab("roleSpeed") + "\n" + grab("roleSpeedMS") + "\n" +
     // The banner's prefix, GRABBED so check 5b tests the page's real coupling: the warning
     // and the branch that clears it share this one string, and they did not until the
     // rename to "Turn speed" broke the clear and this suite caught it.
     grabDecl("SPEED_WARN_PREFIX") + "\n" +
     grab("committedPatternInfo") + "\n" +
     // committedPatternInfo counts DRAWN lines (review #18) - the page's own numbering, not a stub
     grab("lineSetKey") + "\n" + grabDecl("LINE_PART_OFFSET_M") + "\n" + grabDecl("_drawnLines") + "\n" + grab("linePartContinues") + "\n" +
     grab("drawnLines") + "\n" + grab("lineNo") + "\n" + grab("lineCount") + "\n" + grab("linePartTxt") + "\n" +
     // ROLE-BILLED ESTIMATE (2026-09-05): recalcCommittedForSpeed no longer divides the
     // whole chain by one speed - it totals it BY ROLE through committedRoleLengths, which
     // tells a reversal from a region hop with isReversalGap. GRABBED, all three, for the
     // same reason as the helpers above: a stub would hold this suite green while the
     // estimate and the boat disagreed about what a leg is. When this suite went red at
     // "committedRoleLengths is not defined" it was reporting a real new dependency in
     // the function it drives, and that is the suite working.
     grabDecl("LINE_MATCH_M") + "\n" +
     grab("reversalScaleM") + "\n" + grab("isReversalGap") + "\n" +
     grab("committedRoleLengths") + "\n" +
     grab("recalcCommittedForSpeed") + "\n" +
     grab("routeLenM") + "\n" + grab("transitEstBoat") + "\n" +
     grab("transitEstKey") + "\n" + grab("transitEstCompute") + "\n" +
     grab("transitRowHtml"));

const LAT0 = 38.7896, LON0 = -75.1609;
const mPerLon = M_PER_DEG_LAT * Math.cos(LAT0 * Math.PI / 180);
const at = (e, n) => ({ lat: LAT0 + n / M_PER_DEG_LAT, lon: LON0 + e / mPerLon });
// A committed boustrophedon: `n` lines, `len` long, `sp` apart, with waypoints in run order.
function commit(n, len, sp) {
  const lines = [], wps = [];
  for (let i = 0; i < n; i++) {
    const e = i * sp, a = at(e, 0), b = at(e, len);
    const [p, q] = i % 2 ? [b, a] : [a, b];
    lines.push({ a: p, b: q }); wps.push(p, q);
  }
  mission = { speed: mission.speed, speeds: mission.speeds, lines, waypoints: wps };
}
// The radius a committed reversal needs is set by the TURN speed now, not by a single
// plan speed - so this drives all three roles together. That is exactly the state a
// console that has never been told otherwise is in, which is what keeps every
// expectation below unchanged by the split.
function run(speed) {
  mission.speed = speed;
  mission.speeds = { transit: speed, turn: speed, survey: speed };
  banners = []; recalcCommittedForSpeed(); return banners.join(" ");
}

// At 20 deg/s the minimum radius is 1.4 * v / omega, so a plain reversal needs 2x that:
const need = s => 2 * minTurnRadiusM(s);

console.log("Speed recalculation — the plan speed is an input to the plan:");
console.log("  (survey needs " + need("survey").toFixed(1) + " m of spacing, low needs "
            + need("low").toFixed(1) + " m)");

// 1. Comfortable spacing, any speed: nothing to report. Without this the suite would pass
// for a console that shouted on every speed change, which is its own kind of useless.
commit(6, 400, 60);
check("1. spacing the boat can turn in reports nothing, at any speed",
      run("low") === "" && run("survey") === "",
      "60 m spacing vs " + need("survey").toFixed(1) + " m needed");

// 2-3. THE CASE THAT CAN HURT. Spacing between what LOW needs and what SURVEY needs: the
// committed plan is flyable slowly and not at survey speed, and it looks identical either
// way on the chart.
const tight = (need("low") + need("survey")) / 2;
commit(6, 400, tight);
check("2. SPEEDING UP past what the committed spacing supports is reported",
      /re-draw and Punch Out|drop the speed/.test(run("survey")),
      tight.toFixed(1) + " m spacing at survey speed");
check("3. ... and the report quotes both the spacing and what the speed needs",
      run("survey").indexOf(tight.toFixed(1)) >= 0
        && run("survey").indexOf(need("survey").toFixed(1)) >= 0,
      "the operator can act on numbers, not a symptom");
check("4. ... while the SAME plan at low speed is fine and says nothing",
      run("low") === "",
      "slowing down only ever shrinks the radius");

// 5. The check is about geometry, not about the act of changing speed.
commit(6, 400, need("high") + 20);
check("5. a plan comfortable even at high speed stays quiet there",
      run("high") === "", "no cry-wolf");

// 5b. A WARNING THAT DOES NOT CLEAR IS A WRONG READOUT. Caught live: speeding up warned
// correctly, and slowing back down left the warning on screen saying the plan could not be
// flown at a speed it was no longer set to.
commit(6, 400, tight);
run("survey");                                     // warn
const cleared = (run("low"), EL["#encbanner"] && EL["#encbanner"].style.display);
check("5b. ... and slowing back down CLEARS a warning it raised",
      cleared === "none", "banner display after slowing back: " + cleared);

// 6-8. The durations are the other half of "recalculate on input" - they were computed
// once at Punch Out and then described whatever speed was set at the time, forever.
commit(4, 500, 40);
mission.speed = "survey"; mission.speeds = { transit:"survey", turn:"survey", survey:"survey" };
banners = []; recalcCommittedForSpeed();
const atSurvey = $("#v_surveydur").textContent;
mission.speed = "low"; mission.speeds = { transit:"low", turn:"low", survey:"low" };
recalcCommittedForSpeed();
const atLow = $("#v_surveydur").textContent;
check("6. the survey duration is recomputed when the speed changes",
      atSurvey !== atLow && atSurvey !== "--" && atLow !== "--",
      "survey=" + atSurvey + "  low=" + atLow);
// Parse the rendered duration back to seconds, so this is a real comparison rather than
// "a string changed" - the first version of this check asserted `true` and would have
// passed for any two different strings at all.
const secs = t => { const h = /(\d+)h/.exec(t), m = /(\d+)m/.exec(t), s = /\b(\d+)s/.exec(t);
                    return (h ? +h[1]*3600 : 0) + (m ? +m[1]*60 : 0) + (s ? +s[1] : 0); };
const ratio = V.SPEED_KN.survey / V.SPEED_KN.low;
check("7. ... and it is longer by the SPEED RATIO, not merely different",
      Math.abs(secs(atLow) / secs(atSurvey) - ratio) < 0.12,
      secs(atLow) + "s / " + secs(atSurvey) + "s = " + (secs(atLow)/secs(atSurvey)).toFixed(2)
        + " vs " + ratio.toFixed(2) + " expected");
check("7b. ... and each row names the speed it was computed at",
      atSurvey.indexOf("@ survey") >= 0 && atLow.indexOf("@ low") >= 0,
      atSurvey + "  |  " + atLow);
// 8. Degrade safely - this runs from a UI handler, and throwing in it would take the
// command bar down with it.
mission = { speed: "survey", speeds: { transit:"survey", turn:"survey", survey:"survey" },
            lines: [], waypoints: [] };
check("8. an empty plan degrades to '--', it does not throw",
      (() => { try { recalcCommittedForSpeed();
                     return $("#v_surveydur").textContent === "--"; }
               catch (e) { return false; } })());

// --- 9-15: the Lines card's transit + RTH rows (Andy's ask, 2026-08-10) --------------- //
// "Transit time to survey area and RTH time home." The number quoted must be the ROUTED
// distance over the CURRENT plan speed — the vessel card's straight-line #v_approach is
// exactly the shortcut these rows exist to improve on (at Lewes the straight line from
// the pier to the survey area crosses land). The estimator is scripted here through a
// recorded planNogoRoute, so every claim below is about OUR wiring, not the router's.
nogo.ready = true; nogo.band = "enc_harbour"; nogo.buffer = 5;

// 9. The distance is the ROUTE's length, leg by leg — not boat-to-target as the crow flies.
{
  const from = at(0, 0), dog = at(300, 400), end = at(0, 800);   // dogleg: 500+500 vs 800 direct
  const m = routeLenM(from, [dog, end]);
  check("9. routeLenM walks the routed legs, not the straight line",
        Math.abs(m - 1000) < 2 && m - distTo(from, end) > 190,
        m.toFixed(0) + " m routed vs " + distTo(from, end).toFixed(0) + " m direct");
}

// 10. Transit routes BOAT -> FIRST waypoint; RTH routes LAST waypoint -> HOME. The wrong
// endpoints produce a plausible number describing a route nobody will fly.
commit(3, 400, 60);
asv = at(-500, -500); S = { run: "idle", home: at(-600, 0) };
planCalls = []; planScript = {};
{
  const r = transitEstCompute(asv, mission.waypoints, S.home);
  const wps = mission.waypoints, last = wps[wps.length - 1];
  check("10. the transit leg is boat -> FIRST waypoint",
        planCalls.length === 2
          && distTo(planCalls[0].from, asv) < 1 && distTo(planCalls[0].to, wps[0]) < 1,
        "call 1: " + (planCalls[0] ? "boat->wp0 offsets " + distTo(planCalls[0].from, asv).toFixed(1)
          + "/" + distTo(planCalls[0].to, wps[0]).toFixed(1) + " m" : "never made"));
  check("10b. the RTH leg is LAST waypoint -> home, and the boat is not in it",
        planCalls[1] && distTo(planCalls[1].from, last) < 1 && distTo(planCalls[1].to, S.home) < 1,
        planCalls[1] ? "offsets " + distTo(planCalls[1].from, last).toFixed(1)
          + "/" + distTo(planCalls[1].to, S.home).toFixed(1) + " m" : "never made");
  check("10c. both rows carry routed metres",
        r.transit && r.transit.m > 0 && r.rth && r.rth.m > 0,
        "transit " + (r.transit && r.transit.m | 0) + " m, rth " + (r.rth && r.rth.m | 0) + " m");
}

// 11. Each row degrades ALONE: no fix loses only the transit row, no home only the RTH row.
{
  const noBoat = transitEstCompute(null, mission.waypoints, S.home);
  const noHome = transitEstCompute(asv, mission.waypoints, null);
  check("11. no fix -> transit '--' while RTH still answers; no home -> the mirror",
        noBoat.transit === null && noBoat.rth && noBoat.rth.m > 0
          && noHome.rth === null && noHome.transit && noHome.transit.m > 0);
}

// 12. A planner REFUSAL reaches the operator's eyes as the planner's own words — never a
// silent '--' (indistinguishable from "no fix") and never a number.
{
  planScript = { error: "the target sits in land" };
  const r = transitEstCompute(asv, mission.waypoints, S.home);
  const html = transitRowHtml("RTH:", r.rth, 3.6);
  check("12. a refused route renders 'unroutable' with the planner's reason",
        r.rth && r.rth.err === "the target sits in land"
          && html.indexOf("unroutable") >= 0 && html.indexOf("the target sits in land") >= 0,
        html.replace(/<[^>]+>/g, "").trim());
}

// 13. nogo-not-loaded is an ESTIMATE DOWNGRADE, said in the row, not hidden.
{
  planScript = { degraded: true };
  const r = transitEstCompute(asv, mission.waypoints, S.home);
  const html = transitRowHtml("transit:", r.transit, 3.6);
  check("13. a degraded (nogo not loaded) answer says 'direct' beside the figure",
        r.transit && r.transit.direct === true && /direct/.test(html),
        html.replace(/<[^>]+>/g, "").trim());
}

// 14. The seconds shown are metres over the SPEED PASSED IN — so a plan-speed change
// re-times the rows with no re-route. 3000 m at 5 m/s is 10:00; at 2 m/s it is 25:00.
{
  const est = { m: 3000, direct: false };
  const atFive = transitRowHtml("t:", est, 5), atTwo = transitRowHtml("t:", est, 2);
  check("14. the row's time is metres / the CURRENT plan speed",
        atFive.indexOf(fmtMS(600)) >= 0 && atTwo.indexOf(fmtMS(1500)) >= 0,
        "5 m/s -> " + fmtMS(600) + " ok=" + (atFive.indexOf(fmtMS(600)) >= 0)
          + ", 2 m/s -> " + fmtMS(1500) + " ok=" + (atTwo.indexOf(fmtMS(1500)) >= 0));
}

// 15. THE CACHE KEY: routing runs on a telemetry-driven render path, so the key must hold
// still for jitter and move for a real change. Under TRANSIT_REKEY_M of boat motion is the
// SAME key (no re-route); past it, a new one; and home moving re-keys with the boat still.
{
  // the REAL threshold, read from the page (a const in a direct eval stays lexical to it -
  // the eval'd functions close over it; this harness code cannot, so parse the number out)
  const REKEY = parseFloat(grabDecl("TRANSIT_REKEY_M").match(/=\s*([\d.]+)/)[1]);
  const k0 = transitEstKey(at(0, 0), mission.waypoints, S.home);
  const kNear = transitEstKey(at(0, REKEY * 0.3), mission.waypoints, S.home);
  const kFar = transitEstKey(at(0, REKEY * 2.5), mission.waypoints, S.home);
  const kHome = transitEstKey(at(0, 0), mission.waypoints, at(-900, 40));
  check("15. boat jitter under the re-key threshold keeps the key; real motion changes it",
        k0 === kNear && k0 !== kFar,
        "0 vs " + (REKEY * 0.3).toFixed(0) + " m same, vs "
          + (REKEY * 2.5).toFixed(0) + " m different");
  check("15b. home moving re-keys even with the boat still",
        k0 !== kHome);
}

// 15c. The transit row stays LIVE during a run — the first cut blanked it once running
// and Andy watched the boat fly the transit against a dash. The 50 m re-key bucket is the
// cost control, not a run-state gate.
{
  S = { run: "running", home: S.home }; asv = at(50, 50);
  check("15c. a RUNNING boat still feeds the transit estimate",
        transitEstBoat() === asv);
  S = { run: "idle", home: S.home };
  check("15d. ... and so does an idle one", transitEstBoat() === asv);
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
