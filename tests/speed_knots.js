// tests/speed_knots.js - the page's half of speed in WHOLE KNOTS (2026-10-09).
//
// Andy: "Change speed selection to knots in integer increments. This is commanded speed that environmental forcing
// will affect. All ASV's."
//
// The four role selectors (the SURV card's survey / turn / transit and the command bar's transit) offered Low / Survey
// / High. They now offer the hull's whole knots - its low rounded up to its high rounded down - from the list the
// console derives and sends with the vessel (propulsion.speed_steps_kn; tests/speed_knots.py is the console's half).
// Each is a key of V.SPEED_KN ("7" -> 7), so roleSpeed, the governor, the estimates and the turn radius take it as
// they took a named one. The named three stay in the table as the CONSOLE's speeds (the guard's low, the escape's high)
// and are on no selector - so nothing may tell the operator to select LOW, and advice to slow down is judged at, and
// names, the slowest speed they CAN select (on the small-class hull 2 kn, where its low is 1.5).
//
//   node tests/speed_knots.js      # exit 0 = pass, 1 = fail   (stdlib Node)

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
const { minTurnRadiusM } = require("../static/js/turns.js");

// ASV_HTML points this at a SIDECAR copy for a mutation run, never the real page.
const H = fs.readFileSync(process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html"), "utf8");

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
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "detail threw " + e.message; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : "") + err);
  if (!ok) fails++;
}

// ---- a DOM just big enough for a <select>: setting `value` to a key it holds no option for leaves it BLANK, as a real
// browser does - which is what makes "the selector shows the plan's speed" a claim this suite can fail.
function fakeSelect() {
  const el = { options: [], _v: "", textContent: "",
    set innerHTML(x) { this.options = []; this._v = ""; },
    appendChild(o) { this.options.push(o); if (this.options.length === 1) this._v = o.value; },
    get value() { return this._v; },
    set value(x) { this._v = this.options.some(o => o.value === String(x)) ? String(x) : ""; } };
  return el;
}
const DOM = { "#sp_spd_transit": fakeSelect(), "#sp_spd_turn": fakeSelect(), "#sp_spd_survey": fakeSelect(),
              "#c_spd_transit": fakeSelect(), "#sp_spd_note": { textContent: "" } };
function $(id) { return DOM[id] || null; }
global.document = { createElement: () => ({ value: "", textContent: "" }) };

// ---- the page's world for setRoleSpeed: what it reads, stubbed where it is not the subject
var mission = { speed: "survey", speeds: {}, lead_mode: "m" };
var resumeSlow = false, commandedSpeed = "x", saved = 0, notes = [], released = [], recalcs = 0;
function saveMission() { saved++; }
function flashNote(m) { notes.push(m); }
function releaseEscapeClaim(why) { released.push(why); }
function updateLeadNote() {}
function recalcForSpeed() { recalcs++; }

// eslint-disable-next-line no-eval
eval(grabDecl("SPEED_ROLES") + "\n" + grabDecl("SPEED_SELECTS") + "\n" +
     grab("isStepKey") + "\n" + grab("spdTxt") + "\n" + grab("spdAtTxt") + "\n" + grab("slowestSelectableKey") + "\n" +
     grab("fillSpeedSelects") + "\n" + grab("updateSpeedNote") + "\n" + grab("setRoleSpeed") + "\n" +
     grab("roleSpeed") + "\n" + grab("roleSpeedMS") + "\n" +
     "function __roles(){ return SPEED_ROLES; }");

