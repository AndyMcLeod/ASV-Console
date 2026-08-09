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
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

const fs = require("fs");
const path = require("path");

// Layer-0 helpers come from the real modules now (2026-08-09), not lifted out of
// asv.html as source text: a renamed or deleted export fails HERE instead of quietly
// falling back to a stale copy. Top-level, so the DIRECT eval() below still resolves
// them through its lexical scope.
const { distTo, llEN } = require("../static/js/geodesy.js");
const { fmtDist, fmtDur } = require("../static/js/units.js");

// The vessel-derived parameter block lives in static/js/state.js now (2026-08-09). The
// page functions eval'd below read V.NOGO_BUFFER_M / V.MAX_TURN_RATE_DEG_S / ..., so the
// suite hands them the SAME object the page mutates rather than a stub - a check that
// leans on a vessel default is then reading the real one.
const { V } = require("../static/js/state.js");

// --- source lookup: the page AND its modules -----------------------------------------
// Parts of the client live in static/js/*.js now, so a name this suite lifts as SOURCE TEXT
// may be in either place. MODSRC is those modules concatenated with the `export` keyword
// stripped, which makes each declaration read exactly as it did when it sat in the page -
// so the grab helpers below need no other change.
const MODSRC = require("fs")
  .readdirSync(require("path").join(__dirname, "..", "static", "js"))
  .filter(f => f.endsWith(".js"))
  .map(f => require("fs").readFileSync(
    require("path").join(__dirname, "..", "static", "js", f), "utf8"))
  .join("\n")
  .replace(/^export /gm, "");

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grab(name) {
  const HS = H.indexOf("function " + name + "(") >= 0 ? H : MODSRC;
  let start = HS.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (HS.slice(start - 6, start) === "async ") start -= 6;
  let k = HS.indexOf("{", start), depth = 0;
  for (;;) { const c = HS[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return HS.slice(start, k + 1);
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
var mission = { speed: "survey", lines: [], waypoints: [] };
var speedWarnShown = false;   // the page declares this beside the function; the harness must too
// distUnit lives in units.js now - setDistUnit() is the only way in.   // fmtDist's globals - km keeps the legacy km shape here
var asv = null;
var banners = [], notes = [];
function showBanner(t) { banners.push(t); const b = $("#encbanner"); b.textContent = t; b.style.display = "block"; }
function flashNote(t) { notes.push(t); }
// the DOM the recalculation writes into
var EL = {};
function $(sel) { return (EL[sel] = EL[sel] || { textContent: "", style: {} }); }
// eslint-disable-next-line no-eval
eval(
     grab("minTurnRadiusM") + "\n" + grab("committedPatternInfo") + "\n" +
     grab("recalcCommittedForSpeed"));

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
  mission = { speed: mission.speed, lines, waypoints: wps };
}
function run(speed) { mission.speed = speed; banners = []; recalcCommittedForSpeed(); return banners.join(" "); }

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
mission.speed = "survey"; banners = []; recalcCommittedForSpeed();
const atSurvey = $("#v_surveydur").textContent;
mission.speed = "low"; recalcCommittedForSpeed();
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
mission = { speed: "survey", lines: [], waypoints: [] };
check("8. an empty plan degrades to '--', it does not throw",
      (() => { try { recalcCommittedForSpeed();
                     return $("#v_surveydur").textContent === "--"; }
               catch (e) { return false; } })());

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
