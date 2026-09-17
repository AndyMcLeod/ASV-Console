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

// --- 12-16. the TIDE is a depth input too, and the model has to follow it ---- //
// buildKeepouts reads the water level once, when it runs. Nothing rebuilt the model when the
// level moved, so a model built at high water kept a drying flat and a rock out of the
// keep-outs - for the router, Punch Out and the clearance guard - however far the tide fell.
// Review item #1, 2026-09-14. DRIVEN: the page's own applyWaterOffset against the REAL
// builder, with the tide falling in the 5 cm steps a station actually reports.
{
  const K = require("../static/js/keepouts.js");
  const { planeFrame } = require("../static/js/geodesy.js");
  const { effectiveWaterOffset } = require("../static/js/chart.js");
  const TIDE_REBUILD_M = +((H.match(/const TIDE_REBUILD_M = ([\d.]+);/) || [])[1]);
  // A station on the doorstep, so the trust gate passes the level through unchanged.
  const wl = (offset_m) => ({ ok: true, offset_m, stations: [{ dist_km: 2 }] });
  // Eastport water at his Min depth of 4 m: a rock with a charted sounding, and a 0-2 m flat.
  const F = planeFrame({ lat: 44.905, lon: -66.985 });
  const P = (e, n) => { const q = F.fromEN(e, n); return [q.lon, q.lat]; };
  const feats = [
    { role: "hazard_point", cls: "Underwater_Awash_Rock_point", props: { VALSOU: 1.5 },
      geometry: { type: "Point", coordinates: P(0, 0) } },
    { role: "depth_area", props: { DRVAL1: 0, DRVAL2: 2 },
      geometry: { type: "Polygon", coordinates: [[P(100, -50), P(200, -50), P(200, 50), P(100, 50), P(100, -50)]] } }];
  // The page's state, and a rebuildNogo doing what the page's does to `ko` and `builtOffset`:
  // the real builder, at the level in force.
  const sea = { waterOffset: 0 };
  const nogo = { features: feats, ko: null, builtOffset: null };
  let patClip = "punched", rebuilds = 0;
  // A punch the tide throws away is RECORDED and SAID (2026-09-16) - what that means for Add to plan is
  // tests/turn_refusal.js 14; here it only has to exist for the page's function to run.
  let patDropped = null, readouts = 0;
  const updatePatReadout = () => { readouts++; };
  const rebuildNogo = () => { rebuilds++;
    nogo.ko = K.buildKeepouts(F, feats, { minDepthM: 4, bufferM: 3, wreckRadiusM: 50, waterOffsetM: sea.waterOffset });
    nogo.builtOffset = sea.waterOffset; };
  // eslint-disable-next-line no-eval
  const applyWaterOffset = eval("(" + grab(H, "applyWaterOffset").replace(/^function applyWaterOffset/, "function") + ")");
  const rock = () => K.blocked({ e: 0, n: 0 }, nogo.ko, 3);
  const flat = () => K.blocked({ e: 150, n: 0 }, nogo.ko, 3);

  check("12. rebuildNogo records the water level its model was built at",
        () => /nogo\.builtOffset\s*=\s*sea\.waterOffset;/.test(grab(H, "rebuildNogo")),
        "without it there is nothing to measure the live level against");

  applyWaterOffset(wl(4.5)); rebuildNogo();             // high water, model built there
  const highRock = rock(), highFlat = flat(), atHigh = rebuilds;
  for (let cm = 445; cm >= 0; cm -= 5) applyWaterOffset(wl(cm / 100));
  check("13. THE REPORTED FAULT: as the tide falls to datum, the model blocks the rock and the flat again",
        () => !highRock && !highFlat && rock() && flat() && Math.abs(nogo.builtOffset) < TIDE_REBUILD_M,
        () => "at +4.5 m rock=" + highRock + " flat=" + highFlat + "; at datum rock=" + rock() + " flat=" + flat()
              + ", model now built at " + nogo.builtOffset + " m");
  const fell = rebuilds - atHigh;
  check("14. ...measured from the level the model was BUILT at, so 5 cm steps still add up",
        () => fell === Math.round(4.5 / TIDE_REBUILD_M),
        () => fell + " rebuilds over a 4.5 m fall in 5 cm steps (one per " + TIDE_REBUILD_M
              + " m) - a frame-to-frame test would never rebuild at all");

  const before = rebuilds;
  applyWaterOffset(wl(nogo.builtOffset + 0.04));
  const wobble = rebuilds === before;
  nogo.features = null; applyWaterOffset(wl(3)); const none = rebuilds === before; nogo.features = feats;
  check("15. ...and it does not churn: a 4 cm wobble rebuilds nothing, and no model means nothing to rebuild",
        () => wobble && none && patClip === null, () => "wobble:" + wobble + " no-model:" + none);

  const ON = grab(H, "onState"), code = noComments(H);
  const writes = (code.match(/sea\.waterOffset\s*=(?!=)/g) || []).length;
  check("16. ONE writer, applied before the guard reads the model, and the manual override uses it too",
        () => ON.indexOf("applyWaterOffset(water)") >= 0
              && ON.indexOf("applyWaterOffset(water)") < ON.indexOf("clearanceGuard()")
              && writes === 1 && /applyWaterOffset\(water\);\s*updateWaterUI\(water\)/.test(code),
        () => writes + " assignment(s) to sea.waterOffset in the page (want 1, inside applyWaterOffset)");
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
// REVIEW #1, 2026-09-14 - the tide as a depth input (checks 12-16), same sidecar method:
//   applyWaterOffset never rebuilds                        -> 13, 14
//   compared frame-to-frame instead of with the BUILT level -> 13, 14, 15
//   rebuildNogo stops recording nogo.builtOffset            -> 12
//   onState writes sea.waterOffset directly again           -> 16
//   the manual Water m override writes it directly          -> 16
//   rebuild on ANY change (churn)                           -> 14, 15
//   the no-model guard dropped                              -> 15
//   the 1e-9 floating-point tolerance dropped               -> 14
// 8 mutations, 8 killed.
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
