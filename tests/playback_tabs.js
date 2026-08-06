// tests/playback_tabs.js - the playback page reconstructs the WHOLE mission picture.
//
// WHY THIS EXISTS. The recorder now carries env / water / ais / vessel / mission
// streams (tests/record_playback.py owns that half); THIS suite owns the reader:
// playback.html parses the new kinds, resolves each stream at the scrub cursor, feeds
// the recorded mission into the plan overlay (which is how lines drawn in a PREVIOUS
// session reach this session's chart), and offers the CHART | CONTROLS tabs over one
// scrubber. All of it must degrade to "not recorded" on an older file, never guess.
//
// The pure logic is extracted with the house grab() harness and driven with synthetic
// sessions; the DOM-only parts (tab wiring, card ids) are source-shape checks, the
// same split as ais_table.js.
//
// TEETH - five mutations RUN against static/playback.html, 5/5 caught (recorded):
//   * planAt ignores kind:"mission" records            -> caught by 4 (the
//     previous-session lines vanish from the chart)
//   * a mission COMMAND stops overriding the record    -> caught by 5 (chronology is
//     the contract, whichever feed a plan came from)
//   * lastBefore leaks the FUTURE                      -> caught by 3 and 3b
//   * parseSession drops the env stream                -> caught by 1 and 3b
//   * the AIS overlay loses its cursor resolve         -> caught by 6, on a RE-RUN:
//     the first anchor matched TWICE (render and renderControls both resolve AIS
//     through the same line - the anchor-x2 lesson again) and the runner SKIPPED
//     loudly instead of mutating the wrong one; re-anchored on render's own context.
//
// NOTE: no "use strict" - the page's classic browser <script> runs sloppy.

const fs = require("fs");
const path = require("path");

const H = fs.readFileSync(path.join(__dirname, "..", "static", "playback.html"), "utf8");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try {
    ok = !!(typeof cond === "function" ? cond() : cond);
    note = typeof detail === "function" ? detail() : detail;
  } catch (e) { ok = false; note = "THREW: " + e.message; }
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

console.log("Playback tabs — the recording replayed as the mission the operator flew:");

// ---- a synthetic session: picture streams + commands, interleaved ------------------ //
const REC_MISSION = { lines: [{ a: { lat: 1, lon: 1 }, b: { lat: 1, lon: 2 } }],
                      speed: "survey", buffer_m: 3 };
const CMD_MISSION = { lines: [{ a: { lat: 2, lon: 1 }, b: { lat: 2, lon: 2 } },
                              { a: { lat: 3, lon: 1 }, b: { lat: 3, lon: 2 } }],
                      speed: "low" };
const SESSION = [
  { t: 100, kind: "session_start", argv: [] },
  { t: 100.5, kind: "vessel", vessel: { id: "drix08", name: "DriX H-8", loa_m: 7.71, power: "fuel" } },
  { t: 101, kind: "mission", mission: REC_MISSION },          // the PRE-SESSION plan
  { t: 110, kind: "env", env: { wind: { speed_kn: 18, dir_from_deg: 200 },
                                sea: { hs_m: 0.8, tp_s: 5 }, source: "manual" } },
  // NOTE the payload's own "t: null" - the water snapshot really carries one during
  // an upstream outage, and it clobbered the record time in the first live replay.
  { t: 115, kind: "water", water: { offset_m: 0.6, source: "manual", t: null } },
  { t: 120, kind: "ais", ais: { n: 2, vessels: [
      { mmsi: 1, name: "ONE", lat: 1.1, lon: 1.1, cog: 90, sog: 5 },
      { mmsi: 2, name: "TWO", lat: 1.2, lon: 1.2, cog: 180, sog: 3 }] } },
  { t: 200, kind: "command", path: "/api/mission", body: CMD_MISSION, code: 200 },
  { t: 250, kind: "env", env: { wind: { speed_kn: 25, dir_from_deg: 270 }, source: "manual" } },
];
const LEGACY = [                                              // an older recording
  { t: 100, kind: "session_start", argv: [] },
  { t: 120, kind: "command", path: "/api/mission", body: CMD_MISSION, code: 200 },
  { t: 130, kind: "telemetry", status: { lat_deg: 1, lon_deg: 1 } },
];

// ---- 1-2. parseSession collects the picture streams, and survives their absence ---- //
// Evaluate parseSession in a scope carrying the module-level names it writes.
function runParse(events) {
  const scope = "let FIXES=[],STATES=[],MARKS=[],ENVS=[],WATERS=[],AISES=[],VSLS=[],MISS=[];" +
                "let T0=0,T1=0,DUR=0; const EVENTS=arguments[0];" +
                "const CMD_LABEL={}; const fmtLL=()=>''; const window={};" +
                grab("parseSession") + "; parseSession();" +
                "return {FIXES,STATES,MARKS,ENVS,WATERS,AISES,VSLS,MISS,T0,T1,DUR};";
  return new Function(scope)(events);
}
const P = runParse(SESSION);
check("1. the picture streams parse: env, water, ais, vessel, mission all collected",
      () => P.ENVS.length === 2 && P.WATERS.length === 1 && P.AISES.length === 1
         && P.VSLS.length === 1 && P.MISS.length === 1,
      () => `env=${P.ENVS.length} water=${P.WATERS.length} ais=${P.AISES.length} ` +
            `vsl=${P.VSLS.length} miss=${P.MISS.length}`);
