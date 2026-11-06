// tests/page_log_posts.js - the page posts its OWN card data into the session log, on change and never per frame
// (2026-09-25, for playback's cards): the nogo readout, the History rows, the guard bar, the LINES table.
//
// DRIVEN: the page's own logClient, updateNogoUI, recordAction, historyText, logGuardChange, logLinesTick, lineRowsForLog
// and recNum, brace-matched out of static/asv.html and evaluated with a recording `fetch`, a fake element per selector and
// the state each reads. What is asserted is WHEN a post happens and what it carries - a readout repeated is not re-posted
// (nor a chart read's elapsed counter, 1b), a History row that merges into an existing one is not re-posted, the guard
// bar posts its message only when it changes, the LINES tick posts only while a run is under way, with the coverage run.
// The mission record's new streams (client:model, chart_ink, ais_model, guard_level) are tests/page_model_posts.js's.
//
//   node tests/page_log_posts.js      # exit 0 = pass, 1 = fail
// ASV_HTML points this at a SIDECAR copy for a mutation run.
const fs = require("fs");
const path = require("path");

// crash guard: a death outside a check() is REPORTED, not silent (turn_geometry.js 30)
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond); note = typeof detail === "function" ? detail() : detail; }
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
function decl(re) { const m = H.match(re); if (!m) throw new Error("test setup: declaration " + re + " not found"); return m[0]; }

function world() {
  const posts = [];
  const els = {};
  const fakeEl = (id) => ({ id, textContent: "", className: "", style: {}, title: "", disabled: false,
                            classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } } });
  const $ = (s) => els[s] || (els[s] = fakeEl(s));
  const fetch = (url, opts) => { posts.push({ url, body: JSON.parse(opts.body) }); return { catch() {} }; };
  const readout = { text: "1300 zones · floor 2.0 m", cls: "" };
  const S = { run: "idle" };
  const mission = { lines: [] };
  const nogo = { ready: true, busy: false };
  // eslint-disable-next-line no-new-func
  const W = new Function("$", "fetch", "readout", "S", "mission", "nogo", `"use strict";
    let nogoShow = true;
    const nogoReadout = () => ({ text: readout.text, cls: readout.cls, title: "" });
    const setTip = () => {};
    const HISTORY_MAX = 20, HISTORY_KEY = "k";
    let actionLog = [];
    const lsSet = () => {}; const renderHistory = () => {};
    const renderAlertRecent = () => {};   // recordAction feeds the ALERTS card's tail (2026-09-28) - the card is ui_split / action_history's subject
    const nogoKeyShow = () => {};         // updateNogoUI shows the NOGO key with the overlay (2026-10-18) - nogo_key.js's subject
    const buildLineTable = () => [{ len_m: 100, plan_s: 60, actual_s: 30 }]; const buildTurnTable = () => []; const buildHopTable = () => [];
    // the rows the log carries gain the coverage RUN (lineRowsForLog, 2026-11-05); the coverage walk is the page's own
    const lineDoneFrac = (L) => L.frac;
    ${decl(/^let lastNogoLogged = null;/m)}
    ${decl(/^let lastGuardLogged = "";/m)}
    ${["logClient", "updateNogoUI", "recordAction", "historyText", "logGuardChange", "logLinesTick", "lineRowsForLog", "recNum"].map(grab).join("\n")}
    return { updateNogoUI, recordAction, logGuardChange, logLinesTick, log: () => actionLog };`)($, fetch, readout, S, mission, nogo);
  return { W, posts, els, readout, S, mission, nogo, $ };
}

