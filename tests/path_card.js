// tests/path_card.js - THE PATH PLANNING CARD (Andy, 2026-10-13: "Consider a single path planning card that holds all
// these behaviors and presents the necessary controls and readings for each when chosen. Kill the chips and permanently
// load the Path Planning card in the ASV Controls browser on start", then "add Go-To and go", and "Consider removing the
// repeats in the command bar").
//
// The WPT / SURV / BND / SRCH / TRAN chips and their four cards became ONE card, always loaded, with five tabs (Survey -
// the area its Area row - Search, Transit, Go-To, Waypoints). Driven here: the page's own pathSelect / pathDraw /
// pathEscape / setGotoTarget / gotoFromInputs / pathRender / pathReadings and its real setMode, in a sandbox DOM.
//
//   1-1c  the markup: no chips, the card always shown, five tabs, the bodies keep the four cards' ids (the controls
//         window relays BY ID), the area inside Survey; ONE bridged card, ONE uicard, ONE resizable card; the command
//         bar repeats none of Route rules
//   2-2d  a TAB is what the card shows, DRAWING is the chart's mode: an empty tab arms the chart, one with something
//         drawn does not (and stops another tab's drawing), Waypoints never arms itself, the tab showing changes nothing
//   3-3b  a drawing mode brings its tab (the survey table's ✎ arms "survey"; the area is the Survey tab's); Draw toggles
//   4-4b  Esc stops drawing - and the chart says while it draws, in its own pill, hidden in the controls window
//   5-5c  the Go-To point: a chart click SETS it (nothing commanded), typed fields set it only when both are valid, Go is
//         gated on ARM and stops drawing before it commands
//   6     the readings: transit length and time at the transit speed, the plan at the foot, Route rules folded to a line
//   7     Add to plan, Sail passage and Follow end the drawing; the search preview follows its tab
//   8     the first render runs once every name it reads is declared
//
//     node tests/path_card.js      # exit 0 = pass, 1 = fail
"use strict";
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " + (e && e.stack || e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const fs = require("fs");
const path = require("path");
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok = false, d = detail;
  try { ok = !!(typeof cond === "function" ? cond() : cond); if (typeof detail === "function") d = detail(); }
  catch (e) { ok = false; d = "threw " + e; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   [" + d + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function decl(re) {
  const m = H.match(new RegExp(re, "m"));
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}

console.log("The Path planning card:");

// ── 1. the markup ─────────────────────────────────────────────────────────────────────────────────────────────────────
const CARD = H.slice(H.indexOf('<div class="panel" id="pathPanel">'), H.indexOf("<!-- ROC / HOME card"));
const CONTROLS = H.slice(H.indexOf('<div class="controls">'), H.indexOf("</div>", H.indexOf('<div class="controls">')));
const CMDBAR = H.slice(H.indexOf('<div class="cmdbar">'), H.indexOf('id="b_arm"'));
const bodyOf = (id) => { const m = CARD.match(new RegExp('<div class="ppbody" id="' + id + '" data-tab="(\\w+)">')); return m && m[1]; };
check("1. THE CHIPS ARE GONE AND THE CARD IS ALWAYS THERE: no WPT / SURV / BND / SRCH / TRAN on the toolbar, the card "
      + "authored shown (no display:none), five tabs, and the bodies keep the four cards' ids - Survey (#linePanel, with "
      + "the area #boundPanel inside it), Search, Transit - beside the new Go-To and Waypoints",
      () => !/id="(wptBtn|lineBtn|bndBtn|srchBtn|tranBtn|areaBtn)"/.test(CONTROLS) && !/id="(wptBtn|lineBtn|bndBtn|srchBtn|tranBtn)"/.test(H)
            && CARD.length > 5000
            && ["survey", "search", "transit", "goto", "wpt"].every(t => new RegExp('id="pp_tab_' + t + '"').test(CARD))
            && bodyOf("linePanel") === "survey" && bodyOf("searchPanel") === "search" && bodyOf("transitPanel") === "transit"
            && bodyOf("gotoPanel") === "goto" && bodyOf("wptPanel") === "wpt"
            && CARD.indexOf('id="boundPanel"') > CARD.indexOf('id="linePanel"') && CARD.indexOf('id="boundPanel"') < CARD.indexOf('id="searchPanel"')
            && /id="areaBtn"/.test(CARD),
      () => "card " + CARD.length + " chars; bodies " + ["linePanel", "searchPanel", "transitPanel", "gotoPanel", "wptPanel"].map(b => b + "=" + bodyOf(b)).join(" "));
check("1b. ... ONE card crosses to the controls window, as ONE uicard titled Path planning, ONE resizable card on the "
      + "chart - none of the four old cards named anywhere - and the chart hides it while a controls window shows it",
      () => /const UI_BRIDGED = \[".controls", "#pathPanel", "#rocPanel",/.test(H)
            && /"#pathPanel":"Path planning"/.test(H) && /\{sel:"#pathPanel"\}/.test(H)
            && !/"#(linePanel|boundPanel|searchPanel|transitPanel)"/.test(decl("^const UI_BRIDGED = \\[[^\\]]*\\]"))
            && !/"#(linePanel|boundPanel|searchPanel|transitPanel)"/.test(H.slice(H.indexOf("const UI_CARD_TITLES"), H.indexOf("const UI_LAYOUT_KEY")))
            && !/sel:"#(linePanel|boundPanel|searchPanel|transitPanel)"/.test(H)
            && /body\.ui-split #pathPanel/.test(H),
      "one card, one mirror, one placement");
check("1c. ROUTE RULES IS THE ONE COPY: Min depth, Water, Buffer, Transit kn, Channel rocks and the chart features "
      + "are under it, shown under every tab - and the command bar no longer repeats Buffer, Min depth or Transit kn",
      () => { const R = CARD.slice(CARD.indexOf('id="pp_rules"'), CARD.indexOf('id="pp_plan"'));
              return ["sp_mindepth", "sp_water", "sp_buffer", "sp_spd_transit", "enf_rock", "enf_land", "enf_chan"].every(id => R.includes('id="' + id + '"'))
                && !/id="(c_buffer|c_mindepth|c_spd_transit)"/.test(H) && /id="c_arrival"/.test(CMDBAR) && /id="c_completion"/.test(H); },
      "Arr m, Appr m and End of plan stay on the bar: nothing else carries them");

// ── the sandbox: the page's own functions over a small DOM ─────────────────────────────────────────────────────────────
function mkEl(id, extra) {
  const cls = new Set();
  return Object.assign({ id, textContent: "", value: "", disabled: false, style: {}, dataset: {},
    classList: { toggle(c, f) { const on = f === undefined ? !cls.has(c) : !!f; if (on) cls.add(c); else cls.delete(c); return on; },
                 contains: (c) => cls.has(c), add: (c) => cls.add(c), remove: (c) => cls.delete(c) } }, extra || {});
}
const SRC = [decl("^const PATH_TABS = .*$"), decl("^const PATH_TAB_OF = .*$"), decl("^const PATH_DRAW = .*$"),
  decl("^const PATH_TAG = \\{[^}]*\\};"), decl("^const PATH_TAB_KEY = .*$"),
  grab("setMode"), grab("pathDrawing"), grab("pathEmpty"), grab("pathSelect"), grab("pathDraw"), grab("pathStopDrawing"),
  grab("pathEscape"), grab("searchShown"), grab("setGotoTarget"), grab("gotoFromInputs"), grab("pathLen"), grab("pathTimeTxt"),
  grab("pathRender"), grab("pathReadings")].join("\n");
function world() {
  const ids = ["#pathPanel", "#pp_draw", "#pp_fold", "#pp_rules", "#bnd_draw", "#r_draw", "#gt_lat", "#gt_lon", "#gt_range",
    "#gt_time", "#gt_go", "#gt_hint", "#tr_len", "#tr_time", "#sr_len", "#wp_n", "#wp_lines", "#wp_len", "#pp_plan .ppsum",
    "#pp_rules .pprsum", "#sp_mindepth", "#sp_buffer", "#sp_water",
    "#pp_tab_survey", "#pp_tab_search", "#pp_tab_transit", "#pp_tab_goto", "#pp_tab_wpt"];
  const D = {};
  for (const i of ids) D[i] = mkEl(i);
  D["#sp_mindepth"].value = "2"; D["#sp_buffer"].value = "5"; D["#sp_water"].value = "";
  const bodies = ["survey", "search", "transit", "goto", "wpt"].map(t => mkEl("body-" + t, { dataset: { tab: t } }));
  D["#pathPanel"].querySelectorAll = () => bodies;
  const log = { renders: 0, readings: 0, ls: {} };
  const env = { D, bodies, log, mapEl: { style: {} },
    lsGet: (k, d) => (k in log.ls ? log.ls[k] : d), lsSet: (k, v) => { log.ls[k] = v; },
    updatePatReadout() {}, updateSearchPanel() {}, updateTransitPanel() {}, render() { log.renders++; },
    distTo: (a, b) => Math.hypot((b.lat - a.lat) * 111320, (b.lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180)),
    fmtDist: (m) => (m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km"),
    fmtDur: (s) => Math.round(s / 60) + "m", fmtBrgRange: () => "045° · 2.00 km",
    // ROLE-AWARE: transit 6 kn, survey 4 kn - a reading taken at the wrong role's speed says so
    roleSpeed: (r) => (r === "transit" ? "6" : "4"), roleSpeedMS: (r) => (r === "transit" ? 6 : 4) * 0.514444, spdTxt: (k) => k + " kn",
    searchRoute: () => [], searchRouted: null };
  // eslint-disable-next-line no-new-func
  const api = new Function("env", `"use strict";
    const $ = (s) => env.D[s] || null;
    const {mapEl, lsGet, lsSet, updatePatReadout, updateSearchPanel, updateTransitPanel, distTo, fmtDist, fmtDur, fmtBrgRange,
           roleSpeed, roleSpeedMS, spdTxt, searchRoute} = env;
    const render = () => env.render();
    let mode = "pan", rocPlaceKind = null, measPend = null, center = {lat: 43, lon: -70.7};
    let pathTab = "survey", pathFold = false, pathRulesFold = false, gotoTarget = null, searchRouted = env.searchRouted;
    let pat = {A: null, B: null, C: null}, search = {type: "expbox", datum: null}, transit = [], asv = {lat: 43.07, lon: -70.71};
    let mission = {waypoints: [], lines: []}, armed = false;
    const canCommand = () => armed;
    ${SRC}
    return { setMode, pathSelect, pathDraw, pathEscape, pathStopDrawing, searchShown, setGotoTarget, gotoFromInputs, pathRender,
             pathReadings, get mode(){ return mode; }, get tab(){ return pathTab; }, get target(){ return gotoTarget; },
             set: (k, v) => { if(k === "pat") pat = v; else if(k === "transit") transit = v; else if(k === "search") search = v;
                              else if(k === "mission") mission = v; else if(k === "armed") armed = v; else if(k === "tab") pathTab = v;
                              else if(k === "rulesFold") pathRulesFold = v; } };`)(env);
  return { api, D, bodies, log };
}
const shown = (w) => w.bodies.filter(b => b.classList.contains("on")).map(b => b.dataset.tab).join(",");
const tabOn = (w) => ["survey", "search", "transit", "goto", "wpt"].filter(t => w.D["#pp_tab_" + t].classList.contains("on")).join(",");

// ── 2. tab vs drawing ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const w = world(), a = w.api;
  a.pathRender();
  const start = [a.mode, tabOn(w), shown(w), w.D["#pp_draw"].textContent, w.D["#r_draw"].style.display];
  a.pathSelect("transit");                                   // nothing drawn on Transit: the chart is armed for it
  const armed = [a.mode, tabOn(w), shown(w), w.D["#pp_draw"].textContent, w.D["#pp_draw"].classList.contains("on"),
                 w.D["#r_draw"].textContent, w.D["#r_draw"].style.display, w.D["#bnd_draw"].classList.contains("on")];
  check("2. AN EMPTY TAB ARMS THE CHART FOR ITSELF, AS THE OLD CHIP'S FIRST CLICK DID: from panning on Survey, Transit "
        + "(nothing drawn) shows its body, lights Draw ('Drawing') and the chart's pill says what a click will do",
        () => start.join("|") === "pan|survey|survey|Draw|none"
              && armed.join("|") === "transit|transit|transit|Drawing|true|DRAWING TRANSIT LINE · ESC TO STOP||false",
        () => JSON.stringify({ start, armed }));
  a.set("pat", { A: { lat: 43, lon: -70.7 }, B: null, C: null });
  a.pathSelect("survey");                                    // drawing Transit; Survey HAS a pattern: stop, do not draw
  const s1 = [a.mode, tabOn(w), shown(w), w.D["#pp_draw"].textContent, w.D["#r_draw"].style.display];
  a.pathSelect("search"); a.pathSelect("survey");            // from panning, a tab with something drawn stays panning
  const s2 = [a.mode, tabOn(w)];
  check("2b. A TAB WITH SOMETHING DRAWN DOES NOT ARM THE CHART - and choosing it stops another tab's drawing - so a click "
        + "to look at the chart is never a point added to a plan",
        () => s1.join("|") === "pan|survey|survey|Draw|none",
        () => JSON.stringify({ s1, s2 }));
  check("2c. ... (Search had nothing drawn, so choosing it armed the datum; Survey after it, with its pattern, panned)",
        () => s2.join("|") === "pan|survey", () => JSON.stringify(s2));
  const w2 = world(), b = w2.api;
  b.pathSelect("wpt");
  const wp = [b.mode, tabOn(w2), w2.D["#pp_draw"].textContent];
  b.pathDraw(); const wpOn = [b.mode, w2.D["#pp_draw"].textContent, w2.D["#r_draw"].textContent];
  b.pathDraw(); const wpOff = [b.mode, w2.D["#pp_draw"].textContent];
  b.pathSelect("goto"); b.pathSelect("goto");                // the tab already showing: nothing changes
  const same = [b.mode, tabOn(w2)];
  b.set("pat", { A: { lat: 43, lon: -70.7 }, B: null, C: null });
  b.pathSelect("survey"); b.pathDraw();                      // drawing a survey that has a corner down...
  b.pathSelect("survey");                                    // ...and its own tab clicked again: still drawing
  same.push(b.mode, tabOn(w2));
  check("2d. WAYPOINTS NEVER ARMS ITSELF - a click there ADDS a waypoint - its button reads Edit, Edit arms it "
        + "('EDITING WAYPOINTS'), again disarms; and choosing the tab already showing changes nothing",
        () => wp.join("|") === "pan|wpt|Edit" && wpOn.join("|") === "wpt|Editing|EDITING WAYPOINTS · ESC TO STOP"
              && wpOff.join("|") === "pan|Edit" && same.join("|") === "goto|goto|survey|survey",
        () => JSON.stringify({ wp, wpOn, wpOff, same }));
}

// ── 3. a drawing mode brings its tab ───────────────────────────────────────────────────────────────────────────────────
{
  const w = world(), a = w.api;
  a.set("tab", "transit"); a.pathRender();
  a.setMode("survey");                                      // what the survey table's ✎ does (if(mode !== "survey") setMode("survey"))
  const ed = [a.mode, a.tab, shown(w), w.log.ls.asv_path_tab_v1];
  a.setMode("bound");                                       // the Area row's Draw
  const area = [a.mode, a.tab, w.D["#pp_draw"].textContent, w.D["#bnd_draw"].classList.contains("on"), w.D["#bnd_draw"].textContent,
                w.D["#r_draw"].textContent];
  check("3. A DRAWING MODE BRINGS ITS TAB: the survey table's ✎ arms \"survey\" with the card on Transit - the card "
        + "follows to Survey (and remembers it); the Area row's Draw is the Survey tab's (\"Drawing area\")",
        () => ed.join("|") === "survey|survey|survey|survey"
              && area.join("|") === "bound|survey|Drawing area|true|Drawing|DRAWING SURVEY AREA · ESC TO STOP",
        () => JSON.stringify({ ed, area }));
  a.pathDraw();
  const off = [a.mode, w.D["#pp_draw"].textContent, w.D["#bnd_draw"].classList.contains("on")];
  a.setMode("measure");                                     // the ruler is not the card's: the card keeps its tab, unlit
  const meas = [a.mode, a.tab, w.D["#pp_draw"].textContent, w.D["#r_draw"].style.display];
  check("3b. Draw while drawing the area puts the chart back to panning; the ruler is not a drawing of the card's",
        () => off.join("|") === "pan|Draw|false" && meas.join("|") === "measure|survey|Draw|none",
        () => JSON.stringify({ off, meas }));
}

// ── 4. Esc, and the chart's pill ───────────────────────────────────────────────────────────────────────────────────────
{
  const w = world(), a = w.api;
  a.pathSelect("goto");
  const was = a.mode, r1 = a.pathEscape(), after = [a.mode, w.D["#r_draw"].style.display], r2 = a.pathEscape();
  a.setMode("measure"); const r3 = a.pathEscape();
  const ESC = H.slice(H.indexOf('if(e.key !== "Escape") return;'), H.indexOf("// --- the Path planning card ---"));
  check("4. ESC STOPS DRAWING: drawing the Go-To point, Esc pans (and hides the pill); panning, it does nothing; the "
        + "ruler is left to its own Esc - and the page's Esc handler asks pathEscape after its own clauses",
        () => was === "goto" && r1 === true && after.join("|") === "pan|none" && r2 === false && r3 === false && a.mode === "measure"
              && /if\(mode === "measure"\) setMode\("pan"\);\s*\n\s*else pathEscape\(\);/.test(ESC),
        () => JSON.stringify({ was, r1, after, r2, r3 }));
  const css = H.slice(0, H.indexOf("</style>"));
  check("4b. THE PILL IS THE CHART'S OWN - outside the readout strip the card covers on a single window - and is hidden "
        + "in the controls window, which has no chart to click",
        () => /<div class="drawtag" id="r_draw"/.test(H) && H.indexOf('id="r_draw"') < H.indexOf('<div class="readout">')
              && /\.drawtag\{position:absolute;top:88px;left:50%/.test(css) && /body\.ui-controls #r_draw/.test(H),
        "on top of the chart, centered, click-through");
}

// ── 5. the Go-To point ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const w = world(), a = w.api;
  a.setGotoTarget({ lat: 43.09, lon: -70.72 });
  const set = [a.target && a.target.lat, w.D["#gt_lat"].value, w.D["#gt_lon"].value, w.D["#gt_range"].textContent, w.D["#gt_go"].disabled,
               /^ARM to Go/.test(w.D["#gt_hint"].textContent)];
  a.set("armed", true); a.pathReadings();
  const armedGo = [w.D["#gt_go"].disabled, w.D["#gt_hint"].textContent.slice(0, 20)];
  w.D["#gt_lat"].value = "95"; w.D["#gt_lon"].value = "-70.7"; a.gotoFromInputs();
  const bad = [a.target, w.D["#gt_go"].disabled];
  w.D["#gt_lat"].value = "43.05"; a.gotoFromInputs();
  const typed = a.target;
  check("5. THE POINT IS SET, NOT COMMANDED: setGotoTarget writes the fields and the range; Go stays off until ARM (and "
        + "says so); a typed latitude of 95 is no point (Go off again); both fields valid make one",
        () => set[0] === 43.09 && set[1] === "43.090000" && set[2] === "-70.720000" && set[3] === "045° · 2.00 km" && set[4] === true && set[5]
              && armedGo[0] === false && /^Go plans the route/.test(armedGo[1])
              && bad[0] === null && bad[1] === true && typed && typed.lat === 43.05 && typed.lon === -70.7,
        () => JSON.stringify({ set, armedGo, bad, typed }));
  const CLICK = (H.match(/\} else if\(mode === "goto"\)\{[\s\S]*?\} else if\(mode === "measure"\)/) || [""])[0];
  check("5b. ... and a CHART CLICK in the Go-To mode only calls setGotoTarget - no doGoTo, no request - the command is "
        + "the card's Go (and the chart menu's own row, as before)",
        () => /setGotoTarget\(ll\);/.test(CLICK) && !/doGoTo|routeCmd|postJSON|fetch\(/.test(CLICK) && /cmRow\("#cmGoto",\s*ll => doGoTo\(ll\)\);/.test(H),
        () => CLICK.replace(/\s+/g, " ").slice(0, 160));
  const GO = H.slice(H.indexOf('$("#gt_go").onclick'), H.indexOf("document.querySelectorAll(\"#pp_rules input"));
  check("5c. GO is refused unARMED in words, stops the drawing, then commands exactly as the menu's Go-To does (doGoTo)",
        () => /if\(!canCommand\(\)\)\{ flashNote\("Go-To: ARM first\."\); return; \}/.test(GO)
              && GO.indexOf("pathStopDrawing();") > 0 && GO.indexOf("pathStopDrawing();") < GO.indexOf("doGoTo(")
              && /doGoTo\(\{lat: gotoTarget\.lat, lon: gotoTarget\.lon\}\)\.catch\(/.test(GO),
        () => GO.replace(/\s+/g, " ").slice(0, 200));
}

{
  // the marker: drawn while the Go-To tab shows (drawing or panning) or the chart is placing it, and nowhere else
  const draws = (mode, tab, target) => {
    const ops = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, stroke() {}, moveTo() {}, lineTo() {},
                  arc: (x, y) => ops.push("arc " + x + "," + y), fillText: (t) => ops.push("text " + t) };
    // eslint-disable-next-line no-new-func
    const f = new Function("ctx", "mode", "pathTab", "gotoTarget", grab("drawGotoTarget") + "\nreturn drawGotoTarget;")(ctx, mode, tab, target);
    f((lat, lon) => ({ x: Math.round(lon * 10), y: Math.round(lat * 10) }));
    return ops.join(";");
  };
  const T = { lat: 43, lon: -70 };
  const r = { panTab: draws("pan", "goto", T), placing: draws("goto", "survey", T), other: draws("pan", "transit", T), none: draws("goto", "goto", null) };
  check("5d. THE POINT IS ON THE CHART while its tab shows - panning included - or while the chart is placing it; not "
        + "under another tab, and nothing without a point",
        () => r.panTab === "arc -700,430;text GO-TO" && r.placing === r.panTab && r.other === "" && r.none === "",
        () => JSON.stringify(r));
  check("5e. ... drawn by render, after the passage layers (whose order passage_plan / passage_sail pin)",
        () => /drawPassage\(toScreen\);\s*\n\s*drawSail\(toScreen\);\s*\n\s*drawGotoTarget\(toScreen\);/.test(H));
}

// ── 6. the readings ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const w = world(), a = w.api;
  a.set("transit", [{ lat: 43, lon: -70.7 }, { lat: 43.0180, lon: -70.7 }]);       // ~2,004 m north
  a.set("mission", { waypoints: [{ lat: 43, lon: -70.7 }, { lat: 43.009, lon: -70.7 }, { lat: 43.009, lon: -70.69 }], lines: [1, 2] });
  a.pathReadings();
  const r = { tl: w.D["#tr_len"].textContent, tt: w.D["#tr_time"].textContent, n: w.D["#wp_n"].textContent, lines: w.D["#wp_lines"].textContent,
              plan: w.D["#pp_plan .ppsum"].textContent, rules: w.D["#pp_rules .pprsum"].textContent };
  a.set("mission", { waypoints: [], lines: [] }); a.pathReadings();
  const empty = w.D["#pp_plan .ppsum"].textContent;
  check("6. THE READINGS: the transit line's length and its time at the TRANSIT speed (2.00 km at 6 kn, 11 min); the "
        + "plan at the foot of every tab (3 waypoints, its length; 'plan: empty' with none); Route rules in one line",
        () => r.tl === "2.00 km" && r.tt === "11m at 6 kn" && r.n === "3" && r.lines === "2"
              && r.plan === "plan: 3 wpts · 1.82 km" && empty === "plan: empty"
              && r.rules === "min 2 m · buf 5 m · water auto · 6 kn",
        () => JSON.stringify({ r, empty }));
}

// ── 7. what ends the drawing, and the search preview ───────────────────────────────────────────────────────────────────
{
  const w = world(), a = w.api;
  a.pathSelect("search"); a.pathEscape();                   // panning on the Search tab
  const pan = [a.mode, a.searchShown()];
  a.set("tab", "transit");
  const other = a.searchShown();
  check("7. THE SEARCH PREVIEW FOLLOWS ITS TAB, drawing or not (it was drawn in search MODE only, and the card now shows "
        + "the tab while panning) - and the page's draw and route both ask searchShown",
        () => pan.join("|") === "pan|true" && other === false
              && /if\(!searchShown\(\) \|\| !search\.datum\) return;/.test(H) && /if\(!search\.datum \|\| !searchShown\(\) \|\| !nogo\.ready\) return;/.test(H),
        () => JSON.stringify({ pan, other }));
  check("7b. ADD TO PLAN, SAIL PASSAGE AND FOLLOW END THE DRAWING: a committed pattern (it resets) or search (its datum "
        + "clears) stops drawing, a refused one does not; Sail stops it on the press; Follow's doTransit already pans",
        () => /\$\("#sp_add"\)\.onclick = async \(\)=>\{ await commitPattern\(\); if\(!pat\.A\) pathStopDrawing\(\); \};/.test(H)
              && /\$\("#sr_add"\)\.onclick = \(\)=>\{ commitSearch\(\); if\(!search\.datum\) pathStopDrawing\(\); \};/.test(H)
              && /\$\("#tr_sail"\)\.addEventListener\("click", \(\) => pathStopDrawing\(\)\);/.test(H)
              && /\$\("#tr_sail"\)\.onclick = \(\) => sailPassage\(\);/.test(H)
              && /setMode\("pan"\); render\(\);\n\}/.test(grab("doTransit")),
        "four ways out of drawing, beside Esc and Draw");
}

// ── 8. the first render ────────────────────────────────────────────────────────────────────────────────────────────────
check("8. THE FIRST RENDER RUNS AFTER EVERY NAME IT READS IS DECLARED - S (canCommand) is declared far below the card's "
      + "bindings, so the bindings render nothing and the boot line renders it - and the state frames keep it current",
      () => /if\(UIROLE === "main"\)\{ setFollow\(\); pathRender\(\); render\(\);/.test(H)
            && H.indexOf("let S = {};") < H.indexOf("if(UIROLE === \"main\"){ setFollow(); pathRender(); render();")
            && !/\npathRender\(\);/.test(H.slice(H.indexOf("// --- the Path planning card ---"), H.indexOf("let S = {};")))
            && /pathReadings\(\);\s+\/\/ the Path planning card: Go-To range and gate/.test(grab("applyCmdState")),
      "a const read before its declaration is a ReferenceError at load, not an undefined");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
