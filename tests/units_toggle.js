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
// TEETH (each mutation run, results in HANDOFF_ARCHIVE.md, "THE km↔nm DISTANCE DISPLAY"):
//   * nm branch returns the km value with an nm label      -> 3 fails
//   * the <1000 m short-circuit dropped (short goes nm)    -> 2 fails
//   * applyDistUnit stops persisting (lsSet lost)          -> 6 fails
//   * applyDistUnit stops repainting (recalcForSpeed lost) -> 7 fails
//   * a raw `(m/1000).toFixed(2)+" km"` site restored      -> 9 fails
//   * the storage listener persists (save=true echo)       -> 8 fails
//   * the stored default flips to nm                       -> 5 fails
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

// LAYER-0 HELPERS COME FROM THE REAL MODULES, not from asv.html's source text.
// These moved out of the page on 2026-08-09. Requiring them means a renamed or
// deleted export fails HERE, loudly, instead of silently reverting to a stale copy;
// and the checks below exercise the shipped function rather than an eval of its text.
// Top-level so the suite's DIRECT eval() of page functions still resolves them.
const { distTo, llEN } = require("../static/js/geodesy.js");
const { distUnit, fmtDist, fmtDur, fmtNm, setDistUnit } = require("../static/js/units.js");



// recalcCommittedForSpeed reads the vessel block (V.SPEED_KN, V.MAX_TURN_RATE_DEG_S),
// which moved to state.js with the Layer-0 split.
const { V } = require("../static/js/state.js");
// minTurnRadiusM moved out of asv.html into its own module (2026-08-20). Required
// rather than grabbed, so the eval'd page functions below still see it by name.
const { minTurnRadiusM } = require("../static/js/turns.js");
// The module's own SOURCE, for checks that must read a DECLARATION rather than a runtime
// value - a default is a property of the text, not of a live object that an earlier check
// in this same file may already have moved.
const U_SRC = fs.readFileSync(path.join(__dirname, "..", "static", "js", "units.js"), "utf8");
// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes
// its mutants to a file this suite never reads and scores every one as SURVIVED (audited
// 2026-09-21: 21 of the 53 suites reading this page had no override).
const H = fs.readFileSync(process.env.ASV_HTML
                || path.join(__dirname, "..", "static", "asv.html"), "utf8");

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
// A module-level `const X = ...;` / `let X = ...;` pulled out verbatim - the REAL value.
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}

console.log("Units toggle — one preference, applied at the display edge, long distances only:");

// ---- the formatter itself ---------------------------------------------------------- //
// distUnit lives in units.js now - setDistUnit() is the only way in.
// eslint-disable-next-line no-eval
check("1. km mode keeps the legacy shape — metres under 1 km, km with 2 dp above",
  () => { setDistUnit("km");
          return fmtDist(25) === "25 m" && fmtDist(999) === "999 m"
              && fmtDist(1234) === "1.23 km" && fmtDist(null) === "--"; },
  () => { setDistUnit("km"); return [fmtDist(25), fmtDist(999), fmtDist(1234), fmtDist(null)].join(" / "); });

check("2. SHORT STAYS METRIC IN BOTH MODES — the scope decision, not an accident",
  () => { setDistUnit("nm"); const nmShort = fmtDist(999);
          setDistUnit("km"); const kmShort = fmtDist(999);
          return nmShort === "999 m" && kmShort === "999 m"; },
  "25 m of line spacing must never become 0.0135 nm");

check("3. nm mode converts the VALUE, both directions — not just the label",
  () => { setDistUnit("nm");
          const a = fmtDist(1852) === "1.00 nm";        // exactly one nm
          const b = fmtDist(5556) === "3.00 nm";        // NOT "5.56 nm" - the mislabelled-km trap
          setDistUnit("km");
          const c = fmtDist(1852) === "1.85 km";        // and back
          return a && b && c; },
  () => { setDistUnit("nm"); const s = fmtDist(1852) + " / " + fmtDist(5556);
          setDistUnit("km"); return s + " / " + fmtDist(1852); });

check("4. the whole-number form serves the station-distance texts",
  () => { setDistUnit("km"); const a = fmtDist(81600, 0) === "82 km";
          setDistUnit("nm"); const b = fmtDist(81600, 0) === "44 nm";
          setDistUnit("km"); return a && b; },
  "81.6 km away = the measured Lewes aisstream gap = 44 nm");