const L = runParse(LEGACY);
check("2. an OLDER recording parses to EMPTY streams - no throw, no invented data",
      () => L.ENVS.length === 0 && L.WATERS.length === 0 && L.AISES.length === 0
         && L.VSLS.length === 0 && L.MISS.length === 0 && L.FIXES.length === 1,
      () => `all empty, fixes=${L.FIXES.length}`);

// ---- 3. lastBefore: the operator saw the LAST thing recorded, never the future ----- //
const lastBefore = new Function("return " + grab("lastBefore"))();
check("3. before the first record the honest answer is null - never a value borrowed "
      + "from the future",
      () => lastBefore(P.ENVS, 105) === null,
      "cursor at t=105, first env at t=110");
check("3b. between records the EARLIER one stands; after the last, the last stands",
      () => lastBefore(P.ENVS, 150).wind.speed_kn === 18
         && lastBefore(P.ENVS, 999).wind.speed_kn === 25,
      () => `at150=${lastBefore(P.ENVS, 150).wind.speed_kn} at999=${lastBefore(P.ENVS, 999).wind.speed_kn}`);
check("3c. a payload's OWN 't' key never clobbers the RECORD time - the water snapshot "
      + "carries one (null during an upstream outage) and the first live replay showed "
      + "the manual override as 'not recorded' because of it",
      () => P.WATERS.length === 1 && P.WATERS[0].t === 115
         && lastBefore(P.WATERS, 150).offset_m === 0.6,
      () => `record t=${P.WATERS[0].t}, resolves=${!!lastBefore(P.WATERS, 150)}`);

// ---- 4-5. planAt: two feeds, one chronology ---------------------------------------- //
function runPlanAt(events, absT) {
  return new Function("const EVENTS=arguments[0];" + grab("planAt") +
                      "; return planAt(arguments[1]);")(events, absT);
}
check("4. THE PAYOFF: lines from a PREVIOUS session reach the chart - the recorded "
      + "mission drives the overlay before any command exists",
      () => runPlanAt(SESSION, 150).mission.lines.length === 1
         && runPlanAt(SESSION, 150).mission.speed === "survey",
      () => `at t=150: ${runPlanAt(SESSION, 150).mission.lines.length} line(s)`);
check("5. ... and a mission COMMAND later in the session overrides it - chronology is "
      + "the contract, whichever feed the plan came from",
      () => runPlanAt(SESSION, 300).mission.lines.length === 2
         && runPlanAt(SESSION, 300).mission.speed === "low",
      () => `at t=300: ${runPlanAt(SESSION, 300).mission.lines.length} line(s)`);

// ---- 6-8. the DOM-facing halves, by source shape ----------------------------------- //
const RENDER = grab("render");
check("6. the chart draws the recorded traffic AT THE CURSOR - the AIS overlay "
      + "resolves through lastBefore, not a static list",
      () => /lastBefore\(AISES,\s*absT\)/.test(RENDER) && /ais\.vessels/.test(RENDER),
      "render() must ask what the operator SAW at that moment");
check("6b. ... and the weather widget the same way",
      () => /lastBefore\(ENVS,\s*absT\)/.test(RENDER),
      "the wind arrow is the recorded wind, not the last one");

const CONTROLS = grab("renderControls");
check("7. the controls cards resolve EVERY stream at the cursor",
      () => /lastBefore\(ENVS,\s*absT\)/.test(CONTROLS)
         && /lastBefore\(WATERS,\s*absT\)/.test(CONTROLS)
         && /lastBefore\(AISES,\s*absT\)/.test(CONTROLS)
         && /lastBefore\(VSLS,\s*absT\)/.test(CONTROLS)
         && /planAt\(absT\)/.test(CONTROLS),
      "env, water, ais, vessel, mission - all cursor-resolved");
check("7b. ... and every absent stream reads NOT RECORDED, never a guess",
      () => (CONTROLS.match(/setNA\(/g) || []).length >= 8
         && /not recorded/.test(H),
      "the honest placeholder is the contract for old files");

const SETVIEW = grab("setView");
check("8. the tabs are one cursor, two views: switching repaints AT THE SAME pt",
      () => /applyAt\(pt\)/.test(SETVIEW) && /classList\.toggle\("controls"/.test(SETVIEW)
         && /#tab_chart/.test(H) && /#tab_controls|tab_controls/.test(H),
      "setView must not move the scrubber");

console.log(fails ? `\n${fails} CHECK(S) FAILED (${ran} ran)` : `\nall checks passed (${ran})`);
process.exit(fails ? 1 : 0);