// applyVesselToUI's speed block, run as the page runs it: everything else in that function (the buffer floor, the depth
// floor, the search defaults) is other suites' subject and would need a whole page to stand up.
const A = grab("applyVesselToUI");
const i0 = A.indexOf("if(v.propulsion && v.propulsion.speeds_kn){");
if (i0 < 0) throw new Error("test setup: applyVesselToUI's speed block not found (rewritten?)");
let k = A.indexOf("{", i0), depth = 0;
for (;;) { const c = A[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
// eslint-disable-next-line no-eval
const applySpeeds = eval("(function(v){ " + A.slice(i0, k + 1) + " })");

const EM712 = { propulsion: { speeds_kn: { low: 4.0, survey: 7.0, high: 10.0 }, speed_steps_kn: [4, 5, 6, 7, 8, 9, 10] } };
const SMALL = { propulsion: { speeds_kn: { low: 1.5, survey: 3.0, high: 6.0 }, speed_steps_kn: [2, 3, 4, 5, 6] } };
const opts = el => el.options.map(o => o.value + "=" + o.textContent).join(",");

console.log("Speed selected in whole knots - the page:");

// 1. THE VESSEL FILLS THE TABLE AND THE SELECTORS.
mission.speeds = { transit: "9", turn: "4", survey: "7" };
V.MAX_TURN_RATE_DEG_S = 20;
applySpeeds(EM712);
check("1. the vessel's whole knots join the named three in V.SPEED_KN (\"7\" -> 7) and become V.SPEED_STEPS",
      () => JSON.stringify(V.SPEED_STEPS) === "[4,5,6,7,8,9,10]" && V.SPEED_KN["7"] === 7 && V.SPEED_KN["10"] === 10
            && V.SPEED_KN.low === 4 && V.SPEED_KN.survey === 7 && V.SPEED_KN.high === 10
            && Object.keys(V.SPEED_KN).length === 10,
      () => JSON.stringify(V.SPEED_KN));
check("1b. ALL FOUR selectors offer exactly those, labelled in knots, and show the plan's speeds - the command bar's "
      + "transit copy included",
      () => ["#sp_spd_transit", "#sp_spd_turn", "#sp_spd_survey", "#c_spd_transit"].every(id =>
              opts(DOM[id]) === "4=4 kn,5=5 kn,6=6 kn,7=7 kn,8=8 kn,9=9 kn,10=10 kn")
            && DOM["#sp_spd_transit"].value === "9" && DOM["#c_spd_transit"].value === "9"
            && DOM["#sp_spd_turn"].value === "4" && DOM["#sp_spd_survey"].value === "7",
      () => opts(DOM["#sp_spd_survey"]) + " | " + ["#sp_spd_transit", "#sp_spd_turn", "#sp_spd_survey", "#c_spd_transit"]
              .map(id => DOM[id].value).join("/"));

// 2. A WHOLE KNOT IS A SPEED LIKE ANY OTHER to everything that turns a key into one.
check("2. roleSpeed answers the whole knot, roleSpeedMS its m/s, and the turn radius is the one that speed has "
      + "(\"4\" turns as tightly as `low`, both 4 kn on this hull; \"10\" as `high`)",
      () => roleSpeed("survey") === "7" && Math.abs(roleSpeedMS("survey") - 7 * 0.514444) < 1e-12
            && roleSpeed("transit") === "9"
            && minTurnRadiusM("4") === minTurnRadiusM("low") && minTurnRadiusM("10") === minTurnRadiusM("high")
            && minTurnRadiusM("7") > minTurnRadiusM("4"),
      () => "survey " + roleSpeed("survey") + " " + roleSpeedMS("survey").toFixed(3) + " m/s; R(4) "
            + minTurnRadiusM("4").toFixed(2) + " = R(low) " + minTurnRadiusM("low").toFixed(2));

// 3. THE SELECTOR COMMANDS (setRoleSpeed), and the note says what the knots are.
setRoleSpeed("survey", "8");
check("3. picking 8 kn on the survey selector sets the plan's survey speed to \"8\", saves, and hands the throttle to "
      + "the governor (commandedSpeed null) - as a named pick always did",
      () => mission.speeds.survey === "8" && DOM["#sp_spd_survey"].value === "8" && saved === 1
            && commandedSpeed === null && recalcs === 1,
      () => JSON.stringify(mission.speeds) + " saved " + saved + " commanded " + commandedSpeed);
check("3b. the note under them reads in knots and says they are COMMANDED through the water",
      () => /transit 9 kn · turn 4 kn · survey 8 kn/.test(DOM["#sp_spd_note"].textContent)
            && /commanded through the water; current and wind change her speed over the ground/.test(DOM["#sp_spd_note"].textContent),
      () => DOM["#sp_spd_note"].textContent);
setRoleSpeed("turn", "8"); setRoleSpeed("transit", "8");
check("3c. ... and when the three agree it says so, in knots",
      () => /^all three at 8 kn — set them apart to differ/.test(DOM["#sp_spd_note"].textContent)
            && DOM["#c_spd_transit"].value === "8",
      () => DOM["#sp_spd_note"].textContent);

// 4. THE WORDS.
check("4. spdTxt reads a whole knot as \"7 kn\" and a named speed as its name (\"SLOWED to low\" is unchanged); "
      + "spdAtTxt says \"7 kn\" or \"survey speed\"",
      () => spdTxt("7") === "7 kn" && spdTxt("low") === "low" && spdTxt("high") === "high"
            && spdAtTxt("7") === "7 kn" && spdAtTxt("survey") === "survey speed" && !isStepKey("low") && isStepKey("12"),
      () => [spdTxt("7"), spdTxt("low"), spdAtTxt("7"), spdAtTxt("survey")].join(" | "));

// 5. THE SLOWEST SPEED THE OPERATOR CAN PICK, and a hull switch.
const slow712 = slowestSelectableKey();
mission.speeds = { transit: "6", turn: "2", survey: "3" };          // what the console sends back after the switch
applySpeeds(SMALL);
check("5. the slowest speed the operator can SELECT is the first whole knot - 4 on the EM712, 2 on the small-class "
      + "hull, whose low (1.5) is on no selector - and a switch re-fills every selector with the new hull's knots",
      () => slow712 === "4" && slowestSelectableKey() === "2" && V.SPEED_KN.low === 1.5 && V.SPEED_KN["10"] === undefined
            && opts(DOM["#sp_spd_turn"]) === "2=2 kn,3=3 kn,4=4 kn,5=5 kn,6=6 kn"
            && DOM["#sp_spd_turn"].value === "2" && DOM["#c_spd_transit"].value === "6",
      () => "EM712 " + slow712 + ", small " + slowestSelectableKey() + "; " + opts(DOM["#sp_spd_turn"]));
V.SPEED_STEPS = [];
check("5b. with no whole knots (no vessel yet) it falls back to `low`, as the advice did before",
      () => slowestSelectableKey() === "low");

// 6. NOTHING TELLS THE OPERATOR TO SELECT A SPEED THAT IS ON NO SELECTOR. Pinned in the source: these are messages.
const refusal = grab("punchRefusal");
check("6. the refused-turn advice is JUDGED at the slowest selectable speed and NAMES it - not `low`, which the "
      + "small-class hull's operator cannot pick",
      () => /needLow = 2 \* minTurnRadiusM\(slowestSelectableKey\(\)\)/.test(refusal)
            && /fixes\.push\("set the TURN speed to " \+ spdTxt\(slowestSelectableKey\(\)\)/.test(refusal)
            && !/set the TURN speed to low/.test(H),
      "punchRefusal");
check("6b. the spacing advice likewise (\"or set the turn speed to N kn\"), and no message says to select LOW, set a "
      + "speed to LOW or plan at low speed",
      () => /lowSpacing = 2\*minTurnRadiusM\(makesWayKey\(slowestSelectableKey\(\)\)\)/.test(H)
            && /or set the turn speed to \$\{spdTxt\(slowestSelectableKey\(\)\)\}/.test(H)
            && !/select LOW/.test(H) && !/speed to LOW/.test(H) && !/plan at low speed/.test(H),
      () => "select LOW " + (H.match(/select LOW/g) || []).length + ", speed to LOW " + (H.match(/speed to LOW/g) || []).length);

// 7. THE MARKUP carries no options - they come from the vessel - and the labels say knots.
const sel = id => { const i = H.indexOf('<select id="' + id + '"'); return H.slice(i, H.indexOf("</select>", i)); };
check("7. none of the four selectors carries an option in the markup (a Low / Survey / High left there would show "
      + "before the vessel arrives and be a speed the console no longer offers), and their labels read kn",
      () => ["sp_spd_survey", "sp_spd_turn", "sp_spd_transit", "c_spd_transit"].every(id => !/<option/.test(sel(id)))
            && /<label>Survey kn<\/label>/.test(H) && /<label>Turn kn<\/label>/.test(H)
            && /<label>Transit kn<\/label>/.test(H) && />Transit kn<\/label>/.test(H),
      () => ["sp_spd_survey", "sp_spd_turn", "sp_spd_transit", "c_spd_transit"].map(id => id + ":" + /<option/.test(sel(id))).join(" "));

// 8. THE READOUTS say a whole knot once ("told 7 kn", "transit 9 kn", the vessel card's "7 kn") - pinned in the source.
check("8. the route card's told and speeds rows and the vessel card read a whole knot as \"N kn\" (a named key keeps "
      + "its old form)",
      () => /isStepKey\(st\.speed_key\) \? " · told " \+ spdTxt\(st\.speed_key\)/.test(H)
            && /const txt = r \+ " " \+ \(isStepKey\(k\) \? spdTxt\(k\) : k \+/.test(H)
            && /msp\.textContent = isStepKey\(k\) \? spdTxt\(k\) : k \+/.test(H));

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