console.log("The page posts its own card data into the session log, on change:");
{
  const { W, posts, readout } = world();
  W.updateNogoUI(); W.updateNogoUI(); W.updateNogoUI();
  const one = posts.length;
  readout.text = "1310 zones · floor 2.0 m · +10 chart"; readout.cls = "warn";
  W.updateNogoUI(); W.updateNogoUI();
  check("1. the nogo readout is posted when it CHANGES - three identical updates make one post, a changed readout one more, "
        + "each to /api/logevent as {kind:'nogo', data:{text, cls, ready}}",
        () => one === 1 && posts.length === 2 && posts.every((p) => p.url === "/api/logevent" && p.body.kind === "nogo")
              && posts[0].body.data.text === "1300 zones · floor 2.0 m" && posts[1].body.data.text === "1310 zones · floor 2.0 m · +10 chart"
              && posts[1].body.data.cls === "warn" && posts[1].body.data.ready === true,
        () => posts.length + " post(s): " + JSON.stringify(posts.map((p) => p.body.data.text)));
}
{
  // THE ELAPSED COUNTER (2026-11-05): while a read runs, tickClock repaints the row every second - "reading chart… N s" was
  // 263 of about 314 nogo records in one log. While busy the change key masks the digits.
  const { W, posts, readout, nogo } = world();
  nogo.busy = true;
  for (const s of [0, 1, 2, 3, 14]) { readout.text = "reading chart… " + s + " s"; readout.cls = "warn"; W.updateNogoUI(); }
  const reading = posts.length;
  nogo.busy = false; readout.text = "1310 zones · floor 2.0 m"; readout.cls = ""; W.updateNogoUI();
  readout.text = "1311 zones · floor 2.0 m"; W.updateNogoUI();      // not busy: a digit that moves IS a change
  check("1b. while a chart read runs, its elapsed counter is not a change - five repaints of 'reading chart… N s' post "
        + "once, as the first of them - and the readout it lands on is posted, as is a count that moves after it",
        () => reading === 1 && posts[0].body.data.text === "reading chart… 0 s" && posts.length === 3
              && posts[1].body.data.text === "1310 zones · floor 2.0 m" && posts[2].body.data.text === "1311 zones · floor 2.0 m",
        () => posts.length + " post(s): " + JSON.stringify(posts.map((p) => p.body.data.text)));
}
{
  const { W, posts } = world();
  W.recordAction("banner", "Nogo established (1300 nogo zone(s))");
  W.recordAction("banner", "Nogo established (1300 nogo zone(s))");     // merges into the row above: not a new row
  W.recordAction("cmd", "Arm", "ARMED");
  W.recordAction("cmd", "Arm", "ARMED");                                 // a repeat on top: merged
  check("2. a History row is posted when it is NEW - a repeat that merges into an existing row is not re-posted - with "
        + "the row's text as the card shows it",
        () => posts.length === 2 && posts.every((p) => p.body.kind === "history")
              && posts[0].body.data.text === "Nogo established (1300 nogo zone(s))" && posts[0].body.data.what === "banner"
              && posts[1].body.data.text === "Arm — ARMED" && W.log().length === 2,
        () => posts.length + " post(s): " + JSON.stringify(posts.map((p) => p.body.data.text)) + "; rows " + W.log().length);
}
{
  // THE MESSAGE, NOT THE BUTTONS (2026-11-05): the bar's whole textContent carries every button's label, shown or not -
  // the census found all 156 records it measured reading "... CANCEL OVERRIDE RELEASE LOW ...". What is posted is the
  // rung (#gb_rung) and the reason (#gb_why), as the operator read them.
  const { W, posts, $ } = world();
  const BUTTONS = " ROUTE ROUND HER NOW CONTINUE AT LOW SPEED PROCEED — I have assessed it CANCEL OVERRIDE "
                + "RELEASE LOW — BACK TO THE PLAN'S SPEED LEAVE IT HOLDING";
  const bar = $("#guardBar"), rung = $("#gb_rung"), why = $("#gb_why");
  const say = (r, w) => { rung.textContent = r; why.textContent = w; bar.textContent = r + w + BUTTONS; };
  bar.style.display = "none"; say("SLOW", "");
  W.logGuardChange(); W.logGuardChange();
  const hidden = posts.length;
  bar.style.display = ""; bar.className = "guardbar blind"; say("  GUARD BLIND\n", " 96.8 m off a keep-out ");
  W.logGuardChange(); W.logGuardChange();
  const shownOnce = posts.length;
  bar.className = "guardbar helm"; say("⚠ HELM", "the console would steer now");
  W.logGuardChange();
  bar.style.display = "none";
  W.logGuardChange();
  check("3. the guard bar is posted on CHANGE: nothing while hidden, once when it shows, once when its rung changes, and "
        + "once more when it hides again - its MESSAGE, the rung and the reason with whitespace folded, and none of the "
        + "buttons' labels the bar also holds",
        () => hidden === 0 && shownOnce === 1 && posts.length === 3 && posts.every((p) => p.body.kind === "guard")
              && posts[0].body.data.shown === true && posts[0].body.data.text === "GUARD BLIND 96.8 m off a keep-out"
              && posts[0].body.data.cls === "guardbar blind" && posts[1].body.data.cls === "guardbar helm"
              && posts[1].body.data.text === "⚠ HELM the console would steer now"
              && posts.every((p) => !/CANCEL OVERRIDE|PROCEED|RELEASE LOW|LEAVE IT HOLDING/.test(p.body.data.text))
              && posts[2].body.data.shown === false && posts[2].body.data.text === "",
        () => posts.length + " post(s): " + JSON.stringify(posts.map((p) => [p.body.data.shown, p.body.data.cls, p.body.data.text])));
}
{
  const { W, posts, S, mission, $ } = world();
  W.logLinesTick();                                    // idle: nothing
  S.run = "running"; W.logLinesTick();                 // running with no lines: nothing
  mission.lines = [{}];
  $("#v_runtime").textContent = " 1:00 · 2:00 left · 33% "; $("#v_surveydur").textContent = "5m @ survey";
  $("#v_approach").textContent = "1m @ high"; $("#v_wpt").textContent = "3 / 40"; $("#v_mission").textContent = "Run\n running";
  S.run = "idle"; W.logLinesTick();                    // lines drawn but nothing running: still nothing
  const before = posts.length;
  mission.lines = [{ a: { lat: 43, lon: -70 }, b: { lat: 43.001, lon: -70 }, frac: 0.6666 }];
  S.run = "running"; W.logLinesTick();
  check("4. the LINES tick posts only while a run is under way with lines - a plan drawn and idle posts nothing - carrying "
        + "the table (each row with the share of its coverage RUN, `done`, 2 dp - 2026-11-05) and the run-time readouts as "
        + "the cards show them (whitespace folded)",
        () => before === 0 && posts.length === 1 && posts[0].body.kind === "lines"
              && posts[0].body.data.lines.length === 1 && posts[0].body.data.lines[0].done === 0.67
              && posts[0].body.data.lines[0].len_m === 100 && posts[0].body.data.runtime === "1:00 · 2:00 left · 33%"
              && posts[0].body.data.survey === "5m @ survey" && posts[0].body.data.approach === "1m @ high"
              && posts[0].body.data.wpt === "3 / 40" && posts[0].body.data.mission === "Run running",
        () => posts.length + " post(s): " + JSON.stringify(posts[0] && posts[0].body.data).slice(0, 200));
}
check("5. the tickers are installed beside consoleHealth's: the guard bar every 2 s, the LINES table every 30 s",
      () => /setInterval\(logGuardChange, 2000\)/.test(H) && /setInterval\(logLinesTick, 30000\)/.test(H),
      "setInterval(logGuardChange, 2000) / setInterval(logLinesTick, 30000)");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
