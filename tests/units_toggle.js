// tests/units_toggle.js - the km<->nm DISTANCE DISPLAY toggle (the DIST pill).
//
// WHY THIS EXISTS. Andy scoped this feature twice: LONG distances only (line spacing,
// buffers, draft, depths and the LINES table stay METRIC - 25 m of spacing is 0.0135 nm,
// unusable), one global toggle on the top status bar, and canonical METRES everywhere -
// the unit is applied at the DISPLAY EDGE like the feet on chart tiles and the nm on the
// AIS card. fmtDist() is THE formatter for a long distance; every readout that used to
// hand-roll `(m/1000).toFixed(2)+" km"` now goes through it, and this suite keeps a new
// hand-rolled site from creeping back in beside the pill it would ignore.
//
//   node tests/units_toggle.js      # exit 0 = pass, 1 = fail   (stdlib Node, no deps)
//
// THE CHECK THAT MATTERS MOST is 3: the nm VALUE, both ways. The AIS range control taught
// this - asserting a field is merely LABELLED right still passes when the raw km value is
// shown under an nm label, wrong by 1.852 with a plausible number on screen. So 1852 m
// must read "1.00 nm", not "1.85 nm".
//
// TEETH (each mutation run, results in CLAUDE.md):
//   * nm branch returns the km value with an nm label      -> 3 fails
//   * the <1000 m short-circuit dropped (short goes nm)    -> 2 fails
//   * applyDistUnit stops persisting (lsSet lost)          -> 6 fails
//   * applyDistUnit stops repainting (recalcForSpeed lost) -> 7 fails
//   * a raw `(m/1000).toFixed(2)+" km"` site restored      -> 9 fails
//   * the storage listener persists (save=true echo)       -> 8 fails
//   * the stored default flips to nm                       -> 5 fails
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy, and the
// eval below reproduces that.

const fs = require("fs");
const path = require("path");

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

let fails = 0, ran = 0;
// Every condition is a thunk and a THROW is a failed check, never a dead process - a
// harness that cannot survive the fault it tests for cannot report it.
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
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}

console.log("Units toggle — one preference, applied at the display edge, long distances only:");

// ---- the formatter itself ---------------------------------------------------------- //
var M_PER_NM = 1852, distUnit = "km";
// eslint-disable-next-line no-eval
eval(grab("fmtDist"));

check("1. km mode keeps the legacy shape — metres under 1 km, km with 2 dp above",
  () => { distUnit = "km";
          return fmtDist(25) === "25 m" && fmtDist(999) === "999 m"
              && fmtDist(1234) === "1.23 km" && fmtDist(null) === "--"; },
  () => { distUnit = "km"; return [fmtDist(25), fmtDist(999), fmtDist(1234), fmtDist(null)].join(" / "); });

check("2. SHORT STAYS METRIC IN BOTH MODES — the scope decision, not an accident",
  () => { distUnit = "nm"; const nmShort = fmtDist(999);
          distUnit = "km"; const kmShort = fmtDist(999);
          return nmShort === "999 m" && kmShort === "999 m"; },
  "25 m of line spacing must never become 0.0135 nm");

check("3. nm mode converts the VALUE, both directions — not just the label",
  () => { distUnit = "nm";
          const a = fmtDist(1852) === "1.00 nm";        // exactly one nm
          const b = fmtDist(5556) === "3.00 nm";        // NOT "5.56 nm" - the mislabelled-km trap
          distUnit = "km";
          const c = fmtDist(1852) === "1.85 km";        // and back
          return a && b && c; },
  () => { distUnit = "nm"; const s = fmtDist(1852) + " / " + fmtDist(5556);
          distUnit = "km"; return s + " / " + fmtDist(1852); });

check("4. the whole-number form serves the station-distance texts",
  () => { distUnit = "km"; const a = fmtDist(81600, 0) === "82 km";
          distUnit = "nm"; const b = fmtDist(81600, 0) === "44 nm";
          distUnit = "km"; return a && b; },
  "81.6 km away = the measured Lewes aisstream gap = 44 nm");

// ---- the stored preference --------------------------------------------------------- //
// The declaration is evaluated with a stub lsGet, so this runs the REAL default path:
// nothing stored -> the fallback -> km. A default of nm would silently change every
// long-distance readout for every operator who never touched the pill.
check("5. nothing stored defaults to km — existing consoles read exactly as before",
  () => {
    const decl = H.match(/let distUnit = [^\n]+;/);
    if (!decl) throw new Error("distUnit declaration not found");
    // eslint-disable-next-line no-eval
    const v = eval("(function(UNITS_KEY, lsGet){ " + decl[0].replace("let ", "var ") +
                   " return distUnit; })")("asv_units_v1", (k, fb) => fb);  // empty storage: fallback wins
    return v === "km";
  });