// ---- the stored preference --------------------------------------------------------- //
// The declaration is evaluated with a stub lsGet, so this runs the REAL default path:
// nothing stored -> the fallback -> km. A default of nm would silently change every
// long-distance readout for every operator who never touched the pill.
// TWO HALVES, and both have to hold. units.js must START at km (a fresh module, nothing
// stored), and the PAGE must seed it from storage with a km fallback. Checking only the
// module would pass while the page seeded "nm"; checking only the page would pass while
// the module defaulted to nm and the page never called the setter at all.
check("5. nothing stored defaults to km — existing consoles read exactly as before",
  () => {
    const seed = U_SRC.match(/let _distUnit\s*=\s*"(\w+)"/);
    const pageSeeds = /setDistUnit\(lsGet\(UNITS_KEY,\s*\{u:"km"\}\)\.u\)/.test(H);
    return !!seed && seed[1] === "km" && pageSeeds;
  },
  () => "units.js declares _distUnit = " + ((U_SRC.match(/let _distUnit\s*=\s*"(\w+)"/) || [])[1]) +
        "; page seeds with a km fallback: " +
        /setDistUnit\(lsGet\(UNITS_KEY,\s*\{u:"km"\}\)\.u\)/.test(H));

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
  () => { setDistUnit("km"); const h = harness(); h.fn("nm", true);
          return h.calls.lsSet.length === 1 && h.calls.lsSet[0][0] === "asv_units_v1"
              && h.calls.lsSet[0][1].u === "nm" && distUnit() === "nm" && h.pill.textContent === "NM"; },
  () => { const h = harness(); h.fn("nm", true); return JSON.stringify(h.calls.lsSet); });

check("7. ... and REPAINTS through recalcForSpeed — the same path a plan-speed change takes",
  () => { setDistUnit("km"); const h = harness(); h.fn("nm", true); return h.calls.recalc === 1; },
  "the survey/committed figures are owned by that path; without it the toggle lies until the next punch");

check("8. the cross-window adoption does NOT persist — storage echoes must not write back",
  () => { setDistUnit("km"); const h = harness(); h.fn("nm", false);
          const adopted = distUnit() === "nm" && h.calls.recalc === 1 && h.calls.lsSet.length === 0;
          // and the SOURCE registers a storage listener that takes this save=false path
          const listener = /addEventListener\("storage",[\s\S]{0,200}?UNITS_KEY[\s\S]{0,200}?applyDistUnit\([\s\S]{0,80}?,\s*false\)/.test(H);
          return adopted && listener; },
  "the other window of the UI split adopts and repaints, but only the click that changed it writes");

// ---- one mechanism ----------------------------------------------------------------- //
check("9. NO hand-rolled km conversion remains beside the formatter",
  () => {
    // The fingerprint of the old sites: dividing by 1000 and printing with toFixed. The
    // ONLY survivor allowed is the km branch inside fmtDist itself.
    const hits = (H.match(/\/1000\)\.toFixed/g) || []).concat(U_SRC.match(/\/1000\)\.toFixed/g) || []);
    // fmtDist itself moved to units.js, so ITS km branch is the one allowed survivor.
    // Sliced out on plain string boundaries: a regex with a newline escape in it is how
    // this check broke twice while being repaired.
    const fdStart = U_SRC.indexOf("export function fmtDist");
    const fdEnd = U_SRC.indexOf("export function fmtNm", fdStart + 1);
    const fdSrc = U_SRC.slice(fdStart, fdEnd < 0 ? undefined : fdEnd);
    const inFmt = (fdSrc.match(/\/1000\)\.toFixed/g) || []).length;
    return hits.length === inFmt && inFmt === 1 && !/Math\.round\(trust\.km\)/.test(H)
        && !/fmtLenM/.test(H);                        // replaced, not duplicated
  },
  () => (H.match(/\/1000\)\.toFixed/g) || []).length + " in the page, " +
        (U_SRC.match(/\/1000\)\.toFixed/g) || []).length + " in units.js");

