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
  check("6. ONE writer sets the card's control and rebuilds the shared model (the command bar's copy went 2026-10-13)",
        () => /\$\("#sp_mindepth"\)\.value\s*=/.test(SET) && !/#c_mindepth/.test(SET)
              && /V\.OPER_MIN_DEPTH_M\s*=/.test(SET)
              && /if\(nogo\.features && nogo\.features\.length\)\s*rebuildNogo\(\)/.test(SET),
        "the setBuffer shape: clamp, mirror, persist, rebuild-when-there-is-a-model");

  const code = noComments(H);
  check("6b. ...and the card's control goes through it - and there is no second control to write on its own",
        () => !/c_mindepth/.test(code)
              && /\$\("#sp_mindepth"\)\.onchange\s*=\s*\(\)=>setMinDepth/.test(code),
        "two controls, one value - the trap this console keeps re-learning"); 

  // ⚠⚠ 6c. AND THE BUFFER HAS A FLOOR AT ITS WRITERS TOO, NOT ONLY ON THE LOAD PATH. The
  // hull's planning.nogo_buffer_m was applied on mission load and on vessel switch - and by
  // NEITHER of the two functions that write nogo.buffer when the operator types a number.
  //
  // A zero buffer does not merely narrow the model, it DELETES TWO THIRDS OF IT. `blocked`
  // tests lines and points with a strict `< buf`, and a shoreline, an obstruction line, an
  // r=0 pile and a channel buoy carry no extent of their own: at buf = 0 not one of them can
  // refuse anything, and timeToEntry goes silent on all of them too. Polygons still block,
  // so the Nogo row goes on counting zones while a whole CLASS of keep-out has stopped
  // existing - a console that looks armed and is not.
  check("6c. the BUFFER floor is enforced by BOTH of its writers, so the model can never be "
        + "built with a zero buffer however the operator types it",
        () => /v\s*=\s*bufferFloor\(/.test(noComments(grab(H, "setBuffer")))
              && /nogo\.buffer\s*=\s*bufferFloor\(/.test(noComments(grab(H, "applyNogoControls"))),
        "setBuffer and applyNogoControls both go through bufferFloor - a floor enforced by "
        + "one of two writers is not a floor");

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

// --- 11. what a bare Go-To needs is always on screen ------------------------ //
// 2026-09-07 put Min depth and Transit kn on the command bar: they lived only on the SURV card, closed unless a survey
// was drawn. 2026-10-13 the Path planning card is always loaded, with ROUTE RULES under every tab, and the bar's copies
// went (Andy: "Consider removing the repeats in the command bar") - one control each, where every behavior is planned.
{
  const RULES = H.slice(H.indexOf('id="pp_rules"'), H.indexOf('id="pp_plan"'));
  check("11. Min depth, Buffer and TRANSIT speed are under Route rules on the always-loaded Path planning card, and the "
        + "command bar no longer repeats them",
        () => RULES.length > 200 && /id="sp_mindepth"/.test(RULES) && /id="sp_buffer"/.test(RULES) && /id="sp_spd_transit"/.test(RULES)
              && /<div class="panel" id="pathPanel">/.test(H) && /UI_BRIDGED = \[[^\]]*"#pathPanel"/.test(H)
              && !/id="c_mindepth"|id="c_spd_transit"|id="c_buffer"/.test(H),
        "the reported gap: with no survey drawn, the SURV card was closed");

  const SRS = grab(H, "setRoleSpeed");
  check("11b. ...and the transit select has ONE writer",
        () => /#sp_spd_/.test(SRS) && !/#c_spd_transit/.test(SRS)
              && /mission\.speeds/.test(SRS) && /recalcForSpeed\(\)/.test(SRS),
        "a second handler writing mission.speeds is the two-places fault again");

  check("11c. ...and the load path seeds the card's selects",
        () => /const el = \$\("#sp_spd_" \+ r\); if\(el\) el\.value = mission\.speeds\[r\];/.test(H),
        "or it opens showing the markup default while the plan says otherwise");
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
  // ... and a punch HELD by the blocker clearing is kept through a move under TIDE_REBUILD_M (2026-11-06,
  // tests/auto_clear.js): none is held here, so every move throws the punch away as this suite has always seen.
  const patFunnel = null;
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


// ── 17. THE CEILING IS A COVERAGE WINDOW, AND IT REACHES THE CLIP ONLY ───────────────
//
// This suite's own header states the rule and names the check that guards half of it:
// "MAX DEPTH IS NOT ENFORCED HERE... punchOut still layers the full min/max window on top
// of this floor FOR THE SURVEY LINES THEMSELVES. Check 5 is the one that would go red if
// someone finished the job by wiring max through." That sentence was true of the shared
// model and FALSE of punchOut, which built ONE model at the operator's window and handed it
// to the clip, the turns, the leads, the region hops and the detour router alike.
//
// Measured on a 5-15 m bank with 20-30 m water each side and Max depth 15: the clip parks
// every run end at the bank edge, correctly - and then all four reversals come back "no
// flyable turn", every lead is cut from the 30 m asked for to 0.0 m, and ADD TO PLAN is
// disabled. All of it said about charted 20-30 m water, under the label "water shallower
// than 2.3 m", because nogoKind answers that for ANY depth exclusion.
//
// ⚠⚠ DRIVEN THROUGH punchOut'S OWN MODEL STATEMENTS, sliced out of the page and executed.
// Not a restatement: the `dr` each consumer receives is whatever the page hands it, so a
// half-revert - rebasing either model onto the other - changes what this check sees. Two
// source checks alone could not do that, and the first cut of this fix shipped with only
// source checks: BOTH halves of the split could then be silently reverted with every suite
// green, including one revert (the clip rebased onto the ceiling-free model) that stops the
// operator's Max depth applying to coverage at all.
{
  const G = require("../static/js/geodesy.js");
  const K = require("../static/js/keepouts.js");
  const T = require("../static/js/turns.js");
  const F = G.planeFrame({ lat: 43.0, lon: -70.5 });
  const P = (e, n) => F.fromEN(e, n);
  const ring = (e0, e1, n0, n1) =>
    [[P(e0, n0), P(e1, n0), P(e1, n1), P(e0, n1), P(e0, n0)].map(p => [p.lon, p.lat])];
  const area = (name, e0, e1, n0, n1, d1, d2) => ({
    role: "depth_area", cls: "Depth_Area", name, props: { DRVAL1: d1, DRVAL2: d2 },
    geometry: { type: "Polygon", coordinates: ring(e0, e1, n0, n1) } });
  const feats = [area("bank 5-15 m", -210, 210, -700, 700, 5, 15),
                 area("deep 20-30 m E", 210, 900, -700, 700, 20, 30),
                 area("deep 20-30 m W", -900, -210, -700, 700, 20, 30)];
  const enf = { land: true, depth: true, haz: true, area: false };
  const OPTS = { minDepthM: 2.3, wreckRadiusM: 3, bufferM: 3, waterOffsetM: 0 };
  // chart.js's wrapper, which the fix does not touch
  const buildKeepouts = (r, e, d, f) =>
    K.buildKeepouts(r, f, { ...OPTS, depthRange: d, enforce: e });
  const clipLine = new Function("llEN", "blocked", "azTo", "distTo", "atDA",
    grab(H, "clipLine") + "\n" + grab(H, "extendLead") + "\nreturn {clipLine, extendLead};")(
      G.llEN, K.blocked, G.azTo, G.distTo, G.atDA);
  // punchOut's OWN model statements, lifted verbatim
  const PO = grab(H, "punchOut").split("\n");
  const stmts = PO.filter(l => /buildKeepouts\(|^\s*const ko(Clip|Turn)\s*=/.test(l)
                               && !/^\s*\/\//.test(l));
  const dr = { min: Math.max(2.3, 5), max: 15 };        // panel: Min 5, Max 15
  // `aisExcl` joined the clip statement 2026-11-04 (the moored-contact clip); handed empty here -
  // this check's question is the depth window's two models, and a contact in the clip is 17c's.
  // `cutAt` (2026-11-06): the punch's cut - the water level both models are built at; the wrapper above builds at 0.
  const M = new Function("buildKeepouts", "foldChartInk", "ref", "enf", "dr", "nogo",
                         "chanExcl", "turnExcl", "aisExcl", "cutAt",
    stmts.join("\n") + "\nreturn {ko, koClip, koTurn};")(
      buildKeepouts, () => 0, F, enf, dr, { features: feats }, [], [], [], { bufM: 3, waterM: 0, held: false });
  // 17c. THE AIS EXCLUSION REACHES EXACTLY THE CLIP (2026-11-04, the moored-contact clip): a hull handed
  // to the same sliced model lands in koClip's polys and in NEITHER ko nor koTurn - the two-model rule's
  // third direction (ceiling to the clip, floor to the turns, contacts to the clip alone).
  {
    const R17 = [{ e: -10, n: 90 }, { e: 10, n: 90 }, { e: 10, n: 110 }, { e: -10, n: 110 }];
    const fake = { ring: R17, bb: { x0: -10, y0: 90, x1: 10, y1: 110 }, kind: "AIS: X (30 x 8 m, moored)", mmsi: 1 };
    const M2 = new Function("buildKeepouts", "foldChartInk", "ref", "enf", "dr", "nogo",
                            "chanExcl", "turnExcl", "aisExcl", "cutAt",
      stmts.join("\n") + "\nreturn {ko, koClip, koTurn};")(
        buildKeepouts, () => 0, F, enf, dr, { features: feats }, [], [], [fake], { bufM: 3, waterM: 0, held: false });
    check("17c. a moored contact handed to the punch's model reaches the CLIP alone: in koClip's polys, "
          + "in neither ko nor koTurn - lines never through her, turns and leads never refused for her",
          () => M2.koClip.polys.includes(fake) && !M2.ko.polys.includes(fake) && !M2.koTurn.polys.includes(fake),
          () => "koClip has her: " + M2.koClip.polys.includes(fake) + ", ko: " + M2.ko.polys.includes(fake)
              + ", koTurn: " + M2.koTurn.polys.includes(fake));
  }
  const buffer = 3;
  const lines = []; for (let i = 0; i < 5; i++) lines.push([P(-500, i * 20), P(500, i * 20)]);
  let clipped = [];
  lines.forEach(l => clipLine.clipLine(l[0], l[1], F, M.koClip, buffer).forEach(s => clipped.push(s)));
  clipped = clipped.map((s, i) => (i % 2 ? [s[1], s[0]] : s));     // a lawnmower: alternate
  // the coverage must STILL stop at the bank edge: that is the operator's window working
  const en = (p) => G.llEN(p.lat, p.lon, F);
  const widest = clipped.reduce((a, s) => Math.max(a, Math.abs(en(s[0]).e),
                                                      Math.abs(en(s[1]).e)), 0);
  // ...and the reversals between those runs must be FLYABLE through the deep water beside it
  const fly = { spdKey: "survey", approachM: 1 };
  let red = 0, built = 0;
  for (let k = 0; k < clipped.length - 1; k++) {
    const t = T.turnWithRetry(clipped[k][1], clipped[k + 1][0],
                              G.azTo(clipped[k][0], clipped[k][1]),
                              G.azTo(clipped[k + 1][0], clipped[k + 1][1]),
                              F, M.koTurn, buffer, 5, 60, 2.5, 0, fly);
    if (t && t.pts && t.pts.length) built++; else red++;
  }
  const leads = clipped.map(s =>
    clipLine.extendLead(s[1], s[0], 30, F, M.koTurn, buffer).m);
  check("17. the operator's Max depth clips the COVERAGE and does not refuse the turns and "
        + "leads through the deep water beside it",
        () => clipped.length === 5 && widest < 215 && widest > 195
              && red === 0 && built === 4 && leads.every(m => m > 29),
        () => clipped.length + " runs, widest end " + widest.toFixed(0) + " m from centre "
            + "(the bank edge is 210 m, so the ceiling IS clipping coverage); turns built "
            + built + ", refused " + red + "; leads bought "
            + leads.map(m => m.toFixed(0)).join("/") + " m of the 30 asked for. Before the "
            + "split: 4 refused, 0 built, every lead 0.0 m, all reported as \"water "
            + "shallower than 2.3 m\" about charted 20-30 m water");
}

// 17b. AND THE TWO MODELS STAY BOUND TO THEIR OWN CONSUMERS. 17 drives the behaviour; this
// pins WHICH model each consumer spreads, because a half-revert is one identifier and the
// behavioural fixture cannot tell a rename from a re-base in every direction. The pair is
// the point: the ceiling must reach the clip (or Max depth stops applying to coverage at
// all - the survey is then planned straight through the trench) and must NOT reach the
// turns (or this finding is back).
check("17b. ... and each model is bound to its own consumer: koClip spreads koCov, koTurn "
      + "spreads the ceiling-free ko",
      () => {
        const po = grab(H, "punchOut");
        // (2026-11-06: both built at the punch's CUT level - the live one, or the blocker clearing's hold - and the SAME
        //  `cutAt.waterM` for both, so the two models cannot come to stand at different water)
        return /const koCov=buildKeepouts\(ref, enf, dr, nogo\.features, cutAt\.waterM\);/.test(po)
            && /const ko=buildKeepouts\(ref, enf, \{min: dr\.min, max: 0\}, nogo\.features, cutAt\.waterM\);/.test(po)
            // the moored-contact clip joined the SAME statement 2026-11-04 (aisExcl beside chanExcl), so the
            // slice filter that feeds 17 still carries it - an AIS exclusion spliced via a NEW statement
            // would never reach 17's executed model, and 17 would test a model without the clip
            && /const koClip = \(chanExcl\.length \|\| aisExcl\.length\) \? \{\.\.\.koCov, polys:\[\.\.\.koCov\.polys, \.\.\.chanExcl, \.\.\.aisExcl\]\} : koCov;/.test(po)
            && /const koTurn = turnExcl\.length \? \{\.\.\.ko, polys:\[\.\.\.ko\.polys, \.\.\.turnExcl\]\} : ko;/.test(po)
            && /foldChartInk\(koCov, ref\);/.test(po) && /foldChartInk\(ko, ref\);/.test(po);
      },
      "both builds, both spreads and both chart folds are pinned. Rebasing koClip onto `ko` "
        + "stops the operator's Max depth applying to coverage at all; rebasing koTurn onto "
        + "koCov restores this finding - and neither is visible in a suite that only checks "
        + "the identifiers exist");


// ── 18. THE GUARD'S CHART FOLLOWS THE FLOOR EVERY WRITER SETS (2026-11-09) ───────────────
//
// The adversarial re-review of 2026-11-08 found it: loadMission wrote V.OPER_MIN_DEPTH_M and rebuilt nothing. It runs
// again on Take over, reading the plan as the supervising tab saved it - so a saved Min depth DEEPER than this tab's left
// the guard's chart (nogo.ko) built at the shallower floor until a punch, a control or the tide rebuilt it, and the guard
// judged water the plan calls too shallow as deep enough. setMinDepth (check 6) always rebuilt beside its write.
// DRIVEN: the page's own loadMission, applyVesselToUI, rebuildNogo, floorFollows and punchRefusal, over chart.js's REAL
// builder and nogoDR on state.js's V / nogo / sea (the objects the page imports), with fetch answering the saved plan.
// Each refusal is paired with the acceptance beside it: the same floor rebuilds nothing, a Min depth under the hull's
// floor rebuilds nothing, and no chart rebuilds nothing.
let __finished = false;
process.on("beforeExit", () => {             // a load that never settles must not exit 0 with nothing said (plan_save's trap)
  if (__finished) return;
  console.log("  FAIL 0. the suite stopped before finishing - a load waited on an answer it was never given");
  console.log("\n1 CHECK(S) FAILED (stopped before finishing)");
  process.exitCode = 1;
});
async function check18() {
  const ST = require("../static/js/state.js"), CH = require("../static/js/chart.js");
  const K = require("../static/js/keepouts.js");
  const { planeFrame } = require("../static/js/geodesy.js");
  const { normalizeSurveys } = require("../static/js/surveys.js");
  const { V, nogo, sea } = ST, { nogoDR, buildKeepouts, buildMargin } = CH;
  // the harness's own premise: chart.js reads THIS V (one module instance), or the builder is judging another floor
  V.NOGO_MIN_DEPTH_M = 7.25;
  if (nogoDR().min !== 7.25) throw new Error("test setup: chart.js does not read state.js's V here");
  // Two charted depth areas in one frame: 2-3 m water at the origin, 4-4.5 m water 300 m east. depthExcluded makes an
  // area a keep-out when its DEEPEST charted depth is under the floor: the first at a 4 m floor, the second at 5 m.
  const REF = { lat: 43.07, lon: -70.71 }, F = planeFrame(REF);
  const P = (e, n) => { const q = F.fromEN(e, n); return [q.lon, q.lat]; };
  const box = (e) => [[P(e - 100, -100), P(e + 100, -100), P(e + 100, 100), P(e - 100, 100), P(e - 100, -100)]];
  const FEATS = [{ role: "depth_area", props: { DRVAL1: 2, DRVAL2: 3 }, geometry: { type: "Polygon", coordinates: box(0) } },
                 { role: "depth_area", props: { DRVAL1: 4, DRVAL2: 4.5 }, geometry: { type: "Polygon", coordinates: box(300) } }];
  const three = () => K.blocked({ e: 0, n: 0 }, nogo.ko, 1), fourHalf = () => K.blocked({ e: 300, n: 0 }, nogo.ko, 1);
  // The leaves, stubbed: the chart-image fold (tests/chart_ink.js), the frame's reference (the REF above), the DOM.
  const foldChartInk = () => 0, featuresBboxRef = () => REF, asv = null, center = REF;
  let nogoUI = 0, readouts = 0;
  const updateNogoUI = () => { nogoUI++; }, updatePatReadout = () => { readouts++; }, render = () => {};
  const els = {};
  const $ = (sel) => (els[sel] = els[sel] || { value: 0, style: {} });
  const SPEED_ROLES = [], updateSpeedNote = () => {}, bufferFloor = (b) => b;
  const updateLeadNote = () => {}, updateEaseNote = () => {}, banners = [], showBanner = (t) => banners.push(t);
  let PLAN = null;
  const fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(PLAN)) });
  const plan = (min_depth_m) => ({ waypoints: [], lines: [], buffer_m: 3, min_depth_m, rev: 1 });
  const DECL = ["^let missionRev = [^;]*;", "^let missionLoaded = [^;]*;", "^const MISSION_LOAD_RETRY_MS = [^;]*;",
                "^const NOGO_RETRY_MS = [^;]*;"].map((re) => {
    const m = H.match(new RegExp(re, "m"));
    if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
    return m[0];
  }).join("\n");
  // eslint-disable-next-line no-eval
  const page = eval("(function(){ let patClip = null, patDropped = null, mission = {waypoints: []};"
    + " let boundary = [], boundaryClosed = false, surveyBounded = false;"
    + " var lockWaiver = null; function lockFeatureKey(f){ return String(f); }\n" + DECL + "\n"
    + [grab(H, "bandWord"), grab(H, "modelFeatures"), grab(H, "rebuildNogo"), grab(H, "floorFollows"),
       grab(H, "punchRefusal"), grab(H, "applyVesselToUI"), "async " + grab(H, "loadMission")].join("\n")
    + "\nreturn { loadMission, applyVesselToUI, rebuildNogo, punchRefusal,"
    + " get: () => ({ patClip, patDropped, missionLoaded }), punch: (c) => { patClip = c; patDropped = null; } }; })()");
  const hull = (draft_m, ukc) => ({ hull: { draft_m }, planning: { under_keel_clearance_m: ukc } });
  const takeOver = async (m) => { PLAN = plan(m); await Promise.race([page.loadMission(), new Promise((r) => setTimeout(r, 200))]); };

  // This tab: a 1.0 m hull floor under a 2 m Min depth, the chart built there, a punch on the card.
  V.NOGO_MIN_DEPTH_M = 1.0; V.OPER_MIN_DEPTH_M = 2; sea.waterOffset = 0;
  nogo.features = FEATS; page.rebuildNogo();
  const atTwo = { ko: nogo.ko, three: three(), built: nogo.builtMin };
  page.punch("runs cut at 2 m");

  // 18. THE REPORTED DEFECT: the plan the other tab saved says 4 m.
  await takeOver(4);
  // (asked only of a DROPPED punch: with one still on the card punchRefusal reads the joins - another suite's world)
  const g18 = page.get(), r18 = g18.patClip === null ? (page.punchRefusal() || {}) : {};
  check("18. TAKE OVER at a saved Min depth DEEPER than this tab's rebuilds the guard's chart at it: 2-3 m water that was "
        + "clear at 2 m is a keep-out at 4 m, and the punch cut on the old chart is thrown away and SAID - Add to plan "
        + "refused until Punch Out again, its short reason naming no water move",
        () => !atTwo.three && atTwo.built === 2 && g18.missionLoaded && V.OPER_MIN_DEPTH_M === 4
              && nogo.ko !== atTwo.ko && three() && nogo.builtMin === 4
              && g18.patClip === null
              && g18.patDropped === "the routing floor moved from 2 m to 4 m and the guard's chart was rebuilt at it"
              && /thrown away when the routing floor moved from 2 m to 4 m and the guard's chart was rebuilt at it: /.test(r18.text || "")
              && /Punch Out again\.$/.test(r18.text || "") && !!r18.short && !/water level/.test(r18.short),
        () => "at 2 m: 2-3 m water blocked=" + atTwo.three + " built " + atTwo.built + "; after the load: blocked=" + three()
              + " built " + nogo.builtMin + " rebuilt=" + (nogo.ko !== atTwo.ko) + "; punch " + JSON.stringify(g18.patClip)
              + "; dropped: " + JSON.stringify(g18.patDropped) + "; short: " + JSON.stringify(r18.short));

  // 18b. ... and the SAME floor again rebuilds nothing and keeps the punch.
  page.punch("runs cut at 4 m");
  const ko18b = nogo.ko, ui18b = nogoUI;
  await takeOver(4);
  const g18b = page.get();
  check("18b. ... and a plan at the floor the chart was built at rebuilds nothing and keeps the punch",
        () => nogo.ko === ko18b && nogoUI === ui18b && g18b.patClip === "runs cut at 4 m" && g18b.patDropped === null,
        () => "rebuilt=" + (nogo.ko !== ko18b) + " punch " + JSON.stringify(g18b.patClip));

  // 18e. THE HULL'S WRITER: applyVesselToUI writes V.NOGO_MIN_DEPTH_M - switchVessel's REFUSED path re-reads the
  // console's vessel through it and rebuilt nothing. A 4.0 m draft and 1.0 m under-keel clearance: a 5 m floor.
  const ko18e = nogo.ko, before18e = fourHalf();
  page.applyVesselToUI(hull(4.0, 1.0));
  const after18e = { ko: nogo.ko, four: fourHalf(), built: nogo.builtMin, punch: page.get().patClip };
  page.punch("runs cut at 5 m");
  page.applyVesselToUI(hull(4.0, 1.0));
  check("18e. the HULL's floor moves the chart too: a vessel profile asking 5 m makes the 4-4.5 m water a keep-out, the "
        + "punch going with the old chart - and the same profile again rebuilds nothing",
        () => !before18e && after18e.ko !== ko18e && after18e.four && after18e.built === 5 && after18e.punch === null
              && nogo.ko === after18e.ko && page.get().patClip === "runs cut at 5 m",
        () => "4-4.5 m water at 4 m blocked=" + before18e + ", at 5 m " + after18e.four + " (built " + after18e.built
              + "); the same profile again rebuilt=" + (nogo.ko !== after18e.ko));

  // 18c. ... a Min depth that moves UNDER the hull's floor moves nothing the chart is built at.
  const ko18c = nogo.ko;
  await takeOver(3);
  check("18c. ... and a saved Min depth that changes but stays under the hull's 5 m floor rebuilds nothing: the floor in "
        + "force did not move",
        () => V.OPER_MIN_DEPTH_M === 3 && nogoDR().min === 5 && nogo.ko === ko18c && page.get().patClip === "runs cut at 5 m",
        () => "Min depth " + V.OPER_MIN_DEPTH_M + ", floor in force " + nogoDR().min + ", rebuilt=" + (nogo.ko !== ko18c));

  // 18d. ... and the chart follows the floor DOWN as well as up: back to a 1.0 m hull, then a plan at 2 m.
  page.applyVesselToUI(hull(0.5, 0.5));
  const built18d = nogo.builtMin, ko18d = nogo.ko;
  await takeOver(2);
  check("18d. ... and DOWN as well as up: a shallower saved floor rebuilds the chart at it, and the 2-3 m water is clear again",
        () => built18d === 3 && nogo.ko !== ko18d && nogo.builtMin === 2 && !three(),
        () => "built " + built18d + " -> " + nogo.builtMin + ", 2-3 m water blocked=" + three());

  // 18f. NO CHART LOADED: the floor is written and nothing is built.
  const ko18f = nogo.ko, built18f = nogo.builtMin;
  nogo.features = null;
  await takeOver(6);
  const g18f = page.get();
  check("18f. with no chart loaded the floor is written and nothing is built - the load completes as before",
        () => g18f.missionLoaded && V.OPER_MIN_DEPTH_M === 6 && nogo.ko === ko18f && nogo.builtMin === built18f,
        () => "Min depth " + V.OPER_MIN_DEPTH_M + ", built " + nogo.builtMin + ", rebuilt=" + (nogo.ko !== ko18f));

  // 18g. A CHART BUILT UNDER THE FLOOR IN FORCE IS CAUGHT BY THE NEXT WRITER, even one writing the value already there
  // - measured from the floor the chart was BUILT at, not the value the write replaced (the page-start race: a chart
  // read landing before the vessel and the plan, built at state.js's defaults).
  nogo.features = FEATS;                     // the chart is back, still built at 2 m; the floor in force is 6 m
  const ko18g = nogo.ko;
  await takeOver(6);
  check("18g. a chart built below the floor in force - by a write that rebuilt nothing - is rebuilt by the next load, "
        + "even one writing the same Min depth again",
        () => ko18g !== nogo.ko && nogo.builtMin === 6 && three() && fourHalf(),
        () => "built " + built18f + " under a floor of 6 m; after the load built " + nogo.builtMin
              + ", 2-3 m water blocked=" + three() + ", 4-4.5 m blocked=" + fourHalf());

  // 18h. THE CENSUS AS A CHECK: every writer of either floor in the page, and what it does after its write. A NEW writer
  // reddens this until it either rebuilds beside its write (setMinDepth's guarded rebuild) or asks floorFollows AFTER it.
  const code = noComments(H.split("\r\n").join("\n"));
  const sites = [...code.matchAll(/V\.(OPER|NOGO)_MIN_DEPTH_M\s*=(?!=)/g)].map((w) => {
    const at = Math.max(code.lastIndexOf("\nfunction ", w.index), code.lastIndexOf("\nasync function ", w.index));
    const name = (code.slice(at).match(/function (\w+)\(/) || [])[1];
    const body = grab(code, name), wr = body.indexOf(w[0]);
    const ff = body.indexOf("floorFollows();", wr);
    const rb = /if\(nogo\.features && nogo\.features\.length\)\s*rebuildNogo\(\)/.exec(body.slice(wr));
    return { name, follows: ff > wr ? "floorFollows" : (rb ? "rebuild" : "NOTHING") };
  });
  const said = sites.map((s) => s.name + ":" + s.follows).sort().join(" ");
  check("18h. every writer of V.OPER_MIN_DEPTH_M / V.NOGO_MIN_DEPTH_M in the page rebuilds the guard's chart after its "
        + "write, or asks floorFollows after it - and there are exactly the three",
        () => said === "applyVesselToUI:floorFollows loadMission:floorFollows setMinDepth:rebuild",
        () => said);
}

// 19. THE CONSOLE'S VESSEL, FOLLOWED (2026-11-09). The console flies ONE hull - /api/vessel serves it and every state
// frame names it (`vessel_id`) - and any chart tab can switch it. A tab read the hull once, at page start, so a switch
// made in another tab left it planning and guarding for the OLD hull, and Take over re-read the plan but not the vessel.
// The page's own loadVessel / vesselAdopted / vesselFollows / switchVessel, with applyVesselToUI, floorFollows and
// rebuildNogo over chart.js's REAL builder on state.js's V and nogo; the network, the trail, the notes and the picker
// stubbed and counted. Bravo has Alpha's FLOOR and a wider wreck radius: the case floorFollows alone cannot see.
async function check19() {
  const ST = require("../static/js/state.js"), CH = require("../static/js/chart.js");
  const K = require("../static/js/keepouts.js");
  const { planeFrame } = require("../static/js/geodesy.js");
  const { V, nogo, sea } = ST, { nogoDR, buildKeepouts, buildMargin } = CH;
  const REF = { lat: 43.07, lon: -70.71 }, F = planeFrame(REF);
  const P = (e, n) => { const q = F.fromEN(e, n); return [q.lon, q.lat]; };
  const box = (e) => [[P(e - 100, -100), P(e + 100, -100), P(e + 100, 100), P(e - 100, 100), P(e - 100, -100)]];
  // 2-3 m water at the origin (a keep-out under a 4.5 m floor, open water at 1 m) and a wreck 600 m north, whose built
  // radius is the hull's own wreck_radius_m (keepouts.js hazExtent: no sounding over it, so its extent is unknown)
  const FEATS = [{ role: "depth_area", props: { DRVAL1: 2, DRVAL2: 3 }, geometry: { type: "Polygon", coordinates: box(0) } },
                 { role: "hazard_point", cls: "Wreck_point", props: {}, geometry: { type: "Point", coordinates: P(0, 600) } }];
  const wreckR = () => (((nogo.ko && nogo.ko.points) || []).find((q) => q.cls === "Wreck_point") || {}).r;
  const three = () => K.blocked({ e: 0, n: 0 }, nogo.ko, 1);
  const HULL = (id, name, draft_m, wreck_radius_m, step) => ({ id, name, hull: { draft_m },
    planning: { under_keel_clearance_m: 0, wreck_radius_m, nogo_buffer_m: 1, search: { expbox_step_m: step } } });
  const HULLS = { alpha: HULL("alpha", "Alpha", 1, 10, 40), bravo: HULL("bravo", "Bravo", 1, 50, 60),
                  charlie: HULL("charlie", "Charlie", 4.5, 10, 80) };
  const LIST = Object.values(HULLS).map((v) => ({ id: v.id, name: v.name }));
  // The leaves, stubbed and counted. A rebuild is one updateNogoUI (rebuildNogo's last line).
  const foldChartInk = () => 0, featuresBboxRef = () => REF, center = REF;
  let asv = null, builds = 0, trails = 0, loads = 0;
  const notes = [], reads = [], pickers = [];
  const updateNogoUI = () => { builds++; }, updatePatReadout = () => {}, render = () => {};
  const clearTrack = () => { trails++; }, flashNote = (t) => { notes.push(t); }, loadMission = async () => { loads++; };
  const refreshNogo = (ll) => { reads.push(ll); };
  const fillVesselPicker = (available, active) => { pickers.push(active); };
  const els = {};
  const $ = (sel) => (els[sel] = els[sel] || { value: 0, style: {} });
  const document = { activeElement: null }, bufferFloor = (b) => b;
  let NOW = 1e9;
  const Date = { now: () => NOW };            // vesselFollows' clock, settable
  // THE CONSOLE: the hull it flies (GET /api/vessel serves it), a switch it takes or refuses, either answer held back
  let CONSOLE = null, refuse = null, gets = 0, posts = 0, getGate = null, postGate = null;
  const held = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
  const answer = (status, body) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(body)) });
  const fetch = async (url, opts) => {
    if (url !== "/api/vessel") throw new Error("test setup: unexpected fetch " + url);
    if (opts && opts.method === "POST") {
      posts++;
      if (refuse) return answer(409, { error: refuse });
      CONSOLE = HULLS[JSON.parse(opts.body).id];          // the console switches, THEN answers
      if (postGate) await postGate.p;
      return answer(200, { ok: true, vessel: CONSOLE });
    }
    gets++;
    if (getGate) await getGate.p;
    return answer(200, { vessel: CONSOLE, available: LIST, active: CONSOLE && CONSOLE.id });
  };
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const DECL = ["^let vesselBusy = [^;]*;", "^let vesselAskedAt = [^;]*;", "^const VESSEL_ASK_MS = [^;]*;",
                "^const NOGO_RETRY_MS = [^;]*;"].map((re) => {
    const m = H.match(new RegExp(re, "m"));
    if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
    return m[0];
  }).join("\n");
  // eslint-disable-next-line no-eval
  const page = eval("(function(){ let patClip = null, patDropped = null, mission = {waypoints: []};"
    + " let boundary = [], boundaryClosed = false, surveyBounded = false;"
    + " var lockWaiver = null; function lockFeatureKey(f){ return String(f); }\n" + DECL + "\n"
    + [grab(H, "bandWord"), grab(H, "modelFeatures"), grab(H, "rebuildNogo"), grab(H, "floorFollows"),
       grab(H, "applyVesselToUI"), "async " + grab(H, "loadVessel"), grab(H, "vesselAdopted"),
       grab(H, "vesselFollows"), "async " + grab(H, "switchVessel")].join("\n")
    + "\nreturn { loadVessel, vesselFollows, switchVessel, rebuildNogo, ASK_MS: VESSEL_ASK_MS,"
    + " get: () => ({ patClip, patDropped, busy: vesselBusy }), punch: (c) => { patClip = c; patDropped = null; } }; })()");
  const step = () => $("#sr_step").value, ids = () => V.VESSEL && V.VESSEL.id, last = () => notes[notes.length - 1];

  // 19. PAGE START: no hull held yet, the console flying Alpha, no chart read.
  V.VESSEL = null; V.OPER_MIN_DEPTH_M = 0; sea.waterOffset = 0; nogo.features = null;
  CONSOLE = HULLS.alpha;
  const ch19 = await page.loadVessel();
  const s19 = { ch: ch19, held: ids(), trails, notes: notes.length, builds, picker: pickers[pickers.length - 1], step: step() };
  check("19. at page start the console's hull is adopted - her parameters, the picker, the search step - with no trail "
        + "cleared, nothing said about a switch, and no chart to rebuild",
        () => s19.ch === true && s19.held === "alpha" && V.WRECK_RADIUS_M === 10 && s19.trails === 0 && s19.notes === 0
              && s19.builds === 0 && s19.picker === "alpha" && s19.step === 40,
        () => JSON.stringify(s19));

  // The chart is read and built for Alpha; a punch on the card; the operator's own search step typed in.
  nogo.features = FEATS; page.rebuildNogo();
  const a = { r: wreckR(), three: three(), built: nogo.builtMin, ko: nogo.ko };
  page.punch("runs cut for Alpha"); $("#sr_step").value = 99;

  // 19b. THE DEFECT: another tab switched the console to Bravo, and this tab's next frame names her.
  CONSOLE = HULLS.bravo;
  const b0 = { gets, builds, trails, notes: notes.length };
  page.vesselFollows("bravo"); await settle();
  const g19b = page.get();
  check("19b. A HULL SWITCHED IN ANOTHER TAB IS FOLLOWED: the next frame naming Bravo reads her and adopts her - her wreck "
        + "radius built into the guard's chart though her floor is Alpha's, a new trail, the picker and the search step "
        + "hers - the punch cut for Alpha is thrown away and SAID, and the switch is said",
        () => a.r === 10 && !a.three && a.built === 1 && gets === b0.gets + 1 && ids() === "bravo"
              && V.WRECK_RADIUS_M === 50 && wreckR() === 50 && nogo.ko !== a.ko && builds === b0.builds + 1
              && nogo.builtMin === 1 && trails === b0.trails + 1 && pickers[pickers.length - 1] === "bravo"
              && step() === 60 && g19b.patClip === null
              && g19b.patDropped === "the vessel changed to Bravo and the guard's chart was rebuilt for her"
              && notes.length === b0.notes + 1
              && last() === "The console's vessel is now Bravo, switched outside this tab · nogo floor 1.0 m - this tab "
                          + "plans and guards for her",
        () => "Alpha's chart: wreck r " + a.r + "; after the frame: held " + ids() + ", wreck r " + wreckR() + ", rebuilds "
              + (builds - b0.builds) + ", trails " + (trails - b0.trails) + ", reads " + (gets - b0.gets) + ", step "
              + step() + ", punch " + JSON.stringify(g19b.patClip) + " dropped " + JSON.stringify(g19b.patDropped)
              + ", note " + JSON.stringify(last()));

  // 19c. ... and the frames after it, naming the hull this tab now holds - or naming none.
  const c0 = { gets, builds, trails, notes: notes.length };
  for (let i = 0; i < 4; i++) page.vesselFollows("bravo");
  page.vesselFollows(null); page.vesselFollows(undefined); page.vesselFollows("");
  await settle();
  check("19c. ... and frames naming the hull this tab holds, or naming none, ask nothing",
        () => gets === c0.gets && builds === c0.builds && trails === c0.trails && notes.length === c0.notes,
        () => "reads " + (gets - c0.gets) + ", rebuilds " + (builds - c0.builds) + ", trails " + (trails - c0.trails));

  // 19d. The SAME hull read again - how a refused switch puts the picker back.
  page.punch("runs cut for Bravo"); $("#sr_step").value = 99;
  const d0 = { builds, trails, notes: notes.length, pickers: pickers.length, ko: nogo.ko };
  const ch19d = await page.loadVessel();
  check("19d. the SAME hull read again is not re-applied - the operator's search step and the punch stay, nothing is "
        + "rebuilt or said - and the picker is refilled",
        () => ch19d === false && step() === 99 && page.get().patClip === "runs cut for Bravo" && nogo.ko === d0.ko
              && builds === d0.builds && trails === d0.trails && notes.length === d0.notes
              && pickers.length === d0.pickers + 1 && pickers[pickers.length - 1] === "bravo",
        () => "changed " + ch19d + ", step " + step() + ", punch " + JSON.stringify(page.get().patClip) + ", rebuilt "
              + (nogo.ko !== d0.ko) + ", picker refills " + (pickers.length - d0.pickers));

  // 19e. A frame naming a hull the console no longer serves (switched back before the read landed): the read is out
  // while four more frames arrive, and comes back with Bravo.
  getGate = held();
  const e0 = gets;
  for (let i = 0; i < 5; i++) page.vesselFollows("ghost");
  const out = gets - e0, busy = page.get().busy;
  getGate.open(); getGate = null; await settle();
  NOW += 1000; page.vesselFollows("ghost"); await settle();
  const soon = gets - e0;
  NOW += page.ASK_MS; page.vesselFollows("ghost"); await settle();
  const later = gets - e0;
  check("19e. frames that arrive while a read is out ask nothing more, and a read that came back WITHOUT the hull the "
        + "frame named is asked again only after VESSEL_ASK_MS - not four times a second",
        () => out === 1 && busy === 1 && soon === 1 && later === 2 && ids() === "bravo" && page.get().busy === 0,
        () => "reads while one was out " + out + " (busy " + busy + "); a second later " + soon + "; after "
              + page.ASK_MS + " ms " + later + "; held " + ids());

  // 19f. A hull with a DEEPER floor, a punch on the card.
  NOW += page.ASK_MS;                         // (the ghost's wait run out)
  CONSOLE = HULLS.charlie;
  const f0 = { builds };
  page.vesselFollows("charlie"); await settle();
  const g19f = page.get();
  check("19f. a hull with a DEEPER floor is followed with ONE rebuild (floorFollows makes it and vesselAdopted makes no "
        + "second), the 2-3 m water a keep-out at her 4.5 m, and the punch's reason names the VESSEL, not only the floor",
        () => ids() === "charlie" && builds === f0.builds + 1 && nogo.builtMin === 4.5 && three() && wreckR() === 10
              && g19f.patClip === null
              && g19f.patDropped === "the vessel changed to Charlie and the guard's chart was rebuilt for her",
        () => "held " + ids() + ", rebuilds " + (builds - f0.builds) + ", built at " + nogo.builtMin + ", 2-3 m blocked "
              + three() + ", dropped " + JSON.stringify(g19f.patDropped));

  // 19g. Switched AGAIN, a second later.
  NOW += 1000; CONSOLE = HULLS.alpha;
  const g0 = gets;
  page.vesselFollows("alpha"); await settle();
  check("19g. ... and a hull switched AGAIN a second after a follow that landed is read at once: the wait is for a read "
        + "that came back without the hull, not for every read",
        () => gets === g0 + 1 && ids() === "alpha" && nogo.builtMin === 1 && !three(),
        () => "reads " + (gets - g0) + ", held " + ids() + ", built at " + nogo.builtMin);

  // 19h. No chart read.
  nogo.features = null;
  const h0 = { builds, ko: nogo.ko };
  NOW += 1000; CONSOLE = HULLS.bravo;
  page.vesselFollows("bravo"); await settle();
  check("19h. with no chart read a followed hull is adopted and said, and nothing is rebuilt",
        () => ids() === "bravo" && V.WRECK_RADIUS_M === 50 && builds === h0.builds && nogo.ko === h0.ko
              && /^The console's vessel is now Bravo, switched outside this tab/.test(last() || ""),
        () => "held " + ids() + ", rebuilds " + (builds - h0.builds) + ", note " + JSON.stringify(last()));
  nogo.features = FEATS; page.rebuildNogo();  // the chart back, built for Bravo

  // 19i. A SWITCH THIS TAB MAKES, to Alpha; the console's next frames name her before its answer lands.
  asv = { lat: REF.lat, lon: REF.lon };
  postGate = held();
  const i0 = { gets, posts, builds, trails, loads, reads: reads.length, notes: notes.length };
  const sw = page.switchVessel("alpha");
  await settle();
  for (let i = 0; i < 4; i++) page.vesselFollows("alpha");
  const during = { reads: gets - i0.gets, busy: page.get().busy };
  postGate.open(); postGate = null; await sw;
  const i1 = { during, posts: posts - i0.posts, held: ids(), r: wreckR(), rebuilds: builds - i0.builds,
               trails: trails - i0.trails, plans: loads - i0.loads, charts: reads.length - i0.reads,
               notes: notes.length - i0.notes, note: last(), busy: page.get().busy };
  check("19i. A SWITCH THIS TAB MAKES: frames naming the new hull before the console's answer lands ask nothing; the "
        + "answer adopts her once (a new trail, the chart rebuilt for her wreck radius), the plan and the chart round "
        + "her are read again, the switch is said - and the frames are free again after it",
        () => i1.during.reads === 0 && i1.during.busy === 1 && i1.posts === 1 && i1.held === "alpha" && i1.r === 10
              && i1.rebuilds === 1 && i1.trails === 1 && i1.plans === 1 && i1.charts === 1 && i1.notes === 1
              && i1.note === "Vessel: Alpha · nogo floor 1.0 m" && i1.busy === 0,
        () => JSON.stringify(i1));

  // 19j. A read already out (another tab switched to Bravo) when the operator here picks Bravo too.
  CONSOLE = HULLS.bravo;
  getGate = held();
  const j0 = { builds, trails };
  page.vesselFollows("bravo");
  postGate = held();
  const sw2 = page.switchVessel("bravo");
  await settle();
  getGate.open(); getGate = null; await settle();
  postGate.open(); postGate = null; await sw2;
  check("19j. a read already out when the operator picks the same hull adopts her once: the switch's answer, landing "
        + "after it, does not adopt her a second time",
        () => ids() === "bravo" && builds === j0.builds + 1 && trails === j0.trails + 1 && page.get().busy === 0,
        () => "held " + ids() + ", rebuilds " + (builds - j0.builds) + ", trails " + (trails - j0.trails));

  // 19k. A REFUSED switch - and one refused while another tab has switched the console meanwhile.
  refuse = "Disarm first";
  $("#sr_step").value = 99; page.punch("runs cut for Bravo");
  const k0 = { builds, trails, pickers: pickers.length, notes: notes.length };
  await page.switchVessel("charlie");
  const k1 = { held: ids(), step: step(), punch: page.get().patClip, rebuilds: builds - k0.builds, trails: trails - k0.trails,
               refills: pickers.length - k0.pickers, picker: pickers[pickers.length - 1], said: notes.slice(k0.notes) };
  CONSOLE = HULLS.charlie;
  await page.switchVessel("alpha");
  const k2 = { held: ids(), picker: pickers[pickers.length - 1], note: last(), busy: page.get().busy };
  refuse = null;
  check("19k. A REFUSED switch says why and puts the picker back on the console's hull without re-applying it (the "
        + "operator's search step and the punch stay); refused while the console flies ANOTHER hull, that hull is adopted",
        () => k1.held === "bravo" && k1.step === 99 && k1.punch === "runs cut for Bravo" && k1.rebuilds === 0
              && k1.trails === 0 && k1.refills === 1 && k1.picker === "bravo" && k1.said.join("|") === "Disarm first"
              && k2.held === "charlie" && k2.picker === "charlie" && k2.busy === 0
              && /^The console's vessel is now Charlie, switched outside this tab/.test(k2.note || ""),
        () => JSON.stringify({ k1, k2 }));

  // 19l. THE WIRING, as text: the frame, Take over, page start, and the console's frame.
  const on = noComments(grab(H, "onState"));
  const pillAt = H.indexOf('$("#supPill").onclick');
  const pill = pillAt < 0 ? "" : noComments(H.slice(pillAt, H.indexOf("\n};", pillAt)));
  const wired = {
    frame: /checkBoot\(s\.boot_id\);\s*if\(typeof logWakeTick === "function"\) logWakeTick\(s\);\s*vesselFollows\(s\.vessel_id\);/.test(on),
    takeOver: /const j = await supervisorBeat\(true\);\s*if\(j && j\.you\)\{ await loadVessel\(\); await loadMission\(\); \}/.test(pill),
    start: /loadPorts\(\)\.then\(loadVessel\)\.then\(loadMission\);/.test(H),
    server: /"vessel_id": \(VESSEL or \{\}\)\.get\("id"\) if isinstance\(VESSEL, dict\) else None,/.test(PY),
  };
  check("19l. THE WIRING: every state frame asks vesselFollows with the console's vessel_id, at its top; TAKE OVER reads "
        + "the hull BEFORE the plan, as page start does; and the console sends vessel_id in every frame",
        () => wired.frame && wired.takeOver && wired.start && wired.server,
        () => JSON.stringify(wired));

  // 19m. THE CENSUS AS A CHECK, as 18h is for the floor: the hull's other built-in chart inputs have ONE writer in the
  // page (applyVesselToUI) and it is called from vesselAdopted alone, which rebuilds after it - so no write of them
  // goes unbuilt. A new writer, or a caller of applyVesselToUI that goes round vesselAdopted, reddens this.
  const code19 = noComments(H.split("\r\n").join("\n"));
  const fnAt = (i) => (code19.slice(Math.max(code19.lastIndexOf("\nfunction ", i), code19.lastIndexOf("\nasync function ", i)))
                         .match(/function (\w+)\(/) || [])[1];
  const writers = [...code19.matchAll(/V\.(NOGO_BUFFER_M|WRECK_RADIUS_M|AIR_DRAFT_M|OVERHEAD_CLEARANCE_M)\s*=(?!=)/g)]
    .map((w) => w[1] + ":" + fnAt(w.index)).sort();
  const callers = [...code19.matchAll(/(?<!function )applyVesselToUI\(/g)].map((w) => fnAt(w.index)).sort();
  const census = writers.join(" ") + " | " + callers.join(" ");
  check("19m. the hull's built-in chart inputs (buffer, wreck radius, air draft, overhead clearance) have one writer in "
        + "the page, applyVesselToUI, and vesselAdopted - which rebuilds after it - is its only caller",
        () => census === "AIR_DRAFT_M:applyVesselToUI NOGO_BUFFER_M:applyVesselToUI OVERHEAD_CLEARANCE_M:applyVesselToUI "
                       + "WRECK_RADIUS_M:applyVesselToUI | vesselAdopted",
        () => census);
}

check18().then(check19).then(() => {
  __finished = true;
  console.log("\n" + (fails ? fails + " CHECK(S) FAILED" : "all " + ran + " checks passed"));
  process.exit(fails ? 1 : 0);
});

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
//
// 2026-11-09 - THE GUARD'S CHART FOLLOWS THE FLOOR (checks 18-18h, floorFollows), same sidecar method (LF-normalized,
// ASV_HTML), each mutant written with the check whose FAIL is its kill named first:
//   loadMission never asks floorFollows (THE DEFECT)       -> 18 (and 18d, 18g, 18h)
//   floorFollows rebuilds at every ask                     -> 18b (and 18c, 18e)
//   ... with no chart loaded                               -> 18f
//   rebuildNogo stops recording nogo.builtMin              -> 18b
//   compares the operator's Min depth, not the floor       -> 18c (and 18e)
//   the punch on the old chart kept                        -> 18
//   the punch dropped but not SAID (setMinDepth's shape)   -> 18
//   applyVesselToUI never asks floorFollows                -> 18e (and 18c, 18d, 18h)
//   the refusal's short reason names the water again       -> 18
//   measured from the value replaced, not the chart built  -> 18g
//   loadMission asks BEFORE its write                      -> 18 (and 18h)
//   a NEW writer of the floor that rebuilds nothing        -> 18h
//   the punch dropped, the chart not rebuilt               -> 18
// 13 mutations, 13 killed by their named check. The master page (no floorFollows) fails the suite at FAIL 0.
// ⚠ The first run scored three SURVIVED as crashes: with the punch kept, punchRefusal read the joins (patJoined) this
// world does not stand up - 18 asks it only of a dropped punch now, which is the one it is about.
//
// 2026-11-09 - THE CONSOLE'S VESSEL, FOLLOWED (checks 19-19l: loadVessel / vesselAdopted / vesselFollows / switchVessel),
// with 19m the census, the same sidecar method, each mutant written with the check whose FAIL is its kill named first:
//   onState never asks vesselFollows                       -> 19l
//   Take over reads only the plan (THE DEFECT)             -> 19l
//   vesselFollows ignores a read in flight                 -> 19e (and 19i)
//   ... asks whatever the frame names                      -> 19c
//   ... takes a frame naming no hull                       -> 19c (and 19e)
//   no wait after a read that came back without the hull   -> 19e
//   the wait after EVERY read                              -> 19g (and 19e, 19h)
//   loadVessel re-applies the same hull                    -> 19d (and 19f, 19k)
//   the picker refilled only on a change                   -> 19d (and 19k)
//   the switch said at page start                          -> 19
//   the trail cleared at page start                        -> 19
//   vesselAdopted never rebuilds (floorFollows alone)      -> 19b (and 19i, 19j)
//   vesselAdopted rebuilds again after floorFollows        -> 19f
//   the punch cut for the old hull kept                    -> 19b
//   the punch read after applyVesselToUI (floor's reason)  -> 19f
//   switchVessel never holds the frames off                -> 19i (and 19j, 19k)
//   switchVessel adopts again after a read did             -> 19j
//   switchVessel never lets the frames go                  -> 19i (and 19j, 19k)
//   a refused switch reads nothing back                    -> 19k
//   switchVessel's old success path                        -> 19i (and 19j, 19m)
//   loadVessel never lets the frames go                    -> 19b (and 19d-19k)
//   a NEW writer of the wreck radius that rebuilds nothing -> 19m
//   loadVessel applies the hull itself, round vesselAdopted -> 19m (and 19b, 19f, 19j)
// 23 mutations, 23 killed by their named check, none crashed. The master page (no vesselBusy) fails at FAIL 0.
