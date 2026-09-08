// tests/min_depth_floor.js - the operator's Min depth is a ROUTING floor, for every behavior.
//
// Andy, 2026-09-07: "On GOTO selection without survey in place there is no option for speed
// selection or depth buffers." Both controls lived only in the SURV card, which is closed
// unless you are planning a survey - so a bare Go-To could be given neither. Asked which he
// meant, he chose to make Min/Max depth "apply to Go-To as well", which is a BEHAVIOR change
// and not a UI move, and this suite is what holds the behavior.
//
//   node tests/min_depth_floor.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// THE RULE:
//   * The floor every behavior routes against is the DEEPER of two numbers - the hull's own
//     navigability limit (draft + under-keel clearance, from the vessel profile) and the
//     operator's Min depth. Taking the max means a Min depth set BELOW what the hull needs
//     cannot quietly narrow its clearance, which is the same rule bufferFloor() enforces for
//     the keep-clear buffer one control over.
//   * MAX DEPTH IS NOT ENFORCED HERE, and that is the load-bearing half of the decision.
//     Deep water is not a hazard. The survey Max depth is a COVERAGE window - "don't survey
//     deeper than this" - and enforcing it in the shared model would make a Go-To across a
//     deep channel unroutable. punchOut still layers the full min/max window on top of this
//     floor for the survey lines themselves. Check 5 is the one that would go red if someone
//     "finished the job" by wiring max through.
//   * The value reaches the model, not just the DOM: raising it re-classifies charted depth
//     areas that were navigable into keep-outs. Measured live at New Castle - 1148 keep-out
//     zones at the 2.3 m hull floor, 1561 at an 8 m operator floor.
//   * A rebuild, NOT a re-fetch: depthExcluded re-reads each feature's own DRVAL1/DRVAL2, and
//     the server applies its 'shallow' tag per request so one fetch serves any limit.
//   * It survives a reload, which needs it in FOUR whitelists - the client's loadMission
//     rebuild and the server's load_mission, its empty-file default, and save_mission. Miss
//     the last one and the field is dropped on every save: that is exactly how `speeds` was
//     lost in 2026-08-31, one field over.

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
const CHART = fs.readFileSync(path.join(__dirname, "..", "static", "js", "chart.js"), "utf8");
const PY = fs.readFileSync(path.join(__dirname, "..", "asv_console.py"), "utf8");
const { depthExcluded } = require("../static/js/keepouts.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!cond(); note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}
function grab(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("anchor gone: function " + name + " (renamed?)");
  let k = src.indexOf("{", start), depth = 0;
  for (;;) { const c = src[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return src.slice(start, k + 1);
}
const noComments = s => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// --- the page's own nogoDR, run against a settable V ------------------------ //
// Lifted from chart.js rather than restated: a copy here would pass while the shipped one
// had stopped taking the max, which is the whole rule.
const V = {};
eval(grab(CHART, "nogoDR").replace(/^export\s+/, ""));

// A charted depth area, shaped the way the ENC extract delivers one.
const area = (drval1, drval2) => ({ role: "depth_area", props: { DRVAL1: drval1, DRVAL2: drval2 } });

console.log("Min depth is a routing floor for every behavior, not a survey setting:");

// --- 1-3. the floor is the deeper of the two ------------------------------- //
V.NOGO_MIN_DEPTH_M = 2.3; V.OPER_MIN_DEPTH_M = 8;
check("1. an operator floor DEEPER than the hull's is the one in force",
      () => nogoDR().min === 8,
      () => "hull 2.3, operator 8 -> " + nogoDR().min);

V.NOGO_MIN_DEPTH_M = 2.3; V.OPER_MIN_DEPTH_M = 1;
check("2. ...and one SHALLOWER than the hull's cannot narrow its clearance",
      () => nogoDR().min === 2.3,
      () => "hull 2.3, operator 1 -> " + nogoDR().min + " (the hull's own floor stands)");

V.NOGO_MIN_DEPTH_M = 2.3; delete V.OPER_MIN_DEPTH_M;
check("3. an unset operator floor leaves the hull's exactly as it was",
      () => nogoDR().min === 2.3,
      () => "no operator value -> " + nogoDR().min + " (a console never told otherwise is unchanged)");

// --- 4. it reaches the MODEL: water that was navigable becomes a keep-out --- //
{
  V.NOGO_MIN_DEPTH_M = 2.3; V.OPER_MIN_DEPTH_M = 0;
  const five = area(5, 5);                       // charted 5 m water
  const atHull = depthExcluded(five, nogoDR());
  V.OPER_MIN_DEPTH_M = 8;
  const atOper = depthExcluded(five, nogoDR());
  check("4. 5 m water is clear at the 2.3 m hull floor and a KEEP-OUT at an 8 m operator floor",
        () => atHull === false && atOper === true,
        () => "hull floor -> " + (atHull ? "blocked" : "clear")
              + ", operator floor -> " + (atOper ? "blocked" : "clear")
              + "   (live at New Castle this took the model from 1148 zones to 1561)");
}

// --- 5. THE HALF THAT MUST NOT BE "FINISHED": max stays unenforced --------- //
{
  V.NOGO_MIN_DEPTH_M = 2.3; V.OPER_MIN_DEPTH_M = 8;
  const deep = area(40, 60);                     // a deep channel
  check("5. DEEP water is never a keep-out - max stays 0 in the shared model",
        () => nogoDR().max === 0 && depthExcluded(deep, nogoDR()) === false,
        () => "max=" + nogoDR().max + ", 40-60 m water -> "
              + (depthExcluded(deep, nogoDR()) ? "BLOCKED (a deep channel would be unroutable)" : "clear"));
}

// --- 6-8. one writer, both controls, and the survey window left alone ------ //
{
  const SET = grab(H, "setMinDepth");
  // ⚠ THE REBUILD IS ASSERTED WITH ITS GUARD. `/rebuildNogo\(\)/` alone matched a mutation
  // that had changed the condition to `if(false)` - the call was still in the text, doing
  // nothing. A source-shape check has to pin the STATEMENT, not the identifier.
  check("6. ONE writer mirrors both controls and rebuilds the shared model",
        () => /\$\("#sp_mindepth"\)\.value\s*=/.test(SET) && /\$\("#c_mindepth"\)\.value\s*=/.test(SET)
              && /V\.OPER_MIN_DEPTH_M\s*=/.test(SET)
              && /if\(nogo\.features && nogo\.features\.length\)\s*rebuildNogo\(\)/.test(SET),
        "the setBuffer shape: clamp, mirror, persist, rebuild-when-there-is-a-model");

  const code = noComments(H);
  check("6b. ...and BOTH controls go through it, neither writing on its own",
        () => /\$\("#c_mindepth"\)\.onchange\s*=\s*\(\)=>setMinDepth/.test(code)
              && /\$\("#sp_mindepth"\)\.onchange\s*=\s*\(\)=>setMinDepth/.test(code),
        "two controls, one value - the trap this console keeps re-learning");

  check("7. the survey MAX depth is still a coverage-only control",
        () => /\$\("#sp_maxdepth"\)\.onchange\s*=\s*\(\)=>\{\s*patClip=null/.test(code)
              && !/setMinDepth\(\$\("#sp_maxdepth"\)/.test(code),
        "re-clips the preview; it does not touch the shared model");

  check("8. punchOut still layers the operator's window ON TOP of the floor",
        () => /Math\.max\(V\.NOGO_MIN_DEPTH_M,\s*surveyDr\.min\)/.test(H),
        "survey coverage is stricter than navigability, never looser");
}

// --- 9. it survives a reload: four whitelists, and the last one is the trap - //
{
  check("9. the client's loadMission rebuild carries min_depth_m",
        () => /min_depth_m:\s*m\.min_depth_m/.test(H)
              && /V\.OPER_MIN_DEPTH_M\s*=\s*mission\.min_depth_m/.test(H),
        "the explicit whitelist drops any field not named in it");

  // ⚠ EACH ONE IN ITS OWN FUNCTION BODY. A bare /"min_depth_m": m.get\(/ over the whole file
  // is satisfied by ANY of the three, so deleting it from load_mission left this green - the
  // "every" trap, one file over from where it was found in speed_modes.
  const NEXT_DEF = String.fromCharCode(10) + "def ";     // a top-level def ends the body
  const pyFn = name => { const i = PY.indexOf("def " + name + "("); if (i < 0) return "";
    const j = PY.indexOf(NEXT_DEF, i + 1); return PY.slice(i, j < 0 ? PY.length : j); };
  const LOAD = pyFn("load_mission"), SAVE = pyFn("save_mission");
  const inLoad = /"min_depth_m":\s*m\.get\("min_depth_m"/.test(LOAD);
  const inSave = /"min_depth_m":\s*m\.get\("min_depth_m"/.test(SAVE);
  const inDefault = /"buffer_m":\s*NOGO_BUFFER_DEFAULT_M,\s*"min_depth_m"/.test(LOAD);
  if (!LOAD || !SAVE) throw new Error("could not isolate load_mission / save_mission");
  check("9b. ...and so do the server's load, save AND empty-file default",
        () => inLoad && inSave && inDefault,
        () => "load:" + inLoad + " save:" + inSave + " default:" + inDefault
              + "   (miss SAVE and the field is dropped on every write - the `speeds` bug)");
}

// --- 10. the readout cannot print a floor the model was not built at ------- //
{
  const RO = grab(H, "nogoReadout");
  check("10. the nogo readout prints the EFFECTIVE floor, not the hull's",
        () => /nogoDR\(\)\.min/.test(RO) && !/const floor = \(typeof V\.NOGO_MIN_DEPTH_M/.test(RO),
        "1561 zones beside 'floor 2.3 m' is a count the operator cannot reconcile");
}

// --- 11. the command bar carries what a bare Go-To needs ------------------- //
{
  check("11. Min depth and TRANSIT speed are on the always-visible command bar",
        () => /id="c_mindepth"/.test(H) && /id="c_spd_transit"/.test(H),
        "the reported gap: with no survey drawn, the SURV card is closed");

  const SRS = grab(H, "setRoleSpeed");
  check("11b. ...and the bar's transit select shares ONE writer with the panel's",
        () => /#sp_spd_/.test(SRS) && /#c_spd_transit/.test(SRS)
              && /mission\.speeds/.test(SRS) && /recalcForSpeed\(\)/.test(SRS),
        "a second handler writing mission.speeds is the two-places fault again");

  check("11c. ...and the load path seeds the bar copy, not just the panel's",
        () => /\$\("#c_spd_transit"\)\.value\s*=\s*mission\.speeds\.transit/.test(H),
        "or it opens showing the markup default while the panel shows the truth");
}

console.log("\n" + (fails ? fails + " CHECK(S) FAILED" : "all " + ran + " checks passed"));
process.exit(fails ? 1 : 0);

// TEETH - asv.html mutated in a SIDECAR (ASV_HTML); chart.js and asv_console.py have no env
// override, so those were written, run, and restored from a saved buffer in a finally, with
// `git diff` checked clean afterwards. Numbers are the checks that actually went red.
//
//   nogoDR ignores the operator floor (the reported gap)   -> 1, 4
//   nogoDR takes an operator floor SHALLOWER than the hull -> 2
//   nogoDR enforces a MAX (deep water becomes a keep-out)  -> 5
//   setMinDepth stops rebuilding the shared model          -> 6
//   setMinDepth stops mirroring the SURV panel copy        -> 6
//   setMinDepth stops feeding V.OPER_MIN_DEPTH_M           -> 6
//   the SURV Min depth reverts to coverage-only            -> 6b
//   MAX depth wired through to the shared model            -> 7
//   the readout prints the HULL floor again                -> 10
//   the command bar loses Min depth / loses Transit        -> 11
//   the bar's transit select gets a private writer         -> 11b
//   the load path stops seeding the bar's transit copy     -> 11c
//   loadMission (client) drops min_depth_m                 -> 9
//   save_mission / load_mission (server) drop it           -> 9b
//
// 16 mutations, 16 killed, none survived and none crashed the suite.
//
// ⚠ TWO CHECKS WERE TOO WEAK ON THE FIRST RUN, and both are the same shape - a source-shape
// assertion matching an IDENTIFIER where the meaning is in the STATEMENT:
//   * check 6 tested `/rebuildNogo\(\)/`, which a mutation changing the guard to `if(false)`
//     satisfied happily - the call was still in the text, doing nothing. It pins the guarded
//     statement now.
//   * check 9b tested one regex over the WHOLE python file for "load, save AND default", so
//     any one of the three satisfied it and deleting it from load_mission left it green. It
//     isolates each function body first. That is the "every" trap found in speed_modes 11b
//     three days ago, in a different file: an assertion that says EVERY must enumerate the
//     population, not scan for one witness.