// ---- applyDistUnit: persist, paint, repaint ---------------------------------------- //
// The REAL function, with its collaborators stubbed and observed.
function harness() {
  const calls = { lsSet: [], recalc: 0 };
  const pill = { textContent: "" };
  const env = {
    UNITS_KEY: "asv_units_v1",
    lsSet: (k, v) => calls.lsSet.push([k, v]),
    lsGet: (k, fb) => fb,
    $: sel => (sel === "#p_units" ? pill : { textContent: "" }),
    recalcForSpeed: () => { calls.recalc++; },
  };
  const src = grab("applyDistUnit");
  // eslint-disable-next-line no-eval
  const fn = eval("(function(UNITS_KEY, lsSet, lsGet, $, recalcForSpeed){ " + src +
                  " return applyDistUnit; })")(env.UNITS_KEY, env.lsSet, env.lsGet, env.$, env.recalcForSpeed);
  return { fn, calls, pill };
}

check("6. a CLICK persists the choice under the one units key",
  () => { distUnit = "km"; const h = harness(); h.fn("nm", true);
          return h.calls.lsSet.length === 1 && h.calls.lsSet[0][0] === "asv_units_v1"
              && h.calls.lsSet[0][1].u === "nm" && distUnit === "nm" && h.pill.textContent === "NM"; },
  () => { const h = harness(); h.fn("nm", true); return JSON.stringify(h.calls.lsSet); });

check("7. ... and REPAINTS through recalcForSpeed — the same path a plan-speed change takes",
  () => { distUnit = "km"; const h = harness(); h.fn("nm", true); return h.calls.recalc === 1; },
  "the survey/committed figures are owned by that path; without it the toggle lies until the next punch");

check("8. the cross-window adoption does NOT persist — storage echoes must not write back",
  () => { distUnit = "km"; const h = harness(); h.fn("nm", false);
          const adopted = distUnit === "nm" && h.calls.recalc === 1 && h.calls.lsSet.length === 0;
          // and the SOURCE registers a storage listener that takes this save=false path
          const listener = /addEventListener\("storage",[\s\S]{0,200}?UNITS_KEY[\s\S]{0,200}?applyDistUnit\([\s\S]{0,80}?,\s*false\)/.test(H);
          return adopted && listener; },
  "the other window of the UI split adopts and repaints, but only the click that changed it writes");

// ---- one mechanism ----------------------------------------------------------------- //
check("9. NO hand-rolled km conversion remains beside the formatter",
  () => {
    // The fingerprint of the old sites: dividing by 1000 and printing with toFixed. The
    // ONLY survivor allowed is the km branch inside fmtDist itself.
    const hits = H.match(/\/1000\)\.toFixed/g) || [];
    const inFmt = (grab("fmtDist").match(/\/1000\)\.toFixed/g) || []).length;
    return hits.length === inFmt && inFmt === 1 && !/Math\.round\(trust\.km\)/.test(H)
        && !/fmtLenM/.test(H);                        // replaced, not duplicated
  },
  () => (H.match(/\/1000\)\.toFixed/g) || []).length + " raw /1000 toFixed site(s) in the page");

// ---- the scope line holds ---------------------------------------------------------- //
check("10. a REAL readout follows the toggle — recalcCommittedForSpeed prints nm when asked",
  () => {
    // Run the real committed-plan recalculation under both units (the speed_recalc
    // harness pattern): a 2 km transit must read km in km mode and nm in nm mode.
    var M_PER_DEG_LAT = 111320;
    var SPEED_KN = { low: 4.0, survey: 7.0, high: 14.0 }, MAX_TURN_RATE_DEG_S = 20;
    var speedWarnShown = false, asv = null, mission;
    var EL = {};
    var $ = sel => (EL[sel] = EL[sel] || { textContent: "", style: {} });
    var showBanner = () => {}, flashNote = () => {};
    // eslint-disable-next-line no-eval
    eval(grab("llEN") + "\n" + grab("distTo") + "\n" + grab("fmtDur") + "\n" +
         grab("minTurnRadiusM") + "\n" + grab("committedPatternInfo") + "\n" +
         grab("recalcCommittedForSpeed"));
    const wps = [{ lat: 38.7896, lon: -75.1609 }, { lat: 38.7896 + 2000 / M_PER_DEG_LAT, lon: -75.1609 }];
    mission = { speed: "survey", lines: [], waypoints: wps };
    distUnit = "km"; recalcCommittedForSpeed();
    const km = EL["#v_surveydur"].textContent;
    distUnit = "nm"; recalcCommittedForSpeed();
    const nm = EL["#v_surveydur"].textContent;
    distUnit = "km";
    return / km\)/.test(km) && / nm\)/.test(nm) && /1\.08 nm\)/.test(nm) && /2\.00 km\)/.test(km);
  },
  "2000 m = 2.00 km = 1.08 nm - the value converts, not just the label");

check("11. the SHORT-METRIC readouts are untouched — spacing/buffer/depth/LINES stay in metres",
  () => /m buffer/.test(H)                            // the punch advisory's buffer text
     && /len m/.test(H)                               // the LINES table header
     && /\$\{buffer\} m/.test(H),                     // buffer printed as metres, not fmtDist
  "the scope decision holds: only LONG distances follow the pill");

check("12. the AIS card still reads nm ALWAYS — its own earlier decision, not this pill's",
  () => /function fmtNm\(m\)/.test(H) && !/fmtNm[\s\S]{0,80}?distUnit/.test(grab("fmtNm")),
  "two display edges, deliberately independent");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