// ⚠⚠ 9b. AND THE OTHER HAND-ROLLED SHAPE: A FIELD THAT IS ALREADY KILOMETERS. Check 9
// hunts the fingerprint of the sites it was written against - `/1000).toFixed` - so a readout
// holding a `_km` field straight off the wire has no division to find and walks past it. Four
// did, for as long as they existed: the water-station offset, the station list, the
// this-station-alone note and the tide detail list, all printing raw km beside a pill whose
// own tooltip names "tide-station distance" in its scope.
// A guard written against ONE fingerprint says nothing about a second shape of the same
// mistake, and it reads like coverage either way.
check("9b. NO readout prints a raw `_km` field either - the shape check 9 cannot see",
  () => {
    // Comment-stripped: the note above records the old shape verbatim, and an absence check
    // that reads comments matches its own obituary.
    const code = H.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    const raw = code.match(/\b\w*dist_km[^;\n]{0,40}?toFixed\(\d\)\s*\+?\s*"\s*km/g) || [];
    const tpl = code.match(/\$\{[^}]*dist_km[^}]*\}\s*km/g) || [];
    return raw.length === 0 && tpl.length === 0;
  },
  () => {
    const code = H.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    const raw = code.match(/\b\w*dist_km[^;\n]{0,40}?toFixed\(\d\)\s*\+?\s*"\s*km/g) || [];
    const tpl = code.match(/\$\{[^}]*dist_km[^}]*\}\s*km/g) || [];
    return (raw.length + tpl.length) + " raw km site(s) left"
      + (raw.length + tpl.length ? ": " + raw.concat(tpl).join(" | ").slice(0, 120) : "");
  });

// ---- the scope line holds ---------------------------------------------------------- //
check("10. a REAL readout follows the toggle — recalcCommittedForSpeed prints nm when asked",
  () => {
    // Run the real committed-plan recalculation under both units (the speed_recalc
    // harness pattern): a 2 km transit must read km in km mode and nm in nm mode.
    var M_PER_DEG_LAT = 111320;
    var SPEED_KN = { low: 4.0, survey: 7.0, high: 14.0 }, MAX_TURN_RATE_DEG_S = 20;
    V.SPEED_KN = SPEED_KN;      // roleSpeed validates a key against the VESSEL block
    var speedWarnShown = false, asv = null, mission;
    var EL = {};
    var $ = sel => (EL[sel] = EL[sel] || { textContent: "", style: {} });
    var showBanner = () => {}, flashNote = () => {};
    // SPEED BY ROLE (2026-08-31): the two duration rows are computed at the SURVEY and
    // TRANSIT speeds now, through these helpers. Grabbed with the rest, so this check
    // keeps exercising the page's own arithmetic rather than a stub of it.
    // eslint-disable-next-line no-eval
    eval(
         grabDecl("SPEED_ROLES") + "\n" +
         grab("roleSpeed") + "\n" + grab("roleSpeedMS") + "\n" +
         grabDecl("SPEED_WARN_PREFIX") + "\n" +
         grab("committedPatternInfo") + "\n" +
         // committedPatternInfo counts DRAWN lines (review #18) - the page's own numbering, not a stub
         grab("lineSetKey") + "\n" + grabDecl("LINE_PART_OFFSET_M") + "\n" + grabDecl("_drawnLines") + "\n" + grab("linePartContinues") + "\n" +
     grab("drawnLines") + "\n" + grab("lineNo") + "\n" + grab("lineCount") + "\n" + grab("linePartTxt") + "\n" +
         // ROLE-BILLED ESTIMATE (2026-09-05): the survey row totals the chain BY ROLE now,
         // so its three helpers are grabbed with it rather than stubbed.
         grabDecl("LINE_MATCH_M") + "\n" +
         grab("reversalScaleM") + "\n" + grab("isReversalGap") + "\n" +
         grab("committedRoleLengths") + "\n" +
         grab("recalcCommittedForSpeed"));
    const wps = [{ lat: 38.7896, lon: -75.1609 }, { lat: 38.7896 + 2000 / M_PER_DEG_LAT, lon: -75.1609 }];
    mission = { speed: "survey", speeds: { transit: "survey", turn: "survey", survey: "survey" },
                lines: [], waypoints: wps };
    setDistUnit("km"); recalcCommittedForSpeed();
    const km = EL["#v_surveydur"].textContent;
    setDistUnit("nm"); recalcCommittedForSpeed();
    const nm = EL["#v_surveydur"].textContent;
    setDistUnit("km");
    return / km\)/.test(km) && / nm\)/.test(nm) && /1\.08 nm\)/.test(nm) && /2\.00 km\)/.test(km);
  },
  "2000 m = 2.00 km = 1.08 nm - the value converts, not just the label");

check("11. the SHORT-METRIC readouts are untouched — spacing/buffer/depth/LINES stay in metres",
  () => /m buffer/.test(H)                            // the punch advisory's buffer text
     && /len m/.test(H)                               // the LINES table header
     && /\$\{buffer\} m/.test(H),                     // buffer printed as metres, not fmtDist
  "the scope decision holds: only LONG distances follow the pill");

check("12. the AIS card still reads nm ALWAYS — its own earlier decision, not this pill's",
  () => /export function fmtNm/.test(U_SRC) &&
        !/export function fmtNm[\s\S]{0,140}?_distUnit/.test(U_SRC),
  "two display edges, deliberately independent");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
